/**
 * ON NE MESURE PAS SUR UN ARBRE SALE — ÉCRIT HUIT FOIS, AVEC TROIS ISSUES INCOMPATIBLES.
 *
 * Relevé le 27 août 2026. Huit commandes portaient leur propre copie de la garde :
 *
 *   measure.ts          `--allow-dirty="raison"`, et la raison entre dans la provenance
 *   mesurer-ocr.ts      `--arbre-modifie`, sans raison
 *   mesurer-dur.ts      aucune issue
 *   apparier-prompt.ts  aucune issue
 *   departager-reglage  aucune issue
 *   regler-prompt.ts    aucune issue
 *   sensibilite-prompt  aucune issue
 *   hostile.ts          sa propre définition de « sale » — voir plus bas
 *
 * Le coût est pour celui qui apprend `--allow-dirty` sur `measure` : les commandes voisines le
 * refusent, **sans issue**, et `refuserDrapeauxInconnus` rejette en plus le drapeau qu'il vient
 * d'apprendre. Un refus sans issue se contourne ou se laisse tomber ; dans les deux cas la
 * garde a cessé de garder.
 *
 * DEUX DÉFINITIONS DE « SALE », ET ON GARDE LA STRICTE. `hostile.ts` ne compte que ce qui
 * touche `src/` — défendable pour la provenance, puisque le commit enregistré contient bien le
 * code qui a tourné. Mais `corpus-externe/`, `data/` et les fichiers de notation ne sont pas
 * sous `src/` et changent les résultats. Adopter la définition étroite partout ÉLARGIRAIT sept
 * gardes d'un coup, ce qui n'est pas une conséquence d'un travail d'unification. La définition
 * stricte reste ; celle de `hostile.ts` reste aussi, avec sa raison, là où elle est.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** L'environnement sans les variables que git exporte à ses crochets. Voir `arbre-jetable.ts`. */
function envSansGit(): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const v of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete e[v];
  return e;
}

/** Les deux issues, déclarées ici pour que les gardes de drapeaux ne les recopient pas. */
export const DRAPEAUX_ARBRE = ["--allow-dirty", "--arbre-modifie"] as const;

export type EtatDepot = { commit: string; sale: string[] } | undefined;

/**
 * Le commit et ce qui n'y est pas. `undefined` quand git ne répond pas — un dépôt téléchargé
 * en archive, ou git absent : on n'invente rien.
 *
 * `envSansGit` n'est pas décoratif : lancé sous un crochet, `GIT_DIR` l'emporte sur `cwd`, et
 * la commande dirait l'état d'un AUTRE dépôt que celui qu'on mesure.
 */
export function etatDuDepot(racine = fileURLToPath(new URL("..", import.meta.url))): EtatDepot {
  try {
    const env = envSansGit();
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"],
      { cwd: racine, encoding: "utf8", env }).trim();
    const sale = execFileSync("git", ["status", "--porcelain"],
      { cwd: racine, encoding: "utf8", env })
      .split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
    return { commit, sale };
  } catch { return undefined; }
}

/** Ce que le drapeau autorise, et la raison qui ira dans la provenance. */
export function raisonDArbreSale(argv: readonly string[] = process.argv): string | undefined {
  /* `--arbre-modifie` est l'ancienne forme de `mesurer-ocr`. Elle est acceptée pour que
     personne ne réapprenne un geste, et elle ne porte pas de raison — le relevé le dira. */
  const brut = argv.find((a) => a.startsWith("--allow-dirty") || a.startsWith("--arbre-modifie"));
  if (!brut) return undefined;
  return brut.split("=")[1] || "reason not given";
}

/**
 * Refuse de mesurer sur un arbre sale, en nommant les fichiers et l'issue.
 *
 * Rend l'état et la raison quand la mesure peut partir, pour que le relevé porte les deux.
 */
export function exigerArbrePropre(
  quoi: string,
  argv: readonly string[] = process.argv,
  racine = fileURLToPath(new URL("..", import.meta.url)),
): { etat: EtatDepot; malgreArbreSale: string | undefined } {
  const etat = etatDuDepot(racine);
  const malgreArbreSale = raisonDArbreSale(argv);
  if (etat && etat.sale.length > 0 && malgreArbreSale === undefined) {
    /* LE REFUS DIT CE QUI SE CASSE, pas seulement qu'il refuse : « not reproducible » est la
       conséquence, et sans elle `--allow-dirty` se pose sans y penser. Un cas de
       `refus-de-mesurer.test.ts` l'exige, et il a rougi quand cette garde a été unifiée — la
       consolidation avait emporté la moitié du message qui compte. */
    console.error(`\n  The working tree carries uncommitted changes, and ${quoi} would be`);
    console.error(`  marked not reproducible: the record names a commit that does not contain`);
    console.error(`  the code that ran, so nobody — including you — could produce it again.\n`);
    for (const f of etat.sale.slice(0, 8)) console.error(`    ${f}`);
    if (etat.sale.length > 8) console.error(`    … and ${etat.sale.length - 8} more`);
    console.error(`\n  git commit -am "…"              then run again`);
    console.error(`  or --allow-dirty="why"          if this is deliberate — the reason goes`);
    console.error(`                                  into the record, so a reader knows it was\n`);
    process.exit(1);
  }
  return { etat, malgreArbreSale };
}
