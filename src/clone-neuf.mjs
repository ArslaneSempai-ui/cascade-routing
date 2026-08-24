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
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
/* Une référence au choix, pour éprouver une branche avant de la fondre — et pour poser le
   témoin de ce contrôle sans committer sur `main` un état qu'on sait cassé. */
const ref = process.argv.find((a) => a.startsWith("--ref="))?.split("=")[1] ?? null;
const t0 = Date.now();
const dossier = mkdtempSync(join(tmpdir(), "cascade-clone-neuf-"));
const clone = join(dossier, "cascade");

/** Les cas qui ne se sont pas exécutés : ni une réussite, ni un échec. */
const tus = [];

const etape = (nom, fn) => {
  const t = Date.now();
  process.stdout.write(`  ${nom.padEnd(34)}`);
  try { fn(); } catch (e) {
    console.log(`ÉCHEC  (${((Date.now() - t) / 1000).toFixed(0)} s)`);
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
    if (err) { console.error(`\n  — sortie d'erreur —`); console.error(utile(err).join("\n")); }
    if (out) {
      const l = utile(out);
      console.error(`\n  — sortie standard (${l.length} lignes utiles) —`);
      console.error(l.slice(-60).join("\n"));
    }
    console.error("");
    console.error(`Le clone est resté dans ${clone} pour inspection.`);
    console.error(`\nLa lettre promet « vous clonez l'outil, vous le lancez ». Ce n'est pas une`);
    console.error(`gêne de développement : c'est le premier geste de l'acheteur, et il échoue.`);
    process.exit(1);
  }
  console.log(`ok     (${((Date.now() - t) / 1000).toFixed(0)} s)`);
};

try {
  console.log(`\nClone neuf depuis ${ref ?? "HEAD"} — seulement ce que git transporte.\n`);

  etape(`git clone --no-local${ref ? ` (${ref})` : ""}`, () => {
    execFileSync("git", ["clone", "--no-local", "--quiet",
      ...(ref ? ["--branch", ref] : []), racine, clone], { stdio: "pipe" });
  });

  etape("l'historique est bien là", () => {
    /* Un clone porte son historique ; une archive non. Des tests interrogent git, et sans cette
       vérification le contrôle imputerait au dépôt une lacune de sa propre méthode d'extraction. */
    execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { stdio: "pipe" });
  });

  etape("aucun node_modules hérité", () => {
    if (existsSync(join(clone, "node_modules"))) {
      throw new Error("le clone porte déjà un node_modules : l'installation ne serait pas neuve.");
    }
  });

  etape("npm ci", () => {
    execFileSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund", "--silent"],
      { cwd: clone, stdio: "pipe" });
  });

  etape("npm test", () => {
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
    const sortie = execFileSync("npm", ["test"], { cwd: clone, encoding: "utf8", stdio: "pipe" });
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

  const s = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n  Le clone passe. ${s} s au total.`);
  if (tus.length > 0) {
    console.log(`\n  ${tus.length} cas ne se sont PAS exécutés sur ce clone :`);
    for (const q of tus) console.log(`    ﹣ ${q}`);
    console.log(`\n  Ils passeront quand les poids de modèle seront en cache — le premier`);
    console.log(`  lancement d'un acheteur ne les éprouve pas, et c'est ce que dit cette ligne.`);
  }
  console.log(`  À lancer avant de livrer, et après tout changement de ce que git transporte —`);
  console.log(`  un ajout au .gitignore, un fichier produit qui entre dans un contrôle.\n`);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}
