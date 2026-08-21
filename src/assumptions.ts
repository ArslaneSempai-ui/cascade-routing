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

import type { TierName } from "./paliers.ts";
import { estGeneratif } from "./paliers.ts";

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
  /**
   * What an hour of the machine running a local model costs.
   *
   * Assumed, and it is the only honest way to price a tier nobody invoices you for. A model
   * on your own silicon has no tariff: it occupies a machine, and what that machine costs
   * per hour is a figure your infrastructure bill knows and this file cannot. Amortised
   * hardware, electricity and whatever the box would otherwise be doing.
   *
   * The consequence is the interesting part. A local tier's cost is its measured latency
   * multiplied by this rate, so the 8B model is dearer than the 4B for exactly one reason:
   * it is slower. Nothing else about it costs more.
   */
  machineHourlyCost: number;
  /** Items to process over the period. Assumed — this is your scenario, not mine. */
  volume: number;
  /** Money available over the period. Assumed, and it decides which tiers are reachable. */
  budget: number;
  /**
   * Milliseconds allowed for one whole document, end to end.
   *
   * The README listed this as the thing it would do differently: latency was recorded and
   * played no part in the routing, so the optimiser would happily send a real-time field to
   * the slowest tier. On the encoder ladder that was harmless — five fields summed to about
   * fifty milliseconds. A generative tier costs a second a field, so five fields is five
   * seconds, and the constraint stops being decorative.
   *
   * It is a budget in time, sitting beside the budget in money, and it binds independently:
   * a routing can be affordable and too slow, or fast and unaffordable.
   */
  latencyBudgetMs: number;
  /**
   * Ce que coûte une valeur fausse entrée au dossier sans que rien ne la signale.
   *
   * Un palier se trompe de deux façons et elles ne coûtent pas la même chose. Une expression
   * régulière qui ne trouve pas rend le vide : l'échec est visible, il part en relecture, et
   * il finit corrigé. Un modèle rend toujours une réponse : il ne s'abstient jamais, donc son
   * échec entre au dossier avec l'apparence d'une donnée.
   *
   * L'optimiseur les comptait à l'identique, ce qui n'est pas neutre — c'est un arbitrage
   * implicite en faveur des paliers qui répondent toujours. Le rendre explicite ne le tranche
   * pas : la valeur en usage laisse les deux à égalité, donc le routage publié ne bouge pas,
   * et le balayage dit à quel prix il basculerait.
   */
  costWrongValue: number;
  /** Ce que coûte un champ rendu vide : une relecture d'analyste, et rien de plus. */
  costBlankField: number;
};

export const ASSUMPTIONS: Assumptions = {
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
  /*
   * À égalité, et c'est le point : la valeur en usage reproduit exactement le comportement
   * d'avant, donc introduire ces deux entrées ne déplace rien. Le chiffre lui-même est le
   * coût d'une relecture — le seul des deux qu'on sache estimer — et l'autre lui est égalé
   * plutôt que deviné.
   */
  costWrongValue: 0.587,
  costBlankField: 0.587,
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
  machineHourlyCost: "assumed",
  volume: "assumed",
  budget: "assumed",
  latencyBudgetMs: "assumed",
  costWrongValue: "assumed",
  costBlankField: "assumed",
};

/**
 * L'unité de chaque hypothèse, parce qu'un nombre nu se fait attribuer la mauvaise.
 *
 * `landing.json` publiait ces valeurs sans leur unité. La page qui les consomme a fait la
 * seule chose qu'un rendu puisse faire dans ce cas : elle a deviné, et elle a mis un signe
 * dollar partout — « humanSeconds $45.00 », « workingDaysPerYear $220.00 ». Un analyste
 * coûtant quarante-cinq dollars la seconde est un chiffre inventé, arrivé par un chemin que
 * personne ne surveillait, à partir de données exactes.
 *
 * C'est le même défaut que le repli d'affichage de `sensitivity.ts` : une donnée qui ne porte
 * pas sa propre nature force son lecteur à la reconstituer, et une reconstitution est une
 * supposition. Déduire l'unité du nom de la clé marche jusqu'au jour où une clé est renommée,
 * et ce jour-là rien ne tombe — l'affichage se contente de mentir.
 *
 * Écrit ici plutôt qu'ailleurs pour la même raison que `BOUNDS` et `STATUSES` : à côté de la
 * définition, dans un `Record` complet, donc une hypothèse ajoutée demain ne compilera pas
 * tant que son unité n'aura pas été écrite.
 *
 * Les unités sont composées et non des jetons — « usd/1000 extractions » et non « usd ». Le
 * dénominateur est la moitié qui a déjà fait publier un chiffre faux d'un facteur cinq.
 */
export const UNITS: Record<keyof Assumptions, string> = {
  humanAccuracy: "correct fields/field",
  humanSeconds: "seconds/item",
  analystAnnualCost: "usd/year",
  productiveHoursPerDay: "hours/day",
  workingDaysPerYear: "days/year",
  pricePerThousandSmall: "usd/1000 extractions",
  pricePerThousandLarge: "usd/1000 extractions",
  machineHourlyCost: "usd/hour",
  volume: "documents/period",
  budget: "usd/period",
  latencyBudgetMs: "ms/document",
  costWrongValue: "usd/wrong value",
  costBlankField: "usd/blank field",
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
  machineHourlyCost: [0, 100],
  volume: [1_000, 10_000_000],
  budget: [0, 10_000_000],
  latencyBudgetMs: [10, 600_000],
  costWrongValue: [0, 10_000],
  costBlankField: [0, 10_000],
};

/**
 * Ce que mille **extractions de champ** coûtent à ce palier — jamais mille documents.
 *
 * L'unité est dans le nom parce qu'elle a déjà fait publier un chiffre faux. Un document
 * porte cinq champs : le lire coûte cinq appels à cette fonction, et une page qui affiche
 * ce résultat sous l'étiquette « par millier de documents » se trompe d'un facteur cinq,
 * dans le sens qui fait paraître la chaîne moins chère qu'elle n'est.
 *
 * Le prix d'un document est `pricePerThousandDocuments` dans `optimise.ts`, et il vit
 * là-bas parce qu'il ne peut pas se calculer ici : sur un palier local le tarif dépend de
 * la latence du champ, donc le coût d'un document est une somme sur les cinq champs
 * mesurés, pas une multiplication par cinq.
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
export function pricePerThousandExtractions(tier: TierName, h: Assumptions, latenceMesuree?: number): number {
  if (tier === "rules") return 0;
  if (tier === "small") return h.pricePerThousandSmall;
  if (tier === "large") return h.pricePerThousandLarge;
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
export function accuracy(tier: TierName, mesuree: number, h: Assumptions): number {
  return tier === "human" ? h.humanAccuracy : mesuree;
}

/** Milliseconds per item: measured for the models, assumed for the human. */
export function latency(tier: TierName, mesuree: number, h: Assumptions): number {
  return tier === "human" ? h.humanSeconds * 1000 : mesuree;
}
