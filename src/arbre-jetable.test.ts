/*
 * LE BAC À SABLE NE DOIT JAMAIS NAÎTRE DANS LE VRAI ARBRE.
 *
 * `arbreJetable` copie des répertoires entiers et les efface. Créé sous `~/Documents/`, il
 * effacerait du travail réel — et c'est exactement la famille de défaut que ce dépôt a passé
 * le 26 août 2026 à traquer : un cas qui écrit là où git regarde, un relevé de référence
 * remplacé par une fixture, l'index d'un commit en cours écrasé par un clone.
 *
 * Le balayage a montré que ce refus était le seul de ce fichier qu'aucun cas ne pouvait
 * atteindre : `tmpdir()` était lu directement, donc aucune entrée ne pouvait le déclencher.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { arbreJetable, envGitPropre } from "./arbre-jetable.ts";

test("un bac à sable sous /Documents/ est refusé, et le refus nomme le chemin", () => {
  /* Une racine dont le NOM contient `/Documents/`, mais qui vit sous /tmp : la garde se
     déclenche sans que rien de réel soit approché. Éprouver ce refus en visant le vrai
     `~/Documents/` serait éprouver une garde en courant le risque qu'elle existe pour écarter. */
  const faux = join(mkdtempSync(join(tmpdir(), "faux-")), "Documents", "cascade");
  mkdirSync(faux, { recursive: true });
  try {
    assert.throws(() => arbreJetable("essai", faux), /test sandbox inside the real tree/,
      "un bac à sable créé sous /Documents/ n'a PAS été refusé : il copie et efface des\n"
      + "  répertoires entiers, donc il effacerait du travail réel.");
  } finally {
    rmSync(faux, { recursive: true, force: true });
  }
});

test("une racine ordinaire passe — sinon le refus ci-dessus ne prouverait rien", () => {
  /* CONTRE-ÉPREUVE. Sans elle, une garde qui refuserait TOUT satisferait le premier cas, et
     la fonction serait morte sans que rien ne le dise. */
  const chemin = arbreJetable("essai-ordinaire");
  try {
    assert.ok(chemin.startsWith(tmpdir()) || chemin.includes("/T/") || chemin.includes("/tmp"),
      `l'arbre n'a pas été créé sous un dossier temporaire : ${chemin}`);
  } finally {
    rmSync(chemin, { recursive: true, force: true });
  }
});

test("un GIT_INDEX_FILE hérité ne touche pas l'index de l'appelant", () => {
  /*
   * Le mécanisme des quatre commits vides du 26 août : hérité d'un crochet, GIT_INDEX_FILE
   * fait écrire le `git add -A` de l'arbre jetable dans l'index du COMMIT EN COURS. On pose la
   * variable sur un faux index, on crée un arbre, et on exige que le faux index n'ait pas
   * grossi d'un octet — c'est lui qui aurait reçu les écritures.
   */
  const faux = join(mkdtempSync(join(tmpdir(), "idx-")), "index-empoisonne");
  writeFileSync(faux, "");
  const avant = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = faux;
  let chemin = "";
  try {
    chemin = arbreJetable("essai-env");
    assert.equal(readFileSync(faux, "utf8"), "",
      "L'ARBRE JETABLE A ÉCRIT DANS L'INDEX DE SON APPELANT : c'est le mécanisme exact des\n"
      + "  quatre commits vides du 26 août, dans l'outil construit pour s'en protéger.");
  } finally {
    if (avant === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = avant;
    if (chemin) rmSync(chemin, { recursive: true, force: true });
  }
});

test("un GIT_DIR hérité ne détourne pas les commits du bac vers le dépôt de l'appelant", () => {
  /*
   * La variable qui a réellement frappé : pendant un `git commit`, le crochet lance la suite
   * et git exporte GIT_DIR — qui GAGNE sur le dossier courant. Le figeage de l'arbre jetable
   * a alors commité dans le worktree de l'appelant : cinq commits « état du disque » y ont
   * emporté du travail non commité sous un message étranger, le 27 août 2026. Le témoin pose
   * GIT_DIR sur un dépôt appât et exige qu'il ne reçoive AUCUN commit.
   */
  const appat = mkdtempSync(join(tmpdir(), "appat-"));
  /*
   * L'INSTRUMENT DOIT ÊTRE IMMUNISÉ CONTRE CE QU'IL MESURE.
   *
   * `compter()` héritait de l'environnement. Lancé par le crochet de pré-commit — le seul
   * moment où ce défaut se produit vraiment — `GIT_DIR` désigne le dépôt de l'appelant, donc
   * `git -C appat rev-list` comptait les commits du VRAI dépôt : « le montage est faux :
   * l'appât porte déjà un commit », sur un montage parfaitement correct. Le cas ne pouvait
   * pas tourner là où il compte.
   *
   * Et `{ ...process.env, GIT_DIR: undefined }` ne retire rien de façon fiable : on emploie
   * le nettoyage que le module expose déjà, plutôt qu'une deuxième liste des sept variables.
   */
  execFileSync("git", ["init", "-q", appat], { env: envGitPropre() });
  const compter = () => {
    try {
      return execFileSync("git", ["-C", appat, "rev-list", "--all", "--count"],
        { encoding: "utf8", env: envGitPropre() }).trim();
    } catch { return "0"; }
  };
  assert.equal(compter(), "0", "le montage est faux : l'appât porte déjà un commit.");
  const avant = process.env.GIT_DIR;
  process.env.GIT_DIR = join(appat, ".git");
  let chemin = "";
  try {
    chemin = arbreJetable("essai-gitdir");
  } finally {
    if (avant === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = avant;
    if (chemin) rmSync(chemin, { recursive: true, force: true });
    execFileSync("git", ["-C", fileURLToPath(new URL("..", import.meta.url)), "worktree", "prune"]);
  }
  assert.equal(compter(), "0",
    "UN COMMIT DU BAC A ATTERRI DANS LE DÉPÔT DE L'APPELANT : c'est le détournement qui a\n"
    + "  emporté le travail d'une session le 27 août — GIT_DIR gagne sur le dossier courant.");
});

test("un bac créé depuis un worktree LIÉ n'est pas accusé de détournement", () => {
  /*
   * L'assertion d'isolement comparait le dépôt du bac à `RACINE/.git`. Depuis un worktree
   * LIÉ — la façon dont travaille chaque session de ce dépôt — `RACINE/.git` est un FICHIER
   * qui pointe ailleurs, et `git worktree add` range l'administration du bac sous le dépôt
   * COMMUN. Le bac était parfaitement isolé et le contrôle criait au détournement, avec un
   * message accusant le défaut qu'il venait fermer : le pire faux positif possible, parce
   * qu'il se lit comme la découverte du vrai.
   *
   * Ce cas monte un dépôt, en tire un worktree lié, et y crée un bac depuis CE worktree.
   */
  const envPropre = envGitPropre();
  const bac = realpathSync(mkdtempSync(join(tmpdir(), "lie-")));
  const source = join(bac, "source");
  const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env: envPropre, encoding: "utf8" });
  try {
    mkdirSync(source);
    g(source, "init", "-q");
    g(source, "config", "user.email", "t@t"); g(source, "config", "user.name", "t");
    writeFileSync(join(source, "f.txt"), "1\n");
    g(source, "add", "f.txt"); g(source, "commit", "-qm", "c1");

    const lie = join(bac, "lie");
    g(source, "worktree", "add", "--detach", "-q", lie, "HEAD");

    /* Le fait que tout repose dessus : depuis le worktree lié, `.git` est un fichier. */
    assert.ok(statSync(join(lie, ".git")).isFile(),
      "`.git` n'est pas un fichier dans ce worktree : le cas ne reproduit pas la situation visée.");

    const admin = execFileSync("git", ["-C", lie, "rev-parse", "--absolute-git-dir"],
      { cwd: lie, env: envPropre, encoding: "utf8" }).trim();
    assert.ok(!admin.startsWith(join(lie, ".git")),
      "l'administration du worktree lié est sous son propre `.git` : la comparaison d'origine\n"
      + "  aurait fonctionné, et ce cas ne garderait rien.");
    const commun = execFileSync("git", ["-C", lie, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: lie, env: envPropre, encoding: "utf8" }).trim();
    assert.ok(admin.startsWith(commun),
      "le dépôt commun ne contient pas l'administration du worktree : la propriété sur laquelle\n"
      + "  repose le contrôle corrigé n'est pas celle qu'on croit.");
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});
