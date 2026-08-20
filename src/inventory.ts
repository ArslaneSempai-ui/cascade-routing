/**
 * Every number this tool puts on a page, and where it came from.
 *
 * The accuracy figures here are the strongest measurements in the portfolio and the ones
 * most easily misread. They are **measured**: real models, pinned by revision, run over a
 * held-out split, and a stranger who runs `npm run measure` gets the same table. What they
 * are measured on is a corpus I wrote — and the whole reason the held-out split exists is
 * that the first version of this measurement scored the rules at 100 % because I had
 * written the regexes against my own templates.
 *
 * So the corpus is `chosen`, and it is the load-bearing chosen thing here. The split
 * defends against the worst version of that problem — marking your own homework — and does
 * not turn a corpus I invented into documents a bank would send.
 *
 * What survives is exact: **the method is the finding, the accuracies are illustration.**
 * That a small model can carry some fields and not others, that the cheap tier's ceiling is
 * a property of the field and not of the budget, that routing per field beats routing per
 * document — that holds for any corpus with the same structure. That birth dates reach
 * 100 % on the small model holds for mine.
 */

import { ASSUMPTIONS, STATUSES } from "./assumptions.ts";
import { PLAUSIBLE } from "./sensitivity.ts";
import { FIELDS } from "./corpus.ts";
import { TIERS, REVISIONS } from "./tiers.ts";
import type { Inventory } from "./provenance.ts";

const WHAT: Record<keyof typeof ASSUMPTIONS, { what: string; note: string }> = {
  latencyBudgetMs: {
    what: "milliseconds allowed for one whole document, end to end",
    note: "your service level agreement knows this exactly; it binds independently of the money",
  },
  machineHourlyCost: {
    what: "what an hour of the machine running a local model costs you",
    note: "a local model has no tariff — it occupies a box, and your infrastructure bill knows what that costs",
  },
  humanAccuracy: {
    what: "how often a human reviewing their fortieth file of the day gets it right",
    note: "moved here from being infallible by construction, which made the human tier unbeatable",
  },
  humanSeconds: { what: "seconds a human spends on one item", note: "your own handling times" },
  analystAnnualCost: { what: "loaded annual cost of an analyst", note: "your finance team knows this exactly" },
  productiveHoursPerDay: { what: "hours genuinely productive per day", note: "never eight; weeks of work to establish" },
  workingDaysPerYear: { what: "working days in your calendar", note: "your HR calendar knows this exactly" },
  pricePerThousandSmall: { what: "cost per thousand calls to the small model", note: "your provider's price list, on your traffic" },
  pricePerThousandLarge: { what: "cost per thousand calls to the large model", note: "same, and it moves faster than any other figure here" },
  volume: { what: "items to process over the period", note: "your scenario, not mine" },
  budget: { what: "money available over the period", note: "your scenario; it decides which tiers are reachable at all" },
  costWrongValue: { what: "what a false value entering the record costs you", note: "your risk function knows this; it is the number a regulator asks about" },
  costBlankField: { what: "what a blank field costs you", note: "one analyst review — the only one of the two anybody can price from a timesheet" },
};

export const INVENTORY: Inventory = [
  {
    name: "CHARGE_MAX_PAR_COEUR",
    provenance: "chosen",
    what: "the external load per core above which a duration is not recorded",
    note: "0.5 because it felt right, not because anything was weighed — and it decides whether a pass keeps its own timings or the previous ones. It is compared to `externalBefore`, the load the machine carried before the tier started, never to `totalDuring`: an encoder saturates the cores by doing its job, and comparing that would refuse every measurement",
  },
  {
    name: "CONFIANCE",
    provenance: "chosen",
    what: "the confidence level every interval and every tie is decided at",
    note: "95 % because that is wilson()'s default, not because anyone weighed it — and it decides which findings survive",
  },
  /* ── measured ── */
  {
    name: "profiles",
    provenance: "measured",
    what: "per-field accuracy and latency for each tier",
    note: "real models pinned by revision, scored on a held-out split, on the chosen corpus below",
  },
  {
    name: "routing",
    provenance: "measured",
    what: "the cheapest assignment of tiers to fields that fits the budget",
    note: "exhaustive over all 1,024 combinations — no heuristic, nothing to tune",
  },
  {
    name: "shadowPrice",
    provenance: "measured",
    what: "the smallest budget increase that actually buys a better routing",
    note: "a step, not a slope: differentiating a staircase says the next euro buys nothing",
  },
  {
    name: "REVISIONS",
    provenance: "measured",
    what: "the exact model revisions the figures were produced with",
    note: "pinned, so a stranger reproduces the table rather than a different one",
  },

  /* ── assumed ── */
  ...(Object.keys(ASSUMPTIONS) as (keyof typeof ASSUMPTIONS)[]).map((k) => ({
    name: k,
    provenance: STATUSES[k],
    what: WHAT[k].what,
    note: WHAT[k].note,
  })),

  /* ── chosen ── */
  {
    name: "corpus",
    provenance: "chosen",
    what: "the synthetic documents the models are scored on, and their ground truth",
    note: "the first measurement scored rules at 100 % because I wrote the regexes against my own templates",
  },
  {
    name: "TRAINING / HELDOUT",
    provenance: "chosen",
    what: "which phrasings the rules may see and which they are scored on",
    note: "the defence against marking my own homework; a test fails if the two share a shape",
  },
  {
    name: "FIELDS",
    provenance: "chosen",
    what: `the ${FIELDS.length} fields extracted from each document`,
    note: "a real onboarding form has more, and more of them ambiguous",
  },
  {
    name: "TIERS",
    provenance: "chosen",
    what: `the ${TIERS.length} tiers a field may be routed to`,
    note: "more tiers make the routing finer and the optimisation no harder",
  },
];

export const MUST_DECLARE = {
  assumptions: Object.keys(ASSUMPTIONS),
  swept: Object.keys(PLAUSIBLE),
  revisions: Object.keys(REVISIONS),
};
