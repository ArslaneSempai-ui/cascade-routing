/*
 * CE QUE `.gitignore` REFUSE N'A RIEN À FAIRE DANS UN HISTORIQUE PUBLIC.
 *
 * `.stryker-tmp/sandbox-mPFFL7/` — cent cinquante-neuf fichiers, une copie entière du dépôt
 * laissée par une passe de mutation, avec un lien symbolique `node_modules` pointant vers le
 * chemin absolu du disque de l'auteur — vit dans l'historique de deux branches de sauvegarde.
 * Mesuré le 26 août 2026 : aucun de ces commits n'est atteignable depuis `origin/main`, et le
 * distant ne porte que `main` et les branches de dependabot. **Rien n'est publié.** Un
 * `git push --all` le publierait, et retirer un fichier de HEAD ne le retire pas du dépôt.
 *
 * La règle se déduit de `.gitignore` : une liste de motifs écrite dans le crochet oublierait
 * le dossier de demain. Mesuré avant de la poser : sur les 179 chemins que l'historique de
 * `origin/main` a jamais ajoutés, ZÉRO est ignoré aujourd'hui — elle ne gêne rien de ce qui
 * se pousse normalement.
 *
 * `--no-index` N'EST PAS UN DÉTAIL, et sa première version sans lui rendait zéro sur le cas
 * exact qu'elle vise : `git check-ignore` répond « pas ignoré » pour tout fichier SUIVI, et
 * un bac commité par erreur est suivi par définition. Le contrôle regardait la bonne liste
 * et posait la mauvaise question.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, chmodSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const crochet = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));

test("une branche qui porte un dossier ignoré ne part pas, et une branche propre part", () => {
  /* `realpathSync` : sur macOS `tmpdir()` rend `/var/…`, un lien vers `/private/var/…`, et
     la vérification d'isolement ci-dessous comparerait deux écritures du même dossier. */
  const bac = realpathSync(mkdtempSync(join(tmpdir(), "pousse-")));

  /*
   * `cwd` NE SUFFIT PAS, ET ÇA M'A COÛTÉ DEUX COMMITS DANS LE VRAI DÉPÔT.
   *
   * Lancée à la main, la première version de ce cas travaillait bien dans son bac. Lancée
   * PAR LE CROCHET de pré-commit — ce que fait `npm test` au moment où l'on commite — elle a
   * créé « base » et « le bac entre dans l'historique » dans le worktree lui-même, en
   * emportant les fichiers que j'avais indexés et en ÉCRASANT `.gitignore` par celui du bac.
   *
   * Git exporte `GIT_DIR`, `GIT_INDEX_FILE` et `GIT_WORK_TREE` à ses crochets. Un `git` lancé
   * avec `cwd` dans un dossier temporaire les hérite quand même, et `GIT_DIR` gagne : le
   * dossier courant ne décide plus de rien. Le crochet se protège déjà par `env -u
   * GIT_INDEX_FILE` pour ses propres commandes — la suite qu'il lance, elle, ne l'était pas.
   *
   * On les retire, et on VÉRIFIE que le bac est bien un dépôt à lui : un cas qui écrit dans le
   * dépôt qu'il éprouve ne se contente pas d'être faux, il détruit.
   */
  const envPropre = { ...process.env };
  for (const v of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete envPropre[v];
  const git = (...a: string[]) => spawnSync("git", a, { cwd: bac, encoding: "utf8", env: envPropre });
  try {
    git("init", "-q");

    const vu = git("rev-parse", "--absolute-git-dir").stdout.trim();
    assert.ok(vu.startsWith(bac),
      `le bac n'est pas isolé : \`git\` répond « ${vu} », hors de ${bac}.\n`
      + "  Tout ce qui suit s'écrirait dans le dépôt qu'on éprouve — un commit dans le vrai\n"
      + "  arbre, et l'index de qui commitait en ce moment. Ne pas continuer.");
    git("config", "user.email", "t@t"); git("config", "user.name", "t");
    writeFileSync(join(bac, ".gitignore"), ".stryker-tmp/\nnode_modules/\n");
    writeFileSync(join(bac, "a.txt"), "bonjour\n");
    git("add", ".gitignore", "a.txt"); git("commit", "-qm", "base");
    git("branch", "-q", "propre");
    /* Le sha de la branche propre. Nommé `shaPropre` : `propre` désignait DEUX choses — cet
       identifiant et l'environnement nettoyé — et la déclaration du `try` masquait l'autre.
       On répandait alors une CHAÎNE dans `env`, le crochet perdait `PATH` et `HOME`, et il
       refusait en 1 sans un mot : un refus sincère, sur une cause qui n'était pas la sienne. */
    const shaPropre = git("rev-parse", "propre").stdout.trim();

    mkdirSync(join(bac, ".stryker-tmp", "sandbox-X"), { recursive: true });
    writeFileSync(join(bac, ".stryker-tmp", "sandbox-X", "f.txt"), "une copie du dépôt\n");
    git("add", "-f", ".stryker-tmp/sandbox-X/f.txt");
    git("commit", "-qm", "le bac entre dans l'historique");
    const avecBac = git("rev-parse", "HEAD").stdout.trim();

    /* LE CROCHET VIVANT, pas une copie de sa logique : c'est lui qui décide au moment de
       pousser, et une réécriture de sa règle ici ne prouverait rien de ce qu'il fait. */
    const copie = join(bac, "pre-push");
    copyFileSync(crochet, copie); chmodSync(copie, 0o755);
    const zero = "0".repeat(40);
    const lancer = (ref: string, sha: string) => spawnSync("sh", [copie], {
      cwd: bac, encoding: "utf8", timeout: 120_000,
      input: `refs/heads/${ref} ${sha} refs/heads/${ref} ${zero}\n`,
      /* Le crochet aussi tourne dans l'environnement NETTOYÉ : lancé depuis un crochet de
         pré-commit, il hériterait de `GIT_DIR` et regarderait le vrai dépôt au lieu du bac —
         il ne verrait donc aucun fichier ignoré, et le cas rougirait en accusant la garde.
         L'accord est donné, sans quoi le crochet refuse plus loin pour une autre raison. */
      env: { ...envPropre, ACCORD_ARSLANE: "oui" },
    });

    const refuse = lancer("main", avecBac);
    assert.equal(refuse.status, 1,
      `une branche portant \`.stryker-tmp/\` part sans un mot (code ${refuse.status}).\n`
      + "  Ce dépôt est public : un dossier ignoré commité une fois reste dans les objets, et\n"
      + "  un bac de mutation porte des chemins absolus — donc le nom de l'utilisateur.");
    assert.match(refuse.stderr, /\.stryker-tmp\/sandbox-X\/f\.txt/,
      "le refus ne nomme pas le fichier : il faudrait chercher soi-même ce qui partirait.");

    /* TÉMOIN POSITIF, indispensable : un crochet qui refuse TOUT satisferait le cas ci-dessus
       et serait retiré à la première poussée légitime. */
    const passe = lancer("propre", shaPropre);
    assert.equal(passe.status, 0,
      `une branche sans fichier ignoré est refusée (code ${passe.status}) :\n`
      + `  ${passe.stderr.trim().split("\n").slice(0, 3).join("\n  ")}\n`
      + "  Une garde qui empêche une poussée légitime se fait retirer, et avec elle la seule\n"
      + "  chose qui tient la promesse.");
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});
