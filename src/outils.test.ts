/*
 * LES OUTILS NÉS AUJOURD'HUI, ET LEUR PREMIÈRE COUVERTURE.
 *
 * Six scripts ont été écrits en une journée — le banc public, la mesure de fuite, la
 * surveillance du trafic, le questionnaire, le dossier de validation. Aucun n'avait de test.
 * C'est précisément l'état dans lequel se trouvait la prose du README ce matin : juste le jour
 * où on l'écrit, faux la mesure suivante, et invisible entre les deux.
 */

import { test } from "node:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { ecart } from "./benchmark.ts";
import { lire } from "./intake.ts";
import { ASSUMPTIONS } from "./assumptions.ts";
import { readFileSync, existsSync } from "node:fs";

/* ── le banc public : ce qui a bougé d'une exécution à l'autre ── */

test("un premier relevé n'a rien à comparer", () => {
  assert.equal(ecart(null, { paliers: { small: { bons: 600, sur: 1000 } } }), null);
});

test("un palier qui ne bouge pas ne figure pas dans l'écart", () => {
  const m = { paliers: { small: { bons: 633, sur: 1000 } } };
  assert.deepEqual(ecart(m, m), []);
});

test("une chute réelle est signalée comme réelle", () => {
  /* 63,3 % → 51,0 % sur mille cas : les intervalles ne se touchent pas. C'est le cas qu'on
     veut voir crier — un modèle a changé sous les pieds de quelqu'un. */
  const d = ecart({ paliers: { small: { bons: 633, sur: 1000 } } },
                  { paliers: { small: { bons: 510, sur: 1000 } } })!;
  assert.equal(d.length, 1);
  assert.ok(d[0]!.points < 0, "la chute doit être négative");
  assert.equal(d[0]!.reel, true, "douze points sur mille cas doivent être significatifs");
});

test("un frémissement n'est pas présenté comme un écart réel", () => {
  const d = ecart({ paliers: { small: { bons: 633, sur: 1000 } } },
                  { paliers: { small: { bons: 640, sur: 1000 } } })!;
  assert.equal(d[0]!.reel, false, "sept dixièmes de point ne se distinguent pas du bruit");
});

test("deux relevés de tailles différentes ne se comparent pas", () => {
  /* Comparer 300 cas à 1000 mesurerait aussi le changement d'échantillon. Se taire vaut mieux
     que rendre un écart qui mélange deux causes. */
  const d = ecart({ paliers: { small: { bons: 190, sur: 300 } } },
                  { paliers: { small: { bons: 633, sur: 1000 } } })!;
  assert.deepEqual(d, []);
});

/* ── le questionnaire : les réponses deviennent la configuration ── */

test("une réponse vide garde le défaut du dépôt et le dit", () => {
  const l = lire({});
  assert.deepEqual(l.fournies, []);
  assert.equal(l.defauts.length, Object.keys(ASSUMPTIONS).length);
  assert.equal(l.hypotheses.budget, ASSUMPTIONS.budget);
});

test("une valeur hors bornes est refusée, pas corrigée", () => {
  /*
   * Quarante-cinq mille secondes par dossier, c'est une demi-journée : le client a répondu en
   * millisecondes sans le dire. Corriger en devinant produirait un rapport faux avec l'air
   * d'être personnalisé, ce qui est pire qu'un rapport générique.
   */
  const l = lire({ humanSeconds: 45_000 });
  assert.equal(l.fournies.length, 0);
  assert.equal(l.refus.length, 1);
  assert.match(l.refus[0]!, /humanSeconds/);
  assert.equal(l.hypotheses.humanSeconds, ASSUMPTIONS.humanSeconds, "le défaut doit rester");
});

test("l'absence de jeu annoté bloque, elle ne dégrade pas", () => {
  const l = lire({ aUnJeuAnnote: false });
  assert.equal(l.bloquant.length, 1);
  assert.match(l.bloquant[0]!, /rien à mesurer/);
});

test("un seul palier appelable veut dire qu'il n'y a pas de routage", () => {
  const l = lire({ paliersDisponibles: ["one hosted model"] });
  assert.ok(l.bloquant.some((b) => /pas de routage/.test(b)));
});

test("les valeurs valides passent et sont comptées comme fournies", () => {
  const l = lire({ volume: 500_000, latencyBudgetMs: 300 });
  assert.deepEqual(l.fournies.sort(), ["latencyBudgetMs", "volume"]);
  assert.equal(l.hypotheses.volume, 500_000);
  assert.equal(l.hypotheses.latencyBudgetMs, 300);
  assert.ok(l.bloquant.length === 0);
});

/* ── les fichiers de données : une forme, pas un espoir ── */

test("chaque fichier de data/ a la forme que le générateur suppose", () => {
  /*
   * Cinq fichiers ont été créés aujourd'hui — profils, fuite, trafic réseau, rétractations,
   * banc public — et le générateur du README les lit en supposant leur forme. Une clé
   * renommée ne casserait rien à la génération : elle produirait une page avec un tableau
   * vide, ce qui est pire qu'une erreur puisque personne ne la voit.
   */
  const racine = new URL("../", import.meta.url).pathname;
  const attendus: Record<string, string[]> = {
    "data/profiles.json": ["measuredAt", "extraction", "classification"],
    "retractations.json": ["entrees"],
    "data/fuite.json": ["palier", "champs"],
    "data/egress.json": ["mesureLe", "connexions", "verdict"],
    "benchmarks/banking77.json": ["jeu", "source", "cas", "references", "paliers"],
  };
  /*
   * Sauter un fichier absent est légitime ; les sauter tous ne l'est pas forcément.
   *
   * `data/` est ignoré par git : sur un clone frais les cinq fichiers manquent, les cinq sont
   * sautés, et ce test passe au vert en n'ayant rien regardé — dans le test dont le sujet est
   * précisément qu'un tableau vide ne se voit pas. Deux absences se ressemblent et ne se
   * valent pas : « rien n'a encore été produit » et « les fichiers ont changé de nom ».
   *
   * On les sépare par la seule chose qui les distingue : si le dossier existe, quelque chose
   * a été produit, et au moins un des fichiers attendus doit s'y trouver.
   */
  let vus = 0;
  for (const [chemin, cles] of Object.entries(attendus)) {
    if (!existsSync(racine + chemin)) continue;   // pas encore produit : rien à tenir
    vus++;
    const d = JSON.parse(readFileSync(racine + chemin, "utf8"));
    for (const c of cles) {
      assert.ok(c in d, `${chemin} n'a pas de clé « ${c} » — le générateur du README la lit`);
    }
  }
  if (existsSync(racine + "data")) {
    assert.ok(vus > 0,
      "data/ existe mais ne contient aucun des fichiers attendus : leurs noms ont changé, "
      + "et ce test — comme le générateur du README — regarde à côté sans rien signaler.");
  }
});

test("un clone frais rend un chiffre sans intervention manuelle", () => {
  /*
   * Le seul test qui vérifie la promesse plutôt que le code.
   *
   * « Clonez et vérifiez en deux minutes » était faux et rien ne le disait : `data/` est
   * ignoré par git, donc un clone n'a aucun relevé, alors que le dépôt en livre un à la
   * racine. Il fallait le copier à la main — une étape que personne ne devine et qu'aucun
   * test ne pouvait voir, puisque tous tournaient dans un dépôt qui avait déjà mesuré.
   *
   * Celui-ci part d'un clone réel. Il tombe si le repli disparaît, si le relevé cesse d'être
   * livré, ou si le premier nombre se met à exiger un modèle. C'est aussi le seul test dont
   * l'échec se lit directement comme « la phrase de la page est devenue fausse ».
   */
  const racine = new URL("..", import.meta.url).pathname;
  const dossier = mkdtempSync(join(tmpdir(), "clone-promesse-"));
  try {
    execFileSync("git", ["clone", "--quiet", racine, "cascade"], { cwd: dossier, stdio: "pipe" });
    const clone = join(dossier, "cascade");

    /* Les dépendances sont mesurées à part ; ce test porte sur ce que le dépôt livre. */
    symlinkSync(join(racine, "node_modules"), join(clone, "node_modules"), "dir");

    assert.ok(!existsSync(join(clone, "data", "profiles.json")),
      "le clone porte déjà un relevé dans data/ — ce test ne vérifierait plus le repli");

    const sortie = execFileSync(process.execPath, ["src/optimise.ts"],
      { cwd: clone, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    for (const attendu of ["CHAIN A", "chosen"]) {
      assert.ok(sortie.includes(attendu),
        `un clone frais ne rend pas « ${attendu} » sans qu'on l'aide.\n`
        + `  → la promesse « clonez et vérifiez » redemande une étape manuelle.`);
    }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
