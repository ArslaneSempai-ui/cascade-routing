/**
 * The vendors whose exports this tool can read, and the mapping that names their fields.
 *
 * Three adapters, one shape each, all offline: `vendor-textract.ts`, `vendor-documentai.ts`,
 * `vendor-azure.ts`. This module is what the `grade` command talks to: it validates a
 * mapping file, reads a folder of exports, and returns one value per field and per case. It
 * never returns anything the client did not already have on disk, and nothing it returns
 * leaves the machine: the values feed the grader, and only outcomes are written.
 *
 * ─── The mapping file ───
 *
 *     {
 *       "total":        { "textract": { "type": "TOTAL" },
 *                         "documentai": { "entity": "total_amount" },
 *                         "azure": { "field": "InvoiceTotal" } },
 *       "invoice_date": { "textract": { "query": "invoice date" },
 *                         "documentai": { "formField": "Invoice Date" },
 *                         "azure": { "keyValue": "Date" } }
 *     }
 *
 * One entry per field of the labelled CSV, one selector per vendor the client exports from.
 * A vendor without a selector for a field is simply not graded on it, and the command says
 * so. A field the CSV does not have is named and skipped, like a rule for a missing column.
 *
 * ─── The exports ───
 *
 * A folder holding one JSON per case, named `<case id>.json`; or a single JSON object keyed
 * by case id. A case with no export is ABSENT from the outcomes (it was never sent to the
 * vendor, or the export was lost) and is counted apart. A case whose export lacks the mapped
 * key is graded BLANK: the vendor read the document and returned nothing for that field.
 * The two are different failures and they are kept different.
 *
 * ─── What is reported beside the values ───
 *
 * Reviewed 2026-09-29. A vendor's FAILED response (item 32) is graded blank on every mapped
 * field and listed with its reason: the client paid for that page and got nothing, so it
 * stays in the denominator instead of dropping out as "absent". A selector that matched
 * nothing in ANY export read (item 19) is reported by field with its reason, because a
 * mistyped type or a FORMS selector on AnalyzeExpense output otherwise grades every case
 * blank and the rate reads as the vendor's. Per case, a selector miss is kept apart from an
 * empty vendor value (`notFound`), though both are graded blank, as before. And an export
 * where the selector matched several things that disagree (item 31, the same type in two
 * GroupProperties) is listed so the client can name the group.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { readJsonFile, parseJsonBytes } from "./json-file.ts";
import { textractValue, textractShape, isTextractSelector, textractFailed, textractFits, textractNeeds, textractAmbiguous, type TextractSelector } from "./vendor-textract.ts";
import { documentAiValue, documentAiShape, isDocumentAiSelector, documentAiFailed, documentAiFits, documentAiNeeds, type DocumentAiSelector } from "./vendor-documentai.ts";
import { azureValue, azureShape, isAzureSelector, azureFailed, azureFits, azureNeeds, type AzureSelector } from "./vendor-azure.ts";

export type VendorName = "textract" | "documentai" | "azure";
export const VENDORS: readonly VendorName[] = ["textract", "documentai", "azure"];

export type Selector = TextractSelector | DocumentAiSelector | AzureSelector;
export type Mapping = Record<string, Partial<Record<VendorName, Selector>>>;

export type Adapter = {
  label: string;
  /** The shape this adapter reads, or `null` when the export is none of them. */
  shape: (exported: unknown) => string | null;
  isSelector: (x: unknown) => boolean;
  /** The value of one field, "" when the vendor returned it empty, `undefined` when the selector matched nothing. */
  value: (exported: unknown, selector: never) => string | undefined;
  /** The selectors this adapter accepts, for the mapping's refusals and the help. */
  selectors: string;
  /** A one-line reason when the export is the vendor's failed response (item 32), else `null`. */
  failed?: (exported: unknown) => string | null;
  /**
   * Whether the export carries the part this selector's family reads (item 19): a `key`
   * needs AnalyzeDocument output, a `formField` needs pages[].formFields, a `keyValue` needs
   * keyValuePairs. It takes the export rather than its shape name because Document AI's shape
   * is one word for two parts. `needs` says what the family reads, for the reason text.
   */
  fits?: (exported: unknown, selector: never) => boolean;
  needs?: (selector: never) => string;
  /** A one-line reason when the selector matched several things that disagree (item 31), else `null`. */
  ambiguous?: (exported: unknown, selector: never) => string | null;
};

export const ADAPTERS: Record<VendorName, Adapter> = {
  textract: {
    label: "Amazon Textract",
    shape: textractShape, isSelector: isTextractSelector,
    value: textractValue as Adapter["value"],
    selectors: `{ "key": "<printed label>" } | { "query": "<alias or question>" } | { "type": "TOTAL" } | { "type": "NAME", "group": "VENDOR" } | { "label": "<printed label>" }`,
    failed: textractFailed,
    fits: textractFits as Adapter["fits"], needs: textractNeeds as Adapter["needs"],
    ambiguous: textractAmbiguous as Adapter["ambiguous"],
  },
  documentai: {
    label: "Google Document AI",
    shape: documentAiShape, isSelector: isDocumentAiSelector,
    value: documentAiValue as Adapter["value"],
    selectors: `{ "entity": "<entity type>" } | { "formField": "<printed name>" }`,
    failed: documentAiFailed,
    fits: documentAiFits as Adapter["fits"], needs: documentAiNeeds as Adapter["needs"],
  },
  azure: {
    label: "Azure AI Document Intelligence",
    shape: azureShape, isSelector: isAzureSelector,
    value: azureValue as Adapter["value"],
    selectors: `{ "field": "<model field, dotted for nesting>" } | { "keyValue": "<printed key>" }`,
    failed: azureFailed,
    fits: azureFits as Adapter["fits"], needs: azureNeeds as Adapter["needs"],
  },
};

export function isVendorName(x: unknown): x is VendorName {
  return typeof x === "string" && (VENDORS as readonly string[]).includes(x);
}

/**
 * Read and validate a mapping file. Every selector is checked against its vendor's shape
 * before a single export is opened: a selector that names no vendor key would grade every
 * case blank and the rate would read as the vendor's failure. Read through `readJsonFile`
 * (item 24): a byte-order mark reads, a UTF-16 file is refused by name.
 */
export function loadMapping(path: string, fields: readonly string[]): { mapping: Mapping; unknownFields: string[] } {
  const raw = readJsonFile(path);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path}: expected an object { "<field>": { "<vendor>": <selector> } }.`);
  }
  const mapping: Mapping = Object.create(null);
  const unknownFields: string[] = [];
  const known = new Set(fields);
  for (const [field, byVendor] of Object.entries(raw as Record<string, unknown>)) {
    if (!byVendor || typeof byVendor !== "object" || Array.isArray(byVendor)) {
      throw new Error(`${path}: the entry for "${field}" must be an object { "<vendor>": <selector> }.`);
    }
    const entry: Partial<Record<VendorName, Selector>> = {};
    for (const [vendor, selector] of Object.entries(byVendor as Record<string, unknown>)) {
      if (!isVendorName(vendor)) {
        throw new Error(`${path}: "${field}" names a vendor "${vendor}" this tool cannot read.\n`
          + `  Known: ${VENDORS.join(", ")}.`);
      }
      if (!ADAPTERS[vendor].isSelector(selector)) {
        throw new Error(`${path}: the ${vendor} selector for "${field}" is not one this adapter reads.\n`
          + `  Accepted: ${ADAPTERS[vendor].selectors}\n  Got: ${JSON.stringify(selector)}`);
      }
      entry[vendor] = selector as Selector;
    }
    if (Object.keys(entry).length === 0) {
      throw new Error(`${path}: "${field}" has no selector for any vendor.`);
    }
    mapping[field] = entry;
    if (!known.has(field)) unknownFields.push(field);
  }
  if (Object.keys(mapping).length === 0) throw new Error(`${path} is empty: no field is mapped.`);
  if (unknownFields.length === Object.keys(mapping).length) {
    throw new Error(`${path}: none of its ${unknownFields.length} field(s) is a column of the CSV.\n`
      + `  Mapped: ${unknownFields.join(", ")}\n  Columns: ${fields.join(", ")}\n`
      + `  Nothing would be graded.`);
  }
  return { mapping, unknownFields };
}

export type Exports = { byId: Map<string, unknown>; source: string; unreadable: { name: string; why: string }[] };

/**
 * One JSON per case in a folder, or one object keyed by case id. Each file goes through
 * `parseJsonBytes` (item 24): PowerShell writes UTF-8 with a byte-order mark, which now
 * reads, and UTF-16, which is named in `unreadable` with its encoding instead of "Unexpected
 * token".
 */
export function readExports(path: string): Exports {
  const byId = new Map<string, unknown>();
  const unreadable: { name: string; why: string }[] = [];
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      const id = basename(name, name.slice(name.length - 5));
      try { byId.set(id, parseJsonBytes(readFileSync(join(path, name)), name)); }
      catch (e) { unreadable.push({ name, why: (e as Error).message }); }
    }
    return { byId, source: `folder ${basename(path)}`, unreadable };
  }
  const raw = readJsonFile(path);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path}: expected an object keyed by case id, { "<id>": <vendor response> }, or a folder of <id>.json files.`);
  }
  for (const [id, response] of Object.entries(raw as Record<string, unknown>)) byId.set(id, response);
  return { byId, source: `file ${basename(path)}`, unreadable };
}

export type VendorValues = {
  /** `values[field][id]`: the value as the vendor wrote it; "" when it returned nothing. */
  values: Record<string, Record<string, string>>;
  /** Cases with no export at all, per field: absent, counted apart from blanks. */
  absent: Record<string, string[]>;
  /** Fields of the CSV this vendor has no selector for. */
  unmapped: string[];
  /** Exports whose shape is not the one this adapter reads, named. */
  wrongShape: string[];
  /** Exports that are the vendor's failed response, with the reason: graded "" on every mapped field (item 32). */
  failed: { id: string; why: string }[];
  /** Per field: the right-shape exports where the selector matched nothing; graded "" all the same (item 19). */
  notFound: Record<string, string[]>;
  /** Per field: the reason, when the selector matched nothing in EVERY right-shape export read (item 19). */
  selectorMatchedNothing: Record<string, string>;
  /** The subset of those where the selector's FAMILY fits none of the shapes read (a `key` on
      AnalyzeExpense output): a mapping error for certain, not a vendor that returned nothing. */
  selectorFamilyMismatch: Record<string, string>;
  /** Per field: the exports where the selector matched several things that disagree, with the reason (item 31). */
  ambiguous: Record<string, { id: string; why: string }[]>;
};

/**
 * Every mapped field of every case, read from the exports. Pure over its inputs: the tests
 * feed it fixtures, the command feeds it the client's folder.
 */
export function valuesFromExports(vendor: VendorName, exports: Exports, mapping: Mapping, fields: readonly string[], caseIds: readonly string[]): VendorValues {
  const adapter = ADAPTERS[vendor];
  const values: Record<string, Record<string, string>> = {};
  const absent: Record<string, string[]> = {};
  const unmapped = fields.filter((f) => !mapping[f]?.[vendor]);
  const wrongShape: string[] = [];
  const failed: { id: string; why: string }[] = [];
  const notFound: Record<string, string[]> = {};
  const selectorMatchedNothing: Record<string, string> = {};
  const selectorFamilyMismatch: Record<string, string> = {};
  const ambiguous: Record<string, { id: string; why: string }[]> = {};

  /* Each export is one of three things, decided once: the vendor's failed response, a shape
     this adapter reads, or something else. A failure is looked for first: it has no Blocks,
     no documents, no entities, and would otherwise read as the wrong shape. */
  const status = new Map<string, "failed" | "ok" | "wrong">();
  const shapeOf = new Map<string, string>();
  for (const [id, exported] of exports.byId) {
    const why = adapter.failed?.(exported) ?? null;
    if (why !== null) { failed.push({ id, why }); status.set(id, "failed"); continue; }
    const shape = adapter.shape(exported);
    if (shape === null) { wrongShape.push(id); status.set(id, "wrong"); continue; }
    status.set(id, "ok"); shapeOf.set(id, shape);
  }

  for (const field of fields) {
    const selector = mapping[field]?.[vendor];
    if (!selector) continue;
    values[field] = {}; absent[field] = []; notFound[field] = []; ambiguous[field] = [];
    let read = 0, fits = false;
    const shapes = new Set<string>();
    for (const id of caseIds) {
      const s = status.get(id);
      if (s === undefined || s === "wrong") { absent[field]!.push(id); continue; }
      if (s === "failed") { values[field]![id] = ""; continue; }
      const exported = exports.byId.get(id);
      read++; shapes.add(shapeOf.get(id)!);
      if (adapter.fits?.(exported, selector as never) ?? true) fits = true;
      const v = adapter.value(exported, selector as never);
      if (v === undefined) notFound[field]!.push(id);
      else {
        const why = adapter.ambiguous?.(exported, selector as never) ?? null;
        if (why !== null) ambiguous[field]!.push({ id, why });
      }
      values[field]![id] = v ?? "";
    }
    if (read > 0 && notFound[field]!.length === read) {
      selectorMatchedNothing[field] = deadSelector(adapter, vendor, field, selector, read, fits, [...shapes]);
      if (!fits && adapter.needs) selectorFamilyMismatch[field] = selectorMatchedNothing[field]!;
    }
  }
  return { values, absent, unmapped, wrongShape, failed, notFound, selectorMatchedNothing, selectorFamilyMismatch, ambiguous };
}

/** One line: the field, the selector, how many exports were read, and whether the family fits their shape. */
function deadSelector(adapter: Adapter, vendor: VendorName, field: string, selector: Selector, read: number, fits: boolean, shapes: string[]): string {
  const head = `the ${vendor} selector ${JSON.stringify(selector)} for "${field}" matched nothing in any of the ${read} export(s) read`;
  if (!fits && adapter.needs) {
    return `${head}; it reads ${adapter.needs(selector as never)}, and none of them carries that (shape found: ${shapes.join(", ")}). Every case is graded blank.`;
  }
  return `${head}; the shape fits (${shapes.join(", ")}), so check the name against one export. Every case is graded blank.`;
}
