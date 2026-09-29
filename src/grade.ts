/**
 * Grade one vendor's extracted values against the labelled CSV, and write only outcomes.
 *
 *   npm run grade -- --cases=labelled.csv --name=textract-forms \
 *       --vendor=textract --exports=exports/ --mapping=mapping.json --price-per-thousand-pages=50
 *
 *   npm run grade -- --cases=labelled.csv --name=my-chain --values=values.json
 *
 * `measure:yours` reads a `--sorties` file: one outcome per case and field, clean, wrong or
 * blank, and never the value. Until now the client had to produce that file by hand. This
 * command produces it, on their machine, from what their vendor returned: either a folder of
 * the vendor's own exports read by an offline adapter (`vendors.ts`), or a plain JSON of
 * values their chain wrote. The values stay where they were. What is written is the verdict,
 * the version of the grader that gave it, the kind each field was graded as, and the
 * conventions those kinds rest on, so the grading can be repeated or disputed.
 *
 * Nothing here opens a connection. The exports were produced when the client paid the
 * vendor; reading them costs nothing and sends nothing.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { readJsonFile } from "./json-file.ts";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { lireCsv, nomDeChaine, type Cas } from "./your-cases.ts";
import { outcome, GRADER, type FieldKind, type Outcome } from "./grader.ts";
import { loadMapping, readExports, valuesFromExports, isVendorName, VENDORS, type VendorName } from "./vendors.ts";
import { rate, writeRate } from "./interval.ts";
import { etatDuDepot } from "./arbre-propre.ts";
import { TIERS } from "./paliers.ts";
import { readListPrices } from "./audit.ts";
import { symboleDe, UNITS } from "./assumptions.ts";

export const FLAGS = ["--cases", "--name", "--values", "--vendor", "--exports", "--mapping",
  "--price-per-thousand-pages", "--price-per-thousand-documents", "--list-price", "--out"] as const;

/** The file `measure:yours` reads under `--sorties`, in the shape it already accepts. */
export type OutcomesFile = {
  kind: "cascade-outcomes"; version: 1;
  nom: string;
  issues: Record<string, Record<string, Outcome>>;
  notePar: {
    outil: "cascade"; version: string; correcteur: string; gradedAt: string;
    kinds: Record<string, FieldKind>; conventions: typeof GRADER.conventions;
  };
  /** The price in its own unit: per thousand pages OR per thousand documents, never one under
      the other's name (item 6). `vendor` is a key of the list-price table. */
  declares: { pricePerThousandPages?: number; pricePerThousandDocuments?: number; vendor?: string };
  source: { cases: string; sha256: string; vendor?: VendorName; exports?: string; values?: string };
  /** Per field: how many cases were graded and how many had nothing to grade. */
  coverage: Record<string, { graded: number; absent: number; clean: number; wrong: number; blank: number }>;
  /** What was said on the console and should travel with the verdicts: a selector that matched
      nothing anywhere, an ambiguous type, a failed export. Absent when nothing was said. */
  warnings?: string[];
};

/**
 * Values as the client's chain wrote them, in either of two layouts:
 *   per case   { "<id>": { "<field>": "<value>" } }
 *   per field  { "<field>": { "<id>": "<value>" } }
 * The layout is read from the keys: when every top-level key is a field of the CSV, it is
 * per field. A number or a boolean is taken as its text; null and undefined are blanks.
 */
export function readValuesFile(path: string, fields: readonly string[]): Record<string, Record<string, string>> {
  const raw = readJsonFile(path);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path}: expected an object, { "<id>": { "<field>": "<value>" } } or { "<field>": { "<id>": "<value>" } }.`);
  }
  const top = raw as Record<string, unknown>;
  const keys = Object.keys(top);
  if (keys.length === 0) throw new Error(`${path} is empty.`);
  const fieldSet = new Set(fields);
  const perField = keys.every((k) => fieldSet.has(k));
  const out: Record<string, Record<string, string>> = Object.create(null);
  const asText = (v: unknown, where: string): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    throw new Error(`${path}: ${where} is ${Array.isArray(v) ? "an array" : typeof v}, not a value.`);
  };
  for (const [k1, inner] of Object.entries(top)) {
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
      throw new Error(`${path}: the entry "${k1}" must be an object of values.`);
    }
    for (const [k2, v] of Object.entries(inner as Record<string, unknown>)) {
      const [field, id] = perField ? [k1, k2] : [k2, k1];
      if (!fieldSet.has(field)) continue;   /* a column the CSV does not have: counted below */
      (out[field] ??= Object.create(null))[id] = asText(v, `${k1}/${k2}`);
    }
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`${path}: none of its keys names a field of the CSV (${fields.join(", ")}).\n`
      + `  Nothing would be graded.`);
  }
  return out;
}

export type Graded = {
  issues: Record<string, Record<string, Outcome>>;
  coverage: OutcomesFile["coverage"];
};

/** Pure: the verdicts of every case that has a value, under the field's kind. */
export function gradeValues(cases: readonly Cas[], fields: readonly string[], kinds: Record<string, FieldKind>,
  values: Record<string, Record<string, string>>): Graded {
  const issues: Record<string, Record<string, Outcome>> = {};
  const coverage: OutcomesFile["coverage"] = {};
  for (const field of fields) {
    const v = values[field];
    if (!v) continue;
    issues[field] = {};
    const c = { graded: 0, absent: 0, clean: 0, wrong: 0, blank: 0 };
    for (const cas of cases) {
      if (!(cas.id in v)) { c.absent++; continue; }
      const o = outcome(v[cas.id]!, cas.truth[field] ?? "", kinds[field] ?? "exact");
      issues[field]![cas.id] = o;
      c.graded++; c[o]++;
    }
    coverage[field] = c;
  }
  return { issues, coverage };
}

export function readPrice(raw: string | undefined, flag = "--price-per-thousand-pages"): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
    throw new Error(`${flag}=${raw} is not a price (a number of dollars, zero or more).\n`
      + `  Left as it was, this flag would have been dropped and the chain would enter the audit unpriced.`);
  }
  return n;
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "chain";
}

async function principal(): Promise<void> {
  refuserDrapeauxInconnus(FLAGS);
  const arg = (nom: string) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  const fichier = arg("cases");
  if (!fichier) {
    console.log(`
Grade one vendor's extracted values against your labelled CSV, and write only outcomes.

  npm run grade -- --cases=labelled.csv --name=<chain> \\
      --vendor=textract|documentai|azure --exports=<folder or file> --mapping=mapping.json \\
      [--price-per-thousand-pages=<dollars> | --price-per-thousand-documents=<dollars>] [--out=<file>]

  npm run grade -- --cases=labelled.csv --name=<chain> --values=values.json [...]

--cases     the labelled CSV measure:yours reads: id, text, then one column per field. A
            header may declare the field's kind: total:amount, invoice_date:date, tax_id:id,
            currency:currency, vendor_name:free-text. Without a kind, the default comparison.
--name      what this chain is called in every table (not one of our tier names).
--vendor    which vendor wrote the exports; the adapter reads its JSON offline, never calls it.
--exports   a folder of <case id>.json files, or one JSON object keyed by case id.
--mapping   { "<field>": { "<vendor>": <selector> } }: which vendor key is which field.
--values    instead of exports: { "<id>": { "<field>": "<value>" } } written by your chain.
--price-per-thousand-pages  what this chain costs you per thousand pages, declared.
--price-per-thousand-documents  the same for a vendor that bills per document; one of the two.
--list-price  a key of vendor-prices.json, when you have not declared a price: the audit then
            uses that list price and says so, with the date it was read.
--out       where to write; by default <cases>-<name>-outcomes.json beside the CSV.

Written: one outcome per case and field (clean, wrong, blank), the grader's version and each
field's kind. Never a value. Feed it to: npm run measure:yours -- --cases=... --sorties=<file>
`);
    process.exit(1);
  }
  if (!existsSync(fichier)) throw new Error(`no such file: ${fichier}`);
  if (arg("name") === undefined) throw new Error(`--name is required: it is what this chain is called in every table.`);
  const name = nomDeChaine(arg("name"), "--name");
  if ((TIERS as readonly string[]).includes(name)) {
    throw new Error(`--name=${name} is one of our tier names: its row would overwrite the "${name}" tier's measurements in every table.\n`
      + `  Name it after your system ("textract-forms", "prod-v2") and run again.`);
  }
  const pricePerPages = readPrice(arg("price-per-thousand-pages"), "--price-per-thousand-pages");
  const pricePerDocuments = readPrice(arg("price-per-thousand-documents"), "--price-per-thousand-documents");
  if (pricePerPages !== undefined && pricePerDocuments !== undefined) {
    throw new Error(`--price-per-thousand-pages and --price-per-thousand-documents were both given: one price, in one unit.`);
  }
  const price = pricePerPages ?? pricePerDocuments;
  const unit = pricePerDocuments !== undefined ? "documents" : "pages";
  /* A list-price key stands in for a price the client has not declared; it is checked against
     the table now, so a mistyped key refuses here and not at the end of an hour's measurement. */
  const listPrice = arg("list-price");
  if (listPrice !== undefined) {
    const table = readListPrices();
    if (!(listPrice in table.vendors)) {
      throw new Error(`--list-price=${listPrice} is not a key of vendor-prices.json.\n  Known keys: ${Object.keys(table.vendors).join(", ")}.`);
    }
    if (price !== undefined) console.log(`\n  ⚠ both a declared price and a list-price key were given: the declared price wins in the audit.`);
  }
  const octets = readFileSync(fichier);
  const { champs, cas, kinds } = lireCsv(octets.toString("utf8"));
  if (cas.length === 0) throw new Error(`${fichier} has a header line and no cases under it. Nothing was graded.`);

  const source: OutcomesFile["source"] = { cases: basename(fichier), sha256: createHash("sha256").update(octets).digest("hex") };
  let values: Record<string, Record<string, string>>;
  const notes: string[] = [];
  if (arg("values") !== undefined) {
    if (arg("vendor") !== undefined || arg("exports") !== undefined || arg("mapping") !== undefined) {
      throw new Error(`--values and --vendor/--exports/--mapping are two ways to the same file: give one.`);
    }
    const chemin = arg("values")!;
    if (!existsSync(chemin)) throw new Error(`no such file: ${chemin}`);
    values = readValuesFile(chemin, champs);
    source.values = basename(chemin);
  } else {
    const vendor = arg("vendor"), exports = arg("exports"), mapping = arg("mapping");
    if (!vendor || !exports || !mapping) {
      throw new Error(`grading from exports needs --vendor, --exports and --mapping together (or --values instead).`);
    }
    if (!isVendorName(vendor)) throw new Error(`--vendor=${vendor} is not a vendor this tool reads. Known: ${VENDORS.join(", ")}.`);
    if (!existsSync(exports)) throw new Error(`no such folder or file: ${exports}`);
    if (!existsSync(mapping)) throw new Error(`no such file: ${mapping}`);
    const m = loadMapping(mapping, champs);
    if (m.unknownFields.length) {
      notes.push(`${m.unknownFields.length} mapped field(s) are not columns of the CSV and were not graded: ${m.unknownFields.join(", ")}`);
    }
    const ex = readExports(exports);
    if (ex.unreadable.length) {
      const shown = ex.unreadable.slice(0, 5).map((u) => `${u.name} (${u.why})`).join("; ");
      notes.push(`${ex.unreadable.length} export(s) could not be read as JSON and count as absent: ${shown}${ex.unreadable.length > 5 ? "; and more" : ""}`);
    }
    const read = valuesFromExports(vendor, ex, m.mapping, champs, cas.map((c) => c.id));
    if (read.wrongShape.length) {
      notes.push(`${read.wrongShape.length} export(s) are not the shape a ${vendor} adapter reads and count as absent: ${read.wrongShape.slice(0, 5).join(", ")}${read.wrongShape.length > 5 ? ", and more" : ""}`);
    }
    if (read.unmapped.length) {
      notes.push(`${read.unmapped.length} field(s) have no ${vendor} selector in the mapping and are not graded: ${read.unmapped.join(", ")}`);
    }
    /* The vendor's own failure responses are the vendor's blanks: in the denominator, and
       named (item 32). */
    if (read.failed.length) {
      const shown = read.failed.slice(0, 5).map((f) => `${f.id} (${f.why})`).join("; ");
      notes.push(`${read.failed.length} export(s) are ${vendor}'s failure response and are graded blank on every mapped field: ${shown}${read.failed.length > 5 ? "; and more" : ""}`);
    }
    for (const [field, list] of Object.entries(read.ambiguous)) {
      if (list.length === 0) continue;
      notes.push(`${field}: ${list.length} export(s) carry the selected type in several groups with different values, and the first group's value was taken. `
        + `Add "group" to the selector to say which. First: ${list[0]!.id}: ${list[0]!.why}`);
    }
    /* A selector that matched nothing anywhere grades every case blank, and the rate reads as
       the vendor's failure (item 19). That can be true: a vendor run without the feature the
       selector reads, or one that never found the field on these cases, returned nothing, and
       the blank is what the client pays for. It can also be a mistyped name. The tool cannot
       tell the two apart, so it says so LOUDLY, on the console and in the file, where the
       warning travels with the rate it qualifies; it does not decide for the client. */
    for (const [field, why] of Object.entries(read.selectorMatchedNothing)) {
      const tail = field in read.selectorFamilyMismatch
        ? `If your vendor was run without that feature, the blank is its answer and the rate below is right; if the mapping names the wrong family, fix it and grade again.`
        : `If the vendor really returned nothing for "${field}" on these cases, the blank is its failure and the rate below is right; if the name is wrong, fix the mapping and grade again.`;
      notes.push(`${why} ${tail}`);
    }
    values = read.values;
    source.vendor = vendor; source.exports = basename(exports);
    if (Object.keys(values).length === 0) throw new Error(`no field of the CSV has a ${vendor} selector: nothing was graded.`);
  }

  const { issues, coverage } = gradeValues(cas, champs, kinds, values);
  const graded = Object.values(coverage).reduce((s, c) => s + c.graded, 0);
  if (graded === 0) {
    /* The notes first: when every export was unreadable or of another shape, the identifiers
       are not the problem, and blaming them hid the note that named the files (item 24). */
    throw new Error((notes.length ? `${notes.map((n) => `⚠ ${n}`).join("\n")}\n\n` : "")
      + `no case of ${basename(fichier)} has a value in what you supplied`
      + (notes.length ? `.` : `: the identifiers do not match.`) + `\n`
      + `  CSV ids look like: ${cas.slice(0, 3).map((c) => c.id).join(", ")}\n  Nothing was written.`);
  }

  const etat = etatDuDepot();
  const out: OutcomesFile = {
    kind: "cascade-outcomes", version: 1, nom: name, issues,
    notePar: {
      outil: "cascade", version: etat ? `${etat.commit}${etat.sale.length ? " (modified tree)" : ""}` : "unknown: not a git checkout",
      correcteur: `grader v${GRADER.version}`, gradedAt: new Date().toISOString(),
      kinds: Object.fromEntries(champs.filter((c) => c in coverage).map((c) => [c, kinds[c] ?? "exact"])),
      conventions: GRADER.conventions,
    },
    declares: {
      ...(pricePerPages !== undefined ? { pricePerThousandPages: pricePerPages } : {}),
      ...(pricePerDocuments !== undefined ? { pricePerThousandDocuments: pricePerDocuments } : {}),
      ...(listPrice !== undefined ? { vendor: listPrice } : {}),
    },
    source, coverage,
    ...(notes.length ? { warnings: notes } : {}),
  };
  const chemin = arg("out") ?? fichier.replace(/\.csv$/i, "") + `-${slug(name)}-outcomes.json`;
  if (existsSync(chemin) && statSync(chemin).isDirectory()) throw new Error(`${chemin} is a directory.`);
  writeFileSync(chemin, JSON.stringify(out, null, 2));

  console.log(`\n"${name}", graded against ${basename(fichier)}: ${cas.length} case(s), ${Object.keys(coverage).length} field(s) with values.\n`);
  for (const [field, c] of Object.entries(coverage)) {
    const r = rate(c.clean, c.graded);
    console.log(`  ${field.padEnd(20)} ${(kinds[field] ?? "exact").padEnd(10)} ${writeRate(r).padEnd(30)} `
      + `clean ${c.clean}, wrong ${c.wrong}, blank ${c.blank}${c.absent ? `, absent ${c.absent}` : ""}`);
  }
  for (const n of notes) console.log(`\n  ⚠ ${n}`);
  console.log(`\n  graded by grader v${GRADER.version} at ${out.notePar.version}; kinds and conventions are written in the file.`);
  const symbol = symboleDe(UNITS.budget);
  console.log(`  price: ${price !== undefined ? `${symbol}${price} per 1,000 ${unit} (declared by you)`
    : listPrice !== undefined ? `the list price of ${listPrice}, read on the date vendor-prices.json carries; declare yours to replace it`
    : "not declared; the audit will say so"}.`);
  console.log(`\nWritten to ${chemin}: outcomes only, no value.\n`);
  console.log(`  npm run measure:yours -- --cases=${fichier} --sorties=${chemin}\n`);
}

if (isMain(import.meta)) {
  try { await principal(); }
  catch (e) { console.error(`\n${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); }
}
