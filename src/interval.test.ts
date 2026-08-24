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
import { wilson, rate, distinguishable, precision } from "./interval.ts";

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

/*
 * ─── `precision()` PRODUIT UN CHIFFRE PUBLIÉ, ET RIEN NE PINNAIT SA VALEUR ───
 *
 * C'est le « ± N points » du README, la marge que l'acheteur lit à côté de chaque taux. Le
 * seul endroit où elle apparaissait dans les cas — `cascade.test.ts:3018` — RECOPIE le calcul
 * que `readme.ts` fait à la ligne 174 : il compare le code à lui-même, ce qui tient toujours,
 * y compris quand les deux sont faux ensemble.
 *
 * Trouvé par le testeur de mutations, pas par une relecture. Il change `((high - low) / 2) *
 * 100` en `(high - low) * 2` et en `/ 100`, et les 244 cas ne voient rien — parce que rien
 * n'affirme jamais ce que cette fonction doit rendre.
 *
 * LES VALEURS CI-DESSOUS SONT CALCULÉES AILLEURS, depuis la définition de Wilson, par une
 * implémentation écrite à part. Les recopier de la sortie de la fonction aurait reproduit
 * exactement le défaut qu'on corrige : un contrôle qui grave la sortie ne la vérifie pas.
 *
 * Les deux extrêmes sont là parce qu'ils sont ce que Wald rate — c'est la propriété qu'on
 * écrit dans VALIDATION.md et qu'on vend à un acheteur sceptique.
 */
test("precision() rend la demi-largeur en points, calculée hors de ce fichier", () => {
  const CAS: [number, number, number][] = [
[0, 20, 8.056506],            /* zéro succès : Wald sortirait de [0, 1], Wilson non */
    [20, 20, 8.056506],       /* et son symétrique, à la même largeur */
    [10, 20, 20.070509],      /* le point le plus large, à p = 0,5 */
    [92, 120, 7.495071],      /* le taux par dossier réellement publié */
    [1, 2, 40.547135],        /* n minuscule : là où Wald rétrécit à tort */
  ];
  for (const [s, n, attendu] of CAS) {
    const vu = precision(s, n);
    assert.ok(Math.abs(vu - attendu) < 1e-6,
      `precision(${s}, ${n}) rend ${vu}, calculé ailleurs à ${attendu}.`);
  }

  /* ET LA RELATION QUI TIENT LA FORMULE : la demi-largeur est bien la moitié de la largeur,
     en points. Sans elle, multiplier par 2 au lieu de diviser passerait sur des cas choisis. */
  for (const [s, n] of CAS) {
    const [bas, haut] = wilson(s, n);
    assert.ok(Math.abs(precision(s, n) - ((haut - bas) / 2) * 100) < 1e-12,
      `precision(${s}, ${n}) n'est plus la demi-largeur de son propre intervalle.`);
  }
});
