/**
 * LES TÉMOINS DU CHEMIN HORS RÉSEAU.
 *
 * Chacun porte sa contre-épreuve, et la contre-épreuve est ici plus importante qu'ailleurs :
 * ce chemin s'exécute sur une machine où personne ne peut nous appeler. Un contrôle qui passe
 * sans regarder y coûte un client, pas un aller-retour.
 *
 * Les modèles vrais pèsent 1,3 Go. Ces cas construisent un cache FACTICE aux mêmes chemins,
 * avec des fichiers minuscules : ce qu'on éprouve est l'empreinte, la révision, l'ordre des
 * écritures et les messages — rien de tout cela ne dépend de la taille.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  NOM_MANIFESTE, construireManifeste, verifierExport, exporter, importer, lireManifeste,
  exigerPoidsSurPlace, messageDeTelechargement, ressembleAUnEchecReseau, rapport, fichiersSous,
  type Manifeste,
} from "./poids.ts";
import { POIDS_MODELES } from "./tiers.ts";

const M = POIDS_MODELES.small;

/** Un cache factice qui a la forme exacte de celui que la bibliothèque écrit. */
function cacheFactice(contenus: Record<string, string> = {}): string {
  const base = mkdtempSync(join(tmpdir(), "cascade-poids-"));
  const fichiers = {
    "onnx/model.onnx": "des octets qui font office de modèle",
    "config.json": '{"model_type":"distilbert"}',
    "tokenizer.json": '{"version":"1.0"}',
    ...contenus,
  };
  for (const [rel, texte] of Object.entries(fichiers)) {
    const p = join(base, M.depot, M.revision, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, texte);
  }
  return base;
}

const nettoyer = (...d: string[]): void => { for (const x of d) rmSync(x, { recursive: true, force: true }); };

test("un export puis un import rendent le même octet, pas seulement le même nom", () => {
  const source = cacheFactice(), dossier = mkdtempSync(join(tmpdir(), "cascade-export-")), cible = mkdtempSync(join(tmpdir(), "cascade-cible-"));
  const m = exporter(dossier, ["small"], source);
  assert.equal(m.entrees.length, 3, "les trois fichiers du modèle sont pris, pas seulement model.onnx");
  const { ecrits } = importer(dossier, cible);
  assert.equal(ecrits, 3);
  for (const e of m.entrees) {
    assert.deepEqual(readFileSync(join(cible, e.chemin)), readFileSync(join(source, e.chemin)));
  }
  nettoyer(source, dossier, cible);
});

test("un octet retourné sans changer la taille est refusé", () => {
  const source = cacheFactice(), dossier = mkdtempSync(join(tmpdir(), "cascade-export-"));
  exporter(dossier, ["small"], source);
  assert.equal(verifierExport(lireManifeste(dossier), dossier).length, 0, "l'export à neuf est propre");

  /* CONTRE-ÉPREUVE : même longueur exactement. Un contrôle qui ne regarde que la taille
     laisse passer ce cas, et c'est le cas d'un fichier remplacé plutôt que coupé. */
  const cible = join(dossier, M.depot, M.revision, "config.json");
  const avant = readFileSync(cible, "utf8");
  const apres = '{"model_type":"XXXXXXXXXX"}';
  assert.equal(apres.length, avant.length, "le témoin ne vaut que si la taille est identique");
  writeFileSync(cible, apres);

  const griefs = verifierExport(lireManifeste(dossier), dossier);
  assert.equal(griefs.length, 1);
  assert.match(griefs[0]!.cause, /sha256/);
  nettoyer(source, dossier);
});

test("un import qui trouve un grief n'écrit rien du tout", () => {
  const source = cacheFactice(), dossier = mkdtempSync(join(tmpdir(), "cascade-export-")), cible = mkdtempSync(join(tmpdir(), "cascade-cible-"));
  exporter(dossier, ["small"], source);
  /* Abîmer le DERNIER fichier par ordre alphabétique : si l'import copiait au fil de l'eau,
     les précédents seraient déjà sur le disque quand il s'arrête. C'est cet état à moitié
     écrit qui abat le processus nativement, sans nommer le fichier. */
  const ordre = lireManifeste(dossier).entrees.map((e) => e.chemin);
  writeFileSync(join(dossier, ordre.at(-1)!), "autre chose");
  assert.throws(() => importer(dossier, cible), /nothing was written/);
  assert.equal(readdirSync(cible).length, 0, "le cache visé est resté intact");
  nettoyer(source, dossier, cible);
});

test("des poids exportés pour une autre révision sont refusés avant leur empreinte", () => {
  const source = cacheFactice(), dossier = mkdtempSync(join(tmpdir(), "cascade-export-"));
  exporter(dossier, ["small"], source);
  const m = lireManifeste(dossier);
  const truque: Manifeste = { ...m, entrees: m.entrees.map((e) => ({ ...e, revision: "0000deadbeef" })) };
  writeFileSync(join(dossier, NOM_MANIFESTE), JSON.stringify(truque));
  const griefs = verifierExport(truque, dossier);
  assert.equal(griefs.length, m.entrees.length);
  assert.match(griefs[0]!.cause, /pinned revision is/);
  /* CONTRE-ÉPREUVE : les fichiers eux-mêmes sont intacts, donc seule la révision les écarte.
     Sans ce contrôle, des poids d'une autre version se chargeraient sans un mot et rendraient
     des chiffres qui ne sont pas ceux que le dépôt publie. */
  assert.equal(verifierExport(m, dossier).length, 0);
  nettoyer(source, dossier);
});

test("un dossier sans manifeste dit ce qu'il faut lancer, et où", () => {
  const vide = mkdtempSync(join(tmpdir(), "cascade-vide-"));
  assert.throws(() => lireManifeste(vide), (e: Error) => {
    assert.match(e.message, /npm run poids -- --export/);
    assert.match(e.message, new RegExp(NOM_MANIFESTE));
    return true;
  });
  nettoyer(vide);
});

test("hors ligne, un modèle absent est refusé AVANT tout téléchargement, avec sa sortie", () => {
  const vide = mkdtempSync(join(tmpdir(), "cascade-vide-"));
  assert.throws(() => exigerPoidsSurPlace(["small"], vide), (e: Error) => {
    assert.match(e.message, /CASCADE_OFFLINE=1/);
    assert.match(e.message, new RegExp(M.depot));
    assert.match(e.message, /--export/, "le message porte le geste qui apporte les poids");
    assert.match(e.message, /--import/);
    assert.doesNotMatch(e.message, /huggingface\.co/, "on ne renvoie pas vers un domaine qui est justement bloqué");
    return true;
  });
  /* CONTRE-ÉPREUVE : le même appel sur un cache garni ne refuse pas. Sans elle, un garde qui
     refuse toujours passerait ce cas en prétendant vérifier quelque chose. */
  const garni = cacheFactice();
  assert.doesNotThrow(() => exigerPoidsSurPlace(["small"], garni));
  nettoyer(vide, garni);
});

test("le message de téléchargement nomme la cause probable ET garde l'erreur d'origine", () => {
  const s = messageDeTelechargement(new Error("fetch failed: ENOTFOUND huggingface.co"), ["small"]);
  assert.match(s, /ENOTFOUND huggingface\.co/, "l'erreur brute survit — sinon on cache la seule information vraie");
  assert.match(s, /blocked/);
  assert.match(s, /npm run poids -- --import/);
  assert.match(s, /260\.9 MB/, "la taille vient de POIDS_MODELES, elle n'est pas tapée dans le message");
});

test("une erreur qui n'est pas un réseau n'est pas rhabillée en problème de proxy", () => {
  /* Le sens qui compte. Un diagnostic qui désigne la mauvaise cause coûte plus cher que pas
     de diagnostic : le client fouille son pare-feu pendant qu'un fichier est corrompu. */
  assert.equal(ressembleAUnEchecReseau("fetch failed"), true);
  assert.equal(ressembleAUnEchecReseau("connect ECONNREFUSED 127.0.0.1:443"), true);
  assert.equal(ressembleAUnEchecReseau("self signed certificate in chain"), true);
  assert.equal(ressembleAUnEchecReseau("HTTP 403 from cdn-lfs.huggingface.co"), true);
  assert.equal(ressembleAUnEchecReseau("status code 502"), true);
  /* Le cas qui a resserré le motif : un `403` nu, dans une erreur qui n'a rien d'un réseau. */
  assert.equal(ressembleAUnEchecReseau("Unexpected token in JSON at position 403"), false);
  assert.equal(ressembleAUnEchecReseau("model.onnx is 502 bytes, expected 260905268"), false);
  assert.equal(ressembleAUnEchecReseau("onnxruntime: invalid protobuf"), false);
  assert.equal(ressembleAUnEchecReseau("Cannot read properties of undefined"), false);
});

test("le relevé distingue absent, entier et tronqué, et ne les confond pas", () => {
  const vide = mkdtempSync(join(tmpdir(), "cascade-vide-"));
  assert.match(rapport(vide), /small\s+260\.9 MB\s+absent/);

  /* Un modèle présent mais qui n'a pas la taille servie doit se lire comme TRONQUÉ, pas comme
     présent : c'est la distinction qui, absente, faisait passer un protobuf coupé pour une
     machine lente. */
  const tronque = cacheFactice();
  assert.match(rapport(tronque), /small.*TRUNCATED/);
  nettoyer(vide, tronque);
});

test("la liste des fichiers vient du disque, pas d'une énumération écrite à la main", () => {
  /* Un fichier que la bibliothèque ajoutera dans une version future doit partir dans l'export
     sans qu'on ait rien à mettre à jour. Une liste tapée regarde une collection figée. */
  const source = cacheFactice({ "un_fichier_inattendu.bin": "ajouté par une version future" });
  const m = construireManifeste(["small"], source);
  assert.equal(m.entrees.length, 4);
  assert.ok(m.entrees.some((e) => e.chemin.endsWith("un_fichier_inattendu.bin")));
  /* Les chemins sont relatifs à la racine du cache et écrits avec des barres obliques : un
     manifeste écrit ici s'importe ailleurs, et l'export d'un poste Windows doit s'ouvrir sur
     un serveur Linux. */
  /*
   * LE BALAYAGE DOIT PROUVER QU'IL A TROUVÉ QUELQUE CHOSE AVANT QUE SES ASSERTIONS COMPTENT.
   *
   * `for (const f of ...)` sur une liste vide n'exécute rien et le cas passe. Un chemin qui
   * cesse de correspondre — une révision qui change, un dossier renommé — rendrait donc un
   * vert identique à celui d'un dépôt sain. Un zéro non prouvé se lit comme un succès.
   */
  const balayes = fichiersSous(source, join(M.depot, M.revision));
  assert.ok(balayes.length >= 4,
    `${balayes.length} fichier(s) balayé(s) sous ${M.depot}/${M.revision} : le chemin ne `
    + "correspond plus, et les assertions qui suivent ne s'exécuteraient sur rien.");
  for (const f of balayes) {
    assert.ok(f.startsWith(M.depot + "/" + M.revision + "/"), `${f} ne part pas de la racine du cache`);
    assert.doesNotMatch(f, /\\/, "aucune barre inverse ne part dans un manifeste");
    assert.equal(f.includes(source), false, "aucun chemin absolu de la machine d'export");
  }
  nettoyer(source);
});

test("exporter depuis un cache vide refuse au lieu d'écrire un export vide", () => {
  /* Un dossier d'export vide avec un manifeste vide se transporte, s'importe sans erreur, et
     ne donne rien — l'échec arriverait sur l'autre machine, celle qui n'a pas le réseau. */
  const vide = mkdtempSync(join(tmpdir(), "cascade-vide-")), dossier = mkdtempSync(join(tmpdir(), "cascade-export-"));
  assert.throws(() => exporter(dossier, ["small"], vide), /Nothing to export/);
  assert.equal(existsSync(join(dossier, NOM_MANIFESTE)), false);
  nettoyer(vide, dossier);
});
