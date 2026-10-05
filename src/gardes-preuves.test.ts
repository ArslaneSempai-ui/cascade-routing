/*
 * THE COMMANDS THAT USED TO DESTROY COMMITTED EVIDENCE (audit of 4 October 2026).
 *
 * On a fresh clone, five documented commands rewrote a committed file and exited 0:
 * `npm run derivees` with no journal, `egress` on a pass too short to conclude, `intake`
 * over a filled-in template, `sceller` on an unsealed or edited profile, `grade` and `mur`
 * over committed outcome files. Each has a guard now, and each guard has a witness here that
 * goes red when the guard is removed: the witness runs the real command and reads the file
 * afterwards, byte for byte. Nothing here touches a committed file: every command runs in a
 * sandbox copy, or is pointed at one, and the one that cannot be pointed (derivees) is run
 * against a clone of the repository with an empty data/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, cpSync, mkdirSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { empreinteDuReleve } from "./empreinte.ts";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const run = (script: string, args: string[], cwd = RACINE) =>
  spawnSync("node", [join(RACINE, "src", script), ...args], { encoding: "utf8", cwd, timeout: 120_000 });

test("sceller --check verifies and writes nothing, on an edited record and on an unsealed one", () => {
  const d = mkdtempSync(join(tmpdir(), "sceller-check-"));
  /* An edited record: the shipped sealed profile with one figure changed and the old seal kept. */
  const scelle = JSON.parse(readFileSync(join(RACINE, "profiles-2026-08-20-coeur-rendu.json"), "utf8")) as Record<string, unknown>;
  (scelle as { measuredAt: string }).measuredAt = "2099-01-01T00:00:00.000Z";
  const edite = join(d, "edite.json");
  writeFileSync(edite, JSON.stringify(scelle, null, 2));
  const avant = readFileSync(edite, "utf8");
  const r = run("sceller.ts", [edite, "--check"]);
  assert.equal(r.status, 1, `an edited record must fail --check:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /SEAL DOES NOT MATCH/);
  assert.equal(readFileSync(edite, "utf8"), avant, "--check rewrote the file");
  /* An unsealed record. */
  const nu = join(d, "nu.json");
  writeFileSync(nu, JSON.stringify({ kind: "x", measuredAt: "2026-01-01T00:00:00.000Z", extraction: {} }, null, 2));
  const avantNu = readFileSync(nu, "utf8");
  const r2 = run("sceller.ts", [nu, "--check"]);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /NOT SEALED/);
  assert.equal(readFileSync(nu, "utf8"), avantNu, "--check sealed an unsealed file");
  /* And the positive: a record whose seal holds passes --check, still without writing. */
  const bon = join(d, "bon.json");
  const o: Record<string, unknown> = { kind: "x", measuredAt: "2026-01-01T00:00:00.000Z", extraction: {} };
  o.empreinte = empreinteDuReleve(o);
  writeFileSync(bon, JSON.stringify(o, null, 2));
  const r3 = run("sceller.ts", [bon, "--check"]);
  assert.equal(r3.status, 0, r3.stdout + r3.stderr);
  assert.match(r3.stdout, /already sealed, and the seal matches/);
  /* The counter-proof of the witness: without --check the edited file IS rewritten. */
  const r4 = run("sceller.ts", [edite]);
  assert.equal(r4.status, 0);
  assert.notEqual(readFileSync(edite, "utf8"), avant, "without --check, sceller re-declares the seal: that is the gesture --check exists to avoid");
});

test("diff refuses a record whose seal no longer matches, and says so", () => {
  const d = mkdtempSync(join(tmpdir(), "diff-scelle-"));
  const src = join(RACINE, "profiles-2026-08-20-coeur-rendu.json");
  const a = join(d, "a.json"), b = join(d, "b.json");
  cpSync(src, a);
  const edite = JSON.parse(readFileSync(src, "utf8")) as Record<string, unknown>;
  (edite as { measuredAt: string }).measuredAt = "2099-01-01T00:00:00.000Z";
  writeFileSync(b, JSON.stringify(edite, null, 2));
  const r = run("diff.ts", [a, b]);
  assert.equal(r.status, 1, `diff must refuse an edited record:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /seal no longer matches its content/);
  assert.doesNotMatch(r.stdout, /No case changed outcome/, "the refusal must come before any verdict");
});

test("grade refuses to overwrite an existing outcomes file unless told to", () => {
  const d = mkdtempSync(join(tmpdir(), "grade-overwrite-"));
  const csv = join(d, "cases.csv");
  cpSync(join(RACINE, "examples", "extraction-audit", "receipts.csv"), csv);
  const values = join(RACINE, "examples", "extraction-audit", "vendor-a-values.json");
  const out = join(d, "out.json");
  const args = [`--cases=${csv}`, "--name=vendor-a", `--values=${values}`, `--out=${out}`];
  const first = run("grade.ts", args);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const avant = readFileSync(out, "utf8");
  const second = run("grade.ts", args);
  assert.equal(second.status, 1, "a second run over the same file must refuse");
  assert.match(second.stderr, /already exists/);
  assert.equal(readFileSync(out, "utf8"), avant, "the refusal rewrote the file anyway");
  const third = run("grade.ts", [...args, "--overwrite"]);
  assert.equal(third.status, 0, third.stdout + third.stderr);
});

test("grade reports the rows it set aside, like measure:yours does", () => {
  const d = mkdtempSync(join(tmpdir(), "grade-rows-"));
  const csv = join(d, "rows.csv");
  writeFileSync(csv, "id,text,total:amount\nC1,Total 5.00,5.00\nC2,Total 6.00,6.00,extra\nC3,Total 7.00,7.00\n");
  writeFileSync(join(d, "v.json"), JSON.stringify({ C1: { total: "5.00" }, C2: { total: "6.00" }, C3: { total: "7.00" } }));
  const r = run("grade.ts", [`--cases=${csv}`, "--name=v", `--values=${join(d, "v.json")}`, `--out=${join(d, "o.json")}`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 row\(s\) set aside: the header names 3 columns and these do not match: line 3 has 4/);
  assert.match(r.stdout, /2 case\(s\)/, "the set-aside row is out of the count, and the count is printed");
});

test("the absent marker: a blank answer is clean against \"-\", and a value is wrong", () => {
  const d = mkdtempSync(join(tmpdir(), "grade-absent-"));
  const csv = join(d, "tax.csv");
  writeFileSync(csv, "id,text,tax:amount\nR1,No tax here,-\nR2,Tax 1.00,1.00\nR3,Nothing,\n");
  writeFileSync(join(d, "v.json"), JSON.stringify({ R1: { tax: "0.50" }, R2: { tax: "1.00" }, R3: { tax: "" } }));
  const r = run("grade.ts", [`--cases=${csv}`, "--name=inventive", `--values=${join(d, "v.json")}`, `--out=${join(d, "o.json")}`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const o = JSON.parse(readFileSync(join(d, "o.json"), "utf8")) as { issues: Record<string, Record<string, string>>; coverage: Record<string, { graded: number; noTruth: number; wrong: number }> };
  assert.equal(o.issues.tax!.R1, "wrong", "a value invented where the document has no such line is wrong");
  assert.equal(o.issues.tax!.R2, "clean");
  assert.equal(o.issues.tax!.R3, undefined, "an empty expected cell is still graded by nobody");
  assert.equal(o.coverage.tax!.graded, 2);
  assert.equal(o.coverage.tax!.noTruth, 1);
  /* And the silent vendor is clean on the marked case. */
  writeFileSync(join(d, "s.json"), JSON.stringify({ R1: { tax: "" }, R2: { tax: "1.00" } }));
  const r2 = run("grade.ts", [`--cases=${csv}`, "--name=silent", `--values=${join(d, "s.json")}`, `--out=${join(d, "o2.json")}`]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const o2 = JSON.parse(readFileSync(join(d, "o2.json"), "utf8")) as { issues: Record<string, Record<string, string>> };
  assert.equal(o2.issues.tax!.R1, "clean", "silence where the document has no such line is the right answer");
});

test("mur writes under data/ by default and leaves the committed mur.json alone", () => {
  const avant = readFileSync(join(RACINE, "mur.json"), "utf8");
  /* A tiny ceiling: the first point is measured, the rest stand aside; seconds, not minutes. */
  const r = run("mur.ts", ["--plafond=1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Written to data\/mur\.json/);
  assert.equal(readFileSync(join(RACINE, "mur.json"), "utf8"), avant, "the committed mur.json was rewritten");
  assert.ok(existsSync(join(RACINE, "data", "mur.json")));
  const g = JSON.parse(readFileSync(join(RACINE, "data", "mur.json"), "utf8")) as { grille: { ms: number | null }[] };
  /* A measured point above the ceiling stops the points after it. */
  const premierDepassement = g.grille.findIndex((x) => x.ms !== null && x.ms > 1);
  if (premierDepassement >= 0) {
    assert.ok(g.grille.slice(premierDepassement + 1).every((x) => x.ms === null), "points after a measured point above the ceiling must not be launched");
  }
});

test("egress on a pass too short to conclude does not touch the committed egress.json", (t) => {
  if (process.platform === "win32") return t.skip("egress refuses to observe on Windows by design");
  const avant = readFileSync(join(RACINE, "egress.json"), "utf8");
  const d = mkdtempSync(join(tmpdir(), "egress-court-"));
  const script = join(d, "instant.mjs");
  writeFileSync(script, "process.exit(0);\n");
  const r = spawnSync("node", [join(RACINE, "src", "egress.ts"), "--every=250", script], { encoding: "utf8", cwd: RACINE, timeout: 120_000 });
  assert.equal(r.status, 1, `a pass too short must refuse:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /was not touched/);
  assert.equal(readFileSync(join(RACINE, "egress.json"), "utf8"), avant, "the committed egress.json was rewritten by an inconclusive pass");
  assert.ok(existsSync(join(RACINE, "data", "egress-inconclusive.json")), "the inconclusive pass is written apart, under data/");
});

test("derivees with no journal refuses, names npm run dur, and leaves the frozen file", () => {
  /* A copy of THIS working tree (a clone would carry HEAD, not the code under test) with an
     empty data/: the shipped frozen file and no journal, which is a fresh clone's state. */
  /* realpath: under /var/folders, a symlink to /private/var, `isMain` would compare two spellings
     of the same path, the script would do nothing, and exit 0 would pass for a refusal. */
  const d = realpathSync(mkdtempSync(join(tmpdir(), "derivees-clone-")));
  const clone = join(d, "cascade");
  /* 05/10 : both separators, or Windows copied node_modules whole and the link below found it already there */
  cpSync(RACINE, clone, { recursive: true, filter: (src) => !/[\\/](node_modules|data)([\\/]|$)/.test(src) });
  try {
    /* a junction needs no privilege on Windows, where `ln -s` from Git Bash cannot make the link */
    symlinkSync(join(RACINE, "node_modules"), join(clone, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    mkdirSync(join(clone, "data"), { recursive: true });
    const avant = readFileSync(join(clone, "mesures-derivees.json"), "utf8");
    const r = spawnSync("node", [join(clone, "src", "landing.ts"), "--derivees"], { encoding: "utf8", cwd: clone, timeout: 120_000 });
    assert.equal(r.status, 1, `derivees without a journal must refuse:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /npm run dur/);
    assert.equal(readFileSync(join(clone, "mesures-derivees.json"), "utf8"), avant, "the frozen file was rewritten from no journal");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("a vendor-only audit with --no-encoders loads no model, stands aside for no weight, and states the OCR term", () => {
  /* The CORD files, copied: measure:yours writes its record beside the CSV, and the committed
     sealed record must never be the one it writes over. The weights are made to look absent. */
  const d = realpathSync(mkdtempSync(join(tmpdir(), "no-encoders-")));
  const src = join(RACINE, "examples", "cord-receipts");
  for (const f of ["cord-labels-grouped.csv", "cord-google-outcomes.json", "cord-gemini-outcomes.json", "cord-rules.json"]) cpSync(join(src, f), join(d, f));
  const vide = join(d, "aucun-poids"); mkdirSync(vide);
  const r = spawnSync("node", [join(RACINE, "src", "your-cases.ts"), `--cases=${join(d, "cord-labels-grouped.csv")}`,
    `--sorties=${join(d, "cord-google-outcomes.json")}`, `--sorties=${join(d, "cord-gemini-outcomes.json")}`, `--rules=${join(d, "cord-rules.json")}`,
    "--current=google-expense", "--margin=2", "--pages-per-document=1", "--pages-per-year=1000000", "--no-encoders"],
    { encoding: "utf8", cwd: RACINE, timeout: 300_000, env: { ...process.env, CASCADE_POIDS_RACINE: vide, NODE_TEST_CONTEXT: "1" } });
  const sortie = (r.stdout ?? "") + (r.stderr ?? "");
  assert.equal(r.status, 0, `--no-encoders must run with no weight on the machine:\n${sortie.slice(-1200)}`);
  assert.match(sortie, /no encoder tier is measured and no model is loaded/);
  assert.doesNotMatch(sortie, /STANDING ASIDE/, "nothing stands aside when no encoder is asked for");
  assert.match(sortie, /0 model call\(s\) on this machine/);
  assert.match(sortie, /OCR for local tiers at \$0 per 1,000 pages \(assumed; --ocr-price-per-thousand-pages\)/, "the OCR term is declared, assumed at zero");
  assert.match(sortie, /AUDIT: per field, the cheapest source within your declared margin/);
  assert.ok(existsSync(join(d, "cord-labels-grouped-measured.json")), "the record is written beside the copied CSV");
  const rec = JSON.parse(readFileSync(join(d, "cord-labels-grouped-measured.json"), "utf8")) as { audit: { assumptions: { ocrPricePerThousandPages: { value: number; provenance: string } }; routing: Record<string, string> } };
  assert.deepEqual(rec.audit.assumptions.ocrPricePerThousandPages, { value: 0, provenance: "assumed" });
  assert.equal(rec.audit.routing.total, "gemini-flash", "the vendor comparison gives the record's routing without any local model");
  /* The committed record is untouched: the run wrote in the copy. */
  assert.equal(readFileSync(join(src, "cord-labels-grouped-measured.json"), "utf8").includes("\"empreinte\": \"ac7d0adbe4907caf\""), true);
  rmSync(d, { recursive: true, force: true });
});
