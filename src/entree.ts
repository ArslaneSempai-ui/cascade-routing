/**
 * Surveiller la population qui ARRIVE, pas seulement ce qui en sort.
 *
 *   npm run entree
 *
 * `VALIDATION.md` §6 point 3 :
 *
 *   « Watch the input distribution, not only the output. Accuracy falls after the population
 *     has already moved, which makes it the last indicator to react. »
 *
 * C'est la troisième des trois obligations que le dossier déclare créer, et la dernière qui
 * n'était pas tenue. Elle est d'une autre nature que les deux premières : l'exactitude
 * demande des étiquettes, donc une vérité terrain, donc quelqu'un qui a déjà fait le travail.
 * Un indicateur d'ENTRÉE se calcule sur les documents seuls. Il tourne chez un client qui n'a
 * aucune étiquette — c'est-à-dire chez tout le monde, en production.
 *
 * CE QU'ON MESURE, ET POURQUOI CE CHOIX EST DISCUTABLE : la longueur du document en
 * caractères. C'est le trait le moins intelligent possible, et c'est délibéré — il ne demande
 * ni modèle, ni tokeniseur, ni langue, il se calcule sur un flux à coût nul, et il bouge quand
 * la formulation change. Les trois découpages de ce corpus ont des formulations différentes,
 * et leurs médianes le disent : 145, 137, 169 caractères. Un trait plus fin serait plus
 * sensible et moins transportable ; celui-ci se recalcule chez le client sans rien installer.
 * Quiconque a mieux le remplace : la fonction est un argument.
 *
 * LE PLANCHER DE BRUIT, QUI EST LA MOITIÉ DE L'OUTIL. Un indice de 1,232 ne veut rien dire
 * tant qu'on ne sait pas ce que le MÊME nombre d'observations produit sur une population qui
 * n'a pas bougé. Ici, mesuré : à 1 000 observations le bruit de tirage vaut 0,014, donc 1,232
 * est un déplacement. À 120 observations il atteint 0,260 — AU-DESSUS du seuil de
 * l'industrie : à cette taille, l'indicateur crie sur une population immobile. C'est la raison
 * mesurée du refus sous `OBSERVATIONS_MINIMALES`, et elle est retrouvée ici, sur ce trait, au
 * lieu d'être héritée d'un autre dépôt. Le relevé porte donc son plancher, toujours.
 *
 * CE QU'ON NE PRÉTEND PAS. Un indice qui bouge ne dit pas que l'exactitude va tomber, ni de
 * combien. Il dit que la population n'est plus celle sur laquelle le routage a été choisi, et
 * que la décision a donc expiré — ce qui est précisément l'obligation du §6.
 */
import { generateRecords, type Split } from "./corpus.ts";
import { isMain } from "./cli.ts";
import { bornesDeBandes, parts, psi, SEUIL_DE_L_INDUSTRIE, OBSERVATIONS_MINIMALES } from "./psi.ts";

/** Le trait mesuré sur un document, sans étiquette et sans modèle. */
export const longueur = (texte: string): number => texte.length;

export type Releve = {
  reference: Split; fenetre: Split;
  n: number; indice: number;
  auDessusDuSeuil: boolean;
  assezDObservations: boolean;
};

/** Les graines des ré-échantillonnages qui donnent le plancher. */
export const GRAINES_DE_BRUIT = [20260901, 20261103, 20270214, 20270620, 20271005];

/**
 * Ce que le même n produit sur une population QUI N'A PAS BOUGÉ. Tout indice se lit contre ce
 * nombre : au-dessous, il est indiscernable du tirage.
 *
 * ON REND LE PIRE TIRAGE, PAS LE TIRAGE TYPIQUE. La question à laquelle ce plancher répond
 * n'est pas « combien de bruit y a-t-il d'habitude » mais « qu'est-ce que le bruit peut
 * produire de plus fort » — puisque c'est ce maximum-là qui déclenchera une fausse alerte. Une
 * médiane rassurerait : à 120 observations elle vaut 0,140, sous le seuil, alors qu'un des
 * cinq tirages atteint 0,260 et dépasse le seuil. Publier la médiane reviendrait à cacher
 * précisément le cas qu'on cherche.
 */
export function plancherDeBruit(
  population: Split, n: number, bandes = 10, trait: (t: string) => number = longueur,
): number {
  return Math.max(...GRAINES_DE_BRUIT
    .map((g) => comparerPopulations(population, population, n, bandes, trait, g).indice));
}

/*
 * `graineFenetre` existe pour une raison qui n'est pas cosmétique : sans elle, comparer une
 * population à ELLE-MÊME rend exactement 0, parce que les deux tirages sont le même tirage.
 * Un témoin bâti là-dessus prouverait que la formule rend zéro sur deux tableaux identiques —
 * pas qu'elle reste calme quand on retire un échantillon de la même population. C'est ce
 * deuxième chiffre qui dit si l'indice sépare quoi que ce soit : un bruit de tirage supérieur
 * au seuil rendrait l'indicateur inutilisable, et il faut le mesurer, pas l'espérer.
 */
export function comparerPopulations(
  reference: Split, fenetre: Split, n: number, bandes = 10,
  trait: (t: string) => number = longueur, graineFenetre?: number,
): Releve {
  const ref = generateRecords(n, reference).map((d) => trait(d.text));
  const fen = (graineFenetre === undefined
    ? generateRecords(n, fenetre)
    : generateRecords(n, fenetre, graineFenetre)).map((d) => trait(d.text));
  const bornes = bornesDeBandes(ref, bandes);
  const indice = psi(parts(ref, bornes), parts(fen, bornes));
  return {
    reference, fenetre, n, indice,
    auDessusDuSeuil: indice >= SEUIL_DE_L_INDUSTRIE,
    /* SOUS 350 OBSERVATIONS, AUCUN SEUIL NE SÉPARE — mesuré dans `drift-monitor`. Publier un
       indice sur moins que ça reviendrait à publier un taux sur douze cas : le nombre existe,
       il ne veut rien dire, et il a l'air d'une mesure. */
    assezDObservations: n >= OBSERVATIONS_MINIMALES,
  };
}

if (isMain(import.meta)) {
  const n = Number(process.argv[2] ?? 1000);
  console.log(`\n  Indice de stabilité de population sur la longueur des documents, `
    + `${n} observations par côté.`);
  console.log(`  Référence : la population sur laquelle le routage a été choisi (heldout).\n`);

  const plancher = plancherDeBruit("heldout", n);
  console.log(`  Plancher de bruit à ${n} observations : ${plancher.toFixed(3)} — c'est ce que rend`);
  console.log(`  un ré-échantillonnage de la population de référence, qui n'a pas bougé.\n`);

  const releves = (["dev", "training"] as Split[]).map((f) => comparerPopulations("heldout", f, n));
  for (const r of releves) {
    const verdict = !r.assezDObservations
      ? `INDÉTERMINÉ — ${r.n} observations, il en faut ${OBSERVATIONS_MINIMALES}`
      : r.indice < plancher * 2
        ? `INDISCERNABLE DU TIRAGE (plancher ${plancher.toFixed(3)})`
        : r.auDessusDuSeuil
          ? `${(r.indice / plancher).toFixed(0)}x le plancher, au-dessus du seuil `
            + `de l'industrie (${SEUIL_DE_L_INDUSTRIE})`
          : `${(r.indice / plancher).toFixed(0)}x le plancher, mais sous le seuil `
            + `de l'industrie (${SEUIL_DE_L_INDUSTRIE})`;
    console.log(`  heldout -> ${r.fenetre.padEnd(9)} indice ${r.indice.toFixed(3)}   ${verdict}`);
  }

  /* LE SEUIL PEUT ÊTRE SOUS LE BRUIT, et alors il ne dit plus rien : il déclenche sur une
     population immobile. Mesuré ici à 120 observations. Le dire, plutôt que rendre un chiffre
     qui a l'air d'une mesure. */
  if (plancher >= SEUIL_DE_L_INDUSTRIE) {
    console.log(`\n  ATTENTION — le plancher de bruit (${plancher.toFixed(3)}) dépasse le seuil de`);
    console.log(`  l'industrie (${SEUIL_DE_L_INDUSTRIE}). À ${n} observations ce seuil se déclenche sur une`);
    console.log(`  population qui n'a pas bougé. Il faut ${OBSERVATIONS_MINIMALES} observations au moins.`);
  }

  console.log(`\n  Ce que ces chiffres disent, et ce qu'ils ne disent pas.`);
  console.log(`  Le seuil de 0,200 vient des notes de risque modèle, et « drift-monitor » a`);
  console.log(`  mesuré qu'il est AU-DESSUS du signal : un déplacement de 0,3 écart-type porte`);
  console.log(`  l'indice à 0,090. Un indice sous 0,200 n'est donc pas une absence de dérive —`);
  console.log(`  c'est une dérive que ce seuil-là ne peut pas voir.\n`);
  console.log(`  Et un indice qui bouge ne prédit pas une chute d'exactitude. Il dit que la`);
  console.log(`  population n'est plus celle sur laquelle le routage a été choisi, donc que la`);
  console.log(`  décision a expiré — ce qui est l'obligation de VALIDATION.md §6.\n`);
}
