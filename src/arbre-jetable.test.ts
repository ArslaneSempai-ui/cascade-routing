/*
 * LE BAC À SABLE NE DOIT JAMAIS NAÎTRE DANS LE VRAI ARBRE.
 *
 * `arbreJetable` copie des répertoires entiers et les efface. Créé sous `~/Documents/`, il
 * effacerait du travail réel — et c'est exactement la famille de défaut que ce dépôt a passé
 * le 26 août 2026 à traquer : un cas qui écrit là où git regarde, un relevé de référence
 * remplacé par une fixture, l'index d'un commit en cours écrasé par un clone.
 *
 * Le balayage a montré que ce refus était le seul de ce fichier qu'aucun cas ne pouvait
 * atteindre : `tmpdir()` était lu directement, donc aucune entrée ne pouvait le déclencher.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arbreJetable } from "./arbre-jetable.ts";

test("un bac à sable sous /Documents/ est refusé, et le refus nomme le chemin", () => {
  /* Une racine dont le NOM contient `/Documents/`, mais qui vit sous /tmp : la garde se
     déclenche sans que rien de réel soit approché. Éprouver ce refus en visant le vrai
     `~/Documents/` serait éprouver une garde en courant le risque qu'elle existe pour écarter. */
  const faux = join(mkdtempSync(join(tmpdir(), "faux-")), "Documents", "cascade");
  mkdirSync(faux, { recursive: true });
  try {
    assert.throws(() => arbreJetable("essai", faux), /terrain d'essai dans le vrai arbre/,
      "un bac à sable créé sous /Documents/ n'a PAS été refusé : il copie et efface des\n"
      + "  répertoires entiers, donc il effacerait du travail réel.");
  } finally {
    rmSync(faux, { recursive: true, force: true });
  }
});

test("une racine ordinaire passe — sinon le refus ci-dessus ne prouverait rien", () => {
  /* CONTRE-ÉPREUVE. Sans elle, une garde qui refuserait TOUT satisferait le premier cas, et
     la fonction serait morte sans que rien ne le dise. */
  const chemin = arbreJetable("essai-ordinaire");
  try {
    assert.ok(chemin.startsWith(tmpdir()) || chemin.includes("/T/") || chemin.includes("/tmp"),
      `l'arbre n'a pas été créé sous un dossier temporaire : ${chemin}`);
  } finally {
    rmSync(chemin, { recursive: true, force: true });
  }
});
