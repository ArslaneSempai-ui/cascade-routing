/*
 * THE OCR LANGUAGE FILES: pinned, fetched on one explicit command, never at run time
 * (Arslane, 4 October 2026). What these cases hold: the pins are well formed and name the
 * release; a file that is not the pinned one is refused before it is written, by size and by
 * hash; the run-time check refuses by name and names the command, without fetching; and
 * CASCADE_OFFLINE=1 makes --prime refuse without a network call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TESSDATA, LANGUES, TESSDATA_VERSION, ecartAvecLaPin, etatDesLangues, exigerTessdata, lireLangues, importer, amorcer } from "./tessdata.ts";

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

test("CASCADE_OFFLINE=1 makes --prime refuse before any fetch, and the list command reaches nothing", async () => {
  const d = mkdtempSync(join(tmpdir(), "tessdata-offline-"));
  const avant = process.env.CASCADE_OFFLINE;
  try {
    process.env.CASCADE_OFFLINE = "1";
    let appele = 0;
    await assert.rejects(amorcer(d, async () => { appele++; return Buffer.alloc(0); }), /CASCADE_OFFLINE=1 is set: nothing is downloaded/);
    assert.equal(appele, 0, "the downloader must not be called under the offline flag");
  } finally {
    if (avant === undefined) delete process.env.CASCADE_OFFLINE; else process.env.CASCADE_OFFLINE = avant;
    rmSync(d, { recursive: true, force: true });
  }
  /* The list command, through the CLI, against an empty folder: it prints the pins and fetches nothing. */
  const vide = mkdtempSync(join(tmpdir(), "tessdata-liste-"));
  try {
    const r = spawnSync("node", [join(RACINE, "src", "tessdata.ts")], { encoding: "utf8", cwd: RACINE, timeout: 60_000, env: { ...process.env, CASCADE_TESSDATA: vide, CASCADE_OFFLINE: "1" } });
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
