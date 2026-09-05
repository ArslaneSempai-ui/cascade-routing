/**
 * LE PALIER HUMAIN MESURÉ, ÉPROUVÉ — SUR CE QU'IL PROMET, PAS SUR SES MOYENNES.
 *
 * Trois promesses portent tout : le taux vient du MÊME juge que les paliers machines, le
 * relevé émis ne contient AUCUNE valeur du fichier du client, et l'hypothèse ne cède la
 * place qu'à une mesure scellée et suffisante. Chaque cas ci-dessous en éprouve une, et
 * chacun porte sa contre-épreuve : un vert qui ne peut pas rougir ne prouve rien.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lireRelectures, mesurer, verdictDe, mesurerSecondes, lireMesureHumaine,
  COLONNES_REQUISES, type MesureHumaine } from "./humans.ts";
import { ENOUGH } from "./interval.ts";
import { empreinteDuReleve } from "./measure.ts";

/* Chemins RÉSOLUS : la garde isMain compare des chemins résolus, et /var n'est pas
   /private/var — un chemin non résolu lance un processus qui ne fait RIEN et sort en 0. */
const CMD_HUMANS = realpathSync(fileURLToPath(new URL("./humans.ts", import.meta.url)));
const CMD_OPTIMISE = realpathSync(fileURLToPath(new URL("./optimise.ts", import.meta.url)));

const ENTETE = "id,field,truth,reviewer1,reviewer2,started,finished";

function mesureDe(csv: string): MesureHumaine {
  const { lignes } = lireRelectures(csv);
  return mesurer(lignes, "essai.csv", "0".repeat(64), "2026-09-05");
}

/** Un CSV d'au moins ENOUGH cas, aux justesses choisies. */
function grosCsv(propres: number, faux: number): string {
  const l = [ENTETE];
  for (let i = 1; i <= propres; i++) l.push(`${i},name,V${i},V${i},,,`);
  for (let i = 0; i < faux; i++) l.push(`${propres + 1 + i},name,V,PAS-V,,,`);
  return l.join("\n") + "\n";
}

test("le taux du palier vient des verdicts, champ par champ et en tout", () => {
  const m = mesureDe([ENTETE,
    "1,name,Anna,Anna,,,",          // clean
    "2,name,Marc,Mark,,,",          // wrong
    "3,birth,3 May 1990,3 May 1990,,,",  // clean
    "4,birth,7 Aug 1979,,,,",       // blank : ne compte NI propre NI faux, mais compte dans n
  ].join("\n"));
  assert.deepEqual(
    [m.parChamp["name"]!.propres, m.parChamp["name"]!.faux, m.parChamp["name"]!.n],
    [1, 1, 2]);
  assert.deepEqual(
    [m.parChamp["birth"]!.propres, m.parChamp["birth"]!.vides, m.parChamp["birth"]!.n],
    [1, 1, 2]);
  assert.deepEqual([m.global.propres, m.global.faux, m.global.vides, m.global.n], [2, 1, 1, 4]);
  assert.equal(m.global.taux, 0.5, "un vide n'est pas un propre : il pèse dans n sans réussir");

  /* CONTRE-ÉPREUVE : le juge est celui des paliers machines, normalisation comprise — une
     casse différente est PROPRE ici comme elle l'est pour un modèle, sinon les deux taux ne
     se comparent pas et le tableau ment par construction. */
  assert.equal(verdictDe({ id: "x", champ: "name", verite: "Anna Petrova", lecture1: "anna petrova" }), "clean");
  assert.equal(verdictDe({ id: "x", champ: "name", verite: "Anna Petrova", lecture1: "Marc" }), "wrong");
});

test("un en-tête faux est refusé en nommant ce qui manque et ce qu'on accepte", () => {
  assert.throws(() => lireRelectures("id,field,truth\n1,name,Anna"), (e: Error) => {
    assert.match(e.message, /"reviewer1"/);
    assert.match(e.message, new RegExp(COLONNES_REQUISES.join(", ")));
    return true;
  });
  assert.throws(() => lireRelectures(ENTETE + ",note\n"), (e: Error) => {
    assert.match(e.message, /"note"/, "la colonne inconnue est nommée");
    assert.match(e.message, /dropped in\n\s+silence/, "et le refus dit pourquoi on ne la laisse pas passer");
    return true;
  });
  /* CONTRE-ÉPREUVE : le même en-tête dans un autre ORDRE passe — les noms décident, pas la
     position, sinon la garde refuserait des fichiers légitimes et se ferait retirer. */
  assert.doesNotThrow(() => lireRelectures("truth,id,reviewer1,field\nAnna,1,Anna,name"));
});

test("une cellule de champ vide est refusée : un verdict doit atterrir sous un champ", () => {
  assert.throws(() => lireRelectures(ENTETE + "\n1,,Anna,Anna,,,"), /empty "field"/);
  assert.throws(() => lireRelectures(ENTETE + "\n,name,Anna,Anna,,,"), /empty "id"/,
    "un id vide entrerait en collision avec un autre dans les clés de verdicts, sans un mot");
});

test("LE FICHIER NATUREL — un dossier, cinq lignes, un même id — est mesuré, pas refusé", () => {
  /*
   * TROUVÉ PAR LA RELECTURE ADVERSE DU LOT, pas par cette suite : l'aide dit « id names the
   * case, field names what was reviewed », donc le client dont les relecteurs ont vérifié les
   * cinq champs du dossier 417 écrit cinq lignes `417,…`. C'était l'usage CENTRAL du format
   * documenté, et il sortait en erreur — la garde d'unicité du lecteur hérité comptait les
   * documents, avec les mots d'un autre outil. Aucun des dix cas d'alors n'avait deux lignes
   * sous le même id : le témoin couvrait le voisinage du format, jamais son centre.
   */
  const m = mesureDe([ENTETE,
    "417,name,Anna Petrova,Anna Petrova,,,",
    "417,birth,3 May 1990,3 May 1990,,,",
    "417,document,ES-1234-A,ES-1234-B,,,",
    "418,name,Marc Dupont,Marc Dupont,,,",
  ].join("\n"));
  assert.equal(m.global.n, 4);
  assert.equal(m.verdicts["name"]!["417"], "clean");
  assert.equal(m.verdicts["document"]!["417"], "wrong",
    "les verdicts d'un même dossier restent sous leur champ, jamais fondus");

  /* LA VRAIE CLÉ EST (id, champ) : la même relecture DEUX FOIS compterait deux fois dans le
     taux. Le refus la nomme, avec les mots d'ici — une relecture, pas « your pipeline ». */
  assert.throws(() => mesureDe([ENTETE,
    "417,name,Anna,Anna,,,",
    "417,name,Anna,Petrova,,,",
  ].join("\n")), (e: Error) => {
    assert.match(e.message, /\("417", "name"\) × 2/);
    assert.match(e.message, /same review twice/);
    assert.match(e.message, /MAY share an id/, "le refus dit aussi ce qui est PERMIS, sinon il ré-enseigne le défaut d'avant");
    return true;
  });
});

test("le relevé émis ne porte AUCUNE valeur du fichier, et le détecteur sait le voir", () => {
  const SENTINELLES = ["SECRET-VERITE-A", "SECRET-LECTURE-B", "SECRET-ACCORD-C", "2029-12-31T23:59:59Z"];
  const m = mesureDe([ENTETE,
    `77,name,${SENTINELLES[0]},${SENTINELLES[1]},${SENTINELLES[2]},${SENTINELLES[3]},${SENTINELLES[3]}`,
  ].join("\n"));
  const emis = JSON.stringify(m);
  for (const s of SENTINELLES) {
    assert.ok(!emis.includes(s),
      `« ${s} » sort du fichier du client vers le relevé : la promesse « verdicts, jamais une `
      + "valeur » vient de devenir fausse.");
  }
  /* CONTRE-ÉPREUVE : la recherche ci-dessus doit savoir trouver. Un relevé fabriqué qui
     FUIT la valeur est vu — sinon les quatre verts du dessus diraient seulement que
     `includes` rend false sur tout. */
  assert.ok(JSON.stringify({ fuite: SENTINELLES[0] }).includes(SENTINELLES[0]!));
  /* Et ce qui doit rester est là : le verdict — « wrong », la lecture ne valant pas la
     vérité — sous le champ, sous l'identifiant. C'est tout ce que le relevé sait dire. */
  assert.equal(m.verdicts["name"]!["77"], "wrong");
});

test("l'accord se mesure sur les lignes à deux lectures, et son dénominateur voyage", () => {
  const m = mesureDe([ENTETE,
    "1,name,Anna,Anna,Anna,,",      // accord
    "2,name,Marc,Marc,Mark,,",      // désaccord
    "3,name,Li,Li,,,",              // une seule lecture : hors du dénominateur
  ].join("\n"));
  assert.deepEqual([m.accord!.propres, m.accord!.n, m.accord!.surLignes], [1, 2, 2]);

  /* L'ABSENCE EST NOMMÉE, PAS CHIFFRÉE : sans seconde lecture, `accord` est null — un zéro
     ici se lirait comme « ils ne sont jamais d'accord », le contraire d'une absence. */
  assert.equal(mesureDe([ENTETE, "1,name,Anna,Anna,,,"].join("\n")).accord, null);
});

test("les secondes : médiane retenue, l'illisible et le négatif comptés plutôt que tus", () => {
  const s = mesurerSecondes([
    { id: "1", champ: "n", verite: "", lecture1: "", debut: "2026-09-01T10:00:00Z", fin: "2026-09-01T10:00:30Z" },
    { id: "2", champ: "n", verite: "", lecture1: "", debut: "2026-09-01T10:01:00Z", fin: "2026-09-01T10:01:40Z" },
    { id: "3", champ: "n", verite: "", lecture1: "", debut: "2026-09-01T10:02:00Z", fin: "2026-09-01T10:03:40Z" },
    { id: "4", champ: "n", verite: "", lecture1: "", debut: "pas-une-date", fin: "2026-09-01T10:04:00Z" },
    { id: "5", champ: "n", verite: "", lecture1: "", debut: "2026-09-01T10:06:00Z", fin: "2026-09-01T10:05:00Z" },
  ])!;
  assert.deepEqual([s.n, s.illisibles, s.negatives], [3, 1, 1]);
  assert.equal(s.mediane, 40, "la médiane, pas la moyenne : un dossier resté ouvert la tirerait hors de sens");
  assert.ok(Math.abs(s.moyenne - (30 + 40 + 100) / 3) < 1e-9);
  /* Sans horodatage du tout : null — l'hypothèse reste, et reste DITE hypothèse. */
  assert.equal(mesurerSecondes([{ id: "1", champ: "n", verite: "", lecture1: "" }]), null);
});

test("le scellé se vérifie, un relevé retouché est refusé avec les deux empreintes", () => {
  const d = mkdtempSync(join(tmpdir(), "cascade-humains-"));
  const m = mesureDe(grosCsv(ENOUGH, 2));
  m.empreinte = empreinteDuReleve(m);
  const chemin = join(d, "mesure.json");
  writeFileSync(chemin, JSON.stringify(m));
  assert.equal(lireMesureHumaine(chemin).global.n, ENOUGH + 2);

  const retouche = { ...m, global: { ...m.global, taux: 0.99 } };
  writeFileSync(chemin, JSON.stringify(retouche));
  assert.throws(() => lireMesureHumaine(chemin), (e: Error) => {
    assert.match(e.message, /no longer matches its seal/);
    assert.match(e.message, new RegExp(m.empreinte!), "l'empreinte enregistrée est citée");
    return true;
  });

  const { empreinte: _, ...sansScelle } = m;
  writeFileSync(chemin, JSON.stringify(sansScelle));
  assert.throws(() => lireMesureHumaine(chemin), /carries no seal/);
});

test(`sous ${ENOUGH} cas, le branchement refuse — remplacer une hypothèse par si peu serait pire`, () => {
  const d = mkdtempSync(join(tmpdir(), "cascade-humains-"));
  const peu = mesureDe([ENTETE, "1,name,Anna,Anna,,,"].join("\n"));
  peu.empreinte = empreinteDuReleve(peu);
  const chemin = join(d, "peu.json");
  writeFileSync(chemin, JSON.stringify(peu));
  assert.throws(() => lireMesureHumaine(chemin), (e: Error) => {
    assert.match(e.message, /1 case\(s\), below 20/);
    assert.match(e.message, /worse than the/, "le refus dit pourquoi, pas seulement non");
    return true;
  });
  /* CONTRE-ÉPREUVE dans le cas du scellé ci-dessus : ENOUGH + 2 cas passent. Une garde qui
     refuserait tout rendrait ce refus-ci indiscernable d'un juge cassé. */
});

test("la commande écrit les deux fichiers À CÔTÉ du CSV, et nulle part ailleurs", () => {
  const d = mkdtempSync(join(tmpdir(), "cascade-humains-"));
  const csv = join(d, "relus.csv");
  writeFileSync(csv, grosCsv(ENOUGH, 2));
  const r = spawnSync(process.execPath, [CMD_HUMANS, `--cases=${csv}`],
    { encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, `la commande a échoué :\n${r.stderr}`);
  assert.ok(existsSync(join(d, "relus-humans-measured.md")), "le rapport n'est pas à côté du fichier");
  const releve = JSON.parse(readFileSync(join(d, "relus-humans-measured.json"), "utf8")) as MesureHumaine;
  assert.equal(empreinteDuReleve(releve), releve.empreinte, "le relevé écrit n'est pas scellé");
  assert.match(r.stdout, /Plug it in: npm run optimise -- --humans=/,
    "la sortie ne dit pas le geste suivant : un relevé qu'on ne sait pas brancher ne sert à rien");

  /* Sans --cases : l'aide, avec le format — pas un plantage, pas un fichier écrit. */
  const aide = spawnSync(process.execPath, [CMD_HUMANS], { encoding: "utf8", timeout: 60_000 });
  assert.equal(aide.status, 0);
  assert.match(aide.stdout, /id,field,truth,reviewer1/);
  /* Un drapeau inconnu SORT EN 2 : ignoré, il répondrait à une autre question. */
  assert.equal(spawnSync(process.execPath, [CMD_HUMANS, "--case=x"],
    { encoding: "utf8", timeout: 60_000 }).status, 2);

  /* UN REFUS EST UN MESSAGE, PAS UNE TRACE DE PILE : la pile se lit comme un plantage, et
     un client qui lit un plantage n'obéit pas au message — il ouvre un ticket. */
  const mauvais = join(d, "mauvais.csv");
  writeFileSync(mauvais, "id,field,truth\n1,name,Anna\n");
  const refus = spawnSync(process.execPath, [CMD_HUMANS, `--cases=${mauvais}`],
    { encoding: "utf8", timeout: 60_000 });
  assert.equal(refus.status, 1, "un CSV refusé doit sortir en 1, pas en 0 ni en plantage");
  assert.match(refus.stderr, /reviewer1/, "le refus nomme ce qui manque");
  assert.doesNotMatch(refus.stderr, /at .*humans\.ts|throw new Error/,
    "la trace de pile part chez le client : il lira un crash, pas un refus.");
});

test("« assumed » devient « measured » avec le drapeau, et redevient vrai sans lui", () => {
  const d = mkdtempSync(join(tmpdir(), "cascade-humains-"));
  const m = mesureDe(grosCsv(ENOUGH + 5, 5));
  m.empreinte = empreinteDuReleve(m);
  const chemin = join(d, "mesure.json");
  writeFileSync(chemin, JSON.stringify(m));

  /* TÉMOIN AU POINT D'APPEL : c'est la COMMANDE qu'on éprouve, celle qui imprime la ligne
     qu'un lecteur lira, pas une réécriture de sa règle. */
  const avec = spawnSync(process.execPath, [CMD_OPTIMISE, `--humans=${chemin}`],
    { encoding: "utf8", timeout: 120_000 });
  assert.equal(avec.status, 0, `optimise --humans a échoué :\n${avec.stderr}`);
  assert.match(avec.stdout, /human accuracy measured at 83\.3 % on 30 case\(s\)/);
  assert.doesNotMatch(avec.stdout, /assumed at .* this is not a measurement/,
    "les deux phrases à la fois : le lecteur ne sait plus laquelle croire");

  const sans = spawnSync(process.execPath, [CMD_OPTIMISE], { encoding: "utf8", timeout: 120_000 });
  assert.equal(sans.status, 0, `optimise sans drapeau a échoué :\n${sans.stderr}`);
  assert.match(sans.stdout, /human accuracy assumed at 85\.0 % — this is not a measurement/,
    "sans le drapeau, l'hypothèse reste ET reste dite hypothèse — c'est la moitié qui empêche "
    + "un « measured » de déteindre sur les exécutions ordinaires");
});
