/*
 * QUATRE ANALYSES SE SERVAIENT DU DERNIER JOURNAL SANS JAMAIS REGARDER S'IL ÉTAIT FINI.
 *
 * `lireJournal` calcule déjà `complet` — la ligne `fin` est-elle là — et `tronquees` —
 * combien de lignes n'ont pas pu être relues. Mesuré le 27 août 2026 : `escalade`,
 * `abstention`, `signal` et les trois lectures de `landing` prenaient `{ tentatives }` et
 * jetaient le reste. Une passe tuée au milieu alimentait donc quatre analyses, dont celle qui
 * écrit un document publié.
 *
 * `src/tentatives.ts` les lisait, lui. La garde existait à UN endroit et manquait aux six
 * autres — une garde qu'on trouve recopiée quelque part signale l'endroit où elle manque.
 *
 * Ce qui est perdu n'est pas un échantillon au hasard : c'est la FIN de la passe, donc les cas
 * les plus lents, ou celui qui l'a fait tomber.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { lireJournalEprouve, lireJournal } from "./journal.ts";

const ligne = (o: unknown) => JSON.stringify(o) + "\n";
const tentative = (i: number) =>
  ligne({ kind: "t", run: "R", tier: "gen-4b", caseId: `c${i}`, field: "name", value: "x", ms: 1, outcome: "ok" });

function journal(corps: string): string {
  const d = mkdtempSync(join(tmpdir(), "journal-"));
  const f = join(d, "2026-08-27T00-00-00-000Z-dur.jsonl");
  writeFileSync(f, corps);
  return f;
}

test("un journal fini passe, et rend ses tentatives", () => {
  const f = journal(ligne({ kind: "run", run: "R" }) + tentative(1) + tentative(2) + ligne({ kind: "fin" }));
  try {
    const j = lireJournalEprouve(f, "npm run dur");
    assert.equal(j.tentatives.length, 2,
      "témoin positif : un journal complet doit traverser, sinon la garde interdit l'usage normal.");
  } finally { rmSync(join(f, ".."), { recursive: true, force: true }); }
});

test("une passe interrompue est REFUSÉE, pas lue comme un échantillon plus court", () => {
  /* Pas de ligne `fin` : exactement ce que laisse une passe tuée. */
  const f = journal(ligne({ kind: "run", run: "R" }) + tentative(1) + tentative(2));
  try {
    assert.throws(() => lireJournalEprouve(f, "npm run dur"), /not a finished journal/,
      "un journal sans ligne `fin` est lu comme s'il était complet. Les tentatives qui manquent\n"
      + "  sont les DERNIÈRES, donc les plus lentes ou celle qui a fait tomber la passe.");
    assert.throws(() => lireJournalEprouve(f, "npm run dur"), /npm run dur/,
      "le refus ne dit pas quoi relancer : un refus sans issue se fait commenter.");
    /* Et il doit dire COMBIEN il a vu : « pas fini » sans quantité ne se juge pas. */
    assert.throws(() => lireJournalEprouve(f, "npm run dur"), /2 attempt/,
      "le refus ne dit pas ce que le journal portait quand même.");
  } finally { rmSync(join(f, ".."), { recursive: true, force: true }); }
});

test("une ligne coupée en deux est REFUSÉE, même si la passe s'est terminée", () => {
  /* Le cas réel : le processus meurt pendant une écriture, puis une autre passe ajoute `fin`. */
  const f = journal(ligne({ kind: "run", run: "R" }) + tentative(1) + '{"kind":"t","run":"R","ca\n' + ligne({ kind: "fin" }));
  try {
    const brut = lireJournal(f);
    assert.equal(brut.tronquees, 1, "le témoin est mal construit : la ligne coupée doit être comptée.");
    assert.equal(brut.complet, true, "le témoin est mal construit : la ligne `fin` doit être là.");
    assert.throws(() => lireJournalEprouve(f, "npm run dur"), /not be read back/,
      "une ligne illisible passe sous silence dès que la ligne `fin` est là. Les deux causes\n"
      + "  sont distinctes et ne se corrigent pas pareil.");
  } finally { rmSync(join(f, ".."), { recursive: true, force: true }); }
});

test("aucune analyse ne lit un journal sans l'éprouver", () => {
  /*
   * LA COUVERTURE SE DÉDUIT. Une liste de fichiers écrite ici oublierait la prochaine analyse,
   * et c'est exactement ce qui est arrivé aux six.
   */
  const src = fileURLToPath(new URL(".", import.meta.url));
  const nus: string[] = [];
  let balayes = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "journal.ts") continue;
    balayes++;
    const t = readFileSync(join(src, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/.*$/gm, " ");
    /* `tentatives.ts` lit `lireJournal` ET ses deux drapeaux : c'est un usage éprouvé. */
    if (!/\blireJournal\s*\(/.test(t)) continue;
    if (/\bcomplet\b/.test(t) && /\btronquees\b/.test(t)) continue;
    nus.push(f);
  }
  assert.ok(balayes >= 20, `${balayes} module(s) balayé(s) : la lecture du dossier a échoué.`);
  assert.deepEqual(nus, [],
    `${nus.join(", ")} appelle(nt) \`lireJournal\` sans regarder \`complet\` ni \`tronquees\`.\n`
    + "  Une passe interrompue y entre comme un échantillon plus court, et le chiffre qui en\n"
    + "  sort a l'air d'une mesure.\n"
    + "  → `lireJournalEprouve(f, \"la commande qui refait la passe\")`");
});
