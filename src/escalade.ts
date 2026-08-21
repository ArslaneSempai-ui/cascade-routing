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
import { FIELDS } from "./corpus.ts";

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

  /* Réponses indexées : (palier, cas, champ). */
  const rep = new Map<string, Tentative>();
  for (const t of tentatives) rep.set(`${t.tier}|${t.caseId}|${t.field}`, t);

  /* Seuls les documents à cinq champs : un dossier entier n'a de sens que complet. */
  const complets = corpusDur().filter((c) => Object.keys(c.attendus).length === FIELDS.length).map((c) => c.cle);
  const ordre = echelle(p);
  const suivant = (t: TierName) => ordre[Math.min(ordre.length - 1, ordre.indexOf(t) + 1)]!;

  const suspect = (t: Tentative) => {
    const v = normaliserReponse(t.value);
    if (v.length === 0) return false;                      // un blanc n'est pas ce signal-ci
    const texte = textes.get(t.caseId);
    const absente = texte !== undefined && !normaliserReponse(texte).includes(v);
    const regle = FORME[t.field];
    const malForme = regle !== undefined && !regle(t.value);
    return absente || malForme;
  };

  /* Prix et latence par champ, pris du relevé publié — machine au repos, durées mesurées.
     Les durées du corpus dur ne servent pas ici : elles décrivent d'autres documents. */
  const prix = (t: TierName) => pricePerThousandExtractions(t, ASSUMPTIONS, p.extraction[t][FIELDS[0]!]!.latency);
  const ms = (t: TierName, c: Field) => p.extraction[t][c]!.latency;

  type Colonne = { nom: string; dossiersEntiers: number; escalades: number;
    prixParMille: number; msParDocument: number };

  const evaluerRoutage = (
    nom: string, routage: Record<Field, TierName>, escalade?: (t: Tentative) => boolean,
  ): Colonne => {
    let entiers = 0, escalades = 0, cout = 0, duree = 0;
    for (const cas of complets) {
      let propre = true;
      for (const c of FIELDS) {
        const base = routage[c];
        let r = rep.get(`${base}|${cas}|${c}`);
        cout += prix(base) / 1000; duree += ms(base, c);
        if (r && escalade && escalade(r)) {
          const haut = suivant(base);
          if (haut !== base) {
            escalades++;
            cout += prix(haut) / 1000; duree += ms(haut, c);
            r = rep.get(`${haut}|${cas}|${c}`) ?? r;
          }
        }
        if (!r || r.outcome !== "clean") propre = false;
      }
      if (propre) entiers++;
    }
    return { nom, dossiersEntiers: entiers, escalades,
      prixParMille: Number((1000 * cout / complets.length).toFixed(4)),
      msParDocument: Number((duree / complets.length).toFixed(1)) };
  };

  const optimum = optimiseExtraction(p, ASSUMPTIONS);
  if (!optimum) { console.error("aucun routage admissible"); process.exit(1); }
  const routage = optimum.routing;

  const fixe = evaluerRoutage("1. routage fixe actuel", routage);
  const guidee = evaluerRoutage("2. cascade guidée (forme + absence)", routage, suspect);

  /*
   * La règle demandée ignore les blancs, et sur ce routage c'est presque tout l'échec.
   *
   * `rules` porte trois champs sur cinq et échoue 133 fois par blanc contre une seule fois par
   * valeur fausse. Deux signaux qui ne regardent que les valeurs rendues ne peuvent rien y
   * voir : la cascade guidée ne se déclenche que six fois sur cent cinquante. Or le blanc est
   * le signal gratuit le plus précis du banc — 82,9 %. L'exclure de la règle n'était pas un
   * choix, c'était l'angle mort de la règle.
   */
  const suspectOuVide = (t: Tentative) =>
    normaliserReponse(t.value).length === 0 || suspect(t);
  const guideeAvecBlancs = evaluerRoutage("2b. cascade guidée, blancs compris", routage, suspectOuVide);

  /* Et une escalade qui monte au sommet plutôt que d'un cran : un cran depuis `rules` mène à
     `gen-0.6b`, ce qui peut être trop court pour sauver quoi que ce soit. */
  const sommet = ordre[ordre.length - 1]!;
  const versLeSommet = (() => {
    let entiers = 0, escalades = 0, cout = 0, duree = 0;
    for (const cas of complets) {
      let propre = true;
      for (const c of FIELDS) {
        const base = routage[c];
        let r = rep.get(`${base}|${cas}|${c}`);
        cout += prix(base) / 1000; duree += ms(base, c);
        if (r && suspectOuVide(r) && base !== "gen-8b") {
          escalades++;
          cout += prix("gen-8b" as TierName) / 1000; duree += ms("gen-8b" as TierName, c);
          r = rep.get(`gen-8b|${cas}|${c}`) ?? r;
        }
        if (!r || r.outcome !== "clean") propre = false;
      }
      if (propre) entiers++;
    }
    return { nom: "2c. cascade vers gen-8b, blancs compris", dossiersEntiers: entiers, escalades,
      prixParMille: Number((1000 * cout / complets.length).toFixed(4)),
      msParDocument: Number((duree / complets.length).toFixed(1)) };
  })();
  void sommet;

  /* Témoin : escalader le même nombre de champs, tirés au sort. */
  const cible = guideeAvecBlancs.escalades;
  const tirages = 200;
  let sommeEntiers = 0, sommePrix = 0, sommeMs = 0;
  for (let k = 0; k < tirages; k++) {
    const tous: string[] = [];
    for (const cas of complets) for (const c of FIELDS) tous.push(`${cas}|${c}`);
    const choisis = new Set(tous.sort(() => Math.random() - 0.5).slice(0, cible));
    const col = evaluerRoutage("hasard", routage, (t) => choisis.has(`${t.caseId}|${t.field}`));
    sommeEntiers += col.dossiersEntiers; sommePrix += col.prixParMille; sommeMs += col.msParDocument;
  }
  const hasard: Colonne = { nom: "3. cascade au hasard, même nombre d'escalades que 2b",
    dossiersEntiers: Number((sommeEntiers / tirages).toFixed(2)), escalades: cible,
    prixParMille: Number((sommePrix / tirages).toFixed(4)), msParDocument: Number((sommeMs / tirages).toFixed(1)) };

  /* Oracle : escalader exactement quand le palier du dessus sauve la valeur. */
  const oracle = evaluerRoutage("4. oracle (plafond)", routage, (t) => {
    if (t.outcome === "clean") return false;
    const haut = rep.get(`${suivant(t.tier as TierName)}|${t.caseId}|${t.field}`);
    return haut?.outcome === "clean";
  });

  /* La colonne la plus dure : le meilleur routage FIXE au budget de la cascade guidée. */
  let meilleurFixe: Colonne | null = null;
  const tiers = ordre;
  const parcours = (i: number, acc: Partial<Record<Field, TierName>>) => {
    if (i === FIELDS.length) {
      const col = evaluerRoutage("5. meilleur routage fixe au même budget", acc as Record<Field, TierName>);
      if (col.prixParMille <= guidee.prixParMille
        && (!meilleurFixe || col.dossiersEntiers > meilleurFixe.dossiersEntiers
          || (col.dossiersEntiers === meilleurFixe.dossiersEntiers && col.prixParMille < meilleurFixe.prixParMille))) {
        meilleurFixe = col;
      }
      return;
    }
    for (const t of tiers) parcours(i + 1, { ...acc, [FIELDS[i]!]: t });
  };
  parcours(0, {});

  const colonnes = [fixe, guidee, guideeAvecBlancs, versLeSommet, hasard, oracle,
    ...(meilleurFixe ? [meilleurFixe as Colonne] : [])];
  console.log(`\n${complets.length} documents à cinq champs, corpus dur. Échelle : ${ordre.join(" < ")}`);
  console.log(`Routage fixe : ${FIELDS.map((c) => `${c}→${routage[c]}`).join("  ")}\n`);
  for (const col of colonnes) {
    console.log(`  ${col.nom.padEnd(38)} ${String(col.dossiersEntiers).padStart(5)}/${complets.length} entiers`
      + `   ${String(col.escalades).padStart(3)} escalades`
      + `   ${col.prixParMille.toFixed(2).padStart(7)} €/1000`
      + `   ${col.msParDocument.toFixed(0).padStart(6)} ms/doc`);
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "La cascade guidée vaut-elle son second appel ?",
    regle: "pour chaque champ : lancer le palier retenu ; si la valeur est absente du document "
      + "ou implausible de forme, relancer sur le palier au-dessus ; garder la seconde. Aucun seuil.",
    sansParametre: "Les deux signaux sont binaires : rien à régler, donc rien à surajuster. "
      + "L'objection du seuil réglé sur le corpus qui borne son propre intervalle ne s'applique pas.",
    mesureLe: new Date().toISOString(), journal: f.split("/").slice(-2).join("/"),
    documents: complets.length, echelle: ordre, routageFixe: routage,
    colonnes,
    doubleOrigine: "L'exactitude vient des lignes du corpus dur ; le prix et la latence viennent "
      + "des latences du relevé publié, mesurées sur machine au repos. Les durées du corpus dur "
      + "décrivent d'autres documents et ne serviraient pas ici.",
    limite: "Trente documents. Un écart d'un ou deux dossiers entiers n'est pas départageable "
      + "sur cet effectif, et aucun taux n'est publiable depuis ces comptes.",
  }, null, 2) + "\n");
  console.log(`\nÉcrit dans ${SORTIE.split("/").pop()}\n`);
}
