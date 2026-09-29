/*
 * The audit's cost model and routing, on hand-made records where the right answer is known.
 *
 * The property the whole audit rests on: a vendor is paid per page, once. Two fields taken
 * from the same vendor cost one page; one field each from two vendors costs two. A per-field
 * optimiser cannot see that, and these cases are written so that it would get them wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit, auditLines, priceOf, readListPrices, vendorCostPerThousandPages, localCostPerThousandPages, type SourcePrice, type Cell } from "./audit.ts";
import { ENOUGH } from "./interval.ts";

/** A cell from a string of verdicts: "1" right, "0" wrong, "-" not graded. */
const cell = (bits: string, ms = Number.NaN): Cell => ({
  bons: [...bits].filter((b) => b === "1").length, sur: [...bits].filter((b) => b !== "-").length, ms, reussites: bits,
});
const ones = (n: number, wrongAt: number[] = []): string => Array.from({ length: n }, (_, i) => (wrongAt.includes(i) ? "0" : "1")).join("");

const vendor = (name: string, price: number): SourcePrice => ({ kind: "vendor", name, pricePerThousandPages: price, billing: "page", provenance: "declared" });

test("costs: a per-document price is spread over the pages of a document, a local tier is priced by its time", () => {
  assert.equal(vendorCostPerThousandPages(vendor("v", 25), 3), 25);
  assert.equal(vendorCostPerThousandPages({ kind: "vendor", name: "v", pricePerThousandPages: 30, billing: "document", provenance: "declared" }, 3), 10);
  assert.equal(vendorCostPerThousandPages({ kind: "vendor", name: "v", pricePerThousandPages: null, billing: "page", provenance: "unpriced" }, 1), null);
  /* 3.6 s of machine per document at $1.20 an hour is $1.20 per thousand documents. */
  assert.ok(Math.abs(localCostPerThousandPages(3600, 1.2, 1) - 1.2) < 1e-9);
  assert.ok(Math.abs(localCostPerThousandPages(3600, 1.2, 2) - 0.6) < 1e-9);
  assert.equal(localCostPerThousandPages(Number.NaN, 1.2, 1), 0);
});

test("the price of a chain: declared first, else the list price with its date, else unpriced", () => {
  const list = readListPrices();
  assert.equal(list.readOn, "2026-09-29");
  assert.ok(Object.keys(list.vendors).length >= 5);
  for (const v of Object.values(list.vendors)) assert.equal(v.verified, false, "no entry was re-read from this environment; the table must say so");
  const declared = priceOf("mine", { pricePerThousandPages: 12, vendor: "aws-textract-forms" }, list);
  assert.equal(declared.provenance, "declared");
  assert.equal(declared.kind === "vendor" ? declared.pricePerThousandPages : null, 12, "the contract wins over the list");
  const listed = priceOf("theirs", { vendor: "aws-textract-forms" }, list);
  assert.equal(listed.provenance, "list-price");
  assert.equal(listed.kind === "vendor" ? listed.pricePerThousandPages : null, 50);
  assert.equal(listed.provenance === "list-price" ? listed.listPrice?.readOn : "", "2026-09-29");
  assert.equal(priceOf("none", undefined, list).provenance, "unpriced");
  assert.equal(priceOf("none", { billing: "document" }, null).provenance, "unpriced");
  assert.throws(() => priceOf("x", { vendor: "nope" }, list), /not a key of vendor-prices.json/);
});

test("the price table refuses a table that is not one, and a price that is not a number", () => {
  const d = mkdtempSync(join(tmpdir(), "prices-"));
  try {
    const p = join(d, "p.json");
    writeFileSync(p, JSON.stringify({ kind: "other" }));
    assert.throws(() => readListPrices(p), /not a vendor price table/);
    writeFileSync(p, JSON.stringify({ kind: "cascade-vendor-list-prices", version: 99, readOn: "2026-09-29", vendors: {} }));
    assert.throws(() => readListPrices(p), /version 99 of the price table/, "a table written for another shape is refused, not half-read");
    writeFileSync(p, JSON.stringify({ kind: "cascade-vendor-list-prices", version: 1, readOn: "2026-09-29", vendors: { a: { pricePerThousandPages: "25", billing: "page", url: "u", readOn: "d" } } }));
    assert.throws(() => readListPrices(p), /no readable price/);
    writeFileSync(p, JSON.stringify({ kind: "cascade-vendor-list-prices", version: 1, readOn: "2026-09-29", vendors: { a: { pricePerThousandPages: 25, billing: "call", url: "u", readOn: "d" } } }));
    assert.throws(() => readListPrices(p), /no billing unit/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("one vendor for two fields costs one page; splitting the fields across two vendors is never picked when one covers both", () => {
  const n = 60;
  /* Both vendors are perfect on both fields; a per-field optimiser would be indifferent, the
     page model is not: one vendor at $20 beats two vendors at $12 + $12. */
  const releve = {
    total: { cheap: cell(ones(n)), dear: cell(ones(n)) },
    date: { cheap: cell(ones(n)), dear: cell(ones(n)) },
  };
  const a = audit({ fields: ["total", "date"], kinds: {}, releve, chains: [vendor("cheap", 20), vendor("dear", 24)], current: "dear",
    pagesPerDocument: 1, pagesPerYear: 1_000_000, machineHourlyCost: 1.2 });
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
    /* On `total` both are perfect. On `signature` the cheap vendor is separably worse. */
    total: { cheap: cell(ones(n)), dear: cell(ones(n)) },
    signature: { cheap: cell(ones(n, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])), dear: cell(ones(n)) },
  };
  const a = audit({ fields: ["total", "signature"], kinds: {}, releve, chains: [vendor("cheap", 10), vendor("dear", 30)], current: "dear",
    pagesPerDocument: 1, pagesPerYear: null, machineHourlyCost: 1.2 });
  /* `dear` is needed for the signature; once its page is paid, `total` comes free from it too,
     so the routing does not also pay `cheap`. */
  assert.deepEqual(a.routing, { total: "dear", signature: "dear" });
  assert.equal(a.cost.recommended?.perThousandPages, 30);
  assert.equal(a.fields["signature"]!.sources["cheap"]!.standing, "separably-worse");
  assert.equal(a.cost.annual, null, "no annual volume declared: no annual figure");
  assert.ok(a.omitted.some((o) => /pages-per-year/.test(o)));
});

test("a local tier that is not separable from the vendor takes the field, and the vendor's page is not paid at all", () => {
  const n = 80;
  /* The local tier misses two cases the vendor gets, and gets one the vendor misses: three
     disagreements, which McNemar cannot separate. The tool then takes the free tier. */
  const releve = {
    total: { vendor: cell(ones(n, [5]), Number.NaN), rules: cell(ones(n, [6, 7]), 0.02) },
  };
  const a = audit({ fields: ["total"], kinds: { total: "amount" }, releve, chains: [vendor("vendor", 50)], current: "vendor",
    pagesPerDocument: 2, pagesPerYear: 500_000, machineHourlyCost: 1.2 });
  assert.equal(a.routing["total"], "rules");
  assert.equal(a.fields["total"]!.head, "vendor");
  assert.equal(a.fields["total"]!.sources["rules"]!.standing, "not-separable");
  assert.deepEqual(a.fields["total"]!.inseparable, ["rules"]);
  assert.equal(a.inseparable.length, 1, "the pick is flagged: the sample cannot separate the two");
  assert.equal(a.inseparable[0]!.discordant, 3);
  assert.deepEqual(a.cost.recommended?.vendors, []);
  assert.ok(a.cost.recommended!.perThousandPages < 0.01);
  assert.equal(a.cost.current?.perThousandPages, 50);
  assert.ok(a.cost.annual!.saving > 24_999 && a.cost.annual!.saving <= 25_000);
  assert.equal(a.fields["total"]!.kind, "amount");
});

test("with a declared margin only a non-inferior source is admissible; without one, not separable is enough", () => {
  const n = 40;
  const releve = { f: { vendor: cell(ones(n)), local: cell(ones(n, [0, 1, 2, 3]), 5) } };
  const chains = [vendor("vendor", 50)];
  const loose = audit({ fields: ["f"], kinds: {}, releve, chains, current: "vendor", pagesPerDocument: 1, pagesPerYear: null, machineHourlyCost: 1.2 });
  assert.equal(loose.routing["f"], "local", "four disagreements on forty cases: not separable, so the free tier");
  const strict = audit({ fields: ["f"], kinds: {}, releve, chains, current: "vendor", pagesPerDocument: 1, pagesPerYear: null, machineHourlyCost: 1.2, margin: 0.02 });
  assert.equal(strict.routing["f"], "vendor", "a ten-point worst case is outside a two-point margin: the vendor keeps the field");
  assert.equal(strict.fields["f"]!.sources["local"]!.standing, "not-separable");
});

test("an unpriced chain is measured but enters no costed routing, and the audit says so", () => {
  const n = 40;
  const releve = { f: { mystery: cell(ones(n)), rules: cell(ones(n, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), 1) } };
  const unpriced: SourcePrice = { kind: "vendor", name: "mystery", pricePerThousandPages: null, billing: "page", provenance: "unpriced" };
  const a = audit({ fields: ["f"], kinds: {}, releve, chains: [unpriced], current: "mystery", pagesPerDocument: 1, pagesPerYear: 1000, machineHourlyCost: 1.2 });
  assert.equal(a.fields["f"]!.sources["mystery"]!.standing, "unpriced");
  assert.equal(a.fields["f"]!.head, "rules", "the head is chosen among priced sources only");
  assert.equal(a.routing["f"], "rules");
  assert.equal(a.cost.current, null);
  assert.ok(a.omitted.some((o) => /no declared price/.test(o)));
  assert.ok(a.omitted.some((o) => /no saving against it/.test(o)));
});

test("under ENOUGH graded cases a source is listed and not compared; with nothing above the floor nothing is chosen", () => {
  const few = ENOUGH - 1;
  const releve = { f: { vendor: cell(ones(few)), rules: cell(ones(few), 1) } };
  const a = audit({ fields: ["f"], kinds: {}, releve, chains: [vendor("vendor", 10)], current: "vendor", pagesPerDocument: 1, pagesPerYear: null, machineHourlyCost: 1.2 });
  assert.equal(a.fields["f"]!.head, null);
  assert.equal(a.routing["f"], null);
  assert.match(a.fields["f"]!.note ?? "", /nothing can be chosen/);
  assert.equal(a.fields["f"]!.sources["vendor"]!.standing, "too-few");
  const lines = auditLines(a).join("\n");
  assert.match(lines, /nothing can be chosen/);
});

test("a chain graded on part of the cases only is compared on the cases both saw", () => {
  const n = 50;
  /* The chain was graded on the first thirty cases only ("-" elsewhere): the paired test
     runs on those thirty, and the chain's own rate is over thirty, not fifty. */
  const releve = { f: { chain: cell(ones(30) + "-".repeat(20)), rules: cell(ones(n, [40, 41]), 1) } };
  const a = audit({ fields: ["f"], kinds: {}, releve, chains: [vendor("chain", 10)], current: "chain", pagesPerDocument: 1, pagesPerYear: null, machineHourlyCost: 1.2 });
  assert.equal(a.fields["f"]!.sources["chain"]!.n, 30);
  assert.equal(a.fields["f"]!.sources["rules"]!.standing, "not-separable");
  assert.equal(a.fields["f"]!.sources["rules"]!.discordant, 0, "the two disagreements fall outside the cases the chain saw");
});

test("the lines name the recommended routing, the saving and every unseparated pair, and never invent an interval on money", () => {
  const n = 60;
  const releve = { total: { cheap: cell(ones(n)), dear: cell(ones(n)) } };
  const a = audit({ fields: ["total"], kinds: { total: "amount" }, releve, chains: [vendor("cheap", 20), vendor("dear", 24)], current: "dear",
    pagesPerDocument: 1, pagesPerYear: 1_000_000, machineHourlyCost: 1.2 });
  const text = auditLines(a).join("\n");
  assert.match(text, /Recommended routing: total ← cheap/);
  assert.match(text, /saving \$4,000 a year/);
  assert.match(text, /rest on pairs this sample cannot separate/);
  assert.match(text, /the money is not/);
  assert.ok(!/\$[\d,.]+ \[/.test(text), "no interval is attached to a dollar figure");
});
