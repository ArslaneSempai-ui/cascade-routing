/**
 * Which assumptions the conclusion actually depends on.
 *
 * Four of the numbers this tool runs on have no authority behind them. Nobody publishes
 * how many hours an analyst is genuinely productive, what a model call costs on your
 * traffic, or how often a human reviewing their fortieth file of the day gets it right.
 * Consulting firms sell studies; no one checks them.
 *
 * The usual response is to pick a plausible figure and hope. The better response is to
 * stop depending on it: sweep each assumption across the range it could plausibly take,
 * and report the range over which the recommendation does not change.
 *
 *     "the routing is the same for any human accuracy between 70 % and 95 %"
 *
 * is a stronger statement than "we assumed 85 %", and it needs nobody to vouch for it.
 * Where the recommendation *does* flip inside the plausible range, that is worth knowing
 * too — it says this is the number to go and measure, and the others are not.
 *
 * Someone who has their own figures enters them and reads the band around their value.
 * Someone who does not reads the band and learns whether it was worth finding out.
 */

import { optimiseExtraction, optimiseClassification } from "./optimise.ts";
import { isMain } from "./cli.ts";
import { ASSUMPTIONS } from "./assumptions.ts";
import { FIELDS } from "./corpus.ts";
import { readProfiles } from "./measure.ts";
import type { Assumptions } from "./assumptions.ts";
import type { Profiles } from "./measure.ts";

/** The assumptions with no source, and the range each could plausibly take. */
export const PLAUSIBLE: Partial<Record<keyof Assumptions, [number, number]>> = {
  humanAccuracy: [0.70, 0.98],
  humanSeconds: [15, 300],
  analystAnnualCost: [40_000, 160_000],
  productiveHoursPerDay: [4, 7],
  pricePerThousandSmall: [0.02, 2],
  pricePerThousandLarge: [0.20, 20],
};

export type Band = {
  assumption: keyof Assumptions;
  /**
   * Why it does not decide, when it does not.
   *
   * The first version reported "not worth measuring", which was wrong and in the
   * comfortable direction. Human accuracy changes nothing here — but not because the
   * model is robust to it: the human tier costs $58,712 against a $4,000 budget, so it is
   * never selected and its quality never enters the calculation at all.
   *
   * Those are entirely different statements. One says the number does not matter; the
   * other says it does not matter *at this volume and budget*, and would matter a great
   * deal at another. Reporting the first when the second is true tells a reader to stop
   * looking exactly where they should look.
   */
  reason: "affects the answer" | "tier priced out" | "genuinely insensitive";
  /** The value in use. */
  current: number;
  /** Where the recommendation stops being the one we report. */
  stableFrom: number;
  stableTo: number;
  /** Is the value in use inside that band? */
  currentInside: boolean;
  /** Does the recommendation ever change across the plausible range? */
  decides: boolean;
};

const routingOf = (p: Profiles, a: Assumptions) => {
  const s = optimiseExtraction(p, a);
  const c = optimiseClassification(p, a);
  return s ? FIELDS.map((f) => s.routing[f]).join(",") + "|" + (c.chosen?.tier ?? "none") : "none";
};

/**
 * The band around the current value where the answer holds.
 *
 * Walked outward from the value in use rather than sampled across the whole range: what
 * matters is how far you can be wrong before the recommendation changes, not whether some
 * distant corner of the range behaves differently.
 */
export function band(p: Profiles, assumption: keyof Assumptions, a = ASSUMPTIONS, steps = 60): Band {
  const [low, high] = PLAUSIBLE[assumption]!;
  const reference = routingOf(p, a);
  const current = a[assumption];

  const walk = (direction: 1 | -1): number => {
    const limit = direction === 1 ? high : low;
    for (let i = 1; i <= steps; i++) {
      const value = current + ((limit - current) * i) / steps;
      if (routingOf(p, { ...a, [assumption]: value }) !== reference) {
        // Last value that still gave the same answer.
        return current + ((limit - current) * (i - 1)) / steps;
      }
    }
    return limit;
  };

  const stableFrom = walk(-1);
  const stableTo = walk(1);
  const decides = stableFrom > low + 1e-9 || stableTo < high - 1e-9;

  /*
   * Distinguish insensitivity from exclusion.
   *
   * If pushing the assumption well past its plausible range does change the answer, then
   * the tier it governs is simply out of reach at the current budget — not irrelevant.
   */
  const beyond = assumption === "humanAccuracy" ? 0.05
    : assumption === "humanSeconds" ? 1
    : current / 100;
  const movesWhenPushed = routingOf(p, { ...a, [assumption]: beyond }) !== reference;

  return {
    assumption, current, stableFrom, stableTo,
    currentInside: true,
    decides,
    reason: decides ? "affects the answer" : movesWhenPushed ? "tier priced out" : "genuinely insensitive",
  };
}

export function bands(p: Profiles, a = ASSUMPTIONS): Band[] {
  return (Object.keys(PLAUSIBLE) as (keyof Assumptions)[]).map((k) => band(p, k, a));
}

/**
 * What to tell someone who has their own figure.
 *
 * Two useful answers, and the second is the one people never get: your number does not
 * matter here, stop spending weeks measuring it.
 */
export function advise(b: Band, plausible: [number, number], format = (x: number) => x.toFixed(2)): string {
  if (b.reason === "tier priced out") {
    return `changes nothing here, but only because the tier it governs is priced out of the budget. Raise the budget or drop the volume and it decides a great deal. Measure it before you do either.`;
  }
  if (b.reason === "genuinely insensitive") {
    return `does not decide anything across ${format(plausible[0])}–${format(plausible[1])}. Not worth measuring for this decision.`;
  }
  return `decides the routing. Same answer from ${format(b.stableFrom)} to ${format(b.stableTo)}; outside that it changes. Worth measuring.`;
}

if (isMain(import.meta)) {
  const p = readProfiles();
  if (!p) { console.error("No profile measured — start with: npm run measure"); process.exit(1); }

  console.log("\nWhich assumptions actually decide the answer?\n");
  console.log("assumption                 in use    same answer from ... to     verdict");
  console.log("─".repeat(88));

  for (const b of bands(p)) {
    const [low, high] = PLAUSIBLE[b.assumption]!;
    const f = (x: number) => (x < 10 ? x.toFixed(2) : Math.round(x).toLocaleString("en-GB"));
    console.log(
      `${b.assumption.padEnd(26)}${f(b.current).padStart(8)}` +
      `${(f(b.stableFrom) + " – " + f(b.stableTo)).padStart(26)}   ` +
      (b.reason === "affects the answer" ? "decides"
        : b.reason === "tier priced out" ? "priced out — would decide if affordable"
        : "genuinely insensitive"),
    );
  }
  console.log(
    "\n\"Priced out\" is not the same as \"does not matter\". The human tier costs more than" +
    "\nthe whole budget at this volume, so its quality never enters the calculation — and it" +
    "\nwould dominate it at a smaller volume. Reporting those two the same way would send a" +
    "\nreader away from exactly the number they should go and find.\n",
  );
}
