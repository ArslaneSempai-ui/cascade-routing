/*
 * LA GARDE QUI N'AVAIT AUCUN TÉMOIN, ET DONT LE MESSAGE ÉTAIT POURTANT LU.
 *
 * `clone-neuf.mjs` porte la promesse de la lettre de mission : « vous clonez l'outil, vous le
 * lancez sur vos propres cas ». Une de ses étapes refuse un clone qui porte DÉJÀ un
 * `node_modules` — sans quoi le contrôle annoncerait « installation fraîche » alors que
 * `npm ci` puis `npm test` auraient tourné sur un état hérité que l'acheteur n'aurait pas.
 *
 * Quatre cas de ce dépôt citaient ce fichier ; aucun ne l'exécutait. Ils le lisaient comme du
 * TEXTE — sa langue, sa présence dans une liste, sa divergence avec `identite`. Le message de
 * cette garde était donc examiné pour son anglais, jamais pour son comportement : en retirer
 * le `throw`, on retirait une chaîne à examiner, et les trois contrôles restaient verts.
 * C'est exactement la forme du survivant.
 *
 * ─── CE QUE CES DEUX CAS ÉPROUVENT, ET CE QU'ILS REFUSENT D'ÉPROUVER ───
 *
 * Pas la garde en isolation : SA PLACE. Une vérification appelée seule prouverait qu'elle sait
 * reconnaître un `node_modules`, et laisserait passer une version qui refuserait APRÈS
 * l'installation — c'est-à-dire une version qui n'empêche rien, puisque `npm ci` et `npm test`
 * auraient déjà tourné sur l'état hérité. Le témoin traverse donc la séquence entière et exige
 * que l'installateur ne soit JAMAIS atteint ; la contre-épreuve exige qu'il le soit.
 *
 * Le faux clone est matérialisé en deux millisecondes au lieu des 433 secondes du vrai. C'est
 * la seule raison pour laquelle ces cas peuvent vivre dans `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { controle, clonerNeuf, envSansGit } from "./clone-neuf.mjs";

/**
 * Lance le contrôle sur un clone fabriqué, et rend ce qu'il a fait, dit et décidé.
 *
 * `peupler` reçoit le chemin du clone et le remplit comme un vrai clone le serait — c'est la
 * seule chose que ces cas font varier.
 */
const surUnFauxClone = (peupler) => {
  const dossier = mkdtempSync(join(tmpdir(), "temoin-clone-neuf-"));
  const clone = join(dossier, "cascade");
  /** Ce que le contrôle a réellement exécuté, dans l'ordre. C'est là qu'est la preuve. */
  const appels = [];
  const dit = [];
  /*
   * La sortie est détournée pendant l'appel, pas supprimée : le refus doit ATTEINDRE le
   * lecteur, et un cas qui ne regarderait pas ce qui s'imprime laisserait passer une étape
   * qui affiche ÉCHEC sans dire quoi. Même montage que `drapeaux.test.ts`, pour la même
   * raison — restauré dans un `finally`, sinon un échec emporte la sortie du rapporteur.
   */
  const ecritInitial = process.stdout.write.bind(process.stdout);
  const erreurInitiale = console.error;
  process.stdout.write = (l) => { dit.push(String(l)); return true; };
  console.error = (...l) => { dit.push(l.map(String).join(" ")); };
  let verdict;
  try {
    verdict = controle({
      clone,
      cloner: (dest) => { mkdirSync(dest, { recursive: true }); peupler(dest); },
      historique: () => { appels.push("git rev-parse"); },
      installer: () => { appels.push("npm ci"); },
      tester: () => { appels.push("npm test"); return ""; },
    });
  } finally {
    process.stdout.write = ecritInitial;
    console.error = erreurInitiale;
    rmSync(dossier, { recursive: true, force: true });
  }
  return { verdict, appels, dit: dit.join("\n") };
};

test("un clone qui porte déjà node_modules est refusé AVANT npm ci, et l'étape le nomme", () => {
  /* Ce que porterait un vrai clone si `.gitignore` cessait d'ignorer `node_modules` — la
     panne exacte que cette garde attend, et la forme même du témoin `temoin-gitignore` que
     l'en-tête du fichier décrit : une branche qui ne diffère que par une ligne. */
  const { verdict, appels, dit } = surUnFauxClone((dest) =>
    mkdirSync(join(dest, "node_modules"), { recursive: true }));

  assert.equal(verdict.ok, false,
    "un clone qui hérite d'un node_modules doit faire échouer le contrôle : sinon `npm ci` et "
    + "`npm test` tournent sur un état que l'acheteur n'a pas, et le vert ne vaut rien.");

  /* L'ÉTAPE, PAS SEULEMENT L'ÉCHEC. Sans ce point, ce cas passerait aussi si le contrôle
     tombait plus loin, pour une tout autre raison. */
  assert.equal(verdict.etape, "aucun node_modules hérité",
    `le contrôle a échoué à l'étape « ${verdict.etape} » et non à celle qui garde l'héritage.`);

  /* LE MESSAGE, MOT POUR MOT : c'est lui que le lecteur voit au pire moment, et c'est la
     seule chose qu'il aura pour comprendre. */
  assert.match(verdict.message,
    /^the clone already carries a node_modules: the install would not be fresh\.$/,
    `message rendu : « ${verdict.message} »`);

  /*
   * ET LE POINT D'APPEL — TOUT L'OBJET DE LA GARDE.
   *
   * Elle ne vaut que si elle tombe AVANT l'installation. Refuser après `npm ci` laisserait la
   * suite tourner sur l'état hérité, ce qu'elle existe précisément pour empêcher. Un témoin
   * qui n'appellerait que la vérification en isolation prouverait la garde, pas sa place.
   */
  assert.deepEqual(appels, ["git rev-parse"],
    `l'installation ne doit pas être atteinte, or la séquence exécutée est : ${appels.join(", ")}.`);

  /*
   * ET LE REFUS DOIT ATTEINDRE LE LECTEUR. La branche `!e.stderr && !e.stdout && e.message`
   * est le SEUL chemin par lequel une erreur levée par l'étape elle-même s'imprime — sans
   * elle, l'étape affiche FAILED sans dire quoi, le refus sans raison qu'on refuse partout
   * ailleurs. Ce `throw` est le seul témoin possible de cette branche-là.
   */
  assert.match(dit, /already carries a node_modules/,
    "l'étape a échoué sans dire pourquoi : le refus sans raison qu'on refuse partout ailleurs.");
  assert.match(dit, /aucun node_modules hérité\s+FAILED/,
    "l'étape doit être nommée à l'écran à côté de son FAILED, sinon le lecteur cherche laquelle.");
});

test("un clone propre franchit l'étape et atteint bien l'installation", () => {
  /*
   * LA CONTRE-ÉPREUVE, sans quoi un `controle` cassé qui échouerait TOUJOURS rendrait le cas
   * ci-dessus vert sans rien prouver. Elle fixe aussi la séquence complète : une garde qui
   * refuserait tout serait indiscernable d'une garde qui refuse ce qu'il faut.
   */
  const { verdict, appels } = surUnFauxClone(() => {});

  assert.equal(verdict.ok, true, `le contrôle a refusé un clone propre : ${verdict.message ?? ""}`);
  assert.deepEqual(appels, ["git rev-parse", "npm ci", "npm test"],
    "sans node_modules hérité la séquence doit se poursuivre jusqu'au bout : sinon la garde "
    + "refuse tout, et le cas précédent ne prouve rien.");
});

/*
 * LE CLONE NE DOIT PAS EMPORTER L'INDEX DE CELUI QUI L'APPELLE.
 *
 * Git exporte `GIT_INDEX_FILE` à ses crochets. Un `pre-commit` qui lance la suite le
 * transmet à tout ce qu'elle lance, et `git clone --no-local` écrit sa copie de travail
 * DANS l'index que cette variable désigne — donc dans l'index du commit en cours, qu'il
 * remplace par le sien, où rien n'est indexé.
 *
 * Symptôme vécu par trois sessions le 25 et 26 août 2026 : `git commit` réussit, code 0,
 * et n'emporte aucun fichier. Quatre commits en portent la trace, et chacun de leurs
 * messages décrivait un correctif qui n'existait pas. Aucune erreur nulle part.
 *
 * `--no-local` compte : un clone local par liens durs ne fait pas de copie de travail et
 * ne déclenche rien. La première contre-épreuve a échoué pour cette seule raison.
 */
test("un clone n'emporte pas l'index de son appelant", () => {
  const d = mkdtempSync(join(tmpdir(), "cascade-index-"));
  const depot = join(d, "depot");
  /*
   * CE CAS DOIT SURVIVRE À SON PROPRE SUJET. Lancé depuis un crochet, il hérite du
   * `GIT_INDEX_FILE` du commit en cours — et alors son `git add` écrit dans l'index de
   * l'appelant au lieu du sien, son assertion de montage tombe en accusant le montage, et
   * le travail indexé de quelqu'un d'autre part avec. Mesuré chez une session voisine :
   * elle a perdu un commit et son arbre s'est retrouvé sur un « base » fabriqué ici.
   * Un cas qui éprouve une fuite d'environnement doit d'abord se protéger de cette fuite.
   */
  const propre = { ...process.env };
  delete propre.GIT_INDEX_FILE; delete propre.GIT_DIR; delete propre.GIT_WORK_TREE;
  const git = (args, cwd = depot, env = propre) =>
    execFileSync("git", args, { cwd, stdio: "pipe", env });

  mkdirSync(depot, { recursive: true });
  git(["init", "--quiet", "-b", "main"]);
  git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
  writeFileSync(join(depot, "f.txt"), "v1\n");
  git(["add", "f.txt"]); git(["commit", "--quiet", "-m", "base"]);

  writeFileSync(join(depot, "g.txt"), "indexé et attendu\n");
  git(["add", "g.txt"]);
  /* `propre` ici aussi : sans lui, la LECTURE de l'index vise celui de l'appelant, et le cas
     rend un verdict sur l'index de quelqu'un d'autre. La protection doit couvrir ce qui lit
     autant que ce qui écrit — c'est la moitié qu'on oublie. */
  const indexe = () => execFileSync("git", ["diff", "--cached", "--name-only", "HEAD"],
    { cwd: depot, encoding: "utf8", env: propre }).trim();
  assert.equal(indexe(), "g.txt", "le montage est faux : rien n'est indexé avant le clone.");

  /*
   * LA VARIABLE EST POSÉE DANS NOTRE PROPRE ENVIRONNEMENT, et c'est tout l'objet du cas.
   * `clonerNeuf` lit `process.env` : sans cette ligne, retirer la parade ne change rien et
   * le cas passe au vert en n'ayant rien éprouvé. Mesuré — la première version de ce témoin
   * restait verte avec le défaut remis, et se serait fait rapporter comme une preuve.
   */
  const poison = join(depot, ".git", "index");   /* l'index DU DÉPÔT JETABLE, jamais celui de l'appelant */
  const avant = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = poison;
  try { clonerNeuf(depot, join(d, "clone"), null); }
  finally {
    if (avant === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = avant;
  }

  assert.equal(indexe(), "g.txt",
    "LE CLONE A VIDÉ L'INDEX DE SON APPELANT. Un commit lancé après lui réussit en\n"
    + "  n'emportant aucun fichier, sans un mot, et son message décrit un travail absent.");

  // Et la contre-épreuve : avec la variable transmise, le défaut EXISTE bel et bien.
  writeFileSync(join(depot, "h.txt"), "second témoin\n");
  git(["add", "h.txt"]);
  execFileSync("git", ["clone", "--no-local", "--quiet", depot, join(d, "clone2")],
    { stdio: "pipe", env: { ...process.env, GIT_INDEX_FILE: poison } });
  assert.notEqual(indexe(), "g.txt\nh.txt",
    "le défaut ne se reproduit plus : ce cas ne prouve donc plus rien sur la parade.");
});

/*
 * TOUT L'OBJET DE CE FICHIER EST QU'UN CLONE TIENNE SEUL — ET IL NE POUVAIT PAS LE MONTRER.
 *
 * `clonerNeuf` retirait `GIT_DIR`, `GIT_INDEX_FILE` et `GIT_WORK_TREE` pour SON `git clone`.
 * Les étapes suivantes — `rev-parse` dans le clone, `npm ci`, `npm test` — retransmettaient
 * l'environnement intégral. Lancé depuis un crochet, ce contrôle interrogeait donc le dépôt de
 * l'APPELANT et faisait tourner la suite sur son index.
 */
test("les étapes réelles ne transmettent aucune variable git", () => {
  /*
   * LA VÉRIFICATION QUI COMPTE : on lit la SOURCE des étapes par défaut. Les faire tourner
   * pour de bon demanderait un clone complet et un `npm ci` — plusieurs minutes — et ce qui
   * décide tient dans ce qu'elles passent à `execFileSync`.
   *
   * Un motif sur le texte est une affirmation : celui-ci porte son témoin, puisque
   * `envSansGit` doit exister et retirer les sept noms, ce que le cas éprouve en dessous.
   */
  const src = readFileSync(fileURLToPath(new URL("./clone-neuf.mjs", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  const appels = [...src.matchAll(/execFileSync\(([\s\S]*?)\n?\s*\);/g)].map((m) => m[0]);
  assert.ok(appels.length >= 4, `${appels.length} appel(s) trouvé(s) : la lecture a échoué.`);
  const nus = appels.filter((a) => !/env:\s*envSansGit\(\)/.test(a));
  assert.deepEqual(nus.map((a) => a.slice(0, 60)), [],
    "une étape lance une commande sans assainir l'environnement : lancée depuis un crochet,\n"
    + "  elle regarde le dépôt de l'appelant. `GIT_DIR` l'emporte sur le dossier courant.");

  /*
   * LES SEPT SONT POSÉES AVANT, ET C'EST TOUT LE CAS.
   *
   * Ma première version n'en posait qu'une : les six autres étaient absentes de
   * `process.env`, donc `e[v]` valait `undefined` de toute façon et l'assertion passait sans
   * rien regarder. Réduire l'assainissement à trois noms ne la faisait pas rougir. Une
   * assertion sur une absence ne vaut que si la présence a été fabriquée.
   */
  const NOMS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"];
  const avant = Object.fromEntries(NOMS.map((v) => [v, process.env[v]]));
  for (const v of NOMS) process.env[v] = `/tmp/pas-le-bon-${v}`;
  try {
    const e = envSansGit();
    for (const v of NOMS) {
      assert.equal(process.env[v], `/tmp/pas-le-bon-${v}`, `le montage est faux : ${v} n'est pas posée.`);
      assert.equal(e[v], undefined, `${v} traverse l'assainissement.`);
    }
    assert.ok(e.PATH, "PATH a été retiré aussi : les commandes ne se lanceraient plus.");
  } finally {
    for (const v of NOMS) {
      if (avant[v] === undefined) delete process.env[v]; else process.env[v] = avant[v];
    }
  }
});
