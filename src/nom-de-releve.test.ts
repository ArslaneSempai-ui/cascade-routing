import assert from "node:assert/strict";
import { test } from "node:test";
import { estNomDeReleve } from "./nom-de-releve.ts";

test("un relevé profiles-*.json est reconnu ; sa signature détachée à côté ne l'est pas", () => {
  assert.equal(estNomDeReleve("profiles-2026-08-20-coeur-rendu.json"), true);
  assert.equal(estNomDeReleve("profiles-2026-08-20-charge-8.json"), true);
  // la signature du 8/09 : même préfixe, même extension, et ce n'est pas un relevé
  assert.equal(estNomDeReleve("profiles-2026-08-20-coeur-rendu.signature.json"), false);
  assert.equal(estNomDeReleve("landing.json"), false);
  assert.equal(estNomDeReleve("profiles.json"), false);
});
