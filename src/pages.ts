/**
 * LA DÉMO PUBLIÉE.
 *
 * Le même `ui.html` sert ici et en local : ce qui change est un shim qui répond aux mêmes
 * routes avec les mêmes formes. Deux écrans divergeraient au premier correctif.
 *
 * Ce que le shim ne fait pas : mesurer. Le profil des paliers coûte deux minutes de
 * modèles téléchargés, il est mesuré une fois et figé dans `data/profiles.json` ; la page
 * l'emporte tel quel. Un visiteur ne relance donc aucun modèle — il rejoue l'arithmétique
 * sur des mesures datées, et la page le dit.
 *
 * Pas d'accent grave dans le shim : il vit dans un gabarit, et un seul le referme au
 * milieu. Concaténation avec `+`, et les commentaires citent le code sans le baliser.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const PROFILS = readFileSync(root + "data/profiles.json", "utf8").trim();

const SHIM = `<script>window.LOCAL_PRET = new Promise((r) => { window.LOCAL_POSE = r; });</` + `script>
<script type="module">
import { FIELDS } from "./js/corpus.js";
import { TIERS } from "./js/paliers.js";
import { evaluer, optimiseExtraction, budgetShadowPrice, latenceRepresentative } from "./js/optimise.js";
import { ASSUMPTIONS, BOUNDS, pricePerThousandExtractions, accuracy } from "./js/assumptions.js";

/* Le profil mesuré, embarqué tel quel : la page ne mesure rien, elle rejoue. */
const profils = ${PROFILS};

let hypotheses = { ...ASSUMPTIONS };
let routage = Object.fromEntries(FIELDS.map((c) => [c, "large"]));

const etat = () => {
  const optimum = optimiseExtraction(profils, hypotheses);
  const mien = evaluer(profils, hypotheses, routage);
  return {
    champs: FIELDS,
    paliers: TIERS,
    routage,
    justesse: Object.fromEntries(FIELDS.map((c) => [
      c, Object.fromEntries(TIERS.map((e) => [e, accuracy(e, profils.extraction[e][c].accuracy, hypotheses)])),
    ])),
    prix: Object.fromEntries(TIERS.map((e) => [e, pricePerThousandExtractions(e, hypotheses, latenceRepresentative(profils, e))])),
    mien,
    optimum,
    uniformes: TIERS.map((e) => ({
      palier: e,
      ...evaluer(profils, hypotheses, Object.fromEntries(FIELDS.map((c) => [c, e]))),
    })),
    prochainGain: budgetShadowPrice(profils, hypotheses),
    hypotheses,
    bornes: BOUNDS,
    mesureLe: profils.measuredAt,
  };
};

window.LOCAL = async (chemin, corps) => {
  if (chemin === "/api/etat") return etat();
  if (chemin === "/api/routage") {
    const champ = String(corps.champ || ""), palier = String(corps.palier || "");
    if (FIELDS.includes(champ) && TIERS.includes(palier)) routage = { ...routage, [champ]: palier };
    return etat();
  }
  if (chemin === "/api/optimum") {
    const o = optimiseExtraction(profils, hypotheses);
    if (o) routage = { ...o.routing };
    return etat();
  }
  if (chemin === "/api/hypotheses") {
    if (corps.remise) hypotheses = { ...ASSUMPTIONS };
    else for (const [cle, bornes] of Object.entries(BOUNDS)) {
      /* MEME GARDE QUE DANS LE SERVEUR, ET C EST LE POINT : la demo publiee portait la faute
         mot pour mot, donc corriger un seul des deux la laisse la ou l acheteur regarde.
         Ce commentaire est ecrit sans accent grave et sans apostrophe : il vit DANS un
         gabarit, et un accent grave le fermerait. Quatrieme fois aujourd hui dans l equipe
         qu une insertion casse un gabarit ; la premiere pour moi, apres l avoir signalee
         deux fois aux autres. */
      const v = corps[cle];
      if (typeof v === "number" && Number.isFinite(v)) hypotheses = { ...hypotheses, [cle]: Math.min(bornes[1], Math.max(bornes[0], v)) };
    }
    return etat();
  }
  return {};
};

/* Le shim est en place : l'écran peut partir. */
window.LOCAL_POSE && window.LOCAL_POSE();
` + "</" + "script>\n";

const BANNIERE = `<p class="renvoi" style="margin-bottom:1.5rem">
This runs entirely in your browser — no server, nothing uploaded, and no model is called:
the accuracy of each tier was <b>measured once on held-out records</b> and frozen.
<b>Take a cell</b> to send a field to another tier and read what your routing costs.
<a href="https://github.com/ArslaneSempai-ui/cascade-routing">Source and method</a>.
</p>`;

export function construire(): void {
  const docs = root + "docs";
  mkdirSync(docs, { recursive: true });

  let html = readFileSync(root + "src/ui.html", "utf8");
  /* Les chemins absolus valent pour un serveur à la racine ; la page publiée vit sous
   * `/cascade-routing/`, donc tout devient relatif. */
  html = html.replace('href="/registre.css"', 'href="registre.css"');
  html = html.replace('from "/graphes.js"', 'from "./graphes.js"');
  html = html.replace('<script type="module">', SHIM + '<script type="module">');
  html = html.replace("<main>", "<main>\n" + BANNIERE);

  writeFileSync(docs + "/index.html", html);
  cpSync(root + "src/graphes.js", docs + "/graphes.js");
  cpSync(root + "src/registre.css", docs + "/registre.css");
  writeFileSync(docs + "/.nojekyll", "");
  console.log("docs/ built");
}

if (isMain(import.meta)) construire();
