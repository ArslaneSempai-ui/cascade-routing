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

import { optimiseExtraction, optimiseClassification, paliersMesures, pricePerThousandDocuments, justessePonderee } from "./optimise.ts";
import { isMain } from "./cli.ts";
import { ASSUMPTIONS, accuracy, latency } from "./assumptions.ts";
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
  workingDaysPerYear: [200, 250],
  pricePerThousandSmall: [0.02, 2],
  pricePerThousandLarge: [0.20, 20],
  /*
   * Le tarif horaire machine, qui manquait — et son absence était le pire des cas.
   *
   * Il tarife les trois paliers génératifs, dont `gen-4b`, que le routage retenu **utilise**
   * sur l'adresse. Un balayage qui saute une hypothèse dont dépend un palier sélectionné ne
   * se contente pas d'être incomplet : il rend un verdict rassurant sur un jeu amputé, ce qui
   * est pire que pas de balayage du tout.
   *
   * La plage va du portable à la machine louée, un facteur dix de part et d'autre. Le routage
   * tient sur toute cette plage — il ne bascule qu'à 139,60 $ l'heure, cent seize fois la
   * valeur en usage — mais ça, il fallait le mesurer pour le dire.
   */
  machineHourlyCost: [0.10, 12],
  /*
   * Les deux coûts d'erreur, balayés comme les prix — parce qu'ils décident comme eux.
   *
   * La plage va de l'égalité (un faux ne coûte pas plus qu'un vide) à cent fois, ce qui
   * couvre largement ce qu'une conformité met derrière une donnée fausse entrée au dossier.
   */
  costWrongValue: [0.587, 60],
  costBlankField: [0.05, 6],
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
   *
   * A fourth case was missing, and it was reported as the comfortable one. The small
   * model's price changes nothing — not because the answer is robust to it, and not
   * because the tier is out of budget: it costs $100 against $4,000. It is simply in no
   * field of the routing, because it is not accurate enough anywhere. Its price never
   * enters the calculation for a reason that has nothing to do with price, and calling
   * that "genuinely insensitive" is the same omission this comment was written to prevent.
   *
   * So the question is never "does the number move the answer" alone. It is: is the tier
   * this assumption governs actually in use, and if not, is it excluded by the budget or
   * on merit? Three different answers, three different things for a reader to do.
   */
  reason: "affects the answer" | "tier priced out" | "tier not selected" | "genuinely insensitive";
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
   * Insensitivity, exclusion by budget, and exclusion on merit.
   *
   * Which tiers this assumption governs is derived rather than listed: a tier is governed
   * when perturbing the assumption changes what the optimiser pays for it, or what it
   * believes about its accuracy or its speed. A list would drift; this cannot.
   */
  /*
   * « Gouverner » un palier, c'est déplacer n'importe laquelle de ses trois entrées.
   *
   * La règle a d'abord dit « tarifer », puis « tarifer ou changer l'exactitude nue ou la
   * latence ». Les deux coûts d'erreur échappaient encore aux trois : ils ne tarifent rien et
   * ne touchent pas l'exactitude *nue*, ils pèsent la **justesse pondérée**. `landing.ts` a
   * reçu la règle élargie et ce fichier non, si bien que les deux ont classé le coût d'un
   * champ vide de deux façons incompatibles — « palier jamais choisi » ici, « vraie
   * robustesse » là-bas — alors que `rules` produit les vides et tient trois champs du
   * routage. Le test d'accord entre les deux fichiers l'a vu ; c'est la deuxième fois que
   * cette règle diverge, et la seconde fois de ma main.
   */
  const perturbee = { ...a, [assumption]: current * 2 };
  const gouvernes = paliersMesures(p).filter((t) =>
    pricePerThousandDocuments(p, perturbee, t) !== pricePerThousandDocuments(p, a, t)
    || FIELDS.some((c) => justessePonderee(p, perturbee, t, c) !== justessePonderee(p, a, t, c))
    || FIELDS.some((c) => latency(t, p.extraction[t][c].latency, perturbee) !== latency(t, p.extraction[t][c].latency, a)));

  const retenus = new Set(optimiseExtraction(p, a) ? FIELDS.map((f) => optimiseExtraction(p, a)!.routing[f]) : []);
  const enUsage = gouvernes.some((t) => retenus.has(t));
  /* Hors budget : le palier coûterait plus que l'enveloppe entière à ce volume. */
  const horsBudget = gouvernes.length > 0 && gouvernes.every((t) =>
    (pricePerThousandDocuments(p, a, t) * a.volume) / 1000 > a.budget);

  const reason: Band["reason"] = decides ? "affects the answer"
    : enUsage ? "genuinely insensitive"
    : horsBudget ? "tier priced out"
    : "tier not selected";

  return { assumption, current, stableFrom, stableTo, currentInside: true, decides, reason };
}

export function bands(p: Profiles, a = ASSUMPTIONS, steps = 60): Band[] {
  return (Object.keys(PLAUSIBLE) as (keyof Assumptions)[]).map((k) => band(p, k, a, steps));
}

/**
 * What to tell someone who has their own figure.
 *
 * Two useful answers, and the second is the one people never get: your number does not
 * matter here, stop spending weeks measuring it.
 */
export function advise(b: Band, plausible: [number, number], format = (x: number) => x.toFixed(2)): string {
  /*
   * Un `switch` exhaustif, et pas une suite de `if` finissant par un repli.
   *
   * La version précédente testait deux cas et rendait le troisième pour tout le reste. Quand
   * une quatrième valeur est apparue, le calcul l'a produite correctement et l'affichage l'a
   * écrasée en « genuinely insensitive » — la donnée était juste et la page mentait. Un repli
   * implicite transforme une valeur inconnue en la valeur la plus rassurante, ce qui est la
   * pire des directions par défaut.
   *
   * Écrit ainsi, l'ajout d'une cinquième valeur ne compilera plus tant que sa phrase n'aura
   * pas été écrite.
   */
  switch (b.reason) {
    case "affects the answer":
      return `decides the routing. Same answer from ${format(b.stableFrom)} to ${format(b.stableTo)}; outside that it changes. Worth measuring.`;
    case "tier priced out":
      return `changes nothing here, but only because the tier it governs is priced out of the budget. Raise the budget or drop the volume and it decides a great deal. Measure it before you do either.`;
    case "tier not selected":
      return `changes nothing here, and not because the answer is robust to it: the tier it governs is in no field of the routing at all, so its price never enters the calculation. Measuring it would tell you nothing until that tier becomes accurate enough to be chosen somewhere.`;
    case "genuinely insensitive":
      return `does not decide anything across ${format(plausible[0])}–${format(plausible[1])}, and the tier it governs IS in use. This one is real robustness. Not worth measuring for this decision.`;
  }
}

/** Une étiquette par verdict. `Record` complet : un verdict ajouté ne compile pas sans la sienne. */
export const ETIQUETTE: Record<Band["reason"], string> = {
  "affects the answer": "decides",
  "tier priced out": "priced out — would decide if affordable",
  "tier not selected": "tier never chosen — its price is irrelevant",
  "genuinely insensitive": "genuinely insensitive",
};

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
      ETIQUETTE[b.reason],
    );
  }
  console.log(
    "\nThree ways of changing nothing, and only one of them is robustness. The human tier" +
    "\ncosts more than the whole budget at this volume, so its quality never enters the" +
    "\ncalculation — that is exclusion by price. The small model is affordable and simply" +
    "\nnever chosen — that is exclusion on merit. Neither is a reason to stop looking.\n" +
    "\n\"Priced out\" is not the same as \"does not matter\". The human tier costs more than" +
    "\nthe whole budget at this volume, so its quality never enters the calculation — and it" +
    "\nwould dominate it at a smaller volume. Reporting those two the same way would send a" +
    "\nreader away from exactly the number they should go and find.\n",
  );
}
