/**
 * The figures this README is allowed to state.
 *
 * Measured output only. The prose is hand-written; the numbers are not, because the
 * numbers are what went stale twice before this existed.
 */

import { readProfiles } from "./measure.ts";
import { INVENTORY } from "./inventory.ts";
import { markdown } from "./provenance.ts";
import { optimiseExtraction, optimiseClassification, budgetShadowPrice } from "./optimise.ts";
import { ASSUMPTIONS, pricePerThousand, accuracy } from "./assumptions.ts";
import { collect, shape } from "./failures.ts";
import { FIELDS } from "./corpus.ts";
import { TIERS } from "./tiers.ts";
import { run as emit, table } from "./figures.ts";
import { rate } from "./interval.ts";
import { majorityClass, uniformGuess, verdict } from "./baselines.ts";
import { generateAlerts } from "./corpus.ts";
import { TYPOLOGIES } from "./corpus.ts";

const p = readProfiles();
if (!p) { console.error("No profile measured — start with: npm run measure"); process.exit(1); }
const h = ASSUMPTIONS;
const pc = (x: number) => (x * 100).toFixed(1) + " %";
const euro = (n: number) => "$" + Math.round(n).toLocaleString("en-GB");

const extraction = table(
  ["Tier", ...FIELDS, "Latency"],
  TIERS.filter((t) => t !== "human").map((t) => [
    `\`${t}\``,
    ...FIELDS.map((f) => pc(p.extraction[t][f].accuracy)),
    (FIELDS.reduce((s, f) => s + p.extraction[t][f].latency, 0) / FIELDS.length).toFixed(1) + " ms",
  ]),
);

const classification = table(
  ["Tier", "Accuracy", "95 % interval", "Latency"],
  TIERS.filter((t) => t !== "human").map((t) => {
    const prof = p.classification[t];
    const r = rate(Math.round(prof.accuracy * prof.items), prof.items);
    return [`\`${t}\``, pc(prof.accuracy),
      `[${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}]`,
      prof.latency.toFixed(2) + " ms"];
  }),
);

const best = optimiseExtraction(p, h);
const routing = best ? table(
  ["Field", "Tier chosen", "Accuracy", "Cost"],
  FIELDS.map((f) => {
    const t = best.routing[f];
    return [f, `\`${t}\``, pc(accuracy(t, p.extraction[t][f].accuracy, h)),
      euro((h.volume / 1000) * pricePerThousand(t, h))];
  }).concat([["**total**", "", `**${pc(best.accuracy)}**`, `**${euro(best.cost)}**`]]),
) : "";

const shadow = (() => {
  const f = budgetShadowPrice(p, h);
  if (!f || !best) return "";
  if (!f.step) return "No budget buys better: the ceiling is in the tiers available.";
  const m = f.step;
  const changed = FIELDS.filter((c) => m.routing[c] !== best.routing[c]);
  return `Budget used: **${euro(f.currentCost)} of ${euro(f.currentBudget)}** — ${pc(best.budgetShare)}. ` +
    `The constraint ${f.constraintBinds ? "**binds**" : "**does not bind**"}.\n\n` +
    `The next real gain is **+${m.gainPoints.toFixed(1)} points of accuracy**, it costs ` +
    `**${euro(m.extra)} more** — ${(m.budgetNeeded / f.currentCost).toFixed(0)}× current spend — ` +
    `and it buys exactly one field: ${changed.map((c) => `\`${c}\``).join(", ")}.`;
})();

const f = await collect();
const gallery = (() => {
  const seen = new Set<string>();
  const six = f.filter((x) => {
    const k = `${x.tier}:${x.field}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);

  const counts = table(["Failures", "Tier · field · what kind of wrong"],
    shape(f).slice(0, 6).map(([k, n]) => [n, k]));

  const examples = six.map((x) =>
    "```\n" + `${x.tier} · ${x.field} · ${x.mode}   [${x.recordId}]\n` +
    `  text      ${x.text}\n` +
    `  expected  ${JSON.stringify(x.expected)}\n` +
    `  got       ${JSON.stringify(x.got)}\n` + "```").join("\n\n");

  return `${f.length} failures across the machine tiers, grouped by what actually went wrong:\n\n${counts}\n\n${examples}`;
})();

/*
 * A percentage without its baseline invites the one question you cannot answer.
 *
 * The keyword classifier scores 24.2 %. Whether that is bad was unanswerable until the
 * trivial baseline was computed: always naming the most common typology scores 25.0 %.
 * The rules are not "worse" in any measurable sense — they are indistinguishable from a
 * constant, which is the more precise and more damning statement.
 */
const alerts = generateAlerts(120, "heldout");
const majority = majorityClass(alerts.map((a) => a.truth));
const uniform = uniformGuess(TYPOLOGIES.length);

const baselines = table(
  ["", "Accuracy", "Verdict"],
  [
    [`${majority.name}`, pc(majority.accuracy), `*${majority.what}*`],
    [`${uniform.name}`, pc(uniform.accuracy), `*${uniform.what}*`],
    ...TIERS.filter((t) => t !== "human").map((t) => [
      `\`${t}\``, pc(p.classification[t].accuracy),
      verdict(p.classification[t].accuracy, majority, p.classification[t].items),
    ]),
  ],
);

/* Where every number on this page came from. Generated, and guarded by a test. */
const provenance = markdown(INVENTORY, table);

emit(new URL("../README.md", import.meta.url).pathname,
  { extraction, classification, routing, shadow, gallery, baselines, provenance });
