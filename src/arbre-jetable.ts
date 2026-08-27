/**
 * Un arbre de travail jetable, portant le code du DISQUE, et rapporté propre.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE EN UN SEUL ENDROIT ───
 *
 * Deux cas en avaient besoin et chacun portait sa copie. Elles ont divergé au premier défaut :
 * corriger l'une laissait l'autre. Deux façons de produire la même chose divergent toujours —
 * c'est la quatrième fois de la journée dans ce dépôt, et la seule parade est qu'il n'y en ait
 * qu'une.
 *
 * ─── LES TROIS PIÈGES QU'ELLE FERME, TOUS PAYÉS ───
 *
 * **Il vit dans le dossier temporaire, jamais à côté des vrais dépôts.** Ce code copie et
 * efface des répertoires entiers ; posé dans le dossier des dépôts, une interruption au mauvais
 * moment les abîme. Une garde du dépôt refuse d'ailleurs tout cas qui écrit là-haut.
 *
 * **Il porte le code du disque, pas celui de HEAD.** `git worktree add` extrait HEAD : un cas
 * bâti dessus resterait vert alors qu'on vient de casser la garde dans le fichier de travail.
 * Une suite lancée avant un commit doit juger ce qui va PARTIR, pas ce qui est déjà parti.
 *
 * **Et le commit qui fige la copie est `--allow-empty`.** Sans ça, le jour où le disque est
 * identique à HEAD — c'est-à-dire dès que le travail est committé — `git commit` échoue en
 * disant qu'il n'y a rien à commiter, et le cas tombe en accusant la garde qu'il éprouve. Vert
 * tant qu'on travaille, rouge une fois le travail rangé : l'ordre exact où personne ne
 * soupçonne le harnais.
 */
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/*
 * CHAQUE COMMANDE GIT D'ICI NETTOIE SON ENVIRONNEMENT, et c'est le point le plus important du
 * fichier. Git exporte GIT_INDEX_FILE à ses crochets ; un pre-commit qui lance la suite le
 * transmet à tout ce qu'elle lance. Hérité, le `git add -A` d'en dessous ÉCRIT DANS L'INDEX DU
 * COMMIT EN COURS — celui de l'appelant — au lieu du sien. C'est le mécanisme exact qui a
 * produit quatre commits vides le 26 août 2026 : trois sessions ont perdu du travail, et le
 * défaut a été corrigé partout SAUF ici, dans l'outil construit pour s'en protéger. Trouvé par
 * l'audit du 27 août.
 */
export const envGitPropre = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE; delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_PREFIX;
  return env;
};
const git = (args: string[]): void => {
  execFileSync("git", args, { env: envGitPropre() });
};
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

/** Crée l'arbre et rend son chemin. À retirer avec `retirerArbreJetable`. */
export function arbreJetable(prefixe: string, racineTemporaire: string = tmpdir()): string {
  /*
   * `racineTemporaire` EXISTE POUR QUE LE REFUS D'EN DESSOUS SOIT ATTEIGNABLE, et pour rien
   * d'autre : sa valeur par défaut est celle qu'on veut en production. Le balayage du 26 août
   * 2026 a montré que ce refus était le seul de ce fichier qu'aucun cas ne pouvait déclencher —
   * il gardait le défaut le plus cher de la journée, un bac à sable créé DANS le vrai arbre,
   * et rien ne l'éprouvait. Un cas lui passe une racine dont le nom contient `/Documents/`
   * sans que rien de réel soit touché.
   */
  const chemin = mkdtempSync(join(racineTemporaire, `${prefixe}-`));
  if (chemin.includes("/Documents/")) {
    throw new Error(`test sandbox inside the real tree: ${chemin}`);
  }
  /*
   * L'AUTO-NETTOYAGE D'ABORD. Un cas qui échoue ou meurt ne retire jamais son arbre : mesuré
   * le 27 août 2026, QUARANTE-NEUF arbres jetables traînaient dans `git worktree list`, et
   * 801 commits orphelins « état du disque » noyaient la section « travail perdu » de l'outil
   * de reprise — un vrai commit perdu y serait devenu invisible. `prune` ramasse les arbres
   * dont le dossier temporaire a disparu ; il coûte quelques millisecondes et rend chaque
   * création auto-réparante au lieu d'exiger une intendance que personne ne fera.
   */
  git(["-C", RACINE, "worktree", "prune"]);
  git(["-C", RACINE, "worktree", "add", "--detach", "-q", chemin, "HEAD"]);
  /* `node_modules` est LIÉ, jamais installé : le dépôt y garde plus d'un gigaoctet de modèles
     en cache, et les commandes ne démarrent pas sans lui. */
  symlinkSync(join(RACINE, "node_modules"), join(chemin, "node_modules"));
  /*
   * LES SUPPRESSIONS AUSSI. `worktree add` extrait HEAD, puis `cpSync` copie le disque
   * PAR-DESSUS — sans retirer ce que HEAD porte et que le disque n'a plus. Un fichier supprimé
   * (rm, pas encore commité) restait donc dans le bac : « l'état du disque » contenait un
   * fichier que le commit à venir n'aura pas, et une suite verte sur le bac ne prouvait rien
   * du commit. On efface src/ extrait avant de copier. Audit du 27 août 2026.
   */
  rmSync(join(chemin, "src"), { recursive: true, force: true });
  cpSync(join(RACINE, "src"), join(chemin, "src"), { recursive: true });
  /*
   * NETTOYER LES VARIABLES EST UNE INTENTION ; VÉRIFIER EST UN FAIT. Deux sessions ont observé
   * indépendamment le même détournement — GIT_DIR hérité gagne sur le dossier courant, et les
   * commits du bac atterrissent dans le dépôt de l'appelant. Avant la PREMIÈRE écriture, on
   * exige donc que git réponde depuis l'intérieur du bac. Si une huitième variable apparaît un
   * jour, cette assertion la trouvera sans qu'on la connaisse.
   */
  const gitDir = execFileSync("git", ["-C", chemin, "rev-parse", "--absolute-git-dir"],
    { env: envGitPropre(), encoding: "utf8" }).trim();
  /*
   * LA RÉFÉRENCE EST LE DÉPÔT COMMUN, PAS `RACINE/.git`.
   *
   * Comparé à `join(RACINE, ".git")`, ce contrôle criait au détournement dès que `RACINE`
   * était un worktree LIÉ — et c'est le cas de toutes les sessions qui travaillent ici.
   * Depuis un worktree lié, `RACINE/.git` est un FICHIER qui pointe ailleurs, et
   * `git worktree add` range l'administration du bac sous le dépôt COMMUN. Le bac était
   * parfaitement isolé, l'assertion regardait le mauvais chemin — et son message accusait
   * exactement le défaut qu'elle venait fermer, ce qui est la pire forme de faux positif.
   *
   * Le dépôt commun est ce que tous les worktrees d'un même dépôt partagent : c'est la
   * propriété qu'on veut, et elle se demande à git plutôt que de se composer à la main.
   */
  const commun = execFileSync("git", ["-C", RACINE, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { env: envGitPropre(), encoding: "utf8" }).trim();
  if (!gitDir.startsWith(commun)) {
    throw new Error(`the sandbox answers from ANOTHER repository: ${gitDir}\n`
      + `  A write here would land in someone else's repo — the diversion that carried away\n`
      + `  two sessions' uncommitted work on 27 August 2026 (inherited GIT_DIR wins over cwd).`);
  }
  git(["-C", chemin, "add", "-A"]);
  git(["-C", chemin, "-c", "user.name=t", "-c", "user.email=t@t",
    "commit", "-q", "--no-verify", "--allow-empty", "-m", "état du disque, figé pour ce cas"]);
  return chemin;
}

export function retirerArbreJetable(chemin: string): void {
  try {
    git(["-C", RACINE, "worktree", "remove", "--force", chemin]);
  } catch { /* déjà parti : rien à faire */ }
  rmSync(chemin, { recursive: true, force: true });
}
