/**
 * Les chiffres que `landing.json` tire des journaux, figés dans un fichier versionné.
 *
 * Trois blocs de `landing.json` sont calculés depuis `data/tentatives/*.jsonl` : la vérification
 * de composition, le gain de l'escalade admissible, et l'abstention. `data/` est ignoré par git.
 *
 * **Donc `npm test` échouait sur un clone frais.** `landing.ts --check` régénère en mémoire et
 * compare au contenu : sans journaux il produit des blocs `measured: false`, qui diffèrent du
 * `landing.json` livré, et la chaîne s'arrête. Le vert de cette machine reposait sur des
 * fichiers absents du dépôt — la forme exacte qu'on cherchait, et je l'avais introduite cette
 * nuit en émettant ces trois blocs.
 *
 * Le remède n'est pas de verser les journaux : ce sont des centaines de kilo-octets de lignes
 * brutes, et ce dépôt les tient hors de git depuis qu'il en a commis 1,4 Mo par accident. C'est
 * de **figer le résultat**, petit, versionné, avec le journal dont il sort — et de faire lire au
 * générateur ce fichier-là plutôt que le répertoire ignoré.
 *
 *     npm run derivees        recalcule depuis les journaux et réécrit ce fichier
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { journaux } from "./journal.ts";
import { fileURLToPath } from "node:url";

export const FICHIER = fileURLToPath(new URL("../mesures-derivees.json", import.meta.url));

export type Derivees = {
  quoi: string;
  journal: string | null;
  journalModifieLe: string | null;
  calculeLe: string;
  blocs: Record<string, unknown>;
};

/** Ce que le dépôt a figé, ou `null` s'il n'a rien figé. */
export function lireDerivees(): Derivees | null {
  if (!existsSync(FICHIER)) return null;
  return JSON.parse(readFileSync(FICHIER, "utf8")) as Derivees;
}

/**
 * Le produit est-il plus vieux que sa source ?
 *
 * Un contrôle qui lit un artefact plus ancien que ce qui le produit rend un vert sur du travail
 * que personne n'a vu. La comparaison est faite avant de contrôler, et elle **arrête** au lieu
 * d'avertir : un avertissement dans une sortie qui défile est un avertissement qui n'existe pas.
 */
export function perime(): { perime: boolean; raison: string } {
  const d = lireDerivees();
  if (!d) return { perime: false, raison: "rien de figé : le générateur retombera sur `measured: false`." };
  if (!d.journal) return { perime: false, raison: "le figé ne nomme aucun journal : rien à comparer." };

  /*
   * Comparer au journal qui l'a produit, pas au plus récent de tous.
   *
   * La première version prenait le journal le plus neuf du répertoire. `npm run figures` en
   * écrit un au passage — la galerie d'échecs mesure et journalise — donc chaque régénération
   * périmait un fichier qu'elle n'avait pas touché, et la garde s'est mise à crier à chaque
   * commande. Un gardien qui crie à tort finit désactivé, ce qui est pire que pas de gardien :
   * c'est la troisième fois ce soir que la bonne forme est « comparer à la vraie source ».
   */
  const nom = d.journal.split("/").pop()!;
  const sien = journaux().find((f) => f.endsWith(nom));
  if (!sien) {
    return { perime: false, raison:
      `le journal ${nom} n'est plus sur cette machine — \`data/\` n'est pas versionné. `
      + `Le figé fait foi et ne peut pas être comparé.` };
  }
  const source = statSync(sien).mtimeMs;
  const fige = statSync(FICHIER).mtimeMs;
  if (source > fige) {
    return { perime: true, raison:
      `mesures-derivees.json (${new Date(fige).toISOString()}) est plus ancien que le journal `
      + `dont il sort, ${nom} (${new Date(source).toISOString()}).\n`
      + `  Le contrôle porterait sur un produit que sa source a dépassé.\n`
      + `  Lancer : npm run derivees` };
  }
  return { perime: false, raison: `le figé est au moins aussi récent que ${nom}, dont il sort.` };
}

/*
 * Ce module ne calcule rien et n'importe pas `landing.ts`.
 *
 * Les trois calculs vivent dans `landing.ts`, qui importe celui-ci pour lire le figé. Faire
 * l'inverse fermait le cycle et bloquait le chargement sur un `await` jamais résolu — un
 * blocage silencieux, sans erreur, qui se lit comme une commande qui ne fait rien.
 *
 * Le gel est donc écrit par `node src/landing.ts --derivees`.
 */
