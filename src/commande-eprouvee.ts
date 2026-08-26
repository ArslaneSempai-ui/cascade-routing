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
 *
 * ET UN PIÈGE QUI VIENT AVEC CETTE AIDE, PARCE QU'ELLE POUSSE À EXTRAIRE.
 *
 * Pour rendre une garde éprouvable, on la sort en fonction. **Une extraction crée un site
 * d'appel neuf, et un site d'appel neuf n'a aucun témoin par construction** : la fonction est
 * parfaitement couverte, et rien n'exige que l'appelant l'appelle encore.
 *
 * Mesuré le 26 août 2026, sur l'extraction faite le jour même : remplacer `return
 * interpreter(sortie, chemin)` par un `JSON.parse` direct dans l'appelant **compile sans une
 * erreur et laisse la suite verte**. La garde était parfaitement éprouvée et parfaitement
 * contournable. Le typage ne couvrait pas ce que l'auteur croyait qu'il couvrait.
 *
 * Donc : après toute extraction, muter le POINT D'APPEL — pas la fonction — et exiger le rouge.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

export type Sortie = { code: number; texte: string };

/** Lance une commande du dépôt et rend son code et tout ce qu'elle a dit. */
export function lancer(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; msMax?: number } = {},
): Sortie {
  const env = { ...process.env, ...(options.env ?? {}) };
  /* La suite peut tourner sous un crochet git, qui exporte GIT_INDEX_FILE. Transmis à un
     sous-processus, il fait écrire ce processus dans l'index du commit en cours. Mesuré. */
  delete env.GIT_INDEX_FILE; delete env.GIT_DIR; delete env.GIT_WORK_TREE;
  /* `msMax` sert au CONTRÔLE POSITIF d'une commande coûteuse : on ne veut pas qu'elle
     aille au bout, seulement qu'elle dépasse la garde qu'on éprouve. Le code rendu est alors
     celui d'un processus tué — c'est pourquoi le contrôle positif porte sur ce qui a été DIT,
     jamais sur le code, quand une borne est posée. */
  /*
   * LE CHEMIN EST RÉSOLU, ET SANS ÇA CE FICHIER FABRIQUERAIT DES VERTS VIDES.
   *
   * Un module de ce dépôt ne s'exécute que s'il se reconnaît comme point d'entrée :
   * `import.meta.url === pathToFileURL(process.argv[1]).href`. Or `import.meta.url` résout les
   * liens symboliques et `pathToFileURL(argv[1])` non. Sur macOS, `mkdtemp` rend
   * `/var/folders/…` là où le chemin réel est `/private/var/folders/…` : les deux diffèrent, la
   * garde rend `false`, `principal()` n'est jamais appelé.
   *
   * Le symptôme mesuré : code 0, sortie VIDE. Un cas qui exige un refus tombe alors en
   * accusant la garde, et un cas qui exige un succès PASSE en n'ayant rien lancé du tout.
   * C'est le vert le plus vide possible — la commande n'a pas tourné.
   */
  const argsResolus = args.map((a, i) =>
    i === 0 && existsSync(a) ? realpathSync(a) : a);
  const r = spawnSync(process.execPath, argsResolus, {
    cwd: options.cwd ?? RACINE, encoding: "utf8", env, timeout: options.msMax,
  });
  return { code: r.status ?? -1, texte: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Exige que la commande REFUSE, et que son refus soit celui qu'on attend.
 *
 * `motif` n'est pas une commodité : c'est ce qui distingue un refus d'un plantage. Sans lui le
 * cas passe au vert sur une erreur d'import, une dépendance absente ou un fichier manquant.
 */
/*
 * UN REFUS SUIVI D'UN PLANTAGE N'EST PAS UN REFUS, et cette aide ne le voyait pas.
 *
 * Mesuré le 27 août 2026 sur le balayage : neutraliser `process.exit(2)` en `void (2)` laisse
 * le message s'imprimer — il part AVANT la sortie — puis le programme continue et s'écrase
 * plus loin sur ce qu'il refusait de faire. Le code rendu est 1, celui du plantage. Mon
 * `exigerRefus` voyait un code non nul et le bon motif : il passait.
 *
 * Une quinzaine de gardes que je croyais couvertes sont ressorties SURVIVANTES pour cette
 * seule raison. Le témoin passait, la garde ne gardait rien, et rien ne les distinguait.
 *
 * Un refus propre s'arrête. Une pile d'appels Node après le message dit exactement le
 * contraire : la commande a dit non et l'a fait quand même.
 */
const PILE = /\n\s+at\s|node:internal|node:fs:\d/;

export function exigerRefus(
  s: Sortie, motif: RegExp, quoi: string, pasApres?: RegExp,
): void {
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
  /*
   * L'ORDRE COMPTE. Ce contrôle vient APRÈS le motif, jamais avant : quand la commande n'a
   * rien refusé du tout — un module absent, un import cassé — elle plante sans message, et
   * annoncer « refus imprimé puis plantage » serait un diagnostic faux. Mon propre témoin
   * du « mauvais motif » me l'a dit dans la minute où j'ai posé ce contrôle en tête.
   *
   * Ici le motif est satisfait : la commande a bien dit non. Une pile d'appels après ça dit
   * qu'elle l'a dit ET l'a fait quand même.
   */
  if (PILE.test(s.texte)) {
    throw new Error(
      `${quoi} : le refus a été IMPRIMÉ puis la commande a PLANTÉ — ce n'est pas un refus.\n`
      + `  Le message part avant la sortie, donc un motif satisfait ne prouve rien : il faut\n`
      + `  que la commande S'ARRÊTE. Mesuré le 27 août 2026 — neutraliser process.exit laisse\n`
      + `  le message s'imprimer, le programme continue et s'écrase sur ce qu'il refusait de\n`
      + `  faire, et le code rendu est celui du plantage. Une quinzaine de gardes que je\n`
      + `  croyais couvertes étaient survivantes pour cette seule raison.\n`
      + `  reçu : ${JSON.stringify(s.texte.slice(0, 400))}`);
  }
  /*
   * `pasApres` EXIGE QUE LE REFUS SOIT TERMINAL, et c'est ce qui manquait le plus.
   *
   * Mesuré le 27 août 2026 : sur seize gardes que je croyais couvertes, quatorze survivaient
   * pour cette seule raison. Neutralisée, une garde laisse passer — et LA GARDE SUIVANTE
   * refuse à sa place. Le message de la première est toujours dans la sortie, puisqu'il part
   * avant la sortie du processus ; le code est non nul, puisqu'une autre garde l'a rendu. Le
   * cas passe, et il n'éprouve plus rien.
   *
   * Le motif seul dit « ce refus a été prononcé ». Il ne dit pas « c'est LUI qui a arrêté la
   * commande ». Nommer ce qui ne doit PAS suivre est la seule façon de le savoir sans deviner.
   */
  if (pasApres && pasApres.test(s.texte)) {
    throw new Error(
      `${quoi} : le refus attendu est bien là, mais LA COMMANDE A CONTINUÉ — ${pasApres} suit.\n`
      + `  Ce n'est donc pas cette garde-là qui a arrêté la commande, c'est une suivante. Retirée,\n`
      + `  la garde visée laisserait passer sans que ce cas bouge.\n`
      + `  reçu : ${JSON.stringify(s.texte.slice(0, 400))}`);
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
