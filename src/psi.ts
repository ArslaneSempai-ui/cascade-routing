/**
 * L'indice de stabilité de population, et ses trois pièces.
 *
 * CE FICHIER EST PARTAGÉ. Il est repris à l'identique de `drift-monitor`, où il a été
 * mesuré et éprouvé, et il doit le rester : `figures.ts`, `interval.ts`, `provenance.ts` et
 * `cli.ts` ont déjà le même md5 dans les sept dépôts, et c'est ce qui fait qu'un module
 * emprunté compile sans adaptation. Une variante locale « améliorée » romprait ça, et deux
 * indices de stabilité qui divergent d'un demi-point ne se comparent plus entre outils.
 *
 * Pourquoi ce fichier existe ici : `VALIDATION.md` §6 point 3 crée une obligation —
 * « Watch the input distribution, not only the output. Accuracy falls after the population
 * has already moved, which makes it the last indicator to react. » Un indicateur d'ENTRÉE se
 * calcule sur les documents seuls, sans étiquette et sans modèle : il peut donc tourner sur
 * le flux d'un client qui n'a pas de vérité terrain, ce qui est le cas de tout le monde en
 * production.
 *
 * Ce que `drift-monitor` a mesuré et qu'on hérite avec le code : le seuil de 0,200 répété
 * dans toutes les notes de risque modèle est **au-dessus du signal qu'il existe pour voir**.
 * Un déplacement de 0,3 écart-type porte l'indice à 0,090. Et sous 350 observations par
 * contrôle, aucun seuil ne sépare quoi que ce soit.
 */

/**
 * Les bornes des bandes, prises sur la référence.
 *
 * Des quantiles de la référence, pas des coupes régulières : c'est ce que fait un modèle de
 * risque, et ça change la distribution du PSI — chaque bande porte alors la même masse au
 * départ, donc le bruit y est comparable.
 */
export function bornesDeBandes(reference: number[], bandes: number): number[] {
  const tri = [...reference].sort((a, b) => a - b);
  const bornes: number[] = [];
  for (let i = 1; i < bandes; i++) {
    bornes.push(tri[Math.floor((i / bandes) * tri.length)]!);
  }
  return bornes;
}

/** Dans quelle bande tombe une valeur. Par comparaison, jamais par division. */
export function bande(v: number, bornes: number[]): number {
  for (let i = 0; i < bornes.length; i++) if (v < bornes[i]!) return i;
  return bornes.length;
}

/** Les parts par bande d'un échantillon, avec une demi-observation par bande vide. */
export function parts(echantillon: number[], bornes: number[]): number[] {
  const n = bornes.length + 1;
  const comptes = new Array(n).fill(0);
  for (const v of echantillon) comptes[bande(v, bornes)]++;
  const total = echantillon.length;
  return comptes.map((c) => (c === 0 ? 0.5 : c) / total);
}

export function psi(partsRef: number[], partsFenetre: number[]): number {
  let s = 0;
  for (let i = 0; i < partsRef.length; i++) {
    const a = Math.max(partsRef[i]!, 1e-6);
    const b = Math.max(partsFenetre[i]!, 1e-6);
    s += (b - a) * Math.log(b / a);
  }
  return s;
}

/**
 * Le seuil de l'industrie, et le nombre d'observations sous lequel rien ne se sépare.
 *
 * Les deux viennent de `drift-monitor`, mesurés là-bas. On les rappelle ici pour que
 * quiconque lit un indice de ce dépôt sache contre quoi le comparer — et surtout, sache
 * quand il ne faut PAS le comparer du tout.
 */
export const SEUIL_DE_L_INDUSTRIE = 0.2;
export const OBSERVATIONS_MINIMALES = 350;
