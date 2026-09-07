/* PARTAGÉ DANS LA FAMILLE CASCADE — source : cascade
   Les cinq dépôts de la famille (cascade, -screening, -monitoring, -scoring, -dossier) en
   portent une copie identique AU BYTE. Corrigez-le dans la source, puis recopiez : la famille
   est EXCLUE de la diffusion d'identite (depots.json), aucune diffusion ne viendra le faire à
   votre place. `couche-famille.test.ts` compare les octets, nomme la direction du retard, et
   refuse aussi un fichier identique dans deux dépôts qui ne porte PAS cet en-tête — c'est
   ainsi qu'une copie neuve se déclare au lieu de dériver en silence. */
/**
 * L'EMPREINTE D'UN RELEVÉ — LE MÊME FICHIER DANS LES CINQ OUTILS DE LA FAMILLE.
 *
 * Elle vivait en deux exemplaires : une fonction dans le measure.ts de cascade-routing, et ce
 * fichier dans les quatre autres. Deux fonctions de scellé, c'est deux comportements le jour
 * où l'une bouge — la faute que hostile.ts refuse déjà dans un seul dépôt, et qui vivait entre
 * les dépôts. Il n'y en a plus qu'une, et measure.ts la ré-exporte pour ses appelants.
 *
 * Le scellé doit s'exclure lui-même : il vit à la racine du relevé, et l'inclure dans son
 * propre calcul serait circulaire. Il ne s'exclut QU'À la racine : une `empreinte` imbriquée
 * (par palier, par liste) naît DANS le scellé, sinon on pourrait la changer, le scellé
 * continuerait de correspondre, et le contrôle dirait « intact » sur un relevé modifié.
 *
 * Les clés sont triées : deux relevés au contenu égal ont la même empreinte quel que soit
 * l'ordre dans lequel le code les a écrits.
 */
import { createHash } from "node:crypto";

/*
 * LA CLÉ RETIRÉE EST CELLE DE LA RACINE, ET D'AUCUN AUTRE NIVEAU.
 *
 * Le scellé doit s'exclure lui-même : il vit à la racine du relevé, et l'inclure dans son
 * propre calcul serait circulaire. Mais la version d'avant retirait `empreinte` à CHAQUE
 * niveau, ce qui est une tout autre règle — elle dit « aucune empreinte, où qu'elle soit,
 * n'est scellée ».
 *
 * Aucun relevé livré n'en porte d'imbriquée : relu le 31 août 2026 sur les cinq fichiers
 * `profiles-*.json`, une seule `empreinte` en tout, à la racine. Il n'y a donc rien à
 * exploiter aujourd'hui, et l'empreinte des relevés existants ne bouge pas d'un caractère.
 *
 * CE QUI SE FERME EST LE JOUR D'APRÈS. Qu'un relevé gagne une empreinte par palier ou par
 * corpus — la forme même vers laquelle ce dépôt tend, puisqu'il empreinte déjà ses modules et
 * ses corpus — et elle naîtrait HORS du scellé : on pourrait la changer, le scellé
 * continuerait de correspondre, et le contrôle dirait « intact » sur un relevé modifié. Une
 * garde latente se ferme pendant qu'elle est latente ; après, elle se ferme en cassant des
 * scellés livrés.
 */

function canonique(x: unknown, racine = true): unknown {
  if (Array.isArray(x)) return x.map((v) => canonique(v, false));
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((a, k) => {
      if (!(racine && k === "empreinte")) a[k] = canonique(o[k], false);
      return a;
    }, {});
  }
  return x;
}

export function empreinteDuReleve(releve: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonique(releve))).digest("hex").slice(0, 16);
}

/** Vrai si le relevé porte un scellé et que son contenu ne l'a pas fait mentir. */
export function scelleIntact(releve: Record<string, unknown>): boolean {
  return typeof releve.empreinte === "string" && releve.empreinte === empreinteDuReleve(releve);
}
