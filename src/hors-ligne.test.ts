/**
 * `CASCADE_OFFLINE=1`, ÉPROUVÉ — LE RÉGLAGE, PUIS LE REFUS QU'IL ACHÈTE.
 *
 * Le README l'annonçait à un acheteur de banque et le déclarait non testé, ce qui est la pire
 * des deux positions : la phrase engage, et rien ne la tient. Le drapeau fait deux choses, et
 * il en fallait deux cas — refuser AVANT de tenter ce qui manque, puis couper le réseau de la
 * bibliothèque pour tout ce que notre liste n'a pas su énumérer.
 *
 * LE SECOND EST CELUI QUI COMPTE ICI, ET IL NE S'ASSÈRE PAS SUR UN BOOLÉEN. Lire
 * `allowRemoteModels === false` prouve qu'un champ a changé, pas qu'une sortie est fermée : un
 * champ peut être vrai et n'être lu par personne. Le cas plante donc un piège sur `fetch` et
 * demande un modèle absent du cache — coupée, la bibliothèque ne sort pas une seule fois ;
 * ouverte, elle sort exactement une fois, vers huggingface.co. C'est la MÊME mesure des deux
 * côtés, et c'est le seul agencement où un vert dit quelque chose.
 *
 * Rien ici ne télécharge : le modèle demandé n'existe pas, et le piège ne laisse rien partir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { env as envHF } from "@huggingface/transformers";
import { armerHorsLigne, POIDS_MODELES, MODELES_EXTRACTION } from "./tiers.ts";

const M = POIDS_MODELES.small;

/** Un cache garni qui a la forme que la bibliothèque écrit, pour les deux modèles d'extraction. */
function cacheGarni(): string {
  const base = mkdtempSync(join(tmpdir(), "cascade-hors-ligne-"));
  for (const cle of MODELES_EXTRACTION) {
    const m = POIDS_MODELES[cle];
    for (const rel of ["onnx/model.onnx", "config.json", "tokenizer.json"]) {
      const p = join(base, m.depot, m.revision, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "des octets qui font office de modèle");
    }
  }
  return base;
}

/**
 * Reposer l'état du processus après chaque cas.
 *
 * `envHF` et `process.env` sont GLOBAUX : un cas qui laisse `allowRemoteModels` à faux rendrait
 * vrai le cas suivant sans que celui-ci ait rien posé. C'est la forme la plus discrète du vert
 * vide, et elle ne se voit qu'en changeant l'ordre des cas.
 */
function avecEtatRendu<T>(quoi: () => T): T {
  const drapeau = process.env.CASCADE_OFFLINE;
  const distant = envHF.allowRemoteModels;
  try { return quoi(); }
  finally {
    if (drapeau === undefined) delete process.env.CASCADE_OFFLINE; else process.env.CASCADE_OFFLINE = drapeau;
    envHF.allowRemoteModels = distant;
  }
}

test("sans le drapeau, rien n'est armé et le réseau de la bibliothèque reste ouvert", async () => {
  await avecEtatRendu(async () => {
    delete process.env.CASCADE_OFFLINE;
    envHF.allowRemoteModels = true;
    /* CONTRE-ÉPREUVE DU CAS SUIVANT. Sans elle, une fonction qui couperait TOUJOURS passerait
       le cas d'à côté en prétendant obéir à un drapeau qu'elle ne lit pas. */
    assert.equal(await armerHorsLigne(MODELES_EXTRACTION), false,
      "le hors-ligne s'est armé alors que CASCADE_OFFLINE n'est pas posé.");
    assert.equal(envHF.allowRemoteModels, true,
      "le réseau de la bibliothèque a été coupé sans que le drapeau le demande.");
  });
});

test("avec le drapeau et les poids sur place, la bibliothèque est coupée du réseau", async () => {
  const garni = cacheGarni();
  await avecEtatRendu(async () => {
    process.env.CASCADE_OFFLINE = "1";
    envHF.allowRemoteModels = true;
    assert.equal(await armerHorsLigne(MODELES_EXTRACTION, garni), true);
    assert.equal(envHF.allowRemoteModels, false,
      "`CASCADE_OFFLINE=1` n'a pas coupé le réseau de la bibliothèque : le refus préalable ne "
      + "regarde que `model.onnx`, et tout ce qu'il n'énumère pas repartirait en téléchargement.");
  });
  rmSync(garni, { recursive: true, force: true });
});

test("avec le drapeau et un modèle absent, le refus vient AVANT tout téléchargement", async () => {
  const vide = mkdtempSync(join(tmpdir(), "cascade-hors-ligne-vide-"));
  await avecEtatRendu(async () => {
    process.env.CASCADE_OFFLINE = "1";
    envHF.allowRemoteModels = true;
    await assert.rejects(() => armerHorsLigne(MODELES_EXTRACTION, vide), (e: Error) => {
      assert.match(e.message, /CASCADE_OFFLINE=1/);
      assert.match(e.message, /--import/, "sur une machine isolée, l'issue est l'import, et le refus doit la nommer.");
      assert.doesNotMatch(e.message, /huggingface\.co/, "on ne renvoie pas vers un domaine qui est justement bloqué.");
      return true;
    });
  });
  rmSync(vide, { recursive: true, force: true });
});

test("coupée, la bibliothèque ne sort pas une seule fois ; ouverte, elle sort", () => {
  /*
   * DANS UN PROCESSUS FILS, ET LA PREMIÈRE VERSION DE CE CAS DIT POURQUOI. Elle plantait le
   * piège dans CE processus — mais `tiers.ts` était déjà importé en tête de fichier, donc la
   * bibliothèque avec lui, et elle garde la référence à `fetch` qu'elle a vue au chargement.
   * Le piège n'a rien intercepté : ZÉRO sortie des deux côtés. Le témoin positif l'a dit tout
   * de suite ; sans lui, la branche coupée rendait zéro et se lisait comme une preuve.
   *
   * Le fils passe par le VRAI drapeau, pas par le champ : `CASCADE_OFFLINE` dans son
   * environnement, `armerHorsLigne` appelée comme le chargeur l'appelle. Ce qu'on mesure est
   * donc ce que l'acheteur pose sur sa ligne de commande.
   */
  const garni = cacheGarni();
  const RACINE = fileURLToPath(new URL("..", import.meta.url));
  const ENFANT = `
    globalThis.fetch = async (u) => { console.log("SORTIE " + String(u?.url ?? u)); throw new Error("piégé"); };
    const { armerHorsLigne, MODELES_EXTRACTION } = await import("./src/tiers.ts");
    await armerHorsLigne(MODELES_EXTRACTION, process.env.CASCADE_CACHE_FACTICE);
    const { pipeline } = await import("@huggingface/transformers");
    try { await pipeline("feature-extraction", "cascade-inexistant/aucun-modele"); } catch { /* les deux branches échouent */ }
  `;

  /** Les destinations que `fetch` a vues dans un fils, drapeau posé ou non. */
  const sortiesPour = (horsLigne: boolean): string[] => {
    const env: NodeJS.ProcessEnv = { ...process.env, CASCADE_CACHE_FACTICE: garni };
    if (horsLigne) env.CASCADE_OFFLINE = "1"; else delete env.CASCADE_OFFLINE;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", ENFANT],
      { cwd: RACINE, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, `le fils est sorti en ${r.status} :\n${r.stderr}`);
    return r.stdout.split("\n").filter((l) => l.startsWith("SORTIE ")).map((l) => l.slice(7));
  };

  /* LE TÉMOIN DE LA MESURE ELLE-MÊME, ET IL A DÉJÀ SERVI. Si la bibliothèque cessait de passer
     par `fetch`, les deux branches rendraient zéro et le zéro de la branche coupée ne dirait
     plus rien — il dirait seulement que le piège ne regarde plus au bon endroit. */
  const ouvertes = sortiesPour(false);
  assert.ok(ouvertes.length > 0,
    "réseau ouvert, aucune sortie n'a été vue : le piège ne mesure plus rien, et le zéro de la "
    + "branche coupée ne prouverait donc plus la coupure.");
  assert.ok(ouvertes.some((u) => u.includes("huggingface.co")),
    `réseau ouvert, les sorties vues ne vont pas chez le dépôt de modèles : ${ouvertes.join(", ")}`);

  const coupees = sortiesPour(true);
  assert.deepEqual(coupees, [],
    `\`CASCADE_OFFLINE=1\` coupe le réseau et ${coupees.length} sortie(s) sont parties quand même :\n`
    + `  ${coupees.join("\n  ")}\n`
    + "  → c'est la promesse que ce drapeau vend à une banque, et elle vient de devenir fausse.");

  rmSync(garni, { recursive: true, force: true });
});

test("le chargeur pose bien le hors-ligne, au lieu de laisser la garde orpheline", () => {
  /*
   * LE CAS QUI MANQUERAIT SANS CELUI-CI. Les quatre cas ci-dessus appellent `armerHorsLigne`
   * directement : ils resteraient tous verts le jour où `chargerAvecFilet` cesse de l'appeler,
   * et la garde vivrait, éprouvée, sans être sur le chemin. C'est exactement la forme du défaut
   * qui ne vit dans le fichier de personne — une fonction correcte que plus rien n'appelle.
   */
  const src = readFileSync(fileURLToPath(new URL("./tiers.ts", import.meta.url)), "utf8");
  const corps = src.slice(src.indexOf("async function chargerAvecFilet"));
  const fin = corps.indexOf("\n}\n");
  assert.ok(fin > 0, "`chargerAvecFilet` est introuvable dans tiers.ts : la lecture a échoué.");
  assert.match(corps.slice(0, fin), /armerHorsLigne\(/,
    "`chargerAvecFilet` n'appelle plus `armerHorsLigne` : le hors-ligne n'est plus posé sur le "
    + "chemin du chargement, et les cas qui l'éprouvent resteraient verts.");

  /* CONTRE-ÉPREUVE : la lecture doit distinguer. Un découpage qui rend tout le fichier
     trouverait l'appel même s'il avait migré ailleurs. */
  const faux = "async function chargerAvecFilet<T>(): Promise<T> {\n  return charger();\n}\n"
    + "await armerHorsLigne(MODELES_EXTRACTION);\n";
  const fauxCorps = faux.slice(faux.indexOf("async function chargerAvecFilet"));
  assert.doesNotMatch(fauxCorps.slice(0, fauxCorps.indexOf("\n}\n")), /armerHorsLigne\(/,
    "le découpage déborde du corps : il verrait un appel resté ailleurs dans le fichier.");
});
