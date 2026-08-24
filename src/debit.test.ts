import { test } from "node:test";
import assert from "node:assert/strict";
import { compter, oublierLesRequetes, PLAFOND_REQUETES, FENETRE_MS } from "./server.ts";

/*
 * LE PLAFOND SE MESURE SUR SON HORLOGE, PAS SUR L'ATTENTE.
 *
 * Un cas qui attendrait vraiment soixante secondes ne serait pas lancé, donc pas maintenu.
 * `compter` prend son instant en argument précisément pour que la fenêtre soit éprouvable
 * sans dormir — et le serveur, lui, lui passe `Date.now()`.
 */

test("sous le plafond, tout passe ; au-delà, plus rien", () => {
  oublierLesRequetes();
  const t = 1_000_000;
  for (let i = 0; i < PLAFOND_REQUETES; i++) {
    assert.notEqual(compter("1.2.3.4", t), null,
      `refus à la requête ${i + 1} alors que le plafond est ${PLAFOND_REQUETES}`);
  }
  assert.equal(compter("1.2.3.4", t), null, "la requête au-delà du plafond doit être refusée");
});

test("le compte restant décroît, et il part du plafond", () => {
  oublierLesRequetes();
  const t = 2_000_000;
  assert.equal(compter("5.6.7.8", t), PLAFOND_REQUETES - 1);
  assert.equal(compter("5.6.7.8", t), PLAFOND_REQUETES - 2);
});

test("la fenêtre s'écoule et l'adresse retrouve son plafond", () => {
  oublierLesRequetes();
  const t = 3_000_000;
  for (let i = 0; i < PLAFOND_REQUETES; i++) compter("9.9.9.9", t);
  assert.equal(compter("9.9.9.9", t), null, "plafond atteint");
  assert.notEqual(compter("9.9.9.9", t + FENETRE_MS + 1), null,
    "après la fenêtre, l'adresse doit repartir à zéro — sinon un plafond atteint une fois est définitif");
});

test("une adresse n'épuise pas le plafond d'une autre", () => {
  oublierLesRequetes();
  const t = 4_000_000;
  for (let i = 0; i < PLAFOND_REQUETES; i++) compter("10.0.0.1", t);
  assert.equal(compter("10.0.0.1", t), null);
  assert.notEqual(compter("10.0.0.2", t), null,
    "le compteur est partagé entre adresses : une seule suffirait à couper tout le monde");
});

test("la carte des adresses ne grossit pas sans borne", () => {
  oublierLesRequetes();
  const t = 5_000_000;
  /* Mille adresses différentes, puis une seule requête très postérieure : les mille doivent
     avoir été purgées, sinon on a remplacé un épuisement par un autre, plus discret. */
  for (let i = 0; i < 1000; i++) compter(`172.16.0.${i}`, t);
  compter("192.168.1.1", t + FENETRE_MS + 1);
  /* On éprouve la purge par son effet observable : une adresse d'avant la fenêtre repart
     avec son plafond entier, ce qui n'est vrai que si son historique a disparu. */
  assert.equal(compter("172.16.0.0", t + FENETRE_MS + 2), PLAFOND_REQUETES - 1,
    "l'historique d'une adresse hors fenêtre est encore là : la carte grossit sans borne");
});
