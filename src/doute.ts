/**
 * LE SCORE DE DOUTE D'UNE VALEUR — combien de signaux sans modèle tirent sur ce qu'un palier a
 * rendu. C'est la matière première de la courbe du point de fonctionnement.
 *
 * ─── POURQUOI IL EST CALCULÉ PENDANT LA MESURE, ET COMPTÉ, JAMAIS GARDÉ ───
 *
 * L'offre promet au client de choisir SON point de fonctionnement : à quel score s'abstenir,
 * combien d'heures de relecture ça coûte, combien de valeurs fausses ça retient. Cette courbe
 * se calcule depuis deux comptes par cellule et par score — combien de valeurs ont ce score,
 * combien d'entre elles étaient fausses — et rien d'autre. `measure:yours` les compte au moment
 * où il note la valeur, et le relevé scellé les emporte : des entiers, jamais une valeur.
 *
 * Les prédicats sont ceux de `signal.ts`, publics, et de la règle d'abstention exportée par le
 * composant licencié — la MÊME définition, pour que le score compté ici soit celui que la règle
 * calculera chez le client. Un champ que `FORME` ou `REPERTOIRE` ne connaissent pas ne porte
 * pas ces deux signaux : le compte le dit par `signauxApplicables`, il ne l'invente pas.
 */
import { FORME, REPERTOIRE, porteDesInvisibles, melangeDEcritures, horsRepertoire } from "./signal.ts";
import { normaliserReponse } from "./tiers.ts";

/** Le score le plus haut qu'une valeur puisse atteindre : vide compte pour un, puis cinq signaux. */
export const SCORE_MAX = 6;

/** Les signaux que ce champ peut déclencher — un nom de colonne inconnu en porte quatre sur six. */
export function signauxApplicables(champ: string): string[] {
  const s = ["empty", "not in the document", "invisible characters", "mixed scripts"];
  if (FORME[champ] !== undefined) s.push("unexpected shape");
  if (REPERTOIRE[champ] !== undefined) s.push("outside the field's character set");
  return s;
}

/**
 * Combien de signaux tirent. Zéro : rien à dire. Une valeur vide vaut un et s'arrête là —
 * elle est déjà une abstention, et compter ses autres signaux compterait le vide plusieurs fois.
 */
export function scoreDeDoute(valeur: string, texteDuDocument: string | undefined, champ: string): number {
  const v = normaliserReponse(String(valeur ?? ""));
  if (v.length === 0) return 1;
  let n = 0;
  if (texteDuDocument !== undefined && !normaliserReponse(texteDuDocument).includes(v)) n++;
  const forme = FORME[champ];
  if (forme !== undefined && !forme(valeur)) n++;
  if (porteDesInvisibles(valeur)) n++;
  if (melangeDEcritures(valeur)) n++;
  if (horsRepertoire(valeur, champ)) n++;
  return n;
}

/** Deux comptes par score : les valeurs qui l'ont, et celles qui étaient fausses parmi elles. */
export type Doutes = { parScore: number[]; fauxParScore: number[] };

export function doutesVides(): Doutes {
  return { parScore: Array.from({ length: SCORE_MAX + 1 }, () => 0), fauxParScore: Array.from({ length: SCORE_MAX + 1 }, () => 0) };
}

export function compterDoute(d: Doutes, score: number, juste: boolean): void {
  const k = Math.max(0, Math.min(SCORE_MAX, score));
  d.parScore[k]!++;
  if (!juste) d.fauxParScore[k]!++;
}
