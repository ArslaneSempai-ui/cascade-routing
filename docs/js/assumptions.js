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
export const ASSUMPTIONS = {
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
export const STATUSES = {
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
export const BOUNDS = {
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
export function pricePerThousand(tier, h) {
    if (tier === "rules")
        return 0;
    if (tier === "small")
        return h.pricePerThousandSmall;
    if (tier === "large")
        return h.pricePerThousandLarge;
    const coutHeure = h.analystAnnualCost / (h.productiveHoursPerDay * h.workingDaysPerYear);
    return (h.humanSeconds / 3600) * coutHeure * 1000;
}
/**
 * A tier's accuracy on a given item.
 *
 * The three machine tiers return their measured figure. The human returns the assumption —
 * and this is the only line in the project where a displayed value is not a measurement.
 */
export function accuracy(tier, mesuree, h) {
    return tier === "human" ? h.humanAccuracy : mesuree;
}
/** Milliseconds per item: measured for the models, assumed for the human. */
export function latency(tier, mesuree, h) {
    return tier === "human" ? h.humanSeconds * 1000 : mesuree;
}
