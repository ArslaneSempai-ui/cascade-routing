/*
 * DEUX GARDES CORRECTES, ET LE DÉFAUT ENTRE LES DEUX.
 *
 * La garde d'origine refuse une écriture venue d'une page étrangère — éprouvé ailleurs, elle
 * rend 403. Le compteur de débit borne les requêtes par adresse — éprouvé ailleurs aussi, il
 * rend 429 au-delà du plafond. **Les deux passaient au vert, séparément, pendant que leur
 * composition fermait l'écran de l'acheteur.**
 *
 * Le compteur s'incrémentait avant la garde. Une page hostile ouverte dans un autre onglet
 * voyait donc toutes ses écritures refusées — et son refus consommait quand même le quota.
 * Mesuré le 26 août 2026 :
 *
 *     240 requêtes portant « Origin: http://evil.example »  → toutes refusées 403
 *     puis une requête légitime de l'écran                  → HTTP 429
 *     puis la page elle-même                                → HTTP 429
 *
 * Un déni de service à un onglet de distance, sans authentification et sans outil. Invisible
 * dans tout relevé : des 403 d'un côté, un 429 de l'autre, et rien qui relie les deux.
 *
 * Ce cas éprouve donc la COMPOSITION et rien d'autre. Un cas par garde ne l'aurait jamais vu,
 * et c'est le seul enseignement qui compte ici : *un contrôle correct dont le prix est payé
 * par la victime n'est pas un contrôle.*
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { creerEcouteur, oublierLesRequetes, PLAFOND_REQUETES } from "./server.ts";

/** Un serveur sur un port que le système choisit : deux cas parallèles ne se gênent pas. */
async function surUnPortLibre(): Promise<{ port: number; fermer: () => Promise<void> }> {
  const s: Server = createServer(creerEcouteur());
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const port = (s.address() as { port: number }).port;
  return { port, fermer: () => new Promise<void>((ok) => { s.close(() => ok()); }) };
}

test("une page étrangère ne peut pas fermer l'écran de l'acheteur", async () => {
  oublierLesRequetes();
  const { port, fermer } = await surUnPortLibre();
  const base = `http://127.0.0.1:${port}`;
  try {
    /* Le budget ENTIER d'une fenêtre, épuisé par une page qui n'a le droit de rien faire. */
    let refusees = 0;
    for (let i = 0; i < PLAFOND_REQUETES; i++) {
      const r = await fetch(`${base}/api/routage`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://evil.example" },
        body: JSON.stringify({ champ: "name", palier: "large" }),
      });
      if (r.status === 403) refusees++;
    }

    /* Témoin de non-vacuité : si la garde d'origine cessait de refuser, ce cas ne dirait plus
       rien sur la composition — il mesurerait un serveur qui accepte tout. */
    assert.equal(refusees, PLAFOND_REQUETES,
      `${refusees} refus sur ${PLAFOND_REQUETES} : la garde d'origine ne refuse plus, et ce cas\n`
      + "  n'éprouve donc plus la composition qu'il existe pour garder.");

    /* Et maintenant l'acheteur, qui n'a rien fait. */
    const legitime = await fetch(`${base}/api/routage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ champ: "name", palier: "large" }),
    });
    assert.notEqual(legitime.status, 429,
      "l'écran de l'acheteur est fermé par le quota qu'une page étrangère a dépensé pour lui.\n"
      + "  La garde a refusé 240 fois, et c'est la victime qui a payé.");

    const page = await fetch(base);
    assert.notEqual(page.status, 429,
      "et la page elle-même ne se charge plus, pour la même raison.");
  } finally {
    await fermer();
    oublierLesRequetes();
  }
});
