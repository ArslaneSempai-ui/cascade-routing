/*
 * DEUX CONSTRUCTEURS D'ÉTAT ALIMENTENT LE MÊME ÉCRAN, ET RIEN NE LES TENAIT ENSEMBLE.
 *
 * `server.ts` construit l'état de la démonstration qui tourne ; `pages.ts` construit celui
 * de la page publiée. Le même `ui.html` les lit. L'en-tête de ce fichier le dit depuis
 * longtemps — dès que les deux divergent, un correctif porté sur l'un laisse l'autre écran
 * mentir — mais la phrase était une intention, pas une garde.
 *
 * Elle a été payée le 26 août 2026 : la légende de la figure de routage a cessé de taper
 * « 120 » pour dériver ses tailles d'échantillon de `etat.echantillons`. La clé a été ajoutée
 * dans `pages.ts` et pas dans `server.ts` — la page publiée disait vrai, l'écran local
 * annonçait qu'il ne connaissait pas ses tailles. Deux sessions, deux fichiers, une clé.
 *
 * Ce cas ne compare pas des valeurs : les deux états n'ont aucune raison de porter les mêmes
 * chiffres. Il compare la FORME, qui est ce que `ui.html` suppose.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Les clés de l'objet rendu par la fonction qui suit `ancre`, commentaires retirés. */
function clesDuRetour(fichier: string, ancre: string): string[] {
  const src = readFileSync(fileURLToPath(new URL(`./${fichier}`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/.*$/gm, " ");
  const i = src.indexOf(ancre);
  assert.ok(i >= 0, `« ${ancre} » n'existe plus dans ${fichier} : ce cas ne garde plus rien.`);
  const j = src.indexOf("return {", i);
  assert.ok(j >= 0, `${fichier} : « ${ancre} » ne rend plus un objet littéral.`);

  const cles: string[] = [];
  let profondeur = 0;
  for (let k = j + "return ".length; k < src.length; k++) {
    const c = src[k]!;
    if (c === "{" || c === "[" || c === "(") { profondeur++; continue; }
    if (c === "}" || c === "]" || c === ")") { profondeur--; if (profondeur === 0) break; continue; }
    if (profondeur !== 1 || !/[A-Za-z_]/.test(c)) continue;
    /* Une CLÉ est précédée de `{` ou `,` : sans ça, les noms des valeurs entrent aussi. */
    const avant = src.slice(0, k).replace(/\s+$/, "").slice(-1);
    if (avant !== "{" && avant !== ",") continue;
    const m = src.slice(k).match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/);
    if (m) { cles.push(m[1]!); k += m[0].length - 1; }
  }
  return cles;
}

test("les deux états que ui.html lit portent les mêmes clés", () => {
  const local = clesDuRetour("server.ts", "function calculerEtat");
  const publie = clesDuRetour("pages.ts", "const etat = () =>");

  /* Non-vacuité : deux listes vides sont égales, et ne gardent rien. */
  assert.ok(local.length >= 10,
    `l'état local ne rend plus que ${local.length} clés : c'est l'extraction qui est cassée.`);

  assert.deepEqual([...local].sort(), [...publie].sort(),
    "l'état de la démonstration et celui de la page publiée n'ont plus la même forme.\n"
    + `  local seulement : ${local.filter((c) => !publie.includes(c)).join(", ") || "—"}\n`
    + `  publié seulement : ${publie.filter((c) => !local.includes(c)).join(", ") || "—"}\n`
    + "  `ui.html` lit les deux : une clé qui manque d'un côté fait mentir cet écran-là, en\n"
    + "  silence, jusqu'à ce que quelqu'un compare les deux pages.");
});

test("la clé que la légende de routage exige est dans les deux", () => {
  /*
   * Le cas ci-dessus tomberait aussi si les deux perdaient la clé ENSEMBLE. C'est le défaut
   * d'origine — une légende qui tape son dénominateur — et il vaut son propre refus.
   */
  for (const [fichier, ancre] of [
    ["server.ts", "function calculerEtat"], ["pages.ts", "const etat = () =>"],
  ] as const) {
    assert.ok(clesDuRetour(fichier, ancre).includes("echantillons"),
      `${fichier} ne porte plus « echantillons » : la légende de la figure de routage n'a plus\n`
      + "  de quoi dériver ses tailles d'échantillon, et elle en taperait une — sept paliers\n"
      + "  n'ont pas le même dénominateur, et celui du plus petit élargit l'intervalle des\n"
      + "  autres d'un facteur trois.");
  }
});
