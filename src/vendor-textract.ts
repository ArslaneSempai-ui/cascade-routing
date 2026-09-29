/**
 * Amazon Textract, read from an exported response. Never called.
 *
 * The client already pays Textract; what it returned sits in their bucket or on their disk as
 * JSON. This adapter reads that JSON and hands back one value per field, as the vendor wrote
 * it. It opens no connection: `CASCADE_OFFLINE=1` changes nothing here because there is
 * nothing to cut.
 *
 * Four response shapes, told apart by their top-level key:
 *
 *   AnalyzeDocument   `Blocks`            FORMS (KEY_VALUE_SET) and QUERIES (QUERY, QUERY_RESULT)
 *   AnalyzeExpense    `ExpenseDocuments`  SummaryFields typed TOTAL, VENDOR_NAME, INVOICE_RECEIPT_DATE...
 *   AnalyzeID         `IdentityDocuments` IdentityDocumentFields typed FIRST_NAME, DATE_OF_BIRTH...
 *
 * Field names and enum values follow the service model of the AWS SDK for JavaScript v3
 * (`clients/client-textract/src/models/models_0.ts`, Apache-2.0), read on 2026-09-29 as the
 * authoritative schema: Block.BlockType, Block.EntityTypes, Relationship.Type (VALUE, CHILD,
 * ANSWER), Query.Text and Query.Alias, ExpenseField.Type.Text with LabelDetection and
 * ValueDetection, IdentityDocumentField.Type.Text with ValueDetection.NormalizedValue.
 *
 * A paginated asynchronous result (GetDocumentAnalysis with NextToken) arrives as several
 * responses; an array of responses is merged before reading.
 */

export type TextractSelector =
  | { key: string }                        /* FORMS: the printed label of a key-value pair */
  | { query: string }                      /* QUERIES: the alias, or the question text */
  | { type: string; normalized?: boolean } /* AnalyzeExpense or AnalyzeID: the typed field */
  | { label: string };                     /* AnalyzeExpense: the printed label */

type Block = {
  BlockType?: string; Id?: string; Text?: string; Confidence?: number; Page?: number;
  EntityTypes?: string[]; SelectionStatus?: string;
  Relationships?: { Type?: string; Ids?: string[] }[];
  Query?: { Text?: string; Alias?: string };
};

type ExpenseField = {
  Type?: { Text?: string; Confidence?: number };
  LabelDetection?: { Text?: string };
  ValueDetection?: { Text?: string; Confidence?: number };
  PageNumber?: number;
};

type IdentityField = {
  Type?: { Text?: string };
  ValueDetection?: { Text?: string; NormalizedValue?: { Value?: string; ValueType?: string }; Confidence?: number };
};

type Response = {
  Blocks?: Block[];
  ExpenseDocuments?: { ExpenseIndex?: number; SummaryFields?: ExpenseField[] }[];
  IdentityDocuments?: { DocumentIndex?: number; IdentityDocumentFields?: IdentityField[] }[];
};

/** Labels are compared loosely: case, trailing colons and spacing are print, not meaning. */
export function normaliseLabel(s: string): string {
  return s.toLowerCase().replace(/[:\s]+$/g, "").replace(/\s+/g, " ").trim();
}

function merge(exported: unknown): Response {
  const parts = Array.isArray(exported) ? exported : [exported];
  const out: Response = {};
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const r = p as Response;
    if (Array.isArray(r.Blocks)) (out.Blocks ??= []).push(...r.Blocks);
    if (Array.isArray(r.ExpenseDocuments)) (out.ExpenseDocuments ??= []).push(...r.ExpenseDocuments);
    if (Array.isArray(r.IdentityDocuments)) (out.IdentityDocuments ??= []).push(...r.IdentityDocuments);
  }
  return out;
}

/** Which of the four shapes an export is; `null` when it is none of them. */
export function textractShape(exported: unknown): "analyze-document" | "analyze-expense" | "analyze-id" | null {
  const r = merge(exported);
  if (r.IdentityDocuments) return "analyze-id";
  if (r.ExpenseDocuments) return "analyze-expense";
  if (r.Blocks) return "analyze-document";
  return null;
}

export function isTextractSelector(x: unknown): x is TextractSelector {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const keys = ["key", "query", "type", "label"].filter((k) => k in o);
  if (keys.length !== 1) return false;
  if (typeof o[keys[0]!] !== "string" || (o[keys[0]!] as string).trim().length === 0) return false;
  if ("normalized" in o && typeof o.normalized !== "boolean") return false;
  if ("normalized" in o && keys[0] !== "type") return false;
  return true;
}

/**
 * The value of one field in one export, or `undefined` when the export has no such key,
 * query, type or label. An empty string is a value the vendor returned empty, and it is
 * returned as such: blank and absent are not the same outcome.
 */
export function textractValue(exported: unknown, selector: TextractSelector): string | undefined {
  const r = merge(exported);
  if ("key" in selector) return formsValue(r.Blocks ?? [], selector.key);
  if ("query" in selector) return queryValue(r.Blocks ?? [], selector.query);
  if ("label" in selector) {
    for (const d of r.ExpenseDocuments ?? []) {
      const f = (d.SummaryFields ?? []).find((x) => normaliseLabel(x.LabelDetection?.Text ?? "") === normaliseLabel(selector.label));
      if (f) return f.ValueDetection?.Text ?? "";
    }
    return undefined;
  }
  const wanted = selector.type.trim().toUpperCase();
  for (const d of r.ExpenseDocuments ?? []) {
    const f = (d.SummaryFields ?? []).find((x) => (x.Type?.Text ?? "").toUpperCase() === wanted);
    if (f) return f.ValueDetection?.Text ?? "";
  }
  for (const d of r.IdentityDocuments ?? []) {
    const f = (d.IdentityDocumentFields ?? []).find((x) => (x.Type?.Text ?? "").toUpperCase() === wanted);
    if (f) {
      if (selector.normalized) {
        const v = f.ValueDetection?.NormalizedValue?.Value;
        /* Textract writes a normalised date as an ISO timestamp at midnight; the day is
           what the field means, and what a date kind compares. */
        if (typeof v === "string") return v.replace(/T00:00:00(?:\.0+)?Z?$/, "");
      }
      return f.ValueDetection?.Text ?? "";
    }
  }
  return undefined;
}

function textOfChildren(block: Block, byId: Map<string, Block>): string {
  const words: string[] = [];
  for (const rel of block.Relationships ?? []) {
    if (rel.Type !== "CHILD") continue;
    for (const id of rel.Ids ?? []) {
      const child = byId.get(id);
      if (!child) continue;
      if (child.BlockType === "WORD" && typeof child.Text === "string") words.push(child.Text);
      else if (child.BlockType === "SELECTION_ELEMENT") words.push(child.SelectionStatus === "SELECTED" ? "SELECTED" : "NOT_SELECTED");
    }
  }
  return words.join(" ").trim();
}

function formsValue(blocks: Block[], key: string): string | undefined {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);
  const wanted = normaliseLabel(key);
  for (const b of blocks) {
    if (b.BlockType !== "KEY_VALUE_SET" || !(b.EntityTypes ?? []).includes("KEY")) continue;
    if (normaliseLabel(textOfChildren(b, byId)) !== wanted) continue;
    const values: string[] = [];
    for (const rel of b.Relationships ?? []) {
      if (rel.Type !== "VALUE") continue;
      for (const id of rel.Ids ?? []) {
        const v = byId.get(id);
        if (v) values.push(textOfChildren(v, byId));
      }
    }
    return values.join(" ").trim();
  }
  return undefined;
}

function queryValue(blocks: Block[], query: string): string | undefined {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);
  const wanted = normaliseLabel(query);
  for (const b of blocks) {
    if (b.BlockType !== "QUERY") continue;
    const alias = b.Query?.Alias, text = b.Query?.Text;
    if (!((alias && normaliseLabel(alias) === wanted) || (text && normaliseLabel(text) === wanted))) continue;
    let best: Block | undefined;
    for (const rel of b.Relationships ?? []) {
      if (rel.Type !== "ANSWER") continue;
      for (const id of rel.Ids ?? []) {
        const a = byId.get(id);
        if (a?.BlockType === "QUERY_RESULT" && (!best || (a.Confidence ?? 0) > (best.Confidence ?? 0))) best = a;
      }
    }
    /* A query with no answer is a question the service could not answer: an empty value. */
    return (best?.Text ?? "").trim();
  }
  return undefined;
}
