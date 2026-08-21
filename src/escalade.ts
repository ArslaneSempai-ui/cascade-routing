/**
 * `cascade` peut-il porter son nom ?
 *
 * Aujourd'hui il ne cascade pas : il fixe un palier par champ pour tout le lot. Une cascade
 * essaie le moins cher, s'aperçoit qu'il n'est pas sûr **sur ce document-là**, et monte.
 *
 * La règle mesurée ici n'a **aucun paramètre**, et c'est délibéré. Les deux signaux gratuits
 * — forme implausible, valeur absente du document — sont binaires : rien à régler, donc rien à
 * surajuster. Un seuil réglé sur ce corpus utiliserait les données mêmes qui bornent son
 * intervalle ; une règle sans seuil échappe à l'objection au lieu de la contourner.
 *
 *     pour chaque champ : lancer le palier retenu ; si la valeur est absente du document
 *     ou implausible de forme, relancer sur le palier au-dessus ; garder la seconde.
 *
 * Quatre colonnes, parce que deux ne prouvent rien :
 *
 *   1. le routage fixe actuel,
 *   2. la cascade guidée,
 *   3. la cascade **au hasard à dépense égale** — sans quoi un gain se confond avec une dépense,
 *   4. l'oracle, qui donne le plafond.
 *
 * Et une cinquième, la plus dure : **le meilleur routage fixe au budget de la cascade**. Une
 * cascade qui ne bat pas ce qu'on achèterait en montant simplement d'un palier ne vaut rien,
 * même si elle bat le routage d'origine.
 *
 * Et ce n'est pas une cascade qu'on mesure mais une **courbe**. Le nombre de signaux d'accord
 * est un classement, mesuré et monotone sur les signaux gratuits : deux signaux, 100 % de cas
 * inutilisables sur trente-deux ; un seul, 86,9 % sur trois cent quatre-vingt-dix-huit ; aucun,
 * 39 %. On peut donc trier les escalades candidates de la plus sûre à la moins sûre et s'arrêter
 * quand un budget d'escalade — un pourcentage de champs, fixé du dehors comme le plafond de
 * latence — est épuisé.
 *
 * Le désaccord entre paliers est **exclu du classement**, bien qu'il figure dans le banc : le
 * calculer demande de lancer un second palier, donc il ne peut pas décider s'il faut en lancer
 * un. Les trois qui restent — blanc, forme, absence — ne coûtent rien.
 *
 * Ce que la courbe doit dire : **où elle s'aplatit**. Si les dossiers entiers cessent de monter
 * après 3 %, on vend « 3 % d'escalade, et voici ce que ça achète ». Si elle ne monte pas du
 * tout, l'escalade ne vaut rien, et on l'aura su sans une seconde de GPU.
 *
 *     npm run escalade
 */

import { writeFileSync } from "node:fs";
import { isMain } from "./cli.ts";
import { journaux, lireJournal } from "./journal.ts";
import { normaliserReponse } from "./tiers.ts";
import { corpusDur } from "./corpus-dur.ts";
import { casAmbigus } from "./mesurer-dur.ts";
import { FORME } from "./signal.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS, pricePerThousandExtractions } from "./assumptions.ts";
import { optimiseExtraction, paliersMesures } from "./optimise.ts";
import { FIELDS, draw } from "./corpus.ts";

import type { Tentative } from "./journal.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";

const SORTIE = new URL("../escalade.json", import.meta.url).pathname;

export type Issue = { outcome: string; value: string };

/** L'échelle d'escalade : par prix croissant, pris du relevé publié. */
export function echelle(p: NonNullable<ReturnType<typeof readProfiles>>): TierName[] {
  return paliersMesures(p)
    .filter((t) => t !== "human")
    .map((t) => ({ t, prix: pricePerThousandExtractions(t, ASSUMPTIONS, p.extraction[t][FIELDS[0]!]!.latency) }))
    .sort((a, b) => a.prix - b.prix)
    .map((x) => x.t);
}

if (isMain(import.meta)) {
  const f = journaux().filter((x) => x.includes("-dur.jsonl")).pop();
  const p = readProfiles();
  if (!f || !p) { console.error("journal ou relevé manquant"); process.exit(1); }
  const { tentatives } = lireJournal(f);
  const textes = new Map([...corpusDur(), ...casAmbigus()].map((c) => [c.cle, c.texte]));

  const rep = new Map<string, Tentative>();
  for (const t of tentatives) rep.set(`${t.tier}|${t.caseId}|${t.field}`, t);

  const complets = corpusDur().filter((c) => Object.keys(c.attendus).length === FIELDS.length).map((c) => c.cle);
  const ordre = echelle(p);
  const suivant = (t: TierName) => ordre[Math.min(ordre.length - 1, ordre.indexOf(t) + 1)]!;

  /** Combien de signaux gratuits s'accordent — le classement, de 0 à 2. */
  const score = (t: Tentative) => {
    const v = normaliserReponse(t.value);
    let n = 0;
    if (v.length === 0) n++;
    if (v.length > 0) {
      const texte = textes.get(t.caseId);
      if (texte !== undefined && !normaliserReponse(texte).includes(v)) n++;
      const r = FORME[t.field];
      if (r !== undefined && !r(t.value)) n++;
    }
    return n;
  };

  const prix = (t: TierName) => pricePerThousandExtractions(t, ASSUMPTIONS, p.extraction[t][FIELDS[0]!]!.latency);
  const ms = (t: TierName, c: Field) => p.extraction[t][c]!.latency;

  const optimum = optimiseExtraction(p, ASSUMPTIONS);
  if (!optimum) { console.error("aucun routage admissible"); process.exit(1); }
  const routage = optimum.routing;

  /** Tous les champs du corpus complet, avec leur score et leur réponse de base. */
  const champs = complets.flatMap((cas) => FIELDS.map((c) => {
    const base = routage[c];
    const r = rep.get(`${base}|${cas}|${c}`);
    return { cas, champ: c, base, r, score: r ? score(r) : 0 };
  }));
  const total = champs.length;

  type Point = { budgetPct: number; escalades: number; dossiersEntiers: number;
    prixParMille: number; msParDocument: number };

  /** Mesure un jeu d'escalades donné, quelle que soit la façon dont il a été choisi. */
  const mesurer = (choisis: Set<string>, cible: (base: TierName) => TierName): Point => {
    let cout = 0, duree = 0, escalades = 0;
    const propre = new Map<string, boolean>(complets.map((c) => [c, true]));
    for (const x of champs) {
      cout += prix(x.base) / 1000; duree += ms(x.base, x.champ);
      let r = x.r;
      const k = `${x.cas}|${x.champ}`;
      if (choisis.has(k)) {
        const haut = cible(x.base);
        if (haut !== x.base) {
          escalades++;
          cout += prix(haut) / 1000; duree += ms(haut, x.champ);
          r = rep.get(`${haut}|${x.cas}|${x.champ}`) ?? r;
        }
      }
      if (!r || r.outcome !== "clean") propre.set(x.cas, false);
    }
    return { budgetPct: Number((100 * escalades / total).toFixed(1)), escalades,
      dossiersEntiers: [...propre.values()].filter(Boolean).length,
      prixParMille: Number((1000 * cout / complets.length).toFixed(4)),
      msParDocument: Number((duree / complets.length).toFixed(1)) };
  };

  /* Trié du plus sûr au moins sûr ; à score égal, ordre stable du corpus. */
  const classe = [...champs].filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const alea = draw(20260821);

  const budgets = [0, 3, 10, 20, 100];
  const echelles: [string, (b: TierName) => TierName][] = [
    ["un cran", suivant],
    ["vers gen-8b", () => "gen-8b" as TierName],
  ];

  const courbes = echelles.map(([nomEchelle, cible]) => ({
    echelle: nomEchelle,
    points: budgets.map((b) => {
      const n = b === 100 ? classe.length : Math.floor(total * b / 100);
      const guidee = mesurer(new Set(classe.slice(0, n).map((x) => `${x.cas}|${x.champ}`)), cible);

      /* Témoin : le même nombre d'escalades, tirées au sort parmi tous les champs. */
      let sommeEntiers = 0, sommePrix = 0;
      const tirages = 200;
      for (let k = 0; k < tirages; k++) {
        const melange = [...champs].sort(() => alea() - 0.5).slice(0, n);
        const c2 = mesurer(new Set(melange.map((x) => `${x.cas}|${x.champ}`)), cible);
        sommeEntiers += c2.dossiersEntiers; sommePrix += c2.prixParMille;
      }
      /* Oracle : parmi les champs où l'escalade sauverait vraiment, les n premiers. */
      const utiles = champs.filter((x) => {
        if (!x.r || x.r.outcome === "clean") return false;
        return rep.get(`${cible(x.base)}|${x.cas}|${x.champ}`)?.outcome === "clean";
      });
      const oracle = mesurer(new Set(utiles.slice(0, n).map((x) => `${x.cas}|${x.champ}`)), cible);

      return { budgetDemandePct: b, guidee,
        hasard: { dossiersEntiers: Number((sommeEntiers / tirages).toFixed(2)),
          prixParMille: Number((sommePrix / tirages).toFixed(4)) },
        oracle: { dossiersEntiers: oracle.dossiersEntiers, escalades: oracle.escalades,
          candidatsUtiles: utiles.length } };
    }),
  }));

  /* La comparaison difficile : le meilleur routage FIXE au coût de chaque point guidé. */
  const meilleurFixeAu = (budget: number) => {
    let best: { routage: Record<Field, TierName>; entiers: number; prix: number } | null = null;
    const parcours = (i: number, acc: Partial<Record<Field, TierName>>) => {
      if (i === FIELDS.length) {
        const r = acc as Record<Field, TierName>;
        let cout = 0; const propre = new Map(complets.map((c) => [c, true]));
        for (const cas of complets) for (const c of FIELDS) {
          cout += prix(r[c]) / 1000;
          if (rep.get(`${r[c]}|${cas}|${c}`)?.outcome !== "clean") propre.set(cas, false);
        }
        const prixMille = 1000 * cout / complets.length;
        const entiers = [...propre.values()].filter(Boolean).length;
        if (prixMille <= budget && (!best || entiers > best.entiers
          || (entiers === best.entiers && prixMille < best.prix))) best = { routage: r, entiers, prix: Number(prixMille.toFixed(4)) };
        return;
      }
      for (const t of ordre) parcours(i + 1, { ...acc, [FIELDS[i]!]: t });
    };
    parcours(0, {});
    return best as { routage: Record<Field, TierName>; entiers: number; prix: number } | null;
  };

  console.log(`\n${complets.length} documents, ${total} champs. Classement par signaux gratuits (0 à 2).`);
  console.log(`Routage fixe : ${FIELDS.map((c) => `${c}→${routage[c]}`).join("  ")}\n`);
  const dur: Record<string, unknown> = {};
  for (const c of courbes) {
    console.log(`  escalade « ${c.echelle} »`);
    console.log(`    budget   escal.   entiers   hasard   oracle   €/1000   ms/doc   meilleur fixe au même coût`);
    for (const pt of c.points) {
      const mf = meilleurFixeAu(pt.guidee.prixParMille);
      dur[`${c.echelle}|${pt.budgetDemandePct}`] = mf;
      console.log(`    ${String(pt.budgetDemandePct).padStart(4)} %`
        + `   ${String(pt.guidee.escalades).padStart(5)}`
        + `   ${String(pt.guidee.dossiersEntiers).padStart(7)}`
        + `   ${String(pt.hasard.dossiersEntiers).padStart(6)}`
        + `   ${String(pt.oracle.dossiersEntiers).padStart(6)}`
        + `   ${pt.guidee.prixParMille.toFixed(2).padStart(6)}`
        + `   ${pt.guidee.msParDocument.toFixed(0).padStart(6)}`
        + `   ${mf ? `${mf.entiers} à ${mf.prix.toFixed(2)} €` : "—"}`);
    }
    console.log();
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "La courbe de l'escalade : combien de dossiers entiers par point de budget.",
    regle: "trier les champs candidats par nombre de signaux gratuits d'accord, escalader du plus "
      + "sûr au moins sûr, s'arrêter au budget. Le budget est un pourcentage de champs, fixé du "
      + "dehors comme le plafond de latence.",
    classement: "blanc, forme implausible, valeur absente du document — tous gratuits. Le désaccord "
      + "entre paliers est exclu : le calculer exige un second appel, donc il ne peut pas décider "
      + "s'il faut en faire un.",
    monotone: { deuxSignaux: { cas: 32, precision: 1.0 }, unSignal: { cas: 398, precision: 0.869 },
      aucun: { cas: 554, precision: 0.39 },
      reserve: "Le 100 % du point le plus sûr porte sur trente-deux cas. C'est un chiffre sur "
        + "trente-deux tirages, pas une garantie." },
    mesureLe: new Date().toISOString(), journal: f.split("/").slice(-2).join("/"),
    documents: complets.length, champs: total, echelleDesPrix: ordre, routageFixe: routage,
    courbes, meilleurRoutageFixeAuMemeCout: dur,
    doubleOrigine: "L'exactitude vient des lignes du corpus dur ; le prix et la latence viennent "
      + "des latences du relevé publié, prises sur machine au repos.",
    limite: "Trente documents et des comptes de dossiers entiers entre zéro et deux. Aucun écart "
      + "n'est départageable, et aucun taux n'est publiable depuis ces comptes.",
  }, null, 2) + "\n");
  console.log(`Écrit dans ${SORTIE.split("/").pop()}\n`);
}
