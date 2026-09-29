/*
 * The paired-difference interval: the two reproductions of the review, and the law.
 *
 * Reviewed 2026-09-29: the old bound made an identical candidate look worse than a losing
 * one at a six-point margin on sixty cases. The first two cases below are those numbers.
 * The law is what makes the bound safe to decide with: turning a case both got right into
 * a case only the head got right (the candidate gets worse, nothing else moves) never lowers
 * the head's worst-case advantage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newcombe, pairedDifference, pairedTable } from "./paired-difference.ts";
import { forAll, integer, tuple } from "./property.ts";

const ones = (n: number, wrongAt: number[] = []): string => Array.from({ length: n }, (_, i) => (wrongAt.includes(i) ? "0" : "1")).join("");

test("an identical candidate sits inside a six-point margin on sixty cases; a losing one does not get a better bound", () => {
  const head = ones(60, [1, 2, 3]);
  const identical = pairedDifference(head, head)!;
  assert.equal(identical.difference, 0);
  assert.ok(identical.high < 0.06, `identical candidate, worst case ${(100 * identical.high).toFixed(2)} points: must be inside six`);
  assert.ok(identical.low <= 0 && identical.high >= 0);
  assert.equal(identical.p, null);
  /* The candidate loses four more cases than the head: every disagreement favours the head. */
  const worse = pairedDifference(head, ones(60, [1, 2, 3, 10, 11, 12, 13]))!;
  assert.equal(worse.table.b, 4);
  assert.equal(worse.table.c, 0);
  assert.ok(worse.high > identical.high, "a candidate that only loses cases has a larger worst case than an identical one");
  assert.ok(worse.high > worse.difference, "the worst case is never the point estimate itself");
});

test("the table is counted on the cases graded on both sides only, and nothing paired is null", () => {
  const t = pairedTable("1100-1", "1010-0");
  assert.deepEqual(t, { a: 1, b: 2, c: 1, d: 1, n: 5 }, "the fifth case is graded on one side only and counts nowhere");
  assert.equal(newcombe({ a: 0, b: 0, c: 0, d: 0 }), null);
  assert.equal(pairedDifference("---", "---"), null);
  assert.throws(() => pairedTable("11", "1"), /not the same cases/);
  const few = pairedDifference("1".repeat(10), "1".repeat(10))!;
  assert.equal(few.tooFew, true, "ten paired cases are under the floor");
});

test("separable by McNemar exact, in either direction, and the bound points the same way", () => {
  const head = ones(80);
  const worse = pairedDifference(head, ones(80, Array.from({ length: 20 }, (_, i) => i)))!;
  assert.ok(worse.separable && worse.low > 0);
  const better = pairedDifference(ones(80, Array.from({ length: 20 }, (_, i) => i)), head)!;
  assert.ok(better.separable && better.high < 0);
  const close = pairedDifference(head, ones(80, [0, 1]))!;
  assert.ok(!close.separable, "two disagreements on eighty cases do not separate");
});

test("law: the head's worst-case advantage never decreases when a case both got right becomes a head-only win", () => {
  forAll(tuple(integer(0, 80), integer(0, 30), integer(0, 30), integer(0, 30)), ([a, b, c, d]) => {
    if (a === 0) return true;
    const before = newcombe({ a, b, c, d })!;
    const after = newcombe({ a: a - 1, b: b + 1, c, d })!;
    assert.ok(after.high >= before.high - 1e-12,
      `a=${a} b=${b} c=${c} d=${d}: high went from ${before.high} to ${after.high} when the candidate lost a case`);
    assert.ok(after.difference > before.difference);
  }, { runs: 2000 });
});

test("law: the interval contains the point estimate and stays inside [-1, 1]", () => {
  forAll(tuple(integer(0, 60), integer(0, 60), integer(0, 60), integer(0, 60)), ([a, b, c, d]) => {
    const r = newcombe({ a, b, c, d });
    if (!r) return true;
    assert.ok(r.low <= r.difference + 1e-12 && r.difference <= r.high + 1e-12, `a=${a} b=${b} c=${c} d=${d}`);
    assert.ok(r.low >= -1 && r.high <= 1);
  }, { runs: 1500 });
});
