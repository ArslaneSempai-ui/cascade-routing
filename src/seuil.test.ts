/*
 * LE SEUIL QUI DÉCIDE DE L'ARGENT, ET CELUI QUI N'EN DÉCIDE PAS.
 *
 * Le balayage de sensibilité dit quand le routage recommandé change. Ce n'est pas la même
 * question que « à partir de quand la clause bascule », et confondre les deux mettrait un
 * chiffre de recommandation là où un chiffre de remboursement est attendu.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS } from "./assumptions.ts";
import { ORDER } from "./provenance.ts";
import { seuilAdmissibilite, seuilDeCout, seuilsDeRemboursement } from "./seuil.ts";

import type { Titulaire } from "./seuil.ts";

const par = (bons: number, sur: number) => ({ bons, sur });
const TITULAIRE = (ms?: number, cout?: number): Titulaire => ({
  nom: "essai",
  parChamp: { name: par(88, 120), birth: par(95, 120), document: par(90, 120),
    country: par(118, 120), address: par(110, 120) },
  declares: { msParDocument: ms, coutParMilleDocuments: cout },
});

test("le seuil de coût est refusé, pas rendu, sur un titulaire inadmissible", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const hors = seuilDeCout(p, ASSUMPTIONS, TITULAIRE(ASSUMPTIONS.latencyBudgetMs + 600, 3));
  assert.equal(hors.calculable, false);
  assert.equal((hors as { refuse?: boolean }).refuse, true,
    "un seuil de coût sur un titulaire hors plafond doit être refusé et le dire.\n"
    + "  → les prix ne classent que ce qui est déjà admissible ; le rendre serait trompeur.");
  assert.match(hors.pourquoi!, /plafond/);
});

test("les deux seuils sont rendus, que la condition soit remplie ou non", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  for (const cout of [0.01, 9, 1000]) {
    const s = seuilsDeRemboursement(p, ASSUMPTIONS, TITULAIRE(1500, cout));
    assert.ok(s.admissibilite.calculable,
      "l'admissibilité doit être chiffrée quel que soit le coût déclaré.");
    assert.ok("bascule" in s.admissibilite,
      "un seuil qui n'apparaît que dans un sens est un aveu, pas une mesure.");
    assert.ok(s.cout !== undefined, "le seuil de coût doit être rendu ou refusé, jamais absent.");
  }
});

test("les seuils portent `assumed`, y compris quand la condition est confortable", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  for (const [ms, cout] of [[1500, 0.01], [1500, 1000], [3000, 5]] as [number, number][]) {
    const s = seuilsDeRemboursement(p, ASSUMPTIONS, TITULAIRE(ms, cout));
    assert.equal(s.provenance, "assumed");
    assert.equal(s.admissibilite.provenance, "assumed");
    assert.equal(s.cout.provenance, "assumed",
      "un chiffre dont la provenance change selon qu'il nous arrange serait pire que pas de chiffre.");
  }
  assert.ok(ORDER.includes("assumed"),
    "le rang employé doit exister dans le vocabulaire partagé, pas être inventé ici.");
});

test("l'asymétrie de la latence déclarée est écrite, et elle ne va pas dans le sens attendu", () => {
  const s = seuilAdmissibilite(ASSUMPTIONS, TITULAIRE(1500, 5));
  assert.ok(s.calculable);
  assert.match(s.asymetrie!, /trop basse|Trop basse/,
    "la direction qui expose au remboursement à tort doit être nommée.");
  assert.match(s.asymetrie!, /honoraires/,
    "l'autre direction, celle qui rend les honoraires dus, doit l'être aussi.");
});

test("« aucun seuil » distingue ses deux causes, qui ne se corrigent pas pareil", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const s = seuilDeCout(p, ASSUMPTIONS, TITULAIRE(1500, 9));
  if (s.calculable) return t.skip("s.calculable — ce cas n'a rien regardé, et il le dit.");                       // un seuil existe : rien à distinguer ici
  const d = s as { egauxMaisTropLents?: number; plusRapideDesEgauxMs?: number | null; pourquoi?: string };
  assert.ok(d.egauxMaisTropLents !== undefined,
    "l'absence de seuil doit dire si quelque chose égalait le titulaire mais dépassait le plafond.");
  if (d.egauxMaisTropLents! > 0) {
    assert.ok(d.plusRapideDesEgauxMs! > ASSUMPTIONS.latencyBudgetMs,
      "le plus rapide des égaux doit effectivement dépasser le plafond.");
    assert.match(d.pourquoi!, /plafond fixé/,
      "quand la cause est le plafond, il faut le dire : c'est la seule des deux qui se corrige\n"
      + "  en déplaçant un chiffre que le client choisit.");
  }
});

test("le plafond de latence est comparé en millisecondes, pas en millisecondes fois mille", (t) => {
  /*
   * La première version multipliait `latency()` par mille en la croyant en secondes. Chaque
   * routage dépassait donc le plafond, et le seuil rendait « aucun routage admissible n'est
   * indistinguable » — une conclusion fausse, et de celles sur lesquelles on signe une clause.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const s = seuilDeCout(p, ASSUMPTIONS, TITULAIRE(1500, 9)) as { routagesAdmissibles?: number };
  assert.ok((s.routagesAdmissibles ?? 0) > 0,
    "aucun routage n'est jugé admissible : le plafond est comparé à des durées dans la mauvaise\n"
    + "  unité, et tout ce qui suit en dépend.");
});
