/**
 * Google Document AI, read from an exported Document. Never called.
 *
 * The export is the `Document` message in its JSON form: `text`, `pages[].formFields[]` for
 * the Form Parser, `entities[]` for the specialised processors (Invoice, Expense, Identity,
 * Custom Extractor). A `ProcessResponse` wrapper (`{ "document": {...} }`) is unwrapped.
 *
 * Field names follow `google/cloud/documentai/v1/document.proto` in googleapis/googleapis
 * (Apache-2.0), read on 2026-09-29: Document.text, Document.entities with type,
 * mention_text, normalized_value (text, and one of money_value, date_value, datetime_value,
 * float_value, integer_value, boolean_value) and nested properties; Document.Page.FormField
 * with field_name and field_value as Layout carrying text_anchor.text_segments (start_index,
 * end_index, int64). In JSON the names are lowerCamelCase and the int64 offsets arrive as
 * STRINGS ("1234"), which is proto3's JSON mapping; a missing start_index means zero. Both
 * are handled, because a reader that expected numbers would slice every value at zero.
 *
 * Reviewed 2026-09-29 (item 16): proto-plus `to_dict()` and `MessageToDict(
 * preserving_proto_field_name=True)` write the proto names themselves, `mention_text` and
 * `text_anchor.text_segments[].start_index`, where the REST endpoint writes lowerCamelCase.
 * Such an export passed the shape check (`text`, `pages`, `entities` spell the same both
 * ways) and graded every entity blank. Every key is now turned into lowerCamelCase before
 * reading, recursively, so both spellings read as one; values (an entity type such as
 * `line_item/amount`, the text) are never touched.
 */

export type DocumentAiSelector =
  | { entity: string; normalized?: boolean }   /* an entity type, top-level or nested */
  | { formField: string };                     /* the printed name of a Form Parser field */

type TextSegment = { startIndex?: string | number; endIndex?: string | number };
type Layout = { textAnchor?: { textSegments?: TextSegment[]; content?: string } };
type NormalizedValue = {
  text?: string;
  moneyValue?: { currencyCode?: string; units?: string | number; nanos?: number };
  dateValue?: { year?: number; month?: number; day?: number };
  datetimeValue?: { year?: number; month?: number; day?: number; hours?: number; minutes?: number; seconds?: number };
  floatValue?: number; integerValue?: number | string; booleanValue?: boolean;
};
type Entity = {
  type?: string; mentionText?: string; confidence?: number;
  textAnchor?: Layout["textAnchor"];
  normalizedValue?: NormalizedValue;
  properties?: Entity[];
};
type Doc = {
  text?: string;
  entities?: Entity[];
  pages?: { formFields?: { fieldName?: Layout; fieldValue?: Layout }[] }[];
};

/** One proto field name in its JSON spelling: `mention_text` to `mentionText`. A leading
 *  underscore (`_synthetic`) is not a separator and stays. */
export function camelKey(k: string): string {
  return k.replace(/(?<=[a-z0-9])_+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
}

function camelKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camelKeys);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[camelKey(k)] = camelKeys(x);
  return out;
}

/* The client's object is copied with its keys renamed, not rewritten in place, and the copy
   is kept per object: reading five fields of a large Document must not walk it five times. */
const normalised = new WeakMap<object, unknown>();

function unwrap(exported: unknown): Doc | null {
  if (!exported || typeof exported !== "object") return null;
  let doc = normalised.get(exported);
  if (doc === undefined) { doc = camelKeys(exported); normalised.set(exported, doc); }
  const o = doc as { document?: unknown } & Doc;
  if (o.document && typeof o.document === "object") return o.document as Doc;
  return o;
}

export function documentAiShape(exported: unknown): "document" | null {
  const d = unwrap(exported);
  if (!d) return null;
  return Array.isArray(d.entities) || Array.isArray(d.pages) || typeof d.text === "string" ? "document" : null;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * A failed call, or `null` for a Document. The REST endpoint and the client libraries write
 * `google.rpc.Status` in its JSON form, `{ "error": { "code", "message", "status" } }`, in
 * place of a Document. Reviewed 2026-09-29 (item 32): such a file read as the wrong shape and
 * dropped out of the denominator. A Document never has a top-level `error`, so the key tells
 * them apart, provided nothing of a Document sits beside it. One line, no value.
 */
export function documentAiFailed(exported: unknown): string | null {
  if (!exported || typeof exported !== "object" || Array.isArray(exported)) return null;
  const o = exported as { error?: unknown; document?: unknown } & Doc;
  if (!o.error || typeof o.error !== "object") return null;
  if (o.document || Array.isArray(o.entities) || Array.isArray(o.pages) || typeof o.text === "string") return null;
  const e = o.error as { code?: unknown; message?: unknown; status?: unknown };
  const label = typeof e.status === "string" ? e.status
    : typeof e.code === "number" || typeof e.code === "string" ? `code ${e.code}` : "error";
  return oneLine(`${label}: ${typeof e.message === "string" ? e.message : "no message"}`);
}

/**
 * What a selector family reads, for the message that says a selector matched nothing
 * (item 19): a `formField` on Invoice Parser output, which has entities and no pages, graded
 * every case blank without a word.
 */
export function documentAiNeeds(selector: DocumentAiSelector): string {
  return "entity" in selector
    ? `"entities" as a specialised processor writes them (Invoice, Expense, Identity, Custom Extractor)`
    : `"pages[].formFields" as the Form Parser writes them`;
}

/** Whether the export carries the part this selector's family reads (item 19). The shape
 *  name is one word, "document", for both parts, so this looks at the export itself. */
export function documentAiFits(exported: unknown, selector: DocumentAiSelector): boolean {
  const d = unwrap(exported);
  if (!d) return false;
  if ("entity" in selector) return Array.isArray(d.entities);
  return (d.pages ?? []).some((p) => Array.isArray(p?.formFields));
}

export function isDocumentAiSelector(x: unknown): x is DocumentAiSelector {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const keys = ["entity", "formField"].filter((k) => k in o);
  if (keys.length !== 1) return false;
  if (typeof o[keys[0]!] !== "string" || (o[keys[0]!] as string).trim().length === 0) return false;
  if ("normalized" in o && (typeof o.normalized !== "boolean" || keys[0] !== "entity")) return false;
  return true;
}

/** The text an anchor points at, sliced from the document's text. */
export function anchoredText(text: string, layout: Layout | undefined): string {
  const segments = layout?.textAnchor?.textSegments;
  if (!segments || segments.length === 0) return (layout?.textAnchor?.content ?? "").trim();
  const parts: string[] = [];
  for (const s of segments) {
    const start = Number(s.startIndex ?? 0), end = Number(s.endIndex ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    parts.push(text.slice(start, end));
  }
  return parts.join("").trim();
}

export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[:\s]+$/g, "").replace(/\s+/g, " ").trim();
}

/**
 * A normalised value as one string, or `undefined` when there is none to render. Reviewed
 * 2026-09-29 (item 30): the parsers write `text` for dates and most amounts, and only the
 * typed value for floats, integers, booleans and some amounts, so `normalized: true` graded
 * those blank. The order: `text` when it is there and not empty; else the typed value, one of
 * the proto's oneof:
 *   moneyValue      `<units>.<decimals>`, the decimals from nanos with at least two digits
 *                   (units "12", nanos 500000000 is "12.50"; nanos 125000000 is "0.125");
 *                   the amount only, no currency code: the amount kind grades numbers;
 *   dateValue       YYYY-MM-DD, zero-padded (a 0 part, proto's "unspecified", reads as 00);
 *   datetimeValue   YYYY-MM-DD as well: the date kind compares days, and Textract's midnight
 *                   timestamps are cut to the day for the same reason; the time is dropped;
 *   floatValue, integerValue, booleanValue   through String().
 * With none of them the caller falls back to the mention, exactly like the non-normalised
 * path: the vendor read the field, it just did not normalise it.
 */
export function renderNormalized(n: NormalizedValue | undefined): string | undefined {
  if (!n || typeof n !== "object") return undefined;
  if (typeof n.text === "string" && n.text.trim().length > 0) return n.text.trim();
  if (n.moneyValue && typeof n.moneyValue === "object") return renderMoney(n.moneyValue);
  if (n.dateValue && typeof n.dateValue === "object") return renderDate(n.dateValue);
  if (n.datetimeValue && typeof n.datetimeValue === "object") return renderDate(n.datetimeValue);
  if (typeof n.floatValue === "number") return String(n.floatValue);
  if (typeof n.integerValue === "number" || typeof n.integerValue === "string") return String(n.integerValue);
  if (typeof n.booleanValue === "boolean") return String(n.booleanValue);
  return undefined;
}

function renderMoney(m: { units?: string | number; nanos?: number }): string {
  const units = String(m.units ?? "0").trim();
  const nanos = typeof m.nanos === "number" && Number.isFinite(m.nanos) ? Math.trunc(m.nanos) : 0;
  const negative = units.startsWith("-") || nanos < 0;
  const whole = units.replace(/^[-+]/, "") || "0";
  const decimals = String(Math.abs(nanos)).padStart(9, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${decimals}`;
}

function renderDate(d: { year?: number; month?: number; day?: number }): string {
  const pad = (n: number | undefined, width: number) => String(Math.trunc(Number(n ?? 0)) || 0).padStart(width, "0");
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;
}

function findEntity(entities: Entity[], type: string): Entity | undefined {
  for (const e of entities) {
    if ((e.type ?? "") === type) return e;
  }
  /* Nested properties, breadth after depth zero: a line item's amount lives under its line. */
  for (const e of entities) {
    if (e.properties && e.properties.length) {
      const found = findEntity(e.properties, type);
      if (found) return found;
    }
  }
  return undefined;
}

export function documentAiValue(exported: unknown, selector: DocumentAiSelector): string | undefined {
  const d = unwrap(exported);
  if (!d) return undefined;
  const text = d.text ?? "";
  if ("entity" in selector) {
    const e = findEntity(d.entities ?? [], selector.entity.trim());
    if (!e) return undefined;
    if (selector.normalized) {
      const n = renderNormalized(e.normalizedValue);
      if (n !== undefined) return n;
    }
    if (typeof e.mentionText === "string") return e.mentionText.trim();
    return anchoredText(text, { textAnchor: e.textAnchor });
  }
  const wanted = normaliseName(selector.formField);
  for (const page of d.pages ?? []) {
    for (const f of page.formFields ?? []) {
      if (normaliseName(anchoredText(text, f.fieldName)) !== wanted) continue;
      return anchoredText(text, f.fieldValue);
    }
  }
  return undefined;
}
