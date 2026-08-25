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
export const UNITS = {
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
/**
 * Le symbole d'une unité monétaire, POUR L'AFFICHAGE — et le seul endroit du dépôt où le
 * couple « usd → $ » est écrit.
 *
 * `UNITS` dit `usd`, un lecteur veut voir `$`. Cette traduction devait bien exister quelque
 * part ; elle existait dans onze chaînes de rendu réparties sur trois fichiers, chacune tapée
 * de mémoire. Deux d'entre elles s'étaient trompées de devise — `escalade.ts` affichait des
 * euros, `premiere-reponse.mjs` aussi — et les neuf autres avaient raison par chance.
 *
 * Onze copies d'une même affirmation, ce n'est pas onze fois plus sûr : c'est onze occasions
 * de diverger, et deux avaient déjà divergé. Ici il n'y en a qu'une, et elle REFUSE ce
 * qu'elle ne connaît pas plutôt que de rendre un symbole faux — le jour où le corpus se
 * libelle en euros, ce refus est ce qui empêche de publier des dollars.
 */
export function symboleDe(unite) {
    const code = unite.split("/")[0].toLowerCase();
    const table = { usd: "$", eur: "\u20ac", gbp: "\u00a3" };
    const s = table[code];
    if (!s) {
        throw new Error(`no symbol known for currency "${code}" (unit "${unite}").\n\n`
            + "  Add it to symboleDe(), in assumptions.ts. Do not type it at the rendering site:\n"
            + "  that is how this repository came to publish the same figure in euros and in\n"
            + "  dollars depending on which page you read.");
    }
    return s;
}
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
export function pricePerThousandExtractions(tier, h, latenceMesuree) {
    if (tier === "rules")
        return 0;
    if (tier === "small")
        return h.pricePerThousandSmall;
    if (tier === "large")
        return h.pricePerThousandLarge;
    if (estGeneratif(tier)) {
        if (latenceMesuree === undefined) {
            throw new Error(`tier ${tier} is priced by machine time: its measured latency is required`);
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
