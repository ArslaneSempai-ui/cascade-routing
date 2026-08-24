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

test("la borne porte sur une évaluation, pas sur la passe entière", async () => {
  /*
   * Une règle qui met un peu sur chacun de beaucoup de cas est LENTE mais évaluable ; une
   * règle qui ne rend pas la main sur un seul cas ne l'est pas. Une borne posée sur le
   * total confondrait les deux et refuserait un gros corpus honnête.
   */
  const beaucoup = await evaluerRegles({ a: /(a+)+$/ }, Array.from({ length: 40 }, () => dur(20)), 250);
  assert.deepEqual(beaucoup.refusees, {},
    "quarante cas à quelques dizaines de millisecondes dépassent 250 ms au total, et\n"
    + "  chacun reste très en dessous : cette règle doit passer.");
  assert.equal(beaucoup.valeurs["a"]!.length, 40);

  const unSeul = await evaluerRegles({ a: /(a+)+$/ }, [dur(28)], 250);
  assert.ok(unSeul.refusees["a"], "un seul cas au-dessus de la borne suffit à refuser.");
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

test("la borne par défaut laisse quatre ordres de grandeur à une règle qui travaille", () => {
  assert.equal(MS_PAR_EVALUATION, 250);
  assert.ok(MS_PAR_EVALUATION > 20,
    "le démarrage du fil coûte une vingtaine de millisecondes, une fois par règle : une\n"
    + "  borne en dessous refuserait toutes les règles, y compris les bonnes.");
});
