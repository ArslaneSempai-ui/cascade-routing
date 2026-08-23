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
if (!profilsLus) throw new Error("aucun profil mesuré — lancer `npm run measure` d'abord");
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

function corps(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resoudre, rejeter) => {
    let brut = "";
    req.on("data", (b) => { brut += b; if (brut.length > 50_000) rejeter(new Error("request too large")); });
    req.on("end", () => { try { resoudre(brut ? JSON.parse(brut) : {}); } catch (e) { rejeter(e); } });
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

export function etat() {
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
  const attendues = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
  return attendues.includes(o) ? null : o;
}

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "POST") {
      const etrangere = origineEtrangere(req);
      if (etrangere !== null) {
        return json(res, {
          erreur: `écriture refusée : la requête vient de ${etrangere}, pas de cet écran. `
            + `Écouter la boucle locale protège du réseau, pas du navigateur — une page ouverte `
            + `dans un autre onglet peut poster ici sans que rien ne le montre.`,
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
      const champ = String(recu.champ ?? "");
      const palier = String(recu.palier ?? "") as TierName;
      if (FIELDS.includes(champ as never) && TIERS.includes(palier)) {
        routage = { ...routage, [champ]: palier };
      }
      return json(res, etat());
    }

    if (url.pathname === "/api/optimum" && req.method === "POST") {
      const o = optimiseExtraction(profils, hypotheses);
      if (o) routage = { ...o.routing };
      return json(res, etat());
    }

    if (url.pathname === "/api/hypotheses" && req.method === "POST") {
      const recu = await corps(req);
      const r = appliquerHypotheses(recu as Record<string, unknown>, hypotheses);
      if (r.refuses.length) {
        return json(res, {
          erreur: `valeur(s) non numérique(s) refusée(s) : ${r.refuses.join(", ")}. `
            + `Une hypothèse absente n'est pas une hypothèse à zéro : elle serait posée sur `
            + `sa borne basse et le routage affiché serait calculé dessus.`,
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
  serveur.listen(PORT, "127.0.0.1", () => {
    console.log(`Where should the next dollar go → http://localhost:${PORT}`);
  });
}
