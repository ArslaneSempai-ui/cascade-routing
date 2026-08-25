/*
 * UNE EXPRESSION RÉGULIÈRE DU CLIENT PEUT NE PAS S'ARRÊTER.
 *
 * Mesuré le 25 août 2026 : `(a+)+$` sur **un seul cas de 61 caractères** occupait le
 * processus **162 179 ms**, en silence, puis se faisait rapporter comme un palier ordinaire
 * — donc dans le temps par palier, le chiffre que ce dépôt vend.
 *
 * Une règle qui ne s'arrête pas n'est pas une règle lente : c'est une règle qu'on ne peut
 * pas évaluer. Ces cas éprouvent les trois conséquences : elle est bornée, elle est refusée
 * plutôt que chronométrée, et le compte de ce qui a été écarté voyage avec le chiffre.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluerRegles, direLesRefus, MS_PAR_EVALUATION } from "./regles-bornees.ts";

/* Le coût de ce motif double tous les deux caractères : n=20 coûte quelques dizaines de
   millisecondes, n=26 en coûte des centaines, n=61 ne finit pas. */
const dur = (n: number) => "a".repeat(n) + "b";

test("une règle qui ne s'arrête pas est refusée, en nommant le cas", async () => {
  const r = await evaluerRegles({ supplier: /(a+)+$/ }, [dur(61)], 250);

  assert.deepEqual(Object.keys(r.valeurs), [], "aucune valeur, donc aucune ligne de palier.");
  assert.match(r.refusees["supplier"]!, /did not finish within 250 ms on case 1 of 1/);
  assert.equal(r.ms["supplier"], undefined,
    "et surtout : AUCUN temps enregistré. Le chronométrer le ferait entrer dans le chiffre\n"
    + "  par palier et ferait passer cet outil pour lent à cause du motif d'un client.");
});

test("une règle ordinaire traverse, avec ses valeurs et son temps", async () => {
  const r = await evaluerRegles({ supplier: /Acme Ltd|Globex/ },
    ["Invoice from Globex dated…", "Invoice from Acme Ltd dated…", "no supplier here"]);

  assert.deepEqual(r.valeurs["supplier"], ["Globex", "Acme Ltd", ""],
    "témoin positif : le vert doit être atteignable, et porter les bonnes valeurs.");
  assert.deepEqual(r.refusees, {});
  assert.ok(Number.isFinite(r.ms["supplier"]), "un temps mesuré, pas un NaN.");
});

test("beaucoup d'évaluations courtes passent, une évaluation qui diverge est refusée", async () => {
  /*
   * PREMIÈRE VERSION DE CE CAS : quarante chaînes calibrées pour coûter « quelques dizaines
   * de millisecondes » chacune, et l'affirmation que leur total dépassait la borne sans
   * qu'aucune ne la franchisse. Instable, et une session pair a rendu le diagnostic plutôt
   * qu'une impression : lancé seul ✔ 702 · 687 · 712 ms, dans la suite complète ✖ 253 · 253.
   * Dans la suite, un des quarante franchissait 250 ms tout seul, était refusé, et la
   * première assertion tombait — le cas était PLUS RAPIDE quand il échouait.
   *
   * C'est la faute qu'on corrige partout ailleurs, appliquée à un témoin : **un seuil
   * calibré sur une machine.** La borne de 250 ms dans le code est bonne, elle a sa
   * provenance et elle protège le client ; c'est le témoin qui ne peut pas dépendre du
   * temps réel.
   *
   * Ce qui reste ici ne dépend d'aucune vitesse : beaucoup d'évaluations en microsecondes
   * passent, une évaluation qui ne rend pas la main est refusée. Le réarmement de la borne,
   * lui, se prouve sur la forme — voir le cas suivant — parce que l'entrée qui le
   * discriminerait serait précisément celle dont le coût dépend de la machine.
   */
  const beaucoup = await evaluerRegles({ a: /Globex/ },
    Array.from({ length: 500 }, (_, i) => `Invoice ${i} from Globex`));
  assert.deepEqual(beaucoup.refusees, {}, "aucune évaluation courte ne doit être refusée.");
  assert.equal(beaucoup.valeurs["a"]!.length, 500);

  const unSeul = await evaluerRegles({ a: /(a+)+$/ }, [dur(61)], 250);
  assert.ok(unSeul.refusees["a"], "une évaluation qui ne rend pas la main est refusée.");
});

test("la borne est réarmée à chaque cas, pas posée une fois pour la passe", () => {
  /*
   * Une borne posée une seule fois est une borne sur le TOTAL : elle confondrait « gros
   * corpus honnête » et « motif qui ne termine pas ». La différence ne se voit pas sur une
   * entrée dont le coût est indépendant de la machine — cinquante mille évaluations
   * triviales tiennent en 74 ms mesurées, très en dessous de la borne — donc elle se lit
   * sur la source, qui, elle, ne dépend d'aucune vitesse.
   */
  const src = readFileSync(fileURLToPath(new URL("./regles-bornees.ts", import.meta.url)), "utf8");
  const handler = src.slice(src.indexOf('w.on("message"'), src.indexOf('w.on("error"'));

  assert.match(handler, /clearTimeout\(minuteur\)/,
    "sans annuler la borne en cours, elle tire pendant l'évaluation suivante.");
  assert.match(handler, /armer\(\)/,
    "et sans la réarmer, la première borne posée devient une borne sur la passe entière.");
});

test("le compte des refus voyage avec le chiffre", async () => {
  const r = await evaluerRegles(
    { bonne: /Globex/, mauvaise: /(a+)+$/ }, [dur(61)], 250);

  const phrase = direLesRefus(r)!;
  assert.match(phrase, /1 of your 2 rule\(s\) were refused/,
    "un chiffre issu d'une sélection porte le compte de ce qu'il écarte.");
  assert.match(phrase, /covers 1 rule\(s\), not 2/, "et le dénominateur est dit.");
  assert.match(phrase, /not measured as slow/, "la raison, pas seulement le fait.");

  assert.equal(direLesRefus({ valeurs: { a: [] }, refusees: {}, ms: { a: 1 } }), undefined,
    "témoin : rien à dire quand rien n'est refusé.");
});

test("la borne par défaut est bien au-dessus du coût de démarrage du fil", () => {
  assert.equal(MS_PAR_EVALUATION, 250);
  assert.ok(MS_PAR_EVALUATION > 20,
    "le démarrage du fil coûte une vingtaine de millisecondes, une fois par règle : une\n"
    + "  borne en dessous refuserait toutes les règles, y compris les bonnes.");
});

test("le programme SE TERMINE après un refus, et pas seulement le refus s'affiche",
  { timeout: 120_000 }, async () => {
  /*
   * ─── LE REFUS S'AFFICHAIT, ET LA COMMANDE NE RENDAIT JAMAIS LA MAIN ───
   *
   * Trouvé le 25 août 2026 par mutation du point d'appel : retirer `void w.terminate()` de
   * `regles-bornees.ts` laisse la suite ENTIÈREMENT VERTE. Mesuré :
   *
   *     avec terminate()   refus rendu, le programme se termine
   *     sans terminate()   refus rendu en 253 ms — MÊME message — et le programme
   *                        ne se termine JAMAIS
   *
   * Le fil continue d'évaluer la regex catastrophique après que la promesse a été résolue.
   * Chez le client, la commande imprime son refus et reste là.
   *
   * POURQUOI AUCUN CAS NE LE VOYAIT : les six autres appellent la fonction et lisent sa
   * valeur de retour. Ils vérifient donc que le refus est RENDU — ce qui reste vrai sans
   * `terminate()`. Un cas de forme exigeait même `clearTimeout` et `armer()`, les deux
   * choses auxquelles on avait pensé, et jamais `terminate()`.
   *
   * La seule façon de le voir est de lancer un PROCESSUS et de regarder s'il meurt. Une
   * valeur de retour ne dit rien sur ce qui continue de tourner derrière elle.
   */
  /*
   * LE PROGRAMME S'ÉCRIT DANS UN FICHIER, IL NE SE PASSE PAS PAR `-e`.
   *
   * Premier jet : `node --input-type=module -e`. Le `Worker` en hérite et refuse de démarrer
   * — « --input-type can only be used with string input » — donc `evaluerRegles` rendait bien
   * un refus, mais celui du chemin d'ERREUR, en 9 ms, sans jamais atteindre la borne.
   * L'assertion sur `/refus:/` passait sur la mauvaise cause, et le cas prétendait éprouver
   * l'arrêt d'un fil qui n'avait jamais démarré. Mesuré : 253 ms et le vrai message de borne
   * dès que le programme vit dans un fichier.
   */
  const dossier = mkdtempSync(join(tmpdir(), "borne-"));
  const script = join(dossier, "essai.mjs");
  writeFileSync(script, `
    import { evaluerRegles } from ${JSON.stringify(fileURLToPath(new URL("./regles-bornees.ts", import.meta.url)))};
    const r = await evaluerRegles({ champ: /(a+)+$/ }, ["a".repeat(40) + "!"], 250);
    console.log("refus:" + (r.refusees.champ ?? "aucun"));
  `);
  const debut = Date.now();
  const fils = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "";
  fils.stdout.on("data", (d) => { sortie += String(d); });

  const fini = await new Promise<boolean>((resoudre) => {
    const couperet = setTimeout(() => { fils.kill("SIGKILL"); resoudre(false); }, 20_000);
    fils.on("exit", () => { clearTimeout(couperet); resoudre(true); });
  });
  const ms = Date.now() - debut;

  /* CONTRE-ÉPREUVE DANS L'AUTRE SENS : sans elle, un programme qui s'arrêterait pour une
     tout autre raison — une erreur d'import, par exemple — passerait ce cas. */
  /* Le refus doit venir de LA BORNE, pas d'un fil qui n'a pas démarré : sans cette
     précision, le cas passe sur une erreur d'environnement en croyant mesurer un arrêt. */
  assert.match(sortie, /refus:did not finish within/,
    `le refus ne vient pas de la borne, donc ce cas n'éprouve pas ce qu'il croit.\n`
    + `  sortie : ${JSON.stringify(sortie.slice(0, 200))}`);

  assert.ok(fini,
    `le programme ne s'est PAS terminé en ${ms} ms alors que le refus a été rendu. Le fil de\n`
    + "  travail continue d'évaluer la regex derrière la promesse résolue : chez un client, la\n"
    + "  commande imprime son refus et reste là. Il manque `void w.terminate()` sur le chemin\n"
    + "  d'arrêt — et aucune valeur de retour ne peut le dire.");
});
