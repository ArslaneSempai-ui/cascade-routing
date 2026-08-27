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
 * **Deux budgets, pas un.** Celui du corpus borne le coût ; il ne borne pas la latence, parce
 * que les escalades arrivent en grappes — un document dur est dur sur plusieurs champs à la
 * fois, et le classement par nombre de signaux **aggrave** le groupement au lieu de le diluer.
 * Mesuré : au palier « au moins un signal », les trente documents escaladent tous au moins deux
 * champs et quinze en escaladent quatre ou cinq. Un budget de corpus à 68 % n'est donc pas 68 %
 * étalés, c'est la quasi-totalité de chaque document. Le second budget — au plus *k* champs
 * escaladés sur un même document — est ce qui rend le plafond de latence tenable au lieu de
 * déclaré.
 *
 * **Et la courbe a des marches, pas un continuum.** Les paliers de signal valent 4 et 103 champs
 * sur cent cinquante : un client qui demande 5 % obtient 2,7 %, et un client qui demande 20 %
 * obtient 2,7 % aussi. Les budgets ronds sont rapportés avec le taux **effectif** qu'ils
 * achètent réellement, sans quoi le fichier promet une finesse qui n'existe pas.
 *
 *     npm run escalade
 */

import { writeFileSync } from "node:fs";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { journaux, lireJournal, lireJournalEprouve } from "./journal.ts";
import { normaliserReponse } from "./tiers.ts";
import { corpusDur } from "./corpus-dur.ts";
import { casAmbigus } from "./mesurer-dur.ts";
import { FORME } from "./signal.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS, UNITS, pricePerThousandExtractions } from "./assumptions.ts";

/* La devise des prix, prise à la table qui fait autorité plutôt qu'au clavier. Au niveau du
   module parce que deux fonctions la rendent, et que deux copies divergent. */
const DEVISE = UNITS.pricePerThousandSmall.split("/")[0]!.toUpperCase();
import { optimiseExtraction, paliersMesures } from "./optimise.ts";
import "./figer.ts";  /* pose la table figée : voir figer.ts */
import { FIELDS, draw } from "./corpus.ts";

import type { Tentative } from "./journal.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const SORTIE = fileURLToPath(new URL("../escalade.json", import.meta.url));

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
  /* Un drapeau inconnu fait refuser, il ne se laisse pas avaler : une passe qui tourne avec
     les réglages par défaut et rend un chiffre juste à une question qu'on n'a pas posée est
     un succès qui ment sur ce qu'il a fait. */
  refuserDrapeauxInconnus(["--budget", "--par-doc"]);
  /*
   * Le budget déclaré, écrit AVANT les résultats.
   *
   * Une courbe à plusieurs points donne plusieurs chances de franchir une barre là où une
   * recommandation unique n'en donnait qu'une. La condition se lit donc au budget que le client
   * a déclaré avant la mesure, jamais au point le plus flatteur — et pour que ce soit
   * vérifiable, le budget est un champ du fichier placé avant les colonnes.
   */
  const BUDGET_DECLARE = {
    parCorpusPct: Number(process.argv.find((a) => a.startsWith("--budget="))?.split("=")[1] ?? 10),
    parDocumentMaxChamps: Number(process.argv.find((a) => a.startsWith("--par-doc="))?.split("=")[1] ?? 2),
    declareLe: new Date().toISOString(),
    pourquoi: "Déclaré avant la mesure. Le point retenu s'y réfère ; les autres points de la "
      + "courbe sont là pour montrer la forme, pas pour choisir le plus favorable.",
  };

  const f = journaux().filter((x) => x.includes("-dur.jsonl")).pop();
  const p = readProfiles();
  if (!f || !p) (() => {
    /* UN REFUS A BESOIN D'UNE ISSUE. « journal ou relevé manquant » ne dit ni lequel manque,
       ni quoi lancer — et `data/` n'étant pas versionné, un clone frais tombe TOUJOURS ici.
       C'est le premier écran d'un acheteur sur la commande qui porte notre plus gros levier. */
    console.error(`\n  This computation replays the hard corpus' attempts, and they are not here.`);
    console.error(`  \`data/\` is not versioned: a fresh clone never has any, which is normal.\n`);
    if (!p) console.error(`  The frozen reading is missing too  →  npm run measure`);
    if (!f) console.error(`  The hard corpus journal is missing  →  npm run dur`);
    console.error(`\n  The published figures stay readable: they are frozen in`);
    console.error(`  landing.json and need none of this journal to be quoted.\n`);
    process.exit(1);
  })();
  const { tentatives } = lireJournalEprouve(f, "npm run dur");
  const textes = new Map([...corpusDur(), ...casAmbigus()].map((c) => [c.cle, c.texte]));
  const rep = new Map<string, Tentative>();
  for (const t of tentatives) rep.set(`${t.tier}|${t.caseId}|${t.field}`, t);

  const complets = corpusDur().filter((c) => Object.keys(c.attendus).length === FIELDS.length).map((c) => c.cle);
  const ordre = echelle(p);
  const suivant = (t: TierName) => ordre[Math.min(ordre.length - 1, ordre.indexOf(t) + 1)]!;

  const score = (t: Tentative) => {
    const v = normaliserReponse(t.value);
    let n = 0;
    if (v.length === 0) n++;
    else {
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
  if (!optimum) { console.error("no admissible routing"); process.exit(1); }
  const routage = optimum.routing;

  const champs = complets.flatMap((cas) => FIELDS.map((c) => {
    const base = routage[c];
    const r = rep.get(`${base}|${cas}|${c}`);
    return { cas, champ: c, base, r, score: r ? score(r) : 0 };
  }));
  const total = champs.length;

  /** Mesure un jeu d'escalades, et rend la latence **par document**, pas seulement sa moyenne. */
  const mesurer = (choisis: Set<string>, cible: (b: TierName) => TierName) => {
    let cout = 0, escalades = 0;
    const propre = new Map(complets.map((c) => [c, true]));
    const dureeDoc = new Map(complets.map((c) => [c, 0]));
    for (const x of champs) {
      cout += prix(x.base) / 1000;
      dureeDoc.set(x.cas, dureeDoc.get(x.cas)! + ms(x.base, x.champ));
      let r = x.r;
      if (choisis.has(`${x.cas}|${x.champ}`)) {
        const haut = cible(x.base);
        if (haut !== x.base) {
          escalades++;
          cout += prix(haut) / 1000;
          dureeDoc.set(x.cas, dureeDoc.get(x.cas)! + ms(haut, x.champ));
          r = rep.get(`${haut}|${x.cas}|${x.champ}`) ?? r;
        }
      }
      if (!r || r.outcome !== "clean") propre.set(x.cas, false);
    }
    const durees = [...dureeDoc.values()].sort((a, b) => a - b);
    const q = (part: number) => durees[Math.min(durees.length - 1, Math.floor(part * durees.length))]!;
    return {
      escalades, tauxEffectifPct: Number((100 * escalades / total).toFixed(1)),
      dossiersEntiers: [...propre.values()].filter(Boolean).length,
      prixParMille: Number((1000 * cout / complets.length).toFixed(4)),
      msMoyen: Number((durees.reduce((a, b) => a + b, 0) / durees.length).toFixed(0)),
      msP90: Number(q(0.9).toFixed(0)), msMax: Number(durees[durees.length - 1]!.toFixed(0)),
      /* Ce que la moyenne cachait : combien de documents dépassent le plafond déclaré. */
      documentsAuDessusDuPlafond: durees.filter((d) => d > ASSUMPTIONS.latencyBudgetMs).length,
    };
  };

  /** Trie par score, en respectant le plafond par document. */
  const choisir = (scoreMin: number, kParDoc: number, limite: number) => {
    const pris = new Set<string>();
    const compte = new Map<string, number>();
    for (const x of [...champs].filter((y) => y.score >= scoreMin).sort((a, b) => b.score - a.score)) {
      if (pris.size >= limite) break;
      const n = compte.get(x.cas) ?? 0;
      if (n >= kParDoc) continue;
      pris.add(`${x.cas}|${x.champ}`); compte.set(x.cas, n + 1);
    }
    return pris;
  };

  const alea = draw(20260821);
  const cible = () => "gen-8b" as TierName;
  void suivant;

  /* Les marches réelles du classement, plus le budget déclaré. */
  const marches = [2, 1].map((s) => ({ scoreMin: s, disponibles: champs.filter((x) => x.score >= s).length }));
  const kValeurs = [1, 2, 5];

  console.log(`\n${complets.length} documents, ${total} fields. Escalating to gen-8b.`);
  console.log(`BUDGET DECLARED BEFORE MEASURING: ${BUDGET_DECLARE.parCorpusPct} % of the corpus, `
    + `at most ${BUDGET_DECLARE.parDocumentMaxChamps} fields per document.`);
  console.log(`Latency ceiling: ${ASSUMPTIONS.latencyBudgetMs} ms/document.\n`);
  console.log(`  real steps in the ranking: ${marches.map((m) => `score>=${m.scoreMin} → ${m.disponibles} fields (${(100 * m.disponibles / total).toFixed(1)} %)`).join("  |  ")}\n`);

  const lignes: Record<string, unknown>[] = [];
  /*
   * LA DEVISE EST LUE, PAS TAPÉE. Ces colonnes annonçaient « €/1000 » sur des prix que le
   * modèle déclare en `usd/1000 extractions`. Le même chiffre sortait en dollars dans le
   * README et en euros ici, et une rétractation de ce dépôt cite encore « 0,99 € par
   * millier » — c'est bien ce que l'outil disait.
   *
   * `UNITS` existait déjà et fait autorité. Un rendu qui recopie une unité à la main affirme
   * en silence qu'il sait ce que la source dit ; celui-ci se trompait.
   */
  console.log(`   k/doc  score>=  escal.  eff. rate  whole   random  oracle  ${DEVISE}/1000   ms mean  ms p90   ms max   docs > ceiling`);
  for (const k of kValeurs) {
    for (const m of marches) {
      const g = mesurer(choisir(m.scoreMin, k, total), cible);
      let sommeEntiers = 0;
      for (let i = 0; i < 200; i++) {
        const melange = [...champs].sort(() => alea() - 0.5);
        const pris = new Set<string>(); const compte = new Map<string, number>();
        for (const x of melange) {
          if (pris.size >= g.escalades) break;
          const n = compte.get(x.cas) ?? 0;
          if (n >= k) continue;
          pris.add(`${x.cas}|${x.champ}`); compte.set(x.cas, n + 1);
        }
        sommeEntiers += mesurer(pris, cible).dossiersEntiers;
      }
      const utiles = champs.filter((x) => x.r && x.r.outcome !== "clean"
        && rep.get(`gen-8b|${x.cas}|${x.champ}`)?.outcome === "clean");
      const prisOracle = new Set<string>(); const compteO = new Map<string, number>();
      for (const x of utiles) {
        if (prisOracle.size >= g.escalades) break;
        const n = compteO.get(x.cas) ?? 0;
        if (n >= k) continue;
        prisOracle.add(`${x.cas}|${x.champ}`); compteO.set(x.cas, n + 1);
      }
      const o = mesurer(prisOracle, cible);
      const hasard = Number((sommeEntiers / 200).toFixed(2));
      lignes.push({ kParDocument: k, scoreMin: m.scoreMin, ...g, hasard, oracle: o.dossiersEntiers,
        estLeBudgetDeclare: k === BUDGET_DECLARE.parDocumentMaxChamps
          && g.tauxEffectifPct <= BUDGET_DECLARE.parCorpusPct });
      console.log(`   ${String(k).padStart(5)}  ${String(m.scoreMin).padStart(7)}  ${String(g.escalades).padStart(6)}`
        + `  ${(g.tauxEffectifPct + " %").padStart(9)}  ${String(g.dossiersEntiers).padStart(7)}`
        + `  ${String(hasard).padStart(6)}  ${String(o.dossiersEntiers).padStart(6)}`
        + `  ${g.prixParMille.toFixed(2).padStart(7)}  ${String(g.msMoyen).padStart(7)}`
        + `  ${String(g.msP90).padStart(7)}  ${String(g.msMax).padStart(7)}  ${String(g.documentsAuDessusDuPlafond).padStart(14)}`);
    }
  }

  /*
   * Le meilleur routage fixe ADMISSIBLE, sur ce corpus — coût **et** plafond de latence.
   *
   * La première version de ce bloc ne bornait que le coût. Elle a donc désigné un routage à
   * 3 273 ms par document sous un plafond de 2 000, et ce routage interdit est parti dans un
   * rapport comme s'il gagnait — dans le rapport même qui démontrait que l'escalade tombe pour
   * dépassement de ce plafond. Un chiffre présent dans la prose et absent du relevé est la
   * faute que ce dépôt retire de sa page depuis le matin ; celui-ci était en plus inadmissible.
   */
  const budgetParMille = ASSUMPTIONS.budget / (ASSUMPTIONS.volume / 1000);
  const tousLesRoutages: { routage: Record<Field, TierName>; prixParMille: number;
    msParDocument: number; dossiersEntiers: number; champsJustes: number; admissible: boolean }[] = [];
  const explorer = (i: number, acc: Partial<Record<Field, TierName>>) => {
    if (i === FIELDS.length) {
      const r = acc as Record<Field, TierName>;
      const lat = FIELDS.reduce((a, c) => a + ms(r[c], c), 0);
      const cout = FIELDS.reduce((a, c) => a + prix(r[c]), 0);
      let entiers = 0, justes = 0;
      for (const cas of complets) {
        let ok = true;
        for (const c of FIELDS) {
          const x = rep.get(`${r[c]}|${cas}|${c}`);
          if (x && x.outcome === "clean") justes++; else ok = false;
        }
        if (ok) entiers++;
      }
      tousLesRoutages.push({ routage: r, prixParMille: Number(cout.toFixed(4)),
        msParDocument: Number(lat.toFixed(1)), dossiersEntiers: entiers, champsJustes: justes,
        admissible: lat <= ASSUMPTIONS.latencyBudgetMs && cout <= budgetParMille });
      return;
    }
    for (const t of ordre) explorer(i + 1, { ...acc, [FIELDS[i]!]: t });
  };
  explorer(0, {});
  const admissibles = tousLesRoutages.filter((x) => x.admissible);
  const meilleurChamps = [...admissibles].sort((a, b) =>
    b.champsJustes - a.champsJustes || a.prixParMille - b.prixParMille)[0] ?? null;
  const meilleurEntiers = [...admissibles].sort((a, b) =>
    b.dossiersEntiers - a.dossiersEntiers || b.champsJustes - a.champsJustes || a.prixParMille - b.prixParMille)[0] ?? null;
  const recommande = tousLesRoutages.find((x) => FIELDS.every((c) => x.routage[c] === routage[c])) ?? null;

  console.log(`\n  ${tousLesRoutages.length} routings, ${admissibles.length} admissible `
    + `(latency ≤ ${ASSUMPTIONS.latencyBudgetMs} ms, cost ≤ ${budgetParMille.toFixed(2)} ${DEVISE}/1000)`);
  const dire = (nom: string, x: typeof tousLesRoutages[number] | null) => x && console.log(
    `    ${nom.padEnd(34)} ${FIELDS.map((c) => x.routage[c]).join(", ").padEnd(46)}`
    + ` ${String(x.champsJustes).padStart(3)}/150 fields  ${x.dossiersEntiers}/30 whole`
    + `  ${x.prixParMille.toFixed(2).padStart(5)} ${DEVISE}  ${x.msParDocument.toFixed(0).padStart(5)} ms`);
  dire("recommended (tuned on the clean corpus)", recommande);
  dire("best admissible, by field", meilleurChamps);
  dire("best admissible, by record", meilleurEntiers);

  const retenu = lignes.find((l) => l.estLeBudgetDeclare) ?? null;
  console.log(`\n  point kept at the declared budget: ${retenu ? `${retenu.dossiersEntiers} whole records, ${retenu.tauxEffectifPct} % effective` : "no point respects the declared budget"}`);

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "La courbe de l'escalade, sous deux budgets : celui du corpus et celui de chaque document.",
    budgetDeclare: BUDGET_DECLARE,
    regle: "trier les champs candidats par nombre de signaux gratuits d'accord, escalader du plus "
      + "sûr au moins sûr, sans dépasser k champs sur un même document, s'arrêter au budget.",
    pourquoiDeuxBudgets: "Le budget de corpus borne le coût et pas la latence : les escalades "
      + "arrivent en grappes sur les documents durs, et le classement par signaux aggrave le "
      + "groupement. Au palier « au moins un signal », les trente documents escaladent tous au "
      + "moins deux champs et quinze en escaladent quatre ou cinq. Le plafond par document est ce "
      + "qui rend le plafond de latence tenable au lieu de déclaré.",
    marchesReelles: marches.map((m) => ({ ...m, tauxPct: Number((100 * m.disponibles / total).toFixed(1)) })),
    pasDeContinuum: "Le classement a deux marches utiles, pas un continuum : un client qui demande "
      + "5 % obtient 2,7 %, et un client qui demande 20 % obtient 2,7 % aussi. Les taux effectifs "
      + "sont rapportés à côté des budgets demandés.",
    plafondDeLatenceMs: ASSUMPTIONS.latencyBudgetMs,
    mesureLe: new Date().toISOString(), journal: f.split("/").slice(-2).join("/"),
    documents: complets.length, champs: total, routageFixe: routage, echelleDesPrix: ordre,
    points: lignes, pointRetenu: retenu,
    routagesFixes: {
      quoi: "Tous les routages fixes, avec leur admissibilité sous les deux budgets. L'exactitude "
        + "vient du corpus dur ; le prix et la latence du relevé publié.",
      budgetParMilleEuros: Number(budgetParMille.toFixed(4)),
      plafondLatenceMs: ASSUMPTIONS.latencyBudgetMs,
      total: tousLesRoutages.length, admissibles: admissibles.length,
      recommande, meilleurAdmissibleParChamps: meilleurChamps, meilleurAdmissibleParDossiers: meilleurEntiers,
      choisiSurLesMemesDonnees: "Le meilleur admissible est choisi sur les trente documents qui "
        + "servent à le noter. Son chiffre est donc flatté, exactement comme un prompt réglé sur "
        + "le jeu de test. Ce que la comparaison établit est la fragilité du routage recommandé, "
        + "pas la valeur de cette alternative-là : pour la valider il faudrait une seconde moitié "
        + "de corpus dur, qui n'existe pas.",
    },
    limite: "Trente documents, comptes de dossiers entiers entre zéro et deux. Aucun écart n'est "
      + "départageable et aucun taux n'est publiable depuis ces comptes.",
  }, null, 2) + "\n");
  console.log(`\nWritten to ${SORTIE.split("/").pop()}\n`);
}
