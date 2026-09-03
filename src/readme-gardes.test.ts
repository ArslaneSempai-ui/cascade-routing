/*
 * LES REFUS DE `readme.ts`, ÉPROUVÉS PAR LE SEUL CHEMIN QUI Y MÈNE.
 *
 * `readme.ts` n'exporte rien : c'est une suite d'IIFE de haut niveau qui se termine par un
 * `emit(...)` réécrivant README.md. Aucun test ne peut l'importer — l'importer publierait la
 * page. Ses gardes ne sont donc atteignables que d'une façon : monter un bac d'essai, y
 * retirer le relevé visé, et lancer le script en sous-processus.
 *
 * Ce que ces cas gardent n'est pas « le script s'arrête » mais **le message**. Un README qui
 * publie un tableau vide, un facteur d'exposition absent, ou « 0 test » se lit exactement
 * comme un README juste ; c'est le refus, et lui seul, qui empêche la page de mentir. Et un
 * refus sans issue écrite finit commenté par le premier qui le rencontre — donc chaque cas
 * exige aussi que le message dise comment produire le relevé.
 *
 * Le bac RÉCRIT sa propre copie de README.md, il ne la contrôle pas : le mode `--check`
 * ferait dépendre ces cas de la fraîcheur du README versionné, qui bouge dès qu'un fichier de
 * test est ajouté ailleurs. Un rouge venu de là ne dirait rien des gardes visées.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, copyFileSync, readdirSync, readFileSync, writeFileSync,
  rmSync, symlinkSync, existsSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readProfiles } from "./measure.ts";
import { optimiseExtraction } from "./optimise.ts";
import { ASSUMPTIONS } from "./assumptions.ts";
import { fileURLToPath } from "node:url";
import { extensionsLancees, fichiersDeCas, fichiersQuiRessemblentADesCas,
  compterLesCas } from "./compter-cas.ts";

const racine = fileURLToPath(new URL("..", import.meta.url));

/**
 * Une copie du dépôt où un relevé peut MANQUER.
 *
 * `node_modules` est un LIEN, jamais une copie : il porte plus d'un gigaoctet de cache de
 * modèles. Vérifié qu'un `rmSync(recursive)` délie le lien sans toucher à sa cible.
 *
 * La liste des fichiers copiés se DÉDUIT du disque — tout `.json`, `.md` et `.pem` de la
 * racine — plutôt que de se réciter. Une liste écrite à la main ici dirait une chose et
 * `readme.ts` en lirait une autre : le jour où la page lit un onzième relevé, le bac ne le
 * verrait pas et le refus qu'on éprouve ici arriverait pour la mauvaise raison.
 */
function bac(): string {
  const d = mkdtempSync(join(tmpdir(), "cascade-readme-"));
  cpSync(join(racine, "src"), join(d, "src"), { recursive: true });
  symlinkSync(join(racine, "node_modules"), join(d, "node_modules"), "dir");
  /* `.html` depuis le 3 septembre 2026 : le rapport d'exemple signé est un document livré que
     le tableau annonce, et un bac qui ne le copie pas fait rougir le cas des documents pour
     une absence qu'il a fabriquée lui-même. */
  const copies = readdirSync(racine).filter((n) => /\.(json|md|pem|html)$/.test(n));
  /* Un bac vide rendrait le même rouge que la garde visée, et pour rien. */
  assert.ok(copies.length >= 10,
    `${copies.length} relevé(s) copié(s) dans le bac : la racine n'a pas été lue.`);
  for (const f of copies) copyFileSync(join(racine, f), join(d, f));
  return d;
}

/** Rendre la page dans le bac. Zéro : elle s'écrit. Non nul : un bloc a refusé. */
const lancer = (d: string): SpawnSyncReturns<string> =>
  spawnSync(process.execPath, ["src/readme.ts"], { cwd: d, encoding: "utf8", timeout: 120_000 });

/**
 * LA CONTRE-ÉPREUVE, ET POURQUOI ELLE EST LA PREMIÈRE LIGNE DE CHAQUE CAS.
 *
 * Sans elle, un `readme.ts` qui échouerait pour n'importe quelle raison — un bac mal monté,
 * un relevé oublié à la copie — ferait passer tous les cas d'un coup, en rouge partout. Le
 * bac doit d'abord prouver qu'il rend la page.
 */
function bacQuiRend(): string {
  const d = bac();
  const r = lancer(d);
  if (r.status !== 0) {
    rmSync(d, { recursive: true, force: true });
    assert.fail(`le bac ne rend pas la page avec TOUS ses relevés : le rouge des cas qui suivent\n`
      + `  ne viendrait pas de la garde éprouvée.\n${r.stderr}`);
  }
  return d;
}

test("sans ocr.json, l'étage de lecture REFUSE au lieu de publier un tableau vide", () => {
  const d = bacQuiRend();
  try {
    rmSync(join(d, "ocr.json"));
    const r = lancer(d);
    assert.notEqual(r.status, 0, "sans ocr.json, la page se rend quand même.");
    assert.match(r.stderr, /ocr\.json is missing/,
      `le refus ne nomme plus le relevé absent :\n${r.stderr}`);
    /* L'ISSUE, pas seulement le refus : un refus sans issue se contourne en commentant la
       garde. Ce relevé-ci se recalcule, et la commande existe. */
    assert.match(r.stderr, /npm run ocr/,
      `le refus ne dit plus comment produire le relevé :\n${r.stderr}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("sans exposition.json, le bloc du coût d'avoir tort REFUSE de s'écrire", () => {
  const d = bacQuiRend();
  try {
    rmSync(join(d, "exposition.json"));
    const r = lancer(d);
    assert.notEqual(r.status, 0, "sans exposition.json, la page publie quand même un facteur d'exposition.");
    assert.match(r.stderr, /exposition\.json is missing/,
      `le refus ne nomme plus le relevé absent :\n${r.stderr}`);
    /* L'ISSUE est ici d'une autre nature : ce relevé ne se recalcule PAS dans ce dépôt — il y
       est livré. Le message doit donc dire de le restaurer, et surtout pas renvoyer vers un
       `npm run` qui n'existe pas. */
    assert.match(r.stderr, /git checkout exposition\.json/,
      `le refus n'indique plus la seule issue réelle (restaurer depuis git) :\n${r.stderr}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("sans document.json, le taux par dossier REFUSE de s'écrire", () => {
  const d = bacQuiRend();
  try {
    rmSync(join(d, "document.json"));
    const r = lancer(d);
    assert.notEqual(r.status, 0, "sans document.json, la page publie quand même un taux par dossier.");
    assert.match(r.stderr, /document\.json is missing/,
      `le refus ne nomme plus le relevé absent :\n${r.stderr}`);
    assert.match(r.stderr, /git checkout document\.json/,
      `le refus n'indique plus la seule issue réelle (restaurer depuis git) :\n${r.stderr}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("si le compte de tests s'effondre, le README REFUSE de publier le chiffre", () => {
  const d = bacQuiRend();
  try {
    /*
     * LE VRAI MODE DE PANNE, celui qui arrivera. Le chiffre a longtemps été tapé à la main ;
     * il se lit maintenant du disque avec `/^test\(/`. Le jour où les cas passent sous un
     * `describe(...)`, ils s'indentent, le motif cesse de les voir, et le compte tombe à zéro
     * sans qu'un seul test ait disparu. On reproduit exactement ça.
     */
    /*
     * LA LISTE À NEUTRALISER VIENT DE LA MÊME SÉLECTION QUE LE COMPTE.
     *
     * Elle disait `.test.ts`, écrit à la main — la faute même que le compteur portait. Le jour
     * où le compteur a cessé d'écarter les `.test.mjs`, ce cas a continué de n'indenter que les
     * `.test.ts` : trente-quatre cas restaient visibles, le compte ne tombait pas à zéro, et le
     * refus attendu n'arrivait plus. La garde regardait une collection plus étroite que ce
     * qu'elle prétendait faire disparaître.
     */
    const dossier = join(d, "src");
    const cas = fichiersQuiRessemblentADesCas(dossier);
    assert.ok(cas.length >= 20,
      `${cas.length} fichier(s) de test dans le bac : il n'y a rien à faire disparaître, et le\n`
      + "  rouge qui suivrait ne prouverait rien.");
    for (const f of cas) {
      const p = join(dossier, f);
      writeFileSync(p, readFileSync(p, "utf8").replace(/^test\(/gm, "  test("));
    }
    const r = lancer(d);
    assert.notEqual(r.status, 0, "le motif ne voit plus un seul test et le README publie quand même un chiffre.");
    /*
     * LE MESSAGE DOIT PORTER LES DEUX NOMBRES. « 0 sur 27 » dit que la LECTURE a échoué ;
     * « 0 sur 0 » dirait qu'il n'y a plus de fichiers de test. Ce ne sont pas les mêmes
     * pannes, et le message est la seule chose qui les sépare.
     */
    const m = r.stderr.match(/Error: 0 tests counted across (\d+) file\(s\): the reading failed\./);
    assert.ok(m, `le refus ne distingue plus « rien lu » de « rien à lire » :\n${r.stderr}`);
    const fichiers = Number(m[1]);
    assert.ok(fichiers >= 20,
      `le refus annonce ${fichiers} fichier(s) : il a compté zéro test dans zéro fichier, donc ce\n`
      + "  cas n'éprouve pas le mode de panne visé — le motif qui cesse de voir des tests présents.");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("si aucun document livré n'est trouvé, le tableau REFUSE de proclamer leur absence", () => {
  const d = bacQuiRend();
  /* La liste se DÉDUIT de `readme.ts` : c'est lui qui décide ce qu'il annonce, et une liste
     recopiée ici se désynchroniserait de la sienne en silence. */
  const source = readFileSync(join(racine, "src/readme.ts"), "utf8");
  const bloc = source.slice(source.indexOf("const decrit: Record<string, string> = {"));
  const decrits = [...bloc.slice(0, bloc.indexOf("};")).matchAll(/^\s*"([^"]+)":/gm)].map((x) => x[1]!);
  try {
    assert.ok(decrits.length >= 5,
      `${decrits.length} document(s) décrit(s) déduit(s) de readme.ts : la lecture a échoué.`);
    for (const f of decrits) assert.ok(existsSync(join(d, f)), `${f} n'est pas dans le bac.`);

    /*
     * CONTRE-ÉPREUVE : tous sauf un absents ne doivent PAS déclencher le refus. Sans elle,
     * une garde qui refuserait dès le premier document manquant passerait ce cas — et le
     * README perdrait son avertissement « ⚠ n document(s) … », qui est le comportement voulu
     * dans ce cas-là.
     */
    for (const f of decrits.slice(1)) rmSync(join(d, f));
    const partiel = lancer(d);
    assert.equal(partiel.status, 0,
      `un seul document présent sur ${decrits.length} et la page ne se rend plus : le refus ne\n`
      + `  distingue plus « la lecture a échoué » de « presque rien n'est livré ».\n${partiel.stderr}`);
    assert.doesNotMatch(partiel.stderr, /no shipped document was found/,
      `le refus se déclenche avec un document encore présent.\n${partiel.stderr}`);

    rmSync(join(d, decrits[0]!));
    const r = lancer(d);
    assert.notEqual(r.status, 0, "zéro document trouvé et la page se rend quand même.");
    assert.match(r.stderr, /no shipped document was found at the root: the reading failed/,
      `zéro document trouvé et pas de refus : le tableau publierait une absence qui n'existe pas.\n${r.stderr}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

/*
 * UN BLOC RETIRÉ DE LA CARTE GARDE SES MARQUEURS, ET PLUS PERSONNE NE LE REGARDE.
 *
 * `figures()` ne contrôle QUE `Object.keys(blocks)`. Un bloc qui vit dans le README avec ses
 * marqueurs `<!-- figures:x -->` mais qui a quitté la carte passée à `emit(...)` n'est plus
 * comparé à rien : `--check` annonce « up to date », et le bloc reste figé pour toujours en
 * portant la marque de ce qui est engendré.
 *
 * Ce n'est pas une hypothèse de bureau : DEUX cliquets de ce dépôt retirent les blocs
 * `figures:` avant de compter, avec pour seule raison qu'« ils sont tenus par leur
 * générateur » — le cliquet des taux tapés et celui de la prose. Retirer une clé les fait
 * donc tous les deux détourner le regard d'un bloc que plus rien ne tient. Une clé de moins,
 * et de la prose gelée porte la marque d'une mesure sous trois gardes qui l'ignorent.
 *
 * Mesuré le 26 août 2026 : 29 marqueurs, 29 clés. Le trou n'était pas ouvert ; il était
 * simplement ouvrable sans bruit, et c'est ce que ce cas ferme.
 *
 * Il se lit dans la SOURCE : importer `readme.ts` réécrirait la page — voir l'en-tête.
 */
test("tout bloc engendré du README a la clé qui l'engendre, et réciproquement", () => {
  const src = readFileSync(join(racine, "src", "readme.ts"), "utf8");
  const i = src.indexOf("emit(fileURLToPath");
  assert.ok(i > 0, "`readme.ts` ne finit plus par un `emit(fileURLToPath…)` : ce cas ne garde plus rien.");

  /* Découpe par profondeur : un motif sur les virgules perd une clé sur deux dès que deux
     abréviations se suivent — la virgule consommée par la première manque à la seconde. */
  const deb = src.indexOf("{", i);
  let d = 0, fin = deb;
  for (let k = deb; k < src.length; k++) {
    const c = src[k]!;
    if (c === "{" || c === "[" || c === "(") d++;
    else if (c === "}" || c === "]" || c === ")") { d--; if (d === 0) { fin = k; break; } }
  }
  const cles = src.slice(deb + 1, fin).split(",")
    .map((x) => x.trim().split(":")[0]!.trim()).filter(Boolean).sort();

  const marqueurs = [...readFileSync(join(racine, "README.md"), "utf8")
    .matchAll(/<!-- figures:([A-Za-z0-9-]+) -->/g)].map((m) => m[1]!).sort();

  /* Non-vacuité dans les deux sens : deux listes vides sont égales et ne gardent rien. */
  assert.ok(cles.length >= 10, `${cles.length} clé(s) lue(s) dans l'appel : la découpe est cassée.`);
  assert.ok(marqueurs.length >= 10, `${marqueurs.length} marqueur(s) lu(s) : la lecture est cassée.`);

  assert.deepEqual(marqueurs, cles,
    "un bloc engendré du README n'a plus de clé pour l'engendrer, ou l'inverse.\n"
    + `  marqueurs sans clé : ${marqueurs.filter((m) => !cles.includes(m)).join(", ") || "—"}\n`
    + `  clés sans marqueur : ${cles.filter((c) => !marqueurs.includes(c)).join(", ") || "—"}\n`
    + "  `figures()` ne contrôle que les clés de la carte : un bloc sans clé garde ses marqueurs,\n"
    + "  `--check` le déclare à jour, et les cliquets qui écartent les blocs `figures:` — celui\n"
    + "  des taux tapés, celui de la prose — continuent de l'écarter. Plus rien ne le tient.\n"
    + "  → remettre la clé, ou retirer les marqueurs pour que le bloc redevienne de la prose\n"
    + "    contrôlée comme telle.");
});

test("le routage « publié » d'exposition.json est celui que le relevé livré produit", () => {
  /*
   * exposition.json vient d'ailleurs (cascade-licencie) et porte un routage gelé que le README
   * cite comme « publié ». Rien ne le confrontait au routage que le relevé LIVRÉ produit :
   * après une re-mesure qui déplace le seuil, le README aurait continué de citer l'ancien
   * routage sans qu'aucun contrôle tombe. Deux sources pour une même grandeur — la famille
   * qui a produit quatre défauts en deux jours. Audit du 27 août 2026.
   */
  const expo = JSON.parse(readFileSync(fileURLToPath(new URL("../exposition.json", import.meta.url)), "utf8")) as
    { publie: Record<string, string> };
  const p = readProfiles();
  assert.ok(p, "aucun relevé lisible : ce cas ne peut rien confronter.");
  const optimum = optimiseExtraction(p!, ASSUMPTIONS);
  assert.ok(optimum, "l'optimum ne se calcule pas sur le relevé livré.");
  assert.deepEqual(expo.publie, optimum!.routing,
    "exposition.json publie un routage que le relevé livré ne produit plus : le README citerait\n"
    + "  un état révolu comme « publié ». Régénérer exposition.json (cascade-licencie), ou dire\n"
    + "  pourquoi l'écart est voulu — mais pas le laisser diverger en silence.");
});


/*
 * LE CHIFFRE PUBLIÉ NE DOIT PAS ÉCARTER EN SILENCE.
 *
 * Le README a annoncé « 539 tests across 61 files » pendant que la suite en exécutait 573
 * dans 65 fichiers : le compteur ne lisait que `.test.ts`, la commande lance aussi
 * `src/*.test.mjs`, et rien nulle part ne disait qu'une extension entière était écartée.
 * Le chiffre est sur la page d'un produit vendu à des banques, et il sous-vendait.
 *
 * Ce cas ne recompte pas le README — `--check` s'en charge. Il garde la SÉLECTION : tout ce
 * qui ressemble à un fichier de cas doit être atteint par la commande qui lance la suite.
 * Un fichier ajouté dans une extension que la commande ne lance pas rougit ici, au lieu de
 * disparaître d'un chiffre publié.
 */
test("tout fichier de cas est atteint par la commande qui lance la suite", () => {
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const scriptTest = String(JSON.parse(
    readFileSync(join(racine, "package.json"), "utf8")).scripts?.test ?? "");

  /* TÉMOIN AVANT LE VERDICT : le motif lit-il encore la commande ? S'il rendait une liste
     vide, « rien d'écarté » serait vrai par vacuité — les deux collections seraient vides. */
  const extensions = extensionsLancees(scriptTest);
  assert.ok(extensions.length >= 2,
    `${extensions.length} extension(s) lue(s) dans le script \`test\` : le motif ne lit plus la `
    + "commande, et ce cas comparerait deux collections vides.");

  /* Et il ne doit pas inventer : deux fabrications, dont une sans aucun fichier de cas. */
  assert.deepEqual(extensionsLancees("node --test src/*.test.mts"), [".test.mts"],
    "le motif ne reconnaît pas une extension neuve : le jour où la commande en gagne une, "
    + "le compte publié repartirait à la dérive sans un mot.");
  assert.deepEqual(extensionsLancees("tsc --noEmit && node src/readme.ts --check"), [],
    "le motif invente une extension là où la commande n'en lance aucune.");

  const surLeDisque = fichiersQuiRessemblentADesCas(dossier);
  const atteints = fichiersDeCas(dossier, scriptTest);

  assert.ok(surLeDisque.length >= 20,
    `${surLeDisque.length} fichier(s) de cas trouvé(s) dans src/ : la lecture du dossier a `
    + "échoué, et l'égalité ci-dessous ne comparerait rien.");

  const ecartes = surLeDisque.filter((f) => !atteints.includes(f));
  assert.deepEqual(ecartes, [],
    `${ecartes.length} fichier(s) de cas ne sont lancés par aucune extension du script \`test\` :\n  `
    + ecartes.join("\n  ")
    + `\n  Ils ne tournent pas, et le chiffre publié par le README les écarte sans le dire.\n`
    + `  → ajouter leur extension au script \`test\` de package.json, ou renommer les fichiers.`);

  /* Le compte publié porte bien sur cette collection-là, et sur rien d'autre. */
  const { n, fichiers } = compterLesCas(dossier, scriptTest);
  const publie = readFileSync(join(racine, "README.md"), "utf8")
    .match(/\*\*(\d+) tests\*\* across (\d+) files/);
  assert.ok(publie, "le README ne porte plus la phrase du compte : ce cas ne garde plus rien.");
  assert.deepEqual([Number(publie[1]), Number(publie[2])], [n, fichiers.length],
    `le README publie ${publie[1]} cas dans ${publie[2]} fichiers, la sélection en donne `
    + `${n} dans ${fichiers.length}. → npm run figures`);
});


/*
 * LE COMPTEUR LUI-MÊME : IL REFUSE, OU IL REND ZÉRO EN SILENCE.
 *
 * `compter-cas.ts` a été écrit pour `cascade`, qui liste ses extensions en toutes lettres.
 * Neuf dépôts voisins écrivent `src/*.test.*`. Sur cette forme, le motif d'origine extrayait
 * `.test` — une extension qui ne correspond à AUCUN fichier — donc zéro fichier, zéro cas, et
 * un README qui aurait publié « 0 tests » comme une mesure. Un mode de panne silencieux QUI
 * PORTE UN CHIFFRE : personne ne va vérifier un nombre qui s'affiche.
 *
 * Le fichier ne vit que dans `cascade` aujourd'hui : ce n'était donc pas un défaut, c'était un
 * piège posé pour la prochaine personne qui le copierait en le croyant sûr — et il porte un
 * commentaire qui explique pourquoi lister les extensions à la main serait faux, ce qui invite
 * précisément à le copier.
 *
 * LE CORRECTIF EST LE REFUS, PAS L'ÉLARGISSEMENT. Reconnaître l'étoile rattrape une forme
 * connue ; le motif restera toujours en retard sur celle qu'on n'a pas prévue. Le refus, lui,
 * les couvre toutes — c'est le zéro qui doit prouver qu'il a regardé, appliqué à notre propre
 * outil de mesure.
 */
test("un compteur qui ne reconnaît pas sa commande REFUSE, il ne rend pas zéro", () => {
  const dossier = fileURLToPath(new URL(".", import.meta.url));

  assert.throws(() => fichiersDeCas(dossier, "tsc --noEmit && node src/readme.ts --check"),
    /no case file reached/,
    "un script qui ne lance aucun cas sous une forme reconnaissable doit faire REFUSER. "
    + "Rendre zéro publierait « 0 tests » comme une mesure, et un chiffre affiché n'est pas "
    + "revérifié.");

  /*
   * LE PENDANT, SANS LEQUEL « LÈVE TOUJOURS » PASSERAIT. Un compteur qui refuserait sur tout
   * satisferait l'assertion ci-dessus en n'ayant jamais rien compté.
   */
  const explicite = fichiersDeCas(dossier, "node --test src/*.test.ts src/*.test.mjs");
  assert.ok(explicite.length >= 30,
    `${explicite.length} fichier(s) atteints par la forme explicite : le compteur refuse ou ne `
    + "sélectionne presque rien, et le refus ci-dessus ne prouverait rien.");

  /*
   * ET LA FORME DES VOISINS DOIT DONNER LA MÊME COLLECTION. C'est le vrai contrôle de
   * l'élargissement : `src/*.test.*` et la liste explicite décrivent le même ensemble ici, donc
   * un dépôt qui écrit l'une ou l'autre compte la même chose.
   */
  assert.deepEqual(fichiersDeCas(dossier, "node --test src/*.test.*"), explicite,
    "`src/*.test.*` et la forme explicite ne sélectionnent pas les mêmes fichiers : le compteur "
    + "rendrait deux chiffres différents pour deux façons d'écrire la même commande.");
});
