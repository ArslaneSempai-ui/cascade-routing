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
import { lignes, texte, type Bloc } from "./ocr.ts";
import { fideliteDesLignes } from "./mesurer-ocr.ts";

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
