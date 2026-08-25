/**
 * LE SCELLÉ DU RELEVÉ, ÉPROUVÉ SUR LES DEUX CHEMINS QU'IL GARDE.
 *
 * `readProfiles()` refuse un relevé sans empreinte, et un relevé dont l'empreinte ne
 * correspond plus à son contenu. Quatre refus, deux par chemin : celui du client
 * (`data/profiles.json`, la mesure qu'il a faite lui-même) et celui du dépôt (le relevé de
 * référence, qui produit TOUS les chiffres publiés dans un clone neuf).
 *
 * Les quatre ont survécu à un balayage qui les retirait un par un : on pouvait les effacer
 * sans qu'aucun cas ne bouge. **Ils étaient justes et rien ne le vérifiait** — et c'est la
 * définition d'une garde qui se fera retirer au premier remaniement qui la trouve encombrante.
 *
 * Chaque cas passe par le DISQUE, parce que c'est là que le défaut vit : `readProfiles()` ne
 * prend aucun paramètre et lit un chemin fixe. Un témoin qui appellerait la comparaison
 * d'empreinte directement éprouverait l'arithmétique et laisserait le refus sans couverture —
 * la mutation d'origine ne le ferait pas rougir.
 *
 * Tout est restauré dans un `finally`, y compris quand l'assertion échoue. Le crochet de
 * pré-commit refuse toute modification non indexée, donc une restauration ratée se voit
 * immédiatement plutôt que de partir dans un commit.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readProfiles, empreinteDuReleve, RELEVE_DE_REFERENCE } from "./measure.ts";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const PROFILS_CLIENT = `${RACINE}data/profiles.json`;
const REFERENCE = `${RACINE}${RELEVE_DE_REFERENCE}`;

/** Un relevé minimal mais valide : ce que `readProfiles` exige pour rendre au lieu de refuser. */
function releveValide(): Record<string, unknown> {
  const corps = {
    measuredAt: "2026-01-01T00:00:00.000Z",
    code: "temoin",
    provenance: {},
    extraction: {},
    classification: {},
    loadTime: {},
    tiers: [],
  };
  return { ...corps, empreinte: empreinteDuReleve(corps) };
}

/** Écrit le relevé client, joue, restaure — même si le corps lève. */
function avecProfilsClient(contenu: unknown, jouer: () => void): void {
  const existait = existsSync(PROFILS_CLIENT);
  const avant = existait ? readFileSync(PROFILS_CLIENT, "utf8") : null;
  mkdirSync(`${RACINE}data`, { recursive: true });
  writeFileSync(PROFILS_CLIENT, JSON.stringify(contenu, null, 2));
  try { jouer(); }
  finally {
    if (avant === null) rmSync(PROFILS_CLIENT, { force: true });
    else writeFileSync(PROFILS_CLIENT, avant);
  }
}

/** Remplace le relevé de référence du dépôt, joue, restaure toujours. */
function avecReference(contenu: unknown, jouer: () => void): void {
  const avant = readFileSync(REFERENCE, "utf8");
  writeFileSync(REFERENCE, JSON.stringify(contenu, null, 2));
  try { jouer(); }
  finally { writeFileSync(REFERENCE, avant); }
}

test("le relevé du client sans empreinte est refusé", () => {
  const { empreinte, ...sansScelle } = releveValide();
  void empreinte;
  avecProfilsClient(sansScelle, () => {
    assert.throws(() => readProfiles(), /carries no content fingerprint/,
      "un relevé sans empreinte ne peut pas dire si ses chiffres sont ceux qui ont été "
      + "mesurés ; le publier reviendrait à publier un chiffre dont personne ne répond");
  });
});

test("le relevé du client dont l'empreinte ne correspond plus est refusé", () => {
  const altere = releveValide();
  /* LA MUTATION EST CELLE DU DÉFAUT : un chiffre modifié à la main après la mesure.
     Changer l'empreinte plutôt que le contenu éprouverait la même comparaison, mais pas
     le geste qu'on redoute — et c'est le geste qui doit rougir. */
  (altere as Record<string, unknown>).code = "modifie-a-la-main";
  avecProfilsClient(altere, () => {
    assert.throws(() => readProfiles(), /has changed since it was measured/,
      "un chiffre modifié après coup rend tout le fichier sans valeur, et le refus doit "
      + "arriver avant qu'une page ne le publie");
  });
});

test("le relevé du client intact passe — sinon la garde a coûté la mesure", () => {
  /* LA DIRECTION QUI DÉCIDE. Sans ce cas, les deux verts ci-dessus prouveraient seulement
     que `readProfiles` refuse tout, ce qu'une garde cassée fait aussi. */
  avecProfilsClient(releveValide(), () => {
    const p = readProfiles();
    assert.ok(p, "un relevé correctement scellé doit être rendu");
    assert.equal((p as unknown as Record<string, unknown>).code, "temoin");
  });
});

test("le relevé de référence du dépôt sans empreinte est refusé", () => {
  /* CE CHEMIN-CI COMPTE PLUS QUE L'AUTRE : `data/` est ignoré par git, donc dans un clone
     neuf — celui de l'acheteur — c'est ce fichier qui produit TOUS les chiffres publiés. */
  const { empreinte, ...sansScelle } = releveValide();
  void empreinte;
  avecReference(sansScelle, () => {
    assert.throws(() => readProfiles(), /carries no content fingerprint/);
  });
});

test("le relevé de référence du dépôt altéré est refusé", () => {
  const altere = releveValide();
  (altere as Record<string, unknown>).code = "modifie-a-la-main";
  avecReference(altere, () => {
    assert.throws(() => readProfiles(), /has changed since it was measured/);
  });
});

test("le relevé de référence livré est scellé, et son empreinte se recalcule", () => {
  /* Pas une garde : une vérification que le fichier du dépôt est dans l'état que les quatre
     refus ci-dessus supposent. S'il cessait de l'être, les cinq cas passeraient encore et ne
     protégeraient plus rien. */
  const p = JSON.parse(readFileSync(REFERENCE, "utf8")) as Record<string, unknown>;
  assert.equal(typeof p.empreinte, "string", "le relevé livré doit porter son empreinte");
  assert.equal(p.empreinte, empreinteDuReleve(p),
    "l'empreinte livrée doit correspondre au contenu livré — sinon le dépôt publie des "
    + "chiffres que son propre contrôle refuserait");
});
