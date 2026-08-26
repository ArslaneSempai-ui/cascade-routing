/*
 * LES SIX REFUS DE `measure`, ET AUCUNE MESURE LANCÉE POUR LES ÉPROUVER.
 *
 * Le balayage du 26 août 2026 a montré que les sept `process.exit` de ce fichier n'étaient
 * atteints par aucun cas. Ce sont les codes de sortie qu'une chaîne d'intégration lit, et une
 * session voisine a mesuré qu'y passer `exit(1)` à `exit(0)` laisse la suite entièrement verte.
 *
 * LA DIFFICULTÉ, ET SA SOLUTION. Le contrôle positif d'un refus demande que la commande
 * RÉUSSISSE à le dépasser — or la dépasser ici, c'est lancer une mesure d'une heure qui
 * télécharge plus d'un gigaoctet. On se sert donc d'une AUTRE garde comme point d'arrêt :
 * pour prouver que le contrôle des cas a été franchi, on le passe et on tombe sur le palier
 * inconnu. Le refus attendu change, la commande s'arrête en une seconde, et rien n'est mesuré.
 *
 * `exigerRefus` exige le MESSAGE et jamais le code seul : un module absent, un import cassé,
 * un lien `node_modules` emporté rendent aussi un code non nul, et deux d'entre eux ont déjà
 * été lus comme une garde qui se déclenchait.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";

const CMD = fileURLToPath(new URL("./measure.ts", import.meta.url));
const VOULUE = { MESURE_VOULUE: "1" };
/* Un palier inconnu : le point d'arrêt qui évite qu'une mesure démarre. */
const STOP = "--tiers=palier-qui-nexiste-pas";

test("mesurer sans l'avoir voulu est refusé — la garde qui protège du téléchargement", () => {
  const r = lancer([CMD], { env: { MESURE_VOULUE: "" }, msMax: 20_000 });
  exigerRefus(r, /MESURE_VOULUE=1|je-veux-mesurer/,
    "lancer measure sans intention explicite doit être refusé");
  /*
   * LE CODE EXACT, et non « non nul ». Mesuré : cette garde retirée, l'avertissement s'imprime
   * quand même — il part avant la sortie — et la commande ENCHAÎNE SUR LE TÉLÉCHARGEMENT DE
   * 1,26 Go. Un cas qui se contente d'un code non nul et du bon message reste vert pendant que
   * la seule chose qui protégeait la bande passante d'un lecteur a disparu.
   */
  assert.equal(r.code, 2,
    `le code doit être 2 et non ${r.code} : sans cette garde la commande télécharge 1,26 Go.`);
});

test("un prompt inconnu est refusé PAR SON NOM, et les prompts connus sont dits", () => {
  /* `--tiers=rules` et non STOP : le refus du palier (l. 769) vient AVANT celui du prompt
     (l. 861), donc le point d'arrêt habituel masquerait la garde visée — troisième fois dans ce
     fichier. Le prompt inconnu est ici lui-même le point d'arrêt : il refuse avant de mesurer. */
  /* `--allow-dirty` : l'arbre d'une session qui travaille est sale, et ce refus-là (l. 834)
     vient avant celui du prompt. Quatrième masquage par l'ordre dans ce seul fichier. */
  const r = lancer([CMD, "--prompt=formulation-qui-nexiste-pas", "--tiers=rules",
    "--allow-dirty=témoin du prompt"], { env: VOULUE, msMax: 20_000 });
  /* `pasApres` teste une PRÉSENCE, pas un ordre — et le bandeau « Measuring… downloads
     1.26 GB » s'imprime AVANT le contrôle du prompt. Le mettre dans pasApres dénonçait un
     refus parfaitement terminal. On n'y met que ce qui ne peut s'imprimer qu'une fois la
     mesure réellement engagée : le chargement d'un modèle. */
  exigerRefus(r, /unknown prompt: formulation-qui-nexiste-pas/,
    "un prompt mal tapé doit être refusé", /Loading encoder|Loading model|% \d+ ms/);
  assert.match(r.texte, /the prompts are: /,
    "le refus ne dit pas quels prompts existent : il envoie chercher au lieu de renseigner.");
});

test("moins de vingt cas est refusé : sous ce seuil un taux n'est pas rapportable", () => {
  exigerRefus(lancer([CMD, "--cases=5", STOP], { env: VOULUE }), /--cases must be at least 20/,
    "un échantillon trop petit doit être refusé", /--cases-gen must be|unknown tier/);
  /* CONTRÔLE POSITIF, sans mesurer : avec un compte valide, ce refus-là ne doit PLUS
     apparaître — la commande tombe sur le palier inconnu, donc elle a franchi cette garde. */
  const passe = lancer([CMD, "--cases=120", STOP], { env: VOULUE });
  assert.doesNotMatch(passe.texte, /--cases must be at least 20/,
    "le refus sur le nombre de cas parle alors que le nombre est valide.");
  assert.match(passe.texte, /unknown tier/, "le montage est faux : la commande n'a pas atteint le palier.");
});

test("moins de vingt cas génératifs est refusé de la même façon", () => {
  exigerRefus(lancer([CMD, "--cases-gen=3", STOP], { env: VOULUE }), /--cases-gen must be at least 20/,
    "un échantillon génératif trop petit doit être refusé", /unknown tier/);
});

test("un palier mal tapé est refusé PAR SON NOM, et les paliers connus sont dits", () => {
  const r = lancer([CMD, STOP], { env: VOULUE });
  exigerRefus(r, /unknown tier: palier-qui-nexiste-pas/, "un palier inconnu doit être refusé",
    /uncommitted changes|not this machine/);
  assert.match(r.texte, /the tiers are: /,
    "le refus ne dit pas quels paliers existent : il envoie chercher au lieu de renseigner.");
});

test("un hôte génératif hors de cette machine est refusé — rien ne doit sortir", () => {
  /*
   * La promesse centrale du produit : sans cette garde, chaque document mesuré part chez un
   * hôte tiers, et le document de vente affirme le contraire.
   *
   * PAS DE `STOP` ICI, et c'est ce que la première version avait raté : le refus du palier
   * inconnu vient AVANT celui de l'hôte, donc il arrêtait la commande avant la garde visée.
   * `exigerRefus` l'a dit — « a échoué, mais PAS pour la raison attendue ». Un cas qui aurait
   * regardé le seul code de sortie serait passé au vert en n'éprouvant rien.
   *
   * C'est la garde elle-même qui sert de point d'arrêt : avec un hôte distant elle refuse tout
   * de suite, donc aucune mesure ne démarre.
   */
  /* `--allow-dirty` parce que le refus de l'arbre modifié vient encore AVANT celui-ci, et
     que l'arbre d'une session qui travaille est sale par définition. On dépasse cette garde-là
     délibérément, avec le drapeau qu'elle nomme elle-même — c'est son issue, pas un
     contournement. Deux fois de suite dans ce fichier, l'ordre des refus a masqué la garde
     visée : il n'est écrit nulle part, et il décide de ce qu'un cas peut atteindre. */
  const DIRTY = '--allow-dirty=témoin des refus';
  const r = lancer([CMD, DIRTY], { env: { ...VOULUE, OLLAMA_HOST: "http://198.51.100.7:11434" } });
  exigerRefus(r, /which is not this machine|would leave for that host/,
    "un hôte distant doit être refusé sans --remote-ollama", /Loading|tier .* measured/);
  /* CONTRÔLE POSITIF, borné à trois secondes : un hôte local ne doit PAS être pris pour
     distant. On ne laisse pas la commande aller au bout — elle mesurerait — et on regarde ce
     qu'elle a DIT, jamais son code, puisqu'un processus tué n'en rend pas d'utilisable. */
  const local = lancer([CMD, DIRTY, STOP], { env: { ...VOULUE, OLLAMA_HOST: "http://127.0.0.1:11434" }, msMax: 3000 });
  assert.doesNotMatch(local.texte, /which is not this machine/,
    "un hôte local est pris pour distant : la garde refuserait une mesure parfaitement close.");
});

test("mesurer sur un arbre modifié est refusé, et le refus dit comment passer outre", () => {
  const d = mkdtempSync(join(tmpdir(), "measure-sale-"));
  const clone = join(d, "cascade");
  const racine = fileURLToPath(new URL("..", import.meta.url));
  execFileSync("git", ["clone", "--quiet", racine, clone], { stdio: "pipe" });
  symlinkSync(join(racine, "node_modules"), join(clone, "node_modules"));
  /* `.gitignore` porte `node_modules/` avec une barre : le motif vise un dossier, pas notre
     lien. Sans cette ligne l'arbre est sale dès le départ et on accuserait la garde. */
  appendFileSync(join(clone, ".git", "info", "exclude"), "\nnode_modules\n");
  writeFileSync(join(clone, "src", "sonde.ts"), "export const x = 1;\n");

  /* Un palier VALIDE : le refus de l'arbre sale vient après celui du palier, donc `STOP`
     l'aurait masqué — la même faute que sur l'hôte, dans le même fichier. */
  const r = lancer([join(clone, "src", "measure.ts"), "--tiers=rules"], { cwd: clone, env: VOULUE });
  exigerRefus(r, /uncommitted changes/, "un arbre modifié doit être refusé",
    /not this machine|Loading|unknown tier/);
  assert.equal(r.code, 1, `le code doit être 1 et non ${r.code}.`);
  assert.match(r.texte, /--allow-dirty/,
    "le refus ne dit pas comment passer outre délibérément : un refus sans issue se contourne.");
});
