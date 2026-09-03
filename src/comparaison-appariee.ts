/**
 * DEUX PALIERS SUR LES MÊMES CAS : LA COMPARAISON APPARIÉE, ET CE QU'ELLE AUTORISE À DIRE.
 *
 * Le chemin client recommandait « prends le moins cher » dès que deux intervalles de Wilson se
 * chevauchaient. Mesuré le 3 septembre 2026 sur 24 cas : large 95,8 % [80–99] contre small
 * 66,7 % [47–82] — vingt-neuf points d'écart, les intervalles se touchent entre 80 et 82, et
 * l'outil écrivait « small is not measurably worse than large. Take the cheaper one. »
 *
 * Trois fautes dans une phrase :
 *
 *   1. Le chevauchement d'intervalles est le mauvais test pour des cas APPARIÉS — les mêmes
 *      24 dossiers jugés deux fois. `interval.ts` le dit lui-même (« overlapping intervals are
 *      the wrong test here ») et porte `pairedVerdict`, que ce chemin n'appelait pas. Sur ces
 *      24 cas, McNemar exact donne p = 0,016 ou 0,039 selon la répartition des discordants :
 *      les deux paliers SONT séparables.
 *   2. « Pas de différence significative » était lu comme « équivalents ». C'est l'erreur que
 *      CONCURRENTS.md reproche à lm-evaluation-harness — et « le petit modèle suffit » est une
 *      affirmation de NON-INFÉRIORITÉ, qui demande une marge déclarée par celui qui paie. Sans
 *      marge, aucune donnée ne peut établir qu'un palier suffit ; on ne recommande donc rien.
 *   3. Le refus sous vingt cas n'arrêtait rien à vingt-quatre.
 *
 * Ce module ne vit pas dans `interval.ts`, qui est PARTAGÉ entre les dépôts et se corrige dans
 * ~/Documents/identite. Il s'appuie dessus : Wilson pour les bornes, la binomiale exacte à deux
 * queues pour p. Tout ce qu'il rend est en anglais : c'est l'acheteur qui le lit.
 */
import { wilson, pairedVerdict } from "./interval.ts";

/** Un caractère par cas : « 1 » juste, « 0 » faux, « - » non mesuré sur ce cas. */
export type Bits = string;

export type Apparie = {
  /** Les cas mesurés DES DEUX CÔTÉS — les autres ne comparent rien. */
  n: number;
  /** La tête juste, le candidat faux. */
  gains: number;
  /** Le candidat juste, la tête fausse. */
  pertes: number;
  discordants: number;
  /** (gains − pertes) / n : de combien la tête dépasse le candidat, en proportion. */
  ecart: number;
  /** L'intervalle à 95 % de cet écart, en proportion. */
  bornes: [number, number];
  /** McNemar exact à deux queues ; `null` sans discordant, où le test n'a rien à tester. */
  p: number | null;
  separables: boolean;
};

/**
 * Compter ce qui diverge, puis borner l'écart.
 *
 * L'écart entre deux taux appariés ne vaut que par les cas où les deux paliers divergent :
 * un cas que les deux réussissent ou ratent ne dit rien de leur différence. On borne donc la
 * part des discordants qui va à la tête — une proportion, donc Wilson — et on la ramène à
 * l'échelle des n cas : écart = (2π − 1) · m / n. Sans discordant, l'écart observé est nul et
 * la seule chose qu'on sache est que le taux de discordance est sous sa borne haute de Wilson
 * à zéro sur n : l'écart vit dans ±cette borne.
 */
export function apparier(tete: Bits, candidat: Bits): Apparie {
  if (tete.length !== candidat.length) {
    throw new Error(`apparier(): ${tete.length} verdict(s) against ${candidat.length} — these are not `
      + `the same cases, and a paired test on misaligned cases compares nothing.`);
  }
  let n = 0, gains = 0, pertes = 0;
  for (let i = 0; i < tete.length; i++) {
    const a = tete[i], b = candidat[i];
    if ((a !== "1" && a !== "0") || (b !== "1" && b !== "0")) continue;
    n++;
    if (a === "1" && b === "0") gains++;
    else if (a === "0" && b === "1") pertes++;
  }
  const m = gains + pertes;
  if (n === 0) {
    throw new Error("apparier(): no case is measured on both sides, so nothing can be compared.");
  }
  let bornes: [number, number];
  if (m === 0) {
    const u = wilson(0, n)[1];
    bornes = [-u, u];
  } else {
    const [pl, pu] = wilson(gains, m);
    bornes = [(2 * pl - 1) * m / n, (2 * pu - 1) * m / n];
  }
  const verdict = pairedVerdict(gains, pertes);
  const p = m === 0 ? null : (verdict as { p: number }).p;
  return {
    n, gains, pertes, discordants: m, ecart: (gains - pertes) / n, bornes, p,
    separables: p !== null && p < 0.05,
  };
}

export type Verdict =
  /** p < 0,05 : le test sépare les deux, et dit dans quel sens. */
  | { genre: "separable"; sens: "tete" | "candidat" }
  /** Une marge déclarée, et le pire cas du candidat tient dedans. */
  | { genre: "non-inferieur"; marge: number; separables: boolean }
  /** Rien n'est établi ; `casEstimes` dit ce qu'il faudrait pour trancher sous la marge. */
  | { genre: "indecis"; marge?: number; casEstimes: number | null };

/**
 * Ce que la comparaison autorise à dire, dans cet ordre.
 *
 * La NON-INFÉRIORITÉ passe avant la séparation : un client qui déclare tolérer deux points a
 * dit ce qu'il voulait savoir, et un candidat mesurablement moins bon de 0,4 point est encore
 * à l'intérieur de sa marge. Sans marge, il n'existe aucun résultat qui établisse qu'un palier
 * suffit — seulement qu'il ne suffit pas, ou qu'on ne sait pas.
 *
 * `marge` est en proportion (0,02 pour deux points).
 */
export function juger(a: Apparie, marge?: number): Verdict {
  if (marge !== undefined && !(marge > 0 && marge < 1)) {
    throw new Error(`juger(): a margin of ${marge} is not a proportion strictly between 0 and 1.`);
  }
  if (marge !== undefined && a.bornes[1] < marge) {
    return { genre: "non-inferieur", marge, separables: a.separables };
  }
  if (a.separables) return { genre: "separable", sens: a.ecart > 0 ? "tete" : "candidat" };
  return { genre: "indecis", marge, casEstimes: marge === undefined ? null : casPourTrancher(a, marge) };
}

/**
 * COMBIEN DE CAS IL FAUDRAIT — une estimation, et la phrase qui la porte le dit.
 *
 * La demi-largeur de l'intervalle rétrécit en 1/√n. Pour que la borne haute passe sous la
 * marge, il faut une demi-largeur de (marge − écart) au lieu de celle d'aujourd'hui ; le
 * rapport des deux, au carré, multiplie n. Si l'écart observé dépasse déjà la marge, aucun
 * effectif ne montrera la non-infériorité : c'est `null`, et c'est une réponse.
 */
export function casPourTrancher(a: Apparie, marge: number): number | null {
  const voulue = marge - a.ecart;
  if (!(voulue > 0)) return null;
  const actuelle = (a.bornes[1] - a.bornes[0]) / 2;
  if (!(actuelle > 0)) return a.n;
  return Math.max(a.n + 1, Math.ceil(a.n * (actuelle / voulue) ** 2));
}

const pts = (x: number): string => (100 * x).toFixed(1);
const pVal = (p: number | null): string => (p === null ? "no disagreement" : p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const marg = (m: number): string => `${(100 * m) % 1 === 0 ? (100 * m).toFixed(0) : (100 * m).toFixed(1)}-point`;

/**
 * LA PHRASE QUE L'ACHETEUR LIT — une seule fonction, pour la console ET le fichier.
 *
 * « Take the cheaper one » n'apparaît que dans la branche de non-infériorité : c'est la seule
 * où quelqu'un a dit ce qu'il acceptait de perdre. Le rapport de vitesse est omis quand le
 * candidat n'a pas de durée mesurée (une chaîne déclarée, `--sorties`).
 */
export function phrase(o: {
  tete: string; candidat: string; a: Apparie; v: Verdict; msTete: number; msCandidat: number;
}): string {
  const { a, v } = o;
  const vitesse = Number.isFinite(o.msTete) && Number.isFinite(o.msCandidat) && o.msCandidat > 0
    ? ` and ${(o.msTete / o.msCandidat).toFixed(0)}× faster` : "";
  const desaccords = `${a.discordants} disagreement${a.discordants === 1 ? "" : "s"}`;
  switch (v.genre) {
    case "separable":
      return v.sens === "tete"
        ? `${o.candidat} is separably worse than ${o.tete} on these ${a.n} cases: ${a.gains} of `
          + `${desaccords} go to ${o.tete} (McNemar exact, ${pVal(a.p)}).`
        : `${o.candidat} is separably BETTER than ${o.tete} case for case: ${a.pertes} of `
          + `${desaccords} go to ${o.candidat} (McNemar exact, ${pVal(a.p)}) — the rates rank them the `
          + `other way; judge the disagreeing cases.`;
    case "non-inferieur":
      return `${o.candidat} is non-inferior to ${o.tete} within your ${marg(v.marge)} margin: at worst `
        + `${pts(a.bornes[1])} points behind (95 %), `
        + (v.separables ? `measurably behind (${pVal(a.p)}) but inside the margin` : `not separable from it (${pVal(a.p)})`)
        + `${vitesse}. Take the cheaper one.`;
    case "indecis":
      if (v.marge === undefined) {
        return `these ${a.n} cases do not separate ${o.candidat} from ${o.tete} (${desaccords}, ${pVal(a.p)}): `
          + `${o.candidat} may be up to ${pts(a.bornes[1])} points worse. That is not evidence they are `
          + `equivalent. Declare the loss you would accept, e.g. --margin=2, and the tool tests `
          + `non-inferiority instead; there is no recommendation without it.`;
      }
      return `${o.candidat} may be up to ${pts(a.bornes[1])} points worse than ${o.tete}, above your `
        + `${marg(v.marge)} margin (${desaccords}, ${pVal(a.p)}): no recommendation. `
        + (v.casEstimes === null
          ? `The observed gap, ${pts(a.ecart)} points, is itself above the margin: no sample size would show non-inferiority.`
          : `About ${v.casEstimes.toLocaleString("en-GB")} cases would settle it at this rate of disagreement — an estimate, not a measurement.`);
  }
}
