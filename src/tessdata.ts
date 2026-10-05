/**
 * THE OCR LANGUAGE FILES, FETCHED ONCE ON AN EXPLICIT COMMAND, PINNED, NEVER AT RUN TIME.
 *
 * tesseract.js (Apache-2.0) reads a `.traineddata` file per language. Left to itself it fetches
 * them from a public host at run time; this tool never does. The two files come down with
 * `npm run tessdata -- --prime` only, from the tesseract-ocr release pinned below, each checked
 * against its SHA-256 and its size before it is written, and stored under data/ (git ignores
 * it), like the model weights live under their cache. At run time `text-from-images` points
 * tesseract.js at that folder; a missing file refuses by name, it never downloads.
 *
 *   npm run tessdata                 what is on this machine, file by file
 *   npm run tessdata -- --prime      fetch what is missing (the one network call of this module)
 *   npm run tessdata -- --import <dir>   take the files from a folder carried in by hand, same checks
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { horsLigne, drapeauHorsLigne, lireVariable } from "./environnement.ts";

export type Langue = "eng" | "ind";

/** The release and the two files, read on 2026-10-04 from the tesseract-ocr tessdata_fast tag 4.1.0. */
export const TESSDATA_VERSION = "tessdata_fast 4.1.0";
export const TESSDATA: Record<Langue, { url: string; sha256: string; octets: number; quoi: string }> = {
  eng: {
    url: "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata",
    sha256: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
    octets: 4_113_088,
    quoi: "English, the fast LSTM model",
  },
  ind: {
    url: "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/ind.traineddata",
    sha256: "69786901da87ab8766c1ea7fbb10b28f2110c14da3f6c8f2735df131fba95d88",
    octets: 1_122_661,
    quoi: "Indonesian, the fast LSTM model (the CORD receipts print rupiah the Indonesian way)",
  },
};
export const LANGUES: readonly Langue[] = ["eng", "ind"];

/** Where the files live: `CRUSETRA_TESSDATA` (former name `CASCADE_TESSDATA`, still read) for a witness or an
 *  air-gapped machine, else data/tessdata. */
export function racineTessdata(): string {
  return lireVariable("TESSDATA") ?? fileURLToPath(new URL("../data/tessdata", import.meta.url));
}

export function cheminTessdata(langue: Langue, racine = racineTessdata()): string {
  return join(racine, `${langue}.traineddata`);
}

export function estLangue(x: string): x is Langue {
  return (LANGUES as readonly string[]).includes(x);
}

/** Read "eng+ind" as tesseract writes it; an unknown language refuses with the list. */
export function lireLangues(brut: string): Langue[] {
  const parts = brut.split("+").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("--lang is empty; write --lang=eng or --lang=eng+ind.");
  for (const p of parts) if (!estLangue(p)) throw new Error(`--lang=${brut}: "${p}" is not a language this tool carries. Known: ${LANGUES.join(", ")}.`);
  return parts as Langue[];
}

/** What is wrong with a file against its pin, or null when it is the pinned file. */
export function ecartAvecLaPin(langue: Langue, octets: Buffer): string | null {
  const pin = TESSDATA[langue];
  if (octets.length !== pin.octets) return `${langue}: ${octets.length} bytes, the pinned file has ${pin.octets}`;
  const h = createHash("sha256").update(octets).digest("hex");
  if (h !== pin.sha256) return `${langue}: sha256 ${h.slice(0, 16)}… is not the pinned ${pin.sha256.slice(0, 16)}…`;
  return null;
}

export type Etat = { langue: Langue; chemin: string; present: boolean; conforme: boolean; ecart: string | null };

export function etatDesLangues(racine = racineTessdata()): Etat[] {
  return LANGUES.map((langue) => {
    const chemin = cheminTessdata(langue, racine);
    if (!existsSync(chemin) || !statSync(chemin).isFile()) return { langue, chemin, present: false, conforme: false, ecart: "absent" };
    const ecart = ecartAvecLaPin(langue, readFileSync(chemin));
    return { langue, chemin, present: true, conforme: ecart === null, ecart };
  });
}

/** The languages a run needs must be on site and conform; the refusal names the command, never downloads. */
export function exigerTessdata(langues: readonly Langue[], racine = racineTessdata()): void {
  const etats = etatDesLangues(racine).filter((e) => langues.includes(e.langue));
  const manquent = etats.filter((e) => !e.conforme);
  if (manquent.length === 0) return;
  throw new Error(`${manquent.length} OCR language file(s) are not on this machine or do not match their pin:\n`
    + manquent.map((e) => `  ${e.langue}  ${e.ecart}  (${e.chemin})`).join("\n")
    + `\n\n  Nothing is downloaded at run time. Fetch them once, checked against their SHA-256:\n`
    + `    npm run tessdata -- --prime\n`
    + `  or carry them in from a machine that could: npm run tessdata -- --import <folder>\n`);
}

/** Write a checked file atomically: a half-written language file would read as a broken model. */
function poser(langue: Langue, octets: Buffer, racine: string): string {
  const ecart = ecartAvecLaPin(langue, octets);
  if (ecart) throw new Error(`refused, nothing written: ${ecart}`);
  mkdirSync(racine, { recursive: true });
  const chemin = cheminTessdata(langue, racine);
  const tmp = `${chemin}.partiel`;
  writeFileSync(tmp, octets);
  renameSync(tmp, chemin);
  return chemin;
}

export async function amorcer(racine = racineTessdata(), telecharger: (url: string) => Promise<Buffer> = parDefaut): Promise<string[]> {
  if (horsLigne()) {
    throw new Error(`${drapeauHorsLigne()} is set: nothing is downloaded. Carry the files in with npm run tessdata -- --import <folder>.`);
  }
  const faits: string[] = [];
  for (const e of etatDesLangues(racine)) {
    if (e.conforme) { faits.push(`${e.langue}: already on site and matching its pin`); continue; }
    const octets = await telecharger(TESSDATA[e.langue].url);
    const chemin = poser(e.langue, octets, racine);
    faits.push(`${e.langue}: fetched ${octets.length.toLocaleString("en-GB")} bytes, sha256 checked, written to ${chemin}`);
  }
  return faits;
}

/* The one network call of this module: `npm run tessdata -- --prime`, to the pinned release.
   Declared in the suite's list of allowed outbound destinations with that reason. */
async function parDefaut(url: string): Promise<Buffer> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export function importer(dossier: string, racine = racineTessdata()): string[] {
  const faits: string[] = [];
  for (const langue of LANGUES) {
    const src = join(dossier, `${langue}.traineddata`);
    if (!existsSync(src)) { faits.push(`${langue}: not in ${dossier}, skipped`); continue; }
    const chemin = poser(langue, readFileSync(src), racine);
    copyFileSync(chemin, chemin);
    faits.push(`${langue}: imported from ${src}, sha256 checked`);
  }
  return faits;
}

if (isMain(import.meta)) {
  refuserDrapeauxInconnus(["--prime", "--import"]);
  const importDe = process.argv.find((a) => a.startsWith("--import="))?.slice("--import=".length)
    ?? (process.argv.includes("--import") ? process.argv[process.argv.indexOf("--import") + 1] : undefined);
  try {
    if (process.argv.includes("--prime")) {
      for (const f of await amorcer()) console.log(`  ${f}`);
    } else if (importDe !== undefined) {
      if (!importDe || !existsSync(importDe)) throw new Error(`--import needs a folder that exists; got ${JSON.stringify(importDe ?? "")}.`);
      for (const f of importer(importDe)) console.log(`  ${f}`);
    } else {
      console.log(`\n${TESSDATA_VERSION}, under ${racineTessdata()}:\n`);
      for (const e of etatDesLangues()) {
        console.log(`  ${e.langue}  ${e.conforme ? "present, matches its pin" : e.ecart}  ${TESSDATA[e.langue].octets.toLocaleString("en-GB")} bytes pinned, ${TESSDATA[e.langue].quoi}`);
      }
      console.log(`\n  --prime fetches what is missing from ${new URL(TESSDATA.eng.url).host}, once, checked; --import <folder> takes them from a carried folder.\n`);
    }
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
