/**
 * Poser le scellé sur un relevé de mesures.
 *
 *   npm run sceller             — data/profiles.json
 *   npm run sceller -- <fichier>
 *
 * `readProfiles()` refuse un relevé dont l'empreinte ne correspond pas à son contenu, et
 * refuse aussi un relevé qui n'en porte pas. Ce refus doit avoir une issue : sans elle, la
 * première personne qui le rencontre commente la vérification, et le scellé n'aura servi
 * qu'à retarder d'une heure ce qu'il devait empêcher.
 *
 * CE QUE POSER UN SCELLÉ VEUT DIRE, ET IL FAUT QUE CE SOIT DÉSAGRÉABLE À LIRE : vous
 * déclarez que le contenu actuel du fichier est celui qui doit faire foi. L'empreinte
 * prouvera qu'il n'a pas bougé APRÈS. Elle ne dit rien de ce qui s'est passé avant, et elle
 * ne transforme pas un chiffre tapé à la main en mesure. Le seul geste qui produit une
 * mesure est `npm run measure`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { empreinteDuReleve } from "./measure.ts";
import { fileURLToPath } from "node:url";

const cible = process.argv[2] ?? fileURLToPath(new URL("../data/profiles.json", import.meta.url));
if (!existsSync(cible)) {
  console.error(`  ${cible} n'existe pas. Rien à sceller.`);
  process.exit(2);
}

const brut = JSON.parse(readFileSync(cible, "utf8")) as Record<string, unknown>;
const avant = typeof brut.empreinte === "string" ? brut.empreinte : null;
const apres = empreinteDuReleve(brut);

if (avant === apres) {
  console.log(`  ${cible}\n  déjà scellé, et le scellé correspond : ${apres}. Rien à faire.`);
  process.exit(0);
}

brut.empreinte = apres;
writeFileSync(cible, JSON.stringify(brut, null, 2));
console.log(`  ${cible}`);
console.log(avant
  ? `  scellé REMPLACÉ : ${avant} → ${apres}\n  Le contenu avait changé depuis le dernier scellé. Vous venez de déclarer que le\n  contenu actuel fait foi.`
  : `  scellé posé : ${apres}\n  Ce fichier n'en portait pas. L'empreinte prouve désormais qu'il ne bouge plus ;\n  elle ne dit rien de ce qu'il contenait avant aujourd'hui.`);
