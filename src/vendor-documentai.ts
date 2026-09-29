/**
 * Google Document AI, read from an exported Document. Never called.
 *
 * The export is the `Document` message in its JSON form: `text`, `pages[].formFields[]` for
 * the Form Parser, `entities[]` for the specialised processors (Invoice, Expense, Identity,
 * Custom Extractor). A `ProcessResponse` wrapper (`{ "document": {...} }`) is unwrapped.
 *
 * Field names follow `google/cloud/documentai/v1/document.proto` in googleapis/googleapis
 * (Apache-2.0), read on 2026-09-29: Document.text, Document.entities with type,
 * mention_text, normalized_value.text and nested properties; Document.Page.FormField with
 * field_name and field_value as Layout carrying text_anchor.text_segments (start_index,
 * end_index, int64). In JSON the names are lowerCamelCase and the int64 offsets arrive as
 * STRINGS ("1234"), which is proto3's JSON mapping; a missing start_index means zero. Both
 * are handled, because a reader that expected numbers would slice every value at zero.
 */

export type DocumentAiSelector =
  | { entity: string; normalized?: boolean }   /* an entity type, top-level or nested */
  | { formField: string };                     /* the printed name of a Form Parser field */

type TextSegment = { startIndex?: string | number; endIndex?: string | number };
type Layout = { textAnchor?: { textSegments?: TextSegment[]; content?: string } };
type Entity = {
  type?: string; mentionText?: string; confidence?: number;
  textAnchor?: Layout["textAnchor"];
  normalizedValue?: { text?: string };
  properties?: Entity[];
};
type Doc = {
  text?: string;
  entities?: Entity[];
  pages?: { formFields?: { fieldName?: Layout; fieldValue?: Layout }[] }[];
};

function unwrap(exported: unknown): Doc | null {
  if (!exported || typeof exported !== "object") return null;
  const o = exported as { document?: unknown } & Doc;
  if (o.document && typeof o.document === "object") return o.document as Doc;
  return o;
}

export function documentAiShape(exported: unknown): "document" | null {
  const d = unwrap(exported);
  if (!d) return null;
  return Array.isArray(d.entities) || Array.isArray(d.pages) || typeof d.text === "string" ? "document" : null;
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
    if (selector.normalized) return (e.normalizedValue?.text ?? "").trim();
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
