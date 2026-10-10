/*
 * THE ONE-COMMAND DELIVERY (2026-10-10): the folder is dated and never overwritten, every file
 * is hashed, the cover note is built from the sealed record alone and in French, the command
 * refuses before measuring anything, and end to end on the example receipts (real weights,
 * standing aside by name without them) the folder holds what the note promises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { nomDeClient, dossierDeLivraison, manifeste, noteDEnvoi } from "./livrer.ts";
import { scelleIntact } from "./empreinte.ts";
import { poidsEnCache, diagnosticDesPoids } from "./tiers.ts";

const CMD = fileURLToPath(new URL("./livrer.ts", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../examples/extraction-audit/", import.meta.url));
const CORD = fileURLToPath(new URL("../examples/cord-receipts/", import.meta.url));

test("the client name is a slug, the folder is dated, and a folder with a delivery in it is never written over", () => {
  assert.equal(nomDeClient("acme-logistics"), "acme-logistics");
  for (const mauvais of ["Acme Corp", "a", "../x", "", undefined]) assert.throws(() => nomDeClient(mauvais), /client slug/);
  const racine = mkdtempSync(join(tmpdir(), "livrer-dossier-"));
  try {
    const d = dossierDeLivraison(racine, "acme-logistics", "2026-10-10");
    assert.equal(d, join(racine, "acme-logistics", "2026-10-10"));
    assert.ok(existsSync(join(d, "entrees")), "the inputs folder is created with it");
    assert.equal(dossierDeLivraison(racine, "acme-logistics", "2026-10-10"), d, "an empty folder may be reused");
    writeFileSync(join(d, "rapport.md"), "x");
    assert.throws(() => dossierDeLivraison(racine, "acme-logistics", "2026-10-10"), /already holds a delivery/);
    assert.throws(() => dossierDeLivraison(racine, "acme-logistics", "10/10/2026"), /YYYY-MM-DD/);
  } finally { rmSync(racine, { recursive: true, force: true }); }
});

test("the manifest hashes every file of the folder, in both forms, and leaves itself out", () => {
  const racine = mkdtempSync(join(tmpdir(), "livrer-manifeste-"));
  try {
    const d = dossierDeLivraison(racine, "acme", "2026-10-10");
    writeFileSync(join(d, "rapport.md"), "# rapport\n");
    writeFileSync(join(d, "entrees", "cas.csv"), "id,text,total:amount\n");
    const m = manifeste(d, "acme", "2026-10-10", "abcd");
    assert.ok(m.fichiers.length >= 2, `${m.fichiers.length} file(s) read: the manifest did not walk the folder`);
    assert.deepEqual(m.fichiers.map((f) => f.chemin), ["entrees/cas.csv", "rapport.md"]);
    assert.equal(m.fichiers[1]!.sha256, createHash("sha256").update("# rapport\n").digest("hex"));
    assert.equal(m.scelle, "abcd");
    const texte = readFileSync(join(d, "MANIFESTE.sha256"), "utf8");
    assert.match(texte, /^[0-9a-f]{64}  entrees\/cas\.csv\n[0-9a-f]{64}  rapport\.md\n$/);
    const json = JSON.parse(readFileSync(join(d, "MANIFESTE.json"), "utf8"));
    assert.equal(json.version, 1);
    /* Written again after the note: the manifest never lists itself, so the second pass is stable. */
    const m2 = manifeste(d, "acme", "2026-10-10", "abcd");
    assert.deepEqual(m2.fichiers.map((f) => f.sha256), m.fichiers.map((f) => f.sha256));
  } finally { rmSync(racine, { recursive: true, force: true }); }
});

test("the cover note is French, built from the sealed CORD record alone: routing, costs, margin, seal, caveats, and no value from the CSV", () => {
  const releve = JSON.parse(readFileSync(join(CORD, "cord-labels-grouped-measured.json"), "utf8"));
  assert.ok(scelleIntact(releve), "the fixture is the sealed public record");
  const note = noteDEnvoi(releve, { client: "cord-demo", date: "2026-10-10", fichiers: ["rapport.md", "releve.json", "entrees/cord-labels-grouped.csv"] });
  assert.match(note, /^# Note d'envoi\u00a0: audit d'extraction pour cord-demo, 2026-10-10/);
  assert.match(note, /Rien n'a été envoyé/);
  assert.match(note, /sceau `ac7d0adbe4907caf`/);
  assert.match(note, /sur 100 cas, 3 champ\(s\)\u00a0: total, subtotal, tax/);
  assert.match(note, /total\u00a0: la source la moins chère .* est gemini-flash/);
  assert.match(note, /Coût du routage recommandé\u00a0: 4,29\u00a0\$ pour 1\u00a0000 documents \(gemini-flash\)/);
  assert.match(note, /Chaîne actuelle, google-expense\u00a0: 100\u00a0\$ pour 1\u00a0000 documents, prix déclaré par le client/);
  assert.match(note, /95\u00a0710\u00a0\$ d'écart/);
  assert.match(note, /Marge déclarée par le client\u00a0: 2 point\(s\)/);
  assert.match(note, /Pas de PDF/);
  assert.ok(!/ [:;]/.test(note.replace(/`[^`]*`/g, "")), "a colon or semicolon in the French prose takes a no-break space before it");
  assert.ok(!note.includes(String.fromCharCode(0x2014)), "no em dash");
  /* No value of the client's: the receipts' text cells never reach the note. */
  const csv = readFileSync(join(CORD, "cord-labels-grouped.csv"), "utf8").split("\n").slice(1, 6);
  for (const ligne of csv) {
    const texte = ligne.split('"')[1];
    if (texte && texte.length > 20) assert.ok(!note.includes(texte.slice(0, 20)), "a text cell leaked into the note");
  }
  /* Without a client chain, the note says what was and was not measured. */
  const sansAudit = noteDEnvoi({ ...releve, audit: null }, { client: "x-y", date: "2026-10-10", fichiers: [] });
  assert.match(sansAudit, /Aucune chaîne du client n'a été fournie/);
});

test("the command refuses an unknown flag, a bad client name and a missing CSV before measuring anything, and prints its help without arguments", () => {
  const racine = mkdtempSync(join(tmpdir(), "livrer-refus-"));
  try {
    const run = (args: string[]) => spawnSync(process.execPath, [CMD, ...args, `--out=${racine}`], { encoding: "utf8", timeout: 120_000 });
    const aide = spawnSync(process.execPath, [CMD], { encoding: "utf8", timeout: 120_000 });
    assert.equal(aide.status, 0);
    assert.match(aide.stdout, /npm run livrer -- --client=<slug>/);
    const inconnu = run(["--client=acme", `--cases=${join(EXAMPLE, "receipts.csv")}`, "--prize=3"]);
    assert.equal(inconnu.status, 2);
    assert.match(inconnu.stderr, /Unknown option: --prize/);
    const nom = run(["--client=Acme Corp", `--cases=${join(EXAMPLE, "receipts.csv")}`]);
    assert.equal(nom.status, 1);
    assert.match(nom.stderr, /client slug/);
    const absent = run(["--client=acme", `--cases=${join(racine, "nope.csv")}`]);
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /does not exist/);
    assert.deepEqual(readdirSync(racine), [], "nothing was written by a refusal");
  } finally { rmSync(racine, { recursive: true, force: true }); }
});

test("end to end on the example receipts: the dated folder holds the inputs, the report, the intact sealed record, the manifest and the note", { timeout: 900_000 }, (t) => {
  if (!poidsEnCache()) return t.skip(diagnosticDesPoids() ?? "poids d'encodeur inutilisables.");
  const racine = mkdtempSync(join(tmpdir(), "livrer-e2e-"));
  try {
    const r = spawnSync(process.execPath, [CMD, "--client=exemple-recus", `--cases=${join(EXAMPLE, "receipts.csv")}`,
      `--sorties=${join(EXAMPLE, "receipts-vendor-a-outcomes.json")}`, `--sorties=${join(EXAMPLE, "receipts-vendor-b-outcomes.json")}`,
      "--current=vendor-a", "--margin=5", "--pages-per-document=1", "--pages-per-year=1000000", "--date=2026-10-10", `--out=${racine}`],
      { encoding: "utf8", timeout: 840_000 });
    assert.equal(r.status, 0, `the delivery failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
    const d = join(racine, "exemple-recus", "2026-10-10");
    for (const f of ["rapport.md", "releve.json", "note-envoi.md", "MANIFESTE.json", "MANIFESTE.sha256", "journal-mesure.txt",
      "entrees/receipts.csv", "entrees/receipts-vendor-a-outcomes.json", "entrees/receipts-vendor-b-outcomes.json"]) {
      assert.ok(existsSync(join(d, f)), `${f} is missing from the delivery`);
    }
    const releve = JSON.parse(readFileSync(join(d, "releve.json"), "utf8"));
    assert.ok(scelleIntact(releve));
    const m = JSON.parse(readFileSync(join(d, "MANIFESTE.json"), "utf8"));
    assert.equal(m.scelle, releve.empreinte);
    for (const f of m.fichiers) assert.equal(createHash("sha256").update(readFileSync(join(d, f.chemin))).digest("hex"), f.sha256, `${f.chemin} hash`);
    assert.ok(m.fichiers.some((f: { chemin: string }) => f.chemin === "note-envoi.md"), "the note is in the manifest");
    const note = readFileSync(join(d, "note-envoi.md"), "utf8");
    assert.match(note, /sceau `[0-9a-f]{16}`/);
    assert.match(note, /Rien n'a été envoyé/);
    assert.match(r.stdout, /Nothing was sent/);
    for (const leaked of ["PL815827", "PLACEHOLDER CAFE", "90.87"]) assert.ok(!(note + readFileSync(join(d, "rapport.md"), "utf8")).includes(leaked), `a value left the CSV: ${leaked}`);
  } finally { rmSync(racine, { recursive: true, force: true }); }
});
