/**
 * THE `text` COLUMN FROM A FOLDER OF IMAGES, ON LINUX, MACOS AND WINDOWS.
 *
 * `npm run ocr` reads images through macOS Vision and runs nowhere else; `text-from-exports`
 * needs a vendor's export. A buyer with receipt images and no vendor text had no path on Linux
 * (audit of 4 October 2026). This command reads the images with tesseract.js (Apache-2.0), an
 * OCR engine that runs inside Node on the three systems, and fills the labelled CSV's `text`
 * column, labels and kinds untouched, like `text-from-exports`.
 *
 *   npm run text-from-images -- --cases=labelled.csv --images=<folder> --ocr=tesseract [--lang=eng+ind] [--out=<file>] [--overwrite]
 *
 * OFFLINE BY CONSTRUCTION. tesseract.js, left alone, fetches its language files from a public
 * host at run time. Here it is pointed at the folder `npm run tessdata -- --prime` filled once
 * (each file pinned by SHA-256, see tessdata.ts), with the cache off and the engine's code read
 * from node_modules; a missing language file refuses by name before any image is opened. The
 * egress check of this repository holds that no connection opens during a run.
 *
 * An image is matched to a case by its id: `<folder>/<id>.png`, `.jpg`, `.jpeg`, `.tif`,
 * `.tiff`, `.bmp` or `.webp`. The text a case gets is the engine's reading of its page, so the
 * local tiers then carry this OCR's errors, as the CORD example's carry Vision's; the report
 * says which text column they read.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { fillTextFrom } from "./text-from-exports.ts";
import { lireLangues, exigerTessdata, racineTessdata, type Langue } from "./tessdata.ts";

export const FLAGS = ["--cases", "--images", "--ocr", "--lang", "--out", "--overwrite", "--help"] as const;
export const EXTENSIONS = [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"] as const;

/** The image of a case, or null: the first extension found, in the order above. */
export function imageDe(dossier: string, id: string): string | null {
  for (const ext of EXTENSIONS) {
    const p = join(dossier, id + ext);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

export type Lecteur = { lire: (chemin: string) => Promise<string>; fermer: () => Promise<void> };

/**
 * The engine, opened once for the run: tesseract.js pointed at the local language folder, the
 * cache off, the LSTM engine only. `createWorker` is imported here, lazily, so that loading this
 * module costs nothing to a caller that only fills a CSV with its own reader.
 */
export async function ouvrirTesseract(langues: readonly Langue[], racine = racineTessdata()): Promise<Lecteur> {
  exigerTessdata(langues, racine);
  const { createWorker, OEM } = await import("tesseract.js");
  const worker = await createWorker(langues.join("+"), OEM.LSTM_ONLY, {
    langPath: racine, gzip: false, cacheMethod: "none", logger: () => {},
  });
  return {
    lire: async (chemin: string) => (await worker.recognize(chemin)).data.text,
    fermer: async () => { await worker.terminate(); },
  };
}

export type Lecture = { csv: string; lus: string[]; sansImage: string[]; vides: string[] };

/** Pure given a reader: every case with an image gets the reader's text; the rest keep theirs. */
export async function lireLesImages(csvText: string, dossier: string, lecteur: Lecteur["lire"],
  avancement?: (fait: number, total: number, id: string) => void): Promise<Lecture> {
  const lus: string[] = [], sansImage: string[] = [], vides: string[] = [];
  const textes = new Map<string, string>();
  const ids: string[] = [];
  /* First pass: which cases have an image; the reader runs on those only. */
  const avant = fillTextFrom(csvText, (id) => { ids.push(id); return null; });
  void avant;
  const avecImage = ids.map((id) => ({ id, image: imageDe(dossier, id) }));
  for (const { id, image } of avecImage) if (!image) sansImage.push(id);
  const aLire = avecImage.filter((x) => x.image !== null);
  let fait = 0;
  for (const { id, image } of aLire) {
    const texte = (await lecteur(image!)).replace(/\r\n/g, "\n").trim();
    fait++;
    avancement?.(fait, aLire.length, id);
    if (texte.length === 0) { vides.push(id); continue; }
    textes.set(id, texte); lus.push(id);
  }
  const r = fillTextFrom(csvText, (id) => textes.get(id) ?? null);
  return { csv: r.csv, lus, sansImage, vides };
}

async function principal(): Promise<void> {
  refuserDrapeauxInconnus(FLAGS);
  const arg = (nom: string) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  const fichier = arg("cases"), dossier = arg("images"), moteur = arg("ocr");
  const aide = process.argv.includes("--help");
  if (!fichier || !dossier || !moteur || aide) {
    console.log(`
Fill the text column of your labelled CSV from a folder of images, with an OCR engine that runs here.

  npm run text-from-images -- --cases=labelled.csv --images=<folder> --ocr=tesseract [--lang=eng+ind] [--out=<file>] [--overwrite]

--ocr=tesseract  tesseract.js, inside Node, on Linux, macOS and Windows. Its language files come
                 from \`npm run tessdata -- --prime\`, once, pinned by SHA-256; this command never
                 downloads anything and refuses by name when a language file is missing.
--lang           the languages, tesseract's way: eng, ind, or eng+ind (default eng).
Images are matched to cases by id: <folder>/<id>.png (or .jpg, .jpeg, .tif, .tiff, .bmp, .webp).
Writes <cases>-with-text.csv beside your CSV, labels and kinds copied as they are. A case without
an image keeps its text; an image the engine reads as empty is named. The text is this engine's
reading of the page, so the local tiers then carry its errors; the report says which text they read.
`);
    process.exit(aide ? 0 : 1);
  }
  if (!existsSync(fichier)) throw new Error(`no such file: ${fichier}`);
  if (!existsSync(dossier) || !statSync(dossier).isDirectory()) throw new Error(`--images=${dossier} is not a folder.`);
  if (moteur !== "tesseract") throw new Error(`--ocr=${moteur} is not an engine this command runs. Known: tesseract (npm run ocr reads with macOS Vision, on macOS only).`);
  const langues = lireLangues(arg("lang") ?? "eng");
  const sortie = arg("out") ?? fichier.replace(/\.csv$/i, "") + "-with-text.csv";
  if (existsSync(sortie) && statSync(sortie).isDirectory()) throw new Error(`${sortie} is a directory.`);
  if (existsSync(sortie) && !process.argv.includes("--overwrite")) {
    throw new Error(`${sortie} already exists, and this command does not overwrite it without being told to.\n`
      + `  Write elsewhere with --out=<file>, or pass --overwrite. Nothing was written.`);
  }
  const t0 = Date.now();
  const lecteur = await ouvrirTesseract(langues);
  try {
    const r = await lireLesImages(readFileSync(fichier, "utf8"), dossier, lecteur.lire,
      (fait, total, id) => { if (fait === 1 || fait % 10 === 0 || fait === total) process.stderr.write(`  ${fait}/${total} ${id}\n`); });
    if (r.lus.length === 0) {
      throw new Error(`no case of ${basename(fichier)} got a text from ${dossier}: `
        + (r.sansImage.length ? `${r.sansImage.length} case(s) have no image there (ids look like ${r.sansImage.slice(0, 3).join(", ")})` : "")
        + (r.vides.length ? `${r.sansImage.length ? "; " : ""}${r.vides.length} image(s) read as empty` : "") + `. Nothing was written.`);
    }
    writeFileSync(sortie, r.csv);
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n${r.lus.length} case(s) got their text from tesseract (${langues.join("+")}, offline) in ${s} s.`);
    if (r.sansImage.length) console.log(`  ${r.sansImage.length} case(s) have no image in ${dossier} and keep their text: ${r.sansImage.slice(0, 5).join(", ")}${r.sansImage.length > 5 ? ", and more" : ""}.`);
    if (r.vides.length) console.log(`  ${r.vides.length} image(s) read as empty, and those cases keep their text: ${r.vides.slice(0, 5).join(", ")}${r.vides.length > 5 ? ", and more" : ""}.`);
    console.log(`\nWritten to ${sortie}: your labels as they were, the text column from the engine.\n`);
    console.log(`  npm run measure:yours -- --cases=${sortie} ...\n`);
  } finally {
    await lecteur.fermer();
  }
}

if (isMain(import.meta)) {
  try { await principal(); }
  catch (e) { console.error(`\n${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); }
}
