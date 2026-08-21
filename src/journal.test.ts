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
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issue, lireJournal, apparie, parDocument, issues } from "./journal.ts";
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
