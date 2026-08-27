import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { compter, oublierLesRequetes, PLAFOND_REQUETES, FENETRE_MS, creerEcouteur } from "./server.ts";

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

/*
 * LES CINQ CAS CI-DESSUS ÉPROUVENT UNE FONCTION QUE LE ROUTEUR PEUT NE PLUS APPELER.
 *
 * Ils importent `compter` et lui passent leur propre instant. Aucun ne traverse le serveur.
 * Décrocher l'appel du routeur — remplacer sa valeur par une constante — les laisse tous les
 * cinq au vert, et la totalité des cas qui touchent le serveur avec eux : mesuré, 132 cas
 * verts sous la mutation. La fonction est irréprochable et son branchement n'est tenu par
 * personne.
 *
 * Le témoin ci-dessous ne doit donc PAS appeler `compter`. Il franchit la couture : il parle
 * au serveur par la socket et exige que le refus ARRIVE. Un second cas qui éprouverait encore
 * la fonction resterait vert sous la même mutation, et n'aurait rien ajouté.
 */
test("le plafond est BRANCHÉ sur le routeur : le refus arrive par la socket", async () => {
  oublierLesRequetes();
  const s: Server = createServer(creerEcouteur());
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const port = (s.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const statuts: number[] = [];
    let entete: string | null = null;
    for (let i = 0; i < PLAFOND_REQUETES + 5; i++) {
      const r = await fetch(`${base}/api/etat`);
      statuts.push(r.status);
      if (r.status === 429 && entete === null) entete = r.headers.get("retry-after");
    }

    /*
     * TÉMOIN DE NON-VACUITÉ, AVANT LE VERDICT. Un serveur qui refuserait tout dès la première
     * requête satisfait « il y a des 429 » sans rien dire du plafond : le cas passerait au
     * vert sur un serveur cassé.
     */
    assert.equal(statuts[0], 200,
      "la première requête est déjà refusée : ce cas ne mesure plus un plafond mais une panne.");
    assert.equal(statuts.slice(0, PLAFOND_REQUETES).filter((c) => c !== 200).length, 0,
      "une requête sous le plafond a été refusée : le compte du routeur n'est pas celui de la fonction.");

    const nb429 = statuts.filter((c) => c === 429).length;
    assert.ok(nb429 > 0,
      `${PLAFOND_REQUETES + 5} requêtes envoyées, plafond de ${PLAFOND_REQUETES}, et pas un seul 429 :\n`
      + "  le compteur n'est plus branché sur le routeur. La fonction peut être juste — les cas\n"
      + "  ci-dessus le disent — sans que rien ne l'appelle sur le chemin d'une vraie requête.");

    /* Et le refus est CELUI de la limite de débit, pas un autre 429 qui passerait par là. */
    assert.equal(entete, String(Math.ceil(FENETRE_MS / 1000)),
      "le 429 ne porte pas le délai que la branche de débit écrit : le refus vient d'ailleurs.");
  } finally {
    await new Promise<void>((ok) => { s.close(() => ok()); });
    oublierLesRequetes();
  }
});
