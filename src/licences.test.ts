import { test } from "node:test";
import assert from "node:assert/strict";
import { classer, temoins, document, sbom, type Paquet } from "./licences.ts";
import { inventaire } from "./licences.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

/*
 * L'INVENTAIRE ÉTAIT PRIS SUR UNE MACHINE, ET PUBLIÉ COMME S'IL VALAIT PARTOUT.
 *
 * `npm` installe `@img/sharp-darwin-arm64` sur ce macOS et `@img/sharp-linux-x64` sur le
 * Linux de l'intégration continue. Les deux jeux ne peuvent JAMAIS coïncider, donc
 * `licences.ts --check` échouait à chaque passe — et comme `npm test` est une chaîne de
 * `&&`, `node --test` ne tournait pas du tout. Mesuré le 26 août 2026 avec `gh run list` :
 * vingt-deux passes d'affilée en échec, dernière réussite le 17 août à 14 h 56.
 *
 * Le nom de famille se déduit des `os` que le paquet déclare : on coupe au dernier `-<os>`.
 * Ce cas éprouve la déduction sur les quatre formes que npm publie réellement pour `sharp`,
 * dont `linuxmusl`, où retirer les jetons un par un laisserait `@img/sharpmusl`.
 */
test("un binaire nommé d'après la machine est inscrit sous son nom de famille", () => {
  const bac = mkdtempSync(join(tmpdir(), "licences-plateforme-"));
  const poser = (nom: string, m: Record<string, unknown>) => {
    const d = join(bac, "node_modules", ...nom.split("/"));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: nom, version: "0.35.3", license: "Apache-2.0", ...m }));
    writeFileSync(join(d, "LICENSE"), "Apache License, Version 2.0");
  };
  try {
    poser("@img/sharp-darwin-arm64", { os: ["darwin"], cpu: ["arm64"] });
    poser("@img/sharp-linux-x64", { os: ["linux"], cpu: ["x64"] });
    poser("@img/sharp-linuxmusl-x64", { os: ["linux"], cpu: ["x64"] });
    poser("@img/sharp-freebsd-wasm32", { os: ["freebsd"] });
    /* LE TÉMOIN NÉGATIF : sans lui, « tout ramener à un seul nom » passerait aussi. */
    poser("onnxruntime-node", { os: ["win32", "darwin", "linux"] });
    poser("guid-typescript", {});

    const noms = inventaire(join(bac, "node_modules")).map((p) => p.nom);

    assert.deepEqual(noms.filter((n) => n.startsWith("@img/")), ["@img/sharp"],
      `les quatre variantes de sharp devraient s'inscrire sous un seul nom, obtenu : `
      + `${noms.filter((n) => n.startsWith("@img/")).join(", ")}.\n`
      + "  Publiées sous leur nom complet, elles ne peuvent coïncider sur aucune autre machine,\n"
      + "  et `--check` échoue à chaque passe d'intégration continue.");
    assert.ok(noms.includes("onnxruntime-node"),
      "`onnxruntime-node` déclare trois systèmes et porte le même nom partout : le couper\n"
      + "  ferait disparaître un paquet réel de la nomenclature qu'un service achats lit.");
    assert.ok(noms.includes("guid-typescript"),
      "un paquet sans contrainte de plateforme a perdu son nom : la coupe mord trop large.");
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});
