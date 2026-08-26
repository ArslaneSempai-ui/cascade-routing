/**
 * LE CROCHET N'A JAMAIS PU VOIR UN CAS IGNORÉ.
 *
 * Il comptait les cas ignorés en cherchant `^# skipped N`, la forme TAP. `node --test` écrit
 * `ℹ skipped N`. Mesuré sur une suite portant un vrai `t.skip()` : zéro correspondance, pour
 * les deux motifs.
 *
 * Ce qui l'a caché tient en trois caractères — `${ignores:-0}`. **« ligne introuvable » et
 * « zéro cas ignoré » rendaient le même chiffre**, et le chiffre rassurant était celui de la
 * panne. Un défaut de lecture se présentait comme une bonne nouvelle, à chaque commit, depuis
 * que le crochet existe. Trouvé par une session voisine sur le pas d'intégration continue, où
 * le même motif dormait.
 *
 * CE CAS EXÉCUTE LA FONCTION DU CROCHET, IL NE LIT PAS SON TEXTE. Un cas qui vérifierait que
 * le motif « contient bien ℹ » serait écrit dans la forme de la garde : il passerait sur toute
 * réécriture qui garde le caractère et perd le sens. On extrait la fonction du fichier vivant
 * et on la fait tourner sur des sorties fabriquées — si quelqu'un la renomme ou la déplace, ce
 * cas rougit au lieu de garder un fantôme.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));

/** La fonction telle qu'elle vit dans le crochet, extraite à l'accolade équilibrée. */
function fonctionDuCrochet(): string {
  const src = readFileSync(racine + ".githooks/pre-commit", "utf8");
  const debut = src.indexOf("compterIgnores() {");
  assert.ok(debut > 0,
    "`compterIgnores` a disparu de .githooks/pre-commit : ce cas ne garde plus rien. "
    + "La retrouver, ou retirer ce cas plutôt que de le laisser rassurer.");
  let prof = 0, fin = debut;
  for (let k = src.indexOf("{", debut); k < src.length; k++) {
    if (src[k] === "{") prof++;
    else if (src[k] === "}") { prof--; if (prof === 0) { fin = k + 1; break; } }
  }
  return src.slice(debut, fin);
}

function compter(sortie: string): string {
  return execFileSync("sh", ["-c", `${fonctionDuCrochet()}\ncompterIgnores "$1"`, "sh", sortie],
    { encoding: "utf8" });
}

test("la forme que node --test écrit vraiment est comptée", () => {
  assert.equal(compter("ℹ tests 12\nℹ pass 11\nℹ skipped 1\n"), "1",
    "`ℹ skipped N` est ce que `node --test` imprime — vérifié sur une suite portant un vrai "
    + "t.skip(). Ne pas le lire, c'est ne jamais voir un cas ignoré.");
});

test("la forme TAP reste comptée — on répare sans casser l'autre", () => {
  assert.equal(compter("# skipped 2\n"), "2");
});

test("une sortie SANS ligne de résumé rend `?`, jamais `0`", () => {
  /* LE CŒUR DU DÉFAUT. Tant que l'absence rendait 0, une lecture ratée se lisait comme
     « aucun cas ignoré » — la seule réponse qui n'alerte personne. */
  assert.equal(compter("ℹ tests 12\nℹ pass 12\n"), "?",
    "sans ligne de résumé, le compte n'a pas été LU. Rendre 0 fait passer un défaut de "
    + "lecture pour une bonne nouvelle, et c'est exactement ce qui a duré jusqu'ici.");
  assert.equal(compter(""), "?");
});

test("zéro ignoré rend bien `0`, et se distingue de `?`", () => {
  /* LA DIRECTION QUI DÉCIDE. Sans ce cas, une fonction qui rendrait toujours `?` passerait
     les trois précédents sauf un, et surtout ne dirait plus jamais rien d'utile. */
  assert.equal(compter("ℹ skipped 0\n"), "0");
});
