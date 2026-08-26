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
    throw new Error(`terrain d'essai dans le vrai arbre : ${chemin}`);
  }
  execFileSync("git", ["-C", RACINE, "worktree", "add", "--detach", "-q", chemin, "HEAD"]);
  /* `node_modules` est LIÉ, jamais installé : le dépôt y garde plus d'un gigaoctet de modèles
     en cache, et les commandes ne démarrent pas sans lui. */
  symlinkSync(join(RACINE, "node_modules"), join(chemin, "node_modules"));
  cpSync(join(RACINE, "src"), join(chemin, "src"), { recursive: true });
  execFileSync("git", ["-C", chemin, "add", "-A"]);
  execFileSync("git", ["-C", chemin, "-c", "user.name=t", "-c", "user.email=t@t",
    "commit", "-q", "--no-verify", "--allow-empty", "-m", "état du disque, figé pour ce cas"]);
  return chemin;
}

export function retirerArbreJetable(chemin: string): void {
  try {
    execFileSync("git", ["-C", RACINE, "worktree", "remove", "--force", chemin]);
  } catch { /* déjà parti : rien à faire */ }
  rmSync(chemin, { recursive: true, force: true });
}
