/*
 * THE TEXT COLUMN FROM A FOLDER OF IMAGES (Arslane, 4 October 2026): tesseract.js inside Node,
 * on the three systems, pointed at the local language files and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageDe, lireLesImages, EXTENSIONS, ouvrirTesseract } from "./text-from-images.ts";
import { etatDesLangues } from "./tessdata.ts";
import { lireCsv } from "./your-cases.ts";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const CMD = join(RACINE, "src", "text-from-images.ts");
const CSV = "id,text,total:amount\nA,old text,5.00\nB,,6.00\nC,kept,7.00\n";

test("an image is found by the case id under each extension, in order, or not at all", () => {
  const d = mkdtempSync(join(tmpdir(), "images-"));
  try {
    writeFileSync(join(d, "A.jpg"), "x"); writeFileSync(join(d, "A.png"), "x"); writeFileSync(join(d, "B.webp"), "x");
    assert.equal(imageDe(d, "A"), join(d, "A.png"), "png comes first in the order");
    assert.equal(imageDe(d, "B"), join(d, "B.webp"));
    assert.equal(imageDe(d, "C"), null);
    assert.deepEqual([...EXTENSIONS], [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("given a reader, every case with an image gets its text, the others keep theirs, and the labels do not move", async () => {
  const d = mkdtempSync(join(tmpdir(), "images-lecture-"));
  try {
    writeFileSync(join(d, "A.png"), "x"); writeFileSync(join(d, "B.png"), "x");
    const lus: string[] = [];
    const r = await lireLesImages(CSV, d, async (p) => { lus.push(p); return p.endsWith("B.png") ? "   \n" : "TOTAL 5.00\nread by the engine"; });
    assert.deepEqual(lus.map((p) => p.split("/").pop()), ["A.png", "B.png"], "the reader runs on the cases that have an image, once each");
    assert.deepEqual(r.lus, ["A"]); assert.deepEqual(r.vides, ["B"]); assert.deepEqual(r.sansImage, ["C"]);
    const apres = lireCsv(r.csv);
    assert.equal(apres.cas[0]!.text, "TOTAL 5.00\nread by the engine");
    assert.equal(apres.cas[1]!.text, "", "an empty reading leaves the text as it was");
    assert.equal(apres.cas[2]!.text, "kept");
    assert.deepEqual(apres.cas.map((c) => c.truth.total), ["5.00", "6.00", "7.00"], "labels untouched");
    assert.deepEqual({ ...apres.kinds }, { total: "amount" }, "kinds untouched");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the command refuses an engine it does not run, a missing folder, and an existing output without --overwrite; --help exits 0", () => {
  const d = mkdtempSync(join(tmpdir(), "images-cli-"));
  try {
    const csv = join(d, "c.csv"); writeFileSync(csv, CSV); mkdirSync(join(d, "img"));
    const run = (...a: string[]) => spawnSync("node", [CMD, ...a], { encoding: "utf8", cwd: RACINE, timeout: 60_000, env: { ...process.env, CASCADE_TESSDATA: join(d, "no-tessdata") } });
    assert.equal(run("--help").status, 0);
    const moteur = run(`--cases=${csv}`, `--images=${join(d, "img")}`, "--ocr=vision");
    assert.equal(moteur.status, 1); assert.match(moteur.stderr, /--ocr=vision is not an engine this command runs/);
    const dossier = run(`--cases=${csv}`, `--images=${join(d, "nowhere")}`, "--ocr=tesseract");
    assert.equal(dossier.status, 1); assert.match(dossier.stderr, /is not a folder/);
    writeFileSync(join(d, "c-with-text.csv"), "x");
    const existe = run(`--cases=${csv}`, `--images=${join(d, "img")}`, "--ocr=tesseract");
    assert.equal(existe.status, 1); assert.match(existe.stderr, /already exists/);
    /* No language file: the refusal names the command and downloads nothing. */
    const sans = run(`--cases=${csv}`, `--images=${join(d, "img")}`, "--ocr=tesseract", `--out=${join(d, "o.csv")}`);
    assert.equal(sans.status, 1); assert.match(sans.stderr, /OCR language file\(s\) are not on this machine[\s\S]*npm run tessdata -- --prime/);
    assert.ok(!existsSync(join(d, "no-tessdata")), "nothing was fetched or created");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("tesseract reads a rendered line of text offline, and fills the text column", { timeout: 180_000 }, async (t) => {
  if (!etatDesLangues().every((e) => e.conforme)) {
    return t.skip("the OCR language files are not on this machine: `npm run tessdata -- --prime` fetches eng and ind once (5.2 MB, pinned); nothing was read.");
  }
  const d = mkdtempSync(join(tmpdir(), "images-tesseract-"));
  try {
    /* A page rendered here, from text we chose: no fixture image to carry, and the expected words are known. */
    const sharp = (await import("sharp")).default;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><rect width="100%" height="100%" fill="white"/>`
      + `<text x="40" y="120" font-family="Helvetica, Arial, sans-serif" font-size="64" fill="black">TOTAL 60.000</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(join(d, "R1.png"));
    const avant = process.env.CASCADE_OFFLINE;
    process.env.CASCADE_OFFLINE = "1";
    let lecteur;
    try {
      lecteur = await ouvrirTesseract(["eng"]);
      const r = await lireLesImages("id,text,total:amount-grouped\nR1,,60000\n", d, lecteur.lire);
      assert.deepEqual(r.lus, ["R1"], `nothing read: ${JSON.stringify(r)}`);
      const texte = lireCsv(r.csv).cas[0]!.text;
      assert.match(texte.replace(/\s+/g, " "), /TOTAL/i, `the engine did not read the word: ${JSON.stringify(texte)}`);
      assert.match(texte, /60[.,]?000/, `the engine did not read the amount: ${JSON.stringify(texte)}`);
    } finally {
      await lecteur?.fermer();
      if (avant === undefined) delete process.env.CASCADE_OFFLINE; else process.env.CASCADE_OFFLINE = avant;
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
