/**
 * `CRUSETRA_OFFLINE=1`, ÉPROUVÉ, ET SON ANCIEN NOM `CASCADE_OFFLINE=1` AVEC LUI : LE RÉGLAGE,
 * PUIS LE REFUS QU'IL ACHÈTE.
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync, linkSync, copyFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { env as envHF, AutoConfig } from "@huggingface/transformers";
import { armerHorsLigne, POIDS_MODELES, MODELES_EXTRACTION, racineDesPoids, poidsEnCache, diagnosticDesPoids } from "./tiers.ts";
import { poserSousMain, FICHIERS_SOUS_MAIN, CODE_ECART_TEMOIN, raisonPoidsAbsents } from "./poids.ts";

const M = POIDS_MODELES.small;

/** Un cache garni qui a la forme que la bibliothèque écrit, pour les deux modèles d'extraction. */
function cacheGarni(): string {
  const base = mkdtempSync(join(tmpdir(), "cascade-hors-ligne-"));
  for (const cle of MODELES_EXTRACTION) {
    const m = POIDS_MODELES[cle];
    for (const rel of ["onnx/model.onnx", "config.json", "tokenizer.json", "tokenizer_config.json"]) {
      const p = join(base, m.depot, m.revision, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, rel === "tokenizer_config.json" ? `{"model": "${m.depot}"}` : "des octets qui font office de modèle");
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
 *
 * L'ÉTAT SE REND QUAND LE CAS A FINI, PAS À SON PREMIER `await`. Rendu dans un `finally`
 * synchrone, il l'était dès que le cas asynchrone rendait sa promesse : `armerHorsLigne`
 * continuait ensuite sous un environnement déjà reposé, et laissait `allowRemoteModels` à faux
 * derrière lui. Vu le 5 octobre 2026, quand le refus s'est mis à lire le drapeau pour se
 * nommer : posé par CASCADE_OFFLINE seul, il disait CRUSETRA_OFFLINE, que personne n'avait posé.
 */
function avecEtatRendu<T>(quoi: () => T): T {
  const drapeaux = { CRUSETRA_OFFLINE: process.env.CRUSETRA_OFFLINE, CASCADE_OFFLINE: process.env.CASCADE_OFFLINE };
  const distant = envHF.allowRemoteModels;
  const rendre = () => {
    for (const [nom, valeur] of Object.entries(drapeaux)) {
      if (valeur === undefined) delete process.env[nom]; else process.env[nom] = valeur;
    }
    envHF.allowRemoteModels = distant;
  };
  let resultat: T;
  try { resultat = quoi(); } catch (e) { rendre(); throw e; }
  if (resultat instanceof Promise) return resultat.finally(rendre) as T;
  rendre();
  return resultat;
}

/** Les deux noms du drapeau : le nouveau, et l'ancien qu'un script client pose peut-être déjà. */
const NOMS_DU_DRAPEAU = ["CRUSETRA_OFFLINE", "CASCADE_OFFLINE"] as const;

test("sans le drapeau, rien n'est armé et le réseau de la bibliothèque reste ouvert", async () => {
  await avecEtatRendu(async () => {
    for (const nom of NOMS_DU_DRAPEAU) delete process.env[nom];
    envHF.allowRemoteModels = true;
    /* CONTRE-ÉPREUVE DU CAS SUIVANT. Sans elle, une fonction qui couperait TOUJOURS passerait
       le cas d'à côté en prétendant obéir à un drapeau qu'elle ne lit pas. */
    assert.equal(await armerHorsLigne(MODELES_EXTRACTION), false,
      "le hors-ligne s'est armé alors que ni CRUSETRA_OFFLINE ni CASCADE_OFFLINE n'est posé.");
    assert.equal(envHF.allowRemoteModels, true,
      "le réseau de la bibliothèque a été coupé sans que le drapeau le demande.");
  });
});

for (const nom of NOMS_DU_DRAPEAU) {
  test(`avec ${nom}=1 seul et les poids sur place, la bibliothèque est coupée du réseau`, async () => {
    const garni = cacheGarni();
    await avecEtatRendu(async () => {
      for (const autre of NOMS_DU_DRAPEAU) delete process.env[autre];
      process.env[nom] = "1";
      envHF.allowRemoteModels = true;
      assert.equal(await armerHorsLigne(MODELES_EXTRACTION, garni), true);
      assert.equal(envHF.allowRemoteModels, false,
        `\`${nom}=1\` n'a pas coupé le réseau de la bibliothèque : le refus préalable ne `
        + "regarde que `model.onnx`, et tout ce qu'il n'énumère pas repartirait en téléchargement.");
    });
    rmSync(garni, { recursive: true, force: true });
  });
}

test("CASCADE_OFFLINE=1 refuse toujours, même si CRUSETRA_OFFLINE dit autre chose", async () => {
  /* L'ANCIEN NOM NE SE DÉSARME PAS PAR LE NOUVEAU. Un client qui pose CASCADE_OFFLINE=1 depuis
     des mois n'a jamais entendu parler de CRUSETRA_OFFLINE : une valeur de celui-ci, quelle
     qu'elle soit, ne doit pas rouvrir le réseau qu'il a fermé. */
  const garni = cacheGarni();
  await avecEtatRendu(async () => {
    process.env.CASCADE_OFFLINE = "1";
    process.env.CRUSETRA_OFFLINE = "0";
    envHF.allowRemoteModels = true;
    assert.equal(await armerHorsLigne(MODELES_EXTRACTION, garni), true,
      "CRUSETRA_OFFLINE=0 a désarmé CASCADE_OFFLINE=1 : le script d'un client sortirait sur le réseau.");
    assert.equal(envHF.allowRemoteModels, false);
  });
  rmSync(garni, { recursive: true, force: true });
});

/* Le message nomme le nouveau nom ; posé par l'ancien seul, il dit lequel a refusé, et le nom à employer. */
const MESSAGE_DU_DRAPEAU: Record<(typeof NOMS_DU_DRAPEAU)[number], RegExp> = {
  CRUSETRA_OFFLINE: /^CRUSETRA_OFFLINE=1 is set and /,
  CASCADE_OFFLINE: /^CASCADE_OFFLINE=1 \(the former name of CRUSETRA_OFFLINE=1\) is set and /,
};
for (const nom of NOMS_DU_DRAPEAU) {
  test(`avec ${nom}=1 seul et un modèle absent, le refus vient AVANT tout téléchargement`, async () => {
    const vide = mkdtempSync(join(tmpdir(), "cascade-hors-ligne-vide-"));
    await avecEtatRendu(async () => {
      for (const autre of NOMS_DU_DRAPEAU) delete process.env[autre];
      process.env[nom] = "1";
      envHF.allowRemoteModels = true;
      await assert.rejects(() => armerHorsLigne(MODELES_EXTRACTION, vide), (e: Error) => {
        assert.match(e.message, MESSAGE_DU_DRAPEAU[nom]);
        assert.match(e.message, /--import/, "sur une machine isolée, l'issue est l'import, et le refus doit la nommer.");
        assert.doesNotMatch(e.message, /huggingface\.co/, "on ne renvoie pas vers un domaine qui est justement bloqué.");
        return true;
      });
    });
    rmSync(vide, { recursive: true, force: true });
  });
}

test("coupée, la bibliothèque ne sort pas une seule fois ; ouverte, elle sort", () => {
  /*
   * DANS UN PROCESSUS FILS, ET LA PREMIÈRE VERSION DE CE CAS DIT POURQUOI. Elle plantait le
   * piège dans CE processus — mais `tiers.ts` était déjà importé en tête de fichier, donc la
   * bibliothèque avec lui, et elle garde la référence à `fetch` qu'elle a vue au chargement.
   * Le piège n'a rien intercepté : ZÉRO sortie des deux côtés. Le témoin positif l'a dit tout
   * de suite ; sans lui, la branche coupée rendait zéro et se lisait comme une preuve.
   *
   * Le fils passe par le VRAI drapeau, pas par le champ : `CRUSETRA_OFFLINE` dans son
   * environnement, `armerHorsLigne` appelée comme le chargeur l'appelle. Ce qu'on mesure est
   * donc ce que l'acheteur pose sur sa ligne de commande.
   */
  const garni = cacheGarni();
  const RACINE = fileURLToPath(new URL("..", import.meta.url));
  const ENFANT = `
    globalThis.fetch = async (u) => { console.log("SORTIE " + String(u?.url ?? u)); throw new Error("piégé"); };
    const { armerHorsLigne, MODELES_EXTRACTION } = await import("./src/tiers.ts");
    await armerHorsLigne(MODELES_EXTRACTION, process.env.CRUSETRA_CACHE_FACTICE);
    const { pipeline } = await import("@huggingface/transformers");
    try { await pipeline("feature-extraction", "cascade-inexistant/aucun-modele"); } catch { /* les deux branches échouent */ }
  `;

  /** Les destinations que `fetch` a vues dans un fils, sous les drapeaux donnés (aucun : réseau ouvert). */
  const sortiesPour = (drapeaux: Record<string, string>): string[] => {
    const env: NodeJS.ProcessEnv = { ...process.env, CRUSETRA_CACHE_FACTICE: garni };
    for (const nom of NOMS_DU_DRAPEAU) delete env[nom];
    Object.assign(env, drapeaux);
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", ENFANT],
      { cwd: RACINE, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, `le fils est sorti en ${r.status} :\n${r.stderr}`);
    return r.stdout.split("\n").filter((l) => l.startsWith("SORTIE ")).map((l) => l.slice(7));
  };

  /* LE TÉMOIN DE LA MESURE ELLE-MÊME, ET IL A DÉJÀ SERVI. Si la bibliothèque cessait de passer
     par `fetch`, les deux branches rendraient zéro et le zéro de la branche coupée ne dirait
     plus rien — il dirait seulement que le piège ne regarde plus au bon endroit. */
  const ouvertes = sortiesPour({});
  assert.ok(ouvertes.length > 0,
    "réseau ouvert, aucune sortie n'a été vue : le piège ne mesure plus rien, et le zéro de la "
    + "branche coupée ne prouverait donc plus la coupure.");
  assert.ok(ouvertes.some((u) => u.includes("huggingface.co")),
    `réseau ouvert, les sorties vues ne vont pas chez le dépôt de modèles : ${ouvertes.join(", ")}`);

  /* LA MÊME MESURE SOUS CHAQUE NOM, et sous l'ancien contredit par le nouveau : un script client
     qui pose CASCADE_OFFLINE=1 doit rester coupé exactement comme avant le changement de nom. */
  const variantes: Record<string, string>[] = [{ CRUSETRA_OFFLINE: "1" }, { CASCADE_OFFLINE: "1" }, { CASCADE_OFFLINE: "1", CRUSETRA_OFFLINE: "0" }];
  for (const drapeaux of variantes) {
    const coupees = sortiesPour(drapeaux);
    const dit = Object.entries(drapeaux).map(([n, v]) => `${n}=${v}`).join(" ");
    assert.deepEqual(coupees, [],
      `\`${dit}\` coupe le réseau et ${coupees.length} sortie(s) sont parties quand même :\n`
      + `  ${coupees.join("\n  ")}\n`
      + "  → c'est la promesse que ce drapeau vend à une banque, et elle vient de devenir fausse.");
  }

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

/*
 * LA RÉPARATION DU DERNIER APPEL RÉSEAU — le tokeniseur sous la clé « main ».
 *
 * Lu dans la bibliothèque le 3 septembre 2026 : `get_tokenizer_files()` demande
 * `tokenizer_config.json` avec des options vides, donc à la révision `main`, et regarde le
 * cache d'abord sous `<dépôt>/tokenizer_config.json`. Une copie du fichier épinglé à cet
 * endroit, et la bibliothèque ne sort plus — ni réseau ouvert, ni réseau refusé. Le premier
 * cas éprouve la copie sur un cache factice ; le second lance la vraie commande hors ligne
 * et exige qu'elle mesure — il s'écarte, nommément, sur une machine sans poids.
 */
test("le tokeniseur épinglé est posé sous la clé « main », une fois, et jamais inventé", async () => {
  const { poserTokenizerSousMain } = await import("./tiers.ts");
  const garni = cacheGarni();
  try {
    const poses = poserTokenizerSousMain(MODELES_EXTRACTION, garni);
    assert.deepEqual(poses.sort(), MODELES_EXTRACTION.map((c) => POIDS_MODELES[c].depot).sort(),
      "les deux dépôts d'extraction doivent recevoir leur copie.");
    for (const cle of MODELES_EXTRACTION) {
      const m = POIDS_MODELES[cle];
      assert.equal(readFileSync(join(garni, m.depot, "tokenizer_config.json"), "utf8"),
        readFileSync(join(garni, m.depot, m.revision, "tokenizer_config.json"), "utf8"),
        "la copie sous « main » doit être l'octet pour octet le fichier épinglé.");
    }
    assert.deepEqual(poserTokenizerSousMain(MODELES_EXTRACTION, garni), [], "déjà posé : rien à refaire.");

    /* Sans fichier épinglé, rien n'est posé — on ne fabrique pas un tokeniseur. */
    const nu = mkdtempSync(join(tmpdir(), "cascade-hors-ligne-nu-"));
    assert.deepEqual(poserTokenizerSousMain(MODELES_EXTRACTION, nu), []);
    assert.equal(readdirSync(nu).length, 0, "un cache sans révision épinglée reste vide.");
    rmSync(nu, { recursive: true, force: true });
  } finally {
    rmSync(garni, { recursive: true, force: true });
  }
});

/*
 * THE FIRST LOAD ON A FRESHLY IMPORTED CACHE (2026-09-29).
 *
 * On a Mac, after `npm ci` had wiped node_modules and `npm run poids -- --import` had put the
 * weights back (16 files, verified), the first full `npm test` failed once, in the end-to-end
 * audit case: measure:yours exited 1 with "`local_files_only=true` or
 * `env.allowRemoteModels=false` and file was not found locally at
 * .../models/Xenova/distilbert-base-cased-distilled-squad/config.json". The same file passed
 * alone afterwards, two more full runs passed, and the integration had never seen it.
 *
 * Read in transformers.js 4.2.0: `pipeline(task, model, { revision })` first asks the model
 * registry which files to expect, `get_pipeline_files(task, model, { device, dtype })`,
 * without the revision; that goes through `get_model_files` to `get_config`, whose revision
 * defaults to `main`, so the cache key looked up is `<repo>/config.json`, not
 * `<repo>/<revision>/config.json`. An import carries the pinned folders only; that key is
 * missing; offline the miss is fatal. It failed only once because a sibling test process was
 * loading the same models with the network open at the same time: it downloaded
 * `main/config.json` and stored it under that very key, and the offline process failed only
 * because it looked first. The integration primes its cache online, where the library writes
 * those keys itself, so it never looked.
 *
 * The cases below hold the repair, which lives in `poids.ts` (`poserSousMain`): the first
 * reproduces the failure without weights or network, on a fake cache, through the exact call
 * the registry makes; the next two hold the placement itself and the loader's own path to it;
 * the fourth runs several processes posing at the same time on one fresh cache and requires
 * complete files and no leftovers; the last, with the real weights, builds a fresh cache the
 * way the old import left it (pinned folders, the tokenizer configuration under `main`,
 * nothing else) and loads the extractors offline against it: red before, green after.
 */
function cacheImporte(): string {
  /* As the old import left a cache: the pinned folders, valid JSON configurations, and the
     tokenizer configuration under `main`; no `config.json` under `main`. */
  const base = mkdtempSync(join(tmpdir(), "cascade-cache-importe-"));
  for (const cle of MODELES_EXTRACTION) {
    const m = POIDS_MODELES[cle];
    const ecrire = (rel: string, contenu: string) => {
      const p = join(base, m.depot, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, contenu);
    };
    ecrire(join(m.revision, "config.json"), JSON.stringify({ model_type: cle === "small" ? "distilbert" : "roberta", _synthetic: true, pad: "x".repeat(200_000) }));
    ecrire(join(m.revision, "tokenizer_config.json"), JSON.stringify({ model: m.depot, _synthetic: true }));
    ecrire(join(m.revision, "tokenizer.json"), "{}");
    ecrire(join(m.revision, "onnx", "model.onnx"), "des octets qui font office de modèle");
    ecrire("tokenizer_config.json", JSON.stringify({ model: m.depot, _synthetic: true }));
  }
  return base;
}

const sansProvisoire = (dossier: string): string[] => readdirSync(dossier).filter((n) => n.includes(".tmp."));

test("2026-09-29: the registry's lookup of config.json at revision main fails offline on a freshly imported cache, and passes once the pinned file is posed under that key", async () => {
  const base = cacheImporte();
  const avant = { cacheDir: envHF.cacheDir, allowRemoteModels: envHF.allowRemoteModels };
  try {
    envHF.cacheDir = base;
    envHF.allowRemoteModels = false;
    const depot = POIDS_MODELES.small.depot;
    /* The registry's call, verbatim: no revision, so `main`. Red before the repair. */
    await assert.rejects(() => AutoConfig.from_pretrained(depot, {}),
      (e: Error) => /file was not found locally at .*config\.json/.test(e.message) && !/tokenizer/.test(e.message),
      "the failure the founder saw, on the model configuration at revision main");
    /* The pinned lookup, as the loader itself makes it, is fine: the file is there. */
    const epingle = await AutoConfig.from_pretrained(depot, { revision: POIDS_MODELES.small.revision });
    assert.equal(epingle.model_type, "distilbert");
    /* The repair, then the same call. */
    assert.deepEqual(poserSousMain(["small"], base), [`${depot}/config.json`], "the tokenizer copy was already there; the configuration is what was missing");
    const sousMain = await AutoConfig.from_pretrained(depot, {});
    assert.equal(sousMain.model_type, "distilbert");
    assert.equal(readFileSync(join(base, depot, "config.json"), "utf8"), readFileSync(join(base, depot, POIDS_MODELES.small.revision, "config.json"), "utf8"));
  } finally {
    envHF.cacheDir = avant.cacheDir;
    envHF.allowRemoteModels = avant.allowRemoteModels;
    rmSync(base, { recursive: true, force: true });
  }
});

test("2026-09-29: the import poses both files the library asks for at main, byte for byte, once, and never invented", () => {
  const garni = cacheGarni();
  try {
    const poses = poserSousMain(MODELES_EXTRACTION, garni);
    const attendus = MODELES_EXTRACTION.flatMap((c) => FICHIERS_SOUS_MAIN.map((f) => `${POIDS_MODELES[c].depot}/${f}`));
    assert.deepEqual(poses.sort(), attendus.sort(), "the two extraction repositories must receive their two copies each");
    for (const cle of MODELES_EXTRACTION) {
      const m = POIDS_MODELES[cle];
      for (const f of FICHIERS_SOUS_MAIN) {
        assert.equal(readFileSync(join(garni, m.depot, f), "utf8"), readFileSync(join(garni, m.depot, m.revision, f), "utf8"),
          "the copy under main must be the pinned file, byte for byte");
      }
      assert.deepEqual(sansProvisoire(join(garni, m.depot)), [], "a temporary file was left behind");
    }
    assert.deepEqual(poserSousMain(MODELES_EXTRACTION, garni), [], "already posed: nothing to do again");
    /* Without a pinned file, nothing is posed: no configuration is made up. */
    const nu = mkdtempSync(join(tmpdir(), "cascade-hors-ligne-nu-"));
    assert.deepEqual(poserSousMain(MODELES_EXTRACTION, nu), []);
    assert.equal(readdirSync(nu).length, 0, "a cache without the pinned revision stays empty");
    rmSync(nu, { recursive: true, force: true });
  } finally {
    rmSync(garni, { recursive: true, force: true });
  }
});

test("2026-09-29: before the network is refused, the loader's own path poses the configuration under main", async () => {
  /* `chargerAvecFilet` calls `armerHorsLigne`, which calls `exigerPoidsSurPlace`: the last call
     before `allowRemoteModels = false`. A cache as the old import left it must come out of it
     with `config.json` under `main`, or the first offline load asks the network for it. */
  const base = cacheImporte();
  try {
    await avecEtatRendu(async () => {
      process.env.CRUSETRA_OFFLINE = "1";
      envHF.allowRemoteModels = true;
      assert.equal(await armerHorsLigne(MODELES_EXTRACTION, base), true);
      assert.equal(envHF.allowRemoteModels, false);
    });
    for (const cle of MODELES_EXTRACTION) {
      const m = POIDS_MODELES[cle];
      assert.ok(existsSync(join(base, m.depot, "config.json")), `${m.depot}/config.json was not posed before the network was refused`);
      assert.equal(readFileSync(join(base, m.depot, "config.json"), "utf8"), readFileSync(join(base, m.depot, m.revision, "config.json"), "utf8"));
      assert.deepEqual(sansProvisoire(join(base, m.depot)), []);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("2026-09-29: several processes posing at the same time on one fresh cache all end with complete files, and none leaves a temporary file", async () => {
  const base = cacheImporte();
  try {
    const poids = new URL("./poids.ts", import.meta.url).href;
    const programme = `const p = await import(${JSON.stringify(poids)});\n`
      + `const t = await import(${JSON.stringify(new URL("./tiers.ts", import.meta.url).href)});\n`
      + `const { readFileSync } = await import("node:fs");\n`
      + `const { join } = await import("node:path");\n`
      + `const base = process.argv[1];\n`
      + `for (let i = 0; i < 20; i++) {\n`
      + `  p.poserSousMain(t.MODELES_EXTRACTION, base);\n`
      + `  for (const cle of t.MODELES_EXTRACTION) for (const f of p.FICHIERS_SOUS_MAIN) {\n`
      + `    const lu = JSON.parse(readFileSync(join(base, t.POIDS_MODELES[cle].depot, f), "utf8"));\n`
      + `    if (lu._synthetic !== true) { console.error("partial or foreign file: " + f); process.exit(3); }\n`
      + `  }\n`
      + `}\n`;
    /* Four at once, not one after another: the invariant is the one a parallel run needs. */
    const enfants = Array.from({ length: 4 }, () => new Promise<{ code: number | null; sortie: string }>((resoudre) => {
      const e = spawn(process.execPath, ["--input-type=module", "-e", programme, base], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let sortie = "";
      e.stdout.on("data", (d) => { sortie += d; });
      e.stderr.on("data", (d) => { sortie += d; });
      e.on("close", (code) => resoudre({ code, sortie }));
    }));
    for (const { code, sortie } of await Promise.all(enfants)) assert.equal(code, 0, sortie);
    for (const cle of MODELES_EXTRACTION) {
      const m = POIDS_MODELES[cle];
      assert.deepEqual(sansProvisoire(join(base, m.depot)), [], "a temporary file was left behind");
      for (const f of FICHIERS_SOUS_MAIN) {
        assert.equal(readFileSync(join(base, m.depot, f), "utf8"), readFileSync(join(base, m.depot, m.revision, f), "utf8"));
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("2026-09-29: the extractors load offline on a cache exactly as the old import left it, in a process of their own", { timeout: 900_000 }, (t) => {
  if (!poidsEnCache()) return t.skip(diagnosticDesPoids() ?? "poids d'encodeur inutilisables.");
  const reel = racineDesPoids();
  /* Beside the real cache, so that hard links work; a copy when the file system refuses them. */
  const base = mkdtempSync(join(dirname(reel), "cache-fraiche-"));
  const relier = (de: string, vers: string) => {
    mkdirSync(dirname(vers), { recursive: true });
    try { linkSync(de, vers); } catch { copyFileSync(de, vers); }
  };
  const descendre = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name), r = join(rel, e.name);
      if (e.isDirectory()) descendre(p, r); else if (e.isFile()) relier(p, join(base, r));
    }
  };
  try {
    for (const cle of MODELES_EXTRACTION) {
      const m = POIDS_MODELES[cle];
      descendre(join(reel, m.depot, m.revision), join(m.depot, m.revision));
      /* What the old import posed under `main`: the tokenizer configuration, and nothing else. */
      copyFileSync(join(reel, m.depot, m.revision, "tokenizer_config.json"), join(base, m.depot, "tokenizer_config.json"));
      assert.ok(!existsSync(join(base, m.depot, "config.json")), "the fresh cache must not carry config.json under main before the load");
    }
    /* The child points the library at the fresh cache, the way a moved cache would, and loads
       through the loader itself: `loadExtractors`, under the real flag. */
    const tiers = new URL("./tiers.ts", import.meta.url).href;
    const programme = `const { env } = await import("@huggingface/transformers");\n`
      + `env.cacheDir = process.argv[1];\n`
      + `const m = await import(${JSON.stringify(tiers)});\n`
      + `await m.loadExtractors();\n`
      + `console.log("loaded");\n`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", programme, base],
      { encoding: "utf8", timeout: 840_000, env: { ...process.env, CRUSETRA_OFFLINE: "1" } });
    assert.equal(r.status, 0, `the offline load on a fresh cache failed:\n${(r.stderr + r.stdout).slice(-1500)}`);
    assert.doesNotMatch(r.stderr + r.stdout, /file was not found locally/);
    for (const cle of MODELES_EXTRACTION) {
      const m = POIDS_MODELES[cle];
      assert.ok(existsSync(join(base, m.depot, "config.json")), "the loader posed the configuration under main before loading");
      assert.equal(statSync(join(base, m.depot, "config.json")).size, statSync(join(reel, m.depot, m.revision, "config.json")).size);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("hors ligne, la vraie commande MESURE — elle ne charge plus un modèle muet", (t) => {
  const d = mkdtempSync(join(tmpdir(), "cascade-hors-ligne-mesure-"));
  try {
    const csv = join(d, "cas.csv");
    writeFileSync(csv, `id,text,name\n1,"Client: Anna Petrova — dob 3 May 1990.",Anna Petrova\n`);
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("./your-cases.ts", import.meta.url)),
      `--cases=${csv}`, "--sample=1"], { encoding: "utf8", timeout: 280_000, env: { ...process.env, CRUSETRA_OFFLINE: "1" } });
    const sortie = (r.stdout ?? "") + (r.stderr ?? "");
    /* Poids absents : la commande s'écarte sous le lanceur de tests ; ce cas se déclare ignoré. */
    if (r.status === CODE_ECART_TEMOIN) { t.skip(raisonPoidsAbsents(sortie)); return; }
    assert.equal(r.status, 0, `hors ligne, la commande sort en ${r.status} :\n${sortie.slice(-900)}`);
    assert.doesNotMatch(sortie, /loaded without a tokenizer/,
      "le modèle est chargé sans tokeniseur : la copie sous « main » n'a pas été posée, ou pas lue.");
    assert.doesNotMatch(sortie, /Could not download/, "hors ligne, rien ne doit avoir tenté le réseau.");
    assert.match(sortie, /Written to/, "la mesure doit aller au bout et écrire son rapport.");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
