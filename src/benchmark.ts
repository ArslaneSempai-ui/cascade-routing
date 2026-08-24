/**
 * Les mesures sur des jeux publics — la seule preuve que la méthode sort d'ici.
 *
 * Tout le reste de ce dépôt mesure un corpus que j'ai écrit. C'est l'objection que chaque
 * lecteur soulève, et elle est juste : un découpage défend contre le fait de noter sa propre
 * copie, il ne transforme pas des documents inventés en documents réels.
 *
 * Ce fichier fait tourner la même mesure — même évaluateur, mêmes intervalles, mêmes
 * références triviales — sur des jeux annotés que quelqu'un d'autre a publiés, avec les
 * étiquettes de quelqu'un d'autre et ses bizarreries.
 *
 * ─── Ce qui est versionné, et ce qui ne l'est pas ───
 *
 * Le jeu de données n'entre pas dans le dépôt : il a sa licence, son poids et son propre
 * dépôt. Ce qui entre, c'est **de quoi le retrouver et refaire le calcul** — l'adresse exacte,
 * l'empreinte du fichier tel qu'il a été mesuré, la commande, et le relevé brut. Un lecteur
 * qui refait la manipulation doit obtenir les mêmes chiffres ou savoir pourquoi.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isMain } from "./cli.ts";
import { loadClassifiers, loadGeneratifs, classerParmi } from "./tiers.ts";
import { ENCODEURS, GENERATIFS } from "./paliers.ts";
import { rate, writeRate, distinguishable } from "./interval.ts";
import { lireCsv } from "./your-cases.ts";

import type { TierName } from "./paliers.ts";
import { fileURLToPath } from "node:url";

/**
 * Les jeux mesurés, avec ce qu'il faut pour les citer honnêtement.
 *
 * La licence et la citation ne sont pas de la politesse : BANKING77 est en CC-BY-4.0 et son
 * article demande explicitement à être cité. Publier un chiffre tiré d'un jeu sans dire d'où
 * il vient, c'est la même faute que publier une exactitude sans son échantillon.
 */
export const JEUX = {
  banking77: {
    quoi: "3 080 messages réels de clients d'une banque, étiquetés en 77 intentions",
    url: "https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data/test.csv",
    licence: "CC-BY-4.0",
    citation: "Casanueva, Temcinas, Gerz, Henderson, Vulic — «Efficient Intent Detection with "
      + "Dual Sentence Encoders», 2nd Workshop on NLP for ConvAI, ACL 2020. arXiv:2003.04807",
    tache: "classify" as const,
    pourquoi: "Aucun palier de ce dépôt n'a été entraîné dessus, et 77 classes contre les 5 de "
      + "la démonstration sont une vraie mise à l'épreuve. Les messages sont écrits par des "
      + "clients, pas par moi.",
  },
} as const;

export type NomJeu = keyof typeof JEUX;

const DOSSIER = fileURLToPath(new URL("../benchmarks/", import.meta.url));

/** Le fichier, téléchargé une fois et laissé hors du dépôt. */
function recuperer(nom: NomJeu): { chemin: string; empreinte: string } {
  const j = JEUX[nom];
  mkdirSync(DOSSIER + "data", { recursive: true });
  const chemin = `${DOSSIER}data/${nom}.csv`;
  if (!existsSync(chemin)) {
    console.log(`downloading ${nom} from ${j.url}`);
    execFileSync("curl", ["-sL", "-o", chemin, j.url]);
  }
  const empreinte = createHash("sha256").update(readFileSync(chemin)).digest("hex").slice(0, 16);
  return { chemin, empreinte };
}

export async function mesurerJeu(nom: NomJeu, echantillon: number, avecLlm: boolean) {
  const j = JEUX[nom];
  const { chemin, empreinte } = recuperer(nom);
  const { champs, cas: tous } = lireCsv(readFileSync(chemin, "utf8"));

  /* Tirage déterministe : deux exécutions portent sur les mêmes cas, sinon la comparaison
     entre paliers mesure aussi le hasard du tirage. */
  let e = 20260819;
  const alea = () => ((e = (e * 1_664_525 + 1_013_904_223) >>> 0) / 4_294_967_296);
  const melange = [...tous];
  for (let i = melange.length - 1; i > 0; i--) {
    const k = Math.floor(alea() * (i + 1));
    [melange[i], melange[k]] = [melange[k]!, melange[i]!];
  }
  const cas = echantillon > 0 ? melange.slice(0, echantillon) : melange;

  const colonne = champs[0]!;
  const etiquettes = [...new Set(cas.map((c) => c.truth[colonne]!))].sort();
  const compte: Record<string, number> = {};
  for (const c of cas) compte[c.truth[colonne]!] = (compte[c.truth[colonne]!] ?? 0) + 1;
  const [nomMaj, nMaj] = Object.entries(compte).sort((a, b) => b[1] - a[1])[0]!;

  const paliers: TierName[] = [
    ...ENCODEURS.filter((t) => t !== "rules" && t !== "human"),
    ...(avecLlm ? GENERATIFS : []),
  ];
  await loadClassifiers();
  if (avecLlm) await loadGeneratifs();

  const releve: Record<string, { bons: number; sur: number; ms: number }> = {};
  for (const palier of paliers) {
    let bons = 0;
    const durees: number[] = [];
    for (const c of cas) {
      const t0 = performance.now();
      const got = await classerParmi(palier, c.text, etiquettes);
      durees.push(performance.now() - t0);
      if (got === c.truth[colonne]) bons++;
    }
    durees.sort((a, b) => a - b);
    releve[palier] = { bons, sur: cas.length, ms: durees[Math.floor(durees.length / 2)] ?? 0 };
  }

  return {
    jeu: nom, mesureLe: new Date().toISOString(),
    source: { url: j.url, empreinte, licence: j.licence, citation: j.citation },
    cas: cas.length, etiquettes: etiquettes.length,
    references: { majoritaire: { nom: nomMaj, taux: nMaj / cas.length }, uniforme: 1 / etiquettes.length },
    paliers: releve,
  };
}

/**
 * Ce qui a bougé depuis la dernière fois.
 *
 * Ce dépôt publie un banc de régression pour les systèmes des autres et n'en avait pas pour
 * son propre banc public. Un modèle qui se met à jour déplace le résultat de banking77, la
 * page continue d'afficher l'ancien chiffre, et personne ne le sait — exactement le motif que
 * l'outil vend contre.
 */
export function ecart(avant: { paliers: Record<string, { bons: number; sur: number }> } | null,
                     apres: { paliers: Record<string, { bons: number; sur: number }> }) {
  if (!avant) return null;
  const lignes: { palier: string; avant: number; apres: number; points: number; reel: boolean }[] = [];
  for (const [palier, v] of Object.entries(apres.paliers)) {
    const a = avant.paliers[palier];
    if (!a || a.sur !== v.sur) continue;   // tailles différentes : la comparaison ne veut rien dire
    const ra = rate(a.bons, a.sur), rb = rate(v.bons, v.sur);
    lignes.push({
      palier, avant: ra.rate, apres: rb.rate,
      points: (rb.rate - ra.rate) * 100,
      reel: distinguishable(ra, rb),
    });
  }
  return lignes.filter((l) => l.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

if (isMain(import.meta)) {
  const nom = (process.argv.find((a) => !a.startsWith("-") && a in JEUX) ?? "banking77") as NomJeu;
  const echantillon = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 1000);
  const avecLlm = !process.argv.includes("--no-llm");

  console.log(`\n${nom} — ${JEUX[nom].quoi}`);
  console.log(`licence ${JEUX[nom].licence}. ${JEUX[nom].citation}\n`);

  const chemin = `${DOSSIER}${nom}.json`;
  const precedent = existsSync(chemin) ? JSON.parse(readFileSync(chemin, "utf8")) : null;

  const d = await mesurerJeu(nom, echantillon, avecLlm);
  mkdirSync(DOSSIER, { recursive: true });
  writeFileSync(chemin, JSON.stringify(d, null, 2));

  const r = Object.fromEntries(Object.entries(d.paliers).map(([k, v]) => [k, rate(v.bons, v.sur)]));
  const rangs = Object.entries(r).sort((a, b) => b[1].rate - a[1].rate);

  console.log(`${d.cas} cases, ${d.etiquettes} labels. The baselines first:\n`);
  console.log(`  always \u201c${d.references.majoritaire.nom}\u201d   ${(100 * d.references.majoritaire.taux).toFixed(1)} %`);
  console.log(`  uniform draw                       ${(100 * d.references.uniforme).toFixed(1)} %\n`);
  for (const [palier, taux] of rangs) {
    console.log(`  ${palier.padEnd(10)} ${writeRate(taux).padEnd(26)} ${d.paliers[palier]!.ms.toFixed(0)} ms`);
  }

  /* La phrase qui vaut le déplacement : le meilleur palier est-il seulement démontrable ? */
  const tete = rangs[0]!, rapide = rangs.reduce((a, b) => (d.paliers[b[0]]!.ms < d.paliers[a[0]]!.ms ? b : a));
  if (tete[0] !== rapide[0] && !distinguishable(tete[1], rapide[1])) {
    console.log(`\n  → ${tete[0]} and ${rapide[0]} are indistinguishable over ${d.cas} cases,`);
    console.log(`    and ${tete[0]} is ${(d.paliers[tete[0]]!.ms / Math.max(d.paliers[rapide[0]]!.ms, 0.01)).toFixed(0)}× slower.`);
  }
  const bouge = ecart(precedent, d);
  if (bouge?.length) {
    console.log(`\n  WHAT MOVED since ${precedent.mesureLe.slice(0, 10)}:`);
    for (const l of bouge) {
      console.log(`    ${l.palier.padEnd(10)} ${(100 * l.avant).toFixed(1)} % → ${(100 * l.apres).toFixed(1)} %`
        + `  ${l.points > 0 ? "+" : ""}${l.points.toFixed(1)} pts` + (l.reel ? "   ← real gap" : ""));
    }
    if (bouge.some((l) => l.reel)) {
      console.log(`\n  At least one gap is significant: a model changed under your feet,`);
      console.log(`  or the measurement is not reproducible. Both deserve an explanation.`);
    }
  } else if (precedent) {
    console.log(`\n  Nothing moved since ${precedent.mesureLe.slice(0, 10)}.`);
  }

  console.log(`\nRecord written to benchmarks/${nom}.json — \`npm run figures\` puts it in the README.\n`);
}
