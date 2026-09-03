/*
 * LA COMPARAISON APPARIÉE, ÉPROUVÉE SUR LE CAS QUI A CASSÉ.
 *
 * Le 3 septembre 2026, sur 24 cas, `measure:yours` écrivait « small is not measurably worse
 * than large. Take the cheaper one. » devant 95,8 % contre 66,7 %. Le premier cas ci-dessous
 * est cette mesure, reconstruite bit à bit ; il tient aussi la CONTRE-ÉPREUVE de l'ancienne
 * règle — le chevauchement d'intervalles — qui doit toujours répondre « pas séparables » sur
 * les mêmes chiffres, sinon ce témoin ne documente plus le défaut qu'il a fermé.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apparier, juger, casPourTrancher, phrase } from "./comparaison-appariee.ts";
import { distinguishable, rate } from "./interval.ts";

/** n cas, dont `faux` ratés aux positions données. */
const bits = (n: number, faux: number[]): string =>
  Array.from({ length: n }, (_, i) => (faux.includes(i) ? "0" : "1")).join("");

test("la mesure du 3 septembre : 23/24 contre 16/24, sept discordants pour la tête — séparables, p = 0,016", () => {
  const large = bits(24, [5]);
  const small = bits(24, [5, 1, 2, 3, 4, 6, 7, 8]);          // ses huit ratés incluent celui de large
  const a = apparier(large, small);
  assert.deepEqual([a.n, a.gains, a.pertes, a.discordants], [24, 7, 0, 7]);
  assert.ok(Math.abs(a.p! - 2 / 128) < 1e-9, `p exact attendu 2/128 = 0,0156, obtenu ${a.p}`);
  assert.equal(a.separables, true);
  assert.deepEqual(juger(a), { genre: "separable", sens: "tete" });
  const s = phrase({ tete: "large", candidat: "small", a, v: juger(a), msTete: 10, msCandidat: 5 });
  assert.match(s, /small is separably worse than large/);
  assert.doesNotMatch(s, /Take the cheaper one/);

  /* LA CONTRE-ÉPREUVE DE L'ANCIENNE RÈGLE : sur les mêmes chiffres, le chevauchement des
     intervalles répond « pas séparables » — c'est la phrase qui recommandait le palier faible. */
  assert.equal(distinguishable(rate(23, 24), rate(16, 24)), false,
    "si les intervalles ne se chevauchent plus, ce témoin ne reconstruit plus le défaut du 3 septembre.");
});

test("l'autre répartition possible, huit contre un : encore séparables, p = 0,039", () => {
  const large = bits(24, [5]);
  const small = bits(24, [1, 2, 3, 4, 6, 7, 8, 9]);           // le raté de large est réussi par small
  const a = apparier(large, small);
  assert.deepEqual([a.gains, a.pertes], [8, 1]);
  assert.ok(Math.abs(a.p! - 20 / 512) < 1e-9, `p exact attendu 20/512 = 0,039, obtenu ${a.p}`);
  assert.equal(juger(a).genre, "separable");
});

test("trois discordants sur 24 : indécis, et la phrase refuse de conclure sans marge", () => {
  const a = apparier(bits(24, []), bits(24, [0, 1, 2]));
  assert.equal(a.p, 0.25);
  assert.equal(a.separables, false);
  const v = juger(a);
  assert.deepEqual(v, { genre: "indecis", marge: undefined, casEstimes: null });
  const s = phrase({ tete: "large", candidat: "small", a, v, msTete: 10, msCandidat: 5 });
  assert.match(s, /not evidence they are equivalent/);
  assert.match(s, /--margin=2/);
  assert.doesNotMatch(s, /Take the cheaper one/,
    "sans marge déclarée, rien n'autorise à recommander le palier faible.");
});

test("avec une marge, la non-infériorité se prononce — et c'est la seule branche qui recommande", () => {
  /* 200 cas, 3 contre 2 : écart 0,5 point, bornes serrées. */
  const a = apparier(bits(200, [0, 1]), bits(200, [2, 3, 4]));
  assert.deepEqual([a.gains, a.pertes], [3, 2]);
  assert.ok(a.bornes[1] < 0.02, `la borne haute ${a.bornes[1]} devrait tenir sous deux points`);
  const v = juger(a, 0.02);
  assert.equal(v.genre, "non-inferieur");
  const s = phrase({ tete: "large", candidat: "small", a, v, msTete: 10, msCandidat: 5 });
  assert.match(s, /non-inferior to large within your 2-point margin/);
  assert.match(s, /Take the cheaper one/);
  assert.match(s, /2× faster/);
});

test("la non-infériorité passe avant la séparation : mesurablement derrière, mais dans la marge", () => {
  /* 2 000 cas, 30 contre 5 : p minuscule, écart 1,25 point, borne haute sous 3 points. */
  const tete = bits(2000, Array.from({ length: 5 }, (_, i) => i));
  const cand = bits(2000, Array.from({ length: 30 }, (_, i) => 100 + i));
  const a = apparier(tete, cand);
  assert.equal(a.separables, true);
  const v = juger(a, 0.03);
  assert.equal(v.genre, "non-inferieur");
  assert.equal((v as { separables: boolean }).separables, true);
  assert.match(phrase({ tete: "large", candidat: "small", a, v, msTete: 10, msCandidat: 5 }),
    /measurably behind .* but inside the margin/);
});

test("marge trop étroite pour l'échantillon : indécis, avec l'effectif estimé — ou son impossibilité", () => {
  const a = apparier(bits(24, []), bits(24, [0, 1, 2]));      // écart 12,5 points
  const v = juger(a, 0.02);
  assert.equal(v.genre, "indecis");
  assert.equal((v as { casEstimes: number | null }).casEstimes, null,
    "l'écart observé dépasse la marge : aucun effectif ne montrera la non-infériorité.");
  assert.match(phrase({ tete: "large", candidat: "small", a, v, msTete: 10, msCandidat: 5 }),
    /no sample size would show non-inferiority/);

  const b = apparier(bits(60, []), bits(60, [0]));           // écart 1,7 point, marge 5
  const w = juger(b, 0.05);
  if (w.genre === "indecis") {
    assert.ok(w.casEstimes !== null && w.casEstimes > b.n, `l'estimation ${w.casEstimes} doit dépasser n = ${b.n}`);
    assert.match(phrase({ tete: "large", candidat: "small", a: b, v: w, msTete: 10, msCandidat: 5 }),
      /an estimate, not a measurement/);
  } else {
    assert.equal(w.genre, "non-inferieur");
  }
  assert.equal(casPourTrancher(b, 0.05) === null, false);
});

test("sans discordant, l'écart vit dans ±la borne de Wilson à zéro, et une marge large le tranche", () => {
  const a = apparier(bits(100, [3]), bits(100, [3]));
  assert.deepEqual([a.discordants, a.p, a.ecart], [0, null, 0]);
  assert.ok(a.bornes[0] < 0 && a.bornes[1] > 0 && a.bornes[1] < 0.05,
    `bornes ${a.bornes} : symétriques, et sous cinq points à n = 100`);
  assert.equal(juger(a).genre, "indecis");
  assert.equal(juger(a, 0.05).genre, "non-inferieur");
});

test("les cas non mesurés d'un côté sont écartés du compte, et des longueurs différentes sont refusées", () => {
  const a = apparier("1101-1", "10-1-1");
  assert.deepEqual([a.n, a.gains, a.pertes], [4, 1, 0]);
  assert.throws(() => apparier("111", "11"), /misaligned/);
  assert.throws(() => apparier("---", "---"), /no case is measured on both sides/);
  assert.throws(() => juger(a, 2), /not a proportion/, "une marge en points nus n'est pas une proportion.");
});
