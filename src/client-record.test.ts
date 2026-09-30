/*
 * The client record, version 2: what it adds, and that version 1 still reads.
 *
 * `measure:yours` now writes version 2: the kind each field was graded as, the grader that
 * gave the verdicts, the audit, and price keys under `declared`. Three readers open these
 * records months later: `recertify` (as a baseline), `diff` (case by case) and `sceller`
 * (the seal). A version they cannot read is a measurement the client can no longer use, so
 * both versions are opened here by the real readers, not by a look at the type.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { releveClient, type ReleveClient } from "./your-cases.ts";
import { chargerBaselineDepuis } from "./recertify.ts";
import { comparer } from "./diff.ts";
import { empreinteDuReleve, scelleIntact } from "./empreinte.ts";
import { audit } from "./audit.ts";

const bits = (n: number, wrongAt: number[] = []): string => Array.from({ length: n }, (_, i) => (wrongAt.includes(i) ? "0" : "1")).join("");

/** A version 1 record, in the shape `measure:yours` wrote before the audit existed. */
function recordV1(): ReleveClient {
  const r: ReleveClient = {
    kind: "cascade-client-record", version: 1, measuredAt: "2026-06-01T00:00:00.000Z",
    code: { commit: "427016b", sale: false },
    source: { file: "cas.csv", sha256: "a".repeat(64), cases: 40, casesInFile: 40 },
    fields: ["total"], questions: { total: { texte: "What is the total?", provenance: "deduite" } },
    margin: null, tiers: ["small", "large"],
    declared: {},
    extraction: {
      small: { total: { accuracy: 0.9, items: 40, low: 0.77, high: 0.96, latency: 5, reussites: bits(40, [0, 1, 2, 3]), blank: 2, wrong: 2 } },
      large: { total: { accuracy: 0.95, items: 40, low: 0.83, high: 0.99, latency: 10, reussites: bits(40, [0, 1]), blank: 1, wrong: 1 } },
    },
    recommendation: { total: ["large wins outright on this sample."] },
  };
  r.empreinte = empreinteDuReleve(r);
  return r;
}

function recordV2(): ReleveClient {
  const releve = {
    total: {
      large: { bons: 38, sur: 40, ms: 10, reussites: bits(40, [0, 1]), vides: 1, faux: 1 },
      textract: { bons: 39, sur: 40, ms: Number.NaN, reussites: bits(40, [2]), vides: 0, faux: 1 },
      azure: { bons: 39, sur: 40, ms: Number.NaN, reussites: bits(40, [3]), vides: 1, faux: 0 },
    },
  } as never;
  const chains = [
    { nom: "textract", issues: {}, declares: { pricePerThousandPages: 50, billing: "page" as const } },
    { nom: "azure", issues: {}, declares: { vendor: "azure-document-intelligence-prebuilt" } },
  ];
  const a = audit({
    fields: ["total"], kinds: { total: "amount" }, releve,
    chains: [
      { kind: "vendor", name: "textract", pricePerThousand: 50, billing: "page", provenance: "declared" },
      { kind: "vendor", name: "azure", pricePerThousand: 10, billing: "page", provenance: "list-price", listPrice: { key: "azure-document-intelligence-prebuilt", readOn: "2026-09-29", url: "https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/", verified: false, tierPagesPerMonth: 1_000_000 } },
    ],
    /* A margin is declared: without one the audit recommends nothing and states no saving. */
    current: "textract", pagesPerDocument: 2, pagesPerYear: 600_000, machineHourlyCost: 1.2, margin: 0.15,
  });
  const r = releveClient({
    fichier: "/home/someone/private/cas.csv", octets: Buffer.from("id,text,total:amount\n1,Total 5.00,5.00\n"),
    cas: 40, casDansLeFichier: 40, champs: ["total"],
    questions: { total: { texte: "What is the total?", provenance: "deduite" } },
    releve, verdicts: [{ champ: "total", lignes: ["x"] }], measuredAt: "2026-09-29T10:00:00.000Z",
    code: { commit: "427016b", sale: false }, sorties: chains, kinds: { total: "amount" }, audit: a,
  });
  r.empreinte = empreinteDuReleve(r);
  return r;
}

test("version 2 carries the kinds, the grader, the audit and the prices, and still no value", () => {
  const r = recordV2();
  assert.equal(r.version, 2);
  assert.deepEqual(r.kinds, { total: "amount" });
  assert.equal(r.grader?.version, 1);
  assert.match(r.grader?.conventions.amount ?? "", /thousands/);
  assert.deepEqual(r.declared.textract, { costPerThousandDocuments: undefined, msPerDocument: undefined, pricePerThousandPages: 50, billing: "page" });
  assert.deepEqual(r.declared.azure, { costPerThousandDocuments: undefined, msPerDocument: undefined, vendor: "azure-document-intelligence-prebuilt" });
  assert.ok(r.audit, "the audit travels in the record");
  const a = r.audit!;
  /* Per vendor and field: accuracy with its bounds and n. */
  const t = a.fields["total"]!.sources["textract"]!;
  assert.equal(t.n, 40);
  assert.ok(t.low! < t.accuracy! && t.accuracy! <= t.high!);
  assert.equal(t.costPerThousandPages, 50);
  assert.equal(a.margin, 0.15);
  /* The routing, the cost at the declared volume, the saving, and the flags. On forty cases
     the local tier (two misses) is non-inferior to the head within fifteen points and not
     separable from it (one miss each for the vendors), and its machine time costs next to
     nothing against a page price: it takes the field, and both vendor pages go unpaid. The
     saving is then the whole current page price a year. */
  assert.equal(a.routing["total"], "large", "the local tier is non-inferior within the margin and costs machine time only");
  assert.ok(a.cost.recommended!.perThousandPages < 0.01, String(a.cost.recommended?.perThousandPages));
  assert.deepEqual(a.cost.recommended?.vendors, []);
  /* Ten milliseconds of `large` per document, at the declared hourly rate, over six hundred
     thousand pages: one dollar of machine time a year against the vendor's page price. */
  assert.ok(a.cost.annual!.saving >= 29_998 && a.cost.annual!.saving <= 30_000, String(a.cost.annual?.saving));
  assert.ok(a.inseparable.some((p) => p.source === "large" && p.against === "textract"), "an explicit flag where accuracies cannot be separated");
  assert.ok(a.inseparable.some((p) => p.source === "large" && p.against === "azure"));
  assert.equal(a.fields["total"]!.sources["azure"]!.costPerThousandPages, 10, "the list price is carried per source");
  assert.equal(a.assumptions.prices.find((p) => p.name === "azure")?.provenance, "list-price");
  const text = JSON.stringify(r);
  assert.ok(!text.includes("Total 5.00") && !text.includes("/home/"), "no value and no path");
});

test("recertify accepts a version 1 baseline and a version 2 baseline alike", () => {
  const v1 = chargerBaselineDepuis(JSON.stringify(recordV1()), "v1.json");
  assert.equal(v1.version, 1);
  assert.equal(v1.kinds, undefined, "a version 1 baseline declared no kinds: every field keeps the default comparison");
  const v2 = chargerBaselineDepuis(JSON.stringify(recordV2()), "v2.json");
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.kinds, { total: "amount" });
  assert.ok(v2.audit);
});

test("diff compares a version 1 record with a version 2 record case by case", () => {
  const r = comparer(recordV1() as never, recordV2() as never);
  assert.equal(r.cellulesComparees, 1, "the one cell both records carry, large/total");
  assert.equal(r.casCompares, 40);
  const ecartees = Object.fromEntries(r.cellulesEcartees.map((e) => [e.cellule, e.pourquoi]));
  assert.match(ecartees["small/total"] ?? "", /absente/, "a cell only the first record has is named, not dropped");
});

test("the seal covers the audit: a changed saving breaks it", () => {
  const r = recordV2();
  assert.ok(scelleIntact(r as never));
  const altered = JSON.parse(JSON.stringify(r)) as ReleveClient;
  altered.audit!.cost.annual!.saving = 99_999;
  assert.ok(!scelleIntact(altered as never), "a saving edited by hand must break the seal");
});
