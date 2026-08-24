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
import { modulesEnRetard } from "./verifier-ecran.mjs";
import { TIERS, ENCODEURS, GENERATIFS } from "./tiers.ts";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issue, ouvrirJournal, lireJournal, apparie, parDocument, issues, desaccord, latences, accordEntreMachines } from "./journal.ts";
import { correct } from "./tiers.ts";
import { RELEVE_DE_REFERENCE } from "./measure.ts";
import { FIELDS, generateRecords, draw } from "./corpus.ts";

import type { Tentative } from "./journal.ts";
import { fileURLToPath } from "node:url";

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
  const dossier = fileURLToPath(new URL(".", import.meta.url));
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
  const dossier = fileURLToPath(new URL(".", import.meta.url));
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
/*
 * Les relevés publiés ici mais CALCULÉS AILLEURS. Un seul aujourd'hui, et l'ajout d'un
 * second doit se voir dans un diff : c'est le seul frein contre une issue qui s'élargit
 * jusqu'à ne plus rien retenir.
 */
const PRODUITS_HORS_DEPOT = new Set(["exposition.json"]);

test("aucun relevé livré ne cite un commit introuvable", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  /*
   * LA LISTE DES RELEVÉS SE DÉDUIT, ELLE NE SE RÉCITE PAS.
   *
   * Ce test ne regardait que `profiles-*.json`. Quatre autres relevés livrés portent un
   * commit — document.json, dur.json, mur.json, menace-historique.json — et aucun n'était
   * contrôlé. Un relevé neuf porteur d'un commit ne l'aurait pas été non plus, et son silence
   * serait passé pour un accord. On prend donc tout fichier JSON de la racine qui CITE un
   * commit, quel que soit son nom.
   */
  const citeUnCommit = (o: unknown): boolean => {
    if (o === null || typeof o !== "object") return false;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === "commit" && typeof v === "string" && /^[0-9a-f]{7,40}$/.test(v)) return true;
      if (citeUnCommit(v)) return true;
    }
    return false;
  };
  const releves = readdirSync(racine)
    .filter((n) => n.endsWith(".json") && !/^(package|package-lock|tsconfig)/.test(n))
    .filter((n) => { try { return citeUnCommit(JSON.parse(readFileSync(join(racine, n), "utf8"))); } catch { return false; } });
  assert.ok(releves.length >= 3, `${releves.length} relevé(s) trouvé(s) : la lecture a échoué.`);
  assert.ok(releves.some((n) => /^profiles-/.test(n)),
    "aucun relevé de profils n'a été trouvé : la déduction de la liste a échoué et ce cas ne vérifie rien.");

  const carte = (() => {
    const f = join(racine, "commits-reecrits.json");
    if (!existsSync(f)) return new Map<string, string>();
    const j = JSON.parse(readFileSync(f, "utf8")) as { entries: { missing: string; nowAt: string }[] };
    return new Map(j.entries.map((e) => [e.missing, e.nowAt]));
  })();

  /*
   * ATTEIGNABLE DEPUIS HEAD, PAS SEULEMENT EXISTANT.
   *
   * `git cat-file -e` répond oui pour tout objet encore présent dans ce dépôt — y compris un
   * commit que seule une branche de sauvegarde ou `refs/original` maintient en vie après une
   * réécriture d'historique. Ces objets-là N'EXISTENT PAS dans un clone : la poussée n'envoie
   * que ce qui est atteignable depuis la branche.
   *
   * Le test passait donc au vert ici et aurait échoué chez le lecteur — la pire forme du vert
   * vide, celle qui ne se voit que chez quelqu'un d'autre. Deux réécritures ont eu lieu le
   * 24 août 2026 et trois citations étaient orphelines sans que rien ne tombe.
   */
  const atteignable = (c: string) => {
    try { execFileSync("git", ["merge-base", "--is-ancestor", c, "HEAD"], { cwd: racine, stdio: "ignore" }); return true; }
    catch { return false; }
  };

  /*
   * LE TÉMOIN. Un commit qui EXISTE mais n'est pas ancêtre de HEAD doit être vu comme perdu ;
   * sinon la distinction ci-dessus n'est qu'une intention. Les branches de sauvegarde en
   * fournissent un quand il y en a ; sinon on ne conclut pas plutôt que de faire semblant.
   */
  const horsLigne = (() => {
    try {
      const b = execFileSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
        { cwd: racine, encoding: "utf8" }).split("\n").filter(Boolean);
      assert.ok(b.length > 0, "`b` est vide : la boucle qui suit ne vérifie rien.");
      for (const nom of b) {
        const h = execFileSync("git", ["rev-parse", nom], { cwd: racine, encoding: "utf8" }).trim();
        if (!atteignable(h)) return h;
      }
    } catch { /* pas de git : on ne conclut pas */ }
    return null;
  })();
  if (horsLigne) {
    assert.equal(atteignable(horsLigne), false,
      `${horsLigne} existe mais n'est pas dans l'historique de HEAD, et le contrôle le voit atteignable :\n`
      + "  il teste l'existence, pas l'atteignabilité, et laisserait passer une citation morte.");
  }

  let verifies = 0;
  const sansCommit: string[] = [];
  let horsDepotVus = 0;
  for (const n of releves) {
    const p = JSON.parse(readFileSync(join(racine, n), "utf8")) as {
      code?: { commit?: string; depot?: string };
      provenance?: Record<string, { accuracy?: { commit?: string }; latency?: { commit?: string } }>;
    };
    /*
     * UN COMMIT PRODUIT AILLEURS, ET LA SEULE FAÇON HONNÊTE DE LE DIRE.
     *
     * `exposition.json` porte le chiffre central du produit et il est publié ici — mais le
     * code qui le calcule vit dans le composant licencié, hors de ce dépôt. Son commit n'est
     * pas atteignable depuis HEAD, et il ne le sera jamais.
     *
     * Tant que ce relevé datait d'avant la séparation des dépôts, il citait un commit qui
     * existait ici par accident et cette garde se taisait. La première régénération correcte
     * l'a réveillée — elle avait raison : un commit introuvable ne prouve rien.
     *
     * L'issue est de NOMMER le dépôt, pas de lever le contrôle. Et elle est étroite à
     * dessein : le fichier doit être inscrit dans `PRODUITS_HORS_DEPOT` ET porter un
     * `code.depot` non vide. Une échappatoire ouverte à tous se serait refermée sur le
     * prochain relevé du banc qui aurait oublié son commit.
     */
    if (PRODUITS_HORS_DEPOT.has(n)) horsDepotVus++;
    const horsDepot = PRODUITS_HORS_DEPOT.has(n) ? (p.code?.depot ?? "").trim() : "";
    if (PRODUITS_HORS_DEPOT.has(n)) {
      assert.ok(horsDepot.length > 0,
        `${n} est inscrit comme produit hors de ce dépôt, mais ne nomme pas lequel dans « code.depot ».\n`
        + "  Sans ce nom, son commit n'est retrouvable nulle part, et le relevé ne se vérifie pas.");
    }
    const cites = new Set<string>();
    if (p.code?.commit) cites.add(p.code.commit);
    for (const v of Object.values(p.provenance ?? {})) {
      if (v.accuracy?.commit) cites.add(v.accuracy.commit);
      if (v.latency?.commit) cites.add(v.latency.commit);
    }
    if (cites.size === 0) sansCommit.push(n);
    for (const c of cites) {
      verifies++;
      if (atteignable(c)) continue;
      if (horsDepot) continue;   // produit ailleurs, et le relevé dit où : rien à chercher ici
      const vers = carte.get(c);
      assert.ok(vers,
        `${n} cite le commit ${c}, qui n'existe pas dans ce dépôt et n'est déclaré nulle part.\n`
        + `  → un lecteur ne peut pas extraire le code qui a produit ce chiffre,\n`
        + `    ce qui est la seule raison d'enregistrer un commit.\n`
        + `  → soit l'historique a été réécrit et commits-reecrits.json doit le dire,\n`
        + `    soit le relevé doit être refait sous un commit qui existe.`);
      assert.ok(atteignable(vers!),
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
  const src = readFileSync(fileURLToPath(new URL("./tiers.ts", import.meta.url)), "utf8");

  const f = src.slice(src.indexOf("export async function loadGeneratifs"));
  const corps = f.slice(0, f.indexOf("\n}\n") + 2);
  assert.ok(/sort\(/.test(corps) && /tailles?\(/.test(corps),
    "loadGeneratifs ne trie pas les modèles par taille : l'ordre de chargement redevient celui\n"
    + "  de la déclaration, et le plus petit chargé en premier est évincé sans un mot.");
  assert.ok(/await residents\(\)/.test(corps),
    "loadGeneratifs ne constate pas la résidence — l'ordre seul ne suffit pas, un essai sur trois échoue.");

  /* Et la mesure doit réchauffer chaque palier juste avant de le chronométrer. */
  const mes = readFileSync(fileURLToPath(new URL("./measure.ts", import.meta.url)), "utf8");
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
  assert.ok(Math.abs((aveugle.precision?.taux ?? 0) - 0.25) < 0.1,
    `un signal aveugle rend ${aveugle.precision?.taux} de précision au lieu du taux de base 0,25.`);
  /*
   * Le témoin est tiré au sort : comparer strictement un signal aveugle à sa moyenne tombe
   * une fois sur plusieurs, des deux côtés du seuil. Ce qu'on tient, c'est que l'écart soit
   * négligeable — un signal qui n'a rien appris ne doit pas s'en écarter de plus d'un point.
   */
  assert.ok(Math.abs((aveugle.precision?.taux ?? 0) - aveugle.temoin.precisionMoyenne) < 0.01,
    `un signal aveugle s'écarte de son témoin de ${(aveugle.precision?.taux ?? 0) - aveugle.temoin.precisionMoyenne}.`);
  assert.ok(Math.abs(aveugle.temoin.precisionMoyenne - 0.25) < 0.06,
    `le témoin rend ${aveugle.temoin.precisionMoyenne} au lieu du taux de base 0,25.`);

  /* Un signal parfait doit le battre, et ne coûter aucune fausse alerte. */
  const parfait = evaluerSignal(lignes, "parfait", "tire exactement les fausses", (t) => t.outcome === "wrong");
  /* Le taux, pas l'objet qui le porte : depuis que `signal.ts` publie ses bornes, un taux est
     un enregistrement — taux, bornes, n, rapportable — précisément pour qu'un taux nu ne soit
     plus exprimable. Le témoin s'écrit donc sur `.taux`. */
  assert.equal(parfait.precision?.taux, 1);
  assert.equal(parfait.rappel?.taux, 1);
  /* ET LA BORNE DOIT SUIVRE LE COMPTE : un signal parfait sur cent cas n'est pas un signal
     parfait sur mille, et c'est exactement ce que la borne dit à la place du taux seul. */
  assert.ok(parfait.precision!.bas > 0.9 && parfait.precision!.haut === 1,
    `un taux de 100 % sur n=${parfait.precision!.n} rend l'intervalle `
    + `[${parfait.precision!.bas}–${parfait.precision!.haut}] : la borne basse ne suit pas le compte.`);
  assert.ok(parfait.precision!.rapportable, "cent cas devraient suffire à publier un taux.");
  assert.equal(parfait.faussesAlertes, 0, "un signal parfait n'envoie personne en relecture pour rien.");
  assert.equal(parfait.bat, true);

  /* Et un signal qui ne tire jamais ne doit pas passer pour parfait faute de contre-exemple. */
  const muet = evaluerSignal(lignes, "muet", "ne tire jamais", () => false);
  assert.equal(muet.declenche, 0);
  assert.equal(muet.precision, null, "un signal qui ne tire jamais n'a pas de précision de 100 %.");
  assert.equal(muet.bat, null);
});

/*
 * Un banc dont le témoin bouge entre deux exécutions n'est pas reproductible.
 *
 * Le témoin aléatoire et le routeur au hasard tiraient sur `Math.random()`. Leurs chiffres
 * changeaient à chaque passe, et le test qui compare un signal aveugle à son témoin est tombé
 * une fois sur plusieurs — non parce qu'il était capricieux, mais parce que la mesure l'était.
 * Un chiffre publié qui ne se reproduit pas n'est pas un chiffre.
 */
test("les témoins aléatoires sont graines, pas tirés à chaque exécution", () => {
  /*
   * LE BALAYAGE, PAS DEUX NOMS.
   *
   * Cette garde ne regardait que `signal.ts` et `escalade.ts`. Un troisième module qui se
   * mettrait à tirer au hasard passerait sans un mot — et le mode de panne est asymétrique :
   * un fichier RENOMMÉ fait tomber la lecture, bruyamment ; un fichier AJOUTÉ ne fait rien,
   * la liste cesse simplement de couvrir et le vert reste vert.
   */
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const sources = readdirSync(dossier).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));
  assert.ok(sources.length >= 20,
    `${sources.length} source(s) balayée(s) : la lecture a échoué, ce test ne vérifie rien.`);

  /* SANS LES COMMENTAIRES. `corpus.ts` cite `Math.random()` dans la prose qui raconte
     pourquoi il ne s'en sert plus — et le motif l'accusait de le faire. Une règle qui accuse
     l'explication de son propre remède se fait retirer. Les retours à la ligne sont préservés,
     sinon les numéros de ligne d'un futur message seraient décalés. */
  const nu = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " " + "\n".repeat((m.match(/\n/g) ?? []).length))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
  const tireurs = sources.filter((n) => /Math\.random\(/.test(nu(readFileSync(join(dossier, n), "utf8"))));
  assert.deepEqual(tireurs, [],
    `module(s) tirant sur Math.random : ${tireurs.join(", ")}\n`
    + `  → leurs témoins ne se reproduisent pas d'une exécution à l'autre. Prendre un générateur\n`
    + `    graine, comme signal.ts et escalade.ts.`);

  /* Et ceux qui produisent de l'aléa doivent le prendre graine — vérifié sur ceux qui en ont. */
  const graines = sources.filter((n) => /\bdraw\(/.test(nu(readFileSync(join(dossier, n), "utf8"))));
  assert.ok(graines.length >= 2,
    `${graines.length} module(s) prennent un générateur graine : il y en avait au moins deux `
    + `(signal.ts, escalade.ts). Si l'un a disparu, dire pourquoi ; sinon la détection a échoué.`);

  /* Et la même graine doit rendre exactement la même suite. */
  const a = draw(20260821), b = draw(20260821);
  const suiteA = Array.from({ length: 8 }, () => a());
  const suiteB = Array.from({ length: 8 }, () => b());
  assert.deepEqual(suiteA, suiteB, "deux tirages de même graine divergent.");
  const c = draw(1);
  assert.notDeepEqual(Array.from({ length: 8 }, () => c()), suiteA,
    "deux graines différentes rendent la même suite : la graine ne fait rien.");
});

/*
 * Le dénominateur : combien de contrôles lisent un produit, sur combien examinés.
 *
 * Une suite entière braquée sur un fichier figé rend « tout passe » pendant qu'on édite la
 * source. Le recensement est fait ici plutôt que de mémoire, et il compte les deux termes —
 * un contrôle qui n'examine rien passe aussi.
 */
test("aucun contrôle ne lit un produit que rien ne vérifie avant lui", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const dossier = fileURLToPath(new URL(".", import.meta.url));

  /* Ce que le dépôt produit, et ce qui le vérifie avant que les tests le lisent. */
  const produits: Record<string, string | null> = {
    "landing.json": "node src/landing.ts --check, qui régénère en mémoire et compare le contenu",
    "README.md": "node src/readme.ts --check, qui compare bloc par bloc",
    "mesures-derivees.json": "perime(), qui arrête si un journal est plus récent",
  };
  /* Ceux-là sont des sources écrites à la main, pas des produits. */
  const sources = ["retractations.json", "commits-reecrits.json", "cas-ambigus.json"];

  const tests = readdirSync(dossier).filter((n) => n.endsWith(".test.ts"));
  let examines = 0, lisentUnProduit = 0;
  const nonCouverts: string[] = [];
  assert.ok(tests.length > 0, "`tests` est vide : la boucle qui suit ne vérifie rien.");
  for (const n of tests) {
    const src = readFileSync(join(dossier, n), "utf8");
    for (const fichier of [...Object.keys(produits), ...sources]) {
      if (!src.includes(fichier)) continue;
      examines++;
      if (fichier in produits) {
        lisentUnProduit++;
        if (produits[fichier] === null) nonCouverts.push(`${n} lit ${fichier}`);
      }
    }
  }

  assert.ok(examines >= 4, `${examines} lecture(s) recensée(s) : le recensement a échoué.`);
  assert.ok(lisentUnProduit >= 1,
    "aucun test ne lit un produit : soit c'est vrai, soit le recensement ne regarde pas les bons noms.");
  assert.deepEqual(nonCouverts, [],
    `des contrôles lisent un produit que rien ne vérifie avant eux :\n  ${nonCouverts.join("\n  ")}`);

  /* Et la chaîne doit réellement placer les deux vérifications avant les tests. */
  const chaine = JSON.parse(readFileSync(join(racine, "package.json"), "utf8")).scripts.test as string;
  assert.ok(chaine.indexOf("readme.ts --check") < chaine.indexOf("node --test"),
    "le contrôle du README passe après les tests : ils liraient un README non vérifié.");
  assert.ok(chaine.indexOf("landing.ts --check") < chaine.indexOf("node --test"),
    "le contrôle de landing.json passe après les tests : ils liraient un produit non vérifié.");
});

test("un produit plus ancien que sa source arrête le contrôle au lieu de l'avertir", async (t) => {
  const { perime, lireDerivees } = await import("./derivees.ts");
  const d = lireDerivees();
  if (!d) return t.skip("!d — ce cas n'a rien regardé, et il le dit.");

  const v = perime();
  assert.ok(typeof v.perime === "boolean" && v.raison.length > 20,
    "le verdict de péremption doit être rendu avec sa raison, pas seulement son booléen.");

  /* La garde est câblée dans le contrôle, et elle sort au lieu d'avertir. */
  const src = readFileSync(fileURLToPath(new URL("./landing.ts", import.meta.url)), "utf8");
  const i = src.indexOf("const age = perime();");
  assert.notEqual(i, -1, "le contrôle n'appelle pas la garde de péremption.");
  const bloc = src.slice(i, i + 200);
  assert.match(bloc, /process\.exit\(1\)/,
    "la garde avertit sans arrêter. Un avertissement dans une sortie qui défile n'existe pas.");
});

/*
 * Un clone doit lire le relevé dont les artefacts publiés ont été engendrés.
 *
 * Le repli choisissait « le plus récent par date ». Cela désignait
 * `profiles-2026-08-20-charge-8.json` — un relevé pris sous une charge fabriquée exprès et
 * conservé comme pièce à conviction. Un clone lisait donc d'autres latences que celles du README
 * et de `landing.json`, leurs blocs ne concordaient plus, et « quiconque clone reproduit les
 * chiffres ci-dessous » était faux.
 *
 * Ce test tient les deux moitiés : la référence nommée existe, et le tri par date aurait
 * désigné quelqu'un d'autre. Sans la seconde, le test resterait vert le jour où l'on revient
 * au tri — puisqu'il n'aurait rien à distinguer.
 */
test("le relevé de référence est nommé, et le tri par date aurait choisi un autre", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const livres = readdirSync(racine)
    .filter((n) => /^profiles-.*\.json$/.test(n))
    .map((n) => ({ n, p: JSON.parse(readFileSync(join(racine, n), "utf8")) as { measuredAt?: string } }))
    .filter((x) => Boolean(x.p.measuredAt))
    .sort((a, b) => b.p.measuredAt!.localeCompare(a.p.measuredAt!));

  assert.ok(livres.length >= 3, `${livres.length} relevé(s) livré(s) : la lecture a échoué.`);
  assert.ok(livres.some((x) => x.n === RELEVE_DE_REFERENCE),
    `${RELEVE_DE_REFERENCE} n'est pas livré : un clone n'aurait pas les chiffres publiés.`);

  assert.notEqual(livres[0]!.n, RELEVE_DE_REFERENCE,
    "le plus récent par date est aussi la référence nommée, donc ce test ne distingue plus rien.\n"
    + `  → si c'est devenu vrai, dire ici pourquoi la référence a changé ; sinon le tri par date\n`
    + `    est revenu et un clone lira ${livres[0]!.n}.`);

  /* Et la référence doit être celle prise machine au repos, pas celle prise sous charge. */
  assert.match(RELEVE_DE_REFERENCE, /coeur-rendu/,
    "la référence n'est plus le relevé au repos : les chiffres publiés changeraient de sens.");
  assert.match(livres[0]!.n, /charge/,
    "le plus récent n'est plus le relevé chargé — la raison d'être du nommage a changé, l'écrire.");
});

/*
 * La même donnée ne doit pas être lue à trois endroits.
 *
 * La décomposition blanc/faux était lue directement depuis `profil.sorties` dans trois
 * fonctions : le cache du solveur, la décomposition publiée, et la pondération des erreurs. Le
 * repli sur la table gelée a été ajouté au premier, et le contrôle de clone a mis un tour de
 * sept minutes à révéler chacun des deux autres. Ce test les empêche de repousser.
 */
test("les sorties brutes ne sont lues qu'à un seul endroit", () => {
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const fichiers = readdirSync(dossier).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));

  const lecteurs: string[] = [];
  assert.ok(fichiers.length > 0, "`fichiers` est vide : la boucle qui suit ne vérifie rien.");
  for (const n of fichiers) {
    const src = readFileSync(join(dossier, n), "utf8");
    /* Écrire les sorties est le travail de la mesure ; les *décomposer* est ce qui doit rester
       unique, et ça se reconnaît à ce qu'on regarde une sortie vide. */
    if (/\.sorties\[[^\]]*\][^\n]*trim\(\)\s*===\s*""/.test(src)) lecteurs.push(n);
  }
  assert.deepEqual(lecteurs, ["optimise.ts"],
    `la décomposition blanc/faux est lue dans ${lecteurs.length} fichier(s) : ${lecteurs.join(", ")}.\n`
    + `  → une seule doit la faire, sinon un repli ajouté à l'une manque les autres et la\n`
    + `    correction a l'air faite sans l'être. C'est arrivé deux fois de suite.`);

  /* Et rien ne doit court-circuiter la décomposition en testant `sorties` avant de l'appeler. */
  const opt = readFileSync(join(dossier, "optimise.ts"), "utf8");
  const i = opt.indexOf("export function justessePonderee");
  const corps = opt.slice(i, opt.indexOf("\n}\n", i));
  assert.ok(!/if\s*\(!profil\.sorties/.test(corps),
    "`justessePonderee` sort avant d'appeler la décomposition quand les sorties manquent :\n"
    + "  le repli sur la table gelée ne l'atteint pas, et les coûts d'erreur cessent de peser.");
});

test("aucun fichier suivi par git n'a disparu du disque", (t) => {
  /*
   * LE 24 AOÛT 2026, J'AI EFFACÉ src/rapport.test.ts SANS QUE RIEN NE TOMBE.
   *
   * Une commande d'assemblage contenait `mv src/rapport.test.ts src/rapport-licencie.test.ts`
   * — ce qui a déplacé le fichier DU BANC, pas la copie licenciée — et le nettoyage qui
   * suivait a effacé le fichier renommé. Dix cas perdus, dont tous les témoins d'attaque du
   * rapport signé.
   *
   * La suite est passée : 200 au lieu de 209. Le bloc du README s'est régénéré à 200, et son
   * contrôle a répondu « à jour ». UN CHIFFRE ENGENDRÉ QUI SUIT UNE RÉGRESSION LA REND
   * INVISIBLE — c'est le prix de tout compter depuis les sources, et il se paie une fois.
   *
   * La garde est précise plutôt que large : un fichier RETIRÉ VOLONTAIREMENT quitte aussi
   * l'index, donc ce cas ne se déclenche pas. Il ne parle que du fichier que git connaît
   * encore et que le disque n'a plus, c'est-à-dire d'un effacement que personne n'a décidé.
   */
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const git = spawnSync("git", ["ls-files", "-z", "src", "*.json", "*.md"],
    { cwd: racine, encoding: "utf8" });
  if (git.status !== 0) return t.skip("git.status !== 0 — ce cas n'a rien regardé, et il le dit.");   // pas un dépôt : on ne conclut pas

  const suivis: string[] = git.stdout.split("\0").filter(Boolean);
  assert.ok(suivis.length >= 20,
    `${suivis.length} fichier(s) suivi(s) : la lecture a échoué et ce cas ne vérifie rien.`);

  const disparus = suivis.filter((f) => !existsSync(join(racine, f)));
  assert.deepEqual(disparus, [],
    `fichier(s) suivi(s) par git et absent(s) du disque :\n`
    + disparus.map((f) => `  - ${f}`).join("\n") + "\n"
    + "  → soit ils ont été effacés par accident, soit leur retrait doit être commité.\n"
    + "    Tant qu'ils sont dans l'index et pas sur le disque, personne n'a décidé leur sort.");

  /* LE TÉMOIN. Un nom qui n'existe pas doit être vu comme disparu ; sinon `existsSync`
     pourrait répondre vrai partout et ce zéro ne vaudrait rien. */
  assert.equal(existsSync(join(racine, "src/ce-fichier-n-existe-pas.ts")), false,
    "existsSync répond vrai sur un fichier absent : ce contrôle ne vérifie rien.");
});

test("un cas qui ne regarde pas le DIT, il ne rend pas la main en silence", (t) => {
  /*
   * `if (!p) return t.skip("!p — ce cas n'a rien regardé, et il le dit.");` — pas de relevé, le cas sort, et le lanceur le compte comme PASSÉ.
   * Vingt-six cas faisaient ça sur la même condition : la suite aurait annoncé deux cent
   * onze réussites pendant qu'un quart d'entre eux n'avait rien regardé.
   *
   * Ils rendent `t.skip()` avec la raison maintenant, et le lanceur affiche un compte
   * d'ignorés. Ce cas-ci empêche le prochain retour muet d'entrer : un cas qui n'a pas
   * regardé ne doit jamais ressembler à un cas qui a regardé.
   *
   * Ce qui est autorisé : un retour APRÈS au moins une assertion — le cas a alors vérifié
   * quelque chose avant de s'arrêter, et son silence porte déjà sur un fait établi.
   */
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const fichiers = readdirSync(dossier).filter((n) => n.endsWith(".test.ts")).sort();
  assert.ok(fichiers.length >= 5, `${fichiers.length} fichier(s) de test : la lecture a échoué.`);

  const muets: string[] = [];
  let regardes = 0;
  for (const f of fichiers) {
    const src = readFileSync(join(dossier, f), "utf8");
    /* Les cas, découpés sur leurs accolades — une expression régulière s'arrêterait à la
       première accolade interne, et il y en a toujours une. */
    for (const m of src.matchAll(/^test\(\s*("(?:[^"\\]|\\.)*")/gm)) {
      let i = src.indexOf("{", m.index!), prof = 0, j = i;
      for (; j < src.length; j++) {
        if (src[j] === "{") prof++;
        else if (src[j] === "}") { prof--; if (prof === 0) break; }
      }
      const corps = src.slice(m.index!, j + 1);
      regardes++;
      /*
       * LA PROFONDEUR DES ACCOLADES DÉCIDE, PAS LE TEXTE.
       *
       * Un `return;` à l'intérieur d'une fonction imbriquée — le cas de base d'une récursion,
       * par exemple — n'est pas une sortie de test. Une conversion automatique en a pris un
       * pour tel et a fait IGNORER un cas entier : le contrôle censé rendre les silences
       * visibles en a fabriqué un.
       *
       * On ne regarde donc que les retours au niveau du corps du cas.
       */
      const ouvre = corps.indexOf("{");
      let niveau = 0, ret = -1;
      for (let k = ouvre; k < corps.length; k++) {
        if (corps[k] === "{") niveau++;
        else if (corps[k] === "}") niveau--;
        else if (niveau === 1 && corps.startsWith("return", k) && /^return\s*;/.test(corps.slice(k))) { ret = k; break; }
      }
      if (ret !== -1 && !/\bassert\b/.test(corps.slice(0, ret))) {
        muets.push(`${f}:${src.slice(0, m.index!).split("\n").length}  ${JSON.parse(m[1]!).slice(0, 60)}`);
      }
    }
  }
  assert.ok(regardes >= 50, `${regardes} cas analysés : le découpage a échoué et ce contrôle ne vérifie rien.`);
  assert.deepEqual(muets, [],
    `cas rendant la main sans avoir rien vérifié :\n${muets.map((x) => `  - ${x}`).join("\n")}\n`
    + "  → remplacez `return;` par `return t.skip(\"pourquoi\")`, et prenez `(t)` en paramètre.\n"
    + "    Le lanceur comptera un ignoré au lieu d'une réussite, et la perte se verra.");
});

test("les collections partagées ne sont pas vides, sinon dix cas s'évaporent", () => {
  /*
   * Une dizaine de cas portent leurs assertions DANS une boucle sur `FIELDS`, `TIERS` ou
   * `LIVRES`. Si l'une de ces constantes devenait vide — un champ retiré, un chargement de
   * corpus qui échoue en silence — ces cas passeraient en n'ayant rien exécuté, et la suite
   * annoncerait le même nombre de réussites qu'avant.
   *
   * Une borne par boucle aurait fait dix assertions identiques. Une seule ici les couvre
   * toutes, et elle dit ce qu'elle protège plutôt que de compter.
   */
  const collections: [string, readonly unknown[]][] = [
    ["FIELDS", FIELDS],
    ["TIERS", TIERS],
    ["ENCODEURS", ENCODEURS],
    ["GENERATIFS", GENERATIFS],
  ];
  const vides = collections.filter(([, c]) => c.length === 0).map(([n]) => n);
  assert.deepEqual(vides, [],
    `collection(s) partagée(s) vide(s) : ${vides.join(", ")}.\n`
    + "  → une dizaine de cas portent leurs assertions dans une boucle sur ces collections.\n"
    + "    Vides, ils passent sans rien exécuter et la suite annonce le même total qu'avant.");
  /* Et un plancher, parce que « non vide » se satisferait d'un seul élément là où les cas
     comparent des paliers entre eux. */
  assert.ok(FIELDS.length >= 3, `${FIELDS.length} champ(s) : trop peu pour que les cas qui comparent des champs veuillent dire quelque chose.`);
  assert.ok(TIERS.length >= 3, `${TIERS.length} palier(s) : trop peu pour que le routage soit un choix.`);
});

test("aucune sortie française sur les commandes déjà rendues à l'acheteur", () => {
  /*
   * LA DÉRIVE ÉTAIT SYSTÉMATIQUE, PAS UNE SÉRIE D'OUBLIS.
   *
   * Mesuré sur les commandes annoncées dans le README : 151 sorties en français sur 28
   * fichiers. Le chemin client, l'écran, la règle exportée, le questionnaire, le vérificateur
   * de rapport, deux documents engendrés — chacun trouvé séparément, tous la même cause.
   *
   * Ce cas garde ce qui a été rendu à l'acheteur, et COMPTE ce qui ne l'est pas encore. Une
   * garde qui ne protégerait que le fait accompli laisserait le reste invisible ; un chiffre
   * issu d'une sélection porte le compte de ce qu'il écarte.
   */
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  /** Les commandes dont la sortie a été rendue à l'acheteur, et qui ne doivent plus régresser. */
  const RENDUES = ["premiere-reponse.mjs", "verifier-rapport.mjs", "your-cases.ts", "server.ts",
    "intake.ts", "licences.ts", "menace.ts", "egress.ts", "entree.ts", "measure.ts", "signal.ts", "contrainte.ts", "diff.ts", "tentatives.ts", "mesurer-ocr.ts", "clone-neuf.mjs", "sensibilite-prompt.ts", "fuite.ts"];
  /*
   * UNE LISTE DE MOTS ATTRAPE LA PROSE, PAS LES ÉTIQUETTES.
   *
   * L'en-tête de tableau d'`abstention.ts` était entièrement en français — « règle · abst. ·
   * faux élim. · justes perdus · échange · livrées · précision livrée · coût » — et aucun de
   * ces mots n'est dans la liste ci-dessous. La garde ne l'a jamais vu, et n'aurait vu aucun
   * tableau du même genre. Or les étiquettes sont ce qu'un acheteur lit EN PREMIER dans une
   * sortie tabulaire.
   *
   * L'accent, lui, ne dépend d'aucun vocabulaire : une sortie anglaise n'en porte pas. Les
   * deux signaux ensemble couvrent la prose et les étiquettes.
   *
   * Un seul mot accentué survivait dans nos sorties anglaises : « relevé », notre propre
   * jargon. Plutôt que de lui ouvrir une exception — qui aurait servi de porte au suivant —
   * il a été traduit. Une règle sans exception se tient ; une règle avec une exception en
   * accumule.
   */
  const FRANCAIS = /\b(votre|vos|aucune?|n'est|n'a|qui|pour|dans|à la|ne se|données|refus|une|des|cette|celle|chaque|est |sont |avec |sans |déjà)\b|[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ]/i;

  /*
   * CE QUE CETTE EXTRACTION NE VOYAIT PAS, ET QUI COMPTAIT LE PLUS.
   *
   * Elle ne lisait que `console.*` ouvert par un guillemet double ou un gabarit. Donc ni les
   * `throw new Error`, ni les chaînes à apostrophes simples. `measure.ts` portait six refus
   * en français invisibles à cette garde, dont les quatre qui comptent le plus : relevé sans
   * empreinte, empreinte qui ne correspond plus, arbre sale, hôte distant. Un refus est
   * exactement ce qu'un lecteur voit au pire moment.
   *
   * Trouvé par la session qui traduisait, pas par la garde : mon compte de 151 sous-estimait
   * le travail, et le plafond n'aurait pas bougé pour un fichier qui n'a que des `throw`.
   */
  const sorties = (src: string) => [
    ...[...src.matchAll(/console\.(?:log|error|warn)\(\s*[`"']([^`"']{15,400})/g)].map((m) => m[1]!),
    ...[...src.matchAll(/throw new Error\(\s*[`"']([^`"']{15,400})/g)].map((m) => m[1]!),
  ];

  const fautifs: string[] = [];
  let examinees = 0;
  for (const f of RENDUES) {
    const p = join(dossier, f);
    if (!existsSync(p)) { fautifs.push(`${f} n'existe plus — la liste des commandes rendues est périmée`); continue; }
    examinees++;
    for (const t of sorties(readFileSync(p, "utf8"))) {
      if (FRANCAIS.test(t.replace(/\\n/g, " "))) fautifs.push(`${f} — « ${t.replace(/\s+/g, " ").slice(0, 56)} »`);
    }
  }
  assert.equal(examinees, RENDUES.length, "un fichier de la liste n'a pas été lu : ce cas vérifie moins qu'il n'annonce.");
  assert.deepEqual(fautifs, [],
    `sortie(s) en français sur une commande déjà rendue à l'acheteur :\n${fautifs.map((x) => `  - ${x}`).join("\n")}`);

  /* LE TÉMOIN : le motif doit reconnaître du français, sinon ce zéro ne vaut rien. */
  assert.ok(FRANCAIS.test("aucune valeur n'est refusée dans cette passe"),
    "le motif ne reconnaît plus le français : le zéro ci-dessus est sans valeur.");
  assert.ok(!FRANCAIS.test("no records were read from your file, and nothing was measured"),
    "le motif mord sur de l'anglais : il refuserait une sortie correcte.");

  /*
   * ET CE QUI RESTE, COMPTÉ PLUTÔT QUE TU. Le nombre baisse à mesure qu'on rend les
   * commandes ; le jour où il remonte, quelqu'un en a ajouté une en français.
   */
  const toutes = readdirSync(dossier).filter((n) => /\.(ts|mjs)$/.test(n) && !n.endsWith(".test.ts"));
  const restantes = toutes.filter((n) => !RENDUES.includes(n))
    .filter((n) => sorties(readFileSync(join(dossier, n), "utf8")).some((t) => FRANCAIS.test(t.replace(/\\n/g, " "))));
  /*
   * UN COMPTE DONT LA DÉFINITION CHANGE N'EST PAS LE MÊME COMPTE.
   *
   * Ce plafond était à 25 avec une extraction qui ne lisait que `console.*` en guillemets
   * doubles. Trois commandes ont été traduites, il est descendu à 22 — puis l'extraction a
   * été élargie aux `throw` et aux apostrophes simples, et il est remonté à 25. Ce n'est pas
   * une régression : ce sont trois fichiers qui parlaient déjà français et qu'on ne voyait
   * pas. Comparer les deux chiffres n'aurait aucun sens, et le prochain élargissement fera
   * pareil.
   */
  assert.ok(restantes.length <= 15,
    `${restantes.length} commande(s) parlent encore français : ${restantes.slice(0, 6).join(", ")}…\n`
    + "  → le compte ne doit que baisser. S'il monte, une commande neuve est arrivée en français.");
});

test("la page publiée porte le code du dépôt, pas celui d'un commit passé", (t) => {
  /*
   * `docs/` est la page de vente publiée. Elle embarque une copie compilée des modules du
   * dépôt, et RIEN dans `npm test` ne vérifiait qu'elle correspondait aux sources : six
   * documents engendrés sont contrôlés, celui-là non.
   *
   * Mesuré : `docs/js/optimise.js` et `docs/js/tiers.js` avaient plusieurs commits de retard —
   * 155 lignes d'écart. La page publiée faisait tourner du code d'avant la garde d'hôte
   * distant. Et personne ne pouvait la régénérer, parce que `pages.ts` lisait `data/`, qui
   * n'est pas versionné : la commande plantait sur ENOENT chez quiconque clone. Les deux
   * défauts se renforçaient — elle ne pouvait pas être refaite, donc elle pourrissait sans
   * bruit.
   *
   * Ce cas compare les empreintes plutôt que de recompiler : recompiler dans un test prendrait
   * des secondes et échouerait pour des raisons qui n'ont rien à voir avec la fraîcheur.
   */
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const js = join(racine, "docs", "js");
  if (!existsSync(js)) return t.skip("docs/js absent : il n'y a pas de page publiée dans cet arbre.");

  const compiles = readdirSync(js).filter((n) => n.endsWith(".js"));
  assert.ok(compiles.length >= 3, `${compiles.length} module(s) compilé(s) : la lecture a échoué.`);

  /*
   * UNE SEULE DÉFINITION DE LA FRAÎCHEUR, ET ELLE VIT DANS LA COMMANDE QUI PRONONCE.
   *
   * Cette boucle était écrite ici, et son commentaire disait qu'un compilé retouché à la main
   * est « attrapé ailleurs, par le contrôle d'écran ». Le contrôle d'écran n'en savait rien :
   * il ouvrait la page et regardait ce qui s'affichait, sans jamais demander si cette page
   * était celle du code d'aujourd'hui. Deux gardes qui se renvoient l'une à l'autre laissent
   * le trou entier, et chacune se croit couverte.
   *
   * Elle vit dans `verifier-ecran.mjs` maintenant — la commande qui dit « écran vérifié » —
   * et ce cas l'appelle. Une seule définition ne peut pas diverger d'elle-même.
   */
  const enRetard = modulesEnRetard(racine);
  assert.deepEqual(enRetard, [],
    `module(s) publié(s) plus vieux que leur source : ${enRetard.join(", ")}.\n`
    + "  → la page de vente fait tourner du code que le dépôt a déjà corrigé.\n"
    + "    Relancez `npm run pages`.");
});

test("l'intégration continue clone l'historique entier, sinon quatre cas tombent chez elle seule", () => {
  /*
   * `actions/checkout` clone à PROFONDEUR 1 par défaut : un seul commit. Or plusieurs cas de
   * cette suite interrogent l'historique — quel commit a introduit un choix de formulation,
   * si la notation d'un corpus a été committée AVANT la mesure qu'elle régit, si un relevé
   * livré cite un commit qui existe, si la galerie versionnée porte encore sa clé.
   *
   * Sur un clone tronqué ils tombent tous, et ils ont raison de tomber : l'historique n'est
   * pas là. CINQ PASSES ROUGES D'AFFILÉE, et le dépôt public portait une croix sur son dernier
   * commit pendant ce temps. Les cas n'étaient pas faux ; l'environnement l'était.
   *
   * Contre-épreuve faite dans les deux sens avant d'écrire ce cas : un clone `--depth 1` par
   * `file://` fait tomber exactement quatre cas, un clone complet n'en fait tomber aucun. Le
   * premier essai était vide — `git clone --depth 1 .` depuis un chemin local partage le
   * magasin d'objets et n'est pas tronqué du tout.
   */
  const f = fileURLToPath(new URL("../.github/workflows/verifier.yml", import.meta.url));
  if (!existsSync(f)) return t2skip();
  const y = readFileSync(f, "utf8");
  assert.match(y, /uses: actions\/checkout/, "la passe ne récupère plus le dépôt : ce cas ne vérifie rien.");
  assert.match(y, /fetch-depth:\s*0/,
    "l'intégration continue clone en profondeur 1 : les cas qui lisent l'historique tomberont\n"
    + "  chez elle et nulle part ailleurs, et personne ne saura pourquoi.");
});
function t2skip(): void { throw new Error(".github/workflows/verifier.yml est absent : la passe d'intégration continue a disparu."); }

test("le relevé qui porte la promesse la plus vendable voyage avec le dépôt", () => {
  /*
   * « Nothing leaves your machine » est l'argument le plus fort du README, et `npm run egress`
   * est la commande qui l'établit. Elle écrivait son relevé dans `data/`, que git ignore
   * délibérément parce qu'il porte les mesures faites sur les données d'un client. Ce
   * relevé-ci n'en contient aucune — des hôtes contactés et un verdict — mais il ne voyageait
   * pas. Un acheteur qui clone lisait la promesse et ne trouvait aucune preuve.
   *
   * « Un chiffre dérivé de quelque chose que git ne transporte pas » : ce dépôt l'a déjà payé
   * sept fois, et la huitième portait son meilleur argument.
   */
  const src = readFileSync(new URL("./egress.ts", import.meta.url), "utf8");
  const cible = /new URL\("\.\.\/([^"]+)", import\.meta\.url\)/.exec(
    src.slice(src.indexOf("const FICHIER")))?.[1];
  assert.ok(cible, "egress.ts ne dit plus où il écrit : ce cas ne vérifie rien.");
  assert.ok(!cible!.startsWith("data/"),
    `egress écrit dans « ${cible} », que git ignore. Le verdict qui porte la promesse la plus\n`
    + "  vendable du dépôt resterait sur la machine de l'auteur, et un acheteur qui clone\n"
    + "  lirait la promesse sans trouver la preuve.");

  /* ET IL DOIT ÊTRE IGNORÉ NULLE PART. Un fichier écrit à la racine mais couvert par une
     règle de .gitignore ne voyagerait pas davantage. */
  const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  const motifs = ignore.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const couvert = motifs.filter((m) => m === cible || m === `/${cible}` || (m.endsWith("/") && cible!.startsWith(m)));
  assert.deepEqual(couvert, [], `« ${cible} » est couvert par .gitignore : ${couvert.join(", ")}.`);
});

/*
 * ─── AUCUNE DEVISE NE S'ÉCRIT À LA MAIN ───
 *
 * `UNITS`, dans assumptions.ts, déclare la devise de chaque montant : `usd/year`,
 * `usd/1000 extractions`, `usd/period`. Elle fait autorité, et elle existait déjà.
 *
 * Trois rendus ne la lisaient pas et avaient tapé la leur. `escalade.ts` affichait
 * « €/1000 » sur trois lignes. `premiere-reponse.mjs` — la toute première sortie qu'un
 * acheteur voit d'un clone frais, avant toute installation — annonçait « EUR a year » : une
 * devise fausse et une période inventée, quatre mots, deux erreurs. Le README, lui, écrivait
 * « $ » : juste, et tapé aussi, donc juste par chance.
 *
 * Ce que ça coûtait : le prix de l'audit est en dollars, et le délai de retour vendu en
 * première page du rapport est exposition ÷ prix. Une exposition lue en euros contre un prix
 * en dollars fausse d'environ un dixième le seul chiffre qui justifie l'achat.
 *
 * ─── POURQUOI CE MOTIF-LÀ, ET PAS « EUR » ───
 *
 * Un motif de recherche est une affirmation. `EUR` seul affirme « ces trois lettres ne
 * paraissent que dans une devise » — faux dans un dépôt commenté en français :
 * DENOMINATEUR, CONTROLES_SERVEUR, PORTEUR, CHARGE_MAX_PAR_COEUR. Le témoin négatif ci-
 * dessous le prouve, parce qu'une règle qui hurle sur du texte innocent est désactivée dans
 * la semaine, et qu'une règle désactivée ne détecte plus rien.
 *
 * On ne regarde donc que ce qui est RENDU : l'intérieur des chaînes et des gabarits, et
 * seulement quand la devise touche un nombre ou une substitution.
 */
test("aucune source ne tape une devise à la main", () => {
  const dossier = fileURLToPath(new URL(".", import.meta.url));

  /* Une devise collée à un nombre, à une substitution `${…}`, ou à un séparateur d'unité.
     `\bEUR\b` et non `EUR` : la frontière de mot est ce qui laisse passer DENOMINATEUR. */
  const DEVISE_RENDUE = /[€£¥]|\bEUR\b|\bUSD\b|\$(?=[\s]*[\d$])/;
  /*
   * `"$1"` N'EST PAS UN PRIX : c'est un renvoi de capture, le second argument de `replace`.
   * Le motif l'attrapait, et une règle qui accuse `.replace(/x/, "$1")` d'annoncer un dollar
   * finit par être commentée. On écarte la forme exacte — `$` suivi d'un seul chiffre, rien
   * d'autre dans la chaîne — qui ne s'écrit jamais pour un montant dans ce dépôt.
   */
  const renvoiDeCapture = (c: string) => /^[\"'`]\$\d[\"'`]$/.test(c);
  /*
   * ON PARCOURT, ON N'EXPRIME PAS. La première version extrayait les chaînes par expression
   * régulière — et dans un dépôt commenté en français, chaque apostrophe de « L'UNITÉ » ou
   * « s'abstenant » ouvrait une chaîne fantôme qui courait jusqu'à la suivante. Elle a
   * rapporté cinq fautes qui n'existaient pas, sur cinq fichiers différents.
   *
   * Une règle qui rapporte du vent est commentée dans la semaine, et une règle commentée ne
   * détecte plus rien. Le faux positif coûte donc autant que l'oubli. Un seul parcours qui
   * sait où il est — chaîne, gabarit, commentaire — les supprime tous les deux.
   */
  const chaines = (src: string) => {
    const out: string[] = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i]!, d = src[i + 1];
      if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
      if (c === '"' || c === "'") {
        const debut = i; i++;
        while (i < src.length && src[i] !== c) { if (src[i] === "\\") i++; i++; }
        out.push(src.slice(debut, i + 1)); i++; continue;
      }
      /*
       * UN GABARIT S'IMBRIQUE, ET C'EST CE QUI A DÉSYNCHRONISÉ LA VERSION D'AVANT.
       *
       * `a ${ cond ? \`x\` : \`y\` } b` porte des accents graves À L'INTÉRIEUR de sa
       * substitution. Fermer au premier accent grave rencontré ferme au mauvais : la suite du
       * fichier est alors lue comme du code, le gabarit suivant rouvre à contretemps, et le
       * parcours rapporte des fragments de commentaires comme s'ils étaient rendus.
       *
       * Trouvé dans tiers.ts : trois substitutions imbriquées à la ligne 633 décalaient tout
       * jusqu'à la ligne 655, où un commentaire innocent ressortait en faute.
       *
       * On suit donc la profondeur des accolades de substitution, et on redescend dans
       * chaque chaîne qu'elles contiennent.
       */
      if (c === "`") {
        const debut = i; i++;
        let profondeur = 0;
        while (i < src.length) {
          const x = src[i]!;
          if (x === "\\") { i += 2; continue; }
          if (profondeur === 0 && x === "`") break;
          if (x === "$" && src[i + 1] === "{") { profondeur++; i += 2; continue; }
          if (profondeur > 0) {
            if (x === "{") profondeur++;
            else if (x === "}") profondeur--;
            else if (x === '"' || x === "'" || x === "`") {
              i++;
              while (i < src.length && src[i] !== x) { if (src[i] === "\\") i++; i++; }
            }
          }
          i++;
        }
        out.push(src.slice(debut, i + 1)); i++; continue;
      }
      i++;
    }
    return out;
  };

  /* Un fichier peut se déclarer exempt, mais il doit dire pourquoi sur la ligne même. */
  const EXEMPTS = new Map<string, string>([
    ["assumptions.ts", "c'est la table qui déclare les unités : elle est la source"],
    /*
     * LES SEUILS DE LA LOI SE CITENT, ILS NE SE DÉRIVENT PAS.
     *
     * `regulations.ts` porte « $5,000 » et « $10,000 » : les seuils de déclaration du Bank
     * Secrecy Act, cités mot pour mot avec leur référence. Ce sont des montants FIXÉS PAR UN
     * TEXTE, en dollars des États-Unis, et ils resteraient en dollars le jour où le corpus
     * d'un client se libellerait en euros. Les dériver de `UNITS` les rendrait faux : ce
     * n'est pas notre chiffre, et une citation qui change avec nos hypothèses n'est plus une
     * citation.
     */
    ["regulations.ts", "seuils cités d'un texte de loi, en dollars par la loi et non par nos hypothèses"],
  ]);

  const fautes: string[] = [];
  let lus = 0;
  for (const n of readdirSync(dossier)) {
    if (!/\.(ts|mjs)$/.test(n) || n.endsWith(".test.ts")) continue;
    if (EXEMPTS.has(n)) continue;
    lus++;
    const src = readFileSync(join(dossier, n), "utf8");
    for (const c of chaines(src)) {
      /* Les commentaires vivent hors des chaînes, donc ils ne sont pas lus ici — mais un
         gabarit peut contenir un commentaire de bloc. On ne l'exclut pas : une devise dans
         un gabarit finit rendue, commentée ou non. */
      if (!renvoiDeCapture(c) && DEVISE_RENDUE.test(c)) fautes.push(`${n} : ${c.slice(0, 72)}`);
    }
  }
  assert.ok(lus >= 40, `${lus} source(s) lue(s) : le balayage n'a pas eu lieu, son zéro ne vaut rien.`);
  assert.deepEqual(fautes, [],
    `${fautes.length} devise(s) tapée(s) à la main sur ${lus} sources lues.\n`
    + "  Lisez-la dans UNITS (assumptions.ts) ou dans le champ « unites » du relevé.\n"
    + `  ${fautes.join("\n  ")}`);
});

test("le détecteur de devise se déclenche, et se tait sur le français", () => {
  const DEVISE_RENDUE = /[€£¥]|\bEUR\b|\bUSD\b|\$(?=[\s]*[\d$])/;

  /* TÉMOINS POSITIFS — les quatre formes réellement trouvées dans ce dépôt. */
  for (const t of [
    "`  That routing costs ${nombre(x)} EUR a year to run.`",
    '"   k/doc  score>=  oracle   €/1000   ms moy"',
    "`  coût ≤ ${b.toFixed(2)} €/1000`",
    "`total exposure is $${Math.round(e)} a year`",
  ]) assert.ok(DEVISE_RENDUE.test(t), `témoin positif non détecté : ${t}`);

  /*
   * TÉMOINS NÉGATIFS — le français de ce dépôt, et les gabarits qui n'ont rien à voir.
   * Sans eux la règle attrape DENOMINATEUR, se met à hurler, et finit commentée.
   */
  /* Le renvoi de capture, écarté par la garde : la contre-épreuve de l'écart lui-même. */
  const renvoiDeCapture = (c: string) => /^["'`]\$\d["'`]$/.test(c);
  assert.ok(renvoiDeCapture('"$1"'), "« $1 » doit être reconnu comme un renvoi de capture.");
  assert.ok(!renvoiDeCapture('"$5,000"'), "un seuil légal n'est pas un renvoi de capture.");
  assert.ok(!renvoiDeCapture('"$12"'), "l'écart ne couvre qu'un seul chiffre, pas un montant.");
  assert.ok(DEVISE_RENDUE.test('"$5,000"'), "un seuil légal doit rester détecté par le motif.");

  for (const t of [
    '"Dénominateur : toute valeur notée par un palier"',
    '"CONTROLES_SERVEUR"', '"CHARGE_MAX_PAR_COEUR"', '"le PORTEUR celui qui manquait"',
    "`${nom.padEnd(34)} ${x.champsJustes}/150 champs`",
    "`écrit dans ${SORTIE}`",
  ]) assert.ok(!DEVISE_RENDUE.test(t), `faux positif : ${t}`);
});

/*
 * ─── UNE PROTECTION QUI N'EST PAS INSTALLÉE EST UNE INTENTION ───
 *
 * Les crochets de ce dépôt refusent deux choses qui ne se rattrapent pas : un commit dont
 * l'arbre de travail diffère de ce qui serait enregistré, et une poussée qui emporterait du
 * code licencié dans son historique. Ce dépôt est public ; une publication ne s'annule pas.
 *
 * Ils vivaient dans `.git/hooks`, que git ne transporte pas. Donc un clone neuf, une autre
 * machine, ou simplement un `git clone` fait pour vérifier quelque chose, n'avait AUCUNE de
 * ces deux protections — et rien ne le disait. La protection existait sur exactement une
 * machine, et personne n'aurait su laquelle.
 *
 * Ils sont versionnés maintenant, et `core.hooksPath` les désigne. Ce cas vérifie les deux :
 * le réglage ET le contenu. Le réglage seul laisserait passer un dossier vide.
 */
test("les crochets qui refusent sont versionnés, et installés", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));

  /*
   * `git config <clé>` SORT EN ERREUR quand la clé n'existe pas — il ne rend pas une chaîne
   * vide. Sans ce `catch`, le cas mourait sur l'exception de git et le lecteur voyait le
   * message de git, pas le mien : « Command failed », sans la ligne qui dit quoi taper.
   *
   * Trouvé en jouant la contre-épreuve, qui n'a rien affiché du tout là où j'attendais mon
   * refus. Le contrôle détectait bien ; c'est sa façon de le dire qui était cassée, et ce cas
   * de figure — la garde juste au message inutilisable — est le troisième en deux jours.
   */
  const chemin = (() => {
    try {
      return execFileSync("git", ["config", "core.hooksPath"],
        { cwd: racine, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { return ""; }
  })();
  assert.equal(chemin, ".githooks",
    `core.hooksPath vaut « ${chemin} » : les crochets de ce dépôt ne sont pas ceux qui tournent.\n`
    + "  → git config core.hooksPath .githooks");

  /* Le contenu, pas seulement la présence : un fichier vide passerait le contrôle ci-dessus. */
  const attendus: Record<string, RegExp> = {
    "pre-push": /LICENCIE|cascade-licencie/,
    "pre-commit": /git diff --name-only|MODIFICATION NON INDEXÉE/,
  };
  const manquants: string[] = [];
  for (const [nom, motif] of Object.entries(attendus)) {
    const p = join(racine, ".githooks", nom);
    if (!existsSync(p)) { manquants.push(`${nom} (absent)`); continue; }
    if (!motif.test(readFileSync(p, "utf8"))) manquants.push(`${nom} (ne porte plus son refus)`);
    /* Un crochet non exécutable est ignoré par git EN SILENCE — le pire des trois états. */
    if ((statSync(p).mode & 0o111) === 0) manquants.push(`${nom} (non exécutable : git l'ignore sans rien dire)`);
  }
  assert.deepEqual(manquants, [],
    `crochet(s) inutilisable(s) : ${manquants.join(", ")}.\n`
    + "  → un dépôt public sans son refus de poussée n'a que l'intention de ne pas se tromper.");
});
