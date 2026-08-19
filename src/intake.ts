/**
 * Les réponses du questionnaire, transformées en mesure.
 *
 * Le questionnaire pose douze questions dont sept correspondent exactement à des entrées de
 * l'optimiseur. Sans ce fichier, les remplir produisait un document : quelqu'un devait ensuite
 * recopier les chiffres à la main dans `assumptions.ts`, ce qui est la façon la plus fiable de
 * publier un rapport calculé sur les hypothèses de quelqu'un d'autre.
 *
 * Ici les réponses deviennent la configuration, et ce qui reste vide reste explicitement le
 * défaut du dépôt — jamais un chiffre du client inventé pour combler un trou.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { isMain } from "./cli.ts";
import { ASSUMPTIONS, BOUNDS } from "./assumptions.ts";

import type { Assumptions } from "./assumptions.ts";

/** Ce qu'un prospect peut renseigner. Tout est facultatif : un vide reste un vide. */
export type Reponses = Partial<Record<keyof Assumptions, number>> & {
  chaine?: string;
  paliersDisponibles?: string[];
  residence?: string;
  replisiPalierIndisponible?: string;
  aUnJeuAnnote?: boolean;
  quiSigne?: string;
};

export type Lecture = {
  hypotheses: Assumptions;
  fournies: (keyof Assumptions)[];
  defauts: (keyof Assumptions)[];
  refus: string[];
  bloquant: string[];
};

export function lire(r: Reponses): Lecture {
  const hypotheses = { ...ASSUMPTIONS };
  const fournies: (keyof Assumptions)[] = [];
  const refus: string[] = [];

  for (const cle of Object.keys(ASSUMPTIONS) as (keyof Assumptions)[]) {
    const v = r[cle];
    if (v === undefined) continue;
    const [bas, haut] = BOUNDS[cle];
    if (!Number.isFinite(v) || v < bas || v > haut) {
      /* Une valeur hors bornes n'est pas corrigée en silence : c'est presque toujours une
         unité mal comprise — des secondes données en minutes, un budget annuel donné au mois —
         et deviner laquelle produirait un rapport faux avec l'air d'être personnalisé. */
      refus.push(`${cle} = ${v} est hors des bornes [${bas}, ${haut}] — unité probablement autre, à confirmer`);
      continue;
    }
    (hypotheses[cle] as number) = v;
    fournies.push(cle);
  }

  const defauts = (Object.keys(ASSUMPTIONS) as (keyof Assumptions)[]).filter((c) => !fournies.includes(c));

  /* Ce qui empêche de mesurer quoi que ce soit, par opposition à ce qui manque simplement. */
  const bloquant: string[] = [];
  if (r.aUnJeuAnnote === false) {
    bloquant.push("pas de jeu avec les réponses attendues : il n'y a rien à mesurer, et le "
      + "premier chantier honnête est d'en construire un");
  }
  if (r.paliersDisponibles && r.paliersDisponibles.length < 2) {
    bloquant.push("un seul palier appelable : il n'y a pas de routage à optimiser");
  }

  return { hypotheses, fournies, defauts, refus, bloquant };
}

if (isMain(import.meta)) {
  const fichier = process.argv.find((a) => a.startsWith("--file="))?.split("=")[1];
  if (!fichier || !existsSync(fichier)) {
    const gabarit: Reponses = {
      chaine: "extract five fields from onboarding documents",
      paliersDisponibles: ["rules", "small hosted model", "large hosted model", "human review"],
      residence: "must stay in the EU",
      replisiPalierIndisponible: "not decided",
      aUnJeuAnnote: true,
      quiSigne: "VP Engineering",
      volume: 100_000,
      budget: 4_000,
      latencyBudgetMs: 2_000,
      pricePerThousandSmall: 0.2,
      pricePerThousandLarge: 1.6,
      analystAnnualCost: 62_000,
      humanSeconds: 45,
    };
    const sortie = "intake-template.json";
    writeFileSync(sortie, JSON.stringify(gabarit, null, 2) + "\n");
    console.log(`\nGabarit écrit dans ${sortie}. Le remplir, puis :\n`);
    console.log(`  npm run intake -- --file=${sortie}\n`);
    console.log(`Tout est facultatif. Ce qui reste vide garde le défaut du dépôt, et le rapport`);
    console.log(`le dit — un chiffre absent ne devient jamais un chiffre inventé.\n`);
    process.exit(0);
  }

  const l = lire(JSON.parse(readFileSync(fichier, "utf8")));

  if (l.bloquant.length) {
    console.log("\nCE QUI EMPÊCHE DE MESURER :\n");
    for (const b of l.bloquant) console.log(`  ✗ ${b}`);
    console.log("");
  }
  if (l.refus.length) {
    console.log("REFUSÉ, À CONFIRMER AVANT DE CONTINUER :\n");
    for (const x of l.refus) console.log(`  ? ${x}`);
    console.log("");
  }
  console.log(`FOURNI PAR LE CLIENT (${l.fournies.length}) :`);
  for (const c of l.fournies) console.log(`  ${c.padEnd(24)} ${l.hypotheses[c]}`);
  console.log(`\nRESTÉ AU DÉFAUT DU DÉPÔT (${l.defauts.length}) — à dire dans le rapport :`);
  for (const c of l.defauts) console.log(`  ${c.padEnd(24)} ${l.hypotheses[c]}`);

  /*
   * Le résultat s'écrit, sinon la deuxième exécution recommence.
   *
   * Sans ça, `intake` affichait un tableau que quelqu'un devait recopier à la main dans
   * `assumptions.ts` — c'est-à-dire l'endroit exact où une transcription manuelle transforme
   * un rapport personnalisé en rapport faux. Le fichier note aussi ce qui n'a PAS été fourni,
   * parce qu'un défaut du dépôt présenté comme un chiffre du client est un mensonge par
   * omission.
   */
  const sortie = "data/hypotheses-client.json";
  writeFileSync(sortie, JSON.stringify({
    etabliLe: new Date().toISOString(),
    source: fichier,
    hypotheses: l.hypotheses,
    fournies: l.fournies,
    defautsDuDepot: l.defauts,
    refuses: l.refus,
    bloquant: l.bloquant,
  }, null, 2) + "\n");
  console.log(`\nÉcrit dans ${sortie}. Les ${l.defauts.length} valeurs non fournies y sont`);
  console.log(`listées séparément : un défaut du dépôt ne doit jamais passer pour un chiffre du client.\n`);
}
