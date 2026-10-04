/**
 * THE `text` COLUMN, FROM THE TEXT THE BUYER'S VENDOR ALREADY RETURNS.
 *
 * The local tiers read a `text` column: the OCR'd text of each document. The repository's own
 * OCR runs on macOS only (`src/ocr.ts`, Vision), so a buyer on Linux had no command that
 * turned receipt images into that column (audit of 4 October 2026). They do have one source of
 * text already paid for: the exports of the vendor they run today. Textract returns the page
 * as LINE blocks, Document AI returns `document.text`, Azure returns `analyzeResult.content`.
 *
 * This command reads those exports offline (the same reader as `grade`, which opens no
 * connection), fills the `text` column of the labelled CSV for every case whose export it
 * finds, and writes the result beside the CSV. The labels are copied as they are, kinds in the
 * header included. A case without an export keeps its text; a case whose export carries no
 * text is counted and named. Nothing is sent anywhere, and no value is read from the labels.
 *
 *   npm run text-from-exports -- --cases=labelled.csv --vendor=textract|documentai|azure \
 *       --exports=<folder or file> [--out=<file>] [--overwrite]
 *
 * The text a vendor returns is that vendor's reading of the page: the local tiers then carry
 * that OCR's errors, exactly as the CORD example's local tiers carry Vision's. The report says
 * which text column the local tiers read; the record carries the file's hash either way.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { lireCsv } from "./your-cases.ts";
import { readExports, isVendorName, VENDORS, type VendorName } from "./vendors.ts";

export const FLAGS = ["--cases", "--vendor", "--exports", "--out", "--overwrite", "--help"] as const;

/** Every `Blocks` array in a Textract response, whatever wraps it (one response, a paginated
    array of responses, or `ExpenseDocuments[].Blocks`), in document order. */
function textractLines(exported: unknown): string[] {
  const lines: string[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { for (const v of x) walk(v); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.Blocks)) {
      for (const b of o.Blocks as { BlockType?: string; Text?: string }[]) {
        if (b && b.BlockType === "LINE" && typeof b.Text === "string" && b.Text.trim()) lines.push(b.Text.trim());
      }
    }
    for (const [k, v] of Object.entries(o)) if (k !== "Blocks") walk(v);
  };
  walk(exported);
  return lines;
}

/** The full text of one export under a vendor, or null when the export carries none. */
export function fullText(vendor: VendorName, exported: unknown): string | null {
  if (!exported || typeof exported !== "object") return null;
  const o = exported as Record<string, unknown>;
  if (vendor === "textract") {
    const lines = textractLines(exported);
    return lines.length ? lines.join("\n") : null;
  }
  if (vendor === "documentai") {
    const d = (o.document && typeof o.document === "object" ? o.document : o) as { text?: unknown };
    return typeof d.text === "string" && d.text.trim() ? d.text : null;
  }
  const r = (o.analyzeResult && typeof o.analyzeResult === "object" ? o.analyzeResult : o) as { content?: unknown };
  return typeof r.content === "string" && r.content.trim() ? r.content : null;
}

/** A CSV cell: quoted when it carries a separator, a quote or a line break, quotes doubled. */
export function cell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

export type Filled = { csv: string; filled: string[]; noExport: string[]; noText: string[] };

/**
 * The labelled CSV with its `text` column filled from the exports. Pure: the caller reads
 * and writes. The header is rebuilt from what was read, kinds included, so the file that
 * comes out declares exactly what the file that went in declared.
 */
export function fillText(csvText: string, vendor: VendorName, byId: Map<string, unknown>): Filled {
  const lu = lireCsv(csvText);
  const { cas, champs, kinds, lecture } = lu;
  const header = lecture.noms.map((n) => (champs.includes(n) && kinds[n] ? `${n}:${kinds[n]}` : n));
  const filled: string[] = [], noExport: string[] = [], noText: string[] = [];
  const rows = cas.map((c) => {
    let text = c.text;
    if (!byId.has(c.id)) noExport.push(c.id);
    else {
      const t = fullText(vendor, byId.get(c.id));
      if (t === null) noText.push(c.id); else { text = t; filled.push(c.id); }
    }
    return lecture.noms.map((n) => n === lecture.noms[lecture.colId] ? c.id : n === lecture.noms[lecture.colTexte] ? text : (c.truth[n] ?? ""));
  });
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
  return { csv, filled, noExport, noText };
}

async function principal(): Promise<void> {
  refuserDrapeauxInconnus(FLAGS);
  const arg = (nom: string) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  const fichier = arg("cases"), vendor = arg("vendor"), exportsPath = arg("exports");
  const aide = process.argv.includes("--help");
  if (!fichier || !vendor || !exportsPath || aide) {
    console.log(`
Fill the text column of your labelled CSV from the full text your vendor's exports already carry.

  npm run text-from-exports -- --cases=labelled.csv --vendor=textract|documentai|azure \\
      --exports=<folder of <id>.json, or one JSON keyed by id> [--out=<file>] [--overwrite]

The local tiers read the text column. This command reads the vendor exports offline (it opens no
connection, like grade), takes each export's full text (Textract LINE blocks in order, Document AI
document.text, Azure analyzeResult.content) and writes <cases>-with-text.csv beside your CSV,
labels and kinds copied as they are. A case with no export keeps its text; a case whose export
carries no text is named. That text is the vendor's reading of the page, so the local tiers
then carry that vendor's OCR errors; the report says which text column they read.
`);
    process.exit(aide ? 0 : 1);
  }
  if (!existsSync(fichier)) throw new Error(`no such file: ${fichier}`);
  if (!isVendorName(vendor)) throw new Error(`--vendor=${vendor} is not a vendor this tool reads. Known: ${VENDORS.join(", ")}.`);
  if (!existsSync(exportsPath)) throw new Error(`no such folder or file: ${exportsPath}`);
  const exportsRead = readExports(exportsPath);
  const r = fillText(readFileSync(fichier, "utf8"), vendor, exportsRead.byId);
  const sortie = arg("out") ?? fichier.replace(/\.csv$/i, "") + "-with-text.csv";
  if (existsSync(sortie) && statSync(sortie).isDirectory()) throw new Error(`${sortie} is a directory.`);
  if (existsSync(sortie) && !process.argv.includes("--overwrite")) {
    throw new Error(`${sortie} already exists, and this command does not overwrite it without being told to.\n`
      + `  Write elsewhere with --out=<file>, or pass --overwrite. Nothing was written.`);
  }
  if (r.filled.length === 0) {
    throw new Error(`no case of ${basename(fichier)} got a text from ${exportsRead.source}: `
      + (r.noExport.length ? `${r.noExport.length} case(s) have no export (ids look like ${r.noExport.slice(0, 3).join(", ")})` : "")
      + (r.noText.length ? `${r.noExport.length ? "; " : ""}${r.noText.length} export(s) carry no text` : "")
      + `. Nothing was written.`);
  }
  writeFileSync(sortie, r.csv);
  console.log(`\n${r.filled.length} case(s) got their text from ${exportsRead.source} (${vendor}).`);
  if (r.noExport.length) console.log(`  ${r.noExport.length} case(s) have no export and keep their text: ${r.noExport.slice(0, 5).join(", ")}${r.noExport.length > 5 ? ", and more" : ""}.`);
  if (r.noText.length) console.log(`  ${r.noText.length} export(s) carry no text and those cases keep theirs: ${r.noText.slice(0, 5).join(", ")}${r.noText.length > 5 ? ", and more" : ""}.`);
  for (const u of exportsRead.unreadable) console.log(`  ⚠ ${u.name}: ${u.why}`);
  console.log(`\nWritten to ${sortie}: your labels as they were, the text column from the vendor.\n`);
  console.log(`  npm run measure:yours -- --cases=${sortie} ...\n`);
}

if (isMain(import.meta)) {
  try { await principal(); }
  catch (e) { console.error(`\n${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); }
}
