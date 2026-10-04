/*
 * The audit's decision core and cost model, on hand-made records where the right answer is
 * known. Most cases below are the review scenarios of 2026-09-29, each of which was red on
 * the audit as first written: they are kept as they were reported, numbers included.
 *
 * Two properties the whole audit rests on: nothing is recommended without a declared margin
 * (item 2), and a vendor is paid per page, once: two fields from the same vendor cost one
 * page, one field each from two vendors costs two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit, auditLines, priceOf, priceWords, readListPrices, vendorCostPerThousandPages, localCostPerThousandPages,
  type SourcePrice, type Cell, type AuditInputs } from "./audit.ts";
import { ENOUGH } from "./interval.ts";

/** A cell from a string of verdicts: "1" right, "0" wrong, "-" not graded. */
const cell = (bits: string, ms = Number.NaN): Cell => ({
  bons: [...bits].filter((b) => b === "1").length, sur: [...bits].filter((b) => b !== "-").length, ms, reussites: bits,
});
const ones = (n: number, wrongAt: number[] = []): string => Array.from({ length: n }, (_, i) => (wrongAt.includes(i) ? "0" : "1")).join("");
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

const vendor = (name: string, price: number): SourcePrice => ({ kind: "vendor", name, pricePerThousand: price, billing: "page", provenance: "declared" });
const unpriced = (name: string): SourcePrice => ({ kind: "vendor", name, pricePerThousand: null, billing: null, provenance: "unpriced" });
const base = (over: Partial<AuditInputs>): AuditInputs => ({
  fields: ["total"], kinds: {}, releve: {}, chains: [], current: null, pagesPerDocument: 1, pagesPerYear: null, machineHourlyCost: 1.2, ...over,
});

test("costs: a per-document price is spread over the pages of a document, a local tier is priced by its time", () => {
  assert.equal(vendorCostPerThousandPages(vendor("v", 25), 3), 25);
  assert.equal(vendorCostPerThousandPages({ kind: "vendor", name: "v", pricePerThousand: 30, billing: "document", provenance: "declared" }, 3), 10);
  assert.equal(vendorCostPerThousandPages(unpriced("v"), 1), null);
  /* 3.6 s of machine per document at $1.20 an hour is $1.20 per thousand documents. */
  assert.ok(Math.abs(localCostPerThousandPages(3600, 1.2, 1) - 1.2) < 1e-9);
  assert.ok(Math.abs(localCostPerThousandPages(3600, 1.2, 2) - 0.6) < 1e-9);
  assert.equal(localCostPerThousandPages(Number.NaN, 1.2, 1), 0);
});

test("the price of a chain: declared first, else the list price with its date and tier, else unpriced", () => {
  const list = readListPrices();
  assert.equal(list.readOn, "2026-09-29");
  assert.ok(Object.keys(list.vendors).length >= 5);
  for (const [k, v] of Object.entries(list.vendors)) {
    /* An entry is verified only by a re-reading dated on or after the table, with its URL:
       the 2026-09-29 entries were not re-read and say so; the Expense Parser entry was. */
    if (v.verified) {
      assert.ok(v.readOn >= list.readOn && /^https:\/\//.test(v.url), `${k}: a verified entry carries the date of its re-reading and its source`);
    } else {
      assert.equal(v.verified, false, `${k}: an entry not re-read must say so`);
    }
    /* A list price is a first-tier price. An entry that carries no monthly tier must say so
       in words, so that the audit's over-tier check knows it has nothing to compare. */
    if (v.tierPagesPerMonth === undefined) {
      assert.match(v.tier ?? "", /no monthly tier/, `${k}: an entry without a numeric tier must say in words that it carries none`);
    } else {
      assert.ok(v.tierPagesPerMonth > 0, `${k}: a tier is a positive number of pages a month`);
    }
  }
  const expense = list.vendors["google-document-ai-expense-parser"]!;
  assert.equal(expense.pricePerThousandPages, 100);
  assert.equal(expense.billing, "document");
  assert.equal(expense.verified, true);
  assert.equal(expense.readOn, "2026-10-04");
  const declared = priceOf("mine", { pricePerThousandPages: 12, vendor: "aws-textract-forms" }, list);
  assert.equal(declared.provenance, "declared");
  assert.equal(declared.pricePerThousand, 12, "the contract wins over the list");
  const listed = priceOf("theirs", { vendor: "aws-textract-analyzeid" }, list);
  assert.equal(listed.provenance, "list-price");
  assert.equal(listed.pricePerThousand, 25);
  assert.equal(listed.provenance === "list-price" ? listed.listPrice.readOn : "", "2026-09-29");
  assert.equal(listed.provenance === "list-price" ? listed.listPrice.tierPagesPerMonth : 0, 100_000);
  assert.equal(priceOf("none", undefined, list).provenance, "unpriced");
  assert.equal(priceOf("none", { billing: "document" }, null).provenance, "unpriced");
  assert.throws(() => priceOf("x", { vendor: "nope" }, list), /not a key of vendor-prices.json/);
});

test("review item 5: the documented key coutParMilleDocuments is a declared price per thousand documents, ahead of the list price", () => {
  const list = readListPrices();
  const p = priceOf("mine", { coutParMilleDocuments: 40, vendor: "aws-textract-forms" }, list);
  assert.equal(p.provenance, "declared", "a declared per-document price is not ignored for a list price");
  assert.equal(p.pricePerThousand, 40);
  assert.equal(p.billing, "document");
  assert.equal(vendorCostPerThousandPages(p, 4), 10, "forty dollars per thousand four-page documents is ten per thousand pages");
  const q = priceOf("mine", { pricePerThousandDocuments: 40 }, null);
  assert.deepEqual({ pricePerThousand: q.pricePerThousand, billing: q.billing }, { pricePerThousand: 40, billing: "document" });
});

test("review item 6: the unit is the key's, the label says documents, and a contradicting billing is refused", () => {
  const perDocument = priceOf("mine", { pricePerThousandDocuments: 50 }, null);
  assert.equal(priceWords(perDocument), priceWords(perDocument).replace(/pages/, "documents"), "the label never says pages for a per-document price");
  assert.match(priceWords(perDocument), /50 per 1,000 documents$/);
  assert.match(priceWords(priceOf("mine", { pricePerThousandPages: 50 }, null)), /50 per 1,000 pages$/);
  assert.equal(vendorCostPerThousandPages(perDocument, 4), 12.5);
  assert.throws(() => priceOf("mine", { pricePerThousandPages: 50, billing: "document" }, null), /price per page\) and billing "document"/);
  assert.throws(() => priceOf("mine", { pricePerThousandPages: 50, pricePerThousandDocuments: 40 }, null), /one price, in one unit/);
  assert.equal(priceOf("mine", { pricePerThousandPages: 50, billing: "page" }, null).billing, "page", "a billing that agrees with the key is fine");
});

test("review item 20: a negative price is refused by the price reader, whatever loader let it through", () => {
  assert.throws(() => priceOf("mine", { pricePerThousandPages: -5 }, null), /not a price \(dollars, zero or more\)/);
  assert.throws(() => priceOf("mine", { coutParMilleDocuments: -1 }, null), /not a price/);
  assert.equal(priceOf("free", { pricePerThousandPages: 0 }, null).pricePerThousand, 0, "zero is a price");
});

test("the price table refuses a table that is not one, a price that is not a number, and a tier that is not one", () => {
  const d = mkdtempSync(join(tmpdir(), "prices-"));
  try {
    const p = join(d, "p.json");
    const entry = { pricePerThousandPages: 25, billing: "page", url: "u", readOn: "d" };
    const table = (a: Record<string, unknown>) => JSON.stringify({ kind: "cascade-vendor-list-prices", version: 1, readOn: "2026-09-29", vendors: { a } });
    writeFileSync(p, JSON.stringify({ kind: "other" }));
    assert.throws(() => readListPrices(p), /not a vendor price table/);
    writeFileSync(p, JSON.stringify({ kind: "cascade-vendor-list-prices", version: 99, readOn: "2026-09-29", vendors: {} }));
    assert.throws(() => readListPrices(p), /version 99 of the price table/, "a table written for another shape is refused, not half-read");
    writeFileSync(p, table({ ...entry, pricePerThousandPages: "25" }));
    assert.throws(() => readListPrices(p), /no readable price/);
    writeFileSync(p, table({ ...entry, billing: "call" }));
    assert.throws(() => readListPrices(p), /no billing unit/);
    writeFileSync(p, table({ ...entry, tierPagesPerMonth: "many" }));
    assert.throws(() => readListPrices(p), /tier that is not a positive number/);
    writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(table(entry))]));
    assert.equal(readListPrices(p).vendors["a"]!.pricePerThousandPages, 25, "a byte-order mark is read past (item 24)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

/* ───────────────────────────── review items 2 and 11: no margin, no recommendation ───────────────────────────── */

test("review item 2: without a margin, a source twenty-five points behind is listed as an option and never routed to", () => {
  /* 20 cases, vendor-a 20/20 at $50, rules 15/20: five disagreements, all for vendor-a, p = 0.063. */
  const releve = { total: { "vendor-a": cell(ones(20)), rules: cell(ones(20, [0, 1, 2, 3, 4]), 1) } };
  const a = audit(base({ releve, chains: [vendor("vendor-a", 50)], current: "vendor-a", pagesPerYear: 1_000_000 }));
  assert.equal(a.margin, null);
  assert.equal(a.fields["total"]!.head, "vendor-a");
  assert.equal(a.fields["total"]!.sources["rules"]!.standing, "not-separable");
  assert.deepEqual(a.fields["total"]!.inseparable, ["rules"], "the option is listed");
  assert.equal(a.routing["total"], null, "and not routed to");
  assert.equal(a.cost.recommended, null);
  assert.equal(a.cost.annual, null, "no saving is stated on a loss nobody accepted");
  assert.equal(a.cost.current?.perThousandPages, 50, "what is paid today is still stated");
  assert.ok(a.omitted.some((o) => /no margin was declared/.test(o)));
  const text = auditLines(a).join("\n");
  assert.ok(!/Recommended routing/.test(text) && !/saving \$/.test(text), text);
  assert.match(text, /nothing is recommended for total\. Options this sample cannot separate from vendor-a: rules\./);
  assert.match(text, /--margin=2/);
});

test("review item 11: vendor 30/30 at $50 against small 25/30 (p = 0.063) states no saving without a margin, and none within a two-point one", () => {
  const releve = { total: { vendor: cell(ones(30)), small: cell(ones(30, [0, 1, 2, 3, 4]), 5) } };
  const chains = [vendor("vendor", 50)];
  const loose = audit(base({ releve, chains, current: "vendor", pagesPerYear: 1_000_000 }));
  assert.equal(loose.cost.annual, null);
  const strict = audit(base({ releve, chains, current: "vendor", pagesPerYear: 1_000_000, margin: 0.02 }));
  assert.equal(strict.routing["total"], "vendor", "small is not within two points: the vendor keeps the field");
  assert.equal(strict.fields["total"]!.sources["small"]!.standing, "not-separable");
  assert.equal(strict.cost.annual?.saving, 0);
});

/* ───────────────────────────── review item 3, wired: the paired-difference interval decides ───────────────────────────── */

test("review item 3: an identical candidate is non-inferior within a six-point margin on sixty cases, and a worse one has a wider worst case", () => {
  const head = ones(60, [1, 2, 3]);
  const releve = { total: { vendor: cell(head), twin: cell(head, 2), worse: cell(ones(60, [1, 2, 3, 10, 11, 12, 13]), 1) } };
  const a = audit(base({ releve, chains: [vendor("vendor", 50)], current: "vendor", pagesPerYear: 100_000, margin: 0.06 }));
  const twin = a.fields["total"]!.sources["twin"]!, worse = a.fields["total"]!.sources["worse"]!;
  assert.equal(twin.standing, "non-inferior");
  assert.ok(twin.paired!.high < worse.paired!.high, "a candidate that only loses cases has a larger worst case than an identical one");
  assert.equal(a.routing["total"], "twin", "the free identical tier takes the field");
  assert.ok(a.cost.annual!.saving > 4_999 && a.cost.annual!.saving <= 5_000, String(a.cost.annual?.saving));
});

/* ───────────────────────────── review items 7 and 8: the head is the best, priced or not ───────────────────────────── */

test("review item 7: an unpriced chain that is the best is the head; nothing separably worse is routed to, and the lines say who is best", () => {
  const n = 60;
  const releve = { total: { mine: cell(ones(n)), cheap: cell(ones(n, range(0, 20))), small: cell(ones(n, range(0, 25)), 3) } };
  for (const margin of [undefined, 0.05]) {
    const a = audit(base({ releve, chains: [unpriced("mine"), vendor("cheap", 10)], current: "mine", pagesPerYear: 1_000_000, margin }));
    const f = a.fields["total"]!;
    assert.equal(f.head, "mine", "the head is chosen among all reportable sources, priced or not");
    assert.equal(f.sources["cheap"]!.standing, "separably-worse");
    assert.equal(f.sources["small"]!.standing, "separably-worse");
    assert.equal(a.routing["total"], null, "no costed source keeps up with the best: nothing is routed");
    assert.equal(a.cost.annual, null);
    const text = auditLines(a).join("\n");
    assert.equal((text.match(/best on this sample/g) ?? []).length, 1, "printed once, for the head");
    assert.match(text, /mine\s+100\.0 %.*best on this sample/);
    assert.match(text, /cheap.*separably worse than mine/);
    if (margin !== undefined) assert.match(text, /mine has the highest accuracy here and no price to route to/);
  }
});

test("review item 8: the current vendor unpriced at 60/60, vendor-b at 42/60 and rules at 40/60: no routing to rules, and no saving", () => {
  const n = 60;
  const releve = { total: { current: cell(ones(n)), "vendor-b": cell(ones(n, range(0, 18))), rules: cell(ones(n, range(0, 20)), 1) } };
  const a = audit(base({ releve, chains: [unpriced("current"), vendor("vendor-b", 10)], current: "current", pagesPerYear: 1_000_000, margin: 0.03 }));
  assert.equal(a.routing["total"], null);
  assert.equal(a.cost.recommended, null);
  assert.equal(a.cost.annual, null);
  assert.ok(a.omitted.some((o) => /"current" has no price, so no saving/.test(o)));
});

/* ───────────────────────────── review items 9 and 10: the paired sample size, and disjoint cases ───────────────────────────── */

test("review item 9: two chains sharing one case are not compared, and the one-case pair never admits a routing", () => {
  /* vendor-a on cases 0-29 (30/30, $50), vendor-b on cases 29-59 (21/31, $10): one case in common. */
  const releve = {
    total: {
      "vendor-a": cell(ones(30) + "-".repeat(30)),
      "vendor-b": cell("-".repeat(29) + ones(31, range(0, 10))),
      rules: cell(ones(60, range(0, 30)), 1),
    },
  };
  const a = audit(base({ releve, chains: [vendor("vendor-a", 50), vendor("vendor-b", 10)], current: "vendor-a", pagesPerYear: 1_000_000, margin: 0.1 }));
  const f = a.fields["total"]!;
  assert.equal(f.head, "vendor-a");
  assert.equal(f.sources["vendor-b"]!.standing, "too-few-paired");
  assert.equal(f.sources["vendor-b"]!.pairedCases, 1);
  assert.equal(f.sources["vendor-b"]!.paired, undefined, "no p, no interval on one paired case");
  assert.ok(!f.admissible.includes("vendor-b"), "too few paired cases is never admissible");
  assert.equal(a.routing["total"], "vendor-a");
  assert.equal(a.cost.annual?.saving, 0, "no forty-thousand-dollar saving on one shared case");
  assert.match(auditLines(a).join("\n"), /vendor-b.*only 1 case\(s\) graded on both sides \(20 needed\)/);
});

test("review item 10: two vendors graded on disjoint cases do not crash the audit; the standing says no overlap", () => {
  const releve = { total: { "vendor-a": cell(ones(30) + "-".repeat(30)), "vendor-b": cell("-".repeat(30) + ones(30, [0, 1])) } };
  let a;
  assert.doesNotThrow(() => { a = audit(base({ releve, chains: [vendor("vendor-a", 50), vendor("vendor-b", 10)], current: "vendor-a", margin: 0.02 })); });
  assert.equal(a!.fields["total"]!.sources["vendor-b"]!.standing, "no-overlap");
  assert.equal(a!.routing["total"], "vendor-a");
  assert.match(auditLines(a!).join("\n"), /vendor-b.*no case graded on both sides/);
});

/* ───────────────────────────── review item 12: a pick measurably worse than another admissible source ───────────────────────────── */

test("review item 12: B is inside the margin against H and measurably worse than A case for case; the audit says so on the pick", () => {
  /* H 38/40 at $50, A 37/40 at $30, B 31/40 at $5. A beats B 6 to 0 (p = 0.031). A margin
     wide enough for B keeps B admissible: the margin is the client's criterion. */
  const releve = { total: { H: cell(ones(40, [0, 1])), A: cell(ones(40, [0, 1, 2])), B: cell(ones(40, range(0, 9))) } };
  const a = audit(base({ releve, chains: [vendor("H", 50), vendor("A", 30), vendor("B", 5)], current: "H", pagesPerYear: 1_000_000, margin: 0.4 }));
  assert.equal(a.routing["total"], "B");
  assert.deepEqual(a.fields["total"]!.sources["B"]!.measurablyWorseThan?.sort(), ["A", "H"]);
  assert.ok(a.worse.some((w) => w.source === "B" && w.against === "A" && w.p !== null && w.p < 0.05));
  const text = auditLines(a).join("\n");
  assert.match(text, /B .*measurably worse than A, H case for case/);
  assert.match(text, /⚠ 2 comparison\(s\) where the pick is measurably worse than another admissible source/);
  assert.match(text, /total: B is at least [\d.]+ points behind A/);
});

/* ───────────────────────────── review item 13: no rate under ENOUGH cases, anywhere ───────────────────────────── */

test("review item 13: a source with thirteen cases is listed with no rate, in the lines and in the record", () => {
  const releve = { total: { "vendor-a": cell(ones(40, [1])), "vendor-b": cell(ones(13, [2]) + "-".repeat(27)) } };
  const a = audit(base({ releve, chains: [vendor("vendor-a", 50), vendor("vendor-b", 10)], current: "vendor-a", margin: 0.02 }));
  const s = a.fields["total"]!.sources["vendor-b"]!;
  assert.equal(s.standing, "too-few");
  assert.deepEqual({ accuracy: s.accuracy, low: s.low, high: s.high, n: s.n }, { accuracy: null, low: null, high: null, n: 13 });
  const text = auditLines(a).join("\n");
  assert.match(text, /vendor-b\s+n\/a \(n=13, too few to quote\)/);
  assert.ok(!/92\.3/.test(text), "the rate of thirteen cases is never printed");
});

/* ───────────────────────────── review item 23: list prices are first-tier prices ───────────────────────────── */

test("review item 23: above the list price's monthly tier no annual figure is stated, and the reason names the tier", () => {
  const list = readListPrices();
  const n = 60;
  const releve = { total: { mine: cell(ones(n)), rules: cell(ones(n), 1) } };
  const chains = [priceOf("mine", { vendor: "aws-textract-analyzeid" }, list)];
  const inside = audit(base({ releve, chains, current: "mine", pagesPerYear: 1_200_000, margin: 0.02 }));
  assert.ok(inside.cost.annual, "a hundred thousand pages a month is the first tier");
  const over = audit(base({ releve, chains, current: "mine", pagesPerYear: 2_400_000, margin: 0.02 }));
  assert.equal(over.cost.annual, null);
  assert.ok(over.omitted.some((o) => /applies to the first 100,000 pages a month/.test(o) && /no annual figure until a price is declared/.test(o)), over.omitted.join("\n"));
  assert.ok(over.cost.recommended, "the per-thousand-pages figures stand; only the year is refused");
});

/* ───────────────────────────── the page model, under a margin ───────────────────────────── */

test("one vendor for two fields costs one page; splitting the fields across two vendors is never picked when one covers both", () => {
  const n = 60;
  const releve = {
    total: { cheap: cell(ones(n)), dear: cell(ones(n)) },
    date: { cheap: cell(ones(n)), dear: cell(ones(n)) },
  };
  /* Sixty cases with no disagreement bound the difference at about six points either way
     (paired-difference.ts): a seven-point margin admits both vendors on both fields. */
  const a = audit(base({ fields: ["total", "date"], releve, chains: [vendor("cheap", 20), vendor("dear", 24)], current: "dear", pagesPerYear: 1_000_000, margin: 0.07 }));
  assert.deepEqual(a.routing, { total: "cheap", date: "cheap" });
  assert.equal(a.cost.recommended?.perThousandPages, 20);
  assert.deepEqual(a.cost.recommended?.vendors, ["cheap"]);
  assert.equal(a.cost.current?.perThousandPages, 24);
  assert.equal(a.cost.annual?.saving, 4000);
  assert.equal(a.cost.annual?.current, 24_000);
});

test("a second vendor is added only when it buys a field the first cannot carry, and then both pages are paid", () => {
  const n = 60;
  const releve = {
    total: { cheap: cell(ones(n)), dear: cell(ones(n)) },
    signature: { cheap: cell(ones(n, range(0, 25))), dear: cell(ones(n)) },
  };
  const a = audit(base({ fields: ["total", "signature"], releve, chains: [vendor("cheap", 10), vendor("dear", 30)], current: "dear", margin: 0.07 }));
  assert.deepEqual(a.routing, { total: "dear", signature: "dear" }, "once dear's page is paid, total comes free from it too");
  assert.equal(a.cost.recommended?.perThousandPages, 30);
  assert.equal(a.fields["signature"]!.sources["cheap"]!.standing, "separably-worse");
  assert.equal(a.cost.annual, null, "no annual volume declared: no annual figure");
  assert.ok(a.omitted.some((o) => /pages-per-year/.test(o)));
});

test("a local tier non-inferior to the vendor takes the field, the vendor's page is not paid, and the pair is flagged when not separable", () => {
  const n = 80;
  /* Two misses against one: three disagreements, an interval that covers zero, and a worst
     case inside eight points. The free tier takes the field, and the pick is flagged. */
  const releve = { total: { vendor: cell(ones(n, [5]), Number.NaN), rules: cell(ones(n, [6, 7]), 0.02) } };
  /* Three disagreements on eighty cases put the head's worst-case advantage at 7.5 points. */
  const a = audit(base({ kinds: { total: "amount" }, releve, chains: [vendor("vendor", 50)], current: "vendor", pagesPerDocument: 2, pagesPerYear: 500_000, margin: 0.08 }));
  assert.equal(a.routing["total"], "rules");
  assert.equal(a.fields["total"]!.head, "vendor");
  assert.equal(a.fields["total"]!.sources["rules"]!.standing, "non-inferior");
  assert.deepEqual(a.fields["total"]!.inseparable, ["rules"]);
  assert.equal(a.inseparable.length, 1, "the pick is flagged: the sample cannot separate the two");
  assert.equal(a.inseparable[0]!.discordant, 3);
  assert.deepEqual(a.cost.recommended?.vendors, []);
  assert.ok(a.cost.recommended!.perThousandPages < 0.01);
  assert.equal(a.cost.current?.perThousandPages, 50);
  assert.ok(a.cost.annual!.saving > 24_999 && a.cost.annual!.saving <= 25_000);
  assert.equal(a.fields["total"]!.kind, "amount");
});

test("under ENOUGH graded cases a source is listed and not compared; with nothing above the floor nothing is chosen", () => {
  const few = ENOUGH - 1;
  const releve = { f: { vendor: cell(ones(few)), rules: cell(ones(few), 1) } };
  const a = audit(base({ fields: ["f"], releve, chains: [vendor("vendor", 10)], current: "vendor", margin: 0.02 }));
  assert.equal(a.fields["f"]!.head, null);
  assert.equal(a.routing["f"], null);
  assert.match(a.fields["f"]!.note ?? "", /nothing can be compared or chosen/);
  assert.equal(a.fields["f"]!.sources["vendor"]!.standing, "too-few");
  assert.match(auditLines(a).join("\n"), /nothing can be compared or chosen/);
});

test("a chain graded on part of the cases only is compared on the cases both saw", () => {
  const n = 50;
  /* The chain was graded on the first thirty cases only ("-" elsewhere): the paired test runs
     on those thirty, and the chain's own rate is over thirty, not fifty. */
  const releve = { f: { chain: cell(ones(30, [3]) + "-".repeat(20)), rules: cell(ones(n, [3, 40, 41]), 1) } };
  /* Thirty cases with no disagreement bound the difference at about eleven points: a smaller
     margin cannot be shown on thirty cases, whatever the two rates say. */
  const a = audit(base({ fields: ["f"], releve, chains: [vendor("chain", 10)], current: "chain", margin: 0.12 }));
  assert.equal(a.fields["f"]!.sources["chain"]!.n, 30);
  assert.equal(a.fields["f"]!.head, "chain", "29 of 30 ranks above 47 of 50");
  assert.equal(a.fields["f"]!.sources["rules"]!.standing, "non-inferior");
  assert.equal(a.fields["f"]!.sources["rules"]!.paired?.n, 30);
  assert.equal(a.fields["f"]!.sources["rules"]!.paired?.discordant, 0, "the two disagreements fall outside the cases the chain saw");
});

test("the audit refuses a margin that is not a proportion", () => {
  assert.throws(() => audit(base({ releve: { total: { v: cell(ones(30)) } }, margin: 2 })), /not a proportion strictly between 0 and 1/);
});

test("the lines name the recommended routing, the saving and every unseparated pair, and never invent an interval on money", () => {
  const n = 60;
  const releve = { total: { cheap: cell(ones(n)), dear: cell(ones(n)) } };
  const a = audit(base({ kinds: { total: "amount" }, releve, chains: [vendor("cheap", 20), vendor("dear", 24)], current: "dear", pagesPerYear: 1_000_000, margin: 0.07 }));
  const text = auditLines(a).join("\n");
  assert.match(text, /\(margin: 7-point, your declaration\)/);
  assert.match(text, /Recommended routing: total ← cheap/);
  assert.match(text, /saving \$4,000 a year/);
  assert.match(text, /rest on pairs this sample cannot separate/);
  assert.match(text, /the money is not/);
  assert.ok(!/\$[\d,.]+ \[/.test(text), "no interval is attached to a dollar figure");
});

test("F9: every price is printed in its declared unit; a total in mixed units says the conversion", () => {
  /* The founder's run: both chains declared per thousand documents (gemini 4.29, google 100),
     one page a document, and the table and the Cost line printed them "per 1,000 pages". */
  const perDocument = (name: string, price: number): SourcePrice => ({ kind: "vendor", name, pricePerThousand: price, billing: "document", provenance: "declared" });
  const gemini = "1".repeat(91) + "0".repeat(4), google = "1".repeat(86) + "0".repeat(5) + "1".repeat(2) + "0".repeat(2);
  const cellule = (bits: string) => ({ bons: bits.split("").filter((b) => b === "1").length, sur: bits.length, ms: Number.NaN, reussites: bits });
  const releve = { total: { gemini: cellule(gemini), google: cellule(google) } };
  const a = audit(base({ kinds: { total: "amount-grouped" }, releve, chains: [perDocument("gemini", 4.29), perDocument("google", 100)],
    current: "google", pagesPerDocument: 1, pagesPerYear: 1_000_000, margin: 0.02 }));
  assert.equal(a.routing["total"], "gemini", "the head is priced and nothing else is admissible within two points");
  const lines = auditLines(a);
  const text = lines.join("\n");
  assert.ok(!text.includes("$4.29 per 1,000 pages") && !text.includes("$100 per 1,000 pages"), `a per-document price under the per-page label:\n${text}`);
  assert.ok(lines.some((l) => /gemini\s+.*\$4\.29 per 1,000 documents/.test(l)), text);
  assert.ok(lines.some((l) => /google\s+.*\$100 per 1,000 documents/.test(l)), text);
  assert.ok(lines.some((l) => /^  Cost: \$4\.29 per 1,000 documents \(vendor prices: gemini \$4\.29 per 1,000 documents, local machine time \$0\.00\)\.$/.test(l)), text);
  assert.ok(lines.some((l) => /^  Current chain google: \$100 per 1,000 documents\.$/.test(l)), text);
  assert.ok(lines.some((l) => /^  At 1,000,000 pages a year \(1 page a document\): \$100,000 today, \$4,290 recommended, saving \$95,710 a year\.$/.test(l)), text);
  /* The record says the unit of each price and of the total; nothing in it reads "per 1,000 pages". */
  assert.deepEqual(a.fields["total"]!.sources["gemini"]!.declaredPrice, { perThousand: 4.29, billing: "document" });
  assert.deepEqual(a.cost.current?.declared, { perThousand: 100, billing: "document" });
  assert.equal(a.cost.recommended?.unit, "document");
  assert.ok(!JSON.stringify(a).includes("per 1,000 pages"));
  /* A per-page chain still reads per page, and a local tier's machine time is per page. */
  const b = audit(base({ kinds: { total: "amount" }, releve: { total: { vendor: cellule(gemini), rules: { ...cellule(google), ms: 2 } } },
    chains: [vendor("vendor", 50)], current: "vendor", margin: 0.02 }));
  const tb = auditLines(b).join("\n");
  assert.match(tb, /vendor\s+.*\$50\.00 per 1,000 pages/);
  assert.match(tb, /Current chain vendor: \$50\.00 per 1,000 pages\./);
  assert.equal(b.fields["total"]!.sources["rules"]!.declaredPrice, null);

  /* Mixed units, two pages a document: total ← gemini (per document), tax ← google (per page).
     The total is stated per thousand pages and says how the per-document price was counted. */
  const perPage = (name: string, price: number): SourcePrice => ({ kind: "vendor", name, pricePerThousand: price, billing: "page", provenance: "declared" });
  const c = audit(base({ fields: ["total", "tax"], kinds: { total: "amount-grouped", tax: "amount-grouped" },
    releve: { total: { gemini: cellule(gemini), google: cellule(google) }, tax: { gemini: cellule(google), google: cellule(gemini) } },
    chains: [perDocument("gemini", 4.29), perPage("google", 100)], current: "google", pagesPerDocument: 2, pagesPerYear: 1_000_000, margin: 0.02 }));
  assert.deepEqual(c.routing, { total: "gemini", tax: "google" });
  assert.equal(c.cost.recommended?.unit, "page");
  const tc = auditLines(c);
  const cost = tc.find((l) => l.startsWith("  Cost:"))!;
  /* 4.29 over two pages plus 100: 102.145, which the money formatter rounds above a hundred. */
  assert.match(cost, /^  Cost: \$102 per 1,000 pages \(vendor prices: gemini \$4\.29 per 1,000 documents \+ google \$100 per 1,000 pages, local machine time \$0\.00; per-document prices counted at 2 pages a document\)\.$/);
  assert.ok(!tc.join("\n").includes("$4.29 per 1,000 pages"));
  assert.ok(tc.some((l) => /gemini\s+.*\$4\.29 per 1,000 documents/.test(l)));
  assert.ok(tc.some((l) => /At 1,000,000 pages a year \(2 pages a document\)/.test(l)));
});
