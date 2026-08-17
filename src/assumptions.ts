/**
 * Ce qui n'est pas mesuré.
 *
 * Le fichier des profils ne contient que ce qu'on a fait tourner : la accuracy et la
 * latency des règles, du small modèle et du gros. Tout le reste vit ici, et la séparation
 * est le point le plus important de ce projet.
 *
 * ─── L'human ───
 *
 * La première version faisait rendre la vérité terrain à l'étage human : 100 % de
 * accuracy, par construction. C'était un mensonge aux conséquences directes — un
 * optimiseur qui croit l'human infaillible lui envoie tout, et la conclusion devient
 * fausse dans le sens qui coûte le plus cher.
 *
 * Je n'ai pas d'humains sous la main. Leur accuracy n'est donc pas mesurable ici et ne
 * peut pas figurer dans un relevé de mesures : c'est une **hypothèse**, elle se discute,
 * et elle est posée en dessous de 100 % parce qu'un analyste à sa quarantième alerte de
 * la journée n'est pas à 100 %.
 *
 * ─── Les prix ───
 *
 * Aucun prix n'est mesuré non plus. Le coût d'un appel de modèle dépend de qui l'héberge,
 * le coût d'une minute d'analyste dépend du country. Ce sont des hypothèses, elles sont
 * modifiables à l'écran, et les confondre avec les mesures ferait passer un tarif pour
 * un fait.
 */

import type { TierName } from "./tiers.ts";

/** D'où vient un chiffre. Rien à l'écran ne doit apparaître sans son statut. */
export type Status = "mesure" | "convention" | "postule" | "choisi";

export type Assumptions = {
  /**
   * Justesse d'un examen human, par item.
   *
   * POSTULÉ. Les études d'accord inter-évaluateurs sur de la revue documentaire situent
   * ce chiffre entre 0,85 et 0,95 selon la fatigue et la complexité ; je retiens le low
   * de la fourchette, parce qu'un jeu envoyé à un human est par construction celui que
   * les étages précédents ont trouvé difficile.
   */
  humanAccuracy: number;
  /** Secondes qu'un human passe sur un item. POSTULÉ. */
  humanSeconds: number;
  /** Coût annuel chargé d'un analyste. CONVENTION de place, ajustable. */
  analystAnnualCost: number;
  /** Heures réellement productives par jour. CONVENTION — jamais huit. */
  productiveHoursPerDay: number;
  workingDaysPerYear: number;
  /** Coût pour mille appels au small modèle, en euros. POSTULÉ. */
  pricePerThousandSmall: number;
  /** Coût pour mille appels au gros modèle. POSTULÉ. */
  pricePerThousandLarge: number;
  /** Volume d'items à traiter sur la période. CHOISI. */
  volume: number;
  /** Budget disponible pour la période, en euros. CHOISI. */
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

/** Le statut de chaque hypothèse, affiché à côté d'elle. */
export const STATUSES: Record<keyof Assumptions, Status> = {
  humanAccuracy: "postule",
  humanSeconds: "postule",
  analystAnnualCost: "convention",
  productiveHoursPerDay: "convention",
  workingDaysPerYear: "convention",
  pricePerThousandSmall: "postule",
  pricePerThousandLarge: "postule",
  volume: "choisi",
  budget: "choisi",
};

/** Bornes de bon sens : un écran qui accepte 100 % de accuracy humaine ment à son lecteur. */
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

/** Le coût d'un millier d'items à cet étage, en euros. */
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
