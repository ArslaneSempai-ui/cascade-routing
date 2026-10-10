/*
 * THE BATCH BEFORE THE SEND (2026-10-10): the checks that need no network, the bounce gate, the
 * warm-up cap, one contact per firm, the suppression list, the send slot in the prospect's zone
 * on a working day, and the command that writes the proposal and sends nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifierAdresse, porte, plafondDeChauffe, joursFeriesUS, creneauDEnvoi, preparerLeLot, lireProspects, PORTE_REBOND } from "./lots.ts";

const CMD = fileURLToPath(new URL("./lots.ts", import.meta.url));

test("an address is refused for one named reason: syntax, a role address, a free-mail domain; a business address passes", () => {
  assert.equal(verifierAdresse("jane.doe@acme-logistics.com"), null);
  assert.equal(verifierAdresse("not an address"), "syntax");
  assert.equal(verifierAdresse("jane..doe@acme.com"), "syntax");
  assert.equal(verifierAdresse("info@acme.com"), "role address");
  assert.equal(verifierAdresse("Sales+eu@acme.com"), "role address");
  assert.equal(verifierAdresse("jane@gmail.com"), "free-mail domain");
});

test("the bounce gate closes above 5 %, and the warm-up ramp is 10, 20, 40, 80, then 80", () => {
  assert.deepEqual(porte({ envoyes: 200, durs: 10 }), { taux: 0.05, ouverte: true });
  assert.equal(porte({ envoyes: 250, durs: 19 }).ouverte, false, "7.6 % is the rate the house measured, and it closes the gate");
  assert.equal(porte({ envoyes: 0, durs: 0 }).ouverte, true, "no report yet: the first batch may go");
  assert.equal(PORTE_REBOND, 0.05);
  assert.deepEqual([1, 2, 3, 4, 5, 30].map(plafondDeChauffe), [10, 20, 40, 80, 80, 80]);
  assert.throws(() => plafondDeChauffe(0), /whole number from 1/);
});

test("US federal holidays are computed, not typed: Thanksgiving 2026 is 26 November, Memorial Day 2027 is 31 May", () => {
  const f26 = joursFeriesUS(2026), f27 = joursFeriesUS(2027);
  assert.ok(f26.has("2026-11-26") && f26.has("2026-07-04") && f26.has("2026-09-07") && f26.has("2026-01-19"));
  assert.ok(f27.has("2027-05-31") && f27.has("2027-02-15") && f27.has("2027-10-11"));
  assert.equal(f26.size, 11);
});

test("the send slot is Tuesday to Thursday, 8:30 to 10:30 in the prospect's zone, never a holiday, and rows share the window", () => {
  /* Friday 2026-10-09 12:00 UTC: the next slot is Tuesday 13 October, 8:30 in New York (12:30 UTC, EDT). */
  const depuis = new Date("2026-10-09T12:00:00Z");
  assert.deepEqual(creneauDEnvoi({ email: "a@x.com", state: "NY" }, depuis), { zone: "America/New_York", instant: "2026-10-13T12:30:00.000Z" });
  assert.deepEqual(creneauDEnvoi({ email: "a@x.com", state: "ca" }, depuis), { zone: "America/Los_Angeles", instant: "2026-10-13T15:30:00.000Z" });
  assert.deepEqual(creneauDEnvoi({ email: "a@x.com", state: "AZ" }, depuis), { zone: "America/Phoenix", instant: "2026-10-13T15:30:00.000Z" }, "Arizona keeps standard time");
  assert.equal(creneauDEnvoi({ email: "a@x.eu" }, depuis).zone, "UTC", "no state: UTC");
  /* Wednesday 25 November 2026 at 20:00 UTC: Thursday is Thanksgiving, so the next slot is Tuesday 1 December. */
  assert.equal(creneauDEnvoi({ email: "a@x.com", state: "TX" }, new Date("2026-11-25T20:00:00Z")).instant, "2026-12-01T14:30:00.000Z");
  /* Inside the window already: the slot is the row's share of what is left of it, never in the past. */
  const dedans = new Date("2026-10-13T13:00:00Z");
  const c = creneauDEnvoi({ email: "a@x.com", state: "NY" }, dedans, 1, 3);
  assert.ok(new Date(c.instant) >= dedans, "a slot is never before now");
  const parts = [0, 1, 2].map((r) => creneauDEnvoi({ email: "a@x.com", state: "NY" }, depuis, r, 3).instant);
  assert.deepEqual(parts, ["2026-10-13T12:30:00.000Z", "2026-10-13T13:27:00.000Z", "2026-10-13T14:24:00.000Z"], "three rows spread over the two hours");
});

test("the whole preparation: gate, checks, one per firm, suppression, cap, slots; a closed gate prepares nothing", () => {
  const prospects = lireProspects([
    "email,firm,state,name",
    "jane@acme.com,Acme,NY,Jane",
    "john@acme.com,Acme,NY,John",
    "info@beta.com,Beta,TX,",
    "li mei@gamma.com,Gamma,CA,Mei",
    "mei@gamma.com,Gamma,CA,Mei",
    "stop@delta.com,Delta,FL,",
    "ok@epsilon.com,Epsilon,,",
  ].join("\n"));
  assert.equal(prospects.length, 7);
  const depuis = new Date("2026-10-09T12:00:00Z");
  const lot = preparerLeLot({ prospects, suppression: new Set(["stop@delta.com"]), rapport: { envoyes: 100, durs: 2 }, jourDEnvoi: 1, depuis });
  assert.deepEqual(lot.retenus.map((r) => r.email).sort(), ["jane@acme.com", "mei@gamma.com", "ok@epsilon.com"]);
  const raisons = Object.fromEntries(lot.ecartes.map((e) => [e.email, e.raison]));
  assert.match(raisons["john@acme.com"]!, /one contact per firm: jane@acme.com/);
  assert.equal(raisons["info@beta.com"], "role address");
  assert.equal(raisons["li mei@gamma.com"], "syntax");
  assert.match(raisons["stop@delta.com"]!, /suppressed/);
  assert.ok(lot.retenus.every((r) => r.instant >= depuis.toISOString()));
  assert.deepEqual(lot.nonVerifieIci, ["MX", "catch-all"]);
  /* The cap: day 1 allows ten; the eleventh firm is set aside with the reason. */
  const beaucoup = Array.from({ length: 12 }, (_, i) => ({ email: `p${i}@firm${i}.com`, state: "NY" }));
  const plafonne = preparerLeLot({ prospects: beaucoup, suppression: new Set(), rapport: { envoyes: 0, durs: 0 }, jourDEnvoi: 1, depuis });
  assert.equal(plafonne.retenus.length, 10);
  assert.equal(plafonne.ecartes.filter((e) => /warm-up cap: day 1 allows 10/.test(e.raison)).length, 2);
  /* The gate: 7.6 % closes it and every row is set aside with the rate. */
  const ferme = preparerLeLot({ prospects, suppression: new Set(), rapport: { envoyes: 250, durs: 19 }, jourDEnvoi: 3, depuis });
  assert.equal(ferme.retenus.length, 0);
  assert.ok(ferme.ecartes.every((e) => /gate closed: bounce rate 7\.6 %/.test(e.raison)));
});

test("the command writes the proposal and says that nothing was sent; an unknown flag or a CSV without an email column refuses", () => {
  const d = mkdtempSync(join(tmpdir(), "lots-"));
  try {
    writeFileSync(join(d, "p.csv"), "email,firm,state\njane@acme.com,Acme,NY\ninfo@beta.com,Beta,TX\n");
    writeFileSync(join(d, "s.txt"), "nobody@nowhere.com\n");
    writeFileSync(join(d, "r.json"), JSON.stringify({ envoyes: 100, durs: 1 }));
    const r = spawnSync(process.execPath, [CMD, `--prospects=${join(d, "p.csv")}`, `--suppression=${join(d, "s.txt")}`, `--rebonds=${join(d, "r.json")}`, "--jour=2", "--date=2026-10-09T12:00:00Z", `--out=${join(d, "lot.json")}`], { encoding: "utf8", timeout: 120_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 row\(s\) kept, 1 set aside; bounce gate open at 1\.0 %; cap 20 on day 2/);
    assert.match(r.stdout, /Nothing was sent/);
    const lot = JSON.parse(readFileSync(join(d, "lot.json"), "utf8"));
    assert.equal(lot.retenus[0].email, "jane@acme.com");
    assert.equal(lot.retenus[0].instant, "2026-10-13T12:30:00.000Z");
    const inconnu = spawnSync(process.execPath, [CMD, `--prospects=${join(d, "p.csv")}`, "--send=now"], { encoding: "utf8", timeout: 120_000 });
    assert.equal(inconnu.status, 2);
    assert.match(inconnu.stderr, /Unknown option: --send/);
    writeFileSync(join(d, "bad.csv"), "mail,firm\na@b.com,x\n");
    const sansColonne = spawnSync(process.execPath, [CMD, `--prospects=${join(d, "bad.csv")}`], { encoding: "utf8", timeout: 120_000 });
    assert.equal(sansColonne.status, 1);
    assert.match(sansColonne.stderr, /needs an "email" column/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
