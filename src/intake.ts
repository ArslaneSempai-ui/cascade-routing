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

import { dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
      refus.push(`${cle} = ${v} is outside [${bas}, ${haut}] — probably a different unit; confirm before continuing`);
      continue;
    }
    (hypotheses[cle] as number) = v;
    fournies.push(cle);
  }

  /*
   * UNE CLÉ MAL ORTHOGRAPHIÉE EST PIRE QU'UNE CLÉ ABSENTE.
   *
   * Ce module existe pour qu'un chiffre absent ne devienne jamais un chiffre inventé. Mais
   * une clé inconnue était ignorée sans un mot : `volumee` au lieu de `volume`, et le client
   * recevait un rapport calculé sur NOS défauts en croyant avoir fourni le sien. La
   * différence ne se voit nulle part — le rapport dit « défaut du dépôt » pour une clé que le
   * client a cru remplir.
   *
   * On propose la clé la plus proche quand il y en a une : sur douze noms, « clé inconnue »
   * laisse le lecteur relire son fichier ligne à ligne.
   */
  const connues = new Set([...Object.keys(ASSUMPTIONS), "aUnJeuAnnote", "paliersDisponibles"]);
  const proche = (k: string) => [...connues].find((c) =>
    c.toLowerCase().startsWith(k.toLowerCase().slice(0, Math.max(3, k.length - 2)))
    || k.toLowerCase().startsWith(c.toLowerCase().slice(0, Math.max(3, c.length - 2))));
  for (const k of Object.keys(r)) {
    if (connues.has(k)) continue;
    const suggestion = proche(k);
    refus.push(`"${k}" is not a key of this questionnaire${suggestion ? ` — did you mean "${suggestion}"?` : ""}`
      + " — its value was used nowhere");
  }

  const defauts = (Object.keys(ASSUMPTIONS) as (keyof Assumptions)[]).filter((c) => !fournies.includes(c));

  /* Ce qui empêche de mesurer quoi que ce soit, par opposition à ce qui manque simplement. */
  const bloquant: string[] = [];
  if (r.aUnJeuAnnote === false) {
    bloquant.push("no set with the expected answers: there is nothing to measure, and the first honest "
      + "piece of work is to build one");
  }
  if (r.paliersDisponibles && r.paliersDisponibles.length < 2) {
    bloquant.push("only one callable tier: there is no routing to optimise");
  }

  return { hypotheses, fournies, defauts, refus, bloquant };
}

if (isMain(import.meta)) {
  const fichier = process.argv.find((a) => a.startsWith("--file="))?.split("=")[1];

  /*
   * UN CHEMIN PASSÉ SANS `--file=` ÉCRIVAIT UN GABARIT.
   *
   * `node src/intake.ts mes-reponses.json` — la forme que tout le monde tape en premier —
   * ne trouvait pas de `--file=`, tombait dans la branche du gabarit, et ÉCRASAIT un fichier
   * dans le dossier courant en annonçant un succès. Le client croit avoir soumis ses
   * réponses ; il vient de recevoir un modèle vide, et son fichier n'a jamais été lu.
   */
  const positionnel = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!fichier && positionnel) {
    console.error(
      `The path "${positionnel}" was passed without "--file=", so it was not read.\n\n`
      + `  Write:  npm run intake -- --file=${positionnel}\n\n`
      + `  Without that flag this command writes a blank template — which would have\n`
      + `  overwritten a file and produced a report on our default values.`);
    process.exit(2);
  }

  if (fichier && !existsSync(fichier)) {
    console.error(`"${fichier}" does not exist. Nothing was read, and no template was written.`);
    process.exit(2);
  }

  if (!fichier) {
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
    console.log(`\nTemplate written to ${sortie}. Fill it in, then:\n`);
    console.log(`  npm run intake -- --file=${sortie}\n`);
    console.log(`Everything is optional. What stays empty keeps this repository's default, and the report`);
    console.log(`says so — a missing figure never becomes an invented one.\n`);
    process.exit(0);
  }

  const l = lire(JSON.parse(readFileSync(fichier, "utf8")));

  if (l.bloquant.length) {
    console.log("\nWHAT PREVENTS MEASURING AT ALL:\n");
    for (const b of l.bloquant) console.log(`  ✗ ${b}`);
    console.log("");
  }
  if (l.refus.length) {
    console.log("REFUSED — CONFIRM BEFORE CONTINUING:\n");
    for (const x of l.refus) console.log(`  ? ${x}`);
    console.log("");
  }
  console.log(`SUPPLIED BY THE CLIENT (${l.fournies.length}) :`);
  for (const c of l.fournies) console.log(`  ${c.padEnd(24)} ${l.hypotheses[c]}`);
  console.log(`\nLEFT AT THIS REPOSITORY'S DEFAULT (${l.defauts.length}) — to be stated in the report:`);
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
  /*
   * `data/` EST IGNORÉ PAR GIT, DONC ABSENT D'UN CLONE FRAIS.
   *
   * Cet outil est LE PREMIER GESTE que le README documente pour un client. Il affichait tout
   * son rapport, correctement, puis mourait sur `ENOENT: open 'data/hypotheses-client.json'`
   * avec une trace de pile — parce que le dossier n'existe pas tant que rien ne l'a créé, et
   * que ce qui le crée d'habitude est une mesure que le client n'a pas encore lancée.
   *
   * Le pire est l'ordre : le rapport passe, la confiance est faite, et l'échec arrive après.
   * Un client conclut que l'outil est fragile au moment précis où il venait de bien marcher.
   */
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(sortie, JSON.stringify({
    etabliLe: new Date().toISOString(),
    source: fichier,
    hypotheses: l.hypotheses,
    fournies: l.fournies,
    defautsDuDepot: l.defauts,
    refuses: l.refus,
    bloquant: l.bloquant,
  }, null, 2) + "\n");
  console.log(`\nWritten to ${sortie}. The ${l.defauts.length} values you did not supply are listed`);
  console.log(`separately: a repository default must never pass for a client's figure.\n`);
}
