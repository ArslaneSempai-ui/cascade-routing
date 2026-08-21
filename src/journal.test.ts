/*
 * GARDER LES ISSUES, PAS LES TAUX.
 *
 * Trois passes se sont terminées de la même façon le 21 août : la question suivante demandait
 * les résultats cas par cas, la passe n'avait gardé que des moyennes, et la machine a repayé.
 * Deux heures de GPU pour retrouver ce qui était en mémoire et qu'on avait jeté. Ces tests
 * tiennent le format qui l'empêche — et surtout les trois propriétés qui font sa valeur, parce
 * qu'un journal qui perd l'une des trois ne vaut pas mieux qu'un taux.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issue, ouvrirJournal, lireJournal, apparie, parDocument, issues, desaccord, latences, accordEntreMachines } from "./journal.ts";
import { correct } from "./tiers.ts";
import { FIELDS, generateRecords } from "./corpus.ts";

import type { Tentative } from "./journal.ts";

test("un blanc et une valeur fausse ne sont pas le même échec", () => {
  assert.equal(issue("Anna Petrova", "Anna Petrova"), "clean");
  assert.equal(issue("", "Anna Petrova"), "blank");
  assert.equal(issue("   ", "Anna Petrova"), "blank", "des espaces ne sont pas une réponse");
  assert.equal(issue("Anna P.", "Anna Petrova"), "wrong");

  /*
   * `clean` est exactement `correct()`.
   *
   * C'est ce qui permet de relire sans les bouger tous les taux déjà publiés : le journal
   * partage les échecs en deux, il ne redéfinit pas la réussite. Si cette égalité cassait, un
   * relevé de juillet et un relevé d'août compteraient deux choses différentes sous le même nom.
   */
  const cas: [string, string][] = [
    ["10 / 07 / 1987", "10/07/1987"], ["", "x"], ["ES-1234-A", "ES-1234-A"],
    ["madrid", "Madrid"], ["Madrid,", "Madrid"], ["autre chose", "Madrid"],
  ];
  for (const [got, exp] of cas) {
    assert.equal(issue(got, exp) === "clean", correct(got, exp),
      `« ${got} » contre « ${exp} » : le journal et le correcteur ne sont pas d'accord.`);
  }
  assert.equal(cas.length, 6, "les six cas de contrôle ont bien été exercés");
});

test("aucune vérité de terrain n'est vide, sinon `blank` compterait une bonne réponse comme un échec", () => {
  /*
   * La partition en trois suppose qu'un blanc est toujours une non-réponse. Le jour où le
   * corpus contiendra un champ légitimement absent, un modèle qui répond « rien » à juste
   * titre sera classé `blank`, donc en échec, et le taux baissera sans qu'aucun modèle n'ait
   * empiré. Ce test tient l'hypothèse plutôt que de la laisser dans un commentaire.
   */
  let vides = 0, examines = 0;
  for (const part of ["training", "dev", "heldout"] as const) {
    for (const d of generateRecords(200, part)) {
      for (const c of FIELDS) { examines++; if (String(d.truth[c]).trim().length === 0) vides++; }
    }
  }
  assert.ok(examines >= 3000, `${examines} champs examinés : le corpus n'a pas été parcouru.`);
  assert.equal(vides, 0,
    `${vides} champ(s) de vérité vide(s) : la partition clean/blank/wrong doit être revue avant\n`
    + `  de publier un taux, parce qu'une absence correcte y est comptée comme un échec.`);
});

test("une passe tuée en cours laisse ses lignes lisibles", () => {
  /*
   * C'est la raison d'être du format. Une passe qui meurt à la trente-huitième minute doit
   * laisser trente-huit minutes exploitables ; celles d'hier ne laissaient rien, parce qu'elles
   * écrivaient leur fichier à la fin. Ici on coupe un fichier au milieu d'une ligne et on
   * vérifie que tout ce qui précède survit.
   */
  const dossier = mkdtempSync(join(tmpdir(), "journal-"));
  try {
    const f = join(dossier, "passe.jsonl");
    const lignes = [JSON.stringify({ kind: "run", run: "r", quoi: "essai", split: "dev", cases: 3 })];
    for (let i = 0; i < 5; i++) {
      lignes.push(JSON.stringify({ kind: "t", run: "r", tier: "gen-4b", field: "name", caseId: `c${i}`,
        phrasing: "reference", split: "dev", outcome: "clean", ms: 12, value: "a", expected: "a" }));
    }
    const entier = lignes.join("\n") + "\n";
    writeFileSync(f, entier.slice(0, entier.length - 40));   // coupe la dernière ligne en deux

    const lu = lireJournal(f);
    assert.equal(lu.conditions?.split, "dev", "les conditions de la passe sont retrouvées");
    assert.equal(lu.tentatives.length, 4, "les quatre tentatives complètes survivent à la coupure");
    assert.equal(lu.tronquees, 1, "la ligne coupée est comptée, pas passée sous silence");
    assert.equal(lu.complet, false,
      "sans pied de page la passe est incomplète, et le fichier doit le dire");
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test("le taux par document ne se déduit pas des taux par champ", () => {
  /*
   * Le chiffre que voit l'acheteur est le taux de dossiers entièrement propres, et il n'est pas
   * la moyenne des cinq taux par champ : deux paliers peuvent afficher le même taux par champ
   * et livrer des proportions de dossiers propres très différentes, selon que leurs erreurs se
   * groupent sur les mêmes documents ou se dispersent. Voilà pourquoi il faut les lignes.
   */
  const faire = (tier: string, motif: string[]): Tentative[] =>
    motif.flatMap((m, doc) => [...m].map((ch, i) => ({
      run: "r", tier, field: FIELDS[i]!, caseId: `d${doc}`, phrasing: "reference", split: "dev",
      outcome: (ch === "1" ? "clean" : "wrong") as Tentative["outcome"],
      ms: 1, value: "", expected: "",
    })));

  /* Quatre erreurs sur vingt dans les deux cas : 80 % par champ, des deux côtés. */
  const groupe = faire("groupé", ["00111", "00111", "11111", "11111"]);
  const disperse = faire("dispersé", ["01111", "10111", "11011", "11101"]);

  const g = parDocument(groupe, { tier: "groupé" });
  const d = parDocument(disperse, { tier: "dispersé" });
  assert.equal(g.tauxChamp, d.tauxChamp, "les deux paliers ont le même taux par champ");
  assert.equal(g.tauxChamp, 0.8);
  assert.equal(g.tauxDocument, 0.5, "les erreurs groupées laissent la moitié des dossiers propres");
  assert.equal(d.tauxDocument, 0, "dispersées, elles salissent les quatre");
  assert.notEqual(g.tauxDocument, d.tauxDocument,
    "si ces deux chiffres étaient égaux, les taux par champ suffiraient et ce journal serait inutile");
});

test("l'appariement se fait sur les cas réellement communs, pas sur les positions", () => {
  const t = (tier: string, phrasing: string, motif: Record<string, boolean>): Tentative[] =>
    Object.entries(motif).map(([caseId, ok]) => ({
      run: "r", tier, field: "name", caseId, phrasing, split: "dev",
      outcome: (ok ? "clean" : "wrong") as Tentative["outcome"], ms: 1, value: "", expected: "",
    }));

  /* `b` n'a pas vu d3 : ce cas ne doit compter dans aucune colonne. */
  const rows = [
    ...t("a", "reference", { d1: true, d2: true, d3: true }),
    ...t("b", "reference", { d1: false, d2: true }),
  ];
  const r = apparie(rows, { tier: "a" }, { tier: "b" });
  assert.equal(r.communs, 2, "seuls les cas vus des deux côtés sont appariés");
  assert.equal(r.gains, 1);
  assert.equal(r.regressions, 0);

  const c = issues(rows, { tier: "a" });
  assert.equal(c.total, 3);
  assert.equal(c.clean, 3);
});

test("toute passe qui mesure ouvre un journal de tentatives", () => {
  /*
   * La règle ne vaut que si elle tient pour la passe suivante, écrite par quelqu'un qui n'aura
   * pas lu ce fichier. Un script qui appelle `extract` ou `classify` en boucle et n'ouvre pas
   * de journal est exactement la passe qu'on repaiera.
   */
  const dossier = new URL(".", import.meta.url).pathname;
  const mesureurs = readdirSync(dossier)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "journal.ts")
    .map((n) => ({ n, src: readFileSync(join(dossier, n), "utf8") }))
    .filter(({ src }) => /await (extract|classify)\(/.test(src) && /isMain\(import\.meta\)/.test(src));

  assert.ok(mesureurs.length >= 4,
    `${mesureurs.length} script(s) de mesure trouvé(s) : la détection a échoué, le test ne vérifie rien.`);
  for (const { n, src } of mesureurs) {
    assert.ok(src.includes("ouvrirJournal"),
      `${n} mesure en boucle sans ouvrir de journal de tentatives.\n`
      + `  → ses résultats cas par cas seront jetés, et la question suivante coûtera une passe.`);
    assert.ok(/journal\??\.ligne\(/.test(src), `${n} ouvre un journal et n'y écrit aucune ligne.`);
  }
});

test("chaque ligne porte sa formulation, référence comprise", () => {
  /*
   * Le défaut corrigé dans `promptUtilise` ne doit pas revenir par la porte du journal :
   * n'écrire la formulation que lorsqu'elle diffère rendrait « mesuré sous la référence » et
   * « personne ne l'a noté » indiscernables.
   */
  const dossier = new URL(".", import.meta.url).pathname;
  const sources = readdirSync(dossier).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => ({ n, src: readFileSync(join(dossier, n), "utf8") }))
    .filter(({ src }) => /journal\??\.ligne\(/.test(src));
  assert.ok(sources.length >= 4, `${sources.length} écrivain(s) trouvé(s) : la détection a échoué.`);

  for (const { n, src } of sources) {
    for (const appel of src.match(/journal\??\.ligne\(\{[\s\S]*?\}\);/g) ?? []) {
      assert.ok(/phrasing:/.test(appel), `${n} écrit une ligne sans formulation.`);
      assert.ok(!/phrasing:[^,]*!==\s*"reference"/.test(appel),
        `${n} n'écrit la formulation que lorsqu'elle diffère de la référence.`);
      assert.ok(/outcome:/.test(appel) && /expected:/.test(appel) && /value:/.test(appel),
        `${n} écrit une ligne sans issue, sans valeur ou sans attendu — elle ne sera pas rejouable.`);
    }
  }
});

/*
 * Tout commit cité par un relevé livré doit exister, ou dire où il est passé.
 *
 * Enregistrer le commit d'une mesure n'a qu'une raison d'être : qu'un lecteur puisse aller
 * chercher le code qui a produit le chiffre. Réécrire l'historique pour purger 1,4 Mo de
 * sorties brutes a changé onze empreintes, et le relevé de référence — celui dont sortent les
 * chiffres publiés — a continué d'afficher une empreinte que personne ne peut extraire.
 *
 * Le correctif d'une faute en a donc cassé une autre, en silence, pendant une journée. Ce test
 * est ce qui aurait crié le soir même.
 */
test("aucun relevé livré ne cite un commit introuvable", () => {
  const racine = new URL("..", import.meta.url).pathname;
  const releves = readdirSync(racine).filter((n) => /^profiles-.*\.json$/.test(n));
  assert.ok(releves.length >= 3, `${releves.length} relevé(s) trouvé(s) : la lecture a échoué.`);

  const carte = (() => {
    const f = join(racine, "commits-reecrits.json");
    if (!existsSync(f)) return new Map<string, string>();
    const j = JSON.parse(readFileSync(f, "utf8")) as { entries: { missing: string; nowAt: string }[] };
    return new Map(j.entries.map((e) => [e.missing, e.nowAt]));
  })();

  const existe = (c: string) => {
    try { execFileSync("git", ["cat-file", "-e", `${c}^{commit}`], { cwd: racine, stdio: "ignore" }); return true; }
    catch { return false; }
  };

  let verifies = 0;
  const sansCommit: string[] = [];
  for (const n of releves) {
    const p = JSON.parse(readFileSync(join(racine, n), "utf8")) as {
      code?: { commit?: string };
      provenance?: Record<string, { accuracy?: { commit?: string }; latency?: { commit?: string } }>;
    };
    const cites = new Set<string>();
    if (p.code?.commit) cites.add(p.code.commit);
    for (const v of Object.values(p.provenance ?? {})) {
      if (v.accuracy?.commit) cites.add(v.accuracy.commit);
      if (v.latency?.commit) cites.add(v.latency.commit);
    }
    if (cites.size === 0) sansCommit.push(n);
    for (const c of cites) {
      verifies++;
      if (existe(c)) continue;
      const vers = carte.get(c);
      assert.ok(vers,
        `${n} cite le commit ${c}, qui n'existe pas dans ce dépôt et n'est déclaré nulle part.\n`
        + `  → un lecteur ne peut pas extraire le code qui a produit ce chiffre,\n`
        + `    ce qui est la seule raison d'enregistrer un commit.\n`
        + `  → soit l'historique a été réécrit et commits-reecrits.json doit le dire,\n`
        + `    soit le relevé doit être refait sous un commit qui existe.`);
      assert.ok(existe(vers!),
        `${n} cite ${c}, redirigé vers ${vers}, qui n'existe pas non plus.`);
    }
  }
  /*
   * Ce que ce test a réellement regardé, et ce qu'il ne peut pas regarder.
   *
   * Deux relevés du 19 août ne citent aucun commit : ils datent d'avant la provenance, et rien
   * ici ne peut les rattacher à du code. Les compter comme vérifiés serait le vert vide que ce
   * dépôt corrige partout — ils sont donc nommés, pas passés sous silence.
   */
  assert.equal(sansCommit.length, 2,
    `${sansCommit.length} relevé(s) sans aucun commit : ${sansCommit.join(", ") || "aucun"}.\n`
    + `  → si ce nombre monte, une mesure a été écrite sans provenance et rien ne la rattache au code.`);
  assert.ok(verifies >= releves.length - sansCommit.length,
    `${verifies} citation(s) vérifiée(s) pour ${releves.length - sansCommit.length} relevé(s) avec provenance.`);
  assert.ok(verifies >= 3,
    `${verifies} commit(s) cité(s) vérifié(s) : trop peu pour que ce test ait regardé quoi que ce soit.`);
});

/*
 * Deux paliers peuvent tous deux avoir raison et livrer deux dossiers différents.
 *
 * Le routage recommande le moins cher des paliers « indiscernables ». Indiscernable veut dire
 * qu'ils **notent** pareil, pas qu'ils **répondent** pareil — et sur un cas à plusieurs lectures
 * défendables l'écart est invisible dans les taux et bien visible dans les dossiers livrés.
 */
test("le désaccord entre deux paliers justes est compté, et n'entre dans aucun taux", () => {
  const t = (tier: string, v: Record<string, [string, Tentative["outcome"]]>): Tentative[] =>
    Object.entries(v).map(([caseId, [value, outcome]]) => ({
      run: "r", tier, field: "birth", caseId, phrasing: "reference", split: "hard-corpus",
      outcome, ms: 1, value, expected: "3 April 1990 | 4 March 1990",
    }));

  const rows = [
    /* d1 : les deux justes, lectures différentes — un désaccord, pas une erreur. */
    ...t("a", { d1: ["3 April 1990", "clean"], d2: ["x", "wrong"], d3: ["1 Jan 1990", "clean"] }),
    ...t("b", { d1: ["4 March 1990", "clean"], d2: ["y", "wrong"], d3: ["1 Jan 1990", "clean"] }),
  ];
  const d = desaccord(rows, { tier: "a" }, { tier: "b" });
  assert.equal(d.communs, 3);
  assert.equal(d.tousDeuxJustes, 2, "d2 est faux des deux côtés : il ne compte pas comme accord");
  assert.equal(d.justesEtDifferents, 1, "seul d1 est juste des deux côtés avec deux valeurs");
  assert.equal(d.tauxParmiLesJustes, 0.5);
  assert.equal(d.exemples[0]?.caseId, "d1");

  /* Et il ne touche pas l'exactitude : les deux paliers restent à deux justes sur trois. */
  assert.equal(issues(rows, { tier: "a" }).clean, 2);
  assert.equal(issues(rows, { tier: "b" }).clean, 2);

  /* Deux paliers faux tous les deux avec des valeurs différentes ne sont pas un désaccord
     entre justes — c'est deux erreurs, et elles sont déjà dans le taux. */
  assert.equal(d.memeIssueValeursDifferentes, 2, "d1 et d2 partagent leur issue et diffèrent");
});

/*
 * « Ne mélange jamais les deux séries de latence » ne doit pas dépendre de la mémoire.
 *
 * Une seconde machine vient d'apparaître. La méthode affirme depuis le début qu'une latence ne
 * vaut que pour la machine qui l'a produite, et personne n'avait pu la mettre en défaut faute
 * d'une seconde machine. La règle devient donc une garde : la fonction refuse, elle ne moyenne pas.
 *
 * Et l'exactitude, qu'on dit transportable, est mesurée au lieu d'être supposée — à décodage
 * glouton avec les mêmes révisions, les chaînes rendues doivent être identiques, pas seulement
 * les taux. Deux machines peuvent afficher le même taux et se tromper sur des cas différents.
 */
test("des latences de deux machines sont refusées, pas moyennées", () => {
  const lot = (cpu: string, ms: number[]) => ({
    conditions: { machine: { cpu, coeurs: 10 } },
    tentatives: ms.map((m, i) => ({
      run: "r", tier: "gen-4b", field: "name", caseId: `d${i}`, phrasing: "reference",
      split: "dev", outcome: "clean" as const, ms: m, value: "", expected: "",
    })),
  });

  const seule = latences([lot("Apple M4 Pro", [10, 20, 30])]);
  assert.equal(seule.n, 3);
  assert.equal(seule.machine, "Apple M4 Pro", "la machine est nommée dans le résultat, pas seulement supposée");

  assert.throws(() => latences([lot("Apple M4 Pro", [10]), lot("Apple M1 Pro", [40])]),
    /Refus de grouper des latences venues de 2 machines/,
    "deux machines ont été moyennées au lieu d'être refusées.");
});

test("mettre les exactitudes en commun demande des sorties identiques, pas des taux égaux", () => {
  const t = (v: [string, Tentative["outcome"]][]): Tentative[] =>
    v.map(([value, outcome], i) => ({
      run: "r", tier: "gen-4b", field: "name", caseId: `d${i}`, phrasing: "reference",
      split: "dev", outcome, ms: 1, value, expected: "",
    }));

  /* Même taux des deux côtés — deux justes sur trois — et pas les mêmes cas. */
  const a = t([["ANNA", "clean"], ["ELENA", "clean"], ["", "blank"]]);
  const b = t([["ANNA", "clean"], ["", "blank"], ["MARIA", "clean"]]);
  const faux = accordEntreMachines(a, b);
  assert.equal(faux.communs, 3);
  assert.equal(faux.memeChaine, 1, "un seul cas rend la même chaîne");
  assert.equal(faux.poolingJustifie, false,
    "des taux égaux ont suffi à autoriser la mise en commun : c'est exactement l'erreur");
  assert.ok(faux.divergences.length >= 2, "les divergences ne sont pas rapportées");

  const vrai = accordEntreMachines(a, t([["ANNA", "clean"], ["ELENA", "clean"], ["", "blank"]]));
  assert.equal(vrai.poolingJustifie, true);
  assert.equal(vrai.memeChaine, vrai.communs);

  /* Aucun cas commun ne doit jamais valoir accord. */
  const vide = accordEntreMachines(a, []);
  assert.equal(vide.communs, 0);
  assert.equal(vide.poolingJustifie, false,
    "zéro cas comparé a été lu comme un accord parfait — le vert vide dans sa forme la plus pure");
});

/*
 * Une durée doit dire sous quelle charge elle a été prise — y compris quand c'est ma faute.
 *
 * Deux fois aujourd'hui, du travail à moi a tourné pendant une mesure : la première a gonflé
 * gen-8b de 32 %, la seconde était l'écriture de ce fichier même, pendant la passe sur les cas
 * durs. Une charge relevée au départ ne dit rien de ce qui démarre ensuite. Le pied de page
 * porte donc le pic échantillonné et tranche lui-même si les durées sont utilisables.
 */
test("le pied de page d'une passe dit la charge pendant, et si les durées valent quelque chose", () => {
  const dossier = mkdtempSync(join(tmpdir(), "journal-charge-"));
  try {
    const j = ouvrirJournal("essai-charge", { quoi: "essai", split: "dev", cases: 1, chargeAvant: 0 });
    j.ligne({ tier: "rules", field: "name", caseId: "d0", phrasing: "reference", split: "dev",
      outcome: "clean", ms: 1, value: "a", expected: "a" });
    const { chemin } = j.fermer();
    const lu = lireJournal(chemin);
    assert.equal(lu.complet, true);
    assert.ok(lu.fin, "le pied de page n'a pas été relu");
    /* Une passe d'une milliseconde n'atteint aucun échantillon : `null` et non un faux zéro. */
    assert.ok("chargePendant" in lu.fin!, "le pied de page ne porte pas la charge pendant la passe");
    assert.ok("chargeExterneAvantSousLeSeuil" in lu.fin!,
      "le pied de page ne dit rien de la charge externe au départ.");
    assert.ok(!("dureesUtilisables" in lu.fin!),
      "un champ promet de juger si les durées sont réutilisables : une passe ne peut pas le savoir\n"
      + "  d'elle-même, sa propre charge et celle d'un intrus se ressemblent de l'intérieur.");
    /*
     * Et le verdict ne doit pas se prononcer sur la charge que la passe produit elle-même.
     *
     * La première version jugeait `pic / cœurs`, et une passe générative dépasse le seuil par
     * son propre travail : elle a rendu `false` au premier usage réel, machine par ailleurs au
     * repos. Un champ qui condamne toujours ne renseigne pas plus qu'un champ absent.
     */
    assert.equal(lu.fin!.chargeExterneAvantSousLeSeuil, true,
      "une passe lancée à charge externe nulle est jugée inutilisable : le verdict porte sur "
      + "la charge de la passe elle-même, pas sur ce qui la dérange.");
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

/*
 * L'éviction silencieuse : mesurée ici plutôt que reprise d'une autre machine.
 *
 * Une seconde machine a rapporté que l'ordre de chargement décide de la survie en mémoire, et
 * a explicitement demandé de ne pas reprendre son chiffre. Vérifié sur celle-ci, dix-sept
 * gigaoctets : du plus gros au plus petit, trois puis trois puis deux modèles résidents ; du
 * plus petit au plus gros, un seul, les trois fois.
 *
 * Ce test ne rejoue pas l'expérience — elle coûte des chargements de modèle. Il tient les deux
 * conséquences dans le code : on charge dans l'ordre décroissant, et la résidence est
 * **constatée** et non déduite de cet ordre, puisque un essai sur trois la perd quand même.
 */
test("les modèles se chargent du plus gros au plus petit, et la résidence est constatée", () => {
  const src = readFileSync(new URL("./tiers.ts", import.meta.url).pathname, "utf8");

  const f = src.slice(src.indexOf("export async function loadGeneratifs"));
  const corps = f.slice(0, f.indexOf("\n}\n") + 2);
  assert.ok(/sort\(/.test(corps) && /tailles?\(/.test(corps),
    "loadGeneratifs ne trie pas les modèles par taille : l'ordre de chargement redevient celui\n"
    + "  de la déclaration, et le plus petit chargé en premier est évincé sans un mot.");
  assert.ok(/await residents\(\)/.test(corps),
    "loadGeneratifs ne constate pas la résidence — l'ordre seul ne suffit pas, un essai sur trois échoue.");

  /* Et la mesure doit réchauffer chaque palier juste avant de le chronométrer. */
  const mes = readFileSync(new URL("./measure.ts", import.meta.url).pathname, "utf8");
  assert.ok(/await rechauffer\(tier\)/.test(mes),
    "measure.ts ne réchauffe pas le palier avant de le mesurer : son premier appel sera un\n"
    + "  rechargement, mesuré à cinq fois la médiane.");
  assert.ok(/residentAvantLaMesure/.test(mes),
    "la résidence n'entre pas dans la provenance : une durée sur modèle évincé et une durée sur\n"
    + "  modèle résident sont deux grandeurs, et rien ne les distinguerait dans le relevé.");

  /* La résidence appartient à la latence seule — l'exactitude n'en dépend pas, c'est mesuré. */
  const i = mes.indexOf("provenance[tier] = {");
  const bloc = mes.slice(i, i + 400);
  assert.ok(/accuracy: bloc,/.test(bloc),
    "le bloc d'exactitude ne doit pas porter la résidence : elle ne la concerne pas.");
  assert.ok(/latency:[^;]*residence/.test(bloc),
    "le bloc de latence ne porte pas la résidence.");
});

/*
 * Un document n'est entier que s'il porte tous ses champs.
 *
 * Sur un corpus qui mêle des cas à cinq champs et des cas ambigus à un seul, compter « entier »
 * comme « tous les champs enregistrés sont justes » a rendu douze dossiers entiers là où il y en
 * a un. Le chiffre était douze fois trop grand, et la conclusion qu'on en tirait — deux paliers
 * qui sauvent les mêmes documents — était l'inverse de la vraie : ils n'en partagent aucun.
 */
test("un cas à un seul champ ne compte pas comme un dossier entier", () => {
  const t = (caseId: string, champs: [string, Tentative["outcome"]][]): Tentative[] =>
    champs.map(([field, outcome]) => ({
      run: "r", tier: "gen-4b", field, caseId, phrasing: "reference", split: "hard-corpus",
      outcome, ms: 1, value: "", expected: "",
    }));

  const rows = [
    ...t("complet-juste", [["name", "clean"], ["birth", "clean"], ["document", "clean"],
      ["country", "clean"], ["address", "clean"]]),
    ...t("complet-rate", [["name", "clean"], ["birth", "wrong"], ["document", "clean"],
      ["country", "clean"], ["address", "clean"]]),
    ...t("ambigu", [["birth", "clean"]]),      // un seul champ déclaré
  ];

  const laxiste = parDocument(rows, { tier: "gen-4b" });
  assert.equal(laxiste.propres, 2, "sans exigence de champs, le cas à un champ passe pour entier");
  assert.equal(laxiste.melange, true,
    "le mélange de tailles de documents doit être signalé quand rien ne l'exclut");

  const strict = parDocument(rows, { tier: "gen-4b", champsRequis: 5 });
  assert.equal(strict.documents, 2, "seuls les documents à cinq champs sont comptés");
  assert.equal(strict.propres, 1, "un seul document sort entier");
  assert.equal(strict.ecartes, 1, "le document écarté est compté, pas passé sous silence");
  assert.deepEqual(strict.lesquels, ["complet-juste"]);
  assert.equal(strict.melange, false);

  /* Le taux par champ ne change pas : il porte sur toutes les tentatives, entières ou non. */
  assert.equal(laxiste.tauxChamp, strict.tauxChamp);
});

/*
 * Un signal doit battre un signal au hasard, sinon ce n'est pas un signal.
 *
 * Sans témoin, n'importe quelle séparation paraît impressionnante : sur un corpus où une valeur
 * sur deux est fausse, tirer au hasard donne déjà 50 % de précision. Ce test tient le témoin
 * lui-même — un signal qui n'a rien appris ne doit pas être déclaré vainqueur.
 */
test("le témoin négatif atteint le taux d'erreur de base, et un signal aveugle ne le bat pas", async () => {
  const { evaluerSignal } = await import("./signal.ts");
  const ligne = (i: number, faux: boolean) => ({
    run: "r", tier: "gen-4b", field: "name", caseId: `d${i}`, phrasing: "reference",
    split: "hard-corpus", outcome: (faux ? "wrong" : "clean") as Tentative["outcome"],
    ms: 1, value: `v${i}`, expected: "", faux,
  });
  /* Quatre cents valeurs, une sur quatre fausse. */
  const lignes = Array.from({ length: 400 }, (_, i) => ligne(i, i % 4 === 0));

  /* Un signal qui tire sans regarder : sa précision doit tomber sur le taux de base, 25 %. */
  const aveugle = evaluerSignal(lignes, "aveugle", "tire un cas sur cinq sans rien regarder",
    (t) => Number(t.caseId.slice(1)) % 5 === 1);
  assert.ok(Math.abs((aveugle.precision ?? 0) - 0.25) < 0.1,
    `un signal aveugle rend ${aveugle.precision} de précision au lieu du taux de base 0,25.`);
  assert.equal(aveugle.bat, false,
    "un signal qui ne regarde rien est déclaré meilleur que le hasard.");
  assert.ok(Math.abs(aveugle.temoin.precisionMoyenne - 0.25) < 0.06,
    `le témoin rend ${aveugle.temoin.precisionMoyenne} au lieu du taux de base 0,25.`);

  /* Un signal parfait doit le battre, et ne coûter aucune fausse alerte. */
  const parfait = evaluerSignal(lignes, "parfait", "tire exactement les fausses", (t) => t.outcome === "wrong");
  assert.equal(parfait.precision, 1);
  assert.equal(parfait.rappel, 1);
  assert.equal(parfait.faussesAlertes, 0, "un signal parfait n'envoie personne en relecture pour rien.");
  assert.equal(parfait.bat, true);

  /* Et un signal qui ne tire jamais ne doit pas passer pour parfait faute de contre-exemple. */
  const muet = evaluerSignal(lignes, "muet", "ne tire jamais", () => false);
  assert.equal(muet.declenche, 0);
  assert.equal(muet.precision, null, "un signal qui ne tire jamais n'a pas de précision de 100 %.");
  assert.equal(muet.bat, null);
});
