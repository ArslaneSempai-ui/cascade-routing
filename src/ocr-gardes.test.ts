/**
 * LE REFUS DE LIRE QUAND LE PREMIER MAILLON MANQUE — SUR LES DEUX PLATEFORMES.
 *
 * `lire()` refuse plutôt que de mesurer une chaîne dont l'étage de lecture n'a pas pu être
 * compilé. Le refus a survécu à un balayage qui le retirait, et la première explication était
 * fausse : je l'avais donné pour inatteignable après avoir mesuré que `ceQuiManque()` compile
 * le binaire à la demande — vrai de cette machine, faux de celle qui décide.
 *
 * **L'intégration publique tourne sur `ubuntu-latest`**, et `ceQuiManque()` rend un message
 * dès que la plateforme n'est pas macOS. Le refus y est donc pleinement atteignable, et c'est
 * là que la vérification publiée se fait.
 *
 * Un seul cas, sans saut, qui affirme dans les deux états. Pas de branche muette : la
 * plateforme décide laquelle des deux propriétés est vraie ici, et les deux sont éprouvées là
 * où elles ont un sens. Un cas sauté occuperait la place du contrôle qui aurait pu exister —
 * et la chaîne publique refuse tout saut, à raison.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ceQuiManque, lire } from "./ocr.ts";

test("le lecteur d'images refuse en nommant ce qui manque, ou nomme ses pannes", () => {
  const manque = ceQuiManque();

  if (manque !== null) {
    /* CHEMIN DE L'INTÉGRATION PUBLIQUE — ubuntu, pas de lecteur macOS.
       Le refus doit porter LA raison du manque, pas un « command failed » : c'est elle qui
       dit quoi installer, et un refus sans issue se contourne. */
    assert.throws(() => lire("/tmp/cascade-temoin.png"), (e: unknown) => {
      assert.equal((e as Error).message, manque,
        "le refus doit reprendre mot pour mot ce que `ceQuiManque()` a diagnostiqué");
      return true;
    });
    return;
  }

  /* CHEMIN DE LA MACHINE OUTILLÉE — le lecteur existe, donc on éprouve ce qu'il fait de deux
     entrées impossibles. Un tableau vide se lirait comme « pas de texte », qui est un FAIT ;
     ces deux-là sont des pannes, et les deux ne doivent pas se rapporter pareil. */
  for (const [chemin, motif] of [
    ["/tmp/cascade-temoin-absent.png", /introuvable/],
    ["/etc/hosts", /pas une image/],
  ] as const) {
    assert.throws(() => lire(chemin), motif,
      `${chemin} doit produire un refus nommé, jamais un tableau vide`);
  }
});
