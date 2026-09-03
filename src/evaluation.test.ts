/**
 * LE COMPTEUR D'ÉVALUATION, ÉPROUVÉ.
 *
 * Le trou que ces cas ferment : une clause de licence (trente jours « from first use »)
 * qui vivait sur le papier et nulle part dans le code. Chaque cas correspond à une façon
 * précise pour ce rappel de mentir : compter faux, se taire sur un raté d'écriture,
 * diverger de la clause qu'il matérialise, ou — le pire pour cette maison — toucher au
 * réseau.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JOURS_EVALUATION, jourDepuis, lignesEvaluation, marquer } from "./evaluation.ts";

const fichierTemp = (): string => join(mkdtempSync(join(tmpdir(), "eval-")), "premiere.json");

test("le premier lancement horodate, le second relit sans réécrire", () => {
  const f = fichierTemp();
  const t0 = new Date("2026-09-04T10:00:00Z");
  const a = marquer(f, t0);
  assert.equal(a.neuf, true);
  assert.equal(a.premiere, t0.toISOString());
  const b = marquer(f, new Date("2026-09-20T10:00:00Z"));
  assert.equal(b.neuf, false);
  assert.equal(b.premiere, t0.toISOString(),
    "un second lancement qui ré-horodate remettrait le compteur à zéro à chaque fois");
});

test("le jour se compte depuis le premier usage : 1 le jour même, 30 au trentième, puis dépassé", () => {
  const premiere = "2026-09-01T09:00:00Z";
  assert.equal(jourDepuis(premiere, new Date("2026-09-01T18:00:00Z")), 1);
  assert.equal(jourDepuis(premiere, new Date("2026-09-30T09:00:01Z")), 30);
  assert.equal(jourDepuis(premiere, new Date("2026-10-01T09:00:01Z")), 31);
  assert.equal(jourDepuis(premiere, new Date("2026-08-20T00:00:00Z")), 1,
    "une horloge qui recule ne doit pas produire un jour négatif");
});

test("dans la fenêtre : une ligne discrète, qui dit aussi que le non-commercial n'a pas d'horloge", () => {
  const f = fichierTemp();
  marquer(f, new Date("2026-09-01T09:00:00Z"));
  const lignes = lignesEvaluation(f, new Date("2026-09-12T09:00:00Z"));
  assert.equal(lignes.length, 1);
  assert.match(lignes[0]!, /day 12 of 30/);
  assert.match(lignes[0]!, /noncommercial use has no clock/i,
    "sans cette précision, le rappel aboie sur un chercheur qui n'est en faute de rien");
});

test("passé trente jours : le rappel nomme la suite, sans bloquer quoi que ce soit", () => {
  const f = fichierTemp();
  marquer(f, new Date("2026-06-01T09:00:00Z"));
  const lignes = lignesEvaluation(f, new Date("2026-09-04T09:00:00Z"));
  const tout = lignes.join(" ");
  assert.match(tout, /thirty days have passed/);
  assert.match(tout, /cascade-routing\.com\/engagement\.html/,
    "un rappel sans issue se fait contourner ; celui-ci donne la porte suivante");
  assert.match(tout, /no clock/i);
});

test("un marqueur illisible est remplacé, et le remplacement se DIT", () => {
  const f = fichierTemp();
  writeFileSync(f, "{ceci n'est pas du json");
  const lignes = lignesEvaluation(f, new Date("2026-09-04T09:00:00Z"));
  assert.match(lignes[0]!, /unreadable and has been rewritten/,
    "réparer en silence ferait d'un fichier corrompu un compteur remis à zéro sans témoin");
  const relu = JSON.parse(readFileSync(f, "utf8")) as { premiereUtilisation: string };
  assert.ok(relu.premiereUtilisation);
});

test("le compteur et la clause disent le même nombre : LICENCES.md porte toujours les trente jours", () => {
  const licences = readFileSync(
    fileURLToPath(new URL("../LICENCES.md", import.meta.url)), "utf8");
  assert.match(licences, /thirty days/i,
    "si la clause change de durée, ce test force le compteur à suivre au lieu de mentir");
  assert.equal(JOURS_EVALUATION, 30);
});

test("le module ne touche pas au réseau : aucun import réseau dans sa source", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./evaluation.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /node:(http|https|net|dns|tls|dgram)|fetch\s*\(/,
    "la promesse centrale du produit est que rien ne part ; ce compteur n'y fait pas exception");
});

test("le marqueur écrit se déclare lui-même : local, jamais transmis, et cite la clause", () => {
  const f = fichierTemp();
  marquer(f, new Date("2026-09-04T09:00:00Z"));
  const contenu = readFileSync(f, "utf8");
  assert.match(contenu, /never transmitted/);
  assert.match(contenu, /LICENCES\.md/);
});
