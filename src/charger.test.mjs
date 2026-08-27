/*
 * UN FILS DE CHARGE QUI SURVIT À SON PÈRE SATURE UN CŒUR POUR TOUJOURS.
 *
 * `for(;;){}` n'atteint jamais la boucle d'événements : le fils ne traite aucun signal et ne
 * voit pas la fermeture du canal IPC. Le père tue ses fils sur SIGINT, SIGTERM et à
 * l'échéance — mais s'il meurt en SIGKILL (supervision, OOM, `kill -9`), personne ne les tue.
 *
 * Contre-épreuve faite le 27 août 2026 avec l'ancien comportement, sur un père tué en -9 :
 * le fils tournait encore cinq secondes plus tard, et rien ne l'aurait arrêté. Elle n'est pas
 * rejouée ici — laisser tourner une boucle infinie sur une machine où cinq autres sessions
 * mesurent des temps réels est précisément la panne que ce cas ferme.
 *
 * Ce cas éprouve les DEUX sorties autonomes : l'échéance, et la disparition du père.
 */

/* piege:ok harnais-sans-remise-a-neuf — les seuls lancements de ce fichier sont `ps` et `pgrep`
   (lecture pure) et le chargeur lui-meme, lance dans son propre processus. Rien n'ecrit dans
   l'arbre de travail pendant la boucle, donc aucun verdict ne decide de celui du suivant : le
   mal que la regle decrit — un banc qui mesure son propre bruit — n'a pas de prise ici. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const charger = fileURLToPath(new URL("./charger.mjs", import.meta.url));
const dors = (ms) => new Promise((r) => setTimeout(r, ms));
const vivant = (pid) => spawnSync("ps", ["-o", "pid=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim() !== "";
const enfantsDe = (pid) => spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
  .stdout.split("\n").map((x) => x.trim()).filter(Boolean).map(Number);

test("un fils de charge s'arrête tout seul quand son père est tué sans préavis", { timeout: 60_000 }, async () => {
  /* Une seule boucle : un cœur, quelques secondes. Le cas ne doit pas coûter ce qu'il évite. */
  const pere = spawn(process.execPath, [charger, "1", "45"], { stdio: "ignore" });
  let fils = [];
  try {
    for (let i = 0; i < 40 && fils.length === 0; i++) { await dors(100); fils = enfantsDe(pere.pid); }
    assert.equal(fils.length, 1, `${fils.length} fils lancé(s) : le montage n'a pas démarré.`);

    /* SIGKILL : le père n'exécute rien, exactement comme une supervision qui le tue. */
    process.kill(pere.pid, "SIGKILL");
    await dors(500);
    assert.equal(vivant(pere.pid), false, "le père n'est pas mort : le cas ne reproduit rien.");

    let parti = false;
    for (let i = 0; i < 60 && !parti; i++) { await dors(250); parti = !vivant(fils[0]); }
    assert.ok(parti,
      `le fils ${fils[0]} tourne encore quinze secondes après la mort de son père.\n`
      + "  `for(;;){}` ne traite aucun signal et ne voit pas la fermeture du canal : sans une\n"
      + "  vérification DANS la boucle, un cœur reste saturé indéfiniment, et sur cette machine\n"
      + "  ça fausse les temps mesurés par toutes les autres sessions.");
  } finally {
    /*
     * piege:ok catch-muet — nettoyage : `process.kill` sur un pid déjà mort lève `ESRCH`, et
     * c'est le cas COURANT ici puisque le cas vient précisément de vérifier que le processus
     * s'est arrêté. Nommer cette panne-là ferait crier le chemin normal, et un avis qui crie
     * toujours cesse d'être lu.
     *
     * La propriété qui compte n'est pas avalée : elle est tenue par l'assertion du corps —
     * « le fils tourne encore quinze secondes après la mort de son père » et « le fils ignore
     * son échéance une fois le père parti ». Si le nettoyage échouait pour une autre raison
     * qu'un processus déjà parti, ces deux-là auraient déjà rougi avant d'y arriver.
     */
    for (const f of fils) { try { process.kill(f, "SIGKILL"); } catch { /* déjà parti (ESRCH) */ } }
    try { process.kill(pere.pid, "SIGKILL"); } catch { /* déjà parti (ESRCH) */ }
  }
});

test("un fils de charge s'arrête à l'échéance, même si son père l'oublie", { timeout: 60_000 }, async () => {
  /*
   * TÉMOIN DE L'AUTRE SORTIE. Le père pose déjà un `setTimeout` qui tue ses fils ; si ce cas
   * ne regardait que lui, il passerait au vert sans rien dire de l'autonomie du fils. On tue
   * donc le père AVANT son échéance, et on exige que le fils s'arrête quand même à l'heure.
   */
  const pere = spawn(process.execPath, [charger, "1", "3"], { stdio: "ignore" });
  let fils = [];
  try {
    for (let i = 0; i < 40 && fils.length === 0; i++) { await dors(100); fils = enfantsDe(pere.pid); }
    assert.equal(fils.length, 1, `${fils.length} fils lancé(s) : le montage n'a pas démarré.`);
    process.kill(pere.pid, "SIGKILL");

    let parti = false;
    for (let i = 0; i < 60 && !parti; i++) { await dors(250); parti = !vivant(fils[0]); }
    assert.ok(parti, `le fils ${fils[0]} ignore son échéance une fois le père parti.`);
  } finally {
    /*
     * piege:ok catch-muet — nettoyage : `process.kill` sur un pid déjà mort lève `ESRCH`, et
     * c'est le cas COURANT ici puisque le cas vient précisément de vérifier que le processus
     * s'est arrêté. Nommer cette panne-là ferait crier le chemin normal, et un avis qui crie
     * toujours cesse d'être lu.
     *
     * La propriété qui compte n'est pas avalée : elle est tenue par l'assertion du corps —
     * « le fils tourne encore quinze secondes après la mort de son père » et « le fils ignore
     * son échéance une fois le père parti ». Si le nettoyage échouait pour une autre raison
     * qu'un processus déjà parti, ces deux-là auraient déjà rougi avant d'y arriver.
     */
    for (const f of fils) { try { process.kill(f, "SIGKILL"); } catch { /* déjà parti (ESRCH) */ } }
    try { process.kill(pere.pid, "SIGKILL"); } catch { /* déjà parti (ESRCH) */ }
  }
});
