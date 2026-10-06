/*
 * THE OCR LANGUAGE FILES: pinned, fetched on one explicit command, never at run time
 * (Arslane, 4 October 2026). What these cases hold: the pins are well formed and name the
 * release; a file that is not the pinned one is refused before it is written, by size and by
 * hash; the run-time check refuses by name and names the command, without fetching; and
 * CRUSETRA_OFFLINE=1, or its former name CASCADE_OFFLINE=1, makes --prime refuse without a
 * network call, and CRUSETRA_TESSDATA, or its former name CASCADE_TESSDATA, moves the folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TESSDATA, LANGUES, TESSDATA_VERSION, ecartAvecLaPin, etatDesLangues, exigerTessdata, lireLangues, importer, amorcer, racineTessdata } from "./tessdata.ts";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

test("the two language files are pinned by release, URL, size and sha256", () => {
  assert.equal(TESSDATA_VERSION, "tessdata_fast 4.1.0");
  assert.deepEqual([...LANGUES], ["eng", "ind"]);
  for (const l of LANGUES) {
    const p = TESSDATA[l];
    assert.match(p.url, /^https:\/\/raw\.githubusercontent\.com\/tesseract-ocr\/tessdata_fast\/4\.1\.0\/(eng|ind)\.traineddata$/, `${l}: the URL names the pinned release`);
    assert.match(p.sha256, /^[0-9a-f]{64}$/, `${l}: a sha256 is sixty-four hex characters`);
    assert.ok(p.octets > 1_000_000 && p.octets < 5_000_000, `${l}: a tessdata_fast file weighs between one and five megabytes`);
  }
  assert.equal(TESSDATA.eng.octets, 4_113_088);
  assert.equal(TESSDATA.ind.octets, 1_122_661);
});

test("a file that is not the pinned one is refused by size, then by hash, and nothing is written", () => {
  assert.match(ecartAvecLaPin("eng", Buffer.alloc(10)) ?? "", /10 bytes, the pinned file has 4113088/);
  const bonneTaille = Buffer.alloc(TESSDATA.ind.octets, 1);
  assert.match(ecartAvecLaPin("ind", bonneTaille) ?? "", /sha256 .* is not the pinned/);
  const d = mkdtempSync(join(tmpdir(), "tessdata-faux-"));
  try {
    writeFileSync(join(d, "ind.traineddata"), bonneTaille);
    assert.throws(() => importer(d, join(d, "cible")), /refused, nothing written: ind: sha256/);
    assert.ok(!existsSync(join(d, "cible", "ind.traineddata")), "a refused file must not land in the folder");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("at run time a missing language refuses by name and names the command; it never downloads", () => {
  const d = mkdtempSync(join(tmpdir(), "tessdata-vide-"));
  try {
    const etats = etatDesLangues(d);
    assert.deepEqual(etats.map((e) => [e.langue, e.present, e.ecart]), [["eng", false, "absent"], ["ind", false, "absent"]]);
    assert.throws(() => exigerTessdata(["eng"], d), /1 OCR language file\(s\) are not on this machine[\s\S]*npm run tessdata -- --prime/);
    assert.throws(() => exigerTessdata(["eng", "ind"], d), /2 OCR language file\(s\)/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("--lang reads tesseract's eng+ind form and refuses a language the tool does not carry", () => {
  assert.deepEqual(lireLangues("eng"), ["eng"]);
  assert.deepEqual(lireLangues("eng+ind"), ["eng", "ind"]);
  assert.throws(() => lireLangues("fra"), /"fra" is not a language this tool carries/);
  assert.throws(() => lireLangues(""), /--lang is empty/);
});

/** Run `quoi` with exactly these variables among the given names, then put the environment back. */
async function sousVariables<T>(noms: readonly string[], valeurs: Record<string, string>, quoi: () => T | Promise<T>): Promise<T> {
  const avant = Object.fromEntries(noms.map((n) => [n, process.env[n]]));
  try {
    for (const n of noms) delete process.env[n];
    Object.assign(process.env, valeurs);
    return await quoi();
  } finally {
    for (const [n, v] of Object.entries(avant)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
  }
}
const DRAPEAUX = ["CRUSETRA_OFFLINE", "CASCADE_OFFLINE"] as const;
const REFUS: Record<(typeof DRAPEAUX)[number], RegExp> = {
  CRUSETRA_OFFLINE: /^Error: CRUSETRA_OFFLINE=1 is set: nothing is downloaded/,
  CASCADE_OFFLINE: /^Error: CASCADE_OFFLINE=1 \(the former name of CRUSETRA_OFFLINE=1\) is set: nothing is downloaded/,
};

/*
 * One case per name, written out rather than looped: the README publishes the number of
 * cases read from the sources, a `test(` at the start of a line, and a `test(` inside a loop
 * ran twice and was never counted.
 */
async function refusesBeforeAnyFetch(nom: (typeof DRAPEAUX)[number]): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), "tessdata-offline-"));
  try {
    await sousVariables(DRAPEAUX, { [nom]: "1" }, async () => {
      let appele = 0;
      await assert.rejects(amorcer(d, async () => { appele++; return Buffer.alloc(0); }), REFUS[nom]);
      assert.equal(appele, 0, `the downloader must not be called under ${nom}=1`);
    });
  } finally { rmSync(d, { recursive: true, force: true }); }
}

test("CRUSETRA_OFFLINE=1 alone makes --prime refuse before any fetch", async () => {
  await refusesBeforeAnyFetch("CRUSETRA_OFFLINE");
});

test("CASCADE_OFFLINE=1 alone makes --prime refuse before any fetch", async () => {
  await refusesBeforeAnyFetch("CASCADE_OFFLINE");
});

test("CASCADE_OFFLINE=1 still refuses when CRUSETRA_OFFLINE says otherwise", async () => {
  const d = mkdtempSync(join(tmpdir(), "tessdata-offline-"));
  try {
    await sousVariables(DRAPEAUX, { CASCADE_OFFLINE: "1", CRUSETRA_OFFLINE: "0" }, async () => {
      let appele = 0;
      await assert.rejects(amorcer(d, async () => { appele++; return Buffer.alloc(0); }), /nothing is downloaded/);
      assert.equal(appele, 0, "a client script that sets CASCADE_OFFLINE=1 must keep refusing the network");
    });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the folder is CRUSETRA_TESSDATA, else its former name CASCADE_TESSDATA, else data/tessdata", async () => {
  const NOMS = ["CRUSETRA_TESSDATA", "CASCADE_TESSDATA"];
  const defaut = await sousVariables(NOMS, {}, () => racineTessdata());
  assert.match(defaut.split("\\").join("/"), /\/data\/tessdata$/);
  assert.equal(await sousVariables(NOMS, { CRUSETRA_TESSDATA: "/nouveau" }, () => racineTessdata()), "/nouveau");
  assert.equal(await sousVariables(NOMS, { CASCADE_TESSDATA: "/ancien" }, () => racineTessdata()), "/ancien",
    "the former name is no longer read: a client's script that sets it would silently use another folder");
  assert.equal(await sousVariables(NOMS, { CRUSETRA_TESSDATA: "/nouveau", CASCADE_TESSDATA: "/ancien" }, () => racineTessdata()), "/nouveau",
    "when both are set, the new name wins");
});

test("the list command, through the CLI, against an empty folder, prints the pins and fetches nothing", () => {
  const vide = mkdtempSync(join(tmpdir(), "tessdata-liste-"));
  try {
    const r = spawnSync("node", [join(RACINE, "src", "tessdata.ts")], { encoding: "utf8", cwd: RACINE, timeout: 60_000, env: { ...process.env, CRUSETRA_TESSDATA: vide, CRUSETRA_OFFLINE: "1" } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /eng {2}absent/);
    assert.match(r.stdout, /4,113,088 bytes pinned/);
    assert.ok(!existsSync(join(vide, "eng.traineddata")), "listing must not fetch");
  } finally { rmSync(vide, { recursive: true, force: true }); }
});

test("the files on this machine, when present, match their pins to the byte", (t) => {
  const etats = etatDesLangues();
  if (etats.every((e) => !e.present)) return t.skip("no OCR language file on this machine: `npm run tessdata -- --prime` fetches eng and ind once; nothing was compared.");
  for (const e of etats.filter((x) => x.present)) {
    assert.ok(e.conforme, `${e.langue}: ${e.ecart}`);
    assert.equal(readFileSync(e.chemin).length, TESSDATA[e.langue].octets);
  }
});
