/**
 * La recertification : la mesure du printemps tient-elle encore à l'automne ?
 *
 *   npm run recertify -- --cases=<nouveau.csv> --baseline=<ancien>-measured.json
 *
 * Un client mesure une fois, scelle, et route ses dossiers sur ce relevé. Six mois plus
 * tard la population a bougé — les taux suivent, en retard, et personne ne le voit parce
 * que personne ne remesure. Les briques existaient toutes ; ce fichier ne fait que les
 * enchaîner :
 *
 *   measure:yours   mesure le nouveau CSV        (mesurerVosCas, releveClient)
 *   diff            ce qui a changé, cas par cas  (les bits de réussite, pairedVerdict)
 *   entree          la dérive de la population    (psi, bornes de bandes, plancher de bruit)
 *   sceller         le relevé qui refuse la retouche (empreinteDuReleve)
 *
 * ─── LE RELEVÉ DE RÉFÉRENCE EST LE PROTOCOLE, PAS SEULEMENT LE CHIFFRE ───
 *
 * Un taux ne se compare qu'à un taux mesuré SOUS LES MÊMES QUESTIONS, sur les mêmes champs,
 * aux mêmes paliers. Le relevé scellé porte déjà tout cela ; la recertification le REJOUE
 * sur le nouveau fichier au lieu de demander au client de le redéclarer — une redéclaration
 * qui divergerait ferait comparer deux mesures qui ne répondent pas à la même question, et
 * l'écart lui appartiendrait, pas à la population.
 *
 * ─── UN VERDICT PAR CHAMP, ET « MOVED » EST UN RÉSULTAT, PAS UNE ERREUR ───
 *
 * « holds »  : le nouveau taux tombe dans l'intervalle de Wilson du taux de référence.
 * « moved »  : il en sort — et la sortie de commande est non nulle, parce qu'une chaîne
 *              d'intégration doit pouvoir s'arrêter dessus. Une mesure expirée qui rend 0
 *              ressemble trait pour trait à une mesure qui tient.
 * « undetermined » : trop peu de cas d'un côté ou de l'autre pour que l'intervalle dise
 *              quoi que ce soit — dit tel quel, jamais converti en « holds ».
 *
 * Et le cœur reste le diff cas par cas quand il est possible : un agrégat qui monte peut
 * cacher des cas qui passaient et ne passent plus (VALIDATION.md §6). Trois régimes,
 * du plus au moins précis, chacun nommé dans le rapport :
 *
 *   même fichier (empreinte égale)   les bits se comparent position par position ;
 *   décisions par identifiant        le relevé de recertification porte les siennes, et
 *                                    une trace `--trace` d'avant en porte aussi — la
 *                                    jointure se fait sur VOS identifiants ;
 *   ni l'un ni l'autre               les taux seuls se comparent, et le rapport dit
 *                                    pourquoi la liste des cas manque — la prochaine
 *                                    recertification l'aura, ce relevé-ci écrit la sienne.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import {
  lireCsv, mesurerVosCas, releveClient, chargerRegles, chargerSorties, apercu, MONTRES,
  PLAFOND_APPELS, sEcarterSiPoidsAbsents, type ReleveClient, type Traceur, type SortiesFournies,
} from "./your-cases.ts";
import { loadExtractors, loadGeneratifs, MODELES_EXTRACTION } from "./tiers.ts";
import { rate, ENOUGH, type Rate } from "./interval.ts";
import { bornesDeBandes, parts, psi, SEUIL_DE_L_INDUSTRIE, OBSERVATIONS_MINIMALES } from "./psi.ts";
import { GRAINES_DE_BRUIT, longueur } from "./entree.ts";
import { draw } from "./corpus.ts";
import { empreinteDuReleve } from "./measure.ts";
import { etatDuDepot } from "./arbre-propre.ts";
import { evaluerRegles } from "./regles-bornees.ts";
import { GENERATIFS, type TierName } from "./paliers.ts";
import { table } from "./figures.ts";

/* ───────────────────────────── le rythme, déclaré ─────────────────────────────
 *
 * « Trimestriel » n'est pas une mesure : personne n'a mesuré qu'une population de dossiers
 * dérive en quatre-vingt-dix jours. C'est une HYPOTHÈSE, elle se déclare (`--every=90d`),
 * elle a une valeur par défaut visible, et le rapport l'écrit comme telle — jamais un
 * chiffre caché dans le code.
 *
 * La lecture est stricte parce que `Number()` ne l'est pas : `--every=90j` rendrait NaN,
 * `--every=` rendrait 0, et chaque orthographe de « pas une durée » atterrirait à une borne
 * sans un mot. Le motif exige des chiffres suivis de `d`, et tout le reste se refuse en
 * nommant ce qui a été reçu.
 */
export const RYTHME_PAR_DEFAUT_JOURS = 90;

export function lireEvery(brut: string | undefined): number {
  if (brut === undefined) return RYTHME_PAR_DEFAUT_JOURS;
  const m = /^(\d{1,4})d$/.exec(brut);
  const jours = m ? Number(m[1]) : NaN;
  if (!m || jours < 1) {
    throw new Error(
      `--every=${brut} is not a rhythm this tool reads. It wants a whole number of days,\n`
      + `  written like --every=90d. The rhythm is your declaration, not a measurement —\n`
      + `  without the flag it defaults to ${RYTHME_PAR_DEFAUT_JOURS}d, and the report says so either way.`);
  }
  return jours;
}

/** La date de la prochaine recertification, au rythme déclaré. */
export function prochaineEcheance(measuredAt: string, jours: number): string {
  return new Date(Date.parse(measuredAt) + jours * 86_400_000).toISOString().slice(0, 10);
}

/* ──────────────────────── le relevé de référence, vérifié ────────────────────────
 *
 * Une recertification contre une référence retouchée ne certifie rien : elle compare à un
 * chiffre que quelqu'un a choisi. Le scellé existe pour ça, et il se vérifie ICI, avant
 * toute mesure — après une heure de calcul, personne ne relit le message.
 */
export type Baseline = ReleveClient & {
  kind: "cascade-client-record" | "cascade-recertification";
  /** Les décisions par identifiant, quand la référence est elle-même une recertification. */
  decisions?: Record<string, Record<string, Record<string, { outcome: string }>>>;
};

export function chargerBaselineDepuis(brut: string, nom: string): Baseline {
  let b: unknown;
  try { b = JSON.parse(brut); } catch (e) {
    throw new Error(`${nom} is not readable JSON: ${(e as Error).message}`);
  }
  const r = b as Partial<Baseline>;
  if (r?.kind !== "cascade-client-record" && r?.kind !== "cascade-recertification") {
    throw new Error(
      `${nom} is not a client record: its kind is ${JSON.stringify(r?.kind ?? null)}.\n`
      + `  The baseline is the <file>-measured.json that \`npm run measure:yours\` wrote, or a\n`
      + `  <file>-recertified.json from an earlier run of this command.`);
  }
  if (typeof r.empreinte !== "string" || !r.empreinte) {
    throw new Error(
      `${nom} carries no content fingerprint, so there is no telling whether it is the record\n`
      + `  that was measured. A recertification against an unverifiable baseline certifies nothing.\n`
      + `  → re-run \`npm run measure:yours\` on the original file to produce a sealed record.`);
  }
  const calculee = empreinteDuReleve(r);
  if (calculee !== r.empreinte) {
    throw new Error(
      `${nom} does not match its own fingerprint: it carries ${r.empreinte}, its content\n`
      + `  computes to ${calculee}. The file changed after it was sealed. Nothing was measured.\n`
      + `  If the edit is yours and deliberate, \`npm run sceller -- ${nom}\` re-declares it —\n`
      + `  that is a declaration on the record, not a way to make this refusal go away.`);
  }
  for (const champ of ["extraction", "fields", "questions", "tiers", "source", "measuredAt"] as const) {
    if (!r[champ]) throw new Error(`${nom} carries no "${champ}" — sealed by an older tool. Re-measure the original file.`);
  }
  return r as Baseline;
}

/* ───────────────────────────── le verdict d'une cellule ─────────────────────────────
 *
 * Le critère est celui de l'offre : le nouveau taux tombe-t-il dans l'intervalle de Wilson
 * du taux de référence ? L'intervalle du relevé de référence est déjà écrit dedans (`low`,
 * `high` — posés par `rate()` à la mesure) ; on le lit, on ne le recalcule pas, pour que le
 * verdict porte sur ce que le client a sous les yeux dans son relevé scellé.
 *
 * ET SOUS `ENOUGH` OBSERVATIONS, ON NE TRANCHE PAS. Un intervalle sur douze cas couvre la
 * moitié de l'échelle : tout y « tient ». Rendre « holds » là-dessus serait certifier avec
 * l'aplomb d'une mesure ce que l'échantillon ne peut pas dire — le piège exact que
 * `interval.ts` ferme partout ailleurs.
 */
export type VerdictCellule = {
  palier: string; champ: string;
  base: { rate: number; low: number; high: number; n: number };
  nouveau: Rate;
  verdict: "holds" | "moved" | "undetermined";
  sens?: "up" | "down";
  pourquoi?: string;
};

export function jugerCellule(
  palier: string, champ: string,
  base: { accuracy: number; low: number; high: number; items: number },
  nouveau: Rate,
): VerdictCellule {
  const socle = { rate: base.accuracy, low: base.low, high: base.high, n: base.items };
  if (base.items < ENOUGH || nouveau.n < ENOUGH) {
    const cote = base.items < ENOUGH ? `the baseline rests on ${base.items}` : `today's sample has ${nouveau.n}`;
    return {
      palier, champ, base: socle, nouveau, verdict: "undetermined",
      pourquoi: `${cote} case(s) — below ${ENOUGH}, the interval spans too much of the scale to separate anything`,
    };
  }
  if (nouveau.rate < base.low) return { palier, champ, base: socle, nouveau, verdict: "moved", sens: "down" };
  if (nouveau.rate > base.high) return { palier, champ, base: socle, nouveau, verdict: "moved", sens: "up" };
  return { palier, champ, base: socle, nouveau, verdict: "holds" };
}

/**
 * Le verdict d'un CHAMP agrège ses paliers : un seul palier qui bouge suffit — c'est
 * peut-être précisément celui sur lequel le routage du client repose.
 */
export function verdictDuChamp(cellules: VerdictCellule[]): "holds" | "moved" | "undetermined" {
  if (cellules.some((c) => c.verdict === "moved")) return "moved";
  if (cellules.some((c) => c.verdict === "holds")) return "holds";
  return "undetermined";
}

/**
 * LE CODE DE SORTIE, séparé pour qu'un témoin le lise sans lancer un modèle.
 *
 * 1 dès qu'un champ a bougé — une recertification qui échoue est un résultat de première
 * classe. 2 quand RIEN n'a pu être tranché : « rien de comparé » n'est pas « rien n'a
 * changé », et c'est le même refus que celui de `diff`.
 */
export function codeDeSortie(verdicts: ("holds" | "moved" | "undetermined")[]): 0 | 1 | 2 {
  if (verdicts.some((v) => v === "moved")) return 1;
  if (verdicts.every((v) => v === "undetermined") || verdicts.length === 0) return 2;
  return 0;
}

/* ──────────────────── les cas perdus et gagnés, par identifiant ────────────────────
 *
 * Les décisions sont jointes sur VOS identifiants : un dossier présent aux deux trimestres
 * se compare, un dossier parti ou arrivé se compte. Seuls les identifiants voyagent —
 * jamais une valeur, jamais le texte.
 */
export type Decisions = Record<string, Record<string, Record<string, { outcome: string }>>>;

export function casJoints(avant: Decisions, apres: Decisions, palier: string, champ: string): {
  communs: number; perdus: string[]; gagnes: string[]; partis: number; arrives: number;
} {
  const lit = (d: Decisions, id: string) => d[id]?.[palier]?.[champ]?.outcome;
  const perdus: string[] = [], gagnes: string[] = [];
  let communs = 0, partis = 0, arrives = 0;
  for (const id of Object.keys(avant)) {
    const a = lit(avant, id), b = lit(apres, id);
    if (a === undefined) continue;
    if (b === undefined) { partis++; continue; }
    communs++;
    if (a === "clean" && b !== "clean") perdus.push(id);
    else if (a !== "clean" && b === "clean") gagnes.push(id);
  }
  for (const id of Object.keys(apres)) {
    if (lit(apres, id) !== undefined && lit(avant, id) === undefined) arrives++;
  }
  return { communs, perdus: perdus.sort(), gagnes: gagnes.sort(), partis, arrives };
}

/* ─────────────────────────── la dérive de la population ───────────────────────────
 *
 * Le trait est la longueur du document — le même que `entree.ts`, sans étiquette et sans
 * modèle — et l'indice se lit contre son propre plancher de bruit : ce que le PIRE des
 * ré-échantillonnages de la référence immobile produit déjà. Un indice sous ce plancher
 * n'est pas « pas de dérive », c'est « indiscernable du tirage » ; les deux phrases se
 * rendent telles quelles.
 */
export type Derive = {
  n: number; indice: number; plancher: number;
  verdict: "undetermined" | "indistinguishable" | "below-threshold" | "above-threshold";
};

export function deriveDEntree(anciennes: number[], nouvelles: number[]): Derive {
  const bornes = bornesDeBandes(anciennes, 10);
  const reference = parts(anciennes, bornes);
  const indice = psi(reference, parts(nouvelles, bornes));
  const n = nouvelles.length;
  /* Le plancher rend le PIRE tirage, pas le typique — voir `plancherDeBruit` : c'est le
     maximum qui déclenche une fausse alerte, et une médiane le cacherait. */
  const plancher = Math.max(...GRAINES_DE_BRUIT.map((g) => {
    const r = draw(g);
    const tirage = Array.from({ length: n }, () => anciennes[Math.floor(r() * anciennes.length)]!);
    return psi(reference, parts(tirage, bornes));
  }));
  const verdict = n < OBSERVATIONS_MINIMALES ? "undetermined"
    : indice < plancher * 2 ? "indistinguishable"
      : indice >= SEUIL_DE_L_INDUSTRIE ? "above-threshold" : "below-threshold";
  return { n, indice, plancher, verdict };
}

export function direLaDerive(d: Derive | { mesuree: false; pourquoi: string }): string[] {
  if ("mesuree" in d) {
    return [
      `Not measured — ${d.pourquoi}`,
      `This recertification's own record carries what the next one needs; from the next run on, drift is measured automatically.`,
    ];
  }
  const contreLeSeuil = `industry threshold ${SEUIL_DE_L_INDUSTRIE}`;
  const tete = `Index ${d.indice.toFixed(3)} on document length, ${d.n} observation(s); noise floor ${d.plancher.toFixed(3)} (worst of ${GRAINES_DE_BRUIT.length} resamplings of the reference, which has not moved).`;
  const phrase = {
    "undetermined": `UNDETERMINED — ${d.n} observation(s), ${OBSERVATIONS_MINIMALES} are needed before any threshold separates.`,
    "indistinguishable": `Indistinguishable from resampling: the reference population itself produces up to ${d.plancher.toFixed(3)}.`,
    "below-threshold": `${(d.indice / Math.max(d.plancher, 1e-9)).toFixed(0)}x the floor, below the ${contreLeSeuil} — which "drift-monitor" measured as sitting ABOVE the signal: this is not an absence of drift, it is drift this threshold cannot see.`,
    "above-threshold": `${(d.indice / Math.max(d.plancher, 1e-9)).toFixed(0)}x the floor, above the ${contreLeSeuil}: the population is no longer the one the routing was chosen on. The decision has expired — that is the obligation, whatever the rates below say.`,
  }[d.verdict];
  return [tete, phrase];
}

/* ─────────────────────────────── le rapport rendu ─────────────────────────────── */

export function ecrireTaux(r: { rate: number; low: number; high: number; n: number }): string {
  return `${(r.rate * 100).toFixed(1)} % [${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}], n=${r.n}`;
}

export function rendreRecertification(o: {
  date: string; fichier: string; baseline: { file: string; measuredAt: string; empreinte: string };
  cas: number; champs: string[];
  cellules: VerdictCellule[];
  verdictsParChamp: Record<string, "holds" | "moved" | "undetermined">;
  cellulesEcartees: { cellule: string; pourquoi: string }[];
  jointure: { regime: "same-file" | "by-id" | "none"; pourquoi?: string;
    parChamp: Record<string, { communs: number; perdus: string[]; gagnes: string[]; partis: number; arrives: number }> };
  derive: Derive | { mesuree: false; pourquoi: string };
  rythme: { jours: number; declare: boolean; prochaine: string };
}): string {
  const lignes = o.cellules.map((c) => [
    `\`${c.champ}\``, `\`${c.palier}\``, ecrireTaux(c.base), ecrireTaux(c.nouveau),
    c.verdict === "holds" ? "**holds**"
      : c.verdict === "moved" ? `**MOVED ${c.sens}**`
        : `undetermined — ${c.pourquoi}`,
  ]);
  const parties = [
    `# Recertification`,
    ``,
    `${o.cas} case(s) from \`${o.fichier}\`, measured on this machine on ${o.date}, against the`,
    `sealed baseline \`${o.baseline.file}\` (measured ${o.baseline.measuredAt.slice(0, 10)}, seal ${o.baseline.empreinte}).`,
    `Same fields, same questions, same tiers: the baseline record is the protocol, replayed.`,
    `Nothing leaves your machine.`,
    ``,
    `## Verdict per field`,
    ``,
    ...o.champs.map((c) => `- \`${c}\` — **${o.verdictsParChamp[c] ?? "undetermined"}**`),
    ``,
    `A field **holds** when today's rate falls inside the Wilson interval its baseline rate`,
    `carries; it **moved** when it falls outside, in either direction — a rate that rises has`,
    `moved too, and the case list below says what a rising aggregate can hide.`,
    ``,
    `## Rates, spring against today`,
    ``,
    table(["Field", "Tier", "Baseline", "Today", "Verdict"], lignes),
  ];
  if (o.cellulesEcartees.length) {
    parties.push(``, `${o.cellulesEcartees.length} cell(s) set aside — set aside is not "no change":`, ``,
      ...o.cellulesEcartees.map((e) => `- ${e.cellule} — ${e.pourquoi}`));
  }
  parties.push(``, `## Cases that used to pass, case by case`, ``);
  if (o.jointure.regime === "none") {
    parties.push(`Not available against this baseline: ${o.jointure.pourquoi}`, ``,
      `This record writes its own per-case decisions (identifiers and outcomes, never a value),`,
      `so the next recertification names lost cases automatically.`);
  } else {
    parties.push(o.jointure.regime === "same-file"
      ? `The two records were measured on the SAME file (same content hash): cases pair position by position.`
      : `Cases are joined on your identifier column: an id present in both quarters is compared, others are counted.`);
    for (const champ of o.champs) {
      const j = o.jointure.parChamp[champ];
      if (!j) continue;
      parties.push(``, `- \`${champ}\` — ${j.communs} case(s) in both`
        + (j.partis || j.arrives ? ` (${j.partis} left, ${j.arrives} new)` : "")
        + `: ${j.perdus.length} lost, ${j.gagnes.length} gained.`);
      if (j.perdus.length) parties.push(`  - lost: ${apercu(j.perdus, MONTRES)}`);
      if (j.gagnes.length) parties.push(`  - gained: ${apercu(j.gagnes, MONTRES)}`);
    }
    const perdusTotal = Object.values(o.jointure.parChamp).reduce((a, j) => a + j.perdus.length, 0);
    if (perdusTotal > 0) {
      parties.push(``, `**${perdusTotal} case(s) that used to pass no longer do.** A rising aggregate can hide`,
        `exactly these; they are the thing to read, not the averages.`);
    }
  }
  parties.push(``, `## Input drift`, ``, ...direLaDerive(o.derive));
  parties.push(``, `## Rhythm`, ``,
    `This recertification was run under a ${o.rythme.jours}-day rhythm — `
    + (o.rythme.declare ? `your declaration (\`--every=${o.rythme.jours}d\`)` : `the default, a declared assumption, not a measurement`)
    + `. Next one due **${o.rythme.prochaine}**.`);
  parties.push(``, `## What this does not establish`, ``,
    `- That the rates hold on documents other than the ${o.cas} supplied today.`,
    `- Why a field moved: a moved verdict says the spring decision expired, not what to buy instead —`,
    `  re-run \`npm run measure:yours\` with a declared margin for a fresh recommendation.`,
    `- That a "holds" under drift is safe: an expired population with stable rates is stable so far.`,
    ``);
  return parties.join("\n") + "\n";
}

/* ─────────────────────────────────── la commande ─────────────────────────────────── */

const DRAPEAUX = ["--cases", "--baseline", "--every", "--rules", "--sorties", "--llm", "--yes-run-it"];

async function principal(): Promise<void> {
  const argv = process.argv.slice(2);
  /* Une option ignorée en silence répond à une autre question que celle posée. La garde est
     la PARTAGÉE de `cli.ts` — `drapeaux.test.ts` exige l'appel, pas une copie locale. */
  refuserDrapeauxInconnus(DRAPEAUX);
  const arg = (nom: string) => argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  const fichier = arg("cases");
  const cheminBaseline = arg("baseline");
  if (!fichier || !cheminBaseline) {
    console.log(`
Does the spring measurement still hold?

  npm run recertify -- --cases=<new.csv> --baseline=<old>-measured.json [--every=90d]

Measures the new file under the SAME protocol as the sealed baseline record — same fields,
same questions, same tiers — then says, per field: holds (today's rate inside the baseline's
Wilson interval), or MOVED (outside it, exit code 1). Where cases can be joined, the ones
that used to pass and no longer do are named by identifier. Input drift is measured on
document length against its own noise floor when the baseline CSV sits next to the record.

--every=90d   the recertification rhythm — your declaration, not a measurement; default ${RYTHME_PAR_DEFAUT_JOURS}d.
--rules=f     the same rules JSON the baseline was measured with, if it has a rules tier.
--sorties=f   the same declared-outcomes JSON, if the baseline has your own chain as a tier.
--llm         re-measure the generative tiers too (needs Ollama, like measure:yours).
--yes-run-it  run past the model-call ceiling.

Writes <new>-recertified.md (for a reader) and <new>-recertified.json (sealed, for a machine —
counts, rates, verdicts, identifiers; never a value). The JSON serves as the next baseline.
Nothing leaves your machine.
`);
    process.exit(2);
  }
  let jours: number;
  try { jours = lireEvery(arg("every")); } catch (e) { console.error(`\n${(e as Error).message}\n`); process.exit(2); }

  /* L'état du dépôt se lit AU DÉPART — le relevé cite le code qui a mesuré, pas celui
     d'après (mesuré le 3 septembre 2026 dans measure:yours, même motif). */
  const etatAuDepart = etatDuDepot();

  if (!existsSync(cheminBaseline)) { console.error(`no such baseline: ${cheminBaseline}`); process.exit(2); }
  let baseline: Baseline;
  try { baseline = chargerBaselineDepuis(readFileSync(cheminBaseline, "utf8"), cheminBaseline); }
  catch (e) { console.error(`\n${(e as Error).message}\n`); process.exit(2); }

  if (!existsSync(fichier)) { console.error(`no such file: ${fichier}`); process.exit(2); }
  const octets = readFileSync(fichier);
  const { champs: colonnes, cas } = lireCsv(octets.toString("utf8"));
  if (cas.length === 0) { console.error(`\n${fichier} holds no readable case. Nothing was measured.\n`); process.exit(2); }

  /* Les champs sont CEUX DU PROTOCOLE. Un champ de la référence absent du nouveau fichier
     rend la recertification de ce champ impossible — dit, pas deviné. Une colonne nouvelle
     n'est pas recertifiée : elle n'a pas de référence, elle attend sa première mesure. */
  const champs = baseline.fields.filter((c) => colonnes.includes(c));
  const champsAbsents = baseline.fields.filter((c) => !colonnes.includes(c));
  const colonnesNouvelles = colonnes.filter((c) => !baseline.fields.includes(c));
  if (champs.length === 0) {
    console.error(`\nNone of the baseline's field(s) — ${apercu(baseline.fields, MONTRES)} — appear as columns in ${fichier}.`);
    console.error(`Recertification replays the baseline protocol; a file with none of its fields cannot be compared.\n`);
    process.exit(2);
  }

  /* Les paliers du protocole, moins ceux dont le matériel manque — écartés en le disant,
     jamais en silence : une garde portée par une partie des paliers n'est pas une garde. */
  const cheminRegles = arg("rules");
  const cheminSorties = arg("sorties");
  const avecLlm = argv.includes("--llm");
  const sorties: SortiesFournies | undefined = cheminSorties ? chargerSorties(cheminSorties) : undefined;
  const ecartesAvantMesure: { cellule: string; pourquoi: string }[] = [];
  const paliersModeles: TierName[] = [];
  for (const t of baseline.tiers) {
    if (t === "small" || t === "large") { paliersModeles.push(t); continue; }
    if (t === "rules") {
      if (!cheminRegles) ecartesAvantMesure.push({ cellule: "rules/*", pourquoi: "the baseline has a rules tier and no --rules was given — the record never stores your regexes" });
      continue;
    }
    if ((GENERATIFS as string[]).includes(t)) {
      if (avecLlm) paliersModeles.push(t as TierName);
      else ecartesAvantMesure.push({ cellule: `${t}/*`, pourquoi: "generative tier in the baseline and no --llm given" });
      continue;
    }
    if (t === "human") continue; /* jamais mesuré ici, comme dans measure:yours */
    if (!sorties || sorties.nom !== t) {
      ecartesAvantMesure.push({ cellule: `${t}/*`, pourquoi: `the baseline carries your own chain "${t}" and no matching --sorties was given` });
    }
  }

  const appels = cas.length * champs.length * paliersModeles.length;
  console.log(`\n${cas.length} case(s), ${champs.length} field(s) of the baseline protocol: ${apercu(champs, MONTRES)}`);
  if (champsAbsents.length) console.log(`  ${champsAbsents.length} baseline field(s) MISSING from this file: ${apercu(champsAbsents, MONTRES)} — set aside, said below.`);
  if (colonnesNouvelles.length) console.log(`  ${colonnesNouvelles.length} new column(s) not in the baseline: ${apercu(colonnesNouvelles, MONTRES)} — not recertified, they have no reference yet.`);
  console.log(`  ${cas.length} × ${champs.length} × ${paliersModeles.length} tier(s) = ${appels.toLocaleString("en-GB")} model call(s) on this machine.`);
  if (appels > PLAFOND_APPELS && !argv.includes("--yes-run-it")) {
    console.error(`\n  That is above ${PLAFOND_APPELS.toLocaleString("en-GB")} calls and nothing has been measured yet.`);
    console.error(`  Measure a subset first, or pass --yes-run-it.\n  Nothing was written.\n`);
    process.exit(3);
  }

  /* Les QUESTIONS sont celles de la référence, verbatim : un taux mesuré sous une autre
     question n'est pas comparable, et l'écart appartiendrait à la question, pas à la
     population. */
  const questions = Object.fromEntries(champs.map((c) => [c, baseline.questions[c]!.texte]));

  const regles = cheminRegles
    ? await evaluerRegles(chargerRegles(cheminRegles, champs), cas.map((c) => c.text))
    : undefined;

  /* Le même départ que measure:yours : s'écarter si les poids manquent (au lieu de laisser
     la bibliothèque partir les chercher), puis charger les extracteurs UNE fois. */
  sEcarterSiPoidsAbsents(MODELES_EXTRACTION);
  await loadExtractors();
  if (avecLlm) await loadGeneratifs();

  /* Les décisions par identifiant s'enregistrent TOUJOURS : c'est ce qui rend la prochaine
     recertification capable de nommer les cas perdus. Identifiants et issues — pas un score,
     pas une valeur. */
  const decisions: Decisions = {};
  const traceur: Traceur = (id, palier, champ, issue) => {
    (((decisions[id] ??= {})[palier] ??= {})[champ] = { outcome: issue });
  };

  const releve = await mesurerVosCas(cas, champs, paliersModeles, regles, false, sorties, questions, traceur);

  /* Le relevé chaînable — la MÊME forme que measure:yours, par la même fonction, pour que
     `diff`, `sceller` et la prochaine recertification le lisent sans un mot de plus. */
  const enregistrementClient = releveClient({
    fichier, octets, cas: cas.length, casDansLeFichier: cas.length, champs,
    questions: Object.fromEntries(champs.map((c) => [c, baseline.questions[c]!])),
    releve, verdicts: [], marge: baseline.margin ?? undefined, sorties,
    measuredAt: new Date().toISOString(),
    code: etatAuDepart ? { commit: etatAuDepart.commit, sale: etatAuDepart.sale.length > 0 } : null,
  });

  /* ── les verdicts, cellule par cellule ── */
  const cellules: VerdictCellule[] = [];
  const ecartees = [...ecartesAvantMesure];
  for (const palier of Object.keys(baseline.extraction).sort()) {
    for (const champ of Object.keys(baseline.extraction[palier] ?? {}).sort()) {
      const cb = baseline.extraction[palier]![champ]!;
      const cn = enregistrementClient.extraction[palier]?.[champ];
      if (!cn) {
        if (!ecartees.some((e) => e.cellule === `${palier}/*`)) {
          ecartees.push({ cellule: `${palier}/${champ}`, pourquoi: champsAbsents.includes(champ) ? "field missing from today's file" : "not measured today" });
        }
        continue;
      }
      /* Les succès se COMPTENT sur les bits, ils ne se retrouvent pas en multipliant un taux
         arrondi par n — deux arrondis de suite fabriquent un compte qui n'a jamais existé. */
      const bons = cn.reussites ? (cn.reussites.match(/1/g) ?? []).length : Math.round(cn.accuracy * cn.items);
      cellules.push(jugerCellule(palier, champ, cb, rate(bons, cn.items)));
    }
  }
  const verdictsParChamp = Object.fromEntries(champs.map((c) => {
    const siennes = cellules.filter((x) => x.champ === c);
    return [c, verdictDuChamp(siennes)];
  })) as Record<string, "holds" | "moved" | "undetermined">;

  /* ── la jointure cas par cas, au régime le plus précis disponible ── */
  const memeFichier = enregistrementClient.source.sha256 === baseline.source.sha256;
  let decisionsAvant: Decisions | undefined = baseline.decisions;
  if (!decisionsAvant) {
    /* Une trace `--trace` d'avant vaut des décisions — si elle cite le scellé de SA référence,
       sinon elle raconte une autre mesure. */
    const cheminTrace = join(dirname(cheminBaseline), basename(cheminBaseline).replace(/-measured\.json$/, "-trace.json"));
    if (cheminTrace !== cheminBaseline && existsSync(cheminTrace)) {
      try {
        const t = JSON.parse(readFileSync(cheminTrace, "utf8")) as { record?: string; decisions?: Record<string, Record<string, Record<string, { outcome: string }>>> };
        if (t.record === baseline.empreinte && t.decisions) decisionsAvant = t.decisions;
      } catch { /* une trace illisible ne casse pas la recertification ; la jointure dira son régime */ }
    }
  }
  const parChamp: Record<string, { communs: number; perdus: string[]; gagnes: string[]; partis: number; arrives: number }> = {};
  let regime: "same-file" | "by-id" | "none" = "none";
  let pourquoiSansJointure: string | undefined;
  if (memeFichier || decisionsAvant) {
    regime = memeFichier ? "same-file" : "by-id";
    if (memeFichier && !decisionsAvant) {
      /* Même fichier : les bits du relevé de référence se lisent position par position, et la
         position i est l'identifiant cas[i].id du fichier — le même des deux côtés. */
      decisionsAvant = {};
      for (const palier of Object.keys(baseline.extraction)) {
        for (const champ of Object.keys(baseline.extraction[palier] ?? {})) {
          const bits = baseline.extraction[palier]![champ]!.reussites;
          if (!bits || bits.length !== cas.length) continue;
          for (let i = 0; i < bits.length; i++) {
            (((decisionsAvant[cas[i]!.id] ??= {})[palier] ??= {})[champ] = { outcome: bits[i] === "1" ? "clean" : "wrong" });
          }
        }
      }
    }
    for (const champ of champs) {
      const paliersDuChamp = [...new Set(cellules.filter((c) => c.champ === champ).map((c) => c.palier))];
      for (const palier of paliersDuChamp) {
        const j = casJoints(decisionsAvant!, decisions, palier, champ);
        const deja = parChamp[champ];
        /* Un champ se rapporte sur son pire palier : celui qui perd le plus de cas. */
        if (!deja || j.perdus.length > deja.perdus.length) parChamp[champ] = j;
      }
    }
  } else {
    pourquoiSansJointure = "the baseline record carries no per-case decisions (it is a plain measured record, "
      + "no -trace.json beside it), and today's file differs from the spring one, so positions do not pair.";
  }

  /* ── la dérive d'entrée — si le CSV du printemps est encore là, vérifié par empreinte ── */
  let derive: Derive | { mesuree: false; pourquoi: string };
  const cheminAncien = join(dirname(cheminBaseline), baseline.source.file);
  if (memeFichier) {
    derive = { mesuree: false, pourquoi: "today's file IS the spring file (same content hash) — a population compared to itself says nothing." };
  } else if (!existsSync(cheminAncien)) {
    derive = { mesuree: false, pourquoi: `the spring CSV (${baseline.source.file}) is not beside the baseline record.` };
  } else if (createHash("sha256").update(readFileSync(cheminAncien)).digest("hex") !== baseline.source.sha256) {
    derive = { mesuree: false, pourquoi: `${baseline.source.file} sits beside the baseline record but its content hash differs from the one the record was measured on — measuring drift against it would compare to a file the baseline never saw.` };
  } else {
    const anciennes = lireCsv(readFileSync(cheminAncien, "utf8")).cas.map((c) => longueur(c.text));
    derive = deriveDEntree(anciennes, cas.map((c) => longueur(c.text)));
  }

  /* ── les deux sorties, à côté du fichier, jamais ailleurs ── */
  const measuredAt = enregistrementClient.measuredAt;
  const rythme = { jours, declare: arg("every") !== undefined, prochaine: prochaineEcheance(measuredAt, jours) };
  const rapport = rendreRecertification({
    date: measuredAt.slice(0, 10), fichier: basename(fichier),
    baseline: { file: basename(cheminBaseline), measuredAt: baseline.measuredAt, empreinte: baseline.empreinte! },
    cas: cas.length, champs, cellules, verdictsParChamp, cellulesEcartees: ecartees,
    jointure: { regime, pourquoi: pourquoiSansJointure, parChamp }, derive, rythme,
  });
  const base = fichier.replace(/\.csv$/i, "");
  writeFileSync(`${base}-recertified.md`, rapport);

  const enregistrement: Record<string, unknown> = {
    ...enregistrementClient,
    kind: "cascade-recertification",
    baseline: { file: basename(cheminBaseline), empreinte: baseline.empreinte, measuredAt: baseline.measuredAt, sourceSha256: baseline.source.sha256 },
    decisions,
    verdicts: Object.fromEntries(champs.map((c) => [c, {
      verdict: verdictsParChamp[c],
      cellules: cellules.filter((x) => x.champ === c),
      ...(parChamp[c] ? { cas: parChamp[c] } : {}),
    }])),
    entree: "mesuree" in derive ? { mesuree: false, pourquoi: derive.pourquoi } : { mesuree: true, ...derive },
    rythme,
  };
  delete enregistrement.empreinte;
  enregistrement.empreinte = empreinteDuReleve(enregistrement);
  writeFileSync(`${base}-recertified.json`, JSON.stringify(enregistrement, null, 2));

  /* ── le résumé, et le code de sortie qui fait de « moved » un résultat ── */
  console.log(`\nVerdict per field:`);
  for (const c of champs) console.log(`  ${c.padEnd(18)} ${verdictsParChamp[c]}`);
  const perdusTotal = Object.values(parChamp).reduce((a, j) => a + j.perdus.length, 0);
  if (perdusTotal) console.log(`\n  ${perdusTotal} case(s) that used to pass no longer do — named in the report.`);
  console.log(`\nWritten to ${base}-recertified.md`);
  console.log(`Sealed record written to ${base}-recertified.json — seal ${enregistrement.empreinte}.`);
  console.log(`It serves as the next baseline: --baseline=${basename(base)}-recertified.json`);
  console.log(`Next recertification due ${rythme.prochaine} (${jours}-day rhythm, ${rythme.declare ? "declared" : "default"}).\n`);
  process.exit(codeDeSortie(champs.map((c) => verdictsParChamp[c]!)));
}

/* Un refus destiné au client ne sort pas en trace de pile — même motif que measure:yours. */
if (isMain(import.meta)) {
  try {
    await principal();
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
}
