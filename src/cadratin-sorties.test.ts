/*
 * F10 (2026-09-30): NO EM DASH IN ANYTHING measure:yours AND grade EMIT.
 *
 * House rule: no U+2014 in anything a reader sees. The .md report measure:yours writes still
 * carried three (the derived-questions warning, the non-inferiority sentence, the declared
 * margin line); the console, the refusals and the help text carried more. Every sentence was
 * rewritten with a colon or a full stop where the dash was, never a hyphen in its place.
 *
 * Four cases hold it. The first reads the writers themselves, without weights: the report with
 * and without a margin, a derived question and a measured one, and the recommendation lines
 * (red before this commit). The second reads the help of both commands. The third runs grade
 * end to end. The fourth runs grade and then a small measure:yours on its outcomes, with the
 * real weights, and reads the console, the report and the sealed record; it stands aside by
 * name on a machine without weights and runs on the integration.
 *
 * What this repository does not own: `comparaison-appariee.ts` is shared (a copy of identite)
 * and prints an em dash in the one verdict sentence measure:yours can still reach through it,
 * "separably BETTER ... the rates rank them the other way". That is said to the founder, not
 * edited here; the fourth case does not reach it, and would name it the day it does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { poidsEnCache, diagnosticDesPoids } from "./tiers.ts";
import { rapportPourLeClient, recommander } from "./your-cases.ts";
import { rate } from "./interval.ts";

const CADRATIN = "\u2014";
const MESURE = fileURLToPath(new URL("./your-cases.ts", import.meta.url));
const GRADE = fileURLToPath(new URL("./grade.ts", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../examples/extraction-audit/", import.meta.url));

/** Fails naming every line that carries the character, so the sentence to rewrite is in the message. */
function sansCadratin(texte: string, ou: string): void {
  const lignes = texte.split("\n").filter((l) => l.includes(CADRATIN));
  assert.deepEqual(lignes, [], `${ou} carries an em dash:\n  ${lignes.map((l) => l.trim()).join("\n  ")}`);
}

test("F10: the client report and the recommendation lines carry no em dash, margin declared or not", () => {
  const base = {
    cas: 24, champs: ["name", "total"], date: "2026-09-30",
    questions: {
      name: { texte: "What is the name of the client?", provenance: "mesuree" as const },
      total: { texte: "What is the total?", provenance: "deduite" as const },
    },
    avecRegles: false,
    lignes: [["`name`", "large", "95.8 %", "[80-99]", 24, "10 ms"], ["`total`", "large", "91.7 %", "[74-98]", 24, "10 ms"]],
  };
  const verdicts = [{ champ: "name", lignes: ["x"] }, { champ: "total", lignes: ["y"] }];
  sansCadratin(rapportPourLeClient({ ...base, verdicts }), "the report without a margin");
  const avec = rapportPourLeClient({ ...base, marge: 0.02, verdicts });
  assert.match(avec, /Margin declared: \*\*2 point\(s\)\*\*/, "the margin line is still written");
  assert.match(avec, /not comparable to the ones in Crusetra Routing's README/, "the derived-questions warning is still written");
  sansCadratin(avec, "the report with a margin and a derived question");

  /* The recommendation lines: a cheaper tier that is non-inferior, and one this sample cannot
     separate within a margin. Both sentences carried a dash or came from a line that did. */
  const bits = (n: number, faux: number[]) => Array.from({ length: n }, (_, i) => (faux.includes(i) ? "0" : "1")).join("");
  const releve = { name: {
    large: { bons: 23, sur: 24, ms: 10, reussites: bits(24, [5]) },
    small: { bons: 23, sur: 24, ms: 5, reussites: bits(24, [5]) },
    rules: { bons: 12, sur: 24, ms: 1, reussites: bits(24, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) },
  } } as never;
  const rangs = [
    { palier: "large", r: rate(23, 24), ms: 10 },
    { palier: "small", r: rate(23, 24), ms: 5 },
    { palier: "rules", r: rate(12, 24), ms: 1 },
  ];
  const lignes = recommander("name", rangs, releve, 0.2);
  assert.ok(lignes.some((l) => /^Recommendation for name: small, the cheapest tier non-inferior to large/.test(l)), lignes.join("\n"));
  sansCadratin(lignes.join("\n"), "the recommendation lines with a margin");
  sansCadratin(recommander("name", rangs, releve).join("\n"), "the recommendation lines without a margin");
});

test("F10: the help of measure:yours and of grade carries no em dash", () => {
  for (const [nom, cmd] of [["measure:yours", MESURE], ["grade", GRADE]] as const) {
    const r = spawnSync(process.execPath, [cmd], { encoding: "utf8", timeout: 120_000 });
    assert.ok((r.stdout + r.stderr).length > 200, `${nom} printed no help`);
    sansCadratin(r.stdout + r.stderr, `the help of ${nom}`);
  }
});

/** Six of the example's receipts, and vendor A's values for them. */
function petitEchantillon(d: string): { csv: string; values: string } {
  const lignes = readFileSync(join(EXAMPLE, "receipts.csv"), "utf8").split("\n");
  const csv = join(d, "receipts.csv");
  writeFileSync(csv, lignes.slice(0, 7).join("\n") + "\n");
  const ids = lignes.slice(1, 7).map((l) => l.split(",")[0]!);
  const toutes = JSON.parse(readFileSync(join(EXAMPLE, "vendor-a-values.json"), "utf8")) as Record<string, unknown>;
  const values = join(d, "vendor-a-values.json");
  writeFileSync(values, JSON.stringify(Object.fromEntries(ids.map((id) => [id, toutes[id]]))));
  return { csv, values };
}

test("F10: grade end to end emits no em dash, on the console and in the outcomes file", () => {
  const d = mkdtempSync(join(tmpdir(), "cadratin-grade-"));
  try {
    const { csv, values } = petitEchantillon(d);
    const out = join(d, "vendor-a-outcomes.json");
    const r = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=vendor-a", `--values=${values}`, "--price-per-thousand-pages=50", `--out=${out}`],
      { encoding: "utf8", timeout: 120_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    sansCadratin(r.stdout + r.stderr, "the console of grade");
    sansCadratin(readFileSync(out, "utf8"), "the outcomes file");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("F10: a small measure:yours, end to end, emits no em dash: console, report and sealed record", { timeout: 900_000 }, (t) => {
  if (!poidsEnCache()) return t.skip(diagnosticDesPoids() ?? "poids d'encodeur inutilisables.");
  const d = mkdtempSync(join(tmpdir(), "cadratin-mesure-"));
  try {
    const { csv, values } = petitEchantillon(d);
    const sorties = join(d, "vendor-a-outcomes.json");
    const g = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=vendor-a", `--values=${values}`, "--price-per-thousand-pages=50", `--out=${sorties}`],
      { encoding: "utf8", timeout: 120_000 });
    assert.equal(g.status, 0, g.stdout + g.stderr);
    const r = spawnSync(process.execPath, [MESURE, `--cases=${csv}`, `--sorties=${sorties}`, "--current=vendor-a", "--margin=5", "--pages-per-document=1"],
      { encoding: "utf8", timeout: 840_000, env: { ...process.env, CRUSETRA_OFFLINE: "1" } });
    assert.equal(r.status, 0, `measure:yours failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
    sansCadratin(r.stdout + r.stderr, "the console of measure:yours");
    for (const f of ["receipts-measured.md", "receipts-measured.json"]) {
      assert.ok(existsSync(join(d, f)), `${f} was not written`);
      sansCadratin(readFileSync(join(d, f), "utf8"), f);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
