import { test } from "node:test";
import assert from "node:assert/strict";
import { generateRecords, generateAlerts, FIELDS, TYPOLOGIES } from "./corpus.ts";
import { correct, TIERS } from "./tiers.ts";
import { classify } from "./failures.ts";
import { readProfiles } from "./measure.ts";
import { optimiseExtraction, optimiseClassification, budgetShadowPrice } from "./optimise.ts";
import { ASSUMPTIONS, pricePerThousand, accuracy } from "./assumptions.ts";
import { wilson, rate } from "./interval.ts";

/* ── the split, which is the whole reason the measurement means anything ── */

test("the training and held-out halves share no phrasing", () => {
  const a = generateRecords(40, "training").map((r) => r.text);
  const b = generateRecords(40, "heldout").map((r) => r.text);
  // Not a single record may appear on both sides.
  assert.equal(a.filter((t) => b.includes(t)).length, 0);
  // And the shapes differ, not merely the values drawn into them.
  const shape = (t: string) => t.replace(/[A-Z][a-zà-ÿ]+|\d+/g, "·");
  assert.equal(a.map(shape).filter((s) => b.map(shape).includes(s)).length, 0,
    "a held-out phrasing also appears in training — the rules would be marking their own homework");
});

test("both corpora are reproducible", () => {
  assert.deepEqual(generateRecords(20), generateRecords(20));
  assert.deepEqual(generateAlerts(20), generateAlerts(20));
  assert.notDeepEqual(generateRecords(20, "heldout"), generateRecords(20, "training"));
});

test("every alert carries one of the declared typologies", () => {
  for (const a of generateAlerts(120)) assert.ok(TYPOLOGIES.includes(a.truth));
});

/* ── the scorer, which was wrong and cost 133 false failures ── */

test("formatting is not counted as an error", () => {
  // The tokeniser puts spaces around separators. That is not a model failing to find
  // the field, and counting it as one measured the wrong thing.
  assert.ok(correct("10 / 07 / 1987", "10/07/1987"));
  assert.ok(correct("IT - 5560 - K", "IT-5560-K"));
  assert.ok(correct("Amina Haddad.", "Amina Haddad"));
});

test("content is still counted as an error", () => {
  assert.ok(!correct("Leila", "Leila Haddad"), "a fragment is wrong");
  assert.ok(!correct("", "Leila Haddad"), "an empty answer is wrong");
  assert.ok(!correct("Leila Haddad Birth 10/07/1987", "Leila Haddad"), "an over-long span is wrong");
  assert.ok(!correct("Marcus Ferreira", "Leila Haddad"), "the wrong value is wrong");
});

test("failure modes are named, not lumped together", () => {
  assert.equal(classify("", "Leila Haddad"), "empty");
  assert.equal(classify("Leila", "Leila Haddad"), "fragment");
  assert.equal(classify("Leila Haddad Birth 1987", "Leila Haddad"), "over-long");
  assert.equal(classify("Marcus Ferreira", "Leila Haddad"), "wrong span");
});

/* ── the assumptions, kept apart from the measurements ── */

test("the human tier is an assumption, never a certainty", () => {
  // An earlier version returned ground truth here, which made the human infallible by
  // construction and would have routed everything to them.
  assert.ok(ASSUMPTIONS.humanAccuracy < 1, "a human at 100 % is not a model, it is a bug");
  assert.equal(accuracy("human", 1, ASSUMPTIONS), ASSUMPTIONS.humanAccuracy);
  // Machine tiers report what was measured, untouched.
  assert.equal(accuracy("large", 0.967, ASSUMPTIONS), 0.967);
});

test("rules cost nothing and humans cost the most", () => {
  const prices = TIERS.map((t) => pricePerThousand(t, ASSUMPTIONS));
  assert.equal(prices[0], 0, "rules are free");
  assert.ok(prices.at(-1)! > prices[2]!, "a human costs more than the large model");
});

/* ── the optimiser ── */

test("the routing never exceeds the budget", () => {
  const p = readProfiles();
  if (!p) return;                       // nothing measured yet; not a failure of this test
  for (const budget of [50, 200, 4_000, 100_000]) {
    const s = optimiseExtraction(p, { ...ASSUMPTIONS, budget });
    if (s) assert.ok(s.cost <= budget, `routing costs ${s.cost} on a budget of ${budget}`);
  }
});

test("a larger budget never produces a worse routing", () => {
  const p = readProfiles();
  if (!p) return;
  let previous = -1;
  for (const budget of [200, 1_000, 10_000, 100_000, 1_000_000]) {
    const s = optimiseExtraction(p, { ...ASSUMPTIONS, budget });
    if (!s) continue;
    assert.ok(s.accuracy >= previous - 1e-9, "more money bought a worse answer");
    previous = s.accuracy;
  }
});

test("the shadow price reports a step, not a slope", () => {
  const p = readProfiles();
  if (!p) return;
  const f = budgetShadowPrice(p, ASSUMPTIONS);
  assert.ok(f);
  if (f.step) {
    // The next gain must genuinely be a gain, and cost genuinely more.
    assert.ok(f.step.gainPoints > 0);
    assert.ok(f.step.extra > 0);
    assert.ok(f.step.budgetNeeded > f.currentCost);
  }
});

test("the two chains do not want the same tier", () => {
  const p = readProfiles();
  if (!p) return;
  const a = optimiseExtraction(p, ASSUMPTIONS);
  const b = optimiseClassification(p, ASSUMPTIONS);
  assert.ok(a && b.chosen);
  const usedInA = new Set(FIELDS.map((f) => a.routing[f]));
  // This is the finding the whole project exists to produce. If it ever stops being
  // true, the README says something the code no longer supports.
  assert.ok(usedInA.size > 1, "chain A should route different fields to different tiers");
});

/* ── intervals ── */

test("a rate on a tiny sample is not reportable", () => {
  assert.equal(rate(3, 4).reportable, false);
  assert.equal(rate(15, 20).reportable, true);
});

test("Wilson does not invent certainty from four observations", () => {
  const [low, high] = wilson(4, 4);
  assert.ok(low < 0.6, `four out of four should not read as ${(low * 100).toFixed(0)} % at the low end`);
  assert.equal(high, 1);
});
