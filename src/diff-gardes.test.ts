/**
 * LE REFUS DE COMPARER UN RELEVÉ QUI N'EXISTE PAS.
 *
 * `diff.ts` compare deux relevés nommés. Si l'un manque, il refuse en nommant ceux qui sont
 * disponibles — plutôt que de lever un `ENOENT` que personne ne sait quoi faire, ou pire, de
 * comparer ce qu'il a trouvé.
 *
 * Ce refus a survécu à un balayage qui le retirait : rien ne le déclenchait. La raison est
 * banale et vaut d'être dite — `lire()` est privée au module, donc le seul chemin qui
 * l'atteint est la ligne de commande. Le témoin passe donc par un sous-processus, ce qui est
 * aussi la façon dont un acheteur rencontrera ce message.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relevesDisponibles } from "./diff.ts";

const DIFF = fileURLToPath(new URL("./diff.ts", import.meta.url));

const lancer = (...args: string[]) =>
  spawnSync(process.execPath, [DIFF, ...args], { encoding: "utf8" });

test("comparer un relevé qui n'existe pas est refusé, et le refus nomme ce qui existe", () => {
  const r = lancer("profiles-nexiste-pas.json", "profiles-non-plus.json");
  assert.notEqual(r.status, 0, "un relevé introuvable ne doit pas rendre un code de succès");
  const dit = `${r.stdout}${r.stderr}`;
  assert.match(dit, /profiles-nexiste-pas\.json does not exist/,
    "le refus doit nommer le fichier manquant : un ENOENT nu envoie chercher au mauvais endroit");
  assert.match(dit, /Records available:/,
    "et il doit nommer ce qui EST disponible — un refus sans issue se contourne, "
    + "et se contourner ici veut dire comparer au hasard");
});

test("les relevés réellement présents sont comparables — sinon la garde a mangé l'outil", () => {
  /* LA DIRECTION QUI DÉCIDE. Sans elle, le rouge ci-dessus prouverait seulement que la
     commande refuse tout, ce qui est aussi ce que ferait un chemin cassé. */
  const dispo = relevesDisponibles();
  assert.ok(dispo.length >= 2,
    `il faut deux relevés pour éprouver la comparaison, ${dispo.length} trouvé(s)`);
  const r = lancer(dispo.at(-2)!, dispo.at(-1)!);
  assert.equal(r.status, 0, `comparer deux relevés présents doit réussir : ${r.stderr.slice(0, 200)}`);
  assert.match(`${r.stdout}`, /cell\(s\) compared/);
});
