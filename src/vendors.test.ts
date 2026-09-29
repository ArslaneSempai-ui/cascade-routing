/*
 * The vendor adapters, on synthetic exports written against each vendor's published schema.
 *
 * Each fixture under fixtures/vendors/ is hand-made and says so; the schemas they follow are
 * cited in that folder's README. The tests read what an adapter returns for every selector
 * it accepts, the difference between "the vendor returned nothing" and "the case was never
 * exported", and the whole path of the `grade` command: from exports to an outcomes file
 * that carries verdicts and no value.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { textractValue, textractShape, isTextractSelector } from "./vendor-textract.ts";
import { documentAiValue, documentAiShape, isDocumentAiSelector, anchoredText } from "./vendor-documentai.ts";
import { azureValue, azureShape, isAzureSelector, typedValue } from "./vendor-azure.ts";
import { loadMapping, readExports, valuesFromExports, ADAPTERS } from "./vendors.ts";
import { lireCsv, chargerSorties } from "./your-cases.ts";
import { gradeValues, readValuesFile, readValues, readPrice, slug } from "./grade.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/vendors/", import.meta.url));
const load = (rel: string): unknown => JSON.parse(readFileSync(join(FIXTURES, rel), "utf8"));
const GRADE = fileURLToPath(new URL("./grade.ts", import.meta.url));

test("every fixture declares itself synthetic", () => {
  for (const rel of ["textract/INV-001.json", "textract/RCP-001.json", "textract/ID-001.json", "documentai/INV-001.json", "azure/INV-001.json"]) {
    const j = load(rel) as Record<string, unknown>;
    const marker = j._synthetic ?? (j.document as Record<string, unknown> | undefined)?._synthetic;
    assert.equal(typeof marker, "string", `${rel} carries no _synthetic marker`);
  }
  const paged = load("textract/INV-002.json") as Record<string, unknown>[];
  assert.equal(typeof paged[0]!._synthetic, "string");
});

/* ─────────────── Textract ─────────────── */

test("Textract FORMS: a key's value is the text of its VALUE block's children", () => {
  const r = load("textract/INV-001.json");
  assert.equal(textractShape(r), "analyze-document");
  assert.equal(textractValue(r, { key: "Total Amount" }), "$1,234.50");
  assert.equal(textractValue(r, { key: "total amount:" }), "$1,234.50", "case and the trailing colon are print");
  assert.equal(textractValue(r, { key: "Invoice Date" }), "09/01/2026");
  assert.equal(textractValue(r, { key: "Paid" }), "SELECTED", "a selection element reads as its status");
  assert.equal(textractValue(r, { key: "Purchase Order" }), undefined, "a key the page has not is absent, not blank");
});

test("Textract QUERIES: the answer with the highest confidence, by alias or by question", () => {
  const r = load("textract/INV-001.json");
  assert.equal(textractValue(r, { query: "invoice_number" }), "INV-2026-0042");
  assert.equal(textractValue(r, { query: "What is the invoice number?" }), "INV-2026-0042");
  assert.equal(textractValue(r, { query: "po_number" }), "", "a query without an answer is a blank, the service could not answer");
  assert.equal(textractValue(r, { query: "nothing" }), undefined);
});

test("Textract paginated result: an array of responses is merged before reading", () => {
  const r = load("textract/INV-002.json");
  assert.equal(textractShape(r), "analyze-document");
  assert.equal(textractValue(r, { key: "Total Amount" }), "980.00", "the key is on page one, its value on page two");
  assert.equal(textractValue(r, { query: "invoice_number" }), "INV 2026 0043");
});

test("Textract AnalyzeExpense: summary fields by type or by printed label", () => {
  const r = load("textract/RCP-001.json");
  assert.equal(textractShape(r), "analyze-expense");
  assert.equal(textractValue(r, { type: "TOTAL" }), "12,50");
  assert.equal(textractValue(r, { type: "vendor_name" }), "Sample Cafe (synthetic)", "the type is case-insensitive");
  assert.equal(textractValue(r, { label: "Amount Due" }), "12,50");
  assert.equal(textractValue(r, { label: "VAT 8%" }), "1,00");
  assert.equal(textractValue(r, { type: "INVOICE_RECEIPT_ID" }), "", "a field the vendor returned empty is blank");
  assert.equal(textractValue(r, { type: "DUE_DATE" }), undefined);
});

test("Textract AnalyzeID: typed fields, as written or normalised", () => {
  const r = load("textract/ID-001.json");
  assert.equal(textractShape(r), "analyze-id");
  assert.equal(textractValue(r, { type: "FIRST_NAME" }), "JANE");
  assert.equal(textractValue(r, { type: "DATE_OF_BIRTH" }), "05/03/1990");
  assert.equal(textractValue(r, { type: "DATE_OF_BIRTH", normalized: true }), "1990-05-03", "the midnight timestamp is dropped: the field is a day");
  assert.equal(textractValue(r, { type: "DOCUMENT_NUMBER" }), "S000 0000 0000");
  assert.equal(textractValue(r, { type: "ADDRESS" }), "");
  assert.equal(textractValue(r, { type: "MRZ_CODE" }), undefined);
  assert.equal(textractValue(r, { type: "FIRST_NAME", normalized: true }), "JANE", "no normalised value: the text as written");
});

test("Textract selectors are validated: exactly one of key, query, type, label", () => {
  assert.ok(isTextractSelector({ key: "Total" }));
  assert.ok(isTextractSelector({ type: "TOTAL", normalized: true }));
  assert.ok(!isTextractSelector({ key: "Total", query: "x" }));
  assert.ok(!isTextractSelector({ key: "" }));
  assert.ok(!isTextractSelector({ label: "x", normalized: true }), "normalized only goes with type");
  assert.ok(!isTextractSelector("Total"));
  assert.equal(textractShape({ hello: 1 }), null);
});

/* ─────────────── Document AI ─────────────── */

test("Document AI entities: by type, top-level or nested, as mentioned or normalised", () => {
  const d = load("documentai/INV-001.json");
  assert.equal(documentAiShape(d), "document");
  assert.equal(documentAiValue(d, { entity: "total_amount" }), "$1,234.50");
  assert.equal(documentAiValue(d, { entity: "total_amount", normalized: true }), "1234.50 USD");
  assert.equal(documentAiValue(d, { entity: "invoice_date", normalized: true }), "2026-09-01");
  assert.equal(documentAiValue(d, { entity: "line_item/amount" }), "100.00", "a nested property is found");
  assert.equal(documentAiValue(d, { entity: "supplier_name" }), "SAMPLE VENDOR LLC (synthetic)");
  assert.equal(documentAiValue(d, { entity: "due_date" }), "", "an entity with an empty anchor is blank");
  assert.equal(documentAiValue(d, { entity: "payment_terms" }), undefined);
});

test("Document AI form fields: names and values are sliced from the text by string offsets", () => {
  const d = load("documentai/INV-001.json");
  assert.equal(documentAiValue(d, { formField: "Invoice Number" }), "INV-2026-0042");
  assert.equal(documentAiValue(d, { formField: "Invoice Date" }), "September 1, 2026", "offsets arrive as strings and still slice");
  assert.equal(documentAiValue(d, { formField: "Total Amount" }), "$1,234.50");
  assert.equal(documentAiValue(d, { formField: "SAMPLE VENDOR LLC (synthetic)" }), "", "a missing startIndex is zero, and an empty value is blank");
  assert.equal(documentAiValue(d, { formField: "Customer" }), undefined);
  assert.equal(anchoredText("abcdef", { textAnchor: { textSegments: [{ startIndex: 1, endIndex: 3 }, { startIndex: "4", endIndex: "6" }] } }), "bcef");
});

test("Document AI ProcessResponse wrapper is unwrapped", () => {
  const d = load("documentai/INV-002.json");
  assert.equal(documentAiShape(d), "document");
  assert.equal(documentAiValue(d, { entity: "invoice_id" }), "INV 2026 0043");
  assert.ok(isDocumentAiSelector({ entity: "x" }));
  assert.ok(!isDocumentAiSelector({ formField: "x", normalized: true }));
  assert.ok(!isDocumentAiSelector({}));
  assert.equal(documentAiShape({ Blocks: [] }), null);
});

/* ─────────────── Azure ─────────────── */

test("Azure model fields: content by default, typed value on request, dotted paths for nesting", () => {
  const r = load("azure/INV-001.json");
  assert.equal(azureShape(r), "analyze-result");
  assert.equal(azureValue(r, { field: "InvoiceTotal" }), "$1,234.50");
  assert.equal(azureValue(r, { field: "InvoiceTotal", value: true }), "1234.5");
  assert.equal(azureValue(r, { field: "InvoiceDate" }), "09/01/2026");
  assert.equal(azureValue(r, { field: "InvoiceDate", value: true }), "2026-09-01");
  assert.equal(azureValue(r, { field: "Items.0.Amount" }), "$100.00");
  assert.equal(azureValue(r, { field: "Items.0.Description", value: true }), "Widget");
  assert.equal(azureValue(r, { field: "VendorAddress", value: true }), "1 Sample Street Springfield IL 00000");
  assert.equal(azureValue(r, { field: "DueDate" }), "", "a field with no content and no value is blank");
  assert.equal(azureValue(r, { field: "Items.3.Amount" }), undefined);
  assert.equal(azureValue(r, { field: "CustomerName" }), undefined);
});

test("Azure key-value pairs: by printed key; and the unwrapped AnalyzeResult layout", () => {
  const r = load("azure/INV-001.json");
  assert.equal(azureValue(r, { keyValue: "Total Amount" }), "$1,234.50");
  assert.equal(azureValue(r, { keyValue: "invoice date:" }), "09/01/2026");
  assert.equal(azureValue(r, { keyValue: "Purchase Order" }), "", "a key without a value is blank");
  assert.equal(azureValue(r, { keyValue: "Tax" }), undefined);
  const keyed = load("azure/keyed.json") as Record<string, unknown>;
  assert.equal(azureShape(keyed["INV-002"]), "analyze-result");
  assert.equal(azureValue(keyed["INV-002"], { field: "InvoiceId" }), "INV-2026-0043");
  assert.ok(isAzureSelector({ field: "A.b" }));
  assert.ok(!isAzureSelector({ keyValue: "x", value: true }));
  assert.equal(typedValue({ type: "number", valueNumber: 3 }), "3");
  assert.equal(typedValue({ type: "string", content: "only content" }), "only content");
});

/* ─────────────── mapping, exports, values ─────────────── */

test("the mapping file is validated against each vendor's selectors before any export is read", () => {
  const fields = ["invoice_number", "invoice_date", "total", "vendor_name", "first_line_amount"];
  const m = loadMapping(join(FIXTURES, "mapping.json"), fields);
  assert.deepEqual(m.unknownFields, []);
  assert.deepEqual(Object.keys(m.mapping).sort(), [...fields].sort());

  const d = mkdtempSync(join(tmpdir(), "mapping-"));
  try {
    const write = (o: unknown) => { const p = join(d, "m.json"); writeFileSync(p, JSON.stringify(o)); return p; };
    assert.throws(() => loadMapping(write([]), fields), /expected an object/);
    assert.throws(() => loadMapping(write({ total: { openai: { x: 1 } } }), fields), /vendor "openai"/);
    assert.throws(() => loadMapping(write({ total: { textract: { key: "a", query: "b" } } }), fields), /not one this adapter reads/);
    assert.throws(() => loadMapping(write({ total: {} }), fields), /no selector for any vendor/);
    assert.throws(() => loadMapping(write({ other: { azure: { field: "X" } } }), fields), /none of its 1 field/);
    const partial = loadMapping(write({ total: { azure: { field: "X" } }, other: { azure: { field: "Y" } } }), fields);
    assert.deepEqual(partial.unknownFields, ["other"], "a field the CSV lacks is named, not silently dropped");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("exports are read from a folder of <id>.json or from one object keyed by id", () => {
  const folder = readExports(join(FIXTURES, "textract"));
  assert.deepEqual([...folder.byId.keys()].sort(), ["ID-001", "INV-001", "INV-002", "RCP-001"]);
  assert.deepEqual(folder.unreadable, []);
  const keyed = readExports(join(FIXTURES, "azure", "keyed.json"));
  assert.deepEqual([...keyed.byId.keys()].sort(), ["INV-001", "INV-002"]);

  const d = mkdtempSync(join(tmpdir(), "exports-"));
  try {
    writeFileSync(join(d, "A.json"), "{");
    writeFileSync(join(d, "B.json"), "{}");
    writeFileSync(join(d, "notes.txt"), "ignored");
    const r = readExports(d);
    assert.deepEqual([...r.byId.keys()], ["B"]);
    assert.equal(r.unreadable.length, 1, "a file that does not parse is named, not skipped in silence");
    assert.equal(r.unreadable[0]!.name, "A.json");
    writeFileSync(join(d, "arr.json"), "[]");
    assert.throws(() => readExports(join(d, "arr.json")), /keyed by case id/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("values from exports keep three things apart: a value, a blank, and an absent case", () => {
  const { champs, cas } = lireCsv(readFileSync(join(FIXTURES, "cases.csv"), "utf8"));
  const ids = cas.map((c) => c.id);
  const { mapping } = loadMapping(join(FIXTURES, "mapping.json"), champs);

  const t = valuesFromExports("textract", readExports(join(FIXTURES, "textract")), mapping, champs, ids);
  assert.equal(t.values["total"]!["INV-001"], "$1,234.50");
  assert.equal(t.values["total"]!["INV-002"], "980.00");
  assert.equal(t.values["invoice_date"]!["INV-002"], "", "the export exists and lacks the key: blank");
  assert.deepEqual(t.absent["total"], ["INV-003"], "no export for this case: absent");
  assert.deepEqual(t.unmapped, ["vendor_name", "first_line_amount"], "no textract selector: not graded, and said");
  assert.deepEqual(t.wrongShape, [], "the receipt and the id fixtures are Textract shapes too");

  const g = valuesFromExports("documentai", readExports(join(FIXTURES, "documentai")), mapping, champs, ids);
  assert.equal(g.values["total"]!["INV-001"], "$1,234.50");
  assert.equal(g.values["first_line_amount"]!["INV-001"], "100.00");
  assert.equal(g.values["invoice_date"]!["INV-002"], "", "the wrapper export has no form fields: blank");

  const a = valuesFromExports("azure", readExports(join(FIXTURES, "azure", "keyed.json")), mapping, champs, ids);
  assert.equal(a.values["total"]!["INV-002"], "980");
  assert.equal(a.values["invoice_number"]!["INV-001"], "", "the keyed fixture's first document has no InvoiceId: blank");

  /* A Document AI export handed to the Textract adapter is the wrong shape, and is named. */
  const wrong = valuesFromExports("textract", readExports(join(FIXTURES, "documentai")), mapping, champs, ids);
  assert.deepEqual(wrong.wrongShape.sort(), ["INV-001", "INV-002"]);
  assert.deepEqual(wrong.absent["total"]!.sort(), ["INV-001", "INV-002", "INV-003"]);
});

test("the labelled CSV declares kinds in its header, and the names come out clean", () => {
  const { champs, kinds, cas } = lireCsv(readFileSync(join(FIXTURES, "cases.csv"), "utf8"));
  assert.deepEqual(champs, ["invoice_number", "invoice_date", "total", "vendor_name", "first_line_amount"]);
  /* `kinds` has no prototype, like every object keyed by client input here; compare its content. */
  assert.deepEqual({ ...kinds }, { invoice_number: "id", invoice_date: "date", total: "amount", vendor_name: "free-text", first_line_amount: "amount" });
  assert.equal(cas[0]!.truth["total"], "1234.50");
  const plain = lireCsv("id,text,name,time:stamp\n1,hello,Anna,now\n");
  assert.deepEqual(plain.champs, ["name", "time:stamp"], "an unknown suffix stays in the name");
  assert.deepEqual({ ...plain.kinds }, {});
});

test("grading applies the kind, and an absent case is neither clean nor wrong", () => {
  const { champs, cas, kinds } = lireCsv(readFileSync(join(FIXTURES, "cases.csv"), "utf8"));
  const values = { total: { "INV-001": "$1,234.50", "INV-002": "980,00", "INV-003": "" }, invoice_number: { "INV-001": "INV 2026 0042" } };
  const g = gradeValues(cas, champs, kinds, values);
  assert.deepEqual(g.issues["total"], { "INV-001": "clean", "INV-002": "clean", "INV-003": "blank" });
  assert.deepEqual(g.issues["invoice_number"], { "INV-001": "clean" });
  assert.deepEqual(g.coverage["invoice_number"], { graded: 1, absent: 2, noTruth: 0, clean: 1, wrong: 0, blank: 0 });
  assert.equal(g.issues["vendor_name"], undefined, "a field with no values has no entry");
  /* Under the default kind the same amount would have been wrong: that is the whole point. */
  const strict = gradeValues(cas, champs, {}, values);
  assert.equal(strict.issues["total"]!["INV-001"], "wrong");
});

test("a values file is read per case or per field, and refuses what is not a value", () => {
  const d = mkdtempSync(join(tmpdir(), "values-"));
  try {
    const write = (o: unknown) => { const p = join(d, "v.json"); writeFileSync(p, JSON.stringify(o)); return p; };
    const fields = ["total", "date"];
    const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
    /* Case "2" is in the file and says nothing for `date`: a blank, not an absence (F2). */
    assert.deepEqual(plain(readValuesFile(write({ "1": { total: "5", date: null }, "2": { total: 7 } }), fields)),
      { total: { "1": "5", "2": "7" }, date: { "1": "", "2": "" } });
    assert.deepEqual(plain(readValuesFile(write({ total: { "1": "5" } }), fields)), { total: { "1": "5" } });
    assert.throws(() => readValuesFile(write({ "1": { total: ["a"] } }), fields), /not a value/);
    assert.throws(() => readValuesFile(write({ "1": { other: "x" } }), fields), /none of its keys names a field/);
    assert.throws(() => readValuesFile(write([]), fields), /expected an object/);
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.equal(readPrice("25"), 25);
  assert.equal(readPrice(undefined), undefined);
  assert.throws(() => readPrice("free"), /not a price/);
  assert.throws(() => readPrice("-1"), /not a price/);
  assert.throws(() => readPrice("-5", "--price-per-thousand-documents"), /not a price/, "the per-document price is refused the same way");
  assert.equal(slug("Textract FORMS (us-east-1)"), "textract-forms-us-east-1");
});

/* ─────────────── the command, end to end ─────────────── */

test("grade writes an outcomes file with verdicts and no value, for each of the three vendors", () => {
  const d = mkdtempSync(join(tmpdir(), "grade-"));
  try {
    const csv = join(d, "cases.csv");
    writeFileSync(csv, readFileSync(join(FIXTURES, "cases.csv")));
    const runs: [string, string, Record<string, Record<string, string>>][] = [
      ["textract", join(FIXTURES, "textract"), {
        total: { "INV-001": "clean", "INV-002": "clean" },
        invoice_number: { "INV-001": "clean", "INV-002": "clean" },
        invoice_date: { "INV-001": "clean", "INV-002": "blank" },
      }],
      ["documentai", join(FIXTURES, "documentai"), {
        total: { "INV-001": "clean", "INV-002": "clean" },
        invoice_number: { "INV-001": "clean", "INV-002": "clean" },
        invoice_date: { "INV-001": "clean", "INV-002": "blank" },
        vendor_name: { "INV-001": "clean", "INV-002": "blank" },
        first_line_amount: { "INV-001": "clean", "INV-002": "blank" },
      }],
      ["azure", join(FIXTURES, "azure", "keyed.json"), {
        total: { "INV-001": "clean", "INV-002": "clean" },
        invoice_number: { "INV-001": "blank", "INV-002": "clean" },
      }],
    ];
    for (const [vendor, exports, expected] of runs) {
      const r = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, `--name=${vendor}-chain`, `--vendor=${vendor}`,
        `--exports=${exports}`, `--mapping=${join(FIXTURES, "mapping.json")}`, "--price-per-thousand-pages=25"],
        { encoding: "utf8" });
      assert.equal(r.status, 0, `${vendor}: ${r.stderr}\n${r.stdout}`);
      const out = join(d, `cases-${vendor}-chain-outcomes.json`);
      assert.ok(existsSync(out), `${vendor}: ${out} was not written`);
      const text = readFileSync(out, "utf8");
      for (const leaked of ["1,234.50", "1234.50", "INV-2026-0042", "INV 2026 0043", "SAMPLE VENDOR", "Widget", "980.00"]) {
        assert.ok(!text.includes(leaked), `${vendor}: the outcomes file carries a value: ${leaked}`);
      }
      const j = JSON.parse(text);
      assert.equal(j.kind, "cascade-outcomes");
      assert.equal(j.nom, `${vendor}-chain`);
      for (const [field, byId] of Object.entries(expected)) {
        for (const [id, verdict] of Object.entries(byId)) {
          assert.equal(j.issues[field]?.[id], verdict, `${vendor}: ${field}/${id}`);
        }
        assert.equal(j.issues[field]?.["INV-003"], undefined, `${vendor}: INV-003 has no export and must be absent`);
      }
      assert.equal(j.notePar.correcteur, "grader v1");
      assert.equal(j.notePar.kinds.total, "amount");
      assert.match(j.notePar.conventions.amount, /thousands/);
      assert.deepEqual(j.declares, { pricePerThousandPages: 25 }, "the adapter's name is not a price-table key and must not be written as one");
      assert.equal(j.source.vendor, vendor);
      assert.equal(j.source.cases, "cases.csv");
      /* And measure:yours reads it back through its existing loader. */
      const loaded = chargerSorties(out);
      assert.equal(loaded.nom, `${vendor}-chain`);
      assert.equal(loaded.declares?.pricePerThousandPages, 25);
      assert.match(r.stdout, /no value/);
      assert.ok(!/1,234\.50|INV-2026-0042/.test(r.stdout), `${vendor}: a value was printed`);
    }

    /* The values path, and the refusals. */
    const values = join(d, "values.json");
    writeFileSync(values, JSON.stringify({ "INV-001": { total: "1234.5" }, "INV-002": { total: "1" } }));
    const v = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=my chain", `--values=${values}`, "--price-per-thousand-documents=40", `--out=${join(d, "o.json")}`], { encoding: "utf8" });
    assert.equal(v.status, 0, v.stderr);
    const o = JSON.parse(readFileSync(join(d, "o.json"), "utf8"));
    assert.deepEqual(o.issues.total, { "INV-001": "clean", "INV-002": "wrong" });
    assert.deepEqual(o.declares, { pricePerThousandDocuments: 40 });

    const listed = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=listed", `--values=${values}`, "--list-price=aws-textract-forms", `--out=${join(d, "l.json")}`], { encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(d, "l.json"), "utf8")).declares, { vendor: "aws-textract-forms" });
    const badKey = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=listed", `--values=${values}`, "--list-price=nope"], { encoding: "utf8" });
    assert.equal(badKey.status, 1);
    assert.match(badKey.stderr, /not a key of vendor-prices.json/);

    const noName = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, `--values=${values}`], { encoding: "utf8" });
    assert.equal(noName.status, 1);
    assert.match(noName.stderr, /--name is required/);
    const tierName = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=small", `--values=${values}`], { encoding: "utf8" });
    assert.equal(tierName.status, 1, "a chain named after one of our tiers would overwrite its row");
    const unknownFlag = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=x", `--values=${values}`, "--prize=3"], { encoding: "utf8" });
    assert.equal(unknownFlag.status, 2);
    assert.match(unknownFlag.stderr, /Unknown option/);
    writeFileSync(values, JSON.stringify({ "Z-1": { total: "1" } }));
    const noMatch = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=x", `--values=${values}`], { encoding: "utf8" });
    assert.equal(noMatch.status, 1);
    assert.match(noMatch.stderr, /identifiers do not match/);
    const help = spawnSync(process.execPath, [GRADE], { encoding: "utf8" });
    assert.equal(help.status, 1);
    assert.match(help.stdout, /Never a value/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

/* ─────────────── the review of 2026-09-29 ─────────────── */

/** The `_synthetic` marker, wherever a fixture's layout puts it: top level, under a
 *  ProcessResponse `document`, on the first page of a paginated array, or on one entry of
 *  a keyed file. */
function syntheticMarker(j: unknown): unknown {
  if (Array.isArray(j)) return syntheticMarker(j[0]);
  if (!j || typeof j !== "object") return undefined;
  const o = j as Record<string, unknown>;
  if (typeof o._synthetic === "string") return o._synthetic;
  if (o.document) return syntheticMarker(o.document);
  return Object.values(o).map((v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)._synthetic : undefined)).find((m) => typeof m === "string");
}

test("every fixture under fixtures/vendors declares itself synthetic, whatever its layout", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".json") && n !== "mapping.json") files.push(p);
    }
  };
  walk(FIXTURES);
  assert.ok(files.length >= 20, `only ${files.length} fixtures were found under ${FIXTURES}`);
  for (const p of files) {
    assert.equal(typeof syntheticMarker(JSON.parse(readFileSync(p, "utf8"))), "string", `${relative(FIXTURES, p)} carries no _synthetic marker`);
  }
});

test("Document AI (item 16): snake_case proto field names read exactly like lowerCamelCase", () => {
  const camel = load("documentai/INV-001.json");
  const snake = load("documentai-snake-case/INV-001.json");
  const raw = readFileSync(join(FIXTURES, "documentai-snake-case/INV-001.json"), "utf8");
  assert.ok(raw.includes('"mention_text"') && raw.includes('"start_index"') && raw.includes('"form_fields"') && !raw.includes('"mentionText"'),
    "the fixture is the snake_case spelling");
  assert.equal(documentAiShape(snake), "document");
  const selectors = [
    { entity: "total_amount" }, { entity: "total_amount", normalized: true }, { entity: "invoice_date", normalized: true },
    { entity: "line_item/amount" }, { entity: "supplier_name" }, { entity: "due_date" }, { entity: "payment_terms" },
    { formField: "Invoice Number" }, { formField: "Invoice Date" }, { formField: "Total Amount" },
    { formField: "SAMPLE VENDOR LLC (synthetic)" }, { formField: "Customer" },
  ] as const;
  for (const s of selectors) {
    const expected = documentAiValue(camel, s);
    assert.equal(documentAiValue(snake, s), expected, `${JSON.stringify(s)} reads ${JSON.stringify(expected)} from the camelCase copy`);
  }
  assert.equal(documentAiValue(snake, { entity: "total_amount" }), "$1,234.50", "and that reading is the value, not a blank");
  /* The client's object is read, not rewritten: its keys stay as they were. */
  assert.ok("mention_text" in (snake as { entities: Record<string, unknown>[] }).entities[1]!);
});

test("Document AI (item 30): a normalised money value without text renders as <units>.<nanos>", () => {
  const d = load("documentai-normalized/NRM-001.json");
  assert.equal(documentAiValue(d, { entity: "total_amount", normalized: true }), "12.50");
  assert.equal(documentAiValue(d, { entity: "whole_amount", normalized: true }), "7.00", "no nanos: two zero decimals");
  assert.equal(documentAiValue(d, { entity: "precise_amount", normalized: true }), "0.125", "nanos keep their significant digits past two");
  assert.equal(documentAiValue(d, { entity: "credit_amount", normalized: true }), "-3.20", "a negative amount carries one sign");
  assert.equal(documentAiValue(d, { entity: "with_text", normalized: true }), "12.50 EUR", "text wins when present");
});

test("Document AI (item 30): normalised dates and datetimes render as YYYY-MM-DD", () => {
  const d = load("documentai-normalized/NRM-001.json");
  assert.equal(documentAiValue(d, { entity: "invoice_date", normalized: true }), "2026-09-01");
  assert.equal(documentAiValue(d, { entity: "stamped_at", normalized: true }), "2026-09-02", "the time of day is dropped: the field is graded as a day");
});

test("Document AI (item 30): normalised float, integer and boolean values render through String()", () => {
  const d = load("documentai-normalized/NRM-001.json");
  assert.equal(documentAiValue(d, { entity: "net_amount", normalized: true }), "12.5");
  assert.equal(documentAiValue(d, { entity: "page_count", normalized: true }), "3");
  assert.equal(documentAiValue(d, { entity: "paid", normalized: true }), "true");
});

test("Document AI (item 30): a normalizedValue with nothing in it falls back to the mention, then to the anchor", () => {
  const d = load("documentai-normalized/NRM-001.json");
  assert.equal(documentAiValue(d, { entity: "free_text", normalized: true }), "Free text only");
  assert.equal(documentAiValue(d, { entity: "anchored_only", normalized: true }), "Anchored value");
  assert.equal(documentAiValue(d, { entity: "free_text", normalized: true }), documentAiValue(d, { entity: "free_text" }), "exactly what the non-normalised path returns");
  assert.equal(documentAiValue(d, { entity: "nothing", normalized: true }), undefined);
});

test("Textract (item 17): with one IdentityDocument per side, an empty field on the first side does not hide the other side's value", () => {
  const r = load("textract-id-two-sides/ID-002.json");
  assert.equal(textractShape(r), "analyze-id");
  assert.equal(textractValue(r, { type: "FIRST_NAME" }), "JANE", "the back came first, with an empty FIRST_NAME");
  assert.equal(textractValue(r, { type: "LAST_NAME" }), "SAMPLE");
  assert.equal(textractValue(r, { type: "DATE_OF_BIRTH", normalized: true }), "1990-05-03");
  assert.equal(textractValue(r, { type: "ADDRESS" }), "2 SAMPLE ROAD SPRINGFIELD IL 00000", "and the other way round: the back has it, the front has not");
  assert.equal(textractValue(r, { type: "ID_TYPE" }), "DRIVER LICENSE BACK", "when both sides have a value, the first is kept");
  assert.equal(textractValue(r, { type: "ENDORSEMENTS" }), "", "empty on every side that has it: blank");
  assert.equal(textractValue(r, { type: "MRZ_CODE" }), undefined, "on no side: absent");
});

test("Textract (item 17): AnalyzeExpense type and label selectors prefer the first non-empty value across documents", () => {
  const r = {
    ExpenseDocuments: [
      { ExpenseIndex: 1, SummaryFields: [{ Type: { Text: "TOTAL" }, LabelDetection: { Text: "Total" }, ValueDetection: { Text: "" } }] },
      { ExpenseIndex: 2, SummaryFields: [{ Type: { Text: "TOTAL" }, LabelDetection: { Text: "Total" }, ValueDetection: { Text: "5.00" } }] },
    ],
  };
  assert.equal(textractValue(r, { type: "TOTAL" }), "5.00");
  assert.equal(textractValue(r, { label: "Total" }), "5.00");
  assert.equal(textractValue(r, { label: "Tax" }), undefined);
});

test("Textract (item 18): QUERIES run on every page answer through whichever QUERY block has the answer", () => {
  const r = load("textract-queries-all-pages/INV-004.json");
  assert.equal(textractShape(r), "analyze-document");
  assert.equal(textractValue(r, { query: "invoice_number" }), "INV-2026-0043", "page one's QUERY block has no answer, page two's has");
  assert.equal(textractValue(r, { query: "What is the invoice number?" }), "INV-2026-0043", "by question text too");
  assert.equal(textractValue(r, { query: "total" }), "1,980.00", "two answers on two pages: the highest confidence wins");
  assert.equal(textractValue(r, { query: "po_number" }), "", "QUERY blocks match and none has an answer: blank");
  assert.equal(textractValue(r, { query: "nothing" }), undefined, "no QUERY block matches: absent");
});

test("Textract (item 31): a type repeated across GroupProperties is picked by group, and reported as ambiguous without one", () => {
  const r = load("textract-expense-groups/RCP-002.json");
  assert.equal(textractValue(r, { type: "NAME", group: "VENDOR" }), "Sample Vendor LLC (synthetic)");
  assert.equal(textractValue(r, { type: "NAME", group: "receiver_bill_to" }), "Sample Buyer Inc (synthetic)", "the group is matched case-insensitively");
  assert.equal(textractValue(r, { type: "ADDRESS", group: "RECEIVER_BILL_TO" }), "9 Buyer Avenue, Springfield IL 00001");
  assert.equal(textractValue(r, { type: "NAME", group: "RECEIVER_SHIP_TO" }), undefined, "no field in that group: absent");
  assert.equal(textractValue(r, { type: "TOTAL", group: "VENDOR" }), undefined, "an ungrouped field belongs to no group");
  assert.equal(textractValue(r, { type: "NAME" }), "Sample Vendor LLC (synthetic)", "without a group the first value is still returned");
  assert.ok(isTextractSelector({ type: "NAME", group: "VENDOR" }));
  assert.ok(!isTextractSelector({ label: "Name", group: "VENDOR" }), "group only goes with type");
  assert.ok(!isTextractSelector({ key: "Name", group: "VENDOR" }));
  assert.ok(!isTextractSelector({ type: "NAME", group: "" }));
  assert.ok(!isTextractSelector({ type: "NAME", group: 3 }));
  assert.match(ADAPTERS.textract.selectors, /"group"/, "the help string names the option");

  const ambiguous = ADAPTERS.textract.ambiguous!;
  const why = ambiguous(r, { type: "NAME" } as never);
  assert.equal(typeof why, "string", "NAME appears in two groups with different values");
  assert.match(why!, /NAME/);
  assert.match(why!, /VENDOR/);
  assert.match(why!, /RECEIVER_BILL_TO/);
  assert.match(why!, /group/);
  assert.ok(!why!.includes("Sample"), "the reason names the groups, never a value");
  assert.ok(!why!.includes("\n"), "one line");
  assert.equal(ambiguous(r, { type: "NAME", group: "VENDOR" } as never), null, "a group settles it");
  assert.equal(ambiguous(r, { type: "TAX_PAYER_ID" } as never), null, "the same value in both groups is not ambiguous");
  assert.equal(ambiguous(r, { type: "TOTAL" } as never), null);
  assert.equal(ambiguous(r, { type: "DUE_DATE" } as never), null);
  assert.equal(ambiguous(r, { label: "Total Due" } as never), null);
  assert.equal(ambiguous(load("textract/RCP-001.json"), { type: "TOTAL" } as never), null);

  const fields = ["vendor_name", "buyer_name", "total"];
  const mapping = {
    vendor_name: { textract: { type: "NAME" } },
    buyer_name: { textract: { type: "NAME", group: "RECEIVER_BILL_TO" } },
    total: { textract: { type: "TOTAL" } },
  };
  const v = valuesFromExports("textract", readExports(join(FIXTURES, "textract-expense-groups")), mapping, fields, ["RCP-002"]);
  assert.equal(v.values["vendor_name"]!["RCP-002"], "Sample Vendor LLC (synthetic)");
  assert.equal(v.values["buyer_name"]!["RCP-002"], "Sample Buyer Inc (synthetic)");
  assert.equal(v.ambiguous["vendor_name"]!.length, 1);
  assert.equal(v.ambiguous["vendor_name"]![0]!.id, "RCP-002");
  assert.match(v.ambiguous["vendor_name"]![0]!.why, /NAME/);
  assert.deepEqual(v.ambiguous["buyer_name"], []);
  assert.deepEqual(v.ambiguous["total"], []);
});

test("vendors (item 19): a selector that matches nothing in any export is reported, not graded blank in silence", () => {
  const ids = ["RCP-001"];
  const expense = readExports(join(FIXTURES, "textract"));
  /* {"key":"Total"} on AnalyzeExpense output: the family reads another shape. */
  const key = valuesFromExports("textract", expense, { total: { textract: { key: "Total" } } }, ["total"], ids);
  assert.equal(key.values["total"]!["RCP-001"], "", "the case is still graded blank: the grading does not move");
  assert.deepEqual(key.notFound["total"], ["RCP-001"]);
  assert.equal(typeof key.selectorMatchedNothing["total"], "string");
  const why = key.selectorMatchedNothing["total"]!;
  assert.match(why, /"total"/, "names the field");
  assert.match(why, /\{"key":"Total"\}/, "names the selector");
  assert.match(why, /1 export/, "says how many exports were read");
  assert.match(why, /AnalyzeDocument/, "says what a key selector reads");
  assert.match(why, /analyze-expense/, "and what was found instead");
  assert.ok(!why.includes("\n"), "one line");
  /* {"type":"TOTAL_AMOUNT"}: the right family, a wrong name. */
  const typo = valuesFromExports("textract", expense, { total: { textract: { type: "TOTAL_AMOUNT" } } }, ["total"], ids);
  assert.equal(typo.values["total"]!["RCP-001"], "");
  assert.deepEqual(typo.notFound["total"], ["RCP-001"]);
  assert.match(typo.selectorMatchedNothing["total"]!, /TOTAL_AMOUNT/);
  assert.ok(!/AnalyzeDocument/.test(typo.selectorMatchedNothing["total"]!), "the family fits the shape: no lecture about shapes");
  /* {"formField": ...} on Invoice Parser output, which has entities and no pages. */
  const docai = readExports(join(FIXTURES, "documentai"));
  const ff = valuesFromExports("documentai", docai, { invoice_date: { documentai: { formField: "Invoice Date" } } }, ["invoice_date"], ["INV-002"]);
  assert.equal(ff.values["invoice_date"]!["INV-002"], "");
  assert.deepEqual(ff.notFound["invoice_date"], ["INV-002"]);
  assert.match(ff.selectorMatchedNothing["invoice_date"]!, /formFields/);
  /* The same selector over both exports: found in one, so it is a per-case miss, not a dead selector. */
  const both = valuesFromExports("documentai", docai, { invoice_date: { documentai: { formField: "Invoice Date" } } }, ["invoice_date"], ["INV-001", "INV-002", "INV-003"]);
  assert.deepEqual(both.notFound["invoice_date"], ["INV-002"]);
  assert.equal(both.selectorMatchedNothing["invoice_date"], undefined);
  assert.equal(both.values["invoice_date"]!["INV-002"], "");
  assert.deepEqual(both.absent["invoice_date"], ["INV-003"]);
  /* A selector the vendor answered with an empty value is neither a miss nor dead. */
  const empty = valuesFromExports("textract", expense, { rid: { textract: { type: "INVOICE_RECEIPT_ID" } } }, ["rid"], ids);
  assert.equal(empty.values["rid"]!["RCP-001"], "");
  assert.deepEqual(empty.notFound["rid"], []);
  assert.equal(empty.selectorMatchedNothing["rid"], undefined);
  /* No export read at all: nothing to say about the selector. */
  const none = valuesFromExports("textract", expense, { total: { textract: { key: "Total" } } }, ["total"], ["NOPE"]);
  assert.equal(none.selectorMatchedNothing["total"], undefined);
  assert.deepEqual(none.notFound["total"], []);
  /* fits and needs, per adapter. */
  assert.equal(ADAPTERS.textract.fits!(load("textract/INV-001.json"), { query: "x" } as never), true);
  assert.equal(ADAPTERS.textract.fits!(load("textract/ID-001.json"), { label: "x" } as never), false);
  assert.equal(ADAPTERS.textract.fits!(load("textract/ID-001.json"), { type: "x" } as never), true);
  assert.equal(ADAPTERS.textract.fits!(load("textract/RCP-001.json"), { key: "x" } as never), false);
  assert.equal(ADAPTERS.azure.fits!(load("azure/INV-001.json"), { keyValue: "x" } as never), true);
  assert.equal(ADAPTERS.azure.fits!((load("azure/keyed.json") as Record<string, unknown>)["INV-002"], { keyValue: "x" } as never), false);
  assert.equal(ADAPTERS.documentai.fits!(load("documentai/INV-002.json"), { entity: "x" } as never), true);
  assert.equal(ADAPTERS.documentai.fits!(load("documentai/INV-002.json"), { formField: "x" } as never), false);
  assert.match(ADAPTERS.azure.needs!({ keyValue: "x" } as never), /keyValuePairs/);
  assert.match(ADAPTERS.documentai.needs!({ entity: "x" } as never), /entities/);
  assert.match(ADAPTERS.textract.needs!({ label: "x" } as never), /AnalyzeExpense/);
});

test("vendors (item 32): a vendor's failed response is graded blank and listed, not dropped from the denominator", () => {
  for (const [vendor, file, pattern] of [
    ["textract", "failed/textract-exception.json", /InvalidS3ObjectException/],
    ["textract", "failed/textract-error-envelope.json", /UnsupportedDocumentException/],
    ["textract", "failed/textract-job-failed.json", /FAILED/],
    ["azure", "failed/azure-status-failed.json", /InvalidRequest/],
    ["azure", "failed/azure-error.json", /InvalidImageSize/],
    ["documentai", "failed/documentai-error.json", /INVALID_ARGUMENT/],
  ] as const) {
    const why = ADAPTERS[vendor].failed!(load(file));
    assert.equal(typeof why, "string", `${file} is a failed response`);
    assert.match(why!, pattern);
    assert.ok(!why!.includes("\n"), "one line");
  }
  assert.equal(ADAPTERS.textract.failed!(load("textract/INV-001.json")), null);
  assert.equal(ADAPTERS.textract.failed!(load("textract/INV-002.json")), null, "a paginated result is not a failure");
  assert.equal(ADAPTERS.textract.failed!({ JobStatus: "PARTIAL_SUCCESS", Blocks: [] }), null, "PARTIAL_SUCCESS still carries the pages that were read");
  assert.equal(ADAPTERS.textract.failed!({ JobStatus: "SUCCEEDED", Blocks: [] }), null);
  assert.equal(ADAPTERS.azure.failed!(load("azure/INV-001.json")), null);
  assert.equal(typeof ADAPTERS.azure.failed!({ status: "failed" }), "string", "a failed operation without an error body is still a failure");
  assert.equal(ADAPTERS.documentai.failed!(load("documentai/INV-002.json")), null);
  assert.equal(ADAPTERS.documentai.failed!(load("documentai/INV-001.json")), null);

  /* Twenty successes and five failures: values for all twenty-five, blank for the five. */
  const d = mkdtempSync(join(tmpdir(), "failed-"));
  try {
    const ok = readFileSync(join(FIXTURES, "textract/RCP-001.json"));
    const ids: string[] = [];
    for (let i = 1; i <= 20; i++) { const id = `OK-${String(i).padStart(2, "0")}`; ids.push(id); writeFileSync(join(d, `${id}.json`), ok); }
    const failures = ["textract-exception.json", "textract-error-envelope.json", "textract-job-failed.json", "textract-exception.json", "textract-job-failed.json"];
    failures.forEach((f, i) => { const id = `KO-${i + 1}`; ids.push(id); writeFileSync(join(d, `${id}.json`), readFileSync(join(FIXTURES, "failed", f))); });
    const v = valuesFromExports("textract", readExports(d), { total: { textract: { type: "TOTAL" } } }, ["total"], ids);
    assert.equal(Object.keys(v.values["total"]!).length, 25, "every case has a value to grade");
    for (const id of ids) assert.equal(v.values["total"]![id], id.startsWith("OK") ? "12,50" : "", id);
    assert.deepEqual(v.absent["total"], [], "a failed job is not an absent case");
    assert.deepEqual(v.wrongShape, [], "nor a wrong shape");
    assert.deepEqual(v.failed.map((f) => f.id).sort(), ["KO-1", "KO-2", "KO-3", "KO-4", "KO-5"]);
    for (const f of v.failed) assert.equal(typeof f.why, "string");
    assert.deepEqual(v.notFound["total"], [], "a failure is not a selector miss");
    assert.equal(v.selectorMatchedNothing["total"], undefined);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("vendors (item 24): exports and the mapping are read as a client's machine writes them, byte-order mark and all", () => {
  const d = mkdtempSync(join(tmpdir(), "bom-"));
  try {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const inv = readFileSync(join(FIXTURES, "textract/INV-001.json"));
    writeFileSync(join(d, "INV-001.json"), Buffer.concat([bom, inv]));
    writeFileSync(join(d, "INV-002.json"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(inv.toString("utf8"), "utf16le")]));
    const ex = readExports(d);
    assert.deepEqual([...ex.byId.keys()], ["INV-001"], "the export with a UTF-8 BOM reads");
    assert.equal(textractValue(ex.byId.get("INV-001"), { key: "Total Amount" }), "$1,234.50");
    assert.equal(ex.unreadable.length, 1);
    assert.equal(ex.unreadable[0]!.name, "INV-002.json");
    assert.match(ex.unreadable[0]!.why, /UTF-16/, "the UTF-16 export is named with its encoding");
    /* The keyed layout too. */
    writeFileSync(join(d, "keyed.json"), Buffer.concat([bom, readFileSync(join(FIXTURES, "azure/keyed.json"))]));
    assert.deepEqual([...readExports(join(d, "keyed.json")).byId.keys()].sort(), ["INV-001", "INV-002"]);
    writeFileSync(join(d, "keyed16.json"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("{}", "utf16le")]));
    assert.throws(() => readExports(join(d, "keyed16.json")), /UTF-16/);
    /* And the mapping. */
    writeFileSync(join(d, "mapping.json"), Buffer.concat([bom, readFileSync(join(FIXTURES, "mapping.json"))]));
    const m = loadMapping(join(d, "mapping.json"), ["total", "invoice_date"]);
    assert.equal(Object.keys(m.mapping).length, 5);
    writeFileSync(join(d, "mapping16.json"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("{}", "utf16le")]));
    assert.throws(() => loadMapping(join(d, "mapping16.json"), ["total"]), /UTF-16/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("Azure (item 29): a typed address is one line in a fixed order, streetAddress standing in for house number and road", () => {
  const r = load("azure-address/ADR-001.json");
  assert.equal(azureShape(r), "analyze-result");
  assert.equal(azureValue(r, { field: "VendorAddress", value: true }), "1 Sample Street Suite 4 Springfield IL 00000 USA", "the street is written once; suburb and level are ignored");
  assert.equal(azureValue(r, { field: "CustomerAddress", value: true }), "PO Box 12 Springfield IL 00000");
  assert.equal(azureValue(r, { field: "RemittanceAddress", value: true }), "Springfield Sample Quarter IL Sample County");
  assert.equal(typedValue({ type: "address", valueAddress: { road: "Sample Street", houseNumber: "1", postalCode: "00000", city: "Springfield" } }),
    "1 Sample Street Springfield 00000", "without streetAddress: house number then road, whatever the key order");
  assert.equal(azureValue(load("azure/INV-001.json"), { field: "VendorAddress", value: true }), "1 Sample Street Springfield IL 00000", "the existing fixture reads as before");
});

test("grade (items 19, 24, 32): a dead selector refuses with the notes first, a failed export is a blank, and unreadable exports are named before the identifiers are blamed", () => {
  const d = mkdtempSync(join(tmpdir(), "grade-notes-"));
  try {
    const csv = join(d, "cases.csv");
    writeFileSync(csv, "id,text,total:amount\nINV-001,x,1234.50\nINV-002,x,980\nINV-003,x,1\n");
    /* Item 32: one good AnalyzeDocument export, one failure response under a case id. */
    const exports = join(d, "exports");
    mkdirSync(exports);
    writeFileSync(join(exports, "INV-001.json"), readFileSync(join(FIXTURES, "textract/INV-001.json")));
    writeFileSync(join(exports, "INV-002.json"), readFileSync(join(FIXTURES, "failed/textract-exception.json")));
    const mapping = join(d, "mapping.json");
    writeFileSync(mapping, JSON.stringify({ total: { textract: { key: "Total Amount" } } }));
    const ok = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=t", "--vendor=textract", `--exports=${exports}`, `--mapping=${mapping}`, `--out=${join(d, "o.json")}`], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    const o = JSON.parse(readFileSync(join(d, "o.json"), "utf8"));
    assert.equal(o.issues.total["INV-001"], "clean");
    assert.equal(o.issues.total["INV-002"], "blank", "the vendor's failure is the vendor's blank, in the denominator");
    assert.equal(o.issues.total["INV-003"], undefined, "no export at all: absent");
    assert.deepEqual(o.coverage.total, { graded: 2, absent: 1, noTruth: 0, clean: 1, wrong: 0, blank: 1 });
    assert.match(ok.stdout, /1 export\(s\) are textract's failure response and are graded blank on every mapped field: INV-002 \(.*InvalidS3ObjectException/);

    /* Item 19: a selector whose family cannot fit the exports (a typed field on AnalyzeDocument
       output) is said loudly, on the console and in the file, with what it would have needed. */
    writeFileSync(mapping, JSON.stringify({ total: { textract: { type: "TOTAL_AMOUNT" } } }));
    const dead = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=t", "--vendor=textract", `--exports=${exports}`, `--mapping=${mapping}`, `--out=${join(d, "dead.json")}`], { encoding: "utf8" });
    assert.equal(dead.status, 0, dead.stderr);
    assert.match(dead.stdout, /⚠ the textract selector \{"type":"TOTAL_AMOUNT"\} for "total" matched nothing in any of the 1 export\(s\) read; it reads .*none of them carries that/);
    assert.match(dead.stdout, /run without that feature/);
    const dj = JSON.parse(readFileSync(join(d, "dead.json"), "utf8"));
    assert.equal(dj.issues.total["INV-001"], "blank");
    assert.ok(dj.warnings.some((x: string) => /none of them carries that/.test(x)));
    /* A selector of the right family that matched nothing: the vendor may have returned nothing.
       Written, with the warning on the console and in the file. */
    writeFileSync(mapping, JSON.stringify({ total: { textract: { key: "Grand Total" } } }));
    const warned = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=t", "--vendor=textract", `--exports=${exports}`, `--mapping=${mapping}`, `--out=${join(d, "warned.json")}`], { encoding: "utf8" });
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stdout, /⚠ the textract selector \{"key":"Grand Total"\} for "total" matched nothing in any of the 1 export\(s\) read; the shape fits/);
    const w = JSON.parse(readFileSync(join(d, "warned.json"), "utf8"));
    assert.equal(w.issues.total["INV-001"], "blank");
    assert.ok(Array.isArray(w.warnings) && w.warnings.some((x: string) => /matched nothing in any of the 1 export/.test(x)), "the warning travels with the verdicts");
    assert.equal(o.warnings?.some((x: string) => /matched nothing/.test(x)) ?? false, false, "the first run had no dead selector");

    /* Item 24: every export unreadable (UTF-16 from PowerShell): the note names the files, and
       the refusal does not blame the identifiers. */
    const utf16 = join(d, "utf16");
    mkdirSync(utf16);
    writeFileSync(join(utf16, "INV-001.json"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(readFileSync(join(FIXTURES, "textract/INV-001.json"), "utf8"), "utf16le")]));
    writeFileSync(mapping, JSON.stringify({ total: { textract: { key: "Total Amount" } } }));
    const bom = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=t", "--vendor=textract", `--exports=${utf16}`, `--mapping=${mapping}`, `--out=${join(d, "u.json")}`], { encoding: "utf8" });
    assert.equal(bom.status, 1);
    assert.match(bom.stderr, /⚠ 1 export\(s\) could not be read as JSON and count as absent: INV-001\.json \(/);
    assert.match(bom.stderr, /UTF-16/);
    assert.ok(!/identifiers do not match/.test(bom.stderr), bom.stderr);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("F1: an empty expected cell is unknown, graded by nobody and counted apart, in grade", () => {
  const { champs, cas, kinds } = lireCsv("id,text,total:amount,tax:amount\nA,x,10.00,1.00\nB,x,20.00,\nC,x,30.00,   \n");
  /* The chain answered every case; on B and C there is nothing to grade the tax against. */
  const values = { total: { A: "10", B: "20", C: "30" }, tax: { A: "1", B: "2", C: "" } };
  const g = gradeValues(cas, champs, kinds, values);
  assert.deepEqual(g.issues["tax"], { A: "clean" }, "B and C carry no verdict: a value against an empty truth is neither wrong nor blank");
  assert.deepEqual(g.coverage["tax"], { graded: 1, absent: 0, noTruth: 2, clean: 1, wrong: 0, blank: 0 });
  assert.deepEqual(g.coverage["total"], { graded: 3, absent: 0, noTruth: 0, clean: 3, wrong: 0, blank: 0 });
  /* No truth comes before absent: a case nobody can grade is not an absent export either. */
  const partial = gradeValues(cas, champs, kinds, { tax: { A: "1" } });
  assert.deepEqual(partial.coverage["tax"], { graded: 1, absent: 0, noTruth: 2, clean: 1, wrong: 0, blank: 0 });
});

test("F2: a case in the values file that says nothing for a field is a blank; only a case absent from the whole file is absent", () => {
  const d = mkdtempSync(join(tmpdir(), "values-silence-"));
  try {
    const fields = ["total", "date"];
    const write = (name: string, o: unknown) => { const p = join(d, name); writeFileSync(p, JSON.stringify(o)); return p; };
    /* Per case: "2" is present without a date. */
    const perCase = readValues(write("case.json", { "1": { total: "5", date: "2026-01-01" }, "2": { total: "7" } }), fields);
    assert.equal(perCase.values["date"]!["2"], "", "present and silent: blank");
    assert.equal(perCase.silences, 1);
    assert.equal(perCase.cases, 2);
    /* Per field: "2" appears under total only. */
    const perField = readValues(write("field.json", { total: { "1": "5", "2": "7" }, date: { "1": "2026-01-01" } }), fields);
    assert.equal(perField.values["date"]!["2"], "");
    assert.equal(perField.silences, 1);
    /* A field the file never carries is not graded at all; a case the file never names is absent. */
    const only = readValues(write("only.json", { total: { "1": "5" } }), fields);
    assert.equal(only.values["date"], undefined);
    assert.equal(only.silences, 0);
    const { champs, cas, kinds } = lireCsv("id,text,total:amount,date:date\n1,x,5,2026-01-01\n2,x,7,2026-01-02\n3,x,9,2026-01-03\n");
    const g = gradeValues(cas, champs, kinds, perCase.values);
    assert.deepEqual(g.coverage["date"], { graded: 2, absent: 1, noTruth: 0, clean: 1, wrong: 0, blank: 1 }, "2 is blank, 3 is absent");
    assert.equal(g.issues["date"]!["2"], "blank");

    /* The command says how many were counted which way. */
    const csv = join(d, "cases.csv");
    writeFileSync(csv, "id,text,total:amount,date:date\n1,x,5,2026-01-01\n2,x,7,\n3,x,9,2026-01-03\n");
    const r = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=mine", `--values=${join(d, "case.json")}`, `--out=${join(d, "o.json")}`], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 value\(s\) counted BLANK: the case is in the file \(2 case\(s\) are\) and says nothing for the field/);
    assert.match(r.stdout, /date\s+date\s+.*absent 1, no truth 1 \(not graded\)/, r.stdout);
    const o = JSON.parse(readFileSync(join(d, "o.json"), "utf8"));
    assert.equal(o.issues.date["2"], undefined, "case 2 has no expected date: no verdict, whatever the chain said");
    assert.deepEqual(o.coverage.date, { graded: 1, absent: 1, noTruth: 1, clean: 1, wrong: 0, blank: 0 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});
