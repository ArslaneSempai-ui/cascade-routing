/**
 * Ce qui n'est pas mesuré.
 *
 * Le fichier des profils ne contient que ce qu'on a fait tourner : la justesse et la
 * latence des règles, du petit modèle et du gros. Tout le reste vit ici, et la séparation
 * est le point le plus important de ce projet.
 *
 * ─── L'humain ───
 *
 * La première version faisait rendre la vérité terrain à l'étage humain : 100 % de
 * justesse, par construction. C'était un mensonge aux conséquences directes — un
 * optimiseur qui croit l'humain infaillible lui envoie tout, et la conclusion devient
 * fausse dans le sens qui coûte le plus cher.
 *
 * Je n'ai pas d'humains sous la main. Leur justesse n'est donc pas mesurable ici et ne
 * peut pas figurer dans un relevé de mesures : c'est une **hypothèse**, elle se discute,
 * et elle est posée en dessous de 100 % parce qu'un analyste à sa quarantième alerte de
 * la journée n'est pas à 100 %.
 *
 * ─── Les prix ───
 *
 * Aucun prix n'est mesuré non plus. Le coût d'un appel de modèle dépend de qui l'héberge,
 * le coût d'une minute d'analyste dépend du pays. Ce sont des hypothèses, elles sont
 * modifiables à l'écran, et les confondre avec les mesures ferait passer un tarif pour
 * un fait.
 */

import type { NomEtage } from "./etages.ts";

/** D'où vient un chiffre. Rien à l'écran ne doit apparaître sans son statut. */
export type Statut = "mesure" | "convention" | "postule" | "choisi";

export type Hypotheses = {
  /**
   * Justesse d'un examen humain, par item.
   *
   * POSTULÉ. Les études d'accord inter-évaluateurs sur de la revue documentaire situent
   * ce chiffre entre 0,85 et 0,95 selon la fatigue et la complexité ; je retiens le bas
   * de la fourchette, parce qu'un jeu envoyé à un humain est par construction celui que
   * les étages précédents ont trouvé difficile.
   */
  justesseHumaine: number;
  /** Secondes qu'un humain passe sur un item. POSTULÉ. */
  secondesHumaines: number;
  /** Coût annuel chargé d'un analyste. CONVENTION de place, ajustable. */
  coutAnnuelAnalyste: number;
  /** Heures réellement productives par jour. CONVENTION — jamais huit. */
  heuresProductivesParJour: number;
  joursTravaillesParAn: number;
  /** Coût pour mille appels au petit modèle, en euros. POSTULÉ. */
  prixMillePetit: number;
  /** Coût pour mille appels au gros modèle. POSTULÉ. */
  prixMilleGrand: number;
  /** Volume d'items à traiter sur la période. CHOISI. */
  volume: number;
  /** Budget disponible pour la période, en euros. CHOISI. */
  budget: number;
};

export const HYPOTHESES: Hypotheses = {
  justesseHumaine: 0.85,
  secondesHumaines: 45,
  coutAnnuelAnalyste: 62_000,
  heuresProductivesParJour: 6,
  joursTravaillesParAn: 220,
  prixMillePetit: 0.20,
  prixMilleGrand: 1.60,
  volume: 100_000,
  budget: 4_000,
};

/** Le statut de chaque hypothèse, affiché à côté d'elle. */
export const STATUTS: Record<keyof Hypotheses, Statut> = {
  justesseHumaine: "postule",
  secondesHumaines: "postule",
  coutAnnuelAnalyste: "convention",
  heuresProductivesParJour: "convention",
  joursTravaillesParAn: "convention",
  prixMillePetit: "postule",
  prixMilleGrand: "postule",
  volume: "choisi",
  budget: "choisi",
};

/** Bornes de bon sens : un écran qui accepte 100 % de justesse humaine ment à son lecteur. */
export const BORNES: Record<keyof Hypotheses, [number, number]> = {
  justesseHumaine: [0.5, 0.99],
  secondesHumaines: [5, 1800],
  coutAnnuelAnalyste: [20_000, 200_000],
  heuresProductivesParJour: [1, 8],
  joursTravaillesParAn: [180, 260],
  prixMillePetit: [0, 50],
  prixMilleGrand: [0, 200],
  volume: [1_000, 10_000_000],
  budget: [0, 10_000_000],
};

/** Le coût d'un millier d'items à cet étage, en euros. */
export function prixMille(etage: NomEtage, h: Hypotheses): number {
  if (etage === "regles") return 0;
  if (etage === "petit") return h.prixMillePetit;
  if (etage === "grand") return h.prixMilleGrand;
  const coutHeure = h.coutAnnuelAnalyste / (h.heuresProductivesParJour * h.joursTravaillesParAn);
  return (h.secondesHumaines / 3600) * coutHeure * 1000;
}

/**
 * La justesse d'un étage sur un item donné.
 *
 * Les trois premiers étages rendent leur chiffre mesuré. L'humain rend l'hypothèse — et
 * c'est la seule ligne de tout le projet où une valeur affichée ne vient pas d'une mesure.
 */
export function justesse(etage: NomEtage, mesuree: number, h: Hypotheses): number {
  return etage === "humain" ? h.justesseHumaine : mesuree;
}

/** Millisecondes par item : mesurées pour les modèles, postulées pour l'humain. */
export function latence(etage: NomEtage, mesuree: number, h: Hypotheses): number {
  return etage === "humain" ? h.secondesHumaines * 1000 : mesuree;
}
