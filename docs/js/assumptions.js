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
import { estGeneratif } from "./paliers.js";
export const ASSUMPTIONS = {
    humanAccuracy: 0.85,
    humanSeconds: 45,
    analystAnnualCost: 62_000,
    productiveHoursPerDay: 6,
    workingDaysPerYear: 220,
    pricePerThousandSmall: 0.20,
    pricePerThousandLarge: 1.60,
    machineHourlyCost: 1.20,
    volume: 100_000,
    budget: 4_000,
    latencyBudgetMs: 2_000,
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
    machineHourlyCost: "assumed",
    volume: "assumed",
    budget: "assumed",
    latencyBudgetMs: "assumed",
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
    machineHourlyCost: [0, 100],
    volume: [1_000, 10_000_000],
    budget: [0, 10_000_000],
    latencyBudgetMs: [10, 600_000],
};
/**
 * Ce que mille éléments coûtent à ce palier.
 *
 * Trois régimes de facturation différents, et c'est le fond du sujet. Les règles ne coûtent
 * rien. Les modèles hébergés coûtent un tarif à l'appel, indépendant du temps qu'ils
 * prennent. Les modèles locaux et l'humain coûtent du **temps** : leur prix est leur durée
 * multipliée par ce que vaut l'heure de qui la passe — une machine ou une personne.
 *
 * Un palier local a donc besoin de sa latence mesurée pour être facturé, ce qu'aucun des
 * autres n'exigeait. C'est la raison de l'argument `latenceMesuree`, et son absence sur un
 * palier local est une erreur et non un défaut à zéro : facturer gratuitement un modèle qui
 * occupe la machine est exactement le biais que cet outil existe pour retirer.
 */
export function pricePerThousand(tier, h, latenceMesuree) {
    if (tier === "rules")
        return 0;
    if (tier === "small")
        return h.pricePerThousandSmall;
    if (tier === "large")
        return h.pricePerThousandLarge;
    if (estGeneratif(tier)) {
        if (latenceMesuree === undefined) {
            throw new Error(`le palier ${tier} se facture au temps machine : sa latence mesurée est requise`);
        }
        return (latenceMesuree / 3_600_000) * h.machineHourlyCost * 1000;
    }
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
