/**
 * The human tier, measured — when you have measured it.
 *
 * One cell of this repository is not a measurement and every page says so: the human
 * reviewer, assumed right 85 % of the time. That is the honest position when nothing better
 * exists, and it stops being honest the day your own reviewed files exist and the page still
 * shows an assumption.
 *
 * This command reads a CSV of cases your reviewers have already worked — their answer next
 * to the adjudicated truth — and measures what the assumption stands in for: how often the
 * human tier is right, per field and overall, with the same intervals and the same scorer as
 * every machine tier here. Nothing about your file leaves the machine; there is no network
 * call anywhere in this path.
 *
 * ─── The file it wants ───
 *
 *     id,field,truth,reviewer1,reviewer2,started,finished
 *     417,name,Anna Petrova,Anna Petrova,Anna Petrova,2026-09-01T09:14:02Z,2026-09-01T09:14:48Z
 *
 * `id, field, truth, reviewer1` are required; the other three are optional, and each one you
 * supply buys a measurement: a second reading measures inter-reviewer agreement, the two
 * timestamps measure seconds per case — the figure `humanSeconds: 45` assumes today.
 *
 * ─── What it will not do ───
 *
 * It measures THE TIER, aggregated. There is no per-person output, pseudonymous or not:
 * `reviewer1` and `reviewer2` are positions in your process, not people, and the report
 * cannot be read as a scorecard of anyone. That is what makes it usable inside a bank.
 *
 * And the relevé it writes carries VERDICTS, never values: no truth, no answer, no timestamp
 * from your file survives into the output. Grade travels; data does not.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { lireCsv, cellule, apercu, MONTRES } from "./your-cases.ts";
import { rate, cellulesDeTaux, ENOUGH, CONFIANCE, type Rate } from "./interval.ts";
import { correct } from "./tiers.ts";
import { empreinteDuReleve } from "./measure.ts";
import { table } from "./figures.ts";

/* Les quatre colonnes sans lesquelles rien ne se mesure, et les trois qui achètent chacune
   une mesure de plus. LES NOMS DÉCIDENT, jamais la position : c'est la règle que
   `your-cases.ts` a payée trois cas hostiles pour apprendre. */
export const COLONNES_REQUISES = ["id", "field", "truth", "reviewer1"] as const;
export const COLONNES_OPTIONNELLES = ["reviewer2", "started", "finished"] as const;

export type LigneRelue = {
  id: string; champ: string; verite: string; lecture1: string;
  lecture2?: string; debut?: string; fin?: string;
};

/**
 * Le CSV du client, lu par le lecteur ÉPROUVÉ de `your-cases.ts` plutôt que par un second.
 *
 * Deux automates CSV dans un même dépôt divergent — c'est la famille « une seconde copie,
 * écrite à la main, de ce qu'un autre mécanisme détermine ». Celui de `your-cases.ts` a payé
 * ses défauts un par un : le guillemet jamais refermé qui avale la moitié du fichier, la
 * cellule d'un mégaoctet, l'en-tête en double, le numéro de ligne décalé par un texte cité.
 * On ne les repaie pas.
 *
 * Son contrat d'en-tête nomme le texte d'entrée `text` ; ici la deuxième colonne porte un
 * NOM DE CHAMP, pas un document. L'adaptation tient en une ligne — l'en-tête validé est
 * réécrit `field` → `text` avant la lecture — et elle ne touche pas au corps du fichier,
 * donc chaque refus du lecteur nomme encore la vraie ligne du vrai fichier.
 */
export function lireRelectures(texte: string): { lignes: LigneRelue[]; avertissements: string[] } {
  const finEntete = texte.search(/\r?\n/);
  const brutEntete = (finEntete === -1 ? texte : texte.slice(0, finEntete));
  const noms = brutEntete.split(",").map((x) => x.trim().replace(/^﻿/, "").replace(/^"|"$/g, ""));

  const connues = new Set<string>([...COLONNES_REQUISES, ...COLONNES_OPTIONNELLES]);
  const inconnues = noms.filter((n) => !connues.has(n));
  if (inconnues.length > 0) {
    throw new Error(
      `Your header carries ${inconnues.length} column(s) this command does not know: `
      + `${apercu(inconnues.map((n) => `"${n}"`), MONTRES)}.\n`
      + `  Accepted: ${[...COLONNES_REQUISES].join(", ")} — then, optionally: `
      + `${[...COLONNES_OPTIONNELLES].join(", ")}.\n`
      + `  Left as they were, unknown columns would be read as something else or dropped in\n`
      + `  silence, and the rate would answer a different question than the one you asked.`);
  }
  const manquantes = COLONNES_REQUISES.filter((n) => !noms.includes(n));
  if (manquantes.length > 0) {
    throw new Error(
      `Your header is missing ${manquantes.map((n) => `"${n}"`).join(", ")}.\n`
      + `  The four required columns are: ${[...COLONNES_REQUISES].join(", ")}.\n`
      + `  id names the case, field names what was reviewed, truth is the adjudicated\n`
      + `  answer, reviewer1 is what your reviewer wrote. Optional, each buying a\n`
      + `  measurement: reviewer2 (agreement), started and finished (seconds per case,\n`
      + `  ISO 8601).`);
  }

  /*
   * `id` EST RENOMMÉ AUSSI, ET C'EST LA TROUVAILLE D'UNE RELECTURE ADVERSE. Le lecteur hérité
   * exige un identifiant UNIQUE par ligne — chez lui une ligne est un document, et un doublon
   * compte un document deux fois. Ici une ligne est UN CHAMP d'un dossier : le fichier
   * NATUREL du format documenté ci-dessus porte cinq lignes `417,…`, une par champ relu, et
   * il était refusé avec le vocabulaire d'un autre outil (« your pipeline », « one document
   * twice »). Aucun des cas d'alors n'avait deux lignes sous le même id — le témoin couvrait
   * le voisinage du format, pas son centre. L'identifiant voyage donc comme un champ, le
   * lecteur fabrique ses propres clés de ligne, et la VRAIE clé d'unicité — (id, champ) —
   * est tenue ici, avec les mots d'ici.
   */
  const entete = noms.map((n) => (n === "field" ? "text" : n === "id" ? "casid" : n)).join(",");
  const l = lireCsv(entete + texte.slice(finEntete === -1 ? texte.length : finEntete));

  const avertissements: string[] = [];
  if (l.ecartees.length) avertissements.push(
    `${l.ecartees.length} row(s) carried more cells than the header and were discarded: `
    + `line(s) ${l.ecartees.slice(0, 8).map((e) => e.ligne).join(", ")}.`);
  if (l.courtes.length) avertissements.push(
    `${l.courtes.length} row(s) were shorter than the header; missing cells were read as empty: `
    + `line(s) ${l.courtes.slice(0, 8).map((e) => e.ligne).join(", ")}.`);

  const lignes: LigneRelue[] = l.cas.map((c) => ({
    id: (c.truth["casid"] ?? "").trim(), champ: c.text.trim(),
    verite: c.truth["truth"] ?? "", lecture1: c.truth["reviewer1"] ?? "",
    lecture2: c.truth["reviewer2"], debut: c.truth["started"], fin: c.truth["finished"],
  }));

  const sansChamp = lignes.filter((x) => x.champ === "").length;
  if (sansChamp > 0) {
    throw new Error(
      `${sansChamp} row(s) have an empty "field" cell.\n`
      + `  A verdict has to land under a field to be counted; an empty name would pool\n`
      + `  unrelated cases into one rate without a word. Name the field, or drop the row.`);
  }
  const sansId = lignes.filter((x) => x.id === "").length;
  if (sansId > 0) {
    throw new Error(
      `${sansId} row(s) have an empty "id" cell.\n`
      + `  The id keys each verdict in the relevé; empty ones would collide in silence.\n`
      + `  Give each case an identifier — and choose it opaque: ids survive into the output.`);
  }

  /*
   * LA CLÉ D'UNICITÉ EST (id, champ). Le MÊME dossier relu sur cinq champs est l'usage
   * central ; le même dossier relu DEUX FOIS sur le même champ compterait une relecture
   * deux fois dans le taux, sans un mot.
   */
  const paires = new Map<string, number>();
  for (const x of lignes) {
    const cle = `${x.id}\u0000${x.champ}`;
    paires.set(cle, (paires.get(cle) ?? 0) + 1);
  }
  const doublons = [...paires.entries()].filter(([, n]) => n > 1);
  if (doublons.length > 0) {
    throw new Error(
      `duplicate (id, field) pair(s): `
      + doublons.slice(0, 5).map(([cle, n]) => { const [id, ch] = cle.split("\u0000"); return `("${id}", "${ch}") × ${n}`; }).join(", ")
      + (doublons.length > 5 ? ` and ${doublons.length - 5} more` : "") + `.\n`
      + `  One row is one field of one reviewed case: the same review twice would count\n`
      + `  twice in the human tier's rate. Several rows MAY share an id — one per field —\n`
      + `  but not the same field twice. Deduplicate, and run again. Nothing was measured.`);
  }
  return { lignes, avertissements };
}

export type Verdict = "clean" | "wrong" | "blank";

/** Le verdict d'un cas, par le MÊME juge que les paliers machines — sinon les taux ne se comparent pas. */
export function verdictDe(l: LigneRelue): Verdict {
  if (l.lecture1.trim() === "") return "blank";
  return correct(l.lecture1, l.verite) ? "clean" : "wrong";
}

export type Taux = { n: number; propres: number; faux: number; vides: number; taux: number; intervalle: [number, number] };

function enTaux(verdicts: Verdict[]): Taux {
  const propres = verdicts.filter((v) => v === "clean").length;
  const r: Rate = rate(propres, verdicts.length);
  return {
    n: verdicts.length, propres,
    faux: verdicts.filter((v) => v === "wrong").length,
    vides: verdicts.filter((v) => v === "blank").length,
    taux: r.rate, intervalle: [r.low, r.high],
  };
}

export type Secondes = { n: number; illisibles: number; negatives: number; mediane: number; moyenne: number };

/**
 * Les secondes par dossier, quand les deux horodatages existent et se lisent.
 *
 * Une paire illisible ou une fin AVANT le début n'est pas jetée en silence : elle est comptée
 * et rendue, parce qu'un « 45 s en moyenne » calculé sur la moitié lisible d'un fichier se
 * lit comme s'il portait sur le tout. La MÉDIANE est retenue pour remplacer l'hypothèse — un
 * seul dossier laissé ouvert sur une pause déjeuner tirerait la moyenne hors de tout sens.
 */
export function mesurerSecondes(lignes: readonly LigneRelue[]): Secondes | null {
  const paires = lignes.filter((l) => (l.debut ?? "") !== "" && (l.fin ?? "") !== "");
  if (paires.length === 0) return null;
  let illisibles = 0, negatives = 0;
  const durees: number[] = [];
  for (const l of paires) {
    const a = Date.parse(l.debut!), b = Date.parse(l.fin!);
    if (Number.isNaN(a) || Number.isNaN(b)) { illisibles++; continue; }
    const s = (b - a) / 1000;
    if (s < 0) { negatives++; continue; }
    durees.push(s);
  }
  if (durees.length === 0) return { n: 0, illisibles, negatives, mediane: 0, moyenne: 0 };
  durees.sort((x, y) => x - y);
  const m = durees.length % 2 === 1 ? durees[(durees.length - 1) / 2]!
    : (durees[durees.length / 2 - 1]! + durees[durees.length / 2]!) / 2;
  return {
    n: durees.length, illisibles, negatives,
    mediane: m, moyenne: durees.reduce((s, x) => s + x, 0) / durees.length,
  };
}

export type MesureHumaine = {
  version: 1;
  date: string;
  source: { fichier: string; sha256: string; cas: number };
  global: Taux;
  parChamp: Record<string, Taux>;
  /** null quand aucune seconde lecture n'existe : une abstention nommée, pas un zéro. */
  accord: (Taux & { surLignes: number }) | null;
  secondes: Secondes | null;
  /** Un verdict par cas — JAMAIS une valeur du fichier. */
  verdicts: Record<string, Record<string, Verdict>>;
  empreinte?: string;
};

export function mesurer(lignes: readonly LigneRelue[], fichier: string, sha256: string, date: string): MesureHumaine {
  if (lignes.length === 0) {
    throw new Error("Your file carries a header and no case.\n"
      + "  There is nothing to measure, and a rate over nothing would still print a number.");
  }
  const parChamp: Record<string, Taux> = {};
  const verdicts: Record<string, Record<string, Verdict>> = {};
  const tous: Verdict[] = [];
  for (const champ of [...new Set(lignes.map((l) => l.champ))]) {
    const siens = lignes.filter((l) => l.champ === champ);
    const v = siens.map(verdictDe);
    parChamp[champ] = enTaux(v);
    verdicts[champ] = Object.fromEntries(siens.map((l, i) => [l.id, v[i]!]));
    tous.push(...v);
  }

  /*
   * L'ACCORD SE MESURE SUR LES LIGNES QUI ONT DEUX LECTURES, ET LE DÉNOMINATEUR EST RENDU.
   * Un accord de 100 % sur trois lignes d'un fichier de mille se lirait sinon comme un
   * accord sur le fichier.
   */
  const doubles = lignes.filter((l) => (l.lecture2 ?? "").trim() !== "");
  const accord = doubles.length === 0 ? null : {
    ...enTaux(doubles.map((l) => (correct(l.lecture2!, l.lecture1) ? "clean" as const : "wrong" as const))),
    surLignes: doubles.length,
  };

  return {
    version: 1, date,
    source: { fichier: basename(fichier), sha256, cas: lignes.length },
    global: enTaux(tous), parChamp, accord, secondes: mesurerSecondes(lignes), verdicts,
  };
}

const pc = (x: number) => (x * 100).toFixed(1) + " %";

function ligneDeTaux(nom: string, t: Taux): (string | number)[] {
  const c = cellulesDeTaux(rate(t.propres, t.n));
  return [cellule(nom), t.n, c.taux, c.intervalle, t.faux, t.vides,
    t.n < ENOUGH ? `below ${ENOUGH} — a rate here says little` : ""];
}

export function rapport(m: MesureHumaine, releveJson: string): string {
  const l: string[] = [
    `# The human tier, measured on your reviewed cases`,
    ``,
    `${m.source.cas} case(s) from \`${cellule(m.source.fichier).slice(1, -1)}\` `
    + `(sha256 ${m.source.sha256.slice(0, 16)}…), measured on this machine on ${m.date}. Nothing left it.`,
    ``,
    `This replaces an assumption, not a measurement of anyone: the tier is aggregated, no`,
    `per-person figure exists here, and the sealed relevé carries verdicts — never a value,`,
    `never a timestamp, never a name. Two things of yours DO survive into it: the case ids`,
    `and the file name, because verdicts need keys and provenance needs a source. Choose`,
    `them opaque — an id that is an account number stays an account number.`,
    ``,
    `## Accuracy of the human tier`,
    ``,
    table(["Field", "n", "accuracy", `${Math.round(CONFIANCE.niveau * 100)} % interval`, "wrong", "blank", "note"],
      [...Object.entries(m.parChamp).map(([c, t]) => ligneDeTaux(c, t)),
       ligneDeTaux("all fields", m.global)]),
    ``,
  ];
  l.push(`## Do two reviewers agree?`, ``);
  if (m.accord === null) {
    l.push(`Not measured: no row carries a \`reviewer2\`. That is an absence, not a zero — `
      + `supply a second reading on a sample and this section fills itself.`);
  } else {
    const c = cellulesDeTaux(rate(m.accord.propres, m.accord.n));
    l.push(`On the ${m.accord.surLignes} row(s) with two readings: **${c.taux}** agreement `
      + `${c.intervalle}. Disagreement between two humans is the noise floor any tier — `
      + `human or machine — should be read against.`);
  }
  l.push(``, `## Seconds per case`, ``);
  if (m.secondes === null) {
    l.push(`Not measured: no row carries both \`started\` and \`finished\`. The routing keeps `
      + `the assumption of 45 s per case, and keeps saying it is one.`);
  } else if (m.secondes.n === 0) {
    l.push(`${m.secondes.illisibles + m.secondes.negatives} timestamp pair(s) were present and `
      + `none could be used (${m.secondes.illisibles} unreadable, ${m.secondes.negatives} ending `
      + `before they start). Nothing is replaced.`);
  } else {
    l.push(`Median **${m.secondes.mediane.toFixed(1)} s**, mean ${m.secondes.moyenne.toFixed(1)} s, `
      + `over ${m.secondes.n} case(s)`
      + (m.secondes.illisibles || m.secondes.negatives
        ? ` — ${m.secondes.illisibles} unreadable pair(s) and ${m.secondes.negatives} negative `
          + `duration(s) were excluded, and are counted here rather than hidden.`
        : `.`));
  }
  l.push(``, `## Plugging it in`, ``,
    "```", `npm run optimise -- --humans=${releveJson}`, "```", ``,
    `The routing then uses the **all fields** line — and the median seconds, when measured —`,
    `where it used the assumption, and says so. The per-field lines are yours to read; the`,
    `assumption they replace was a single figure, and a single figure replaces it.`, ``);
  return l.join("\n");
}

/**
 * Relire une mesure scellée — le chemin qu'emprunte `optimise -- --humans=…`.
 *
 * Le scellé est VÉRIFIÉ, pas présumé : un relevé édité à la main entrerait sinon dans le
 * routage avec l'autorité d'une mesure. Et un échantillon sous ${ENOUGH} cas est refusé au
 * branchement plutôt qu'au rapport : remplacer une hypothèse annoncée par un taux sur sept
 * cas serait pire que l'hypothèse.
 */
export function lireMesureHumaine(chemin: string): MesureHumaine {
  const brut = JSON.parse(readFileSync(chemin, "utf8")) as MesureHumaine;
  if (typeof brut.empreinte !== "string") {
    throw new Error(`${chemin} carries no seal.\n`
      + `  Only the file written by \`npm run measure:humans\` is accepted here: a hand-made\n`
      + `  one would enter the routing with the authority of a measurement.`);
  }
  /* `empreinteDuReleve` exclut la clé `empreinte` de la racine — le scellé ne se calcule
     pas sur lui-même — donc le relevé se passe entier, comme partout ailleurs. */
  const reelle = empreinteDuReleve(brut);
  if (reelle !== brut.empreinte) {
    throw new Error(`${chemin} no longer matches its seal (${brut.empreinte} recorded, ${reelle} computed).\n`
      + `  Its content moved since it was written. Re-run: npm run measure:humans -- --cases=…`);
  }
  if (brut.global.n < ENOUGH) {
    throw new Error(`${chemin} measures ${brut.global.n} case(s), below ${ENOUGH}.\n`
      + `  Replacing a stated assumption with a rate over so few would be worse than the\n`
      + `  assumption. Review more cases, then measure again.`);
  }
  return brut;
}

async function principal(): Promise<void> {
  refuserDrapeauxInconnus(["--cases"]);
  /* Le lecteur GÉNÉRIQUE de your-cases.ts, pour la même raison que lui : `--cases` est ici
     un CHEMIN, pas un compte — vide, il tombe sur l'aide et rien ne s'écrit. `lireCas` de
     cas-demandes.ts garde les commandes où le drapeau est un nombre de dossiers ; l'employer
     sur un chemin refuserait tout fichier dont le nom n'est pas un entier. */
  const arg = (nom: string) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  const fichier = arg("cases");
  if (!fichier) {
    console.log(`
Measure the human tier on cases your reviewers already worked.

  npm run measure:humans -- --cases=reviewed.csv

The CSV wants these columns, names deciding, order free:

  id,field,truth,reviewer1,reviewer2,started,finished
  417,name,Anna Petrova,Anna Petrova,Anna Petrova,2026-09-01T09:14:02Z,2026-09-01T09:14:48Z

  id         names the case
  field      names what was reviewed (name, birth, document, …)
  truth      the adjudicated answer, or your ground truth
  reviewer1  what your reviewer wrote — scored against truth, by the same scorer as
             every machine tier here
  reviewer2  optional second reading: measures inter-reviewer agreement
  started, finished
             optional ISO 8601 timestamps: measure seconds per case, the figure
             assumed at 45 today

It writes, next to your file and nowhere else:
  <file>-humans-measured.md     the report
  <file>-humans-measured.json   the sealed relevé — verdicts only, never a value

Then: npm run optimise -- --humans=<file>-humans-measured.json
The tier is measured AGGREGATED: no per-person output exists, pseudonymous or not.
Case ids and the file name survive into the relevé (verdict keys, provenance):
choose them opaque. Several rows may share an id — one per field reviewed — never
the same (id, field) twice. Nothing about your file leaves this machine.
`);
    return;
  }

  const texte = readFileSync(fichier, "utf8");
  const sha = createHash("sha256").update(texte).digest("hex");
  const { lignes, avertissements } = lireRelectures(texte);
  for (const a of avertissements) console.warn(`⚠ ${a}`);

  const m = mesurer(lignes, fichier, sha, new Date().toISOString().slice(0, 10));
  const base = fichier.replace(/\.csv$/i, "");
  const releveJson = base + "-humans-measured.json";
  m.empreinte = empreinteDuReleve(m);
  writeFileSync(releveJson, JSON.stringify(m, null, 2) + "\n");
  const md = base + "-humans-measured.md";
  writeFileSync(md, rapport(m, releveJson));

  const g = cellulesDeTaux(rate(m.global.propres, m.global.n));
  console.log(`\n${m.source.cas} case(s), ${Object.keys(m.parChamp).length} field(s) — human tier at ${g.taux} ${g.intervalle}`);
  console.log(`  ${md}`);
  console.log(`  ${releveJson}`);
  console.log(`\nPlug it in: npm run optimise -- --humans=${releveJson}\n`);
  if (m.global.n < ENOUGH) {
    console.warn(`⚠ ${m.global.n} case(s) is below ${ENOUGH}: the report is written, and the routing will refuse\n`
      + `  to replace the assumption with it. Review more cases, then measure again.`);
  }
}

if (isMain(import.meta)) {
  await principal();
}
