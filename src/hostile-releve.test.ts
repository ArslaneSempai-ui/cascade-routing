import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { page, type Releve } from "./hostile.ts";

/*
 * LES TÉMOINS DU RELEVÉ.
 *
 * Séparés des témoins unitaires parce qu'ils lisent `corpus-hostile.json`, qui ne peut pas
 * exister avant le code qui le produit : la mesure exige un arbre propre, donc un commit.
 * Ce fichier arrive avec le relevé, dans le commit suivant.
 */

const RELEVE = fileURLToPath(new URL("../corpus-hostile.json", import.meta.url));
const PAGE = fileURLToPath(new URL("../CORPUS-HOSTILE.md", import.meta.url));

test("la page est engendrée du relevé, et le relevé dit quand il a été mesuré", () => {
  assert.ok(existsSync(RELEVE),
    "corpus-hostile.json est absent : lance `npm run hostile`. Ce cas ne doit pas être "
    + "assoupli — une page sans relevé est de la prose non mesurée.");
  const r = JSON.parse(readFileSync(RELEVE, "utf8")) as Releve;
  assert.match(r.mesureLe, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(r.code.commit, /^[0-9a-f]{7,}$/);
  assert.equal(r.code.sale, false, "un relevé pris sur un arbre modifié porte une fausse provenance.");
  assert.equal(readFileSync(PAGE, "utf8"), page(r),
    "CORPUS-HOSTILE.md ne correspond plus au relevé : relance `npm run hostile`.");
});

test("la comparaison peut échouer — la page suit vraiment les chiffres", () => {
  /*
   * LE VERT VIDE ÉVITÉ. Le cas précédent passerait aussi si `page()` rendait une constante.
   * Ici on bouge un résultat et on EXIGE que la page bouge.
   */
  const r = JSON.parse(readFileSync(RELEVE, "utf8")) as Releve;
  const avant = page(r);
  const cible = r.resultats.find((x) => !x.detourne);
  assert.ok(cible, "aucun résultat non détourné : ce cas ne peut plus rien muter.");
  cible.detourne = true;
  assert.notEqual(page(r), avant,
    "la page n'a pas bougé alors qu'un détournement a été ajouté : elle ne lit pas le relevé.");
});

test("la commande refuse un drapeau inconnu, et --check vérifie la page", { timeout: 120_000 }, () => {
  const cmd = fileURLToPath(new URL("./hostile.ts", import.meta.url));
  const inconnu = spawnSync("node", [cmd, "--tous"], { encoding: "utf8", timeout: 100_000 });
  assert.equal(inconnu.status, 2,
    `un drapeau inconnu doit être refusé, pas ignoré. Sortie :\n${inconnu.stderr?.slice(0, 400)}`);
  const check = spawnSync("node", [cmd, "--check"], { encoding: "utf8", timeout: 100_000 });
  assert.equal(check.status, 0,
    `\`--check\` échoue. Sortie :\n${(check.stdout ?? "") + (check.stderr ?? "")}`);
});
