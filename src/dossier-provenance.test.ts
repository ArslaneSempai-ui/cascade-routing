/*
 * DEUX FOIS LA MÊME GRANDEUR, DEUX SOURCES — ET UN CHIFFRE QUE PERSONNE NE PEUT VÉRIFIER.
 *
 * `VALIDATION.md` est engendré. Deux défauts y vivaient côte à côte, tous deux invisibles
 * tant que rien ne bougeait :
 *
 *   · le montant « for the whole routing » s'écrivait `${Math.round(191)}` — un littéral
 *     enveloppé dans un arrondi, posé entre deux montants réellement dérivés, ce qui lui
 *     donnait leur allure. Vingt lignes plus bas, la MÊME grandeur s'écrivait
 *     `${euro(s.cost)}`, dérivée du relevé. Les deux rendaient `$191`. Le jour où `s.cost`
 *     bouge, une ligne suit, l'autre reste, et `dossier.ts --check` fige la contradiction
 *     comme référence — c'est un mensonge à retardement, pas une coquille.
 *
 *   · deux latences étaient tapées à la main avec un commentaire « mesuré sur l'OFAC ».
 *     Un commentaire n'est pas une provenance : rien ne le relie à un relevé, et rien ne
 *     tombe s'il devient faux. Le relevé scellé livré ici porte 18–22 ms et 43–48 ms ;
 *     aucune des deux valeurs tapées n'y correspond.
 *
 * Ces cas éprouvent la STRUCTURE, pas les valeurs : déplacer un montant publié est une
 * décision commerciale, et elle ne se prend pas dans un correctif.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dossier } from "./dossier.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS } from "./assumptions.ts";

/*
 * SANS LES COMMENTAIRES — et ce cas me l'a appris en tombant.
 *
 * Ma première version cherchait `Math.round(<littéral>)` dans le fichier entier. Elle a
 * rougi sur le commentaire que je venais d'écrire pour EXPLIQUER le défaut, qui le cite
 * verbatim. Accuser une citation, c'est accuser le témoin d'être ce qu'il éprouve.
 */
const source = () =>
  readFileSync(fileURLToPath(new URL("./dossier.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/.*$/gm, " ");

/** Le montant qui suit un `$`, dans la phrase demandée. */
function montant(texte: string, apres: RegExp): string | null {
  const l = texte.split("\n").find((x) => apres.test(x));
  return l ? (l.match(/\$[\d  ,.]+/)?.[0].trim() ?? null) : null;
}

test("les deux montants du routage viennent de la même source", () => {
  const texte = dossier(readProfiles()!, ASSUMPTIONS);

  const ici = montant(texte, /for the whole routing/);
  const la = montant(texte, /^Overall:/);

  /* Témoin de non-vacuité : comparer deux absents passerait sans rien garder. */
  assert.ok(ici, "la phrase « for the whole routing » a disparu : ce cas ne garde plus rien.");
  assert.ok(la, "la ligne « Overall: » a disparu : ce cas ne garde plus rien.");

  assert.equal(ici, la,
    `le même montant s'écrit « ${ici} » à un endroit et « ${la} » à l'autre.\n`
    + "  Une grandeur publiée depuis deux sources diverge le jour où l'une des deux bouge,\n"
    + "  et `--check` fige alors la contradiction comme référence.");
});

test("aucun littéral ne se déguise en calcul pour ce montant", () => {
  const src = source();
  assert.ok(!/Math\.round\(\s*\d+\s*\)/.test(src),
    "`Math.round(<littéral>)` est de retour : un nombre tapé qui prend l'allure d'un calcul\n"
    + "  parce qu'il est posé à côté de vrais calculs. C'est le défaut d'origine.");
  assert.match(src, /for the whole routing\.`\)/,
    "la phrase visée n'existe plus sous cette forme : ce cas ne garde plus ce qu'il croit.");
});

test("une latence non dérivable porte sa provenance dans le code, et la dit au lecteur", () => {
  const src = source();

  /* La provenance est une DONNÉE — datée, nommée, et marquée non dérivable — et non un
     commentaire à côté du chiffre. Un commentaire ne tombe jamais. */
  assert.match(src, /derivableIci:\s*false/,
    "la marque « non dérivable ici » a disparu : un chiffre qu'aucun relevé du dépôt ne\n"
    + "  porte redeviendrait indiscernable d'un chiffre mesuré.");
  assert.match(src, /corpusAbsent:\s*"[^"]+"/,
    "ce qui MANQUE pour re-dériver doit être nommé : « non dérivable » seul ne dit pas quoi faire,\n"
    + "  et une hypothèse gelée dont personne ne sait ce qui la dégèlerait est une hypothèse\n"
    + "  abandonnée.");
  assert.match(src, /geleeLe:\s*"\d{4}-\d{2}-\d{2}"/, "et la date du gel, pas celle d'une mesure.");

  /* Le commentaire qui affirmait une mesure ne doit pas revenir : c'était lui, le mensonge. */
  assert.ok(!/\/\*[^*]*mesuré sur l'OFAC[^*]*\*\//.test(
    readFileSync(fileURLToPath(new URL("./dossier.ts", import.meta.url)), "utf8")
      .replace(/\/\*\*[\s\S]*?\*\//g, " ")),
    "« mesuré sur l'OFAC » est de retour à côté du chiffre : une affirmation de mesure que\n"
    + "  rien dans le dépôt ne soutient.");

  /* Et la réserve VOYAGE : une réserve qui reste dans le code n'existe pas pour le lecteur. */
  const texte = dossier(readProfiles()!, ASSUMPTIONS);
  assert.match(texte, /not re-measurable from this repository/,
    "le document ne dit plus au lecteur lesquels de ses chiffres il ne peut pas vérifier.");
  assert.match(texte, /frozen assumption, not a measurement/,
    "le document doit dire que c'est une hypothèse GELÉE, pas une mesure — c'est la\n"
    + "  différence exacte entre montrer la limite et la laisser découvrir.");
});
