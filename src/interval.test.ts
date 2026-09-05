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
import { wilson, rate, distinguishable, precision , pairedVerdict, cellulesDeTaux, writeRate, ENOUGH } from "./interval.ts";

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

test("la binomiale appariée survit au-delà de mille paires discordantes", () => {
  /*
   * LE CORRECTIF EXISTAIT, SON TÉMOIN NON.
   *
   * `Math.pow(2, discordant)` valait Infinity dès 1024, et les coefficients binomiaux
   * débordaient avec. Selon lequel des deux débordait le premier, `p` sortait `0` ou `NaN` —
   * et `NaN < 0.05` vaut `false`, donc le verdict tombait sur « ne distingue pas » sans
   * qu'aucun calcul n'ait abouti. L'arithmétique est passée en BigInt ; **rien ne l'éprouvait
   * au-delà de vingt-cinq paires**, et un correctif sans témoin se fait défaire au premier
   * remaniement qui trouve les BigInt encombrants.
   *
   * Les valeurs de référence viennent d'un calcul en entiers exacts fait à part, pas de ce
   * module : un témoin qui reprend l'arithmétique qu'il éprouve ne prouve rien.
   */
  const a = pairedVerdict(548, 481);
  assert.ok(Number.isFinite(a.p!), `p doit être un nombre, obtenu ${a.p}`);
  assert.equal(a.p!.toFixed(4), "0.0396");
  assert.equal(a.decidable, true,
    "cet échantillon distingue les deux versions ; répondre le contraire refuse une trouvaille "
    + "qu'on a — et personne ne conteste un outil qui dit « je ne peux pas conclure »");

  const b = pairedVerdict(560, 470);
  assert.equal(b.p!.toFixed(4), "0.0055");
  assert.equal(b.decidable, true);
});

test("l'équilibre parfait sur un grand échantillon vaut p = 1, pas 0 ni NaN", () => {
  /* La direction qui garde la garde honnête : au-delà du seuil de débordement, un partage
     exactement égal ne doit rien conclure du tout. Sans ce cas, un vert prouverait seulement
     que la fonction rend « séparables » à tout coup. */
  const eq = pairedVerdict(1800, 1800);
  assert.equal(eq.p, 1, `partage égal : p = 1 attendu, obtenu ${eq.p}`);
  assert.equal(eq.decidable, false);
});

test("les petits échantillons n'ont pas bougé", () => {
  /* Recalculés à part, en entiers. Si le passage aux BigInt avait déplacé un chiffre publié,
     c'est ici que ça se verrait — et nulle part ailleurs, `outils.test.ts` ne dépassant pas
     vingt-cinq paires discordantes. */
  assert.equal(pairedVerdict(10, 0).p!.toFixed(6), "0.001953");
  assert.equal(pairedVerdict(3, 7).p!.toFixed(6), "0.343750");
  assert.equal(pairedVerdict(530, 470).p!.toFixed(6), "0.062023");
  assert.equal(pairedVerdict(0, 0).decidable, false, "aucun cas n'a changé de verdict");
});

/*
 * LA CONDITION DE PUBLICATION NE VIT QU'À UN ENDROIT.
 *
 * Le rapport écrit au client fabriquait ses cellules à la main et ne regardait jamais
 * `reportable`. La console refusait « 100 % » sur un dossier ; le fichier l'écrivait. Le
 * fichier est celui qu'on classe et qu'on transfère.
 */
test("un taux sous le seuil ne se cite pas, dans un tableau comme dans la console", () => {
  for (const [s, n] of [[1, 1], [3, 3], [15, 19]] as const) {
    const c = cellulesDeTaux(rate(s, n));
    assert.ok(!/%/.test(c.taux),
      `n=${n} : « ${c.taux} » cite un pourcentage que la console refuse de citer.`);
    assert.match(c.intervalle, new RegExp(`n < ${ENOUGH}`), "et la cellule dit pourquoi.");
    assert.match(writeRate(rate(s, n)), /too few to quote/, "témoin : la console refuse bien.");
  }
});

test("au seuil, les deux chemins citent le même chiffre", () => {
  const r = rate(16, ENOUGH);
  const c = cellulesDeTaux(r);
  assert.equal(c.taux, "80.0 %", "témoin positif : le vert doit être atteignable.");
  assert.equal(c.intervalle, "[58–92]");
  assert.ok(writeRate(r).startsWith("80.0 % [58–92]"),
    "un tableau et une console qui divergent d'un point rendraient deux documents\n"
    + "  incomparables issus de la même mesure.");
});

test("l'intervalle CONTIENT son estimation — aux extrêmes flottants compris", () => {
  /*
   * wilson(60, 60) rendait [0,93…, 0,9999999999999999] : une borne haute SOUS l'estimation
   * (1), par la seule virgule flottante. Un lecteur qui vérifie « taux ≤ borne haute » sur
   * un relevé scellé aurait eu raison de le refuser — et le relevé aurait eu raison d'être
   * ce qu'il était. Trouvé par cascade-screening en parcourant toutes les cellules de son
   * relevé public ; fermé ICI, à la source, pour les deux dépôts.
   */
  const contient = (successes: number, n: number) => {
    const [bas, haut] = wilson(successes, n);
    const p = successes / n;
    assert.ok(bas <= p && p <= haut,
      `wilson(${successes}, ${n}) = [${bas}, ${haut}] ne contient pas p̂ = ${p}`);
  };
  /* Les trois cas qui ont payé, nommés : le plein, le vide, l'unité. */
  contient(60, 60);
  contient(0, 60);
  contient(1, 1);
  /* Et la boucle sur les n courants, extrémités comprises : le flottant ne choisit pas ses
     victimes là où on l'a déjà vu. */
  for (const n of [1, 2, 3, 5, 10, 20, 24, 30, 51, 60, 100, 120, 685, 1000]) {
    for (const s of [0, 1, Math.floor(n / 2), n - 1, n]) {
      if (s >= 0 && s <= n) contient(s, n);
    }
  }
  /* CONTRE-ÉPREUVE : l'élargissement ne RÉTRÉCIT rien — les valeurs canoniques du fichier
     tiennent toujours (4/4 rend [51 %, 100 %], l'énoncé du commentaire d'en-tête). */
  const [bas44, haut44] = wilson(4, 4);
  assert.ok(Math.abs(bas44 - 0.51) < 0.02 && haut44 === 1,
    `wilson(4, 4) = [${bas44}, ${haut44}] : l'énoncé « [51 %, 100 %] » du fichier ne tient plus`);
});
