/*
 * ÉPROUVER LE CODE DE SORTIE D'UNE COMMANDE, SANS LES DEUX FAÇONS DE SE MENTIR.
 *
 * Le balayage du 26 août 2026 a rendu 63 gardes `process.exit(` qu'aucun cas n'exerce, sur 98.
 * Ce sont les codes de sortie dont une chaîne d'intégration dépend, et une session voisine a
 * mesuré qu'y passer `exit(1)` à `exit(0)` laissait la suite entièrement verte.
 *
 * Les éprouver demande de lancer la commande, et deux pièges guettent, tous deux payés ce
 * jour-là :
 *
 * 1. UN CODE NON NUL NE PROUVE RIEN. Un module absent, un import cassé, une dépendance
 *    manquante rendent aussi un code non nul — j'ai lu un `ERR_MODULE_NOT_FOUND` comme une
 *    garde qui se déclenchait, et un `git clean` qui avait emporté un lien symbolique comme un
 *    refus légitime. Le refus doit être reconnu à SON MESSAGE, pas à son code.
 *
 * 2. UN REFUS N'EST UN REFUS QUE SI LA COMMANDE MARCHE QUAND TOUT VA BIEN. Sans contrôle
 *    positif, un cas qui exige un échec passe au vert sur un environnement cassé — et il passe
 *    d'autant mieux que tout est cassé. Un environnement abîmé ne rend pas la mesure bruyante,
 *    il la rend flatteuse : ce qui dégrade un résultat se remarque, ce qui l'améliore se publie.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

export type Sortie = { code: number; texte: string };

/** Lance une commande du dépôt et rend son code et tout ce qu'elle a dit. */
export function lancer(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Sortie {
  const env = { ...process.env, ...(options.env ?? {}) };
  /* La suite peut tourner sous un crochet git, qui exporte GIT_INDEX_FILE. Transmis à un
     sous-processus, il fait écrire ce processus dans l'index du commit en cours. Mesuré. */
  delete env.GIT_INDEX_FILE; delete env.GIT_DIR; delete env.GIT_WORK_TREE;
  const r = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? RACINE, encoding: "utf8", env,
  });
  return { code: r.status ?? -1, texte: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Exige que la commande REFUSE, et que son refus soit celui qu'on attend.
 *
 * `motif` n'est pas une commodité : c'est ce qui distingue un refus d'un plantage. Sans lui le
 * cas passe au vert sur une erreur d'import, une dépendance absente ou un fichier manquant.
 */
export function exigerRefus(s: Sortie, motif: RegExp, quoi: string): void {
  if (s.code === 0) {
    throw new Error(
      `${quoi} : la commande a RÉUSSI (code 0) là où elle devait refuser.\n`
      + `  ce qu'elle a dit : ${JSON.stringify(s.texte.slice(0, 300))}`);
  }
  if (!motif.test(s.texte)) {
    throw new Error(
      `${quoi} : la commande a bien échoué (code ${s.code}) mais PAS POUR LA RAISON ATTENDUE.\n`
      + `  attendu : ${motif}\n`
      + `  reçu    : ${JSON.stringify(s.texte.slice(0, 400))}\n`
      + `  Un code non nul se produit aussi sur un import cassé ou un module absent ; sans le\n`
      + `  motif, ce cas passerait au vert sur un environnement abîmé plutôt que sur la garde.`);
  }
}

/**
 * Le contrôle positif : la même commande, dans un état sain, DOIT réussir.
 *
 * À appeler dans tout cas qui exige un refus. Sans lui, on ne sait pas si la commande refuse
 * l'état cassé ou si elle est incapable de tourner du tout.
 */
export function exigerQueCaMarcheSansCa(s: Sortie, quoi: string): void {
  if (s.code !== 0) {
    throw new Error(
      `${quoi} : le CONTRÔLE POSITIF a échoué — la commande ne réussit pas dans l'état sain,\n`
      + `  donc le refus mesuré à côté ne prouve rien : il pourrait venir de n'importe où.\n`
      + `  code ${s.code} · ${JSON.stringify(s.texte.slice(0, 300))}`);
  }
}
