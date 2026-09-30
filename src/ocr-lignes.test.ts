/*
 * F5 (2026-09-29): the blocks of one printed line come out on one line.
 *
 * The reader returns one block per run of text. On a receipt, `TAX` and `5.455` are two
 * blocks of one printed line; written one block per line, the value fell under its label
 * and every extractor that reads a label and the number beside it lost the pair. `lignes`
 * groups the blocks whose top edges sit at one height once the page is deskewed, with a
 * tolerance derived from the spacing of the blocks (the derivation is in its comment).
 *
 * Every page below is synthetic: the corners are computed, not read from an image, so the
 * cases run on any platform and need neither the Vision binary nor Chrome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lignes, texte, aDesBas, type Bloc, type BlocEntier } from "./ocr.ts";
import { fideliteDesLignes, fideliteDesLignes as fideliteDesLignesEntiere } from "./mesurer-ocr.ts";

/** A block at top-left (x, y) of width w on a page turned by `angle` (image coordinates,
 *  y downward, rotation about the origin). */
function bloc(t: string, x: number, y: number, w: number, angle = 0): Bloc {
  const turn = (px: number, py: number) => ({
    x: px * Math.cos(angle) - py * Math.sin(angle),
    y: px * Math.sin(angle) + py * Math.cos(angle),
  });
  const tl = turn(x, y), tr = turn(x + w, y);
  return { texte: t, tlx: tl.x, tly: tl.y, trx: tr.x, try: tr.y, confiance: 0.99 };
}

/** A CORD-like receipt: label at the left margin, value at the right, one pitch apart. */
function recu(pitch: number, hair: number, angle = 0): Bloc[] {
  const rows: [string, string][] = [["SUB TOTAL", "4.955"], ["TAX", "5.455"], ["TOTAL", "60.000"], ["CASH", "100.000"], ["CHANGE", "40.000"]];
  const out: Bloc[] = [];
  rows.forEach(([label, value], i) => {
    const y = 0.30 + i * pitch;
    out.push(bloc(label, 0.08, y, 0.22, angle));
    out.push(bloc(value, 0.62, y - hair, 0.14, angle));   /* the value printed a hair higher */
  });
  return out;
}

test("F5: a two-column line whose value sits a hair higher than its label comes out as one line, label first", () => {
  const blocs = recu(0.024, 0.0015);
  /* Red before: sorted on the top edge alone, "5.455" came out on its own line, ABOVE "TAX". */
  const shuffled = [blocs[3]!, blocs[8]!, blocs[0]!, blocs[5]!, blocs[2]!, blocs[9]!, blocs[1]!, blocs[6]!, blocs[4]!, blocs[7]!];
  assert.deepEqual(lignes(shuffled), ["SUB TOTAL 4.955", "TAX 5.455", "TOTAL 60.000", "CASH 100.000", "CHANGE 40.000"]);
  assert.equal(texte(shuffled), "SUB TOTAL 4.955\nTAX 5.455\nTOTAL 60.000\nCASH 100.000\nCHANGE 40.000",
    "the text joins the lines with a newline and the blocks of a line with one space");
  assert.ok(!texte(shuffled).includes("  "), "one space between two blocks, never two");
});

test("F5: a skewed page still groups by printed line, and the value stays after its label", () => {
  /* At five degrees over half a page, the right column's top edge is lower than the left
     column's by far more than a line: only the deskewed height groups them. */
  const a = 5 * Math.PI / 180;
  const blocs = recu(0.024, 0.0015, a);
  const tax = blocs[2]!, value = blocs[3]!;
  assert.ok(value.tly - tax.tly > 0.024, `the raw top edges of TAX and 5.455 differ by ${(value.tly - tax.tly).toFixed(3)}: more than a line`);
  assert.deepEqual(lignes(blocs), ["SUB TOTAL 4.955", "TAX 5.455", "TOTAL 60.000", "CASH 100.000", "CHANGE 40.000"]);
  /* The other way round as well: a page turned the other way. */
  assert.deepEqual(lignes(recu(0.024, 0.0015, -a)), ["SUB TOTAL 4.955", "TAX 5.455", "TOTAL 60.000", "CASH 100.000", "CHANGE 40.000"]);
});

test("F5: two genuinely separate close lines stay apart, and the hairs inside each still close", () => {
  /* A dense receipt: a pitch of 0.012, hairs of 0.001. The tolerance reads 0.4 * 0.012 from
     the spacing, so a hair joins and a pitch does not. */
  const blocs = recu(0.012, 0.001);
  assert.deepEqual(lignes(blocs), ["SUB TOTAL 4.955", "TAX 5.455", "TOTAL 60.000", "CASH 100.000", "CHANGE 40.000"]);
  /* Two lines only, one block each, a pitch of 0.005: no hair anywhere, nothing merges. */
  assert.deepEqual(lignes([bloc("TOTAL", 0.1, 0.5, 0.2), bloc("CASH", 0.1, 0.505, 0.2)]), ["TOTAL", "CASH"]);
  /* A single line of two blocks: no step to read a pitch from, the floor alone tells a hair. */
  assert.deepEqual(lignes([bloc("5.455", 0.6, 0.499, 0.1), bloc("TAX", 0.1, 0.5, 0.2)]), ["TAX 5.455"]);
  assert.deepEqual(lignes([bloc("5.455", 0.6, 0.494, 0.1), bloc("TAX", 0.1, 0.5, 0.2)]), ["5.455", "TAX"],
    "a gap of 0.006 with no pitch to compare it to is a line, not a hair");
});

test("F5: a one-column page reads as before, a line's blocks come out left to right, and no block is lost or doubled", () => {
  const page = Array.from({ length: 9 }, (_, i) => bloc(`line ${i}`, 0.1, 0.1 + i * 0.05, 0.4));
  assert.equal(texte([...page].reverse()), page.map((b) => b.texte).join("\n"));
  const trois = [bloc("c", 0.7, 0.400, 0.1), bloc("a", 0.1, 0.401, 0.1), bloc("b", 0.4, 0.399, 0.1), bloc("next", 0.1, 0.44, 0.3)];
  assert.deepEqual(lignes(trois), ["a b c", "next"]);
  assert.deepEqual(lignes([]), []);
  assert.equal(texte([]), "");
  /* A staircase of hairs must not climb from one line into the next: the tolerance is
     measured from the FIRST block of the line. */
  const escalier = [0, 0.002, 0.004, 0.006, 0.008, 0.010, 0.012].map((dy, i) => bloc(`s${i}`, 0.1 + i * 0.1, 0.5 + dy, 0.08));
  const lus = lignes([...escalier, bloc("far", 0.1, 0.56, 0.3), bloc("farther", 0.1, 0.62, 0.3)]);
  assert.equal(lus.join(" ").split(" ").length, escalier.length + 2, "every block appears once");
  assert.ok(lus.length >= 3 && lus[lus.length - 1] === "farther", lus.join(" | "));
});

test("F5: the line fidelity counts printed lines read whole on one line, and how many of them in order", () => {
  /* F6 added the two counts about the page's width; without a width they repeat `lignes`
     and `intactes`, and the F6 case below holds them. Here the three F5 counts. */
  const fideliteDesLignes = (a: string, l: string) => { const { lignes, intactes, enOrdre } = fideliteDesLignesEntiere(a, l); return { lignes, intactes, enOrdre }; };
  const attendu = "Name: Ada Lovelace\n\nDate of birth:   10 December 1815\nPassport no. X123456\nIssued in London\n";
  /* Read whole and in order: every line is intact, every line follows the previous one. */
  assert.deepEqual(fideliteDesLignes(attendu, "Name: Ada Lovelace\nDate of birth: 10 December 1815\nPassport no. X123456\nIssued in London"),
    { lignes: 4, intactes: 4, enOrdre: 4 });
  /* A line broken in two is not intact; the words are all there, which is what the word
     count sees and this does not forgive. */
  assert.deepEqual(fideliteDesLignes(attendu, "Name: Ada Lovelace\nDate of birth:\n10 December 1815\nPassport no. X123456\nIssued in London"),
    { lignes: 4, intactes: 3, enOrdre: 3 });
  /* Two lines swapped: both intact, one of them out of order. */
  assert.deepEqual(fideliteDesLignes(attendu, "Name: Ada Lovelace\nPassport no. X123456\nDate of birth: 10 December 1815\nIssued in London"),
    { lignes: 4, intactes: 4, enOrdre: 3 });
  /* Noise around a line does not break it: the line is looked for INSIDE the OCR line. */
  assert.deepEqual(fideliteDesLignes("TAX 5.455", "* TAX 5.455 *"), { lignes: 1, intactes: 1, enOrdre: 1 });
  /* A line printed twice is looked for after the last match, so the repeat counts in order. */
  assert.deepEqual(fideliteDesLignes("a\nb\na", "a\nb\na"), { lignes: 3, intactes: 3, enOrdre: 3 });
  assert.deepEqual(fideliteDesLignes("a\nb\na", "a\nb"), { lignes: 3, intactes: 3, enOrdre: 2 }, "the repeat is found, but only before b");
  /* Nothing read: nothing intact, nothing in order; nothing expected: zero of zero. */
  assert.deepEqual(fideliteDesLignes(attendu, ""), { lignes: 4, intactes: 0, enOrdre: 0 });
  assert.deepEqual(fideliteDesLignes("", "anything"), { lignes: 0, intactes: 0, enOrdre: 0 });
});

/* ────────────────────────────────────────────────────────────────────────────
   F6 (2026-09-29): the blocks have a height, and a line is told by vertical overlap.

   Measured by the founder on the 100 CORD receipts with the top-edge rule: the amount sat on
   the same OCR line as its label 47 times of the 84 it was read at all (subtotal 27 of 64,
   tax 18 of 38); CORD-TEST-003 read "11,000 / TOTAL / 11,000", the label alone between two
   values. A bold label and a lighter value do not share a top edge, a photographed receipt
   does not share one angle, and a page of two lines barely has a pitch. Every page below
   carries its four corners, as the reader writes them since F6.
   ──────────────────────────────────────────────────────────────────────────── */

/** A rotation about (x0, y0) in image coordinates, y downward. */
function tour(x0: number, y0: number, a: number) {
  return (x: number, y: number) => ({
    x: x0 + (x - x0) * Math.cos(a) - (y - y0) * Math.sin(a),
    y: y0 + (x - x0) * Math.sin(a) + (y - y0) * Math.cos(a),
  });
}
const droit = (x: number, y: number) => ({ x, y });

/** A box of top-left (x, y), width w and height h, its four corners through `t`. */
function boite(texte: string, x: number, y: number, w: number, h: number, t = droit): BlocEntier {
  const tl = t(x, y), tr = t(x + w, y), bl = t(x, y + h), br = t(x + w, y + h);
  return { texte, tlx: tl.x, tly: tl.y, trx: tr.x, try: tr.y, blx: bl.x, bly: bl.y, brx: br.x, bry: br.y, confiance: 0.99 };
}

/** The same block as an older binary wrote it: top corners only. */
function sansBas(b: Bloc): Bloc {
  const { blx: _1, bly: _2, brx: _3, bry: _4, ...haut } = b;
  return haut;
}

const LIGNES = ["SUB TOTAL 4.955", "TAX 5.455", "TOTAL 60.000", "CASH 100.000", "CHANGE 40.000"];
const PAIRES: [string, string][] = LIGNES.map((l) => { const i = l.lastIndexOf(" "); return [l.slice(0, i), l.slice(i + 1)]; });

test("F6: a bold label and a lighter value on one baseline are one line, whatever their top edges", () => {
  /* A dense receipt: a pitch of 0.03, labels 0.026 tall in bold capitals, values 0.012 tall
     and set on the same baseline, so their top edges sit 0.014 apart: more than the 0.012
     the top-edge rule can ever allow. */
  const page: BlocEntier[] = [];
  PAIRES.forEach(([label, value], i) => {
    const y = 0.30 + i * 0.03;
    page.push(boite(label, 0.08, y, 0.22, 0.026), boite(value, 0.62, y + 0.014, 0.14, 0.012));
  });
  assert.deepEqual(lignes(page), LIGNES);
  /* The witness: the same page as an older binary wrote it, top corners only, falls back to
     the top-edge rule and splits every value from its label, the CORD-TEST-003 shape. */
  const vieux = lignes(page.map(sansBas));
  assert.notDeepEqual(vieux, LIGNES);
  assert.equal(vieux.length, 10, `the top-edge rule reads ${vieux.length} lines here: ${vieux.join(" | ")}`);
});

test("F6: a photographed receipt whose lines do not share one angle still reads line by line", () => {
  /* Six lines, each turned about its own start by an angle that drifts from -3 to +3 degrees
     down the page, as a curved or photographed receipt is; on each, the value sits 0.54 to
     the right of its label and 0.004 lower (a common baseline, a smaller face). At three
     degrees over 0.54 the value's top edge is 0.028 away from its label's: a line's worth. */
  const page: BlocEntier[] = [];
  const angles: number[] = [];
  PAIRES.concat([["ITEMS", "7"]]).forEach(([label, value], i) => {
    const y = 0.30 + i * 0.03, a = (-3 + i * 1.2) * Math.PI / 180, t = tour(0.08, y, a);
    angles.push(a);
    page.push(boite(label, 0.08, y, 0.22, 0.014, t), boite(value, 0.62, y + 0.004, 0.14, 0.010, t));
  });
  const attendu = LIGNES.concat(["ITEMS 7"]);
  assert.deepEqual(lignes(page), attendu);
  assert.deepEqual(lignes([...page].reverse()), attendu, "the order the reader lists the blocks in does not matter");
  /* The witness: one angle for the whole page cannot follow six; the top-edge rule loses the
     lines farthest from the median angle. */
  assert.notDeepEqual(lignes(page.map(sansBas)), attendu);
});

test("F6: a block two lines tall joins one line and does not bridge the next", () => {
  const page = [
    boite("TOTAL", 0.08, 0.30, 0.22, 0.014), boite("60.000", 0.62, 0.30, 0.14, 0.014),
    boite("CASH", 0.08, 0.33, 0.22, 0.014), boite("100.000", 0.62, 0.33, 0.14, 0.014),
    boite("CHANGE", 0.08, 0.36, 0.22, 0.014), boite("40.000", 0.62, 0.36, 0.14, 0.014),
    boite("}", 0.80, 0.30, 0.02, 0.044),   /* a brace spanning the first two lines */
  ];
  const lus = lignes(page);
  assert.equal(lus.length, 3, lus.join(" | "));
  assert.deepEqual(lus.slice(1), ["CASH 100.000", "CHANGE 40.000"], "the brace joins one line and the second stays whole");
  assert.equal(lus[0], "TOTAL 60.000 }");
  assert.equal(lus.join(" ").split(" ").length, page.length, "every block appears once");
});

test("F6: close lines stay apart, hairs close, and a page of two lines needs no pitch", () => {
  /* A pitch of 0.012, heights of 0.010: the next line starts 0.002 below the previous one's
     bottom; the value sits a hair (0.001) higher than its label. */
  const dense: BlocEntier[] = [];
  PAIRES.forEach(([label, value], i) => {
    const y = 0.30 + i * 0.012;
    dense.push(boite(label, 0.08, y, 0.22, 0.010), boite(value, 0.62, y - 0.001, 0.14, 0.010));
  });
  assert.deepEqual(lignes(dense), LIGNES);
  /* Two lines only, two blocks each, 0.6 of a height apart: no pitch anywhere, and the
     overlap of 0.4 of the smaller height keeps them apart. */
  assert.deepEqual(lignes([boite("TOTAL", 0.08, 0.5, 0.22, 0.010), boite("60.000", 0.62, 0.499, 0.14, 0.010),
    boite("CASH", 0.08, 0.506, 0.22, 0.010), boite("100.000", 0.62, 0.5055, 0.14, 0.010)]), ["TOTAL 60.000", "CASH 100.000"]);
  /* Exactly half of the smaller height overlapping is one line; a hair less is two. */
  assert.deepEqual(lignes([boite("A", 0.1, 0.5, 0.2, 0.010), boite("B", 0.4, 0.505, 0.2, 0.010)]), ["A B"]);
  assert.deepEqual(lignes([boite("A", 0.1, 0.5, 0.2, 0.010), boite("B", 0.4, 0.5051, 0.2, 0.010)]), ["A", "B"]);
});

test("F6: with the bottoms, the F5 pages read the same; one block without them and the page falls back to the top-edge rule", () => {
  const pleine: BlocEntier[] = [];
  PAIRES.forEach(([label, value], i) => {
    const y = 0.30 + i * 0.024;
    pleine.push(boite(label, 0.08, y, 0.22, 0.012), boite(value, 0.62, y - 0.0015, 0.14, 0.012));
  });
  assert.deepEqual(lignes(pleine), LIGNES);
  assert.deepEqual(lignes(pleine.map(sansBas)), LIGNES, "the F5 rule still reads this page");
  assert.ok(pleine.every(aDesBas) && !aDesBas(sansBas(pleine[0]!)));
  const melange = [sansBas(pleine[0]!), ...pleine.slice(1)];
  assert.deepEqual(lignes(melange), lignes(pleine.map(sansBas)), "a page the reader only partly measured is read by the rule that needs no height");
  const colonne = Array.from({ length: 9 }, (_, i) => boite(`line ${i}`, 0.1, 0.1 + i * 0.05, 0.4, 0.02));
  assert.equal(texte([...colonne].reverse()), colonne.map((b) => b.texte).join("\n"));
});

test("F6: the reader's source emits the bottom corners, flipped the way the top ones are", () => {
  /* Weak, and said so: the Swift cannot be compiled or run on the systems that publish this
     suite, and macOS compiles it in `ocr-gardes.test.ts`. What this holds is that the four
     keys `lignes` reads are written, with the same flip of y as the top corners. */
  const swift = readFileSync(fileURLToPath(new URL("./ocr/lire.swift", import.meta.url)), "utf8");
  assert.match(swift, /"tly": Double\(1 - o\.topLeft\.y\)/, "the top corners' flip moved: the check below compares against it");
  assert.match(swift, /"blx": Double\(o\.bottomLeft\.x\), "bly": Double\(1 - o\.bottomLeft\.y\)/);
  assert.match(swift, /"brx": Double\(o\.bottomRight\.x\), "bry": Double\(1 - o\.bottomRight\.y\)/);
});

test("F6: the line fidelity knows which expected lines fit on the rendered page", () => {
  const longue = "Marcus Ferreira, dob 21 October 1961, doc no FR-1856-M, Portugal, lives 106 Odos Ermou, Rotterdam (updated by branch staff)";
  assert.ok(longue.length > 73);
  const attendu = `KYC REVIEW\n${longue}\nPostal .......... 61 Rua da Prata, Valencia`;
  /* Read whole: every line intact, two of them fit. */
  assert.deepEqual(fideliteDesLignes(attendu, attendu, 73), { lignes: 3, intactes: 3, enOrdre: 3, tiennent: 2, intactesQuiTiennent: 2 });
  /* The long line wrapped by the page and read on two OCR lines: not intact, and not held
     against the reader since it never fit. */
  const enveloppe = `KYC REVIEW\n${longue.slice(0, 70)}\n${longue.slice(70).trim()}\nPostal .......... 61 Rua da Prata, Valencia`;
  assert.deepEqual(fideliteDesLignes(attendu, enveloppe, 73), { lignes: 3, intactes: 2, enOrdre: 2, tiennent: 2, intactesQuiTiennent: 2 });
  /* A short line broken by the reader IS held against it. */
  assert.deepEqual(fideliteDesLignes(attendu, `KYC\nREVIEW\n${longue}\nPostal .......... 61 Rua da Prata, Valencia`, 73),
    { lignes: 3, intactes: 2, enOrdre: 2, tiennent: 2, intactesQuiTiennent: 1 });
  /* Without a width every line fits: the F5 figures are unchanged. */
  assert.deepEqual(fideliteDesLignes(attendu, enveloppe), { lignes: 3, intactes: 2, enOrdre: 2, tiennent: 3, intactesQuiTiennent: 2 });
});
