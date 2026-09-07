import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * THE README WITHOUT AN EM DASH (Arslane, 12/09/2026).
 *
 * The house rule is « never an em dash » : the site's assembler and its pre-push hook refuse
 * one, the tool's outputs lost theirs on 11/09, and the README followed on 12/09 : 134 lines
 * rewritten, by hand in README.md for the prose and in src/readme.ts for the generated blocks.
 * A rule that lives in a memory comes back the day someone types a dash into a block string ;
 * a rule that lives here refuses the commit. So this case reads the page a buyer reads, not
 * the generator : whatever the source of a dash (README.md, readme.ts, inventory.ts, a shared
 * file), it lands in the same file.
 *
 * Two kinds of lines are NOT prose of this repository's own hand and stay outside the rule :
 *   - the block that prints DATA verbatim : the gallery (documents the model read, quoted as
 *     they were ; a dash inside a simulated document is the document's) ;
 *   - the lines emitted by a file SHARED across the portfolio (interval.ts, provenance.ts,
 *     regulations.ts) : a change there is made in identite, diffused, then committed in every
 *     repository that carries the copy, because a test refuses a copy behind its source. They
 *     are corrected by that pass, at the source, not here. Each is named below so that the day
 *     it goes, this list has to shrink : an allow-list that nobody has to maintain is a hole.
 * The witness case at the end proves the guard looks : a dash planted in the prose must be
 * seen, or the green above means nothing.
 */
const README = fileURLToPath(new URL("../README.md", import.meta.url));

/** Blocks whose text is data quoted verbatim, not this repository's prose. The retractations
 *  journal left this list on 12/09 : its punctuation was corrected, entry by entry, meaning and
 *  dates intact, so the guard now reads it like any other block. */
const BLOCS_DE_DONNEES = ["gallery"];

/** The lines still allowed to carry a dash, each with the pass that removes it. Emptied on 12/09 :
 *  the shared layer (interval.ts, provenance.ts, regulations.ts) lost its dashes at the source in
 *  identite and was copied here by hand ; nothing is allowed any more. */
const PERMIS: string[] = [];

/** The README with the data blocks blanked, line numbers preserved. */
function proseSeule(texte: string): string[] {
  const lignes = texte.split("\n");
  const vus = new Set<string>();
  let dans: string | null = null;
  return lignes.map((l) => {
    const ouvre = /^<!-- figures:(\w+) -->$/.exec(l);
    if (ouvre && BLOCS_DE_DONNEES.includes(ouvre[1]!)) { dans = ouvre[1]!; vus.add(dans); return ""; }
    if (dans && l === `<!-- /figures:${dans} -->`) { dans = null; return ""; }
    return dans ? "" : l;
  }).concat(BLOCS_DE_DONNEES.filter((b) => !vus.has(b)).map((b) => `BLOC ABSENT : ${b}`));
}

function fautifs(lignes: string[]): string[] {
  return lignes
    .map((l, i) => [i + 1, l] as const)
    .filter(([, l]) => l.includes("—") && !PERMIS.some((p) => l.includes(p)))
    .map(([n, l]) => `README.md:${n}  ${l.trim().slice(0, 90)}`);
}

test("le README ne porte aucun cadratin hors des blocs de données", () => {
  const lignes = proseSeule(readFileSync(README, "utf8"));
  assert.deepEqual(lignes.filter((l) => l.startsWith("BLOC ABSENT")), [],
    "un bloc de données a disparu du README : l'exclusion ne s'applique plus à rien, vérifier readme.ts.");
  for (const p of PERMIS) {
    assert.ok(lignes.some((l) => l.includes(p)),
      `« ${p} » n'est plus dans le README : le permis est périmé, retirer l'entrée de PERMIS.`);
  }
  assert.deepEqual(fautifs(lignes), [],
    "un cadratin est revenu dans le README. Prose : corriger README.md ; bloc engendré : corriger la\n"
    + "  chaîne dans src/readme.ts (ou le fichier PARTAGÉ, dans identite) puis `npm run figures`.");
});

test("témoin : un cadratin glissé dans la prose est vu", () => {
  const avec = readFileSync(README, "utf8") + "\nA planted line — the guard must name it.\n";
  const vus = fautifs(proseSeule(avec));
  assert.equal(vus.length, 1, `le témoin n'est pas vu (${vus.length} fautif(s)) : la garde ne regarde pas.`);
  assert.match(vus[0]!, /A planted line/);
});
