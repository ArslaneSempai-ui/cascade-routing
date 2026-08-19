/*
 * L'ANALYSEUR QUE LES INCONNUS TOUCHENT EN PREMIER.
 *
 * `measure:yours` est le seul chemin de ce dépôt qu'une personne extérieure exécute sur ses
 * propres données, et son analyseur CSV est écrit à la main pour tenir la promesse « zéro
 * dépendance d'exécution ». C'était donc, jusqu'à ce fichier, le code le plus exposé et le
 * moins couvert du projet.
 *
 * Chaque cas ici vient d'un tableur réel : Excel écrit des fins de ligne Windows et une marque
 * d'ordre d'octets, les exports mettent des guillemets partout, et un champ de texte libre
 * contient des virgules et des retours à la ligne.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { lireCsv } from "./your-cases.ts";

test("deux colonnes : texte et réponse, sans identifiant", () => {
  const { champs, cas } = lireCsv("text,category\nHow do I find my card?,card_arrival\n");
  assert.deepEqual(champs, ["category"]);
  assert.equal(cas.length, 1);
  assert.equal(cas[0]!.text, "How do I find my card?");
  assert.equal(cas[0]!.truth["category"], "card_arrival");
  assert.equal(cas[0]!.id, "1", "un identifiant est fabriqué quand la colonne manque");
});

test("trois colonnes ou plus : un champ par colonne restante", () => {
  const { champs, cas } = lireCsv("id,text,name,birth\na1,Anna Petrova born 3 May 1990,Anna Petrova,3 May 1990\n");
  assert.deepEqual(champs, ["name", "birth"]);
  assert.equal(cas[0]!.id, "a1");
  assert.equal(cas[0]!.truth["birth"], "3 May 1990");
});

test("une virgule dans une cellule entre guillemets ne coupe pas la ligne", () => {
  const { cas } = lireCsv('id,text,name\n1,"Petrova, Anna — client",Anna Petrova\n');
  assert.equal(cas[0]!.text, "Petrova, Anna — client");
  assert.equal(cas[0]!.truth["name"], "Anna Petrova");
});

test("un guillemet doublé est un guillemet", () => {
  const { cas } = lireCsv('id,text,name\n1,"she said ""hello"" twice",Anna\n');
  assert.equal(cas[0]!.text, 'she said "hello" twice');
});

test("un retour à la ligne dans une cellule ne crée pas un cas", () => {
  const { cas } = lireCsv('id,text,label\n1,"line one\nline two",ok\n');
  assert.equal(cas.length, 1, "la cellule multiligne a été coupée en deux cas");
  assert.match(cas[0]!.text, /line one\nline two/);
});

test("les fins de ligne Windows sont acceptées", () => {
  /* Excel et la plupart des exports bancaires écrivent \r\n. Un \r resté collé à la dernière
     colonne fait échouer chaque comparaison, silencieusement et sur tous les cas. */
  const { cas } = lireCsv("id,text,label\r\n1,hello,ok\r\n2,world,ko\r\n");
  assert.equal(cas.length, 2);
  assert.equal(cas[0]!.truth["label"], "ok", "un retour chariot traîne sur la dernière colonne");
  assert.equal(cas[1]!.truth["label"], "ko");
});

test("une marque d'ordre d'octets ne casse pas le nom de la première colonne", () => {
  /*
   * Excel préfixe ses CSV UTF-8 d'un caractère invisible qui colle au premier nom de colonne.
   * Ici il est inoffensif *par construction* — les noms des deux premières colonnes ne servent
   * à rien, seuls ceux des colonnes de réponses sont lus. Le test ne répare donc rien : il
   * fige la propriété, pour qu'une refonte qui se mettrait à lire l'en-tête de gauche tombe
   * ici plutôt que chez quelqu'un qui exporte depuis un tableur.
   */
  const { champs, cas } = lireCsv("﻿id,text,label\n1,hello,ok\n");
  assert.deepEqual(champs, ["label"]);
  assert.equal(cas[0]!.id, "1", "la marque d'ordre d'octets est restée dans l'identifiant");
});

test("les lignes vides sont ignorées, pas comptées comme des cas", () => {
  const { cas } = lireCsv("id,text,label\n1,hello,ok\n\n\n2,world,ko\n\n");
  assert.equal(cas.length, 2);
});

test("une cellule manquante devient une chaîne vide, pas undefined", () => {
  const { cas } = lireCsv("id,text,name,birth\n1,hello,Anna\n");
  assert.equal(cas[0]!.truth["birth"], "", "une colonne absente doit valoir la chaîne vide");
});

test("un fichier à une seule colonne est refusé, avec une raison", () => {
  assert.throws(() => lireCsv("text\nhello\n"), /at least two columns/,
    "un fichier inutilisable doit lever un message lisible, pas produire zéro cas en silence");
});
