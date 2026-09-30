/*
 * The audit, end to end: `measure:yours` with two priced chains on the synthetic example.
 *
 * Everything below the command is proved without a model (audit.test.ts, vendors.test.ts,
 * client-record.test.ts). This case runs the real command on the sixty synthetic receipts
 * with the two outcomes files `grade` wrote, and reads what a client would: the console, the
 * report and the sealed record. It needs the encoder weights, so where they are absent it
 * stands aside by name, exactly like the other real-command cases of this suite; on the
 * integration runner, which primes the weights, it runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { poidsEnCache, diagnosticDesPoids } from "./tiers.ts";
import { scelleIntact } from "./empreinte.ts";

const EXAMPLE = fileURLToPath(new URL("../examples/extraction-audit/", import.meta.url));
const CMD = fileURLToPath(new URL("./your-cases.ts", import.meta.url));

test("measure:yours with two priced chains writes the audit into the console, the report and the sealed record", (t) => {
  if (!poidsEnCache()) return t.skip(diagnosticDesPoids() ?? "poids d'encodeur inutilisables.");
  const d = mkdtempSync(join(tmpdir(), "audit-e2e-"));
  try {
    for (const f of ["receipts.csv", "receipts-vendor-a-outcomes.json", "receipts-vendor-b-outcomes.json"]) copyFileSync(join(EXAMPLE, f), join(d, f));
    const r = spawnSync(process.execPath, [CMD, `--cases=${join(d, "receipts.csv")}`,
      `--sorties=${join(d, "receipts-vendor-a-outcomes.json")}`, `--sorties=${join(d, "receipts-vendor-b-outcomes.json")}`,
      `--rules=${join(EXAMPLE, "rules.json")}`, "--current=vendor-a", "--pages-per-year=1000000", "--pages-per-document=1", "--margin=5"],
      { encoding: "utf8", timeout: 600_000, env: { ...process.env, CASCADE_OFFLINE: "1" } });
    assert.equal(r.status, 0, `the command failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
    const out = r.stdout;
    assert.match(out, /Your chain: "vendor-a"\./);
    assert.match(out, /price: \$50 per 1,000 pages: declared by you/);
    assert.match(out, /Your chain: "vendor-b"\./);
    assert.match(out, /AUDIT: per field, the cheapest source this sample cannot show to be worse than the best/);
    assert.match(out, /\(margin: 5-point, your declaration\)/);
    assert.match(out, /Recommended routing: total/);
    assert.match(out, /Current chain vendor-a: \$50/);
    assert.match(out, /pages a year: .* a year\./, "the annual figure is stated once a yearly volume is declared");
    assert.match(out, /machine time for local tiers at \$[\d.]+ an hour \(assumed/);

    const record = JSON.parse(readFileSync(join(d, "receipts-measured.json"), "utf8"));
    assert.equal(record.kind, "cascade-client-record");
    assert.equal(record.version, 2);
    assert.ok(scelleIntact(record));
    assert.deepEqual(record.kinds, { total: "amount", receipt_date: "date", receipt_id: "id", currency: "currency" });
    assert.deepEqual(Object.keys(record.audit.routing).sort(), ["currency", "receipt_date", "receipt_id", "total"]);
    assert.equal(record.audit.margin, 0.05, "the margin the routing was made within travels in the record");
    assert.ok(Object.values<string | null>(record.audit.routing).every((s) => s !== null), "every field has an admissible priced source within five points");
    assert.equal(record.audit.cost.current.chain, "vendor-a");
    assert.equal(record.audit.cost.current.perThousandPages, 50);
    assert.equal(record.audit.cost.annual.pagesPerYear, 1_000_000);
    assert.equal(record.declared["vendor-a"].pricePerThousandPages, 50);
    assert.equal(record.declared["vendor-b"].pricePerThousandPages, 10);
    for (const field of Object.keys(record.audit.fields)) {
      for (const [name, s] of Object.entries<{ n: number; low: number | null; high: number | null; accuracy: number | null }>(record.audit.fields[field].sources)) {
        assert.ok(s.n >= 20 && s.accuracy !== null && s.low! <= s.accuracy && s.accuracy <= s.high!, `${field}/${name}: sixty cases were graded, the rate is quoted inside its interval`);
      }
      assert.ok(record.graded["vendor-a"].kinds.total === "amount" && record.graded["vendor-a"].casesSha256.length === 64, "the record says which kinds and which file each chain was graded under");
    }
    /* Both chains and the local tiers sit in the same table, and no value entered anything written. */
    assert.ok(["vendor-a", "vendor-b", "rules", "small", "large"].every((n) => record.tiers.includes(n)), record.tiers.join(", "));
    const written = readFileSync(join(d, "receipts-measured.json"), "utf8") + readFileSync(join(d, "receipts-measured.md"), "utf8");
    for (const leaked of ["PL815827", "PLACEHOLDER CAFE", "90.87"]) assert.ok(!written.includes(leaked), `a value left the CSV: ${leaked}`);
    const md = readFileSync(join(d, "receipts-measured.md"), "utf8");
    assert.match(md, /## How each field was compared/);
    assert.match(md, /## Extraction audit/);
    assert.match(md, /That the prices are what you pay/);

    /* Two chains under the same name are refused before anything is measured. */
    const twin = join(d, "twin.json");
    writeFileSync(twin, readFileSync(join(d, "receipts-vendor-a-outcomes.json")));
    const dup = spawnSync(process.execPath, [CMD, `--cases=${join(d, "receipts.csv")}`, `--sorties=${join(d, "receipts-vendor-a-outcomes.json")}`, `--sorties=${twin}`],
      { encoding: "utf8", timeout: 120_000, env: { ...process.env, CASCADE_OFFLINE: "1" } });
    assert.equal(dup.status, 1);
    assert.match(dup.stderr, /carry the same name "vendor-a"/);
    assert.ok(!existsSync(join(d, "twin-measured.json")));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the audit's declared inputs refuse what is not a positive number, and --current must name a chain", async () => {
  const { lirePositif } = await import("./your-cases.ts");
  assert.equal(lirePositif(undefined, "--pages-per-year"), undefined);
  assert.equal(lirePositif("250000", "--pages-per-year"), 250_000);
  assert.equal(lirePositif("2.5", "--pages-per-document"), 2.5);
  for (const bad of ["0", "-3", "abc", "", "1e400"]) assert.throws(() => lirePositif(bad, "--pages-per-year"), /not a positive number/, bad);

  const d = mkdtempSync(join(tmpdir(), "audit-flags-"));
  try {
    copyFileSync(join(EXAMPLE, "receipts.csv"), join(d, "receipts.csv"));
    copyFileSync(join(EXAMPLE, "receipts-vendor-a-outcomes.json"), join(d, "a.json"));
    const r = spawnSync(process.execPath, [CMD, `--cases=${join(d, "receipts.csv")}`, `--sorties=${join(d, "a.json")}`, "--current=vendor-z"],
      { encoding: "utf8", timeout: 120_000, env: { ...process.env, CASCADE_OFFLINE: "1" } });
    assert.equal(r.status, 1, "a current chain nobody gave must refuse before any model loads");
    assert.match(r.stderr, /--current=vendor-z names no --sorties chain/);
    assert.match(r.stderr, /Chains given: vendor-a/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
