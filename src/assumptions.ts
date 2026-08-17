/**
 * What is not measured.
 *
 * The profile file holds only what was actually run: the accuracy and latency of the
 * rules, the small model and the large one. Everything else lives here, and that
 * separation is the most important thing in this project.
 *
 * ─── The human ───
 *
 * The first version had the human tier return ground truth: 100 % accuracy, by
 * construction. That was a lie with direct consequences — an optimiser that believes the
 * human is infallible routes everything to them, and the conclusion goes wrong in the
 * direction that costs the most.
 *
 * I have no humans to hand. Their accuracy is therefore not measurable here and cannot
 * appear in a table of measurements: it is an **assumption**, it is arguable, and it is
 * set below 100 % because an analyst on their fortieth alert of the day is not at 100 %.
 *
 * ─── The prices ───
 *
 * No price is measured either. What a model call costs depends on who hosts it; what a
 * minute of analyst time costs depends on the country. Those are assumptions, they are
 * editable, and mixing them into the measurements would pass a tariff off as a fact.
 */

import type { TierName } from "./tiers.ts";

/*
 * The four words for where a number came from now live in `provenance.ts`, shared across
 * every repository here.
 *
 * This file had its own set — `mesure`, `convention`, `postule`, `choisi` — declared and
 * never used anywhere. Four repositories inventing four vocabularies for the same idea is
 * how a portfolio stops reading as one body of work, and an unused vocabulary is worse
 * than none: it looks like a discipline that is being applied.
 *
 * `convention` is folded into `assumed` deliberately. A market convention is still a
 * number the reader has to supply or accept, and the distinction between "a figure people
 * commonly use" and "a figure nobody can know" was doing no work on any page.
 */
export type { Provenance } from "./provenance.ts";
import type { Provenance } from "./provenance.ts";

export type Assumptions = {
  /**
   * How often a human review of one item is right.
   *
   * Assumed. Inter-rater agreement studies on document review put this between 0.85 and
   * 0.95 depending on fatigue and complexity; I take the low end, because a batch sent to
   * a human is by construction the one the earlier tiers found difficult.
   */
  humanAccuracy: number;
  /** Seconds a human spends on one item. Assumed. */
  humanSeconds: number;
  /** Loaded annual cost of an analyst. Assumed — yours will differ. */
  analystAnnualCost: number;
  /** Hours genuinely productive per day. Assumed, and never eight. */
  productiveHoursPerDay: number;
  workingDaysPerYear: number;
  /** Cost per thousand calls to the small model. Assumed. */
  pricePerThousandSmall: number;
  /** Cost per thousand calls to the large model. Assumed, and it moves fastest. */
  pricePerThousandLarge: number;
  /** Items to process over the period. Assumed — this is your scenario, not mine. */
  volume: number;
  /** Money available over the period. Assumed, and it decides which tiers are reachable. */
  budget: number;
};

export const ASSUMPTIONS: Assumptions = {
  humanAccuracy: 0.85,
  humanSeconds: 45,
  analystAnnualCost: 62_000,
  productiveHoursPerDay: 6,
  workingDaysPerYear: 220,
  pricePerThousandSmall: 0.20,
  pricePerThousandLarge: 1.60,
  volume: 100_000,
  budget: 4_000,
};

/**
 * Where each assumption came from, in the shared vocabulary.
 *
 * All nine are `assumed`, and that is the honest answer: every one is an input a reader
 * substitutes their own figure for, and every one is swept so the page can say whether
 * their figure changes anything. `volume` and `budget` were labelled "chosen" here, which
 * was wrong — they are the scenario, and the scenario belongs to whoever is reading.
 */
export const STATUSES: Record<keyof Assumptions, Provenance> = {
  humanAccuracy: "assumed",
  humanSeconds: "assumed",
  analystAnnualCost: "assumed",
  productiveHoursPerDay: "assumed",
  workingDaysPerYear: "assumed",
  pricePerThousandSmall: "assumed",
  pricePerThousandLarge: "assumed",
  volume: "assumed",
  budget: "assumed",
};

/** Sanity bounds: a screen that accepts 100 % human accuracy is lying to its reader. */
export const BOUNDS: Record<keyof Assumptions, [number, number]> = {
  humanAccuracy: [0.5, 0.99],
  humanSeconds: [5, 1800],
  analystAnnualCost: [20_000, 200_000],
  productiveHoursPerDay: [1, 8],
  workingDaysPerYear: [180, 260],
  pricePerThousandSmall: [0, 50],
  pricePerThousandLarge: [0, 200],
  volume: [1_000, 10_000_000],
  budget: [0, 10_000_000],
};

/** What a thousand items cost at this tier. */
export function pricePerThousand(tier: TierName, h: Assumptions): number {
  if (tier === "rules") return 0;
  if (tier === "small") return h.pricePerThousandSmall;
  if (tier === "large") return h.pricePerThousandLarge;
  const coutHeure = h.analystAnnualCost / (h.productiveHoursPerDay * h.workingDaysPerYear);
  return (h.humanSeconds / 3600) * coutHeure * 1000;
}

/**
 * La accuracy d'un étage sur un item donné.
 *
 * Les trois premiers étages rendent leur chiffre mesuré. L'human rend l'hypothèse — et
 * c'est la seule ligne de tout le projet où une valeur affichée ne vient pas d'une mesure.
 */
export function accuracy(tier: TierName, mesuree: number, h: Assumptions): number {
  return tier === "human" ? h.humanAccuracy : mesuree;
}

/** Millisecondes par item : mesurées pour les modèles, postulées pour l'human. */
export function latency(tier: TierName, mesuree: number, h: Assumptions): number {
  return tier === "human" ? h.humanSeconds * 1000 : mesuree;
}
