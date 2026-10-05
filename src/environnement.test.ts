/*
 * THE VARIABLES UNDER THEIR NEW NAME AND THEIR FORMER ONE (5 October 2026, Cascade became
 * Crusetra). What these cases hold: a value is read under CRUSETRA_<NAME> first, then under
 * CASCADE_<NAME>; the offline switch refuses when EITHER name says 1, so the new name can never
 * reopen a network that a client's script closed with the old one; the message names the
 * switch that was set and the name to use; and no module reads a CASCADE_ or CRUSETRA_
 * variable around this helper, which is how a reader would come to ignore one of the names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lireVariable, horsLigne, drapeauHorsLigne, PREFIXE, PREFIXE_ANCIEN } from "./environnement.ts";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const RACINE = fileURLToPath(new URL("..", import.meta.url));

test("a value is read under its new name first, then under its former name", () => {
  assert.equal(PREFIXE, "CRUSETRA_");
  assert.equal(PREFIXE_ANCIEN, "CASCADE_");
  assert.equal(lireVariable("TESSDATA", {}), undefined);
  assert.equal(lireVariable("TESSDATA", { CRUSETRA_TESSDATA: "/nouveau" }), "/nouveau");
  assert.equal(lireVariable("TESSDATA", { CASCADE_TESSDATA: "/ancien" }), "/ancien",
    "the former name is no longer read: a client's script that sets it would silently change behavior");
  assert.equal(lireVariable("TESSDATA", { CRUSETRA_TESSDATA: "/nouveau", CASCADE_TESSDATA: "/ancien" }), "/nouveau",
    "when both are set, the new name wins");
  assert.equal(lireVariable("POIDS_RACINE", { CASCADE_POIDS_RACINE: "/ancien" }), "/ancien");
  /* Counter-test: the helper reads the name it is given, not any variable with the prefix. */
  assert.equal(lireVariable("POIDS_RACINE", { CASCADE_TESSDATA: "/ancien" }), undefined);
});

test("the offline switch refuses when either name says 1, and only then", () => {
  const cas: [NodeJS.ProcessEnv, boolean][] = [
    [{}, false],
    [{ CRUSETRA_OFFLINE: "1" }, true],
    [{ CASCADE_OFFLINE: "1" }, true],
    [{ CASCADE_OFFLINE: "1", CRUSETRA_OFFLINE: "0" }, true],
    [{ CRUSETRA_OFFLINE: "1", CASCADE_OFFLINE: "0" }, true],
    [{ CRUSETRA_OFFLINE: "0" }, false],
    [{ CASCADE_OFFLINE: "0" }, false],
    [{ CASCADE_OFFLINE: "true" }, false],
    [{ CRUSETRA_OFFLINE: "" }, false],
  ];
  for (const [env, attendu] of cas) {
    assert.equal(horsLigne(env), attendu, `${JSON.stringify(env)} should ${attendu ? "" : "not "}refuse the network`);
  }
});

test("the message names the switch that was set, and always the new name", () => {
  assert.equal(drapeauHorsLigne({ CRUSETRA_OFFLINE: "1" }), "CRUSETRA_OFFLINE=1");
  assert.equal(drapeauHorsLigne({ CRUSETRA_OFFLINE: "1", CASCADE_OFFLINE: "1" }), "CRUSETRA_OFFLINE=1");
  assert.equal(drapeauHorsLigne({ CASCADE_OFFLINE: "1" }), "CASCADE_OFFLINE=1 (the former name of CRUSETRA_OFFLINE=1)");
  assert.equal(drapeauHorsLigne({ CASCADE_OFFLINE: "1", CRUSETRA_OFFLINE: "0" }), "CASCADE_OFFLINE=1 (the former name of CRUSETRA_OFFLINE=1)");
  /* With neither set, a message that describes the switch names the one to use. */
  assert.equal(drapeauHorsLigne({}), "CRUSETRA_OFFLINE=1");
});

/** The lines of a source text that read a CASCADE_ or CRUSETRA_ variable without the helper. */
export function lecturesDirectes(texte: string): string[] {
  return texte.split("\n").filter((l) => /process\.env(?:\.|\[\s*["'`])(?:CASCADE|CRUSETRA)_/.test(l));
}

test("no module reads a CASCADE_ or CRUSETRA_ variable around the helper", () => {
  /* The detector says no on a fabricated line first: a scan that never matches proves nothing. */
  assert.deepEqual(lecturesDirectes('const x = process.env.CASCADE_OFFLINE === "1";\nconst y = 2;'), ['const x = process.env.CASCADE_OFFLINE === "1";']);
  assert.equal(lecturesDirectes('const r = process.env["CRUSETRA_TESSDATA"];').length, 1);
  assert.deepEqual(lecturesDirectes('const x = lireVariable("TESSDATA");'), []);

  const fautes: string[] = [];
  let lus = 0;
  for (const nom of readdirSync(SRC)) {
    if (!/\.(ts|mjs)$/.test(nom) || /\.test\.(ts|mjs)$/.test(nom) || nom === "environnement.ts") continue;
    lus++;
    for (const l of lecturesDirectes(readFileSync(join(SRC, nom), "utf8"))) fautes.push(`src/${nom}: ${l.trim()}`);
  }
  assert.ok(lus > 50, `only ${lus} module(s) read: the scan is not looking at src/`);
  assert.deepEqual(fautes, [],
    "these lines read a variable under one name only; go through lireVariable() or horsLigne() in "
    + "src/environnement.ts, so that the new name and the former one are both honored:\n  " + fautes.join("\n  "));
});

test("the pre-push hook reads CRUSETRA_LICENCIE first, then its former name CASCADE_LICENCIE", () => {
  const crochet = readFileSync(join(RACINE, ".githooks", "pre-push"), "utf8");
  assert.match(crochet, /LICENCIE="\$\{CRUSETRA_LICENCIE:-\$\{CASCADE_LICENCIE:-[^}]+\}\}"/);
});
