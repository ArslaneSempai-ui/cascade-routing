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
 *   — **`git archive`, pas `git clone <chemin>`.** Un clone local peut hériter d'objets qu'un
 *     clone distant n'aurait pas. L'archive rend exactement les fichiers suivis à HEAD, ce que
 *     reçoit quelqu'un qui clone depuis un dépôt distant.
 *   — **`node_modules` n'est jamais partagé.** L'installation est refaite dans le clone ; un
 *     lien vers celle du dossier de travail ferait hériter d'un état que le client n'a pas.
 *   — **la durée est mesurée et affichée.** Un contrôle de deux minutes finit désactivé, donc
 *     celui-ci ne tourne pas à chaque `npm test` : il tourne avant de livrer, et le README dit
 *     quand.
 *
 *     npm run clone-neuf
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const t0 = Date.now();
const dossier = mkdtempSync(join(tmpdir(), "cascade-clone-neuf-"));
const clone = join(dossier, "cascade");

const etape = (nom, fn) => {
  const t = Date.now();
  process.stdout.write(`  ${nom.padEnd(34)}`);
  try { fn(); } catch (e) {
    console.log(`ÉCHEC  (${((Date.now() - t) / 1000).toFixed(0)} s)`);
    const sortie = [e.stdout, e.stderr].filter(Boolean).map(String).join("\n").trim();
    console.error(`\n${sortie.split("\n").slice(-25).join("\n")}\n`);
    console.error(`Le clone est resté dans ${clone} pour inspection.`);
    console.error(`\nLa lettre promet « vous clonez l'outil, vous le lancez ». Ce n'est pas une`);
    console.error(`gêne de développement : c'est le premier geste de l'acheteur, et il échoue.`);
    process.exit(1);
  }
  console.log(`ok     (${((Date.now() - t) / 1000).toFixed(0)} s)`);
};

try {
  console.log(`\nClone neuf depuis HEAD — seulement ce que git transporte.\n`);

  etape("git archive HEAD → dossier vide", () => {
    execFileSync("bash", ["-c",
      `mkdir -p '${clone}' && git -C '${racine}' archive HEAD | tar -x -C '${clone}'`],
      { stdio: "pipe" });
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
    execFileSync("npm", ["test"], { cwd: clone, stdio: "pipe" });
  });

  const s = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n  Le clone passe. ${s} s au total.`);
  console.log(`  À lancer avant de livrer, et après tout changement de ce que git transporte —`);
  console.log(`  un ajout au .gitignore, un fichier produit qui entre dans un contrôle.\n`);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}
