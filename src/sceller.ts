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
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { isMain } from "./cli.ts";
import { empreinteDuReleve } from "./measure.ts";
import { fileURLToPath } from "node:url";

/*
 * AGIR À L'IMPORT EST UN EFFET DE BORD QUE PERSONNE N'A DEMANDÉ.
 *
 * Ce fichier scellait au niveau du module : l'importer lançait la commande, et un test qui
 * voudrait éprouver son refus sur un dossier ne pouvait pas le charger sans le déclencher.
 *
 * `isMain` de `cli.ts` compare `import.meta.filename` à `process.argv[1]`, jamais une
 * concaténation `"file://" + argv[1]` — celle-ci échoue sur un chemin espacé ou accentué, et
 * son échec est un silence à code 0, ce qui se lit comme un succès.
 */
if (isMain(import.meta)) {
  const cible = process.argv[2] ?? fileURLToPath(new URL("../data/profiles.json", import.meta.url));
  if (!existsSync(cible)) {
    console.error(`  ${cible} does not exist. There is nothing to seal.`);
    process.exit(2);
  }
  /*
   * EXISTER N'EST PAS ÊTRE LISIBLE.
   *
   * La garde ci-dessus demandait « le chemin est-il là ». Un dossier répond oui, puis
   * `readFileSync` lève `EISDIR` et l'acheteur reçoit le vidage de pile de Node — dont la
   * première ligne parle de `binding.readFileUtf8`. Trouvé en passant un dossier là où un
   * fichier est attendu : le chemin traverse une garde qui ne pose pas la bonne question.
   */
  if (!statSync(cible).isFile()) {
    console.error(`  ${cible} is a directory, not a file. There is nothing to seal in it.`);
    console.error(`  Point this at the record itself, for example data/profiles.json.`);
    process.exit(2);
  }

  const brut = JSON.parse(readFileSync(cible, "utf8")) as Record<string, unknown>;
  const avant = typeof brut.empreinte === "string" ? brut.empreinte : null;
  const apres = empreinteDuReleve(brut);

  if (avant === apres) {
    console.log(`  ${cible}\n  already sealed, and the seal matches: ${apres}. Nothing to do.`);
    process.exit(0);
  }

  brut.empreinte = apres;
  writeFileSync(cible, JSON.stringify(brut, null, 2));
  console.log(`  ${cible}`);
  console.log(avant
    ? `  seal REPLACED: ${avant} → ${apres}\n  The content had changed since the last seal. You have just declared that the\n  current content is the one that stands.`
    : `  seal placed: ${apres}\n  This file carried none. The fingerprint now proves it does not move any more;\n  it says nothing about what it held before today.`);

}
