/**
 * Amazon Textract, read from an exported response. Never called.
 *
 * The client already pays Textract; what it returned sits in their bucket or on their disk as
 * JSON. This adapter reads that JSON and hands back one value per field, as the vendor wrote
 * it. It opens no connection: `CRUSETRA_OFFLINE=1` changes nothing here because there is
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
 * ANSWER), Query.Text, Query.Alias and Query.Pages, ExpenseField.Type.Text with
 * LabelDetection, ValueDetection and GroupProperties (Types, Id), IdentityDocumentField.Type.Text
 * with ValueDetection.NormalizedValue, and GetDocumentAnalysis.JobStatus with StatusMessage.
 *
 * A paginated asynchronous result (GetDocumentAnalysis with NextToken) arrives as several
 * responses; an array of responses is merged before reading.
 */

export type TextractSelector =
  | { key: string }                                        /* FORMS: the printed label of a key-value pair */
  | { query: string }                                      /* QUERIES: the alias, or the question text */
  | { type: string; normalized?: boolean; group?: string } /* AnalyzeExpense or AnalyzeID: the typed field, in one party's group */
  | { label: string };                                     /* AnalyzeExpense: the printed label */

type Block = {
  BlockType?: string; Id?: string; Text?: string; Confidence?: number; Page?: number;
  EntityTypes?: string[]; SelectionStatus?: string;
  Relationships?: { Type?: string; Ids?: string[] }[];
  Query?: { Text?: string; Alias?: string; Pages?: string[] };
};

type ExpenseField = {
  Type?: { Text?: string; Confidence?: number };
  LabelDetection?: { Text?: string };
  ValueDetection?: { Text?: string; Confidence?: number };
  PageNumber?: number;
  GroupProperties?: { Types?: string[]; Id?: string }[];
};

type IdentityField = {
  Type?: { Text?: string };
  ValueDetection?: { Text?: string; NormalizedValue?: { Value?: string; ValueType?: string }; Confidence?: number };
};

type Response = {
  Blocks?: Block[];
  ExpenseDocuments?: { ExpenseIndex?: number; SummaryFields?: ExpenseField[] }[];
  IdentityDocuments?: { DocumentIndex?: number; IdentityDocumentFields?: IdentityField[] }[];
  JobStatus?: string; StatusMessage?: string;
  __type?: string; Message?: string; message?: string;
  Error?: { Code?: string; Message?: string };
};

/** Labels are compared loosely: case, trailing colons and spacing are print, not meaning. */
export function normaliseLabel(s: string): string {
  return s.toLowerCase().replace(/[:\s]+$/g, "").replace(/\s+/g, " ").trim();
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 200);
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

/**
 * A failed call, as Textract writes one, or `null` for a result. Three spellings: the JSON
 * protocol's exception body (`__type` ending in Exception, with `Message`), the envelope the
 * CLI and the SDK v2 write (`Error: { Code, Message }`), and an asynchronous job whose
 * `JobStatus` is FAILED. Reviewed 2026-09-29 (item 32): such a file has no Blocks, read as
 * the wrong shape and dropped out of the denominator, so twenty successes and five failed
 * jobs quoted 100 % on n=20. PARTIAL_SUCCESS is not a failure here: it still carries the
 * Blocks of the pages that were read, and those are what is graded. A paginated array is
 * failed when any of its pages says so. The reason is one line and carries no value.
 */
export function textractFailed(exported: unknown): string | null {
  const parts = Array.isArray(exported) ? exported : [exported];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const r = p as Response;
    const type = typeof r.__type === "string" ? r.__type.split("#").pop()! : "";
    if (/(Exception|Error)$/.test(type)) return oneLine(`${type}: ${r.Message ?? r.message ?? "no message"}`);
    if (r.Error && typeof r.Error === "object" && (typeof r.Error.Code === "string" || typeof r.Error.Message === "string")) {
      return oneLine(`${r.Error.Code ?? "error"}: ${r.Error.Message ?? "no message"}`);
    }
    if (typeof r.JobStatus === "string" && r.JobStatus.toUpperCase() === "FAILED") {
      return oneLine(`JobStatus FAILED: ${r.StatusMessage ?? "no status message"}`);
    }
  }
  return null;
}

/**
 * What a selector family reads, for the message that says a selector matched nothing.
 * Reviewed 2026-09-29 (item 19): `{ "key": "Total" }` on AnalyzeExpense output graded every
 * case blank without a word, and the rate read as the vendor's.
 */
export function textractNeeds(selector: TextractSelector): string {
  if ("key" in selector) return `AnalyzeDocument FORMS output (KEY_VALUE_SET blocks under "Blocks")`;
  if ("query" in selector) return `AnalyzeDocument QUERIES output (QUERY blocks under "Blocks")`;
  if ("label" in selector) return `AnalyzeExpense output ("ExpenseDocuments")`;
  return `AnalyzeExpense or AnalyzeID output ("ExpenseDocuments" or "IdentityDocuments")`;
}

/** Whether an export is a shape this selector's family reads at all (item 19). */
export function textractFits(exported: unknown, selector: TextractSelector): boolean {
  const shape = textractShape(exported);
  if ("key" in selector || "query" in selector) return shape === "analyze-document";
  if ("label" in selector) return shape === "analyze-expense";
  return shape === "analyze-expense" || shape === "analyze-id";
}

export function isTextractSelector(x: unknown): x is TextractSelector {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const keys = ["key", "query", "type", "label"].filter((k) => k in o);
  if (keys.length !== 1) return false;
  if (typeof o[keys[0]!] !== "string" || (o[keys[0]!] as string).trim().length === 0) return false;
  if ("normalized" in o && typeof o.normalized !== "boolean") return false;
  if ("normalized" in o && keys[0] !== "type") return false;
  /* `group` names the party of an AnalyzeExpense field (item 31); it only means something on a type. */
  if ("group" in o && (typeof o.group !== "string" || o.group.trim().length === 0 || keys[0] !== "type")) return false;
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
    const wanted = normaliseLabel(selector.label);
    const values: string[] = [];
    for (const d of r.ExpenseDocuments ?? []) {
      for (const f of d.SummaryFields ?? []) {
        if (normaliseLabel(f.LabelDetection?.Text ?? "") === wanted) values.push(f.ValueDetection?.Text ?? "");
      }
    }
    return firstNonEmpty(values);
  }
  return firstNonEmpty(typedMatches(r, selector).map((m) => m.value));
}

/**
 * The first NON-EMPTY value among the fields that matched, in document order; "" when
 * fields matched and every one is empty; `undefined` when none matched. Reviewed 2026-09-29
 * (item 17): AnalyzeID returns one IdentityDocument per side, and a field not printed on a
 * side comes back with an empty Text. Read from the first document only, the back of a
 * licence hid the FIRST_NAME on its front. AnalyzeExpense is read the same way: one
 * ExpenseDocument per receipt in a multi-receipt call.
 */
function firstNonEmpty(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  return values.find((v) => v.trim().length > 0) ?? "";
}

type Matched = { value: string; groups: string[] };

/** The GroupProperties types of an expense field, upper-cased; empty for an ungrouped field. */
function groupsOf(f: ExpenseField): string[] {
  const out: string[] = [];
  for (const g of f.GroupProperties ?? []) for (const t of g.Types ?? []) if (typeof t === "string") out.push(t.trim().toUpperCase());
  return out;
}

function identityText(f: IdentityField, normalized: boolean): string {
  if (normalized) {
    const v = f.ValueDetection?.NormalizedValue?.Value;
    /* Textract writes a normalised date as an ISO timestamp at midnight; the day is
       what the field means, and what a date kind compares. */
    if (typeof v === "string") return v.replace(/T00:00:00(?:\.0+)?Z?$/, "");
  }
  return f.ValueDetection?.Text ?? "";
}

/**
 * Every typed field matching the selector, ExpenseDocuments first then IdentityDocuments,
 * in document order, each rendered as the selector asks. A `group` keeps only the expense
 * fields whose GroupProperties[].Types carries it, compared without case (item 31); identity
 * fields have no groups, so a grouped selector never matches one.
 */
function typedMatches(r: Response, selector: { type: string; normalized?: boolean; group?: string }): Matched[] {
  const wanted = selector.type.trim().toUpperCase();
  const group = selector.group?.trim().toUpperCase();
  const out: Matched[] = [];
  for (const d of r.ExpenseDocuments ?? []) {
    for (const f of d.SummaryFields ?? []) {
      if ((f.Type?.Text ?? "").toUpperCase() !== wanted) continue;
      const groups = groupsOf(f);
      if (group !== undefined && !groups.includes(group)) continue;
      out.push({ value: f.ValueDetection?.Text ?? "", groups });
    }
  }
  if (group !== undefined) return out;
  for (const d of r.IdentityDocuments ?? []) {
    for (const f of d.IdentityDocumentFields ?? []) {
      if ((f.Type?.Text ?? "").toUpperCase() !== wanted) continue;
      out.push({ value: identityText(f, selector.normalized === true), groups: [] });
    }
  }
  return out;
}

/**
 * Why a type selector without a `group` is ambiguous on this export, or `null`. Reviewed
 * 2026-09-29 (item 31): AnalyzeExpense writes the same type once per party, NAME and ADDRESS
 * for the VENDOR and again for RECEIVER_BILL_TO or RECEIVER_SHIP_TO, told apart only by
 * GroupProperties[].Types. Without a group the first one is returned, which is whichever the
 * service listed first. When two groups carry different non-empty values the export is
 * ambiguous: the value still comes back, nothing crashes, and this says so, naming the type
 * and the groups and never a value. A field without GroupProperties counts as its own group,
 * "(no group)", so a grouped and an ungrouped copy that disagree are reported too. The same
 * value in every group is not ambiguous: whichever is taken, the grade is the same.
 */
export function textractAmbiguous(exported: unknown, selector: TextractSelector): string | null {
  if (!("type" in selector) || selector.group !== undefined) return null;
  const byGroup = new Map<string, string>();
  for (const m of typedMatches(merge(exported), selector)) {
    if (m.value.trim().length === 0) continue;
    const key = m.groups.length ? m.groups.join("+") : "(no group)";
    if (!byGroup.has(key)) byGroup.set(key, m.value.trim());
  }
  if (byGroup.size < 2 || new Set(byGroup.values()).size < 2) return null;
  const type = selector.type.trim().toUpperCase();
  const groups = [...byGroup.keys()];
  const example = groups.find((g) => g !== "(no group)") ?? groups[0]!;
  return `type "${type}" appears in ${groups.length} groups (${groups.join(", ")}) with different values; the first was taken. `
    + `Add "group" to the selector to name the party: { "type": "${type}", "group": "${example}" }.`;
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

/**
 * The most confident answer across EVERY QUERY block that carries the alias or the question.
 * Reviewed 2026-09-29 (item 18): a query run with Pages ["*"] is written once per page, the
 * same alias on each block with the answers found on that page. Read from the first block
 * only, an invoice number on page two graded blank. The answers of all matching blocks are
 * pooled; "" when blocks matched and none has an answer (a question the service could not
 * answer); `undefined` when no block matches.
 */
function queryValue(blocks: Block[], query: string): string | undefined {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);
  const wanted = normaliseLabel(query);
  let matched = false;
  let best: Block | undefined;
  for (const b of blocks) {
    if (b.BlockType !== "QUERY") continue;
    const alias = b.Query?.Alias, text = b.Query?.Text;
    if (!((alias && normaliseLabel(alias) === wanted) || (text && normaliseLabel(text) === wanted))) continue;
    matched = true;
    for (const rel of b.Relationships ?? []) {
      if (rel.Type !== "ANSWER") continue;
      for (const id of rel.Ids ?? []) {
        const a = byId.get(id);
        if (a?.BlockType !== "QUERY_RESULT" || (a.Text ?? "").trim().length === 0) continue;
        if (!best || (a.Confidence ?? 0) > (best.Confidence ?? 0)) best = a;
      }
    }
  }
  if (!matched) return undefined;
  return (best?.Text ?? "").trim();
}
