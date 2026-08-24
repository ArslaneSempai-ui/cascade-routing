/**
 * Se taire plutôt que monter — le levier qui reste quand l'escalade est bornée.
 *
 * Escalader vers `gen-8b` dépasse le plafond de latence sur quatre champs sur cinq, et la seule
 * escalade admissible ne complète aucun dossier de plus. Il reste une option qui ne coûte ni
 * milliseconde ni euro : **refuser de répondre** quand les signaux gratuits se déclenchent.
 *
 * L'échange que le client paie, et le seul qui compte :
 *
 *     combien de valeurs fausses on élimine, par valeur juste sacrifiée.
 *
 * Parce qu'une valeur fausse entre au dossier **sans bruit** — elle a l'air d'une donnée, et
 * rien en aval ne la signale — alors qu'un blanc se voit et se rattrape. L'abstention ne rend
 * pas le système plus juste ; elle échange de l'erreur invisible contre du trou visible, et
 * c'est au client de dire ce que vaut ce change.
 *
 *     npm run abstention
 */

import { writeFileSync } from "node:fs";
import { isMain } from "./cli.ts";
import { journaux, lireJournal } from "./journal.ts";
import { normaliserReponse } from "./tiers.ts";
import { corpusDur } from "./corpus-dur.ts";
import { casAmbigus } from "./mesurer-dur.ts";
import { FORME } from "./signal.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS } from "./assumptions.ts";
import { optimiseExtraction } from "./optimise.ts";
import "./figer.ts";  /* pose la table figée : voir figer.ts */
import { FIELDS, draw } from "./corpus.ts";
import { rate, ENOUGH } from "./interval.ts";

import type { Tentative } from "./journal.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const SORTIE = fileURLToPath(new URL("../abstention.json", import.meta.url));

export type Bilan = {
  regle: string; abstentions: number;
  fauxElimines: number; justesSacrifies: number;
  echange: number | null;
  valeursLivrees: number; justesParmiLesLivrees: number;
  /* Le chiffre que « faux éliminés par juste sacrifié » cache : on livre moins de justes. */
  justesLivresEnMoins: number;
  coutTotal: number;
  precisionLivree: number | null; precisionLivreeIntervalle: [number, number] | null;
  dossiersSansErreurInvisible: number; dossiersEntiers: number;
};

/** Le bilan d'une règle d'abstention, quelle qu'elle soit. */
export function bilan(
  regle: string,
  champs: readonly { cas: string; champ: Field; t: Tentative | undefined }[],
  seTaire: (t: Tentative) => boolean,
  documents: readonly string[],
): Bilan {
  let abstentions = 0, fauxElimines = 0, justesSacrifies = 0;
  let livrees = 0, justesLivrees = 0;
  const propre = new Map(documents.map((d) => [d, true]));
  const sansFaux = new Map(documents.map((d) => [d, true]));

  for (const x of champs) {
    if (!x.t) { propre.set(x.cas, false); sansFaux.set(x.cas, false); continue; }
    const juste = x.t.outcome === "clean";
    if (seTaire(x.t)) {
      abstentions++;
      if (juste) justesSacrifies++; else fauxElimines++;
      propre.set(x.cas, false);          // un champ tu n'est pas un champ livré
      continue;                           // et il n'entre pas au dossier : rien d'invisible
    }
    livrees++;
    if (juste) justesLivrees++;
    else { propre.set(x.cas, false); if (x.t.outcome === "wrong") sansFaux.set(x.cas, false); }
  }

  const r = livrees ? rate(justesLivrees, livrees) : null;
  /*
   * Le coût, avec les deux prix déjà déclarés dans `assumptions`.
   *
   * `costWrongValue` et `costBlankField` y sont à égalité, et c'est le point : à prix égaux,
   * échanger quatre-vingt-onze fausses contre douze justes est nettement favorable. Un client
   * qui juge une valeur inventée plus chère qu'un trou n'a qu'à changer un des deux nombres —
   * ils sont là pour ça, et le sens de la conclusion en dépend.
   */
  const faux = champs.length - livrees - abstentions + (abstentions - fauxElimines - justesSacrifies);
  void faux;
  const nonLivrees = abstentions;
  const fausseLivrees = livrees - justesLivrees;
  const cout = fausseLivrees * ASSUMPTIONS.costWrongValue + nonLivrees * ASSUMPTIONS.costBlankField;
  return {
    regle, abstentions, fauxElimines, justesSacrifies,
    echange: justesSacrifies ? Number((fauxElimines / justesSacrifies).toFixed(2)) : null,
    valeursLivrees: livrees, justesParmiLesLivrees: justesLivrees,
    precisionLivree: r ? Number((100 * r.rate).toFixed(1)) : null,
    precisionLivreeIntervalle: r ? [Number((100 * r.low).toFixed(1)), Number((100 * r.high).toFixed(1))] : null,
    justesLivresEnMoins: justesSacrifies,
    coutTotal: Number(cout.toFixed(2)),
    dossiersSansErreurInvisible: [...sansFaux.values()].filter(Boolean).length,
    dossiersEntiers: [...propre.values()].filter(Boolean).length,
  };
}

if (isMain(import.meta)) {
  const f = journaux().filter((x) => x.includes("-dur.jsonl")).pop();
  const p = readProfiles();
  if (!f || !p) { console.error("journal ou relevé manquant"); process.exit(1); }
  const { tentatives } = lireJournal(f);
  const rep = new Map(tentatives.map((t) => [`${t.tier}|${t.caseId}|${t.field}`, t]));
  const textes = new Map([...corpusDur(), ...casAmbigus()].map((c) => [c.cle, c.texte]));
  const optimum = optimiseExtraction(p, ASSUMPTIONS);
  if (!optimum) { console.error("aucun routage admissible"); process.exit(1); }

  const documents = corpusDur()
    .filter((c) => Object.keys(c.attendus).length === FIELDS.length).map((c) => c.cle);
  const champs = documents.flatMap((cas) => FIELDS.map((champ) => ({
    cas, champ, t: rep.get(`${optimum.routing[champ]}|${cas}|${champ}`),
  })));

  /* Les signaux gratuits, identiques au banc : blanc, forme implausible, absence du document. */
  const score = (t: Tentative) => {
    const v = normaliserReponse(t.value);
    if (v.length === 0) return 1;                     // déjà vide : se taire ne change rien
    let n = 0;
    const texte = textes.get(t.caseId);
    if (texte !== undefined && !normaliserReponse(texte).includes(v)) n++;
    const r = FORME[t.field];
    if (r !== undefined && !r(t.value)) n++;
    return n;
  };

  const bilans = [
    bilan("aucune abstention", champs, () => false, documents),
    bilan("se taire si au moins un signal", champs, (t) => score(t) >= 1, documents),
    bilan("se taire si les deux signaux", champs, (t) => score(t) >= 2, documents),
  ];

  /* Témoin : se taire au même taux, au hasard. Sans lui, tout échange paraît favorable. */
  const alea = draw(20260821);
  for (const cible of bilans.slice(1)) {
    let sommeFaux = 0, sommeJustes = 0;
    const tirages = 200;
    for (let k = 0; k < tirages; k++) {
      const choisis = new Set([...champs].sort(() => alea() - 0.5).slice(0, cible.abstentions)
        .map((x) => `${x.cas}|${x.champ}`));
      const b = bilan("hasard", champs, (t) => choisis.has(`${t.caseId}|${t.field}`), documents);
      sommeFaux += b.fauxElimines; sommeJustes += b.justesSacrifies;
    }
    (cible as Bilan & { temoinHasard?: unknown }).temoinHasard = {
      abstentions: cible.abstentions,
      fauxElimines: Number((sommeFaux / tirages).toFixed(1)),
      justesSacrifies: Number((sommeJustes / tirages).toFixed(1)),
      echange: sommeJustes ? Number((sommeFaux / sommeJustes).toFixed(2)) : null,
    };
  }

  /* Oracle : se taire exactement sur les fausses. Le plafond, irréalisable. */
  const oracle = bilan("oracle — se taire exactement sur les fausses", champs,
    (t) => t.outcome !== "clean", documents);

  /*
   * À quel prix relatif l'abstention devient-elle payante ?
   *
   * `costWrongValue` et `costBlankField` sont **à égalité** dans les hypothèses, délibérément.
   * À ce réglage l'abstention est nulle par construction : elle transforme une erreur en trou
   * au même prix, et jette douze valeurs justes au passage — donc elle coûte plus cher que de
   * ne rien faire. Ce n'est pas un résultat sur l'abstention, c'est un résultat sur l'hypothèse.
   *
   * Le chiffre qui vaut d'être publié est donc le point de bascule : au-delà de quel rapport
   * une valeur inventée doit-elle coûter plus qu'un trou pour que se taire soit rentable. Il ne
   * dépend d'aucun des deux prix, seulement de leur rapport — et c'est une question que le
   * client sait trancher alors que nous non.
   */
  const bascule = (b: typeof oracle) => {
    const fauxLivres = b.valeursLivrees - b.justesParmiLesLivrees;
    const fauxSansRegle = bilans[0]!.valeursLivrees - bilans[0]!.justesParmiLesLivrees;
    const gagnes = fauxSansRegle - fauxLivres;      // fausses valeurs qui n'entrent plus au dossier
    const trous = b.abstentions;                     // blancs créés en échange
    return gagnes > 0 ? Number((trous / gagnes).toFixed(3)) : null;
  };
  const bascules = [...bilans.slice(1), oracle].map((b) => ({
    regle: b.regle, rapportDeBascule: bascule(b),
    lecture: "une valeur inventée doit coûter au moins ce rapport fois un trou pour que cette "
      + "règle soit rentable",
  }));

  console.log(`\n${documents.length} documents, ${champs.length} champs, routage recommandé.`);
  console.log(`Un blanc se voit ; une valeur fausse entre au dossier sans bruit.\n`);
  console.log("  règle                                abst.  faux élim.  justes perdus  échange  livrées  justes livrés  précision livrée       coût");
  for (const b of [...bilans, oracle]) {
    const t = (b as Bilan & { temoinHasard?: { echange: number | null } }).temoinHasard;
    console.log(`  ${b.regle.padEnd(36)} ${String(b.abstentions).padStart(4)}`
      + `  ${String(b.fauxElimines).padStart(13)}  ${String(b.justesSacrifies).padStart(13)}`
      + `  ${String(b.echange ?? "—").padStart(7)}`
      + `  ${String(b.valeursLivrees).padStart(7)}  ${String(b.justesParmiLesLivrees).padStart(13)}`
      + `  ${(b.precisionLivree === null ? "—" : `${b.precisionLivree} % [${b.precisionLivreeIntervalle![0]}–${b.precisionLivreeIntervalle![1]}]`).padStart(21)}`
      + `  ${b.coutTotal.toFixed(1).padStart(6)}`
      + (t ? `  (hasard ${t.echange})` : ""));
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Se taire plutôt que livrer une valeur douteuse : ce que l'échange coûte et rapporte.",
    pourquoi: "Escalader dépasse le plafond de latence sur quatre champs sur cinq, et la seule "
      + "escalade admissible ne complète aucun dossier de plus. L'abstention ne coûte ni "
      + "milliseconde ni euro.",
    echangeMesure: "faux éliminés par juste sacrifié. Une valeur fausse entre au dossier sans "
      + "bruit ; un blanc se voit. L'abstention ne rend pas le système plus juste, elle échange "
      + "de l'erreur invisible contre du trou visible.",
    mesureLe: new Date().toISOString(), journal: f.split("/").slice(-2).join("/"),
    corpus: "hard-corpus", documents: documents.length, champs: champs.length,
    routage: optimum.routing, bilans, oracle,
    prixDeclares: { costWrongValue: ASSUMPTIONS.costWrongValue, costBlankField: ASSUMPTIONS.costBlankField,
      rapport: Number((ASSUMPTIONS.costWrongValue / ASSUMPTIONS.costBlankField).toFixed(3)),
      note: "Les deux sont à égalité dans les hypothèses, délibérément. À ce réglage l'abstention "
        + "est nulle par construction — elle échange une erreur contre un trou au même prix, et "
        + "sacrifie des justes en plus. La conclusion sur l'abstention est donc entièrement "
        + "portée par ce rapport, que le client fixe et que nous ne savons pas fixer." },
    pointDeBascule: bascules,
    limite: `Trente documents. Les comptes de dossiers entiers restent sous le plancher de `
      + `${ENOUGH} en dessous duquel ce dépôt ne publie pas de taux ; la précision livrée, elle, `
      + `porte sur plus de cent valeurs et son intervalle est donné.`,
  }, null, 2) + "\n");
  console.log(`\n  prix déclarés : une valeur fausse ${ASSUMPTIONS.costWrongValue}, un trou `
    + `${ASSUMPTIONS.costBlankField} — rapport ${(ASSUMPTIONS.costWrongValue / ASSUMPTIONS.costBlankField).toFixed(2)}`);
  console.log("  point de bascule — à partir de quel rapport se taire devient rentable :");
  for (const b of bascules) console.log(`    ${b.regle.padEnd(44)} ×${b.rapportDeBascule ?? "—"}`);
  console.log(`\nÉcrit dans ${SORTIE.split("/").pop()}\n`);
}
