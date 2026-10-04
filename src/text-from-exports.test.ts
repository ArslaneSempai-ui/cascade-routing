/*
 * THE TEXT COLUMN FROM THE VENDOR'S EXPORTS (audit of 4 October 2026): a buyer without macOS
 * had no command that produced the `text` column the local tiers read. This command builds it
 * from what the vendor they already pay returns, offline, and copies the labels untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fullText, fillText, cell } from "./text-from-exports.ts";
import { readExports } from "./vendors.ts";
import { lireCsv } from "./your-cases.ts";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = join(RACINE, "fixtures", "vendors");
const CSV = join(FIXTURES, "cases.csv");
const CMD = join(RACINE, "src", "text-from-exports.ts");

test("each vendor's full text is read from the shape its export has", () => {
  assert.equal(fullText("textract", { Blocks: [{ BlockType: "LINE", Text: "Total 5.00" }, { BlockType: "WORD", Text: "Total" }, { BlockType: "LINE", Text: "Thanks" }] }), "Total 5.00\nThanks");
  assert.equal(fullText("textract", [{ Blocks: [{ BlockType: "LINE", Text: "p1" }] }, { Blocks: [{ BlockType: "LINE", Text: "p2" }] }]), "p1\np2", "a paginated result is read in order");
  assert.equal(fullText("textract", { ExpenseDocuments: [{ Blocks: [{ BlockType: "LINE", Text: "Rp 60.000" }] }] }), "Rp 60.000", "AnalyzeExpense carries its blocks under the document");
  assert.equal(fullText("documentai", { text: "Invoice 42" }), "Invoice 42");
  assert.equal(fullText("documentai", { document: { text: "Wrapped" } }), "Wrapped", "the ProcessResponse wrapper is unwrapped");
  assert.equal(fullText("azure", { analyzeResult: { content: "Receipt" } }), "Receipt");
  assert.equal(fullText("azure", { content: "Bare" } ), "Bare", "the unwrapped analyzeResult layout reads too");
  assert.equal(fullText("textract", { Blocks: [] }), null, "an export without a line carries no text");
  assert.equal(fullText("documentai", { entities: [] }), null);
  assert.equal(fullText("azure", { analyzeResult: {} }), null);
});

test("the labelled CSV comes out with its text filled and its labels and kinds untouched", () => {
  const avant = lireCsv(readFileSync(CSV, "utf8"));
  for (const vendor of ["textract", "documentai", "azure"] as const) {
    const exp = readExports(join(FIXTURES, vendor));
    const r = fillText(readFileSync(CSV, "utf8"), vendor, exp.byId);
    assert.ok(r.filled.length >= 1, `${vendor}: no case got a text from the fixtures`);
    const apres = lireCsv(r.csv);
    assert.deepEqual(apres.champs, avant.champs, `${vendor}: the fields changed`);
    assert.deepEqual(apres.kinds, avant.kinds, `${vendor}: the kinds declared in the header changed`);
    assert.equal(apres.cas.length, avant.cas.length, `${vendor}: a case was lost or gained`);
    for (let i = 0; i < avant.cas.length; i++) {
      assert.equal(apres.cas[i]!.id, avant.cas[i]!.id);
      assert.deepEqual(apres.cas[i]!.truth, avant.cas[i]!.truth, `${vendor}: a label moved on ${avant.cas[i]!.id}`);
      if (r.filled.includes(avant.cas[i]!.id)) {
        assert.notEqual(apres.cas[i]!.text, avant.cas[i]!.text, `${vendor}: ${avant.cas[i]!.id} was filled but its text did not change`);
        assert.ok(apres.cas[i]!.text.trim().length > 0);
      } else {
        assert.equal(apres.cas[i]!.text, avant.cas[i]!.text, `${vendor}: a case without an export must keep its text`);
      }
    }
  }
});

test("a cell is quoted when it carries a separator, a quote or a line break, and the quote is doubled", () => {
  assert.equal(cell("plain"), "plain");
  assert.equal(cell("a,b"), "\"a,b\"");
  assert.equal(cell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(cell("two\nlines"), "\"two\nlines\"");
  /* Round trip through the repository's own reader. */
  const lu = lireCsv(`id,text,total\n1,${cell("Total: 5,00\n\"net\"")},5\n`);
  assert.equal(lu.cas[0]!.text, "Total: 5,00\n\"net\"");
});

test("the command writes beside the CSV, refuses to overwrite, and accepts --help", () => {
  const d = mkdtempSync(join(tmpdir(), "text-from-exports-"));
  const csv = join(d, "cases.csv");
  writeFileSync(csv, readFileSync(CSV));
  const run = (...args: string[]) => spawnSync("node", [CMD, ...args], { encoding: "utf8", cwd: RACINE, timeout: 60_000 });

  const aide = run("--help");
  assert.equal(aide.status, 0, "--help exits 0");
  assert.match(aide.stdout, /Fill the text column/);

  const r = run(`--cases=${csv}`, "--vendor=documentai", `--exports=${join(FIXTURES, "documentai")}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const sortie = join(d, "cases-with-text.csv");
  assert.ok(existsSync(sortie), "the filled CSV is written beside the labelled one");
  assert.match(r.stdout, /case\(s\) got their text from folder documentai \(documentai\)/);

  const encore = run(`--cases=${csv}`, "--vendor=documentai", `--exports=${join(FIXTURES, "documentai")}`);
  assert.equal(encore.status, 1, "an existing output is refused without --overwrite");
  assert.match(encore.stderr, /already exists/);

  const force = run(`--cases=${csv}`, "--vendor=documentai", `--exports=${join(FIXTURES, "documentai")}`, "--overwrite");
  assert.equal(force.status, 0, force.stdout + force.stderr);

  const mauvais = run(`--cases=${csv}`, "--vendor=nope", `--exports=${join(FIXTURES, "documentai")}`);
  assert.equal(mauvais.status, 1);
  assert.match(mauvais.stderr, /not a vendor this tool reads/);
});
