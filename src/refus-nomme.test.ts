/*
 * UN REFUS QUI NOMME LA MAUVAISE VALEUR ENVOIE CHERCHER LE MAUVAIS DÉFAUT.
 *
 * Les deux refus éprouvés ici étaient CORRECTS : la valeur hors bornes était bien refusée, le
 * champ inconnu bien rejeté, avec le bon code. C'est le nom porté par le message qui mentait,
 * et aucun cas ne le lisait — la suite était verte parce que le refus existe, pas parce
 * qu'elle vérifiait ce qu'il dit.
 *
 * LES DEUX CAS TRAVERSENT LA SOCKET. Éprouver `appliquerHypotheses` ou le nommage en fonction
 * ne dirait rien de la route qui les appelle : c'est le message SERVI qu'un client lit, et
 * c'est lui qui doit être tenu. Un témoin posé sur la fonction resterait vert si la route
 * cessait de l'utiliser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { creerEcouteur, oublierLesRequetes } from "./server.ts";

async function serveurEphemere(): Promise<{ base: string; fermer: () => Promise<void> }> {
  const s: Server = createServer(creerEcouteur());
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const port = (s.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    fermer: () => new Promise<void>((ok) => { s.close(() => ok()); }),
  };
}

/* Le corps part en TEXTE : `1e400` n'a pas de littéral JavaScript qui survive à
   `JSON.stringify`, qui l'écrirait « null » — c'est-à-dire le défaut lui-même. */
async function poster(base: string, chemin: string, corpsBrut: string) {
  const r = await fetch(base + chemin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: corpsBrut,
  });
  return { statut: r.status, erreur: String(((await r.json()) as { erreur?: string }).erreur ?? "") };
}

test("le refus d'hypothèse distingue un nombre trop grand d'une valeur absente", async () => {
  oublierLesRequetes();
  const { base, fermer } = await serveurEphemere();
  try {
    const trop = await poster(base, "/api/hypotheses", '{"volume":1e400}');
    const vide = await poster(base, "/api/hypotheses", '{"volume":null}');
    const texte = await poster(base, "/api/hypotheses", '{"volume":"abc"}');

    /*
     * TÉMOIN DE NON-VACUITÉ, AVANT LE VERDICT : les trois doivent être REFUSÉES. Si la route
     * cessait de refuser, les messages deviendraient vides et « ils diffèrent » n'aurait plus
     * de sens — le cas passerait au vert sur un serveur qui accepte tout.
     */
    for (const [nom, r] of [["1e400", trop], ["null", vide], ['"abc"', texte]] as const) {
      assert.equal(r.statut, 400, `${nom} n'est plus refusé : ce cas ne lit plus un refus.`);
      assert.ok(r.erreur.length > 0, `${nom} est refusé sans un mot : il n'y a plus de message à juger.`);
    }

    assert.notEqual(trop.erreur, vide.erreur,
      "un nombre trop grand et une valeur absente rendent le MÊME refus, mot pour mot.\n"
      + "  Le client qui a dépassé une borne va chercher un champ qu'il n'a pas oublié.");

    /* Le cas déjà juste doit le rester : c'est lui qui prouve que le reste du message tient. */
    assert.notEqual(texte.erreur, vide.erreur,
      "une chaîne se lit maintenant comme une valeur absente : le correctif a cassé le cas qui allait bien.");
  } finally {
    await fermer();
    oublierLesRequetes();
  }
});

test("le refus de champ nomme ce qui a été envoyé, pas ce que String() en fait", async () => {
  oublierLesRequetes();
  const { base, fermer } = await serveurEphemere();
  try {
    const objet = await poster(base, "/api/routage", '{"champ":{"a":1},"palier":"large"}');
    const tableau = await poster(base, "/api/routage", '{"champ":[1,2],"palier":"large"}');
    const absent = await poster(base, "/api/routage", '{"palier":"large"}');
    const bon = await poster(base, "/api/routage", '{"champ":"name","palier":"large"}');

    /* TÉMOIN DE NON-VACUITÉ : un couple valide passe, les trois autres sont refusés. Sans lui,
       un serveur qui refuse tout satisferait les assertions de forme ci-dessous. */
    assert.equal(bon.statut, 200,
      "un champ et un palier valides sont refusés : ce cas mesure une panne, pas un nommage.");
    for (const [nom, r] of [["un objet", objet], ["un tableau", tableau], ["l'absence", absent]] as const) {
      assert.equal(r.statut, 400, `${nom} n'est plus refusé : ce cas ne lit plus un refus.`);
    }

    /*
     * Ce qui est interdit, c'est la trace d'une COERCITION : le client n'a pas tapé ces
     * caractères, ils sortent de la conversion en chaîne du serveur.
     */
    assert.ok(!objet.erreur.includes("[object Object]"),
      "le refus rend au client la représentation interne de JavaScript pour l'objet qu'il a envoyé.");
    assert.ok(objet.erreur.includes('{"a":1}'),
      "le refus ne nomme pas l'objet reçu : le client ne peut pas relier le message à ce qu'il a tapé.");
    assert.ok(tableau.erreur.includes("[1,2]"),
      "le refus ne nomme pas le tableau reçu tel qu'il a été envoyé.");

    /* Et l'absence reste l'absence : c'est le seul cas où le serveur a le droit de nommer
       autre chose que ce qui est arrivé, puisque rien n'est arrivé. */
    assert.ok(absent.erreur.includes("(absent)"),
      "un champ absent ne se dit plus absent : le correctif a emporté le cas qui allait bien.");
  } finally {
    await fermer();
    oublierLesRequetes();
  }
});
