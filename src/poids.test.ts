/*
 * LE CACHE DE MODÈLES, ET LA DIFFÉRENCE ENTRE « ABSENT » ET « TRONQUÉ ».
 *
 * L'ancien contrôle additionnait tout le cache et demandait « plus de 50 Mo ? ». Un
 * `model.onnx` tronqué à 57 Mo lui suffisait : il répondait oui, le cas s'exécutait,
 * onnxruntime ouvrait un protobuf coupé, et le processus s'abattait — `libc++abi …
 * mutex lock failed: Invalid argument`, code 134, sans jamais nommer le fichier.
 *
 * Mesuré le 25 août 2026, dans les deux sens et à quelques secondes d'intervalle :
 * fichier à 57 905 102 octets → SIGABRT à 0,2 s ; le même fichier remis à 496 550 525
 * octets → code 0 en 1,5 s, même commande, machine sous charge 2,8.
 *
 * Ces cas fabriquent un faux cache avec des fichiers creux : la taille est ce qui est
 * vérifié, et un `truncate` la donne sans écrire un demi-gigaoctet.
 */

import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
import {
  POIDS_MODELES, MODELES_EXTRACTION, modelesTronques, modelesAbsents,
  exigerModelesEntiers, poidsEnCache, diagnosticDesPoids,
} from "./tiers.ts";

/** Un faux cache où chaque modèle nommé pèse exactement ce qu'on demande. */
function cacheAvec(tailles: Partial<Record<keyof typeof POIDS_MODELES, number>>): string {
  const base = mkdtempSync(join(tmpdir(), "poids-"));
  for (const [cle, octets] of Object.entries(tailles)) {
    const m = POIDS_MODELES[cle as keyof typeof POIDS_MODELES];
    const chemin = join(base, m.depot, m.revision, "onnx", "model.onnx");
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, "");
    truncateSync(chemin, octets);
  }
  return base;
}

test("un modèle tronqué est vu, avec sa taille et celle qu'il devrait avoir", () => {
  const base = cacheAvec({ small: POIDS_MODELES.small.octets, large: 57_905_102 });
  try {
    const abimes = modelesTronques(MODELES_EXTRACTION, base);
    assert.equal(abimes.length, 1, "un seul des deux est coupé.");
    assert.equal(abimes[0]!.cle, "large");
    assert.equal(abimes[0]!.taille, 57_905_102);
    assert.equal(abimes[0]!.attendu, 496_550_525);
    assert.match(abimes[0]!.chemin, /model\.onnx$/, "le fichier doit être nommé, pas le dossier.");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("un modèle tronqué n'est pas un modèle absent", () => {
  const base = cacheAvec({ small: POIDS_MODELES.small.octets, large: 57_905_102 });
  try {
    assert.deepEqual(modelesAbsents(MODELES_EXTRACTION, base), [],
      "les deux fichiers sont là. Les confondre ferait retélécharger là où il faut refuser,\n"
      + "  et se taire là où il faut parler.");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("un fichier PLUS GROS que la taille servie est refusé lui aussi", () => {
  const base = cacheAvec({ small: POIDS_MODELES.small.octets + 1, large: POIDS_MODELES.large.octets });
  try {
    assert.equal(modelesTronques(MODELES_EXTRACTION, base).length, 1,
      "un seuil « au moins tant d'octets » laisserait passer tout fichier assez gros.\n"
      + "  La taille servie est une égalité, pas un plancher.");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("le refus nomme le fichier, les deux tailles et la commande", () => {
  const base = cacheAvec({ small: POIDS_MODELES.small.octets, large: 57_905_102 });
  try {
    assert.throws(() => exigerModelesEntiers(MODELES_EXTRACTION, base), (e: Error) => {
      assert.match(e.message, /model\.onnx/, "le fichier.");
      assert.match(e.message, /57\.9 MB/, "ce qu'il pèse.");
      assert.match(e.message, /496\.6 MB/, "ce qu'il devrait peser.");
      assert.match(e.message, /Delete the directory above and run the same command again/,
        "un refus sans issue se contourne en retirant la garde.");
      assert.ok(!/mutex lock failed/.test(e.message),
        "c'est précisément le message natif qu'on remplace.");
      return true;
    });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("rien n'est refusé quand les deux extracteurs sont entiers", () => {
  const base = cacheAvec({
    small: POIDS_MODELES.small.octets,
    large: POIDS_MODELES.large.octets,
  });
  try {
    assert.deepEqual(modelesTronques(MODELES_EXTRACTION, base), []);
    exigerModelesEntiers(MODELES_EXTRACTION, base);
    assert.equal(poidsEnCache(base), true, "témoin positif : le vert doit être atteignable.");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("le garde du cas long répond « non » sur un cache tronqué, et non « oui » comme avant", () => {
  const tronque = cacheAvec({ small: POIDS_MODELES.small.octets, large: 57_905_102 });
  const absent = mkdtempSync(join(tmpdir(), "poids-vide-"));
  try {
    assert.equal(poidsEnCache(tronque), false,
      "c'est ce « oui » qui lançait le cas et faisait avorter le processus.");
    assert.equal(poidsEnCache(absent), false, "et un cache vide reste un cache vide.");

    /* Témoin de non-vacuité de l'ancien seuil : le cache tronqué pèse bien plus de 50 Mo,
       donc l'ancien contrôle répondait oui exactement là où celui-ci répond non. */
    assert.ok(POIDS_MODELES.small.octets + 57_905_102 > 50_000_000,
      "sans ça, ce cas passerait pour la mauvaise raison.");
  } finally {
    rmSync(tronque, { recursive: true, force: true });
    rmSync(absent, { recursive: true, force: true });
  }
});

test("le diagnostic distingue « pas téléchargé » de « téléchargement coupé »", () => {
  const tronque = cacheAvec({ small: POIDS_MODELES.small.octets, large: 57_905_102 });
  const vide = mkdtempSync(join(tmpdir(), "poids-vide-"));
  const entier = cacheAvec({ small: POIDS_MODELES.small.octets, large: POIDS_MODELES.large.octets });
  try {
    const coupe = diagnosticDesPoids(MODELES_EXTRACTION, tronque);
    assert.match(coupe!, /interrupted download, not a slow machine/,
      "mesuré : le cas se déclarait ignoré avec « sous-processus tué par le délai », en\n"
      + "  242 ms. Le message accusait une lenteur là où il y avait un fichier coupé.");
    assert.match(coupe!, /57\.9 MB/, "et il nomme la taille trouvée.");

    const absent = diagnosticDesPoids(MODELES_EXTRACTION, vide);
    assert.match(absent!, /not in the cache/, "un premier lancement n'est pas une panne.");
    assert.ok(!/interrupted/.test(absent!), "et ne doit pas être annoncé comme telle.");

    assert.equal(diagnosticDesPoids(MODELES_EXTRACTION, entier), undefined,
      "témoin positif : rien à dire quand tout est entier.");
  } finally {
    for (const d of [tronque, vide, entier]) rmSync(d, { recursive: true, force: true });
  }
});

test("tout modèle que le code ouvre a son poids dans la table", () => {
  /*
   * LA TABLE NE SE RÉCITE PAS : ELLE SE CONFRONTE À CE QUE LE CODE CHARGE.
   *
   * `POIDS_MODELES` est écrite à la main. Le jour où un cinquième `pipeline(...)` arrive
   * sans sa taille, `modelesTronques` ne le regarde pas — et rend un tableau vide, qui se
   * lit « rien n'est tronqué ». Un zéro parfaitement silencieux.
   *
   * La seule source juste est le fichier qui appelle : chaque dépôt de modèle qui traverse
   * `pipeline()` doit être déclaré ici.
   */
  const src = readFileSync(fileURLToPath(new URL("./tiers.ts", import.meta.url)), "utf8");
  const charges = [...src.matchAll(/pipeline\([^,]+,\s*"([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(charges.length > 0, "témoin de non-vacuité : le motif trouve bien des appels.");

  const declares = new Set<string>(Object.values(POIDS_MODELES).map((m) => m.depot));
  for (const depot of charges) {
    assert.ok(declares.has(depot),
      `${depot} est chargé par ce fichier et n'a pas de poids déclaré : son fichier tronqué\n`
      + "  ne serait jamais vu, et le contrôle rendrait « rien n'est tronqué ».");
  }
  assert.equal(declares.size, new Set(charges).size,
    "et l'inverse : un poids déclaré pour un modèle que plus personne ne charge est une\n"
    + "  ligne que rien ne vérifie.");
});
