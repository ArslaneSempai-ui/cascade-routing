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
    { nom: "Listening address", verdict: "non tenu", constat: "listens on all interfaces.", denominateur: "src/server.ts" },
    { nom: "Dependency fingerprints", verdict: "tenu", constat: "all fingerprinted.", denominateur: "82 dependencies" },
  ];
  const md = document(sale, null);
  assert.match(md, /## To fix/);
  assert.match(md, /Listening address.*all interfaces/s);
  /* Chaque ligne porte son dénominateur : « aucune menace » sans ce qui a été lu est la
     phrase qu'un contrôle cassé produit aussi. */
  assert.match(md, /82 dependencies/);
  assert.match(md, /What they do not see/, "un angle mort non publié est une fausse assurance.");
});

test("le relevé d'historique est scellé sur un commit atteignable", (t) => {
  const f = new URL("../menace-historique.json", import.meta.url);
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");   // pas encore balayé : `npm run menace -- --historique`
  const r = JSON.parse(readFileSync(f, "utf8")) as {
    commits: number; trouves: number; declares: number; temoins: number; commit: string; date: string;
    reels: Array<{ forme: string; fichier: string; empreinte: string; publie?: boolean }>;
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
  /*
   * SEULES LES TROUVAILLES PUBLIÉES FONT ÉCHOUER, et la distinction n'est pas une indulgence.
   *
   * `git log --all` balaie aussi les branches de sauvegarde et le `refs/original/` qu'une
   * réécriture laisse derrière elle. Le 25 août 2026, dix formes de secret y dormaient — un
   * bac à sable Stryker commité par erreur puis retiré de `main`. Ce que l'acheteur clone n'en
   * contient aucune, mesuré par accessibilité depuis HEAD, trouvaille par trouvaille.
   *
   * Faire échouer sur ces dix aurait rendu la suite rouge en permanence pour une propriété
   * qu'aucune correction du code ne peut lever — et un rouge qu'on ne peut pas lever se fait
   * désactiver. Elles restent nommées dans SECURITE.md, parce qu'une référence que personne ne
   * pousse aujourd'hui peut l'être demain.
   */
  const publiees = r.reels.filter((t) => t.publie);
  assert.deepEqual(publiees, [],
    "des chaînes de forme secrète sont dans l'historique PUBLIÉ sans être déclarées.");
  assert.ok(r.reels.every((t) => typeof t.publie === "boolean"),
    "une trouvaille sans champ `publie` : le relevé vient d'une version qui ne distinguait pas\n"
    + "  le publié du local, et ce cas passerait en ne regardant rien. Relancer\n"
    + "  `npm run menace -- --historique`.");
  assert.equal(r.trouves - r.declares, r.reels.length,
    `le relevé annonce ${r.trouves} trouvailles dont ${r.declares} déclarées, mais énumère ${r.reels.length} non déclarée(s).`);
  assert.ok(r.declares > 0,
    "aucune trouvaille déclarée : les leurres plantés dans nos propres cas de test ne sont plus vus,\n"
    + "  donc le détecteur ne détecte plus, donc ce zéro ne vaut rien.");
  /* UN RELEVÉ SCELLÉ SUR UNE BRANCHE ABANDONNÉE RASSURE SUR UN DÉPÔT QUI N'EXISTE PLUS.
     On vérifie que le commit est réellement dans l'historique d'où l'on parle. */
  /*
   * ACCESSIBILITÉ, PAS EXISTENCE — et c'est toute la différence.
   *
   * `cat-file -e` répond « oui » sur un objet ORPHELIN. Après une réécriture d'historique, le
   * dépôt local garde les anciens objets : ce cas passait donc au vert sur une empreinte
   * qu'aucun clone ne pouvait retrouver. Mesuré le 25 août 2026 sur un clone du dépôt publié :
   * `git cat-file -t 287c538` → `fatal: Not a valid object name`, alors qu'en local il
   * répondait `commit`. **Le dépôt d'origine est le seul endroit d'où ce défaut est
   * invisible**, et c'est celui depuis lequel on le contrôlait.
   */
  const vu = spawnSync("git", ["merge-base", "--is-ancestor", r.commit, "HEAD"], { cwd: racine });
  if (vu.error) return;   // pas de git sous la main : on ne conclut pas
  assert.equal(vu.status, 0,
    `le relevé de sécurité est scellé sous « ${r.commit} », qui n'est pas ATTEIGNABLE depuis HEAD.\n`
    + "  Un clone ne le contiendra pas, donc l'acheteur ne peut pas rejouer le balayage.\n"
    + "  Attention : `git cat-file` répondrait « oui » ici, sur un objet orphelin.");
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
    /*
     * LA LISTE SE DÉDUIT DE CE QUE LES CONTRÔLES LISENT.
     *
     * Elle était écrite à la main. Le mode de panne n'était pas celui qu'on redoute d'habitude
     * — un contrôle neuf lisant un fichier neuf le déclarerait « hors de portée » et
     * l'assertion sur les noms tomberait, donc le silence était impossible — mais deux
     * sources pour la même chose finissent toujours par diverger, et celle-ci se déduit du
     * dénominateur que chaque contrôle publie déjà.
     */
    /* Un dénominateur peut nommer un fichier ET un compte — « package-lock.json, 82
       dependencies ». On prend la part qui est un chemin. */
    const lus = [...new Set(controles(racine)
      .map((c) => c.denominateur.split(",")[0]!.trim())
      .filter((d) => existsSync(join(racine, d))))].filter((d) => d !== "src/server.ts");
    assert.ok(lus.length >= 3,
      `${lus.length} fichier(s) déduits des contrôles : la dérivation ne marche plus, et ce bac d'essai serait vide.`);
    for (const f of lus) copyFileSync(join(racine, f), join(tmp, f));
    /* src/server.ts n'est PAS copié : c'est tout l'objet du cas. */
    const partiel = controles(tmp);
    assert.equal(partiel.length, complet,
      `${partiel.length} contrôles sans src/server.ts contre ${complet} avec : le tableau en perd en route,\n`
      + "  et le document publierait un total qui n'est pas le nombre de contrôles.");
    const horsPortee = partiel.filter((c) => c.verdict === "hors de portée").map((c) => c.nom);
    assert.deepEqual(horsPortee.sort(), ["Listening address", "Request body bounded", "Served root"],
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
    const c = controles(tmp).find((x) => x.nom === "Client data unversioned");
    assert.ok(c);
    assert.equal(c!.verdict, "non tenu");
    assert.match(c!.constat, /would go into the public repository|is not ignored/);
    assert.doesNotMatch(c!.constat, /which git ignores\./,
      "le constat affirme ce que le verdict dément.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
