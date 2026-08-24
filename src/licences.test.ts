import { test } from "node:test";
import assert from "node:assert/strict";
import { classer, temoins, document, sbom, type Paquet } from "./licences.ts";

test("la classification des licences reconnaît encore ce qu'elle prétend reconnaître", () => {
  assert.deepEqual(temoins(), [], "un témoin de licence a changé de réponse : le verdict de l'inventaire est sans valeur");
});

test("le texte livré l'emporte sur un champ qui ment", () => {
  // Le seul cas où cet inventaire vaut mieux qu'un coup d'œil au package.json.
  const agpl = "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3";
  assert.equal(classer("MIT", agpl), "bloquante");
});

test("la LGPL n'est pas confondue avec la GPL qu'elle cite dans son corps", () => {
  const lgpl = "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3\n\nThis version incorporates the terms and conditions of version 3 of the GNU General Public License.";
  assert.equal(classer(null, lgpl), "à tenir");
});

test("le document refuse d'affirmer un zéro sans dire d'où il vient", () => {
  const propres: Paquet[] = [{ nom: "a", version: "1.0.0", declaree: "MIT", classe: "permissive", fichier: "LICENSE" }];
  const md = document(propres, null);
  assert.match(md, /No strong copyleft/);
  assert.match(md, /witnesses/, "un zéro publié sans nommer ce qui le garantit est un vert vide");
  // Et l'absence de licence du dépôt doit se lire comme une décision à prendre, pas comme un détail.
  assert.match(md, /all rights reserved/);
});

test("une licence bloquante est nommée, pas comptée", () => {
  const sale: Paquet[] = [{ nom: "poison", version: "2.0.0", declaree: "AGPL-3.0", classe: "bloquante", fichier: "LICENSE" }];
  const md = document(sale, "MIT");
  assert.match(md, /`poison`/);
  assert.doesNotMatch(md, /No strong copyleft/);
});

test("la nomenclature porte un identifiant de paquet exploitable", () => {
  const b = sbom([{ nom: "@scope/x", version: "1.2.3", declaree: "MIT", classe: "permissive", fichier: "LICENSE" }], "cascade", "1.0.0");
  assert.equal(b.components[0].purl, "pkg:npm/%40scope/x@1.2.3");
  assert.equal(b.bomFormat, "CycloneDX");
});
