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
