/*
 * LES QUATRE SORTIES DE `poids`, DEPUIS LA COMMANDE ET NON DEPUIS LA FONCTION.
 *
 * `poids.test.ts` éprouve déjà `exporter` et `importer` en fonctions, et bien : refus d'un
 * octet retourné, refus d'une révision étrangère, rien d'écrit quand un grief est trouvé. Le
 * balayage a montré que les quatre `process.exit` de la commande, eux, n'étaient atteints par
 * aucun cas — c'est la distinction qu'on paie toute la journée : **une fonction couverte ne
 * dit rien de son point d'appel.**
 *
 * Le dernier le montre en clair. `importer()` lève sur un dossier sans manifeste, et un cas
 * l'éprouve. Mais rien ne vérifiait que la COMMANDE traduise cette levée en un code non nul :
 * un `catch` qui imprime et sort en 0 aurait laissé les six cas de `poids.test.ts` verts, et
 * une chaîne aurait lu « import réussi » sur un dossier que rien n'a vérifié.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";

const CMD = fileURLToPath(new URL("./poids.ts", import.meta.url));

test("--export sans dossier est refusé, et le refus nomme l'option", () => {
  exigerRefus(lancer([CMD, "--export"]), /--export needs a directory/,
    "une option qui attend un dossier et n'en reçoit pas doit être refusée");
  /* Et le dossier suivant ne doit pas être avalé s'il commence par `--` : sinon
     `--export --import x` prendrait `--import` pour un chemin et écrirait dedans. */
  exigerRefus(lancer([CMD, "--export", "--import"]), /--export needs a directory/,
    "une option a été prise pour un chemin : la commande écrirait dans un dossier nommé --import");
});

test("une option inconnue est refusée, et les options connues sont dites", () => {
  const r = lancer([CMD, "--exprot", "/tmp/x"]);
  exigerRefus(r, /Unknown option --exprot/, "une option mal tapée doit être refusée");
  assert.match(r.texte, /--export <dir>/,
    "le refus ne dit pas quelles options existent : il envoie chercher au lieu de renseigner.");
});

test("--export et --import ensemble sont refusés : ce sont deux machines", () => {
  const d = mkdtempSync(join(tmpdir(), "poids-"));
  exigerRefus(lancer([CMD, "--export", d, "--import", d]), /two different machines/,
    "les deux sens à la fois doivent être refusés");
});

test("un dossier sans manifeste fait sortir la COMMANDE en erreur, pas seulement lever", () => {
  /* Le point d'appel, pas la fonction. `importer()` lève — un cas le prouve déjà. Ici on exige
     que la commande le TRADUISE : sans ça, une chaîne lit « import réussi » sur un dossier que
     rien n'a vérifié, et place dans le cache des poids dont personne n'a comparé l'empreinte. */
  const d = mkdtempSync(join(tmpdir(), "poids-vide-"));
  writeFileSync(join(d, "un-fichier.bin"), "pas un manifeste");
  const r = lancer([CMD, "--import", d]);
  assert.notEqual(r.code, 0,
    "la commande a RÉUSSI sur un dossier sans manifeste : une chaîne conclurait que les poids\n"
    + "  sont vérifiés et placés, alors que rien n'a été comparé.");
  /* Le nom du manifeste est écrit tel qu'il existe, `cascade-weights.json`, et non deviné :
     ma première version cherchait « manifeste » et le refus disait le vrai nom du fichier. Un
     motif de recherche est une affirmation, et celui-là affirmait un mot que le code n'emploie
     pas — le cas aurait dénoncé un refus parfaitement clair. */
  assert.match(r.texte, /No cascade-weights\.json in/,
    `le refus ne nomme pas le fichier qui manque : ${JSON.stringify(r.texte.slice(0, 200))}`);
  assert.match(r.texte, /not a weights export/,
    "le refus ne dit pas ce que ce dossier N'EST PAS : sans ça on cherche une corruption.");
});
