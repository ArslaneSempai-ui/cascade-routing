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
import { isMain } from "./cli.ts";
import { journaux, lireJournal } from "./journal.ts";
import { normaliserReponse } from "./tiers.ts";
import { corpusDur } from "./corpus-dur.ts";
import { casAmbigus } from "./mesurer-dur.ts";

import type { Tentative } from "./journal.ts";

const SORTIE = new URL("../signal.json", import.meta.url).pathname;

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
function temoin(n: number, fausses: number, declenche: number, tirages = 500) {
  let p = 0, r = 0;
  for (let t = 0; t < tirages; t++) {
    /* Un tirage sans remise de `declenche` indices parmi `n`, dont `fausses` sont fausses. */
    let pris = 0, prisFaux = 0;
    for (let i = 0; i < n && pris < declenche; i++) {
      const restants = n - i, aPrendre = declenche - pris;
      if (Math.random() < aPrendre / restants) { pris++; if (i < fausses) prisFaux++; }
    }
    p += pris ? prisFaux / pris : 0;
    r += fausses ? prisFaux / fausses : 0;
  }
  return { precisionMoyenne: Number((p / tirages).toFixed(4)), rappelMoyen: Number((r / tirages).toFixed(4)), tirages };
}

export function evaluerSignal(
  lignes: readonly (Tentative & { faux: boolean })[],
  nom: string, description: string, tire: (t: Tentative) => boolean,
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
    nom, description,
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

  /*
   * Seuls `clean` et `wrong` entrent. Un blanc est déjà visible : il ne demande aucun signal,
   * et l'inclure gonflerait chaque score avec le cas facile.
   */
  const lignes = tentatives
    .filter((t) => t.outcome === "clean" || t.outcome === "wrong")
    .map((t) => ({ ...t, faux: t.outcome === "wrong" }));

  /* Signal 1 : le désaccord. Ce que rend la pluralité des autres paliers sur le même champ. */
  const parCle = new Map<string, Tentative[]>();
  for (const t of tentatives) {
    const k = `${t.caseId}|${t.field}`;
    parCle.set(k, [...(parCle.get(k) ?? []), t]);
  }
  const pluralite = (t: Tentative) => {
    const autres = (parCle.get(`${t.caseId}|${t.field}`) ?? [])
      .filter((x) => x.tier !== t.tier && normaliserReponse(x.value).length > 0);
    const comptes = new Map<string, number>();
    for (const a of autres) {
      const v = normaliserReponse(a.value);
      comptes.set(v, (comptes.get(v) ?? 0) + 1);
    }
    const meilleur = [...comptes].sort((a, b) => b[1] - a[1])[0];
    return meilleur?.[0] ?? null;
  };

  const verdicts = [
    evaluerSignal(lignes, "désaccord",
      "la valeur diffère de celle que rend la pluralité des autres paliers sur le même champ",
      (t) => { const p = pluralite(t); return p !== null && p !== normaliserReponse(t.value); }),
    evaluerSignal(lignes, "forme",
      "la valeur ne passe pas la règle de forme déclarée pour son champ",
      (t) => { const r = FORME[t.field]; return r !== undefined && !r(t.value); }),
    evaluerSignal(lignes, "absente du document",
      "la valeur rendue n'apparaît pas dans le texte du document",
      (t) => {
        const texte = textes.get(t.caseId);
        const v = normaliserReponse(t.value);
        return texte !== undefined && v.length > 0 && !normaliserReponse(texte).includes(v);
      }),
  ];

  /*
   * Les combinaisons, parce que c'est elles qui deviennent une règle d'escalade.
   *
   * Un seul signal ne donne pas une politique : « au moins un » ratisse large et coûte des
   * relectures, « au moins deux » vise juste et laisse passer. Les deux sont calculables ici et
   * seront des paramètres chez le client, qui connaît le prix d'une relecture — pas nous.
   */
  const tirs = [
    (t: Tentative) => { const pl = pluralite(t); return pl !== null && pl !== normaliserReponse(t.value); },
    (t: Tentative) => { const r = FORME[t.field]; return r !== undefined && !r(t.value); },
    (t: Tentative) => {
      const texte = textes.get(t.caseId); const v = normaliserReponse(t.value);
      return texte !== undefined && v.length > 0 && !normaliserReponse(texte).includes(v);
    },
  ];
  const combien = (t: Tentative) => tirs.filter((f) => f(t)).length;
  verdicts.push(
    evaluerSignal(lignes, "au moins un des trois", "l'un quelconque des trois signaux se déclenche",
      (t) => combien(t) >= 1),
    evaluerSignal(lignes, "au moins deux des trois", "deux signaux au moins se déclenchent ensemble",
      (t) => combien(t) >= 2),
    evaluerSignal(lignes, "les trois", "les trois signaux se déclenchent ensemble",
      (t) => combien(t) === 3),
  );

  const base = lignes.filter((l) => l.faux).length / lignes.length;
  console.log(`\n${lignes.length} valeurs notées (les blancs sont exclus : ils se voient déjà).`);
  console.log(`Taux d'erreur de base : ${(100 * base).toFixed(1)} % — c'est la précision qu'atteint un signal au hasard.\n`);
  for (const v of verdicts) {
    console.log(`  ${v.nom.padEnd(22)} tire ${String(v.declenche).padStart(3)}/${lignes.length}`
      + `   précision ${((v.precision ?? 0) * 100).toFixed(1).padStart(5)} %`
      + `   rappel ${((v.rappel ?? 0) * 100).toFixed(1).padStart(5)} %`
      + `   fausses alertes ${String(v.faussesAlertes).padStart(3)}`
      + `   témoin ${(v.temoin.precisionMoyenne * 100).toFixed(1)} %  ${v.bat ? "BAT" : "ne bat pas"}`);
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Quels signaux annoncent une valeur fausse, sans la clé de réponses.",
    mesureLe: new Date().toISOString(), journal: f.split("/").slice(-2).join("/"),
    corpus: "hard-corpus", valeursNotees: lignes.length,
    tauxDErreurDeBase: Number(base.toFixed(4)),
    exclus: "les blancs — un blanc est déjà visible et ne demande aucun signal",
    signaux: verdicts,
    laCleNEstPasNecessaireAuSignal: "Les trois signaux se calculent sur ce que le client possède : "
      + "le document, la valeur rendue, et pour le premier une seconde opinion. La clé n'entre "
      + "que dans la validation ci-dessus. C'est ce qui les rend transposables.",
    limite: "Mesuré sur un corpus de trente à quarante-quatre documents durs. Assez pour écarter "
      + "un signal qui ne bat pas le hasard, pas assez pour estimer sa précision : un intervalle "
      + "sur ces effectifs serait plus large que les écarts entre signaux.",
  }, null, 2) + "\n");
  console.log(`\nÉcrit dans ${SORTIE.split("/").pop()}\n`);
}
