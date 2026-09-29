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
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { textractValue, textractShape, isTextractSelector } from "./vendor-textract.ts";
import { documentAiValue, documentAiShape, isDocumentAiSelector, anchoredText } from "./vendor-documentai.ts";
import { azureValue, azureShape, isAzureSelector, typedValue } from "./vendor-azure.ts";
import { loadMapping, readExports, valuesFromExports } from "./vendors.ts";
import { lireCsv, chargerSorties } from "./your-cases.ts";
import { gradeValues, readValuesFile, readPrice, readBilling, slug } from "./grade.ts";

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
  assert.deepEqual(g.coverage["invoice_number"], { graded: 1, absent: 2, clean: 1, wrong: 0, blank: 0 });
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
    assert.deepEqual(plain(readValuesFile(write({ "1": { total: "5", date: null }, "2": { total: 7 } }), fields)),
      { total: { "1": "5", "2": "7" }, date: { "1": "" } });
    assert.deepEqual(plain(readValuesFile(write({ total: { "1": "5" } }), fields)), { total: { "1": "5" } });
    assert.throws(() => readValuesFile(write({ "1": { total: ["a"] } }), fields), /not a value/);
    assert.throws(() => readValuesFile(write({ "1": { other: "x" } }), fields), /none of its keys names a field/);
    assert.throws(() => readValuesFile(write([]), fields), /expected an object/);
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.equal(readPrice("25"), 25);
  assert.equal(readPrice(undefined), undefined);
  assert.throws(() => readPrice("free"), /not a price/);
  assert.throws(() => readPrice("-1"), /not a price/);
  assert.equal(readBilling("document"), "document");
  assert.throws(() => readBilling("call"), /not a billing unit/);
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
    const v = spawnSync(process.execPath, [GRADE, `--cases=${csv}`, "--name=my chain", `--values=${values}`, "--billing=document", `--out=${join(d, "o.json")}`], { encoding: "utf8" });
    assert.equal(v.status, 0, v.stderr);
    const o = JSON.parse(readFileSync(join(d, "o.json"), "utf8"));
    assert.deepEqual(o.issues.total, { "INV-001": "clean", "INV-002": "wrong" });
    assert.deepEqual(o.declares, { billing: "document" });

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
