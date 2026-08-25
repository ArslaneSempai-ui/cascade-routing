/**
 * LE REFUS DE LIRE QUAND LE PREMIER MAILLON MANQUE.
 *
 * `lire()` refuse plutôt que de mesurer une chaîne dont l'étage de lecture n'a pas pu être
 * compilé. Le refus a survécu à un balayage, et la raison est mesurée plutôt que supposée :
 * `ceQuiManque()` compile le binaire à la demande, donc sur une machine avec les outils Xcode
 * il rend toujours `null` et le refus ne peut pas tomber.
 *
 * Le cas ci-dessous s'exécute donc là où il est atteignable — une machine sans `swiftc`, ou
 * une plateforme autre que macOS — et **se déclare sauté ailleurs, avec sa raison**. Un saut
 * nommé est un fait ; un test absent est un trou.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ceQuiManque, lire } from "./ocr.ts";

test("quand le lecteur d'images manque, `lire` refuse au lieu de mesurer à moitié", (t) => {
  const manque = ceQuiManque();
  if (manque === null) {
    return t.skip("machine outillée : ceQuiManque() rend null après avoir compilé le binaire, "
      + "donc ce refus est inatteignable ici — voir la raison écrite dans ocr.ts");
  }
  assert.throws(() => lire("/tmp/peu-importe.png"), (e: unknown) => {
    assert.equal((e as Error).message, manque,
      "le refus doit porter LA raison du manque, pas un « command failed » : c'est elle qui "
      + "dit quoi installer");
    return true;
  });
});

test("sur une machine outillée, la lecture rend un fait ou une panne nommée, jamais un vide", (t) => {
  /* LA DIRECTION QUI DÉCIDE, et elle est atteignable ici. Deux entrées impossibles à lire :
     le refus doit NOMMER pourquoi, parce qu'un tableau vide se lirait comme « pas de texte »
     — un fait — alors que c'est une panne. */
  const manque = ceQuiManque();
  if (manque !== null) {
    return t.skip("le lecteur d'images n'est pas disponible sur cette machine, donc il n'y a "
      + "rien à lire — un saut nommé plutôt qu'un retour muet");
  }
  for (const [chemin, motif] of [
    ["/tmp/cascade-temoin-absent.png", /introuvable/],
    ["/etc/hosts", /pas une image/],
  ] as const) {
    assert.throws(() => lire(chemin), motif,
      `${chemin} doit produire un refus nommé, jamais un tableau vide`);
  }
});
