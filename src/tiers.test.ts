/**
 * LES GARDES DE `tiers.ts`, ÉPROUVÉES UNE PAR UNE.
 *
 * Six refus vivaient dans ce fichier sans qu'aucun cas ne les atteigne. Un refus sans témoin
 * n'est pas une garde : c'est une intention. Il se supprime par accident, il se contourne par
 * une refonte, et rien ne bouge au vert.
 *
 * Chaque cas ci-dessous a été PROUVÉ en réintroduisant le défaut qu'il vise — la garde
 * commentée, la suite relancée — et chacun est tombé. La liste des mutations et de leur sortie
 * est dans le rapport qui accompagne ce fichier.
 *
 * DEUX RÈGLES QUE CES CAS N'ENFREIGNENT PAS :
 *
 *   1. On assère LE MESSAGE, jamais le seul fait de jeter. Cinq de ces six gardes ont, une
 *      ligne plus bas, quelque chose qui jette aussi — un `TypeError` sur `undefined`, le
 *      refus suivant, un « Ollama unreachable » qui accuse le mauvais coupable. Un
 *      `assert.rejects` nu survivrait au mutant et se lirait comme une preuve.
 *   2. Chaque cas porte sa contre-épreuve ou son témoin négatif : une garde qui refuse TOUT
 *      ne discrimine rien, et son rouge ne dit plus rien.
 *
 * Rien ici n'ouvre le réseau ni ne charge un modèle : les trois cas qui parlent à Ollama
 * parlent à un serveur factice lié sur 127.0.0.1, dans ce processus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  exigerModelesEntiers, POIDS_MODELES, MODELES_LOCAUX, GENERATIFS, rechauffer, classerParmi,
  DELAI_DE_GENERATION_MS, type TierName,
} from "./tiers.ts";

/*
 * ─── LE PORTEUR DES CAS QUI PARLENT AU SERVEUR ───
 *
 * `spawn` ET NON `spawnSync`, et ce n'est pas un détail de style : le serveur factice vit dans
 * CE processus. `spawnSync` bloque la boucle d'événements jusqu'à la fin de l'enfant, donc le
 * serveur ne répond plus à rien et l'enfant refuse pour délai dépassé — un rouge obtenu pour
 * une raison qui n'est pas celle qu'on éprouve. Le motif vient de `cascade.test.ts`, où la
 * même erreur a été payée une fois.
 *
 * `OLLAMA` est une `const` capturée à l'import de `tiers.ts` : elle ne peut être détournée
 * qu'avant cet import, donc dans un processus neuf.
 *
 * Le message part ENTIER, ses retours à la ligne repliés : le compte des écarts est sur la
 * première ligne et le nom du modèle sur la seconde. Ne garder que la première ligne — ce que
 * faisait le premier jet — rendait invérifiable « le diagnostic nomme-t-il le coupable ».
 */
const CHEMIN_TIERS = JSON.stringify(fileURLToPath(new URL("./tiers.ts", import.meta.url)));

function enfant(port: number, expression: string, delaiMs = 45_000): Promise<string> {
  return new Promise<string>((res) => {
    const p = spawn(process.execPath, ["-e",
      `import(${CHEMIN_TIERS}).then((t) => ${expression}).then(`
      + `() => console.log("CONTINUE"),`
      + ` (e) => console.log("REFUS " + String(e && e.message).replace(/\\n+/g, " ⏎ ")))`],
      { env: { ...process.env, OLLAMA_HOST: `http://127.0.0.1:${port}` } });
    let tout = "";
    p.stdout.on("data", (d) => { tout += d; });
    p.stderr.on("data", (d) => { tout += d; });
    const minuteur = setTimeout(() => p.kill(), delaiMs);
    p.on("close", () => { clearTimeout(minuteur); res(tout); });
  });
}

const ecouter = async (stub: Server): Promise<number> => {
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  return (stub.address() as { port: number }).port;
};

const fermer = async (stub: Server): Promise<void> => {
  stub.closeAllConnections();
  await new Promise<void>((r) => stub.close(() => r()));
};

/** Le témoin positif d'abord : sans lui, un REFUS obtenu pour un chemin faux se lit comme un succès. */
const exigerQueLaGardeSoitAtteinte = (sortie: string): void => {
  assert.ok(/CONTINUE|REFUS/.test(sortie),
    `ni CONTINUE ni REFUS dans la sortie : le sous-processus n'a pas atteint la garde.\n${sortie.slice(0, 600)}`);
};

/* ─────────────────────────────────────────────────────────────────────────────────────────
 * tiers.ts:1096 — CLASSER SANS AVOIR OUVERT LES ENCODEURS
 * ───────────────────────────────────────────────────────────────────────────────────────── */

/*
 * CE CAS EST LE PREMIER DU FICHIER, ET CE N'EST PAS UN HASARD.
 *
 * `embSmall` est un état de MODULE, partagé par tous les cas d'un même fichier. Le jour où un
 * cas placé plus haut ouvre les encodeurs, celui-ci traverse la garde sans rien éprouver et
 * reste vert : le vert vide dans sa forme la plus discrète, parce que rien n'a changé dans ce
 * cas-ci. L'ordre ne suffit donc pas — l'assertion mécanique ci-dessous le tient à sa place.
 */
test("classer sans avoir chargé les encodeurs est refusé par un message, pas par un TypeError", async () => {
  /*
   * PRÉCONDITION MÉCANIQUE, PAS UNE NOTE D'INTENTION.
   *
   * L'état de module ne peut être ouvert que par la fonction qui l'ouvre, et cette fonction ne
   * peut être atteinte d'ici que par un import. Ce fichier n'en porte aucun, et n'appelle rien
   * de ce nom — on le vérifie sur sa propre source, à chaque exécution. Le nom s'écrit sans
   * ses parenthèses dans la prose de ce fichier, précisément pour que ce contrôle sache
   * distinguer une mention d'un appel.
   */
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.ok(!/import\b[^;]*\bloadClassifiers\b/s.test(source),
    "ce fichier importe l'ouverture des encodeurs : un cas peut l'appeler et cette garde ne sera plus atteinte.");
  assert.ok(!/\bloadClassifiers\s*\(/.test(source),
    "un cas de ce fichier ouvre les encodeurs : `embSmall` cesse d'être nul et ce cas passe sans rien regarder.");

  await assert.rejects(
    () => classerParmi("small", "cash lodgements in small denominations", ["a", "b"]),
    (e: Error) => {
      /* LE MESSAGE, PAS LE FAIT DE JETER : sans la garde, `await emb(...)` jette « emb is not a
         function », qui n'apprend à personne quelle fonction appeler avant celle-ci. */
      assert.match(e.message, /appeler loadClassifiers\(\) avant classerParmi\(\)/,
        "le refus n'est plus celui de la garde : un TypeError sur `null` ne nomme pas le remède.");
      return true;
    });

  /* CONTRE-ÉPREUVE SANS MODÈLE : le palier « rules » sort avant la garde. Sans elle, un refus
     universel passerait pour une garde qui discrimine. */
  assert.equal(await classerParmi("rules", "peu importe", ["a", "b"]), "",
    "la garde barre un palier qui n'a jamais eu besoin d'encodeur : elle ne discrimine plus rien.");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
 * tiers.ts:405 — UN `model.onnx` TRONQUÉ, REFUSÉ AVANT `pipeline()`
 * ───────────────────────────────────────────────────────────────────────────────────────── */

test("un model.onnx tronqué fait refuser AVANT pipeline(), et le refus nomme le fichier et les deux tailles", () => {
  const M = POIDS_MODELES.small;
  const base = mkdtempSync(join(tmpdir(), "cascade-tronque-"));
  const chemin = join(base, M.depot, M.revision, "onnx", "model.onnx");
  mkdirSync(dirname(chemin), { recursive: true });
  /* CREUX : c'est la taille qui compte, pas les octets. Écrire 261 Mo pour rien serait une
     lenteur muette dans une suite qu'on relance à chaque garde. */
  writeFileSync(chemin, "");
  truncateSync(chemin, 57_905_102);   /* la taille exacte du cas mesuré le 25 août 2026 */
  try {
    assert.throws(() => exigerModelesEntiers(["small"], base), (e: Error) => {
      const m = e.message;
      assert.match(m, /incomplete — an interrupted download/,
        "le refus ne dit pas que le fichier est coupé : sans ça, le client relit un chemin sans savoir quoi en faire.");
      assert.ok(m.includes(chemin),
        "le refus ne nomme pas le fichier à supprimer : l'issue n'est pas exécutable, donc la garde se fait commenter.");
      assert.match(m, /is 57\.9 MB, should be 260\.9 MB/,
        "le refus ne donne pas les deux tailles — on ne peut plus distinguer un fichier coupé d'une révision changée.");
      assert.match(m, /Delete the directory/,
        "un refus sans issue se fait commenter : le client ne peut pas se dépanner seul.");
      return true;
    }, "aucun refus : `pipeline()` ouvrirait un protobuf coupé et abattrait le processus (code 134) sans nommer le fichier.");

    /* CONTRE-ÉPREUVE : à la bonne taille, la garde se tait. Sinon elle refuserait tout cache et
       son rouge ne vaudrait plus rien. */
    truncateSync(chemin, M.octets);
    assert.doesNotThrow(() => exigerModelesEntiers(["small"], base),
      "un modèle entier est refusé aussi : la garde ne mesure plus rien, elle barre.");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
 * tiers.ts:547 — UN PALIER GÉNÉRATIF QUE `MODELES_LOCAUX` NE DÉCLARE PAS
 * ───────────────────────────────────────────────────────────────────────────────────────── */

/*
 * DEUX TABLES DANS DEUX FICHIERS, ET RIEN QUI LES CONFRONTE AILLEURS QU'ICI.
 *
 * `GENERATIFS` vit dans `paliers.ts` et décide qui passe la porte ; `MODELES_LOCAUX` vit dans
 * `tiers.ts` et décide quel modèle appeler. Tant qu'elles se recouvrent, aucun appelant bien
 * typé n'atteint ce refus — ce n'est pas pour autant du code mort : la divergence est
 * exactement ce que la garde surveille, et elle se produit en retirant une clé d'une table
 * qui n'est ni `as const` ni gelée.
 */
test("un palier génératif sans modèle déclaré est refusé PAR SON NOM", async () => {
  /* LA DERNIÈRE CLÉ, pas n'importe laquelle : `delete` puis réaffectation replace la clé en fin
     d'objet, et l'ordre de `MODELES_LOCAUX` décide de l'ordre de chargement dans loadGeneratifs. */
  const cle = Object.keys(MODELES_LOCAUX).at(-1)!;
  const sauve = MODELES_LOCAUX[cle]!;
  delete MODELES_LOCAUX[cle];
  try {
    await assert.rejects(() => rechauffer(cle as TierName), (e: Error) => {
      /* LE MESSAGE, PAS LE FAIT DE JETER. Sans la garde, la ligne suivante lit `m.tag` et jette
         « Cannot read properties of undefined », qui ne dit ni quel palier, ni que les deux
         tables ont divergé. */
      assert.match(e.message, new RegExp(`palier ${cle} inconnu de l'échelle générative`),
        "le refus ne nomme pas le palier : un TypeError sur `undefined` envoie chercher au mauvais endroit.");
      return true;
    }, "aucun refus : le palier part sans modèle et la panne se produira une ligne plus loin, anonyme.");
  } finally {
    MODELES_LOCAUX[cle] = sauve;
  }

  /* TÉMOIN NÉGATIF, et il vaut pour lui-même : tant que les deux tables se recouvrent, aucun
     appelant bien typé ne peut atteindre ce refus. C'est ce que la garde surveille. */
  assert.deepEqual(GENERATIFS.filter((t) => !MODELES_LOCAUX[t]), [],
    "un palier est déclaré génératif sans modèle déclaré : la garde de ollama() est le seul filet.");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
 * tiers.ts:638 — UN `/api/generate` QUI RÉPOND 500
 * ───────────────────────────────────────────────────────────────────────────────────────── */

test("un /api/generate qui répond 500 fait refuser, il ne se lit pas comme une réponse vide", { timeout: 60_000 }, async () => {
  const stub = createServer((req, res) => {
    const j = (o: unknown, code = 200): void => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.url?.startsWith("/api/tags")) return j({ models: [] });   /* aucun écart : on vise la garde SUIVANTE */
    if (req.url?.startsWith("/api/ps")) return j({ models: [] });
    /* 500 AVEC UN CORPS JSON VALIDE. Avec un corps illisible, retirer la garde ferait échouer
       `r.json()` et le mutant mourrait par accident, pour une raison qui n'est pas celle qu'on
       éprouve. Avec un corps valide, `j.response` s'analyse et l'appel se poursuit en silence :
       c'est ça que le témoin doit rendre visible. */
    if (req.url?.startsWith("/api/generate")) return j({ response: '{"ok":"pong"}', done: true }, 500);
    return j({});
  });
  const port = await ecouter(stub);
  try {
    const sortie = await enfant(port, `t.rechauffer("gen-0.6b")`);
    exigerQueLaGardeSoitAtteinte(sortie);
    assert.match(sortie, /REFUS/,
      "un serveur qui répond 500 laisse la passe continuer : les extractions vides seraient comptées\n"
      + "  comme des erreurs de modèle, et le palier serait noté sur une panne d'infrastructure.");
    assert.match(sortie, /answered 500/,
      "le refus ne nomme pas le code de réponse : il envoie chercher la panne du mauvais côté.");
    assert.match(sortie, /qwen3:0\.6b/,
      "le refus ne nomme pas le modèle : le diagnostic n'est pas localisable.");
  } finally {
    await fermer(stub);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
 * tiers.ts:770 — UN MODÈLE RÉINSTALLÉ SOUS LE MÊME NOM
 * ───────────────────────────────────────────────────────────────────────────────────────── */

/*
 * UNE COUTURE SE TRAVERSE. `digestsQuiDivergent` est déjà éprouvée en isolation dans
 * `cascade.test.ts` — carte vide, carte conforme, digest falsifié. Ce qu'aucun cas ne
 * regardait, c'est le point d'appel : est-ce que l'écart ARRÊTE la passe, ou est-ce qu'il
 * remplit une liste que personne ne lit ? La fonction pure peut rester juste pendant que son
 * appelant enjambe son résultat.
 */
test("un modèle réinstallé ARRÊTE la passe, il ne fait pas qu'apparaître dans une liste", { timeout: 60_000 }, async () => {
  /* Le déclaré, sauf le premier : UN SEUL écart, pour que le compte porté par le message soit
     vérifiable. Un message qui dirait « 3 » sur un seul écart serait faux sans être détecté. */
  const installes = Object.values(MODELES_LOCAUX).map((m, i) => ({
    name: m.tag,
    size: 1_000 - i,
    digest: "sha256:" + (i === 0 ? "0".repeat(64) : (m.digest + "0".repeat(64)).slice(0, 64)),
  }));
  const premier = Object.values(MODELES_LOCAUX)[0]!;
  const stub = createServer((req, res) => {
    const j = (o: unknown): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.url?.startsWith("/api/tags")) return j({ models: installes });
    if (req.url?.startsWith("/api/ps")) return j({ models: [] });
    /* Les pings répondent : sans la garde, `loadGeneratifs` va au bout et rend CONTINUE. C'est
       exactement le mutant qu'on veut voir mourir. */
    return j({ response: '{"ok":"pong"}', done: true });
  });
  const port = await ecouter(stub);
  try {
    const sortie = await enfant(port, `t.loadGeneratifs()`);
    exigerQueLaGardeSoitAtteinte(sortie);
    assert.match(sortie, /REFUS/,
      "un « ollama pull » laisse la passe publier des chiffres qui ne viennent plus de ces modèles-là,\n"
      + "  et aucun fichier du dépôt n'a changé pour le signaler.");
    assert.match(sortie, /REFUS 1 installed model\(s\)/,
      "le refus ne porte pas le compte des écarts : un chiffre de sélection sans le compte de ce qu'il désigne.");
    assert.match(sortie, new RegExp(premier.tag.replace(".", "\\.")),
      "le refus ne nomme pas le modèle divergent : le diagnostic n'est pas localisable.");
  } finally {
    await fermer(stub);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
 * tiers.ts:622 — LEQUEL DES DEUX DÉLAIS A TRANCHÉ
 * ───────────────────────────────────────────────────────────────────────────────────────── */

/*
 * LE DÉLAI SEUL NE DIT RIEN, ET IL Y EN A DEUX.
 *
 * `AbortSignal.timeout` rend un `TimeoutError` muet : ni quel délai, ni pourquoi. La garde le
 * traduit en deux diagnostics opposés — « il n'a pas fini de CHARGER » (premier appel, poids
 * qui monte en mémoire) et « il n'a pas répondu alors qu'il était déjà chargé » (le serveur
 * est bloqué, ou Ollama l'a évincé). Sans elle, le `catch` tombe dans le refus suivant,
 * « Ollama unreachable at … », qui accuse un serveur absent là où le serveur RÉPOND.
 *
 * CE CAS COÛTE TRENTE SECONDES ET NE COUVRE QUE LA BRANCHE « déjà chargé ». La branche
 * « premier appel » attend cent quatre-vingts secondes, et rien ne permet aujourd'hui de la
 * raccourcir : `DELAI_DE_CHARGEMENT_MS` est une `const` de module lue en dur. La rendre
 * payable demanderait un paramètre optionnel sur `ollama()` ou une lecture d'environnement —
 * c'est écrit au-dessus du refus, dans `tiers.ts`.
 */
test("un modèle déjà chargé qui ne répond plus est nommé comme tel, pas comme un serveur injoignable",
  { timeout: 120_000 }, async () => {
    let n = 0;
    const stub = createServer((req, res) => {
      const j = (o: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      if (req.url?.startsWith("/api/tags")) return j({ models: [] });
      if (req.url?.startsWith("/api/ps")) return j({ models: [] });
      if (req.url?.startsWith("/api/generate")) {
        /* LE PREMIER APPEL RÉPOND : c'est lui qui fait passer `premierAppel` à faux et le délai
           de cent quatre-vingts secondes à trente. Les suivants ne répondent jamais, connexion
           ouverte — seul le délai peut trancher, ce qui est exactement le cas visé. */
        if (++n === 1) return j({ response: '{"ok":"pong"}', done: true });
        return;
      }
      return j({});
    });
    const port = await ecouter(stub);
    try {
      const sortie = await enfant(port,
        `t.rechauffer("gen-0.6b").then(() => t.rechauffer("gen-0.6b"))`, 90_000);
      exigerQueLaGardeSoitAtteinte(sortie);
      assert.match(sortie, /REFUS/,
        "un modèle qui ne rend jamais la main laisse la passe attendre : une mesure qui attend pour\n"
        + "  toujours n'échoue jamais, et cette panne-là ressemble à du travail.");
      assert.match(sortie, /déjà chargé/,
        "le refus accuse un serveur absent là où le serveur répond : c'est le modèle qui ne rend pas la main.");
      assert.match(sortie, new RegExp(`n'a pas répondu en ${DELAI_DE_GENERATION_MS / 1000} s`),
        "le refus ne dit pas quel délai a tranché — donc pas s'il s'agit d'un chargement ou d'une génération.");
      assert.match(sortie, /ollama ps/,
        "un refus sans issue se fait commenter : il faut dire où regarder.");
      /* CONTRE-ÉPREUVE DANS LA MÊME SORTIE : le diagnostic de l'AUTRE branche ne doit pas
         apparaître, sinon le message est le même des deux côtés et il ne tranche rien. */
      assert.doesNotMatch(sortie, /n'a pas fini de CHARGER/,
        "les deux branches rendent le même diagnostic : le refus ne distingue plus le chargement de la génération.");
    } finally {
      await fermer(stub);
    }
  });
