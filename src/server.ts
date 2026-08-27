/**
 * L'écran, servi depuis les sources.
 *
 * Le profil des paliers est mesuré une fois — deux minutes de modèles téléchargés — et
 * figé dans `data/profiles.json`. Tout le reste se calcule à partir de lui : le routage
 * du lecteur, le routage optimal, ce que chacun coûte. Rien ici ne relance un modèle, et
 * c'est ce qui rend la démo publiable.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { FIELDS } from "./corpus.ts";
import { TIERS, type TierName } from "./paliers.ts";
import { readProfiles } from "./measure.ts";
import { evaluer, optimiseExtraction, budgetShadowPrice, type Routing, latenceRepresentative } from "./optimise.ts";
import "./figer.ts";  /* pose la table figée : voir figer.ts */
import { ASSUMPTIONS, BOUNDS, pricePerThousandExtractions, accuracy, type Assumptions } from "./assumptions.ts";
import { isMain } from "./cli.ts";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4670);

/*
 * Le profil mesuré, exigé et non deviné.
 *
 * `readProfiles` rend `null` quand personne n'a lancé la mesure. Servir un écran avec des
 * zéros partout serait pire qu'une erreur : le lecteur y verrait un modèle qui n'attrape
 * rien, et le tort viendrait de nous.
 */
const profilsLus = readProfiles();
if (!profilsLus) throw new Error("no measured profile — run `npm run measure` d'abord");
const profils = profilsLus;

/* L'état vit en mémoire : rien de ce qu'un visiteur bouge n'est écrit sur le disque. */
let hypotheses: Assumptions = { ...ASSUMPTIONS };

/*
 * Le routage de départ est le pire des bons réflexes : tout au même palier.
 *
 * C'est ce que fait une équipe qui achète un modèle — le grand pour tout — et c'est
 * précisément ce que l'outil dit d'éviter. Le lecteur arrive donc sur le défaut du métier,
 * voit son prix, et déplace les cases lui-même.
 */
let routage: Routing = Object.fromEntries(FIELDS.map((c) => [c, "large"])) as Routing;

function json(res: ServerResponse, corps: unknown, code = 200): void {
  const load = JSON.stringify(corps);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(load),
  });
  res.end(load);
}

/** Le plafond du corps d'une requête, nommé pour être éprouvable ailleurs. */
export const PLAFOND_CORPS = 50_000;

function corps(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resoudre, rejeter) => {
    /*
     * ─── UN FLUX D'OCTETS N'EST PAS UNE CHAÎNE, ET LES TROIS DÉFAUTS N'EN FONT QU'UN ───
     *
     * La version précédente faisait `brut += b` — une CHAÎNE — puis comparait `brut.length`
     * au plafond et décodait chaque morceau au passage. Trois conséquences, toutes mesurées
     * le 26 août 2026 sur le serveur réel, corps JSON valides, route POST réelle :
     *
     *   LE PLAFOND COMPTAIT DES UNITÉS UTF-16 en annonçant des octets.
     *       60 008 octets / 60 008 unités ASCII   → socket coupée, refusé
     *      135 008 octets /  45 008 unités UTF-8  → 200, ACCEPTÉ
     *     Deux fois et demie la borne, acceptée, parce qu'un caractère à trois octets ne
     *     compte que pour un. Le cas voisin ne pouvait pas le voir : il envoie de l'ASCII,
     *     où un caractère vaut un octet.
     *
     *   UN CARACTÈRE COUPÉ ENTRE DEUX PAQUETS ARRIVAIT CORROMPU. `b.toString()` par morceau
     *     décode un octet de tête sans sa suite :
     *       envoyé « aあb », coupé après le premier octet du あ  →  reçu « a␦␦␦b »
     *     Corruption silencieuse et non déterministe de toute entrée non ASCII, sur un outil
     *     vendu pour lire des noms et des dates de naissance.
     *
     *   ET LE REFUS N'ARRIVAIT JAMAIS AU CLIENT. `req.destroy()` tuait la socket AVANT que le
     *     message d'erreur soit écrit :
     *       corps de 60 013 octets → RemoteDisconnected, aucune réponse
     *     Le message existait, il était soigné, et personne ne l'a jamais lu.
     *
     * On accumule donc des Buffers, on compte des octets, on décode UNE fois à la fin, et on
     * met le flux en pause au lieu de le tuer — la pause ferme la fenêtre TCP, donc l'envoi
     * s'arrête aussi, mais la réponse peut encore partir. La socket est fermée après, quand
     * la réponse a fini de sortir.
     */
    const morceaux: Buffer[] = [];
    let octets = 0;
    req.on("data", (b: Buffer) => {
      octets += b.length;
      if (octets > PLAFOND_CORPS) {
        req.pause();
        rejeter(new Error(`request too large (> ${PLAFOND_CORPS} octets)`));
        return;
      }
      morceaux.push(b);
    });
    req.on("end", () => {
      const brut = Buffer.concat(morceaux).toString("utf8");
      /*
       * `null` ET UN TABLEAU NE SONT PAS DES OBJETS, ET LE MESSAGE LE DISAIT EN JAVASCRIPT.
       *
       * Un corps valant `null` rendait « Cannot read properties of null (reading 'champ') »
       * au client : un message d'exécution interne, qui ne dit ni ce qui était attendu ni
       * quoi faire. Un tableau, lui, passait sans un mot et ne changeait rien.
       */
      try {
        const v = brut ? JSON.parse(brut) : {};
        if (v === null || typeof v !== "object" || Array.isArray(v)) {
          rejeter(new Error(
            `the body must be a JSON object, and this one is ${v === null ? "null" : Array.isArray(v) ? "an array" : typeof v}. `
            + `Expected something like {"champ": "name", "palier": "rules"}.`));
          return;
        }
        resoudre(v as Record<string, unknown>);
      } catch (e) { rejeter(e); }
    });
    req.on("error", rejeter);
  });
}

/*
 * LA CONVERSION PRÉCÉDAIT LA GARDE, ET LA GARDE NE GARDAIT RIEN.
 *
 * `Number(recu[cle])` puis `Number.isFinite(v)` : la conversion s'exécute AVANT le test, or
 * `Number(null)`, `Number("")`, `Number([])` et `Number(false)` valent tous **zéro**, qui est
 * fini, qui est donc accepté, et qui est ensuite ramené dans les bornes — c'est-à-dire posé
 * SUR LA BORNE BASSE de l'hypothèse.
 *
 * Mesuré sur le serveur en marche : `{"volume": null}` rend 200 et fait passer le volume de
 * 100 000 à 1 000. Un facteur cent sur l'hypothèse dont dépend tout le calcul de coût, sans
 * un mot, sur l'écran qui existe pour montrer ce que les hypothèses décident.
 *
 * ET L'ÉCRAN FABRIQUE LUI-MÊME CETTE ENTRÉE. `lire()` rend `NaN` sur une saisie illisible,
 * `JSON.stringify` écrit `NaN` comme `null`, et le voilà. Taper « abc » dans un champ, ou le
 * vider, suffisait.
 *
 * Une session voisine a trouvé le même idiome dans trois autres dépôts — une part de risque
 * mise à zéro, un seuil KYC posé sur son réglage le moins prudent, une promesse ramenée à un
 * jour. À chaque fois la valeur atterrit à une extrémité de sa plage, à chaque fois avec un
 * 200, à chaque fois sur le chiffre que l'outil existe pour montrer. Ce n'est plus une faute,
 * c'est un idiome : il SE LIT comme une validation et n'en est pas.
 *
 * On exige donc le type que l'écran envoie déjà, et on NOMME ce qu'on a refusé — ignorer en
 * silence est ce qui a rendu ce défaut invisible pendant tout ce temps.
 */
export function appliquerHypotheses(
  recu: Record<string, unknown>, actuelles: Assumptions,
): { hypotheses: Assumptions; refuses: string[] } {
  if (recu.remise) return { hypotheses: { ...ASSUMPTIONS }, refuses: [] };
  let hypotheses = actuelles;
  const refuses: string[] = [];
  for (const [cle, [bas, haut]] of Object.entries(BOUNDS)) {
    if (!(cle in recu)) continue;
    const v = recu[cle];
    if (typeof v === "number" && Number.isFinite(v)) {
      hypotheses = { ...hypotheses, [cle]: Math.min(haut, Math.max(bas, v)) };
    } else {
      refuses.push(`${cle}=${JSON.stringify(v)}`);
    }
  }
  return { hypotheses, refuses };
}

/*
 * L'ÉTAT SE RECALCULAIT ENTIÈREMENT À CHAQUE REQUÊTE, Y COMPRIS QUAND RIEN N'AVAIT BOUGÉ.
 *
 * Mesuré : 437 ms par appel, et un simple GET `/api/etat` les payait. Trois appels de suite
 * sans rien changer rendent le MÊME objet, à l'octet près — le recalcul était donc redondant,
 * pas cher. Mille requêtes mettaient la démonstration à genoux pendant cinq minutes.
 *
 * On garde le dernier résultat, indexé sur ce dont il dépend : le routage courant et les
 * hypothèses. Les profils ne changent pas en cours d'exécution — ils sont lus au démarrage —
 * mais ils entrent quand même dans la clé, pour que la mémoire ne survive pas à un rechargement
 * qu'on ajouterait plus tard sans y penser.
 *
 * Une limite de débit posée AVANT ce correctif aurait masqué la lenteur au lieu de la
 * corriger, et le plafond aurait été calibré sur un coût qui n'avait pas lieu d'être.
 */
let memoire: { cle: string; valeur: ReturnType<typeof calculerEtat> } | null = null;

export function etat() {
  const cle = JSON.stringify([routage, hypotheses, profils.measuredAt]);
  if (memoire && memoire.cle === cle) return memoire.valeur;
  const valeur = calculerEtat();
  memoire = { cle, valeur };
  return valeur;
}

function calculerEtat() {
  const optimum = optimiseExtraction(profils, hypotheses);
  const mien = evaluer(profils, hypotheses, routage);
  return {
    champs: FIELDS,
    paliers: TIERS,
    routage,
    /* La justesse de chaque couple, telle qu'elle sera dessinée dans les cases. */
    justesse: Object.fromEntries(FIELDS.map((c) => [
      c,
      Object.fromEntries(TIERS.map((e) => [e, accuracy(e, profils.extraction[e][c].accuracy, hypotheses)])),
    ])),
    prix: Object.fromEntries(TIERS.map((e) => [e, pricePerThousandExtractions(e, hypotheses, latenceRepresentative(profils, e))])),
    mien,
    optimum,
    /* Le tout-au-même-palier, pour dire ce que le réflexe coûte. */
    uniformes: TIERS.map((e) => ({
      palier: e,
      ...evaluer(profils, hypotheses, Object.fromEntries(FIELDS.map((c) => [c, e])) as Routing),
    })),
    prochainGain: budgetShadowPrice(profils, hypotheses),
    hypotheses,
    bornes: BOUNDS,
    /*
     * L'ÉCHANTILLON DERRIÈRE CHAQUE CASE, ET IL DOIT RESTER DE MÊME FORME QUE `pages.ts`.
     *
     * Deux constructeurs d'état alimentent le même écran : celui-ci pour la démonstration
     * qui tourne, `pages.ts` pour la page publiée. L'en-tête de `ui.html` le dit : dès qu'ils
     * divergent, un correctif porté sur l'un laisse l'autre écran mentir. La légende de la
     * figure de routage tapait 120 pour sept paliers qui n'ont pas le même dénominateur ;
     * elle le dérive maintenant de cette entrée, et sans elle l'écran local annonce qu'il ne
     * connaît pas ses tailles d'échantillon.
     */
    echantillons: Object.fromEntries(TIERS.map((e) => [e, profils.extraction[e][FIELDS[0]!].items])),
    mesureLe: profils.measuredAt,
  };
}

/*
 * ÉCOUTER LA BOUCLE LOCALE MET HORS DE PORTÉE DU RÉSEAU, PAS DU NAVIGATEUR.
 *
 * Trouvé par une session voisine sur un autre dépôt, vérifié ici : n'importe quelle page web
 * ouverte par l'utilisateur peut poster sur `localhost:4670`. En forme « simple »
 * — `content-type: text/plain` — il n'y a pas de requête préalable, la requête PART, et
 * l'absence d'en-têtes CORS empêche seulement la page de LIRE la réponse. Pas d'annuler ce que
 * la requête a déjà fait. Mesuré avant correction : une origine étrangère changeait le routage
 * affiché, donc la démonstration que l'acheteur regarde.
 *
 * La garde tient sur un fait du navigateur : il envoie TOUJOURS `Origin` sur une écriture, et
 * une page ne peut pas le falsifier. Un client hors navigateur — curl, un script, nos propres
 * contrôles — n'en envoie pas du tout. Refuser une origine étrangère ferme donc le navigateur
 * sans fermer la ligne de commande, et c'est la seule forme qui fasse les deux.
 *
 * Elle est posée AVANT TOUTE ROUTE, pour qu'ajouter une route ne soit pas un moyen de l'oublier.
 */
function origineEtrangere(req: IncomingMessage): string | null {
  const o = req.headers.origin;
  if (!o) return null;                       // hors navigateur : pas d'Origin, rien à défendre
  /*
   * ON COMPARE À L'HÔTE DE LA REQUÊTE, PAS À UNE LISTE ÉCRITE EN DUR.
   *
   * La première version acceptait `localhost:4670` et `127.0.0.1:4670`, littéralement. Elle
   * aurait donc refusé SON PROPRE ÉCRAN dès que quelqu'un sert la démo sous un autre nom —
   * `mon-mac.local`, un port choisi par PORT=…, une machine de démonstration, un proxy. Une
   * garde qui refuse l'usage normal se fait retirer, et elle emporte la faille avec elle.
   *
   * Une page servie PAR ce serveur porte forcément le même hôte que la requête qu'elle émet :
   * comparer les deux est à la fois plus permissif pour l'usage légitime et aussi strict pour
   * l'attaque, puisqu'une page hostile a par définition un autre hôte. Le navigateur remplit
   * `Host` et `Origin` lui-même et une page ne peut falsifier ni l'un ni l'autre.
   */
  const hote = req.headers.host;
  if (!hote) return o;                       // sans Host on ne peut rien comparer : on refuse
  try {
    return new URL(o).host === hote ? null : o;
  } catch {
    return o;                                // un Origin illisible n'est pas le nôtre
  }
}

/*
 * UN PLAFOND PAR ADRESSE, QUI REND 429 ET DIT QUOI FAIRE.
 *
 * Techniquement, on n'en a pas besoin : le serveur écoute sur la boucle locale, aucune route
 * n'appelle un service facturé, et une requête coûte 1,5 ms depuis que l'état est mémorisé.
 * Il est là parce que **tout questionnaire de sécurité bancaire pose la question**, et que
 * « nous n'en avons pas besoin, nous écoutons sur la boucle locale » est une réponse vraie
 * qui coûte la vente. Le plafond est bon marché et il se démontre.
 *
 * Le plafond est GÉNÉREUX à dessein. L'écran ne sonde pas : il émet une requête par geste de
 * l'utilisateur. Quatre par seconde en continu sont hors d'atteinte d'un humain et triviales
 * pour un script — c'est exactement la ligne qu'on veut. Une limite qui refuse l'usage normal
 * se fait retirer, et elle emporte la protection avec elle.
 *
 * CE QU'IL NE FAIT PAS, et il faut le dire : sur la boucle locale, tous les clients partagent
 * `127.0.0.1`. Un script abusif épuise donc le même compteur que la personne assise devant
 * l'écran. C'est inhérent à une clé d'adresse sur une machine unique, pas un oubli.
 */
export const PLAFOND_REQUETES = 240;          /* par adresse et par fenêtre */
export const FENETRE_MS = 60_000;

const vues = new Map<string, number[]>();

/** Rend le nombre de requêtes restantes, ou `null` si l'adresse a dépassé son plafond. */
export function compter(adresse: string, maintenant = Date.now()): number | null {
  const debut = maintenant - FENETRE_MS;
  const recentes = (vues.get(adresse) ?? []).filter((t) => t > debut);
  /*
   * La carte est purgée à chaque passage : sans ça, une adresse par requête ferait grossir
   * la mémoire sans borne — on aurait remplacé un épuisement par un autre, plus discret.
   */
  for (const [cle, temps] of vues) if (temps.every((t) => t <= debut)) vues.delete(cle);
  if (recentes.length >= PLAFOND_REQUETES) { vues.set(adresse, recentes); return null; }
  recentes.push(maintenant);
  vues.set(adresse, recentes);
  return PLAFOND_REQUETES - recentes.length;
}

/** Pour les cas : remet les compteurs à zéro. */
export function oublierLesRequetes(): void { vues.clear(); }

/*
 * CAVIARDER UN CHEMIN AVANT DE RENVOYER UNE ERREUR.
 *
 * Aujourd'hui aucune erreur atteignable ne porte de chemin : les routes ne touchent pas au
 * disque, et les seules erreurs qui remontent ici sont des analyses JSON ratées et des
 * `TypeError`. Vérifié en le tentant — `/js/../../../etc/passwd` rend « introuvable », sans
 * un octet de plus. **La propriété est donc vraie par accident, pas par construction.**
 *
 * Le jour où quelqu'un ajoute une route qui lit un fichier, `ENOENT: no such file or
 * directory, open '/Users/…/data/x.json'` traverse ce gestionnaire tel quel — et personne ne
 * l'aura modifié, donc personne ne le verra. C'est la forme la plus discrète d'une fuite :
 * elle apparaît par un changement fait ailleurs.
 *
 * On ne caviarde QUE ce qui est enraciné dans un système de fichiers. Une route — `/api/etat`
 * — reste lisible : c'est l'information la plus utile d'un message d'erreur, et la retirer
 * ferait écrire aux suivants un gestionnaire qui contourne celui-ci.
 */
/*
 * LA LISTE DES RACINES EST UNE LISTE, ET C'EST SA FAIBLESSE CONNUE. Un dépôt lancé depuis un
 * disque externe (`/Volumes/WORK/…`), `/usr/local`, `/srv`, `/mnt` n'était pas caviardé : le
 * chemin complet — nom d'utilisateur, arborescence — partait dans la réponse HTTP. Élargie le
 * 27 août 2026 aux racines usuelles des trois systèmes et des chaînes d'intégration. Elle
 * reste une liste : un chemin sous une racine exotique passera encore, et la parade de fond —
 * ne jamais mettre un chemin dans un message qui sort — vit dans les messages eux-mêmes.
 */
export function sansChemins(texte: string): string {
  return texte
    .replace(/file:\/\/\/[^\s"')]+/g, "<file>")
    .replace(/\b[A-Za-z]:\\[^\s"')]+/g, "<file>")
    .replace(/(?:\/(?:Users|home|private|var|tmp|opt|etc|Applications|Volumes|Library|usr|srv|mnt|media|data|root|Sites|workspace|github|builds?)|\.\.?)\/[^\s"')]*/g, "<file>")
    .replace(/[^\s"')]*node_modules\/[^\s"')]*/g, "<file>");
}

/**
 * LES EN-TÊTES QUE TOUT QUESTIONNAIRE DE SÉCURITÉ RÉCLAME, ET CE QU'ILS VALENT ICI.
 *
 * Mesuré le 25 août 2026 : ZÉRO en-tête de sécurité sur toute réponse. Trouvé par un balayage,
 * et c'est le seul de ses quatre signalements sur ce fichier qui ait résisté à la mesure — la
 * garde d'origine refuse bien une page étrangère (403, éprouvé), et le compteur partagé sur
 * la boucle locale est déjà écrit plus haut comme inhérent.
 *
 * LE COÛT DES ROUTES PORTE MAINTENANT SON ÉTAT. La version précédente de cette phrase — « la
 * route la plus chère coûte une dizaine de millisecondes » — était fausse dans un sens
 * pendant qu'une trouvaille d'audit l'était dans l'autre, avec « 239 requêtes ont occupé
 * 337 s ». Les deux chiffres avaient été pris sur des états différents sans le dire. Mesuré
 * le 26 août 2026, serveur seul sur un port libre :
 *
 *     /api/routage      1,1 ms au premier appel, 0,6 à 1,0 ms ensuite
 *     /api/etat         3,3 ms puis 0,9 ms
 *     /api/hypotheses   2,2 ms
 *     /api/optimum      1 743 ms AU PREMIER APPEL, puis 46 à 59 ms
 *
 * Les 337 s supposaient ~1,4 s par requête : c'est le coût FROID de `/api/optimum`, payé une
 * seule fois. Éprouvé en variant la charge utile à chaque appel, pour qu'un cache trop facile
 * ne se fasse pas passer pour le vrai tiède — 240 requêtes coûtent 11 à 14 s dans une fenêtre
 * de 60 s, pas 337.
 *
 * Un chiffre qui ne porte pas l'état dans lequel il a été pris ne voyage pas : il se fait
 * citer.
 *
 * Ce qu'ils protègent VRAIMENT dans un outil local, sans le survendre : la page charge son
 * propre script et sa propre feuille, jamais rien d'externe. Une politique stricte transforme
 * donc une injection future en refus du navigateur, au lieu d'une exécution. C'est une
 * seconde barrière derrière l'échappement, pas une excuse pour l'affaiblir.
 *
 * `strict-transport-security` est VOLONTAIREMENT ABSENT : il ne s'applique qu'en HTTPS, et le
 * poser sur `localhost` en clair épinglerait le HTTPS pour tout ce que le navigateur sert
 * depuis cette origine — on casserait la machine du client pour un en-tête décoratif. Un
 * en-tête posé parce qu'il figure sur une liste, sans que sa condition soit remplie, est du
 * théâtre : il rassure l'auditeur et coûte à l'utilisateur.
 */
/*
 * ET LE JETON, PARCE QUE `script-src 'self'` A CASSÉ LA PAGE EN SILENCE.
 *
 * `ui.html` porte son programme dans un `<script type="module">` EN LIGNE. `'self'` autorise
 * les fichiers servis par cette origine et refuse le code écrit dans la page : mesuré dans un
 * vrai navigateur le 25 août 2026, la page passait de 2 figures, 1 SVG, 2 boutons et 35
 * cellules à **zéro partout**. Le titre s'affichait toujours, et l'outil de console n'a
 * rapporté AUCUNE erreur — un en-tête de sécurité qui détruit le produit sans un mot.
 *
 * Deux sorties possibles, et la mauvaise est tentante : `'unsafe-inline'` rétablit la page et
 * retire tout l'intérêt de la politique. Un jeton la rétablit en la gardant stricte — il est
 * tiré au hasard À CHAQUE RÉPONSE, donc une injection future ne peut pas le deviner.
 *
 * Ce que ça garde : la page charge son script et sa feuille, jamais rien d'externe, et le
 * code qu'une injection écrirait n'a pas le jeton. C'est une seconde barrière derrière
 * l'échappement, pas une excuse pour l'affaiblir.
 */
export const politiqueDeContenu = (jeton: string): string =>
  "default-src 'none'; "
  + `script-src 'self' 'nonce-${jeton}'; `
  + "style-src 'self'; img-src 'self' data:; "
  + "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const ENTETES_DE_SECURITE: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  /* Aucune de ces trois capacités n'est employée ; les refuser coûte zéro et retire trois
     questions du questionnaire d'un acheteur. */
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/*
 * LE CHEMIN DE LA PAGE EST UN PARAMÈTRE, POUR LA RAISON ÉCRITE DANS `readProfiles`.
 *
 * La garde qui refuse une page dont le script en ligne n'a pas pu être marqué ne peut se
 * déclencher qu'en servant une page d'une AUTRE FORME. Le chemin étant calculé depuis
 * `import.meta.url`, le seul déclenchement possible aurait été de réécrire le `src/ui.html`
 * du dépôt VIVANT — que cinq fichiers lisent dans des processus PARALLÈLES sous `node --test`.
 * Résultat : on pouvait retirer le `throw` sans qu'un seul cas bouge.
 *
 * La valeur par défaut EST la production : `creerEcouteur()` sans argument sert la vraie page,
 * donc le point d'appel réel reste éprouvé — c'est ce que fait le cas « la politique de contenu
 * est stricte ET la page reste exécutable », qui lance le vrai processus. Seuls les témoins de
 * la forme de la balise passent un bac à sable.
 */
const CHEMIN_UI = fileURLToPath(new URL("./ui.html", import.meta.url));

async function ecouteur(req: IncomingMessage, res: ServerResponse, cheminUi: string): Promise<void> {
  /* AVANT tout, y compris avant le 429 : une réponse d'erreur est une réponse, et c'est
     souvent celle qu'un attaquant sait provoquer. */
  for (const [nom, valeur] of Object.entries(ENTETES_DE_SECURITE)) res.setHeader(nom, valeur);
  const jeton = randomBytes(16).toString("base64");
  res.setHeader("content-security-policy", politiqueDeContenu(jeton));
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const adresse = req.socket.remoteAddress ?? "inconnue";

  /*
   * ─── LA GARDE D'ORIGINE PASSE AVANT LE COMPTEUR, ET C'EST TOUT LE CORRECTIF ───
   *
   * Le compteur s'incrémentait en premier. Une page hostile ouverte dans un autre onglet
   * voyait donc ses écritures refusées — la garde faisait son travail, 403 à chaque fois —
   * **et son refus coûtait quand même le quota de l'acheteur**. Mesuré le 26 août 2026 :
   *
   *     240 requêtes portant « Origin: http://evil.example »  → toutes refusées 403
   *     puis une requête légitime de l'écran                  → HTTP 429
   *     puis la page elle-même                                → HTTP 429
   *
   * Un déni de service à un onglet de distance, sans authentification et sans outil, contre
   * l'écran qui sert à vendre. Et invisible dans tout relevé : des 403 d'un côté, un 429 de
   * l'autre, et rien qui relie les deux.
   *
   * Un contrôle correct dont le prix est payé par la victime n'est pas un contrôle.
   *
   * CE QUI RESTE, dit plutôt que taire : une page étrangère peut encore faire émettre des 403,
   * qui coûtent une réponse chacun. C'est le même coût qu'elle peut déjà infliger à n'importe
   * quel port de la boucle locale, et la boucle locale n'a jamais été la frontière — c'est
   * écrit plus haut. Ce qui change, c'est qu'elle ne peut plus fermer l'écran de quelqu'un
   * d'autre.
   */
  if (req.method === "POST") {
    const venueDAilleurs = origineEtrangere(req);
    if (venueDAilleurs !== null) {
      return json(res, {
        erreur: `write refused: this request comes from ${venueDAilleurs}, not from this screen. `
          + `Listening on the loopback protects against the network, not against the browser — `
          + `a page open in another tab can post here with nothing to show for it.`,
      }, 403);
    }
  }

  const restantes = compter(adresse);
  if (restantes === null) {
    res.writeHead(429, {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(Math.ceil(FENETRE_MS / 1000)),
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({
      erreur: `rate limit reached: more than ${PLAFOND_REQUETES} requests in ${FENETRE_MS / 1000} s `
        + `from ${adresse}. This screen sends one request per action, so this is a script, `
        + `not a person. Wait ${Math.ceil(FENETRE_MS / 1000)} s and it clears by itself.`,
    }));
    return;
  }
  res.setHeader("x-ratelimit-remaining", String(restantes));
  try {
    if (url.pathname === "/") {
      /*
       * Le jeton se pose sur le script EN LIGNE. On REFUSE plutôt que de remplacer en silence :
       * si la balise change de forme, la page part sans jeton, se fait refuser par sa propre
       * politique, et n'affiche RIEN — un échec qu'il vaut mieux voir ici qu'à l'écran.
       *
       * ON LIT ET ON MARQUE AVANT D'ENGAGER LA RÉPONSE. Le `writeHead(200)` précédait ce
       * contrôle : le `throw` partait bien, mais le `catch` rappelait `writeHead` sur une
       * réponse déjà engagée → `ERR_HTTP_HEADERS_SENT` levé DANS le gestionnaire d'erreur,
       * hors de toute capture. Mesuré le 26 août 2026, page mutée : le client recevait
       * « Empty reply from server » — pas une ligne de statut, aucun 400, aucun texte — et le
       * PROCESSUS S'ARRÊTAIT, la requête suivante rendant 000. Les quatre phrases écrites
       * ci-dessous n'atteignaient donc personne ; ce que l'exploitant obtenait était une pile.
       *
       * ET LA CONDITION PORTE SUR L'INVARIANT, PAS SUR L'EFFET DU REMPLACEMENT.
       * « le replace n'a rien changé » disait autre chose que « un script en ligne est resté
       * nu » : elle refusait aussi une page dont le seul script est EXTERNE. Mesuré avec
       * `<script type="module" src="/graphes.js">` : même origine, pleinement autorisé par
       * `script-src 'self'`, et pourtant même refus, même serveur mort. Sortir le script en
       * ligne dans un fichier est précisément le durcissement qu'on recommande, et la garde le
       * cassait. Le motif est celui du témoin de serveur-bornes.test.ts, volontairement : le
       * contrôle et son témoin lisent la page servie de la même façon.
       */
      const brut = readFileSync(cheminUi, "utf8");
      const avecJeton = brut.replace(/<script type="module">/g, `<script type="module" nonce="${jeton}">`);
      const nus = [...avecJeton.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)]
        .filter((m) => !m[1]!.includes(`nonce="${jeton}"`));
      if (nus.length > 0) {
        throw new Error(
          `ui.html holds ${nus.length} inline <script> the nonce could not mark: the tag changed `
          + "shape. Without its nonce the content policy refuses the script and the page renders "
          + "EMPTY, with no error anywhere. Fix the insertion rather than weakening the policy.");
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(avecJeton);
      return;
    }
    for (const [chemin, type] of [["/graphes.js", "text/javascript"], ["/registre.css", "text/css"]] as const) {
      if (url.pathname === chemin) {
        /*
         * LIRE AVANT D'ÉCRIRE L'EN-TÊTE. `writeHead(200)` avant `readFileSync` : un fichier
         * illisible rendait un 200 TRONQUÉ — l'en-tête est déjà parti, on ne peut plus dire
         * 500 — et le navigateur recevait « succès » avec un corps vide. Un 200 qui ment est
         * pire qu'un 500 : rien, nulle part, ne signale que la page tourne sans son script.
         * Audit du 27 août 2026.
         */
        let corps: string;
        try {
          corps = readFileSync(fileURLToPath(new URL("." + chemin, import.meta.url)), "utf8");
        } catch (e) {
          return json(res, { erreur: sansChemins(`${chemin} unreadable: ${(e as Error).message}`) }, 500);
        }
        res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
        res.end(corps);
        return;
      }
    }

    if (url.pathname === "/api/etat") return json(res, etat());

    if (url.pathname === "/api/routage" && req.method === "POST") {
      const recu = await corps(req);
      /*
       * UN CHAMP OU UN PALIER INCONNU RENDAIT 200 ET NE FAISAIT RIEN.
       *
       * Mesuré en frappant le serveur : `{"champ":"inexistant"}` et `{"palier":"gpt-9"}`
       * rendaient tous les deux un état inchangé avec un code de succès. L'écran semble ne
       * pas réagir, et celui qui le manipule n'a aucun moyen de savoir pourquoi — ni s'il
       * s'est trompé, ni si l'outil est cassé. Un corps vide, `null` ou un tableau passaient
       * pareil.
       *
       * Le refus nomme ce qui est accepté : sur cinq champs et sept paliers, « valeur
       * inconnue » n'aide personne.
       */
      const champ = String(recu.champ ?? "");
      const palier = String(recu.palier ?? "") as TierName;
      const mauvais: string[] = [];
      if (!FIELDS.includes(champ as never)) {
        mauvais.push(`field "${champ || "(absent)"}" — accepted: ${FIELDS.join(", ")}`);
      }
      if (!TIERS.includes(palier)) {
        mauvais.push(`tier "${palier || "(absent)"}" — accepted: ${TIERS.join(", ")}`);
      }
      if (mauvais.length > 0) {
        return json(res, {
          erreur: `this request changes nothing, and here is why:\n  ${mauvais.join("\n  ")}`,
        }, 400);
      }
      routage = { ...routage, [champ]: palier };
      return json(res, etat());
    }

    if (url.pathname === "/api/optimum" && req.method === "POST") {
      /*
       * CETTE ROUTE N'A BESOIN D'AUCUN CORPS, ET C'EST PRÉCISÉMENT POURQUOI ELLE LE LISAIT PAS.
       *
       * Deux routes POST sur trois passaient par `corps()`, qui détruit la socket au-delà de
       * `PLAFOND_CORPS` ; celle-ci ne l'appelait pas du tout. Mesuré : 100 Mo envoyés ici
       * répondaient 200, quand les deux autres coupaient. L'impact mémoire est nul — Node jette
       * ce que personne ne lit — mais une garde portée par deux routes sur trois n'est pas une
       * garde : c'est un usage, et la prochaine route copiera peut-être la mauvaise.
       *
       * On lit donc le corps même sans l'utiliser, pour que la borne s'applique ici aussi.
       */
      await corps(req);
      const o = optimiseExtraction(profils, hypotheses);
      if (o) routage = { ...o.routing };
      return json(res, etat());
    }

    if (url.pathname === "/api/hypotheses" && req.method === "POST") {
      const recu = await corps(req);
      const r = appliquerHypotheses(recu as Record<string, unknown>, hypotheses);
      if (r.refuses.length) {
        return json(res, {
          erreur: `non-numeric value(s) refused: ${r.refuses.join(", ")}. `
            + `An absent assumption is not an assumption of zero: it would be pinned to `
            + `its lower bound, and the routing shown would be computed on that.`,
          ...etat(),
        }, 400);
      }
      hypotheses = r.hypotheses;
      return json(res, etat());
    }

    res.writeHead(404).end("introuvable");
  } catch (e) {
    /* La socket se ferme APRÈS que la réponse est sortie, jamais avant : c'est tout l'écart
       entre un refus que le client lit et une connexion coupée qu'il ne peut qu'interpréter.
       `finish` se déclenche quand la réponse a fini de partir. */
    if (req.readable && !req.readableEnded) res.on("finish", () => req.destroy());
    json(res, { erreur: sansChemins(String((e as Error).message ?? e)) }, 400);
  }
}

/** L'écouteur du serveur. Sans argument, il sert la vraie page — voir le commentaire ci-dessus. */
export const creerEcouteur = (cheminUi: string = CHEMIN_UI) =>
  (req: IncomingMessage, res: ServerResponse): Promise<void> => ecouteur(req, res, cheminUi);

const serveur = createServer(creerEcouteur());

/*
 * On écoute la boucle locale, pas toutes les interfaces : `listen(PORT)` seul rend l'outil
 * joignable par n'importe qui sur le même réseau.
 */
if (isMain(import.meta)) {
  /*
   * UN PORT DÉJÀ PRIS EST LA PANNE LA PLUS BANALE QUI SOIT, et sans ce gestionnaire c'est
   * la plus effrayante : `listen` émet un événement `error` que personne n'écoute, Node le
   * relance, et l'acheteur reçoit `Unhandled 'error' event`, `errno: -48`, `syscall:
   * 'listen'` et une pile de sept lignes. Il lit « l'outil n'est pas fini », alors que la
   * cause tient en une phrase — et qu'il a très probablement lancé la commande deux fois.
   *
   * Le refus nomme le port ET donne la commande qui dit qui l'occupe : un refus sans issue
   * se contourne en désactivant le refus.
   */
  serveur.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use, so this server did not start.`);
      console.error(`Most likely it is already running — open http://localhost:${PORT}`);
      console.error(`To see what holds it:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
      process.exit(1);
    }
    if (e.code === "EACCES") {
      console.error(`Port ${PORT} cannot be opened: permission denied.`);
      console.error(`Ports below 1024 need privileges; pick a higher one.`);
      process.exit(1);
    }
    throw e;   /* Ce qu'on ne sait pas nommer garde sa trace : elle est la seule information. */
  });
  serveur.listen(PORT, "127.0.0.1", () => {
    console.log(`Where should the next dollar go → http://localhost:${PORT}`);
  });
}
