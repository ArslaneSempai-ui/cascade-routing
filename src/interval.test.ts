/**
 * LES TÉMOINS DE L'INTERVALLE.
 *
 * Fichier neuf plutôt qu'un ajout à `cascade.test.ts` : trois sessions travaillent dans ce
 * dépôt et ce fichier-là appartient à quelqu'un. Un fichier neuf ne peut entrer en collision
 * avec personne.
 *
 * Ce qui est éprouvé ici n'est pas que Wilson soit juste — il l'est, recalculé depuis la
 * définition contre une implémentation écrite à part, dix-neuf couples, accord à 1e-12. Ce
 * qui est éprouvé, c'est **ce que le module fait quand on lui donne l'impossible**, parce que
 * c'est là qu'il choisissait une branche en silence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { wilson, rate, distinguishable } from "./interval.ts";

test("un compte de succès hors de [0, n] est refusé, pas absorbé", () => {
  for (const [s, n] of [[2, 1], [-1, 10], [NaN, 10], [21, 20]] as const) {
    assert.throws(() => wilson(s, n), /outside \[0, n\]/,
      `wilson(${s}, ${n}) doit refuser : sans ça il rend [NaN, NaN], et un NaN se compare `
      + "silencieusement comme « non séparable »");
  }
});

test("les entrées légitimes sont inchangées — sinon la garde a coûté la mesure", () => {
  /* Les trois bornes ci-dessous ont été recalculées avec une implémentation indépendante du
     score de Wilson. Elles sont ici en dur pour que la garde ne puisse pas les déplacer. */
  assert.deepEqual(wilson(0, 0), [0, 1], "aucune information rend l'intervalle plein");
  const [b1, h1] = wilson(80, 400);
  assert.equal(b1.toFixed(4), "0.1637");
  assert.equal(h1.toFixed(4), "0.2420");
  const [b2, h2] = wilson(20, 20);
  assert.equal(b2.toFixed(4), "0.8389");
  assert.equal(h2, 1, "p = 1 borne à 1, pas au-dessus");
  const [b3] = wilson(0, 20);
  assert.equal(b3, 0, "p = 0 borne à 0, pas en dessous");
});

test("comparer l'incomparable est un refus, pas un « équivalents »", () => {
  const bon = rate(73, 400);
  const casse = { ...rate(80, 400), low: NaN, high: NaN };
  assert.throws(() => distinguishable(bon, casse), /is not a number/,
    "rendre `false` ici fait lire « non séparables », donc « équivalents », donc la règle "
    + "« prends le moins cher » retient un palier cassé parce qu'il est rapide");
  assert.throws(() => distinguishable(casse, bon), /is not a number/,
    "et dans l'autre sens : une garde qui ne tient que d'un côté ne tient pas");
});

test("la comparaison normale n'a pas changé", () => {
  /* Le cas publié : deux taux dont les intervalles se recouvrent ne sont PAS séparables.
     Sans ce témoin, le vert au-dessus prouverait seulement que la garde refuse tout. */
  assert.equal(distinguishable(rate(73, 400), rate(80, 400)), false,
    "18,2 % contre 20,1 % sur 400 est une phrase sur du bruit");
  assert.equal(distinguishable(rate(50, 400), rate(380, 400)), true,
    "et deux taux nettement séparés doivent rester séparables");
});
