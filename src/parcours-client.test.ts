/*
 * THE CLIENT JOURNEY OF 5 OCTOBER 2026: what a client met on the way to the free test's report, each case red on
 * ae6b217 and green with its fix.
 *
 * 1. A header written as the site showed it, `id,text,total`, with no kind: the comparison was exact text, so
 *    "$1,234.50" against "1234.50" was wrong on every case, in silence (CORD with the kinds stripped: google-expense read
 *    4.2 % of totals instead of 93.7 %, and the report looked clean). `grade` and `measure:yours` now refuse such a
 *    column, name it, and say what to write in the header; `--exact` keeps the exact-text comparison on purpose, with a
 *    warning that travels with the run.
 * 2. One pair carried two worst-case bounds in one report: the per-field line said "may be up to 6.2 points worse", the
 *    audit said "worst case 9.8 points behind" (Newcombe). One bound now, the audit's.
 * 3. `--sorties=a.json,b.json` opened one file named "a.json,b.json" and died on a raw ENOENT. A comma separates files.
 * 4. A vendor-only run (--no-encoders, no --rules) warned about derived questions and about what the text lacks, two
 *    measurements it does not make. It is silent on them now, and still writes the questions into the record.
 * 5. The README's free-test steps are the site's five steps, so a reader of either follows the same commands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";
import { genreSuggere } from "./grader.ts";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const GRADE = join(RACINE, "src", "grade.ts");
const MESURE = join(RACINE, "src", "your-cases.ts");
const CORD = join(RACINE, "examples", "cord-receipts");
const bac = (nom: string) => realpathSync(mkdtempSync(join(tmpdir(), nom)));
const ENV = { CRUSETRA_OFFLINE: "1", NODE_TEST_CONTEXT: "1" };

/* Twenty-four invented invoices: totals with a decimal part, dates with separators, a vendor name. */
function factures(entete: string): { csv: string; valeurs: Record<string, Record<string, string>> } {
  const lignes = [entete];
  const valeurs: Record<string, Record<string, string>> = {};
  for (let i = 1; i <= 24; i++) {
    const id = `F-${String(i).padStart(3, "0")}`;
    const total = `${1000 + i * 37}.${String((i * 7) % 100).padStart(2, "0")}`;
    const date = `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`;
    lignes.push(`${id},"INVOICE ${id} (invented) Acme Supplies date ${date} TOTAL USD ${total}",${total},${date},Acme Supplies`);
    /* the vendor writes the same values with a currency sign and a thousands separator, as vendors do */
    const [ent, dec] = total.split(".");
    valeurs[id] = { total: `$${Number(ent).toLocaleString("en-US")}.${dec}`, invoice_date: date, vendor: "Acme Supplies" };
  }
  return { csv: lignes.join("\n") + "\n", valeurs };
}

test("genreSuggere names a column of amounts or dates, and leaves ids, years and counts alone", () => {
  assert.deepEqual(genreSuggere(["1234.50", "60.000", "$1,234.50", "12,50"])?.kind, "amount");
  assert.deepEqual(genreSuggere(["2026-05-03", "05/03/2026", "3 May 1990"])?.kind, "date");
  assert.equal(genreSuggere(["PL815827", "INV-0042", "A-12"]), null, "ids are not amounts, even when parseAmount reads one");
  assert.equal(genreSuggere(["1990", "60", "1234"]), null, "digit-only values carry no mark exact text trips on");
  assert.equal(genreSuggere(["", "-", "  "]), null, "unknown and absent cells say nothing");
  assert.equal(genreSuggere(["1234.50", "x", "y", "z"]), null, "a minority of amounts does not name the column");
});

test("1. grade refuses a kind-less column of amounts or dates, names the header to write, and runs with --exact or with the kind", () => {
  const d = bac("genre-grade-");
  try {
    const sansGenre = factures("id,text,total,invoice_date,vendor");
    writeFileSync(join(d, "sans.csv"), sansGenre.csv);
    writeFileSync(join(d, "valeurs.json"), JSON.stringify(sansGenre.valeurs));
    const args = (csv: string, ...plus: string[]) => [GRADE, `--cases=${join(d, csv)}`, "--name=acme-ocr", `--values=${join(d, "valeurs.json")}`,
      "--price-per-thousand-pages=20", `--out=${join(d, csv + ".out.json")}`, ...plus];

    const refus = lancer(args("sans.csv"), { env: ENV });
    exigerRefus(refus, /2 field\(s\) have no declared kind and look like amounts or dates/, "a kind-less amount column must be refused");
    assert.match(refus.texte, /total: 100 % of its expected values read as an amount/);
    assert.match(refus.texte, /write the header as `total:amount`/);
    assert.match(refus.texte, /invoice_date: 100 % of its expected values read as a date/);
    assert.match(refus.texte, /write the header as `invoice_date:date`/);
    assert.match(refus.texte, /pass --exact/);
    assert.match(refus.texte, /Nothing was graded/);
    assert.doesNotMatch(refus.texte, /vendor:/, "a free-text column is not named");
    assert.ok(!existsSync(join(d, "sans.csv.out.json")), "nothing is written when the command refuses");

    const exact = lancer(args("sans.csv", "--exact"), { env: ENV });
    assert.equal(exact.code, 0, exact.texte);
    assert.match(exact.texte, /⚠ --exact: 2 field\(s\) have no declared kind/);
    assert.match(exact.texte, /the rates below carry that choice/);
    assert.ok(existsSync(join(d, "sans.csv.out.json")));
    /* the positive control of the refusal: graded as exact text, the vendor's "$1,037.07" is wrong against "1037.07" */
    const sortie = JSON.parse(readFileSync(join(d, "sans.csv.out.json"), "utf8")) as { coverage: Record<string, { clean: number; wrong: number }> };
    assert.equal(sortie.coverage["total"]!.clean, 0, "with --exact the formatting is graded, which is the choice the flag names");

    const avecGenre = factures("id,text,total:amount,invoice_date:date,vendor:free-text");
    writeFileSync(join(d, "avec.csv"), avecGenre.csv);
    const ok = lancer(args("avec.csv"), { env: ENV });
    assert.equal(ok.code, 0, ok.texte);
    assert.doesNotMatch(ok.texte, /have no declared kind/);
    const graded = JSON.parse(readFileSync(join(d, "avec.csv.out.json"), "utf8")) as { coverage: Record<string, { clean: number; wrong: number }> };
    assert.equal(graded.coverage["total"]!.clean, 24, "declared as an amount, the same values are right on every case");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("1. measure:yours refuses the same column in the same words, and runs with --exact", () => {
  const d = bac("genre-mesure-");
  try {
    const sansGenre = factures("id,text,total,invoice_date,vendor");
    writeFileSync(join(d, "sans.csv"), sansGenre.csv);
    writeFileSync(join(d, "valeurs.json"), JSON.stringify(sansGenre.valeurs));
    const g = lancer([GRADE, `--cases=${join(d, "sans.csv")}`, "--name=acme-ocr", `--values=${join(d, "valeurs.json")}`,
      "--price-per-thousand-pages=20", `--out=${join(d, "acme.json")}`, "--exact"], { env: ENV });
    assert.equal(g.code, 0, g.texte);
    const args = (...plus: string[]) => [MESURE, `--cases=${join(d, "sans.csv")}`, `--sorties=${join(d, "acme.json")}`, "--no-encoders",
      "--current=acme-ocr", "--margin=2", "--pages-per-year=100000", ...plus];
    const refus = lancer(args(), { env: ENV });
    exigerRefus(refus, /2 field\(s\) have no declared kind and look like amounts or dates/, "measure:yours must refuse the kind-less column");
    assert.match(refus.texte, /write the header as `total:amount`/);
    assert.ok(!existsSync(join(d, "sans-measured.json")), "no record is written when the command refuses");
    const exact = lancer(args("--exact"), { env: ENV });
    assert.equal(exact.code, 0, exact.texte);
    assert.match(exact.texte, /⚠ --exact: 2 field\(s\) have no declared kind/);
    assert.ok(existsSync(join(d, "sans-measured.json")));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

/* The CORD files copied, the two vendors, no local tier: the run of the client journey, under a second. */
function cordVendeursSeuls(d: string, sortiesFlag: string[]): { code: number; texte: string; md: string; record: Record<string, unknown> } {
  for (const f of ["cord-labels-grouped.csv", "cord-google-outcomes.json", "cord-gemini-outcomes.json", "cord-rules.json"]) cpSync(join(CORD, f), join(d, f));
  const r = lancer([MESURE, `--cases=${join(d, "cord-labels-grouped.csv")}`, ...sortiesFlag, "--no-encoders",
    "--current=google-expense", "--margin=2", "--pages-per-document=1", "--pages-per-year=1000000"], { env: ENV, msMax: 120_000 });
  const md = existsSync(join(d, "cord-labels-grouped-measured.md")) ? readFileSync(join(d, "cord-labels-grouped-measured.md"), "utf8") : "";
  const record = existsSync(join(d, "cord-labels-grouped-measured.json")) ? JSON.parse(readFileSync(join(d, "cord-labels-grouped-measured.json"), "utf8")) : {};
  return { code: r.code, texte: r.texte, md, record };
}

test("2. one worst-case bound per pair: the per-field line and the audit quote the same figure", () => {
  const d = bac("une-borne-");
  try {
    const r = cordVendeursSeuls(d, [`--sorties=${join(d, "cord-google-outcomes.json")}`, `--sorties=${join(d, "cord-gemini-outcomes.json")}`]);
    assert.equal(r.code, 0, r.texte);
    for (const champ of ["total", "subtotal"]) {
      const debut = r.md.indexOf(`- **\`${champ}\`**`);
      assert.ok(debut >= 0, `${champ}: the report has a verdict block for it`);
      const bloc = r.md.slice(debut);
      const ligne = /Keeping google-expense, your current chain, is not supported by this sample: it may be up to ([\d.]+) points worse than gemini-flash/.exec(bloc);
      assert.ok(ligne, `${champ}: the per-field line is printed\n${bloc.slice(0, 600)}`);
      const audit = new RegExp(`^\\s+${champ}\\b[\\s\\S]*?google-expense[^\\n]*worst case ([\\d.]+) points behind`, "m").exec(r.md);
      assert.ok(audit, `${champ}: the audit line is printed`);
      assert.equal(ligne![1], audit![1], `${champ}: the per-field line (${ligne![1]}) and the audit (${audit![1]}) bound the same pair with one figure`);
    }
    /* the figure is Newcombe's, the one the routing was decided with: read back from the record */
    const rec = r.record as { audit: { fields: Record<string, { sources: Record<string, { paired: { high: number } }> }> } };
    const high = rec.audit.fields["total"]!.sources["google-expense"]!.paired.high;
    assert.match(r.md, new RegExp(`may be up to ${(100 * high).toFixed(1)} points worse than gemini-flash`));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("3. --sorties accepts a comma list, and one flag per file still works", () => {
  const d = bac("sorties-virgule-");
  try {
    const r = cordVendeursSeuls(d, [`--sorties=${join(d, "cord-google-outcomes.json")},${join(d, "cord-gemini-outcomes.json")}`]);
    assert.equal(r.code, 0, r.texte);
    assert.match(r.texte, /Your chain: "google-expense"\./);
    assert.match(r.texte, /Your chain: "gemini-flash"\./);
    assert.doesNotMatch(r.texte, /ENOENT/);
    assert.equal((r.record as { audit: { routing: Record<string, string> } }).audit.routing["tax"], "gemini-flash");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("4. a vendor-only run says nothing about questions nobody asks or text nobody reads, and still records the questions", () => {
  const d = bac("vendeurs-seuls-");
  try {
    const r = cordVendeursSeuls(d, [`--sorties=${join(d, "cord-google-outcomes.json")}`, `--sorties=${join(d, "cord-gemini-outcomes.json")}`]);
    assert.equal(r.code, 0, r.texte);
    assert.doesNotMatch(r.texte, /derived from your column names/);
    assert.doesNotMatch(r.texte, /The question each field is asked/);
    assert.doesNotMatch(r.texte, /mostly NOT in the text/);
    assert.doesNotMatch(r.md, /question\(s\) were derived from your column names/, "the report does not carry the note either");
    const q = (r.record as { questions: Record<string, { provenance: string }> }).questions;
    assert.equal(q["total"]!.provenance, "deduite", "the questions are still resolved and written into the record");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("4. the positive control: with --rules the text is read, and a field absent from it is still named", () => {
  const d = bac("regles-presence-");
  try {
    /* the expected total is nowhere in the text: a rule cannot find it, and the run must say so before measuring */
    const lignes = ["id,text,total:amount"];
    for (let i = 1; i <= 24; i++) lignes.push(`C-${i},"a receipt whose text never prints the amount",${100 + i}.00`);
    writeFileSync(join(d, "absent.csv"), lignes.join("\n") + "\n");
    writeFileSync(join(d, "rules.json"), JSON.stringify({ total: "\\d+\\.\\d\\d" }));
    const r = lancer([MESURE, `--cases=${join(d, "absent.csv")}`, `--rules=${join(d, "rules.json")}`, "--no-encoders"], { env: ENV, msMax: 120_000 });
    assert.match(r.texte, /mostly NOT in the text/, `with rules the presence of the truth in the text is announced:\n${r.texte.slice(-800)}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("5. the README's free-test steps are the site's: the header with kinds, -with-text.csv, tessdata once, the raw-export path, the comma list, the record's name, not signed", () => {
  const readme = readFileSync(join(RACINE, "README.md"), "utf8");
  for (const attendu of ["id,text,total:amount,date:date,vendor:free-text", "--exact", "your-with-text.csv", "npm run tessdata -- --prime",
    "--mapping=mapping.json", "--sorties=<vendor>.json,<vendor>.json", "-measured.json", "not signed", "Node 24 or newer"]) {
    assert.ok(readme.includes(attendu), `README.md does not carry « ${attendu} », which the site's steps say`);
  }
});
