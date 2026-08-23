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

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
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
      if (recu.remise) hypotheses = { ...ASSUMPTIONS };
      else {
        for (const [cle, [bas, haut]] of Object.entries(BOUNDS)) {
          const v = Number(recu[cle]);
          if (Number.isFinite(v)) {
            hypotheses = { ...hypotheses, [cle]: Math.min(haut, Math.max(bas, v)) };
          }
        }
      }
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
