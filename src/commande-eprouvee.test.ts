/*
 * L'AIDE QUI ÉPROUVE LES COMMANDES S'ÉPROUVE ELLE-MÊME.
 *
 * Chaque cas correspond à une façon de se mentir qui a été payée le 26 août 2026, et non à une
 * branche du code. Une aide de contrôle qu'aucun cas ne casse est le vert le plus cher : tous
 * les cas qui s'appuient dessus héritent de son silence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  assert.throws(() => exigerRefus(s, /peu importe/, "cas"), /SUCCEEDED \(exit 0\)/,
    "un cas qui exige un refus doit tomber quand la commande réussit — sinon il ne mesure rien.");
});

test("un échec pour la MAUVAISE raison est dénoncé, et c'est le cœur de l'aide", () => {
  /* Le piège réel : un module absent, un import cassé, un lien symbolique emporté par un
     `git clean` rendent tous un code non nul. Les trois se sont produits ce jour-là, et deux
     ont été lus comme une garde qui se déclenchait. */
  const s = lancer([join(tmpdir(), "module-qui-nexiste-pas-du-tout.mjs")]);
  assert.notEqual(s.code, 0, "le montage est faux : un module absent devrait faire échouer node.");
  assert.throws(() => exigerRefus(s, /Modified tree/, "cas"), /NOT FOR THE EXPECTED REASON/,
    "sans le motif, ce cas passerait au vert sur un environnement abîmé au lieu de la garde.");
});

test("un refus qui dit ce qu'il doit dire passe", () => {
  const s = lancer([script(`console.error("Modified tree: commit before measuring");process.exit(1);`)]);
  exigerRefus(s, /Modified tree/, "cas");
  assert.equal(s.code, 1);
});

test("le contrôle positif tombe quand la commande ne marche pas dans l'état sain", () => {
  const s = lancer([script(`process.exit(3);`)]);
  assert.throws(() => exigerQueCaMarcheSansCa(s, "cas"), /POSITIVE CONTROL failed/,
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

/*
 * UNE GARDE DE PROVENANCE, ÉPROUVÉE DE BOUT EN BOUT.
 *
 * `apparier-prompt.ts` refuse de mesurer sur un arbre modifié. Ce n'est pas du confort : le
 * relevé qu'il écrit porte le commit courant, et un relevé estampillé d'un commit qui ne
 * contient pas le code mesuré affirme une provenance fausse — qui se cite ensuite.
 *
 * La garde lit l'arbre du module lui-même, donc elle s'éprouve dans un clone. Le contrôle
 * positif ne va pas au bout : la commande lancerait une vraie mesure. Il exige seulement
 * qu'elle DÉPASSE cette garde, ce qui est exactement ce qu'on veut savoir.
 */
test("mesurer sur un arbre modifié est refusé, et le refus dit quoi faire", { timeout: 120_000 }, () => {
  const d = mkdtempSync(join(tmpdir(), "cascade-sale-"));
  const clone = join(d, "cascade");
  const racine = fileURLToPath(new URL("..", import.meta.url));
  execFileSync("git", ["clone", "--quiet", racine, clone], { stdio: "pipe" });
  symlinkSync(join(racine, "node_modules"), join(clone, "node_modules"));
  /*
   * `.gitignore` porte `node_modules/`, avec une barre : le motif vise un DOSSIER, et notre
   * lien symbolique n'en est pas un. Sans cette ligne l'arbre du clone est sale dès le départ,
   * le contrôle positif tombe, et on accuse la garde de crier à tort alors qu'elle a raison.
   * On exclut donc localement — ce qui ne modifie ni le dépôt ni ce que le clone porte.
   */
  appendFileSync(join(clone, ".git", "info", "exclude"), "\nnode_modules\n");

  const cmd = [join(clone, "src", "apparier-prompt.ts"), "--cases=1"];

  /* CONTRÔLE POSITIF D'ABORD : sur l'arbre propre, la garde ne doit PAS parler. Sans lui, le
     refus mesuré ensuite pourrait venir de n'importe quoi — un import cassé, par exemple. */
  /*
   * LE MOTIF VISE LA CAUSE, PAS LA FORMULATION. Il cherchait « Modified tree: commit before
   * measuring », la phrase d'`apparier-prompt` quand chaque commande avait sa propre copie de
   * la garde. Les huit copies ont été réunies dans `arbre-propre.ts` le 27 août 2026, et le
   * refus dit maintenant la CONSÉQUENCE — un relevé non reproductible — en nommant les
   * fichiers et l'issue. « uncommitted changes » est ce que les sept commandes partagent.
   */
  const propre = lancer(cmd, { cwd: clone, msMax: 20_000 });
  assert.doesNotMatch(propre.texte, /uncommitted changes/,
    "la garde parle sur un arbre PROPRE : elle ne mesure donc pas ce qu'elle prétend.\n"
    + `  ${JSON.stringify(propre.texte.slice(0, 200))}`);

  writeFileSync(join(clone, "src", "sonde.ts"), "export const x = 1;\n");
  const refus = lancer(cmd, { cwd: clone, msMax: 20_000 });
  exigerRefus(refus, /uncommitted changes/, "un arbre modifié doit être refusé");
  /* Et l'issue doit être là : c'est ce que la réunion des huit copies avait pour but. */
  assert.match(refus.texte, /--allow-dirty/,
    "le refus ne dit plus comment passer outre — un refus sans issue se contourne, et c'est\n"
    + "  précisément ce qui a été corrigé ici.");
});
