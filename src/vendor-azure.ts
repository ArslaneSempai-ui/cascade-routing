/**
 * Azure AI Document Intelligence, read from an exported analyzeResult. Never called.
 *
 * The export is either the operation result (`{ status, analyzeResult }`, what the REST API
 * returns) or the `AnalyzeResult` itself (what the SDKs hand back). Two things in it carry
 * field values:
 *
 *   documents[].fields      the prebuilt and custom models: `InvoiceTotal`, `VendorName`...
 *   keyValuePairs[]         the general key-value extraction: printed key, printed value
 *
 * Names follow the OpenAPI specification of the 2024-11-30 stable API in
 * Azure/azure-rest-api-specs (`specification/ai/data-plane/DocumentIntelligence`, MIT), read
 * on 2026-09-29: AnalyzedDocument.fields as a dictionary of DocumentField; DocumentField
 * with `type`, `content` and one typed value among valueString, valueDate, valueTime,
 * valuePhoneNumber, valueNumber, valueInteger, valueCurrency (amount, currencySymbol,
 * currencyCode), valueAddress, valueCountryRegion, valueBoolean, valueArray, valueObject;
 * DocumentKeyValuePair with key.content and value.content.
 *
 * By default the adapter returns `content`, the value as printed on the page, because the
 * audit grades what a vendor READ. `{ "field": "InvoiceTotal", "value": true }` returns the
 * typed value instead (the amount, the ISO date), when that is what the client's chain uses.
 */

export type AzureSelector =
  | { field: string; value?: boolean }   /* a model field, dotted for nested objects and arrays */
  | { keyValue: string };                /* the printed key of a key-value pair */

type Field = {
  type?: string; content?: string; confidence?: number;
  valueString?: string; valueDate?: string; valueTime?: string; valuePhoneNumber?: string;
  valueNumber?: number; valueInteger?: number; valueBoolean?: boolean; valueCountryRegion?: string;
  valueSelectionMark?: string; valueSignature?: string;
  valueCurrency?: { amount?: number; currencySymbol?: string; currencyCode?: string };
  valueAddress?: Record<string, string | undefined>;
  valueArray?: Field[]; valueObject?: Record<string, Field>;
};

type Result = {
  apiVersion?: string; modelId?: string; content?: string;
  keyValuePairs?: { key?: { content?: string }; value?: { content?: string }; confidence?: number }[];
  documents?: { docType?: string; fields?: Record<string, Field>; confidence?: number }[];
};

function unwrap(exported: unknown): Result | null {
  if (!exported || typeof exported !== "object") return null;
  const o = exported as { analyzeResult?: unknown } & Result;
  if (o.analyzeResult && typeof o.analyzeResult === "object") return o.analyzeResult as Result;
  return o;
}

export function azureShape(exported: unknown): "analyze-result" | null {
  const r = unwrap(exported);
  if (!r) return null;
  return Array.isArray(r.documents) || Array.isArray(r.keyValuePairs) || typeof r.apiVersion === "string" ? "analyze-result" : null;
}

export function isAzureSelector(x: unknown): x is AzureSelector {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const keys = ["field", "keyValue"].filter((k) => k in o);
  if (keys.length !== 1) return false;
  if (typeof o[keys[0]!] !== "string" || (o[keys[0]!] as string).trim().length === 0) return false;
  if ("value" in o && (typeof o.value !== "boolean" || keys[0] !== "field")) return false;
  return true;
}

export function normaliseKey(s: string): string {
  return s.toLowerCase().replace(/[:\s]+$/g, "").replace(/\s+/g, " ").trim();
}

/** The typed value of a field as a string; `content` when the type carries none. */
export function typedValue(f: Field): string {
  if (typeof f.valueString === "string") return f.valueString;
  if (typeof f.valueDate === "string") return f.valueDate;
  if (typeof f.valueTime === "string") return f.valueTime;
  if (typeof f.valuePhoneNumber === "string") return f.valuePhoneNumber;
  if (typeof f.valueCountryRegion === "string") return f.valueCountryRegion;
  if (typeof f.valueSelectionMark === "string") return f.valueSelectionMark;
  if (typeof f.valueSignature === "string") return f.valueSignature;
  if (typeof f.valueNumber === "number") return String(f.valueNumber);
  if (typeof f.valueInteger === "number") return String(f.valueInteger);
  if (typeof f.valueBoolean === "boolean") return String(f.valueBoolean);
  if (f.valueCurrency && typeof f.valueCurrency.amount === "number") return String(f.valueCurrency.amount);
  if (f.valueAddress) {
    return Object.values(f.valueAddress).filter((v): v is string => typeof v === "string" && v.length > 0).join(" ").trim();
  }
  return f.content ?? "";
}

function descend(f: Field | undefined, path: string[]): Field | undefined {
  let cur = f;
  for (const step of path) {
    if (!cur) return undefined;
    if (cur.valueObject && step in cur.valueObject) cur = cur.valueObject[step];
    else if (cur.valueArray && /^\d+$/.test(step)) cur = cur.valueArray[Number(step)];
    else return undefined;
  }
  return cur;
}

export function azureValue(exported: unknown, selector: AzureSelector): string | undefined {
  const r = unwrap(exported);
  if (!r) return undefined;
  if ("keyValue" in selector) {
    const wanted = normaliseKey(selector.keyValue);
    const pair = (r.keyValuePairs ?? []).find((p) => normaliseKey(p.key?.content ?? "") === wanted);
    if (!pair) return undefined;
    return (pair.value?.content ?? "").trim();
  }
  const [head, ...rest] = selector.field.trim().split(".");
  for (const d of r.documents ?? []) {
    const root = d.fields?.[head!];
    if (!root) continue;
    const f = descend(root, rest);
    if (!f) return undefined;
    return (selector.value ? typedValue(f) : (f.content ?? typedValue(f))).trim();
  }
  return undefined;
}
