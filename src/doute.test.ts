import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDeDoute, signauxApplicables, doutesVides, compterDoute, SCORE_MAX } from "./doute.ts";

test("le score compte les signaux qui tirent, et une valeur vide vaut un — pas plus", () => {
  const doc = "Client: Anna Petrova — dob 3 May 1990 — doc ES-9999-B — Spain.";
  assert.equal(scoreDeDoute("Anna Petrova", doc, "name"), 0, "une valeur citée, bien formée : rien à dire.");
  assert.equal(scoreDeDoute("", doc, "name"), 1, "vide : un, et on s'arrête.");
  assert.equal(scoreDeDoute("   ", doc, "name"), 1);
  assert.equal(scoreDeDoute("Boris Ivanov", doc, "name"), 1, "absent du document : un signal.");
  assert.equal(scoreDeDoute("Anna Petrova 1990", doc, "name"), 2,
    "un nom avec un chiffre : la forme du nom tire, et la chaîne entière n'est pas dans le document — deux signaux.");
  assert.equal(scoreDeDoute("Anna Petrova", "Anna Petrova, née en 1990", "name"), 0);
  assert.equal(scoreDeDoute("XX-0000-Z", doc, "document"), 1, "absent du document, forme et répertoire corrects.");
  assert.equal(scoreDeDoute("ES​-9999-B", doc, "document"), 3,
    "un espace de largeur nulle : absent du texte normalisé, caractère invisible, hors répertoire ASCII.");
  assert.equal(scoreDeDoute("ЕS-9999-B", doc, "document"), 3,
    "un E cyrillique : absent, écritures mélangées, hors répertoire.");
  assert.ok(scoreDeDoute("ES​-9999-B", doc, "document") <= SCORE_MAX);
});

test("un champ inconnu ne porte que les signaux qui s'appliquent, et le dit", () => {
  assert.deepEqual(signauxApplicables("iban"), ["empty", "not in the document", "invisible characters", "mixed scripts"]);
  assert.deepEqual(signauxApplicables("birth"),
    ["empty", "not in the document", "invisible characters", "mixed scripts", "unexpected shape", "outside the field's character set"]);
  assert.equal(scoreDeDoute("FR76 3000", "IBAN FR76 3000", "iban"), 0, "sans forme ni répertoire connus, seule la citation compte.");
  assert.equal(scoreDeDoute("FR76 3000", "another text", "iban"), 1);
});

test("les comptes par score : deux entiers par score, bornés, et jamais une valeur", () => {
  const d = doutesVides();
  assert.equal(d.parScore.length, SCORE_MAX + 1);
  compterDoute(d, 0, true); compterDoute(d, 0, false); compterDoute(d, 2, false); compterDoute(d, 99, false);
  assert.deepEqual(d.parScore, [2, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(d.fauxParScore, [1, 0, 1, 0, 0, 0, 1]);
  assert.ok(!JSON.stringify(d).includes("Anna"), "les comptes ne portent aucune valeur.");
});
