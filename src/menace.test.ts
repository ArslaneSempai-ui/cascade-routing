import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { temoins, controles, secretsDans, racineServie, adresseDEcoute, bornePosee, document,
  balayerLHistorique, type Controle, hotesExternes, empreinteScelleeAtteignable } from "./menace.ts";

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

test("le détecteur reconnaît les formats COURANTS, pas seulement ceux d'hier", () => {
  /*
   * ─── UN MOTIF ÉCRIT POUR UNE ÉPOQUE CESSE DE VOIR LA SUIVANTE, EN SILENCE ───
   *
   * Mesuré le 25 août 2026 sur seize formes fabriquées : le détecteur en reconnaissait DIX, et
   * les manquantes n'étaient pas exotiques — c'étaient les formats COURANTS d'OpenAI,
   * d'Anthropic et de GitHub. Même cause pour les trois : `sk-[A-Za-z0-9]{20,}` s'arrête au
   * premier tiret, or `sk-proj-…` et `sk-ant-api03-…` en portent un juste après le préfixe.
   *
   * Ce qui rend ce défaut cher n'est pas qu'il rate un secret : c'est que son ZÉRO continue de
   * s'afficher, identique, dans un document publié qu'un acheteur lit comme une garantie.
   *
   * Ce cas est daté par construction : chaque forme y est nommée. Le jour où un fournisseur
   * change son préfixe, il faudra l'ajouter ici — et rien ne le fera à notre place.
   */
  const COURANTS: Array<[string, string]> = [
    ["OpenAI, format projet", "sk-proj-" + "a".repeat(60)],
    ["Anthropic", "sk-ant-api03-" + "a".repeat(90)],
    ["GitHub, portée fine", "github_pat_" + "a".repeat(70)],
    ["GitHub, classique", "ghp_" + "a".repeat(36)],
    ["AWS", "AKIAIOSFODNN7EXAMPLE"],
    ["Google", "AIza" + "a".repeat(35)],
    /* Assemblé comme les voisins : la VALEUR au runtime est un jeton entier, mais la source
       n'en contient pas — la protection de poussée de GitHub bloquait ce fichier sur cette
       seule ligne, la seule de la liste écrite d'un tenant. */
    ["Slack", "xoxb-" + "123456789012-123456789012-abcdefghijklmnop"],
    ["Stripe", "sk" + "_live_" + "a".repeat(24)],
    ["Twilio", "SK" + "0".repeat(32)],
    ["SendGrid", "SG." + "a".repeat(22) + "." + "b".repeat(43)],
    ["clé privée PEM", "-----BEGIN RSA PRIVATE KEY-----"],
    ["identifiants dans une URL", "postgres://user:motdepasse@hote/base"],
  ];
  const rates = COURANTS.filter(([, v]) => secretsDans(v).length === 0).map(([n]) => n);
  assert.deepEqual(rates, [],
    `${rates.length} format(s) COURANT(S) ne sont pas reconnus : ${rates.join(", ")}.\n`
    + "  Le balayage continuerait d'afficher son zéro sans les voir, dans un document publié\n"
    + "  qu'un acheteur lit comme une garantie. Ajouter la forme à FORMES_DE_SECRET.");

  /* CONTRE-ÉPREUVE : ce qui n'est PAS un secret ne doit rien déclencher. Sans elle, un
     détecteur qui répondrait « oui » à tout passerait ce cas en ne distinguant rien. */
  for (const sain of ["const seuil = 0.85;", "https://example.com/docs", "sk-",
    "AKIA", "an ordinary English sentence about keys and tokens"]) {
    assert.deepEqual(secretsDans(sain), [], `« ${sain} » ne devrait rien déclencher`);
  }
});


/*
 * ─── LES QUATRE REFUS DU BALAYAGE D'HISTORIQUE ───
 *
 * Ce balayage publie un CHIFFRE DE SÉCURITÉ : « 0 secret non déclaré ». Le zéro d'un balayage
 * qui n'a rien lu et celui d'un dépôt propre s'écrivent pareil, et c'est la faute la plus chère
 * du domaine. Quatre gardes séparent les deux, et chacune a ici son témoin.
 *
 * TROIS D'ENTRE ELLES SONT ÉPROUVÉES PAR LE POINT D'APPEL, pas en isolation. `balayerLHistorique`
 * peut refuser autant qu'elle veut : ce qui compte est que `principal()` sous `--historique`
 * s'arrête AVANT d'écrire le relevé. On lance donc le programme entier en sous-processus, avec
 * un `git` de paille en tête du PATH — motif déjà utilisé dans ce dépôt (premiere-reponse.test.ts,
 * rapport.test.ts).
 *
 * ET LE PROGRAMME EST COPIÉ DANS UN BAC D'ESSAI. Sous mutation — quand on retire une garde pour
 * vérifier qu'elle gardait — le balayage va jusqu'au bout et ÉCRIT un relevé. Dans le dépôt, il
 * écraserait `menace-historique.json` avec un relevé fabriqué. Dans le bac, il ne touche rien.
 *
 * ATTENTION AU CHOIX DU `git` DE PAILLE : il doit RÉPONDRE, pas être absent. Un `git` absent du
 * PATH laisse `stdout` à `undefined`, et la ligne qui lit `compte.stdout.trim()` casse en
 * TypeError AVANT la première garde — un refus qui ne dit pas ce qu'il refuse.
 */
function lancerAvecGitDePaille(mode: "revlist" | "status" | "court") {
  /* `realpathSync` N'EST PAS DÉCORATIF. Sur macOS `tmpdir()` rend `/var/folders/…`, un lien
     vers `/private/var/folders/…`, et `import.meta.url` porte le chemin RÉSOLU. Sans cette
     résolution, `estLancéDirectement()` compare deux écritures du même fichier, les trouve
     différentes, et le programme se termine SANS RIEN FAIRE en code 0 — mesuré ici même :
     les trois cas passaient au vert sur un balayage qui n'avait pas eu lieu. */
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "cascade-balayage-")));
  try {
    mkdirSync(join(tmp, "src"));
    mkdirSync(join(tmp, "bin"));
    copyFileSync(join(racine, "src/menace.ts"), join(tmp, "src/menace.ts"));
    const paille = join(tmp, "bin/git");
    /*
     * LA PAILLE CHERCHE LA SOUS-COMMANDE, ELLE NE SUPPOSE PAS QU'ELLE EST EN PREMIER.
     *
     * Elle lisait `$1`. Le jour où le balayage a dû imposer son format de diff — `git -c
     * diff.noprefix=false log …` — `$1` est devenu `-c`, la paille est tombée dans son cas
     * par défaut, et les trois cas ont accusé une AUTRE garde que celle qu'ils éprouvent.
     * Un bouchon qui suppose la forme de la commande qu'il intercepte se périme au premier
     * drapeau ajouté, et son rouge désigne alors le mauvais endroit.
     */
    writeFileSync(paille,
      "#!/bin/sh\n"
      + 'for a in "$@"; do\n'
      + '  case "$a" in\n'
      + '    rev-list) [ "$MODE" = revlist ] && exit 0; echo 12; exit 0 ;;\n'
      + '    log)      [ "$MODE" = status ] && exit 3; echo court; exit 0 ;;\n'
      + "  esac\n"
      + "done\n"
      + "exit 0\n", { mode: 0o755 });
    chmodSync(paille, 0o755);
    const r = spawnSync(process.execPath, [join(tmp, "src/menace.ts"), "--historique"], {
      cwd: tmp, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, MODE: mode, PATH: `${join(tmp, "bin")}:${process.env.PATH}` },
    });
    /* « Rien n'est publié » est une propriété du DISQUE, pas du texte imprimé. On la relève
       avant d'effacer le bac : le relevé est ce que la garde existe pour empêcher. */
    return { ...r, releveEcrit: existsSync(join(tmp, "menace-historique.json")) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("le balayage refuse de publier un compte de commits que git n'a pas rendu", () => {
  const r = lancerAvecGitDePaille("revlist");   // rev-list rend une sortie VIDE, en code 0
  assert.equal(r.releveEcrit, false,
    "un relevé a été écrit alors que l'historique n'a pas été compté : son zéro ne vaut rien.");
  assert.notEqual(r.status, 0,
    "le balayage a rendu 0 : il a publié un relevé sans avoir lu l'historique.");
  /* LE MESSAGE, pas seulement le fait de s'arrêter. Sans cette garde, `commits` vaut 0, donc
     le PLANCHER vaut 0, donc la garde de la longueur ne se déclenche pas non plus — le
     programme va au bout et s'arrête plus loin, pour une AUTRE raison. Seul le motif tombe. */
  assert.match(r.stderr,
    /git rev-list returned "": the history was not read, and its zero would be worthless\./,
    "la garde ne se nomme plus : un zéro non lu ressortirait comme un zéro mesuré.");
  assert.doesNotMatch(r.stdout, /swept/,
    "« commits swept » a été imprimé sur un historique jamais lu.");
});

test("le balayage refuse de publier quand `git log` sort en erreur", () => {
  const r = lancerAvecGitDePaille("status");   // rev-list → 12, log → code 3
  assert.equal(r.releveEcrit, false,
    "un relevé a été écrit alors que `git log` a échoué.");
  assert.notEqual(r.status, 0,
    "le balayage a rendu 0 alors que `git log` a échoué : son zéro serait publié comme mesuré.");
  assert.match(r.stderr, /git log returned code 3: nothing is published\./,
    "la garde doit rendre le CODE : « nothing is published » sans le code ne dit pas quoi rejouer.");
  assert.doesNotMatch(r.stdout, /swept/);
});

test("le balayage refuse une sortie trop courte pour être l'historique", () => {
  const r = lancerAvecGitDePaille("court");   // rev-list → 12, log → « court » en code 0
  assert.equal(r.releveEcrit, false,
    "un relevé a été écrit sur six octets d'historique : il aurait annoncé « aucun secret ».");
  assert.notEqual(r.status, 0);
  /* LES DEUX NOMBRES ET LE PLANCHER, pas seulement le fait de refuser : un chiffre de sécurité
     qui ne dit pas ce qu'il a lu ne se rejoue pas, et c'est la faute que tout ce fichier existe
     pour refuser. 12 commits × 200 = 2400 ; « court\n » fait 6 octets. */
  assert.match(r.stderr, /git log returned 6 bytes for 12 commits \(floor 2400\)\./,
    "le refus doit porter la longueur lue, le compte de commits ET le plancher.");
  assert.match(r.stderr, /too short to be the history: the output was truncated or cut/);
  assert.doesNotMatch(r.stdout, /swept/,
    "rien ne doit être publié : le relevé ne s'imprime pas sur un historique non lu.");
});

/*
 * LA QUATRIÈME GARDE NE S'ATTEINT PAS DEPUIS LE PATH, et c'est pourquoi le lanceur est injecté.
 *
 * `spawnSync` ne remplit `.error` que pour un échec de LANCEMENT ou pour ENOBUFS. Le même
 * binaire sert aux deux appels : s'il ne se lance pas pour `log`, il ne s'est pas lancé pour
 * `rev-list` non plus, et l'on n'arrive jamais ici. Seule une disparition de `git` ENTRE les
 * deux appels y mène — une course qu'aucun test ne produit.
 *
 * CE TÉMOIN NE PROUVE DONC RIEN SUR LE POINT D'APPEL : il appelle la fonction en isolation.
 * C'est `principal()` qui est éprouvé par les trois cas ci-dessus.
 */
test("le balayage refuse de publier quand `git log` n'a pas pu être lancé", () => {
  const echec = Object.assign(new Error("spawn git EAGAIN"), { code: "EAGAIN" });
  assert.throws(
    () => balayerLHistorique(racine, (args) =>
      args[0] === "rev-list"
        ? { status: 0, stdout: "12\n" }                 // le compte passe : on vise BIEN cette garde
        : { error: echec, status: null, stdout: "" }),
    /^Error: git log failed: spawn git EAGAIN — it never ran to completion; nothing is published\.$/,
    "la garde doit NOMMER l'échec de lancement. Sans son message elle est indistinguable de\n"
    + "  celle du code de sortie, qui parle d'un code que git n'a jamais eu l'occasion de rendre ;\n"
    + "  et « truncated » serait faux, puisque rien n'a tourné.");
});

/**
 * UN FLUX TRONQUÉ AU-DESSUS DU PLANCHER RESTAIT INVISIBLE.
 *
 * Trois gardes protègent le zéro de ce balayage, et aucune n'attrapait ce cas-là :
 *
 *   le compte de commits    attrape « rev-list n'a rien rendu »
 *   le plancher d'octets    attrape « le tuyau était vide »
 *   les leurres             attrapent « le balayeur n'est pas passé sur le flux »
 *
 * Un tuyau fermé à mi-course rend assez d'octets pour franchir le plancher, et les leurres —
 * ajoutés à la fin — survivent à toute troncature. Le relevé publiait donc « aucun secret » sur
 * un historique lu à moitié, avec un 2 sur 2 rassurant à côté.
 *
 * La boucle compte maintenant les commits qu'elle rencontre, et le relevé refuse si ce compte
 * s'éloigne de celui de `rev-list`.
 */
test("un flux qui franchit le plancher mais s'arrête à mi-historique est refusé", () => {
  /* Trois cents commits annoncés, plancher à 60 000 octets. On rend 100 000 octets — donc le
     plancher passe — mais seulement dix blocs de commit. */
  const dix = Array.from({ length: 10 }, (_, i) =>
    `commit ${String(i).padStart(40, "0")}\n+++ b/f.txt\n+${"x".repeat(9000)}`).join("\n");
  assert.throws(
    () => balayerLHistorique(racine, (args) =>
      args[0] === "rev-list"
        ? { status: 0, stdout: "300\n" }
        : { status: 0, stdout: dix }),
    /stopped before the end/,
    "dix commits lus pour un historique de trois cents : le balayage n'a vu qu'un préfixe, et "
    + "un préfixe ne trouve que les secrets qui s'y trouvent");
});

test("un historique entièrement lu passe — sinon la garde ci-dessus refuse tout", () => {
  /* LA DIRECTION QUI DÉCIDE. Trois cents commits annoncés, trois cents rencontrés. */
  /* Chaque bloc doit aussi franchir le plancher d'octets — 300 commits demandent 60 000 octets.
     Un cas sain qui échoue sur une AUTRE garde ne dit rien de celle qu'on éprouve ici. */
  const tous = Array.from({ length: 300 }, (_, i) =>
    `commit ${String(i).padStart(40, "0")}\n+++ b/f.txt\n+ligne ${i} ${"-".repeat(220)}`).join("\n");
  const r = balayerLHistorique(racine, (args) =>
    args[0] === "rev-list" ? { status: 0, stdout: "300\n" } : { status: 0, stdout: tous });
  assert.equal(r.commits, 300);
  assert.equal(r.temoins, 2,
    "les leurres doivent être retrouvés DANS le flux : c'est ce qui prouve que la boucle est "
    + "passée sur ce qu'on lui a donné, et non sur un littéral");
});

/*
 * QUATRE TROUVAILLES DE L'AUDIT DU 27 AOÛT, ÉPROUVÉES UNE PAR UNE.
 */

test("une URL sans protocole est un hôte externe, et un commentaire n'en est pas un", () => {
  /*
   * `<script src="//cdn.example.com/x.js">` est la forme relative au protocole : elle
   * fonctionne parfaitement et le motif ne cherchait que `http:` ou `https:`. La page livrée
   * pouvait donc charger un tiers pendant que le contrôle publiait « aucun hôte externe ».
   */
  assert.deepEqual(hotesExternes('<script src="//cdn.example.com/x.js"></script>'), ["cdn.example.com"],
    "un script relatif au protocole n'est pas vu : le contrôle publierait « aucun hôte externe »\n"
    + "  sur une page qui en contacte un.");
  assert.deepEqual(hotesExternes('<link href="//fonts.example.org/c.css">'), ["fonts.example.org"]);
  assert.deepEqual(hotesExternes("<style>body{background:url(//img.example.net/a.png)}</style>"), ["img.example.net"]);

  /* Ce qui marchait doit continuer. */
  assert.deepEqual(hotesExternes('<img src="https://tiers.example.com/a.png">'), ["tiers.example.com"]);
  assert.deepEqual(hotesExternes('<svg xmlns="http://www.w3.org/2000/svg">'), [],
    "l'espace de noms SVG est redevenu un hôte contacté.");

  /*
   * ET CE QUI NE DOIT PAS SE DÉCLENCHER. Un contrôle qui refuse sur un commentaire se fait
   * retirer, et on perd aussi ce qu'il gardait vraiment.
   */
  assert.deepEqual(hotesExternes("<script>// voir example.com/doc pour la suite\n</script>"), [],
    "un commentaire JavaScript est pris pour une URL : la garde refuserait une page saine.");
  assert.deepEqual(hotesExternes("<p>50//50 partout</p>"), []);
});

test("le balayage impose le format du diff au lieu de le supposer", () => {
  /*
   * L'analyse lit `--- a/X` et `+++ b/X`. Ces préfixes sont une CONFIGURATION :
   * `diff.noprefix=true` chez un lecteur les supprime et le nom du fichier reste « ? » sur
   * toutes les trouvailles. Le balayage trouve alors les secrets sans savoir dire où.
   *
   * Ce cas regarde ce que la commande DEMANDE, parce que c'est là qu'est la décision : le
   * réglage vient de la machine du lecteur, et aucun flux fabriqué ici ne le reproduirait.
   */
  const vus: string[][] = [];
  const tous = Array.from({ length: 300 }, (_, i) =>
    `commit ${String(i).padStart(40, "0")}\n+++ b/f.txt\n+ligne ${i} ${"-".repeat(220)}`).join("\n");
  balayerLHistorique(racine, (args) => {
    vus.push(args);
    return args.includes("rev-list") ? { status: 0, stdout: "300\n" } : { status: 0, stdout: tous };
  });

  const log = vus.find((a) => a.includes("log"));
  assert.ok(log, "aucune commande `log` n'a été lancée : ce cas ne garde plus rien.");
  assert.ok(log!.includes("diff.noprefix=false"),
    `la commande de balayage ne force plus les préfixes : ${log!.join(" ")}\n`
    + "  Chez un lecteur qui a `diff.noprefix=true`, tout ce que le balayage trouve est attribué\n"
    + "  au fichier « ? ».");
  assert.ok(log!.includes("diff.mnemonicPrefix=false"),
    "`diff.mnemonicPrefix=true` remplace `a/` et `b/` par `i/`, `w/`, `c/`, `o/` : même défaut.");
});

test("un `rev-list HEAD` en échec fait REFUSER, il ne rend pas « rien n'est publié »", () => {
  /*
   * `(…stdout || "")` transformait un échec en ensemble vide, donc en « aucune trouvaille
   * n'est atteignable depuis HEAD », donc en « rien n'est publié ». Un secret réellement en
   * ligne se serait affiché comme dormant dans une branche locale.
   */
  const tous = Array.from({ length: 300 }, (_, i) =>
    `commit ${String(i).padStart(40, "0")}\n+++ b/f.txt\n+ligne ${i} ${"-".repeat(220)}`).join("\n");
  const lanceur = (reponseHead: { status: number | null; stdout: string }) => (args: string[]) =>
    args.includes("rev-list") && args.includes("HEAD") ? reponseHead
      : args.includes("rev-list") ? { status: 0, stdout: "300\n" }
      : { status: 0, stdout: tous };

  assert.throws(() => balayerLHistorique(racine, lanceur({ status: 128, stdout: "" })),
    /cannot tell which/,
    "un `rev-list HEAD` en échec est absorbé : toutes les trouvailles deviennent « non\n"
    + "  publiées », qui est la réponse rassurante.");
  assert.throws(() => balayerLHistorique(racine, lanceur({ status: 0, stdout: "  \n" })),
    /cannot tell which/,
    "une sortie vide en code 0 passe : un dépôt sans commit atteignable n'existe pas, c'est\n"
    + "  la commande qui n'a rien rendu.");

  /* TÉMOIN POSITIF : la réponse normale doit traverser. */
  const ok = balayerLHistorique(racine, lanceur({ status: 0, stdout: `${"0".repeat(40)}\n` }));
  assert.equal(ok.commits, 300, "le cas nominal ne passe plus : la garde refuse tout.");
});

test("un clone superficiel ne peut pas conclure, et ne doit pas accuser une réécriture", () => {
  /*
   * `git clone --depth=1` arrête l'historique au dernier commit. Le commit scellé n'y est
   * pas, `merge-base --is-ancestor` rend « non », et `npm test` accusait alors une réécriture
   * d'historique QUI N'A PAS EU LIEU : le premier écran d'un acheteur pressé était le dépôt
   * s'accusant lui-même d'avoir effacé sa preuve.
   *
   * « Je ne peux pas conclure » n'est pas « c'est faux ».
   */
  const envPropre = { ...process.env };
  for (const v of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete envPropre[v];

  const bac = realpathSync(mkdtempSync(join(tmpdir(), "menace-superficiel-")));
  const source = join(bac, "source");
  const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8", env: envPropre });
  try {
    mkdirSync(source);
    git(source, "init", "-q");
    git(source, "config", "user.email", "t@t"); git(source, "config", "user.name", "t");

    /* Le bac est-il bien un dépôt à lui ? Sinon tout ce qui suit s'écrit dans celui qu'on
       éprouve — `GIT_DIR` gagne sur `cwd`, et un crochet en exporte un. */
    const vu = git(source, "rev-parse", "--absolute-git-dir").stdout.trim();
    assert.ok(vu.startsWith(source), `le bac n'est pas isolé : git répond « ${vu} ».`);

    const shas: string[] = [];
    for (const n of [1, 2, 3]) {
      writeFileSync(join(source, `f${n}.txt`), `${n}\n`);
      git(source, "add", `f${n}.txt`); git(source, "commit", "-qm", `c${n}`);
      shas.push(git(source, "rev-parse", "HEAD").stdout.trim());
    }

    const entier = join(bac, "entier"), court = join(bac, "court");
    git(bac, "clone", "-q", source, entier);
    git(bac, "clone", "-q", "--depth", "1", `file://${source}`, court);
    assert.equal(git(court, "rev-parse", "--is-shallow-repository").stdout.trim(), "true",
      "le clone n'est pas superficiel : ce cas ne reproduit pas la situation qu'il vise.");

    /* Le clone ENTIER répond, dans les deux sens — sinon « tronqué » ne voudrait rien dire. */
    assert.equal(empreinteScelleeAtteignable(entier, shas[0]!), "atteignable",
      "un commit ancien d'un clone complet n'est plus vu comme atteignable.");
    assert.equal(empreinteScelleeAtteignable(entier, "0".repeat(40)), "absent",
      "un commit qui n'existe pas est vu comme atteignable : la garde ne garde plus rien.");

    /* Le clone COURT : il porte HEAD, et pas le premier commit. */
    assert.equal(empreinteScelleeAtteignable(court, shas[2]!), "atteignable",
      "un clone superficiel qui contient le commit doit répondre « atteignable », pas « on ne\n"
      + "  sait pas » : sinon la nuance sert d'excuse à ne jamais conclure.");
    assert.equal(empreinteScelleeAtteignable(court, shas[0]!), "historique tronqué",
      "un clone superficiel accuse une réécriture qui n'a pas eu lieu. Un acheteur qui clone\n"
      + "  vite lit le dépôt s'accusant d'avoir effacé sa propre preuve.");
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});

/*
 * LE `-m` EST DANS LA COMMANDE ET AUCUN CAS NE L'ÉPROUVE.
 *
 * `git log -p` n'affiche AUCUN diff pour un commit de fusion. Un secret introduit dans la
 * RÉSOLUTION d'un conflit — donc présent dans l'arbre, donc dans ce que reçoit un clone —
 * n'apparaît alors nulle part dans le flux balayé, et `SECURITE.md` publie son zéro sans
 * avoir lu une seule fusion. Le drapeau a été ajouté ; retirer `"-m"` de la commande laisse
 * la suite entièrement verte. C'est le défaut d'origine reporté d'un cran, de la commande
 * vers son témoin.
 *
 * Ce cas fabrique donc un dépôt qui porte le secret UNIQUEMENT dans la résolution, et il le
 * prouve avant de conclure : il lance lui-même `git log -p` sans `-m` et exige que le secret
 * n'y soit PAS. Sans cette vérification, un dépôt mal fabriqué — secret visible des deux
 * façons — rendrait ce cas vert sur une commande sans `-m`.
 *
 * Le second secret, posé dans un commit ordinaire, est le contrôle positif : il reste trouvé
 * quand `-m` disparaît. C'est lui qui distingue « le balayage ne lit pas les fusions » de
 * « le balayage ne lit plus rien ».
 *
 * Les deux clés sont ASSEMBLÉES à l'exécution. Écrites en toutes lettres, elles entreraient
 * dans l'historique de CE dépôt et le balayage les y trouverait — il faudrait alors les
 * déclarer comme leurres, c'est-à-dire ajouter du bruit permanent pour un cas jetable.
 */
test("un secret introduit dans la résolution d'une fusion est balayé", () => {
  const envPropre = { ...process.env };
  for (const v of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete envPropre[v];

  const bac = realpathSync(mkdtempSync(join(tmpdir(), "menace-fusion-")));
  const depot = join(bac, "depot");
  const git = (...a: string[]) => spawnSync("git", a, { cwd: depot, encoding: "utf8", env: envPropre });
  /* Le plancher du balayage vaut 200 octets par commit : des fichiers d'une ligne le feraient
     refuser pour une raison qui n'a rien à voir avec ce qu'on éprouve. */
  const remplissage = (quoi: string) => `${quoi}\n`.repeat(60);

  try {
    mkdirSync(depot);
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");

    /* Le bac est-il bien un dépôt à lui ? Sinon tout ce qui suit s'écrit dans celui qu'on
       éprouve — `GIT_DIR` gagne sur `cwd`. */
    const vu = git("rev-parse", "--absolute-git-dir").stdout.trim();
    assert.ok(vu.startsWith(depot), `le bac n'est pas isolé : git répond « ${vu} ».`);

    const cleOrdinaire = ["AKIA", "ZXCVBNMLKJHGFDSA"].join("");
    const cleDeFusion = ["AKIA", "QWERTYUIOPASDFGH"].join("");

    writeFileSync(join(depot, "a.txt"), remplissage("a"));
    git("add", "."); git("commit", "-qm", "c1");
    const principale = git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();

    writeFileSync(join(depot, "ordinaire.txt"), remplissage("o") + cleOrdinaire + "\n");
    git("add", "."); git("commit", "-qm", "c2");

    git("checkout", "-qb", "cote");
    writeFileSync(join(depot, "partage.txt"), remplissage("cote"));
    git("add", "."); git("commit", "-qm", "c3");

    git("checkout", "-q", principale);
    writeFileSync(join(depot, "partage.txt"), remplissage("principal"));
    git("add", "."); git("commit", "-qm", "c4");

    git("merge", "--no-commit", "cote");            /* conflit attendu : code non nul */
    writeFileSync(join(depot, "partage.txt"), remplissage("resolu") + cleDeFusion + "\n");
    git("add", "partage.txt");
    git("commit", "-qm", "fusion");

    /*
     * LE DÉPÔT FABRIQUÉ ÉPROUVE-T-IL BIEN CE QU'ON CROIT ? Trois vérifications avant de
     * conclure quoi que ce soit du balayage.
     */
    const fusions = git("rev-list", "--merges", "--all").stdout.trim().split("\n").filter(Boolean);
    assert.equal(fusions.length, 1,
      `${fusions.length} fusion(s) dans le dépôt fabriqué : il n'y a rien à lire de particulier, `
      + "et ce cas passerait au vert sans éprouver le drapeau.");

    const sansM = git("log", "-p", "--all", "--no-color").stdout;
    assert.ok(!sansM.includes(cleDeFusion),
      "le secret de la résolution est déjà visible SANS `-m` : le dépôt fabriqué ne cache rien, "
      + "et ce cas resterait vert sur une commande qui ne lit pas les fusions.");
    assert.ok(sansM.includes(cleOrdinaire),
      "le secret ordinaire est introuvable même sans `-m` : le dépôt est mal fabriqué et le "
      + "contrôle positif ne contrôle rien.");

    const r = balayerLHistorique(depot);

    /* Le balayage a bien lu le flux qu'on lui a donné, avant qu'on juge ce qu'il y a trouvé. */
    assert.equal(r.temoins, 2,
      `${r.temoins} leurre(s) retrouvé(s) sur 2 : la boucle n'a pas parcouru le flux, et ce `
      + "qu'elle n'y a pas trouvé ne veut rien dire.");

    const fichiers = r.reels.map((t) => t.fichier);
    assert.ok(fichiers.includes("ordinaire.txt"),
      `contrôle positif en échec : le secret d'un commit ORDINAIRE n'est pas trouvé `
      + `(fichiers vus : ${fichiers.join(", ") || "aucun"}). Le balayage ne lit plus rien du tout, `
      + "et le verdict ci-dessous ne dirait pas ce qu'il prétend dire.");

    assert.ok(fichiers.includes("partage.txt"),
      `le secret introduit dans la RÉSOLUTION de la fusion n'est pas trouvé `
      + `(fichiers vus : ${fichiers.join(", ") || "aucun"}).\n`
      + "  `git log -p` sans `-m` ne rend aucun diff pour un commit de fusion : le secret est\n"
      + "  dans l'arbre, donc dans le clone, et le balayage publie « aucun secret » sans l'avoir vu.");
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});
