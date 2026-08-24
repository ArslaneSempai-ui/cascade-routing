/**
 * Combien la fuite a coûté, en points.
 *
 * L'invite générative a été mise au point en lisant des scores calculés sur `heldout` : la
 * mesure donnait 0 %, le prompt a changé, la même moitié a été remesurée, et elle a donné
 * 95,8 %. C'est la fuite exacte que le découpage existe pour empêcher.
 *
 * On ne peut pas la défaire — on peut la mesurer. Le même prompt tourne ici sur `dev`, une
 * moitié qu'il n'a jamais vue, et l'écart avec `heldout` est le prix de la faute. Un écart
 * nul veut dire que le prompt se transporte et que le chiffre publié était mérité ; un écart
 * large veut dire qu'il avait été ajusté au jeu de test, et de combien.
 *
 * Publier ce chiffre coûte quelques points d'exactitude affichée. Ne pas le publier
 * coûterait la seule chose qui donne du poids au reste de la page.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadavg } from "node:os";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { generateRecords, FIELDS } from "./corpus.ts";
import { loadGeneratifs, extract, correct } from "./tiers.ts";

import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const FICHIER = fileURLToPath(new URL("../data/fuite.json", import.meta.url));

export async function mesurerFuite(palier: TierName, combien = 120) {
  const champs: Record<string, { dev: number; heldout: number; n: number }> = {};
  /* Sixième passe à mesurer sans rien garder — elle tourne sur les deux moitiés, ce qui en
     fait la seule source de lignes `dev` et `heldout` produites dans les mêmes conditions. */
  const journal = ouvrirJournal("fuite", {
    quoi: "Le prix de la fuite : le même prompt sur la moitié réglée et sur une moitié neuve.",
    split: "heldout+dev", cases: combien,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });
  for (const moitie of ["heldout", "dev"] as const) {
    const cas = generateRecords(combien, moitie);
    for (const champ of FIELDS) {
      let bons = 0;
      for (const d of cas) {
        const t0 = performance.now();
        const got = await extract(palier, d, champ);
        journal.ligne({
          tier: palier, field: champ, caseId: d.id, phrasing: "reference", split: moitie,
          outcome: issue(got, d.truth[champ]), ms: Number((performance.now() - t0).toFixed(3)),
          value: got, expected: d.truth[champ],
        });
        if (correct(got, d.truth[champ])) bons++;
      }
      champs[champ] ??= { dev: 0, heldout: 0, n: cas.length };
      champs[champ]![moitie] = bons / cas.length;
    }
  }
  return { palier, mesureLe: new Date().toISOString(), champs };
}

if (isMain(import.meta)) {

  refuserDrapeauxInconnus(["--tier", "--cases"]);
  const palier = (process.argv.find((a) => a.startsWith("--tier="))?.split("=")[1] ?? "gen-4b") as TierName;
  const combien = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 120);

  console.log(`\nMesure de la fuite sur ${palier} : ${combien} cas sur chaque moitié.`);
  console.log("`heldout` est la moitié contre laquelle l'invite a été réglée.");
  console.log("`dev` est une moitié qu'elle n'a jamais vue.\n");

  await loadGeneratifs();
  const d = await mesurerFuite(palier, combien);

  const pc = (x: number) => (x * 100).toFixed(1).padStart(6) + " %";
  console.log("champ      réglé dessus   jamais vu      écart");
  let pire = 0;
  for (const champ of FIELDS) {
    const v = d.champs[champ]!;
    const ecart = (v.dev - v.heldout) * 100;
    pire = Math.min(pire, ecart);
    console.log(`${(champ as Field).padEnd(10)} ${pc(v.heldout)}      ${pc(v.dev)}    ${ecart >= 0 ? "+" : ""}${ecart.toFixed(1)} pts`);
  }
  mkdirSync(dirname(FICHIER), { recursive: true });
  writeFileSync(FICHIER, JSON.stringify(d, null, 2));

  console.log(`\nLa pire chute est de ${pire.toFixed(1)} points.`);
  console.log(pire > -5
    ? "L'invite se transporte : le réglage sur le jeu de test n'a presque rien emprunté."
    : "L'invite ne se transporte pas : une partie du chiffre publié avait été ajustée au jeu de test.");
  console.log(`\nÉcrit dans data/fuite.json — \`npm run figures\` le met dans le README.\n`);
}
