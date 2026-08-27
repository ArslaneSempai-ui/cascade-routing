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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { arbreJetable } from "./arbre-jetable.ts";

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
  execFileSync("git", ["init", "-q", appat], { env: { ...process.env, GIT_DIR: undefined } as NodeJS.ProcessEnv });
  const compter = () => {
    try {
      return execFileSync("git", ["-C", appat, "rev-list", "--all", "--count"],
        { encoding: "utf8" }).trim();
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
