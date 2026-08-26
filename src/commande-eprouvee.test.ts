/*
 * L'AIDE QUI ÉPROUVE LES COMMANDES S'ÉPROUVE ELLE-MÊME.
 *
 * Chaque cas correspond à une façon de se mentir qui a été payée le 26 août 2026, et non à une
 * branche du code. Une aide de contrôle qu'aucun cas ne casse est le vert le plus cher : tous
 * les cas qui s'appuient dessus héritent de son silence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lancer, exigerRefus, exigerQueCaMarcheSansCa } from "./commande-eprouvee.ts";

const script = (corps: string): string => {
  const d = mkdtempSync(join(tmpdir(), "cmd-"));
  const f = join(d, "c.mjs");
  writeFileSync(f, corps);
  return f;
};

test("une commande qui RÉUSSIT là où on attend un refus est dénoncée", () => {
  const s = lancer([script(`process.exit(0);`)]);
  assert.throws(() => exigerRefus(s, /peu importe/, "cas"), /a RÉUSSI \(code 0\)/,
    "un cas qui exige un refus doit tomber quand la commande réussit — sinon il ne mesure rien.");
});

test("un échec pour la MAUVAISE raison est dénoncé, et c'est le cœur de l'aide", () => {
  /* Le piège réel : un module absent, un import cassé, un lien symbolique emporté par un
     `git clean` rendent tous un code non nul. Les trois se sont produits ce jour-là, et deux
     ont été lus comme une garde qui se déclenchait. */
  const s = lancer([join(tmpdir(), "module-qui-nexiste-pas-du-tout.mjs")]);
  assert.notEqual(s.code, 0, "le montage est faux : un module absent devrait faire échouer node.");
  assert.throws(() => exigerRefus(s, /Modified tree/, "cas"), /PAS POUR LA RAISON ATTENDUE/,
    "sans le motif, ce cas passerait au vert sur un environnement abîmé au lieu de la garde.");
});

test("un refus qui dit ce qu'il doit dire passe", () => {
  const s = lancer([script(`console.error("Modified tree: commit before measuring");process.exit(1);`)]);
  exigerRefus(s, /Modified tree/, "cas");
  assert.equal(s.code, 1);
});

test("le contrôle positif tombe quand la commande ne marche pas dans l'état sain", () => {
  const s = lancer([script(`process.exit(3);`)]);
  assert.throws(() => exigerQueCaMarcheSansCa(s, "cas"), /CONTRÔLE POSITIF a échoué/,
    "sans lui, un cas qui exige un échec passe d'autant mieux que tout est cassé.");
  exigerQueCaMarcheSansCa(lancer([script(`process.exit(0);`)]), "cas");
});

test("l'index du commit en cours n'est jamais transmis au sous-processus", () => {
  /* Mesuré : transmis, `git clone --no-local` écrit sa copie de travail DANS cet index et le
     commit en cours part sans rien emporter. Trois sessions l'ont subi. */
  const s = lancer([script(`console.log(JSON.stringify(process.env.GIT_INDEX_FILE ?? null));`)],
    { env: { GIT_INDEX_FILE: "/tmp/index-empoisonne" } });
  assert.equal(s.texte.trim(), "null",
    "GIT_INDEX_FILE a traversé : un sous-processus git écrirait dans l'index de l'appelant.");
});
