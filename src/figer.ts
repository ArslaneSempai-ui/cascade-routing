/**
 * Le branchement entre les chiffres figés sur disque et l'optimiseur qui s'en sert.
 *
 * `optimise.ts` tourne des deux côtés : en ligne de commande ici, et DANS LE NAVIGATEUR, où
 * il est compilé par `tsconfig.web.json` et embarqué dans la page publiée. Il ne peut donc
 * rien lire sur un disque — un seul `import "node:fs"` dans son graphe tue le module entier
 * au chargement du navigateur, et la page part vide.
 *
 * Ce fichier est la moitié Node de ce branchement. Il ne s'importe QUE depuis du code Node,
 * et il pose la table au chargement : un appelant qui l'importe n'a rien d'autre à faire.
 *
 *     import "./figer.ts";     // avant tout appel à optimiseExtraction
 *
 * Un module qui l'oublie ne casse pas : il perd la décomposition des erreurs et les deux
 * seuils qui la tarifent, en silence. C'est exactement le genre de dégradation muette que ce
 * dépôt refuse, donc un test la refuse aussi — voir « tout appelant Node de l'optimiseur
 * pose la table figée » dans cascade.test.ts.
 */
import { lireDerivees } from "./derivees.ts";
import { poserDecompositionFigee } from "./optimise.ts";

poserDecompositionFigee(
  lireDerivees()?.blocs?.decomposition as Record<string, { vide: number; faux: number }> | undefined,
);
