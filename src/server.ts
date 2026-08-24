/**
 * L'écran, servi depuis les sources.
 *
 * Le profil des paliers est mesuré une fois — deux minutes de modèles téléchargés — et
 * figé dans `data/profiles.json`. Tout le reste se calcule à partir de lui : le routage
 * du lecteur, le routage optimal, ce que chacun coûte. Rien ici ne relance un modèle, et
 * c'est ce qui rend la démo publiable.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
    let brut = "";
    /* REJETER NE COUPE PAS LE FLUX. La promesse est réglée, mais `data` continue de se
       déclencher et `brut` continue de grossir : la borne annonçait un plafond qu'elle
       n'imposait pas. On détruit la socket, seul geste qui arrête réellement l'envoi. */
    req.on("data", (b) => {
      brut += b;
      if (brut.length > PLAFOND_CORPS) { req.destroy(); rejeter(new Error(`request too large (> ${PLAFOND_CORPS} octets)`)); }
    });
    req.on("end", () => {
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

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const adresse = req.socket.remoteAddress ?? "inconnue";
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
    if (req.method === "POST") {
      const etrangere = origineEtrangere(req);
      if (etrangere !== null) {
        return json(res, {
          erreur: `write refused: this request comes from ${etrangere}, not from this screen. `
            + `Listening on the loopback protects against the network, not against the browser — `
            + `a page open in another tab can post here with nothing to show for it.`,
        }, 403);
      }
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(fileURLToPath(new URL("./ui.html", import.meta.url)), "utf8"));
      return;
    }
    for (const [chemin, type] of [["/graphes.js", "text/javascript"], ["/registre.css", "text/css"]] as const) {
      if (url.pathname === chemin) {
        res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
        res.end(readFileSync(fileURLToPath(new URL("." + chemin, import.meta.url)), "utf8"));
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
    json(res, { erreur: String((e as Error).message ?? e) }, 400);
  }
});

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
