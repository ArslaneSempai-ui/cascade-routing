/**
 * Quels signaux annoncent une valeur fausse — sans la clé de réponses.
 *
 * `cascade` ne cascade pas : il fixe un palier par champ pour tout le lot. Une vraie cascade
 * essaie le moins cher, s'aperçoit qu'il n'est pas sûr **sur ce document-là**, et monte.
 * L'escalade, l'abstention et le routage par document sont la même idée et butent sur la même
 * chose : un signal qui dise « pas sûr ici » alors que chez le client il n'y a pas de clé.
 *
 * Le point qui rend la chose transposable : **le signal n'a jamais besoin de la clé — seule sa
 * validation en a besoin.** Les trois ci-dessous se calculent sur ce que le client possède : le
 * document, la valeur rendue, et éventuellement une seconde opinion. La clé n'entre que dans ce
 * fichier, pour mesurer s'ils valent quelque chose.
 *
 * Mesuré sur les lignes déjà enregistrées : aucune seconde de GPU.
 *
 *     npm run signal
 */

import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";
import { journaux, lireJournal } from "./journal.ts";
import { normaliserReponse, GENERATIFS_PUBLICS } from "./tiers.ts";
import { rate, ENOUGH } from "./interval.ts";
import { draw } from "./corpus.ts";
import { corpusDur } from "./corpus-dur.ts";
import { casAmbigus } from "./mesurer-dur.ts";

import type { Tentative } from "./journal.ts";

const SORTIE = fileURLToPath(new URL("../signal.json", import.meta.url));

/**
 * Le dénominateur, déclaré une fois et employé partout à l'identique.
 *
 * Un taux de relecture est une part **de quoi** : de tous les cas, de toutes les sorties non
 * vides, de tous les échecs ? Les trois donnent des chiffres différents des mêmes données, et
 * comparer deux signaux mesurés sur deux dénominateurs ne compare rien. Ici : **toute valeur
 * notée**, blancs compris.
 *
 * La cible est « inutilisable telle quelle », c'est-à-dire tout ce qui n'est pas `clean` — une
 * valeur fausse comme un blanc demandent tous deux une reprise. Une seconde vue, plus bas,
 * restreint la population aux non-blancs pour répondre à l'autre question, celle des échecs
 * **invisibles** ; elle est nommée comme telle et jamais mélangée à celle-ci.
 */
export const DENOMINATEUR = "toute valeur notée par un palier sur le corpus dur, blancs compris";

/** Les règles de forme, déclarées ici et non apprises de la clé. */
export const FORME: Record<string, (v: string) => boolean> = {
  /* Une date de naissance porte une année à quatre chiffres. */
  birth: (v) => /\b(1[89]|20)\d{2}\b/.test(v),
  /* Un pays n'a pas de chiffres et tient en peu de mots. */
  country: (v) => !/\d/.test(v) && v.trim().split(/\s+/).length <= 4,
  /* Un nom n'a pas de chiffres et tient en cinq mots. */
  name: (v) => !/\d/.test(v) && v.trim().split(/\s+/).length <= 5,
  /* Une adresse porte un numéro ou une virgule. */
  address: (v) => /\d/.test(v) || v.includes(","),
  /* Un type de document n'est pas fait que de chiffres. */
  document: (v) => !/^\d+$/.test(v.trim()),
};

export type Verdict = {
  nom: string; description: string;
  /** Appels de palier supplémentaires qu'il faut payer pour calculer ce signal. */
  coutEnAppels: number;
  declenche: number; justes: number; fausses: number;
  precision: number | null; rappel: number | null;
  faussesAlertes: number; tauxDeFaussesAlertes: number | null;
  temoin: { precisionMoyenne: number; rappelMoyen: number; tirages: number };
  bat: boolean | null;
};

/**
 * Le témoin négatif : un signal tiré au hasard au même taux de déclenchement.
 *
 * Sans lui, n'importe quelle séparation paraît impressionnante. Un signal aléatoire a par
 * construction une précision égale au taux d'erreur de base — donc si le nôtre ne le dépasse
 * pas, il ne sait rien que la moyenne ne sache déjà.
 */
function temoin(n: number, fausses: number, declenche: number, tirages = 500, graine = 20260821) {
  const hasard = draw(graine);
  let p = 0, r = 0;
  for (let t = 0; t < tirages; t++) {
    /* Un tirage sans remise de `declenche` indices parmi `n`, dont `fausses` sont fausses. */
    let pris = 0, prisFaux = 0;
    for (let i = 0; i < n && pris < declenche; i++) {
      const restants = n - i, aPrendre = declenche - pris;
      if (hasard() < aPrendre / restants) { pris++; if (i < fausses) prisFaux++; }
    }
    p += pris ? prisFaux / pris : 0;
    r += fausses ? prisFaux / fausses : 0;
  }
  return { precisionMoyenne: Number((p / tirages).toFixed(4)), rappelMoyen: Number((r / tirages).toFixed(4)), tirages };
}

export function evaluerSignal(
  lignes: readonly (Tentative & { faux: boolean })[],
  nom: string, description: string, tire: (t: Tentative) => boolean,
  coutEnAppels = 0,
): Verdict {
  const n = lignes.length;
  const fausses = lignes.filter((l) => l.faux).length;
  const tirees = lignes.filter(tire);
  const vraiesPositives = tirees.filter((l) => l.faux).length;
  const faussesAlertes = tirees.length - vraiesPositives;
  const justes = n - fausses;
  const t = temoin(n, fausses, tirees.length);
  const precision = tirees.length ? vraiesPositives / tirees.length : null;
  return {
    nom, description, coutEnAppels,
    declenche: tirees.length, justes, fausses,
    precision: precision === null ? null : Number(precision.toFixed(4)),
    rappel: fausses ? Number((vraiesPositives / fausses).toFixed(4)) : null,
    faussesAlertes,
    tauxDeFaussesAlertes: justes ? Number((faussesAlertes / justes).toFixed(4)) : null,
    temoin: t,
    bat: precision === null ? null : precision > t.precisionMoyenne,
  };
}

if (isMain(import.meta)) {
  const f = journaux().filter((x) => x.includes("-dur.jsonl")).pop();
  if (!f) { console.error("aucun journal du corpus dur"); process.exit(1); }
  const { tentatives } = lireJournal(f);
  const textes = new Map([...corpusDur(), ...casAmbigus()].map((c) => [c.cle, c.texte]));

  /* La pluralité des autres paliers sur le même (cas, champ). */
  const parCle = new Map<string, Tentative[]>();
  for (const t of tentatives) {
    const k = `${t.caseId}|${t.field}`;
    parCle.set(k, [...(parCle.get(k) ?? []), t]);
  }
  const pluralite = (t: Tentative) => {
    const comptes = new Map<string, number>();
    for (const a of parCle.get(`${t.caseId}|${t.field}`) ?? []) {
      if (a.tier === t.tier) continue;
      const v = normaliserReponse(a.value);
      if (!v) continue;
      comptes.set(v, (comptes.get(v) ?? 0) + 1);
    }
    return [...comptes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const tire = {
    desaccord: (t: Tentative) => { const p = pluralite(t); return p !== null && p !== normaliserReponse(t.value); },
    forme: (t: Tentative) => { const r = FORME[t.field]; return r !== undefined && normaliserReponse(t.value).length > 0 && !r(t.value); },
    absente: (t: Tentative) => {
      const texte = textes.get(t.caseId); const v = normaliserReponse(t.value);
      return texte !== undefined && v.length > 0 && !normaliserReponse(texte).includes(v);
    },
    blanc: (t: Tentative) => normaliserReponse(t.value).length === 0,
  };
  const combien = (t: Tentative) => [tire.desaccord, tire.forme, tire.absente].filter((g) => g(t)).length;

  /*
   * VUE PRINCIPALE — dénominateur : toute valeur notée. Cible : tout ce qui n'est pas `clean`.
   */
  const toutes = tentatives.map((t) => ({ ...t, faux: t.outcome !== "clean" }));

  const verdicts = [
    /*
     * Le signal-oracle, d'abord, parce que sans lui « aucun signal ne sépare » et « le banc est
     * cassé » rendent exactement la même sortie — et le premier est le résultat le plus probable
     * d'une mesure comme celle-ci. Il lit la clé : il doit séparer parfaitement. S'il échoue,
     * rien de ce qui suit ne veut dire quoi que ce soit.
     */
    evaluerSignal(toutes, "ORACLE (témoin positif)",
      "lit la clé de réponses : doit séparer parfaitement, sinon le banc est en cause", (t) => t.outcome !== "clean"),
    evaluerSignal(toutes, "blanc (référence)",
      "la sortie est vide — référence obligatoire : un blanc se voit sans aucun signal", tire.blanc),
    evaluerSignal(toutes, "désaccord", "diffère de la pluralité des autres paliers sur le même champ",
      tire.desaccord, 1),
    evaluerSignal(toutes, "forme", "échoue à la règle de forme déclarée pour son champ", tire.forme, 0),
    evaluerSignal(toutes, "absente du document", "la valeur ne figure pas dans le texte du document",
      tire.absente, 0),
    evaluerSignal(toutes, "au moins deux des trois", "deux signaux au moins ensemble", (t) => combien(t) >= 2, 1),
    evaluerSignal(toutes, "les trois", "les trois ensemble", (t) => combien(t) === 3, 1),
  ];

  const oracle = verdicts[0]!;
  const bancValide = oracle.precision === 1 && oracle.rappel === 1;

  /*
   * VUE SECONDAIRE — les échecs invisibles seuls. Population restreinte aux non-blancs, cible
   * `wrong`. Elle répond à une autre question et n'est jamais mélangée à la principale.
   */
  const nonBlancs = tentatives.filter((t) => t.outcome !== "blank").map((t) => ({ ...t, faux: t.outcome === "wrong" }));
  const invisibles = [
    evaluerSignal(nonBlancs, "désaccord", "", tire.desaccord, 1),
    evaluerSignal(nonBlancs, "forme", "", tire.forme, 0),
    evaluerSignal(nonBlancs, "absente du document", "", tire.absente, 0),
    evaluerSignal(nonBlancs, "les trois", "", (t) => combien(t) === 3, 1),
  ];

  /*
   * PAR CHAMP, avec intervalle — un taux groupé sur cinq champs cache lequel porte le signal,
   * et sur ces effectifs l'intervalle est plus large que les écarts.
   */
  const champs = [...new Set(tentatives.map((t) => t.field))];
  const parChamp = champs.map((c) => {
    const l = toutes.filter((t) => t.field === c);
    const tirees = l.filter(tire.absente);
    const r = rate(tirees.filter((t) => t.faux).length, tirees.length);
    return { champ: c, valeurs: l.length, declenche: tirees.length,
      precision: tirees.length ? Number((r.rate * 100).toFixed(1)) : null,
      intervalle: tirees.length ? [Number((100 * r.low).toFixed(1)), Number((100 * r.high).toFixed(1))] : null,
      assezDeCas: tirees.length >= ENOUGH };
  });

  /*
   * CE QUE L'ESCALADE RAPPORTERAIT VRAIMENT.
   *
   * « Le bon marché se trompe » ne suffit pas : si le cher se trompe aussi, escalader coûte et
   * ne rapporte rien. Seul le croisement compte — bon marché faux ET cher juste.
   */
  const paires: [string, string][] = [["gen-0.6b", "gen-4b"], ["gen-4b", "gen-8b"], ["large", "gen-4b"]];
  const escalade = paires.map(([bas, haut]) => {
    const parCas = new Map<string, { bas?: Tentative; haut?: Tentative }>();
    for (const t of tentatives) {
      if (t.tier !== bas && t.tier !== haut) continue;
      const k = `${t.caseId}|${t.field}`;
      const e = parCas.get(k) ?? {};
      if (t.tier === bas) e.bas = t; else e.haut = t;
      parCas.set(k, e);
    }
    const communs = [...parCas.values()].filter((e) => e.bas && e.haut);
    const basFaux = communs.filter((e) => e.bas!.outcome !== "clean");
    const gagnants = basFaux.filter((e) => e.haut!.outcome === "clean");
    const inutiles = basFaux.length - gagnants.length;
    /* Et parmi ceux que le signal désigne : l'escalade guidée rapporte-t-elle plus que le hasard
       à dépense égale ? Le témoin escalade le même nombre de cas, tirés au sort. */
    const designes = communs.filter((e) => combien(e.bas!) >= 2);
    const gagnesParSignal = designes.filter((e) => e.bas!.outcome !== "clean" && e.haut!.outcome === "clean").length;
    let hasard = 0;
    const tirages = 500;
    const alea = draw(20260821);
    for (let k = 0; k < tirages; k++) {
      const melange = [...communs].sort(() => alea() - 0.5).slice(0, designes.length);
      hasard += melange.filter((e) => e.bas!.outcome !== "clean" && e.haut!.outcome === "clean").length;
    }
    return {
      bas, haut, champsCommuns: communs.length,
      basFaux: basFaux.length,
      escaladeUtile: gagnants.length,
      escaladeInutile: inutiles,
      partUtileParmiLesEchecs: basFaux.length ? Number((gagnants.length / basFaux.length).toFixed(4)) : null,
      guideeParSignal: { escalades: designes.length, gagnes: gagnesParSignal },
      temoinHasardMemeDepense: { escalades: designes.length, gagnesMoyen: Number((hasard / tirages).toFixed(2)) },
      batLeHasard: gagnesParSignal > hasard / tirages,
    };
  });

  /*
   * La confiance émise par le modèle : zéro trouvé n'est pas zéro cherché.
   *
   * CE COMPTE ÉTAIT `filter(() => false)`. Le chiffre était juste — aucun palier n'expose de
   * confiance, et le rapport le dit — mais la forme était un prédicat constant déguisé en
   * calcul : le jour où quelqu'un ajouterait les log-probabilités à l'appel, ce zéro serait
   * resté zéro, et la phrase « aucun palier n'expose de confiance » aurait continué à
   * s'imprimer sous un palier qui en expose une. Une garde qui ne peut plus discriminer a
   * cessé d'être une garde ; elle en garde seulement l'apparence, ce qui est pire que rien.
   *
   * On le dérive donc de la source qui décide : un palier n'expose une confiance que si
   * l'appel de génération la DEMANDE. `tiers.ts` est le seul endroit où cet appel est écrit.
   */
  const appelGeneratif = readFileSync(fileURLToPath(new URL("./tiers.ts", import.meta.url)), "utf8");
  const demandeUneConfiance = /\b(logprobs|top_logprobs|top_k_logits|return_logits)\b/.test(appelGeneratif);
  const exposantUneConfiance = GENERATIFS_PUBLICS.filter(() => demandeUneConfiance).length;

  const cible = toutes.filter((t) => t.faux).length;
  console.log(`\nDénominateur : ${DENOMINATEUR} — ${toutes.length} valeurs.`);
  console.log(`Cible : tout ce qui n'est pas \`clean\` — ${cible} valeurs, soit ${(100 * cible / toutes.length).toFixed(1)} %.`);
  console.log(`C'est aussi la précision qu'atteint un signal tiré au hasard.\n`);
  for (const v of verdicts) {
    console.log(`  ${v.nom.padEnd(24)} tire ${String(v.declenche).padStart(3)}`
      + `  précision ${((v.precision ?? 0) * 100).toFixed(1).padStart(5)} %`
      + `  rappel ${((v.rappel ?? 0) * 100).toFixed(1).padStart(5)} %`
      + `  fausses alertes ${String(v.faussesAlertes).padStart(3)}`
      + `  appels +${v.coutEnAppels}`
      + `  ${v.bat ? "bat le hasard" : "ne bat pas"}`);
  }
  console.log(`\n  banc valide (l'oracle sépare parfaitement) : ${bancValide ? "OUI" : "NON — rien au-dessus ne vaut"}`);
  console.log(`  paliers exposant une confiance : ${exposantUneConfiance} sur ${GENERATIFS_PUBLICS.length} examinés\n`);
  console.log("  ce que l'escalade rapporterait :");
  for (const e of escalade) {
    console.log(`    ${e.bas} → ${e.haut}   ${e.bas} rate ${e.basFaux}, dont ${e.haut} sauve ${e.escaladeUtile}`
      + ` (${(100 * (e.partUtileParmiLesEchecs ?? 0)).toFixed(0)} %) — ${e.escaladeInutile} escalades pour rien`);
    console.log(`      guidée par signal : ${e.guideeParSignal.escalades} escalades, ${e.guideeParSignal.gagnes} gains`
      + `  |  hasard à dépense égale : ${e.temoinHasardMemeDepense.gagnesMoyen}  → ${e.batLeHasard ? "BAT" : "ne bat pas"}`);
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Quels signaux annoncent une valeur inutilisable, sans la clé de réponses.",
    mesureLe: new Date().toISOString(), journal: f.split("/").slice(-2).join("/"),
    corpus: "hard-corpus",
    denominateur: DENOMINATEUR, valeurs: toutes.length,
    cible: "tout ce qui n'est pas `clean`", cibleN: cible,
    tauxDeBase: Number((cible / toutes.length).toFixed(4)),
    bancValide, oracle,
    signaux: verdicts,
    vueDesEchecsInvisibles: {
      quoi: "population restreinte aux non-blancs, cible `wrong` — les échecs qu'on ne voit pas.",
      valeurs: nonBlancs.length, signaux: invisibles,
    },
    parChampDuMeilleurSignal: parChamp,
    escalade,
    confianceDuModele: {
      paliersExamines: GENERATIFS_PUBLICS.length, paliersExposantUneConfiance: exposantUneConfiance,
      pourquoi: "L'appel de génération ne demande ni ne conserve les log-probabilités : aucun "
        + "palier n'expose de confiance dans l'état actuel. Zéro trouvé n'est pas zéro cherché, "
        + "et un signal absent du rapport ne se distingue pas d'un signal jamais regardé.",
      coutPourLObtenir: "remesurer les paliers génératifs en conservant les log-probabilités — "
        + "environ cinq minutes pour `gen-4b` seul, quarante pour les trois.",
    },
    laCleNEstPasNecessaireAuSignal: "Les trois signaux se calculent sur ce que le client possède : "
      + "le document, la valeur rendue, et pour le premier une seconde opinion. La clé n'entre "
      + "que dans la validation. C'est ce qui les rend transposables.",
    limite: "Trente à quarante-quatre documents durs. Assez pour écarter un signal qui ne bat pas "
      + "le hasard, pas pour estimer une précision : les intervalles par champ ci-dessus sont plus "
      + "larges que les écarts entre signaux. Et le taux de base ici est celui d'un corpus cassé ; "
      + "sur trafic propre il est bien plus bas, et toute précision baisse avec lui.",
    seuilRegleSurCeCorpus: "Un seuil d'escalade réglé sur ces mêmes documents utiliserait les "
      + "données qui bornent son intervalle. Sur ces effectifs, le routage par document peut être "
      + "non validable sur les données disponibles même s'il fonctionne — ce qui n'est pas une "
      + "raison de le déclarer bon, ni mauvais.",
  }, null, 2) + "\n");
  console.log(`\nÉcrit dans ${SORTIE.split("/").pop()}\n`);
}
