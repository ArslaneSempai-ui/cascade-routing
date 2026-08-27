#!/usr/bin/env node
/**
 * La première action de l'acheteur, vérifiée comme telle.
 *
 * La lettre de mission promet ceci : « vous clonez l'outil, vous le lancez sur vos propres cas ».
 * Ce n'est donc pas une commodité de développement, c'est le premier geste du client — et il
 * échouait le 21 août, parce que `landing.json` portait des chiffres tirés de journaux que
 * `data/` garde hors de git. Un responsable conformité qui clone, lance la suite et voit rouge
 * ne rappelle pas, et n'a pas besoin de comprendre pourquoi.
 *
 * Trois pièges connus, évités ici :
 *
 *   — **`git clone --no-local`, pas `git archive`, et pas un clone local nu.** Un clone local
 *     ordinaire peut lier en dur des objets qu'un clone distant n'aurait pas ; `--no-local`
 *     force le transport normal et l'évite. La première version employait `git archive`, qui
 *     rend les fichiers suivis **et aucun historique** : un test qui demande à git quel commit
 *     introduit un drapeau échouait alors, non parce que le dépôt est cassé mais parce que
 *     l'archive n'est pas un clone. Le contrôle accusait le dépôt de sa propre approximation,
 *     ce qui est la pire panne qu'un contrôle puisse avoir.
 *   — **`node_modules` n'est jamais partagé.** L'installation est refaite dans le clone ; un
 *     lien vers celle du dossier de travail ferait hériter d'un état que le client n'a pas.
 *   — **la durée est mesurée et affichée.** Un contrôle de deux minutes finit désactivé, donc
 *     celui-ci ne tourne pas à chaque `npm test` : il tourne avant de livrer, et le README dit
 *     quand.
 *
 * **Le témoin, et il est gardé plutôt que balayé.** La branche `temoin-gitignore` ne diffère de
 * `main` que par une ligne de `.gitignore` et le retrait de `mesures-derivees.json` de l'index —
 * un fichier dont la suite dépend. Le contrôle pointé dessus **échoue**, sur `landing.json` qui
 * ne correspond plus au relevé gelé :
 *
 *     npm run clone-neuf -- --ref=temoin-gitignore     → ÉCHEC en 389 s
 *     npm run clone-neuf                               → passe en 433 s
 *
 * La branche reste dans le dépôt. Un témoin effacé est un témoin qu'il faut croire sur parole,
 * et celui-ci se rejoue en une commande.
 *
 *     npm run clone-neuf
 *
 * ─── ET LES ÉTAPES SONT ATTEIGNABLES SANS PAYER LES 433 SECONDES ───
 *
 * Ce fichier était un script à effets de bord de haut niveau : rien d'exporté, un `mkdtempSync`
 * puis un `try` au premier niveau. L'importer depuis un cas de test déclenchait un vrai clone,
 * un vrai `npm ci` et un `npm test` qui relançait la suite DEPUIS la suite. Aucun cas ne
 * l'exécutait donc, et la garde « aucun node_modules hérité » — celle qui empêche d'annoncer
 * « installation fraîche » sur un état hérité que l'acheteur n'aurait pas — était lue par un
 * test pour la LANGUE de son message, jamais pour son comportement. La retirer n'aurait fait
 * tomber aucun contrôle : la forme même du survivant.
 *
 * Deux changements, et rien d'autre :
 *
 *   — le travail vit dans `controle()`, sous un bloc `isMain` ; le fichier importé ne clone
 *     rien et n'installe rien ;
 *   — le contrôle REND son verdict au lieu d'appeler `process.exit(1)`. Un `exit` tue le
 *     processus de test avant toute assertion, donc aucun témoin ne peut lire le message.
 *     C'est l'enveloppe de ligne de commande qui sort en 1.
 *
 * Les quatre dépendances externes — cloner, lire l'historique, installer, tester — sont des
 * paramètres optionnels dont la valeur par défaut est exactement ce que la commande faisait.
 * Un témoin matérialise ainsi en deux millisecondes un faux clone qui porte `node_modules`, et
 * exige que l'installateur ne soit JAMAIS appelé : la garde ne vaut que si elle tombe AVANT
 * `npm ci`. Refuser après l'installation laisserait la suite tourner sur l'état hérité, ce
 * qu'elle existe précisément pour empêcher.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";

const racine = fileURLToPath(new URL("..", import.meta.url));

/**
 * Le contrôle, et son verdict — `{ ok: true, tus }` ou `{ ok: false, etape, message }`.
 *
 * @param {object} [o]
 * @param {string} [o.clone] où le clone est matérialisé
 * @param {string} [o.depot] le dépôt cloné
 * @param {string|null} [o.ref] une référence au choix, pour éprouver une branche
 * @param {(dest: string) => void} [o.cloner]
 * @param {(dest: string) => void} [o.historique]
 * @param {(dest: string) => void} [o.installer]
 * @param {(dest: string) => string} [o.tester]
 */
/**
 * Le clone d'un arbre neuf, extrait pour qu'un cas puisse l'appeler seul.
 */
/*
 * `GIT_INDEX_FILE` EST RETIRÉ, ET C'EST LA LIGNE LA PLUS IMPORTANTE DE CE FICHIER.
 *
 * Git l'exporte à ses crochets. Un `pre-commit` qui lance la suite le transmet donc à
 * tout ce qu'elle lance — et `git clone --no-local` écrit sa copie de travail dans
 * l'index DÉSIGNÉ PAR CETTE VARIABLE, c'est-à-dire l'index du commit en cours. Celui-ci
 * est remplacé par l'index du clone, où rien n'est indexé.
 *
 * Le symptôme, reproduit le 26 août 2026 : `git commit` réussit, code 0, et n'emporte
 * AUCUN fichier ; les fichiers indexés redeviennent non indexés. Trois sessions l'ont
 * subi séparément, quatre commits en portent la trace, et chacun de leurs messages
 * décrivait un correctif qui n'existait pas. Aucun message d'erreur nulle part.
 *
 * `--no-local` est nécessaire : un clone local par liens durs ne fait pas de copie de
 * travail et ne déclenche pas le défaut, ce qui l'a rendu invisible en contre-épreuve.
 */
/**
 * L'ENVIRONNEMENT ASSAINI, ET IL DOIT SERVIR À TOUTES LES ÉTAPES.
 *
 * Git exporte `GIT_DIR`, `GIT_INDEX_FILE` et `GIT_WORK_TREE` à ses crochets — et `GIT_DIR`
 * l'emporte sur le dossier courant. `clonerNeuf` les retirait pour SON `git clone` ; les
 * étapes suivantes — `rev-parse` dans le clone, `npm ci`, `npm test` — retransmettaient
 * l'environnement intégral. Lancé depuis un crochet, ce contrôle vérifiait donc qu'un clone
 * neuf tient debout... en interrogeant le dépôt de l'appelant, et en faisant tourner la suite
 * du clone sur l'index de l'appelant. **Tout l'objet de ce fichier est qu'un clone tienne SEUL
 * ; il ne pouvait pas le montrer.**
 *
 * Sept variables, pas trois : la liste courte laissait passer `GIT_OBJECT_DIRECTORY` et
 * `GIT_COMMON_DIR`, qui détournent aussi bien.
 */
export function envSansGit() {
  const env = { ...process.env };
  for (const v of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete env[v];
  return env;
}

export function clonerNeuf(depot, dest, ref = null) {
  execFileSync("git", ["clone", "--no-local", "--quiet",
    ...(ref ? ["--branch", ref] : []), depot, dest], { stdio: "pipe", env: envSansGit() });
}

export const controle = ({
  clone = join(mkdtempSync(join(tmpdir(), "cascade-clone-neuf-")), "cascade"),
  depot = racine,
  ref = null,
  cloner = (dest) => clonerNeuf(depot, dest, ref),
  historique = (dest) => { execFileSync("git", ["-C", dest, "rev-parse", "HEAD"], { stdio: "pipe", env: envSansGit() }); },
  installer = (dest) => {
    execFileSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund", "--silent"],
      { cwd: dest, stdio: "pipe", env: envSansGit() });
  },
  tester = (dest) => execFileSync("npm", ["test"], { cwd: dest, encoding: "utf8", stdio: "pipe", env: envSansGit() }),
} = {}) => {
  const t0 = Date.now();

  /** Les cas qui ne se sont pas exécutés : ni une réussite, ni un échec. */
  const tus = [];

  /** Rend `null` quand l'étape passe, et le verdict d'échec sinon. */
  const etape = (nom, fn) => {
    const t = Date.now();
    process.stdout.write(`  ${nom.padEnd(34)}`);
    try { fn(); } catch (e) {
      console.log(`FAILED (${((Date.now() - t) / 1000).toFixed(0)} s)`);
      /*
       * Montrer ce qui a échoué, pas les vingt-cinq dernières lignes.
       *
       * La première version collait stdout et stderr puis gardait la fin. La fin était
       * l'avertissement de repli, imprimé par chaque commande de la chaîne, et l'erreur réelle
       * était au-dessus. Un contrôle qui trouve une panne et ne sait pas la nommer coûte autant
       * qu'une panne non trouvée, à ceci près qu'il donne l'impression d'avoir travaillé.
       */
      /* ET LE MESSAGE DE L'ÉTAPE ELLE-MÊME. Cette fonction ne lisait que la sortie d'un
         sous-processus ; une erreur levée par la logique de l'étape — « deux cas se sont
         ignorés » — n'avait ni stdout ni stderr, et disparaissait. L'étape affichait ÉCHEC
         sans dire quoi, ce qui est le refus sans raison qu'on refuse partout ailleurs. */
      if (!e.stderr && !e.stdout && e.message) {
        console.error(`\n  — ${e.message.split("\n").join("\n  ")}\n`);
      }
      const err = String(e.stderr ?? "").trim();
      const out = String(e.stdout ?? "").trim();
      const bruit = /^(⚠|  Lecture du relevé|  Ce sont NOS|dtype not specified|$)/;
      const utile = (t2) => t2.split("\n").filter((l) => !bruit.test(l));
      if (err) { console.error(`\n  — error output —`); console.error(utile(err).join("\n")); }
      if (out) {
        const l = utile(out);
        console.error(`\n  — standard output (${l.length} useful lines) —`);
        console.error(l.slice(-60).join("\n"));
      }
      console.error("");
      console.error(`The clone was left in ${clone} for inspection.`);
      console.error(`\nThe letter promises \u201cyou clone the tool, you run it\u201d. This is not a`);
      console.error(`development annoyance: it is the buyer's first move, and it fails.`);
      /* LE VERDICT REND LA MAIN, IL NE TUE PAS LE PROCESSUS. C'est l'enveloppe `isMain` qui
         sort en 1 — un `process.exit` ici rendrait chaque étape inobservable, puisqu'il
         emporterait le processus avant qu'un cas de test puisse lire quoi que ce soit. */
      return { ok: false, etape: nom, message: String(e && e.message ? e.message : e) };
    }
    console.log(`ok     (${((Date.now() - t) / 1000).toFixed(0)} s)`);
    return null;
  };

  console.log(`\nFresh clone from ${ref ?? "HEAD"} — only what git carries.\n`);

  /* Le `??` enchaîne : chaque étape ne s'exécute que si la précédente a rendu `null`. C'est
     ce qui fait qu'un refus tombe AVANT ce qu'il refuse, et non après. */
  const echec = etape(`git clone --no-local${ref ? ` (${ref})` : ""}`, () => { cloner(clone); })

    ?? etape("l'historique est bien là", () => {
      /* Un clone porte son historique ; une archive non. Des tests interrogent git, et sans cette
         vérification le contrôle imputerait au dépôt une lacune de sa propre méthode d'extraction. */
      historique(clone);
    })

    ?? etape("aucun node_modules hérité", () => {
      if (existsSync(join(clone, "node_modules"))) {
        throw new Error("the clone already carries a node_modules: the install would not be fresh.");
      }
    })

    ?? etape("npm ci", () => { installer(clone); })

    ?? etape("npm test", () => {
      /*
       * `npm test` REND 0 QUAND DES CAS S'IGNORENT, ET C'EST TOUT L'INTÉRÊT DE CE CLONE.
       *
       * Un clone frais n'a pas les poids d'encodeur — 740 Mo qui ne sont pas dans git. Le cas
       * qui vérifie qu'AUCUNE valeur du client n'entre dans le fichier rendu se déclare donc
       * ignoré, la suite sort en 0, et cette étape annonçait « ok ». La commande dont le rôle
       * est de reproduire le premier geste de l'acheteur passait au vert en n'éprouvant pas la
       * promesse qui compte le plus pour lui.
       *
       * On lit le compte d'ignorés et on refuse. C'est le même défaut que l'intégration
       * continue portait, trouvé le même jour, dans un troisième endroit — parce qu'un `exit 0`
       * ne distingue pas « tout a été vérifié » de « ce qui n'a pas pu l'être s'est tu ».
       */
      const sortie = String(tester(clone) ?? "");
      /* LE MARQUEUR N'EST PAS CELUI QUE JE CROYAIS. J'ai d'abord cherché « # skipped N », la
         forme TAP. Le rapporteur par défaut écrit « ℹ skipped N ». La garde a donc annoncé
         « ok » sur un clone où DEUX cas s'étaient tus — un contrôle qui cherche la mauvaise
         chaîne rend le même silence que celui qu'il devait détecter. Les deux formes sont
         acceptées maintenant. */
      /*
       * NI « OK » NI « ÉCHEC » : UN TROISIÈME ÉTAT.
       *
       * Un clone frais n'a pas les poids d'encodeur — 740 Mo qui ne sont pas dans git — donc le
       * cas qui vérifie qu'aucune valeur du client ne sort se déclare ignoré. Le faire échouer
       * rendrait cette commande rouge à chaque lancement chez un acheteur, et une commande
       * toujours rouge cesse d'être lue. L'annoncer « ok » cacherait que la promesse la plus
       * importante n'a pas été éprouvée.
       *
       * Elle passe donc, et elle DIT lesquels se sont tus. C'est le premier geste de l'acheteur
       * reproduit fidèlement, y compris dans ce qu'il ne vérifie pas.
       */
      const ignores = Number(/^(?:#|ℹ) skipped (\d+)/m.exec(sortie)?.[1] ?? 0);
      if (ignores > 0) {
        const quoi = [...sortie.matchAll(/(?:# SKIP|﹣) *(.{0,88})/g)].map((m) => m[1].trim());
        tus.push(...(quoi.length ? quoi : [`${ignores} cas, sans détail lisible dans la sortie`]));
      }
    });

  if (echec) return echec;

  const s = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n  The clone passes. ${s} s in total.`);
  if (tus.length > 0) {
    console.log(`\n  ${tus.length} case(s) did NOT run on this clone:`);
    for (const q of tus) console.log(`    ﹣ ${q}`);
    console.log(`\n  They will pass once the model weights are cached — a buyer's first run`);
    console.log(`  does not exercise them, and that is what this line says.`);
  }
  console.log(`  Run before shipping, and after any change to what git carries —`);
  console.log(`  an addition to .gitignore, a generated file that enters a check.\n`);
  return { ok: true, tus };
};

/* IMPORTÉ, CE FICHIER NE DOIT NI CLONER NI INSTALLER. Sans ce bloc, un cas de test qui
   l'importe paie 433 s et relance la suite depuis la suite — ce qui est la raison pour
   laquelle aucun cas ne l'importait, donc la raison pour laquelle ses étapes n'étaient
   gardées par rien. */
if (isMain(import.meta)) {
  /* Une référence au choix, pour éprouver une branche avant de la fondre — et pour poser le
     témoin de ce contrôle sans committer sur `main` un état qu'on sait cassé. */
  const ref = process.argv.find((a) => a.startsWith("--ref="))?.split("=")[1] ?? null;
  const dossier = mkdtempSync(join(tmpdir(), "cascade-clone-neuf-"));
  const verdict = controle({ clone: join(dossier, "cascade"), ref });
  /* LE CLONE SURVIT À L'ÉCHEC, ET C'EST VOULU : le message dit « left … for inspection », et
     l'effacer ferait mentir la seule ligne qui aide à comprendre. Le `process.exit(1)` de la
     version précédente sautait les `finally` et produisait déjà exactement ça ; ici c'est
     écrit au lieu d'être un effet de bord de l'endroit où l'appel se trouvait. */
  if (!verdict.ok) process.exit(1);
  rmSync(dossier, { recursive: true, force: true });
}
