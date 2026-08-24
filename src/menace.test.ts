import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { temoins, controles, secretsDans, racineServie, adresseDEcoute, bornePosee, document, type Controle } from "./menace.ts";

const racine = fileURLToPath(new URL("..", import.meta.url));

test("les détecteurs de sécurité reconnaissent encore ce qu'ils prétendent reconnaître", () => {
  assert.deepEqual(temoins(), [],
    "un détecteur a changé de réponse : le relevé de sécurité est sans valeur tant qu'il n'est pas réparé.");
});

test("aucun contrôle de sécurité n'est non tenu", () => {
  const c = controles(racine);
  assert.ok(c.length >= 5, `${c.length} contrôle(s) : la lecture des sources a échoué et ce cas ne vérifie rien.`);
  const nonTenus = c.filter((x) => x.verdict === "non tenu");
  assert.deepEqual(nonTenus.map((x) => `${x.nom} — ${x.constat}`), []);
  const horsPortee = c.filter((x) => x.verdict === "hors de portée");
  assert.deepEqual(horsPortee.map((x) => x.nom), [],
    "un contrôle n'a pas pu lire son fichier : « hors de portée » n'est pas « tenu ».");
});

test("le serveur reste lié à la boucle locale", () => {
  const s = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.equal(adresseDEcoute(s), "boucle locale",
    "listen() sans adresse écoute sur toutes les interfaces, donc sur le wifi partagé.");
  assert.equal(racineServie(s).construitDepuisLUrl, false);
  assert.deepEqual(bornePosee(s), { plafond: true, fluxCoupe: true },
    "un plafond qui règle la promesse sans couper le flux annonce une borne qu'il n'impose pas.");
});

test("le document nomme ce qui n'est pas tenu, il ne le compte pas", () => {
  const sale: Controle[] = [
    { nom: "Adresse d'écoute", verdict: "non tenu", constat: "écoute sur toutes les interfaces.", denominateur: "src/server.ts" },
    { nom: "Empreinte des dépendances", verdict: "tenu", constat: "toutes empreintes.", denominateur: "82 dépendances" },
  ];
  const md = document(sale, null);
  assert.match(md, /## À corriger/);
  assert.match(md, /Adresse d'écoute.*toutes les interfaces/s);
  /* Chaque ligne porte son dénominateur : « aucune menace » sans ce qui a été lu est la
     phrase qu'un contrôle cassé produit aussi. */
  assert.match(md, /82 dépendances/);
  assert.match(md, /Ce qu'ils ne voient pas/, "un angle mort non publié est une fausse assurance.");
});

test("le relevé d'historique est scellé sur un commit atteignable", () => {
  const f = new URL("../menace-historique.json", import.meta.url);
  if (!existsSync(f)) return;   // pas encore balayé : `npm run menace -- --historique`
  const r = JSON.parse(readFileSync(f, "utf8")) as {
    commits: number; trouves: number; declares: number; temoins: number; commit: string; date: string;
    reels: Array<{ forme: string; fichier: string; empreinte: string }>;
  };
  assert.equal(r.temoins, 2,
    "le balayage de l'historique n'a pas retrouvé ses deux témoins : son zéro ne vaut rien.");
  assert.ok(r.commits > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date));

  /*
   * AUCUNE TROUVAILLE NON DÉCLARÉE. Et le compte publié doit se boucler : `trouves` moins
   * `declares` doit valoir exactement ce que `reels` énumère, sinon le relevé annonce un
   * chiffre que sa propre liste contredit — le rouge vide, où le nombre et le verdict ne
   * viennent pas de la même source.
   */
  assert.deepEqual(r.reels, [],
    "des chaînes de forme secrète sont dans l'historique sans être déclarées.");
  assert.equal(r.trouves - r.declares, r.reels.length,
    `le relevé annonce ${r.trouves} trouvailles dont ${r.declares} déclarées, mais énumère ${r.reels.length} non déclarée(s).`);
  assert.ok(r.declares > 0,
    "aucune trouvaille déclarée : les leurres plantés dans nos propres cas de test ne sont plus vus,\n"
    + "  donc le détecteur ne détecte plus, donc ce zéro ne vaut rien.");
  /* UN RELEVÉ SCELLÉ SUR UNE BRANCHE ABANDONNÉE RASSURE SUR UN DÉPÔT QUI N'EXISTE PLUS.
     On vérifie que le commit est réellement dans l'historique d'où l'on parle. */
  const vu = spawnSync("git", ["cat-file", "-e", `${r.commit}^{commit}`], { cwd: racine });
  if (vu.error) return;   // pas de git sous la main : on ne conclut pas
  assert.equal(vu.status, 0,
    `le relevé de sécurité est scellé sous « ${r.commit} », qui n'est pas dans ce dépôt.`);
});

test("un secret planté dans une source suivie est trouvé", () => {
  // Le témoin qui rend le zéro publiable : sans lui, « aucun secret » et « rien lu » se disent pareil.
  assert.deepEqual(secretsDans("const cle = \"AKIAIOSFODNN7EXAMPLE\";"), ["clé AWS"]);
  assert.deepEqual(secretsDans("const seuil = 0.85;"), []);
});

test("LE DÉNOMINATEUR NE RÉTRÉCIT PAS QUAND UN FICHIER MANQUE", () => {
  /*
   * Trouvé par une session de contrôle. Quand `src/server.ts` manquait, la branche serveur ne
   * déclarait qu'UN de ses trois contrôles en « hors de portée » : les deux autres
   * disparaissaient, et le document publiait « 3 tenus sur 4 » alors qu'il y en a six. Le
   * document qui existe pour refuser les chiffres sans dénominateur en publiait un.
   */
  const complet = controles(racine).length;
  const tmp = mkdtempSync(join(tmpdir(), "cascade-menace-"));
  try {
    mkdirSync(join(tmp, "src"));
    for (const f of ["src/ui.html", ".gitignore", "package-lock.json"]) {
      copyFileSync(join(racine, f), join(tmp, f));
    }
    /* src/server.ts n'est PAS copié : c'est tout l'objet du cas. */
    const partiel = controles(tmp);
    assert.equal(partiel.length, complet,
      `${partiel.length} contrôles sans src/server.ts contre ${complet} avec : le tableau en perd en route,\n`
      + "  et le document publierait un total qui n'est pas le nombre de contrôles.");
    const horsPortee = partiel.filter((c) => c.verdict === "hors de portée").map((c) => c.nom);
    assert.deepEqual(horsPortee.sort(), ["Adresse d'écoute", "Corps de requête borné", "Racine servie"],
      "les trois contrôles du serveur doivent tous se déclarer, pas seulement le premier.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("le constat ne dit pas la même chose selon qu'il tient ou non", () => {
  /* Quand ce contrôle échouait, sa phrase affirmait exactement ce qui était faux : « data/ est
     ignoré par git », sous un verdict « non tenu ». Il fallait lire la colonne verdict pour
     savoir si la colonne constat mentait. */
  const tmp = mkdtempSync(join(tmpdir(), "cascade-constat-"));
  try {
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, ".gitignore"), "node_modules/\n");   // data/ absent, volontairement
    const c = controles(tmp).find((x) => x.nom === "Données du client non versionnées");
    assert.ok(c);
    assert.equal(c!.verdict, "non tenu");
    assert.match(c!.constat, /partiraient dans le dépôt public|n'est pas ignoré/);
    assert.doesNotMatch(c!.constat, /qui est ignoré par git\./,
      "le constat affirme ce que le verdict dément.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
