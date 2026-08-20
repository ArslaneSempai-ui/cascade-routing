/**
 * Choisir la formulation de chaque palier — sur `dev`, jamais sur `heldout`.
 *
 * La mesure du 20 août a montré qu'aucune formulation ne domine : `C-minimal` gagne trois
 * points sur `gen-4b` et en coûte trente à `gen-0.6b`, qui sans exemple ne comprend plus ce
 * qu'on lui demande. Le meilleur prompt dépend donc du modèle, et un prompt unique pour les
 * trois est un compromis que personne n'avait choisi.
 *
 * Le régler par palier est légitime ; le régler sur les cas qui servent à publier ne l'est
 * pas. C'est la faute que ce dépôt a commise à sa première mesure — des expressions
 * régulières écrites contre les gabarits qui servaient à les noter, 100 % sur cinq champs, et
 * un corpus entier à reconstruire. `dev` existe depuis pour ça : c'est la moitié sur laquelle
 * on a le droit de regarder les scores en travaillant.
 *
 *     npm run regler          cinq formulations × trois paliers, sur `dev`
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { isMain } from "./cli.ts";
import { FIELDS, generateRecords } from "./corpus.ts";
import { loadGeneratifs, extract, correct, PROMPTS, GENERATIFS_PUBLICS, type NomPrompt } from "./tiers.ts";

import type { Field } from "./corpus.ts";
import type { TierName } from "./paliers.ts";

const SORTIE = new URL("../prompts-par-palier.json", import.meta.url).pathname;

if (isMain(import.meta)) {
  const cas = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 120);
  /* Sur `dev`. Le mettre en dur plutôt qu'en option : un réglage sur `heldout` ne doit pas
     être à une faute de frappe près. */
  const dossiers = generateRecords(cas, "dev");
  const noms = Object.keys(PROMPTS) as NomPrompt[];
  const paliers = GENERATIFS_PUBLICS;

  const version = (() => {
    try {
      const cwd = new URL("..", import.meta.url).pathname;
      return {
        commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim(),
        sale: execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0,
      };
    } catch { return undefined; }
  })();
  if (version?.sale) {
    console.error("\nArbre modifié : les formulations doivent être committées avant d'être départagées.\n");
    process.exit(1);
  }

  console.log(`\n${noms.length} formulations × ${paliers.length} paliers × ${FIELDS.length} champs × ${cas} cas — sur \`dev\`.`);
  console.log(`Charge avant départ : ${loadavg()[0]!.toFixed(2)} sur ${cpus().length} cœurs.\n`);
  await loadGeneratifs();

  const scores = {} as Record<TierName, Record<NomPrompt, Record<Field, number>>>;
  for (const t of paliers) {
    scores[t] = {} as Record<NomPrompt, Record<Field, number>>;
    for (const nom of noms) {
      scores[t][nom] = {} as Record<Field, number>;
      for (const champ of FIELDS) {
        let bons = 0;
        for (const d of dossiers) if (correct(await extract(t, d, champ, nom), d.truth[champ])) bons++;
        scores[t][nom]![champ] = bons / dossiers.length;
      }
      const m = FIELDS.reduce((s, c) => s + scores[t][nom]![c], 0) / FIELDS.length;
      console.log(`  ${t.padEnd(10)} ${nom.padEnd(20)} ${(100 * m).toFixed(1)} %`);
    }
  }

  const moyenne = (t: TierName, n: NomPrompt) => FIELDS.reduce((s, c) => s + scores[t][n]![c], 0) / FIELDS.length;
  const retenu = Object.fromEntries(paliers.map((t) =>
    [t, noms.reduce((a, b) => (moyenne(t, b) > moyenne(t, a) ? b : a))])) as Record<TierName, NomPrompt>;

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "La formulation retenue pour chaque palier génératif, choisie sur le découpage de réglage.",
    decoupage: "dev", cas, mesureLe: new Date().toISOString(), code: version,
    limite: "Choisi sur `dev` et jamais sur `heldout` : les chiffres publiés viennent d'une autre "
      + "moitié du corpus, que ce réglage n'a pas vue. Un réglage fait sur les cas de publication "
      + "aurait produit un score flatteur et faux, ce qui est arrivé une fois à ce dépôt.",
    formulations: Object.fromEntries(noms.map((n) => [n, PROMPTS[n]("<DOCUMENT>", "document" as Field)])),
    surDev: Object.fromEntries(paliers.map((t) => [t,
      Object.fromEntries(noms.map((n) => [n, Number((100 * moyenne(t, n)).toFixed(1))]))])),
    retenu,
  }, null, 2) + "\n");

  console.log("\nretenu par palier, sur `dev` :");
  for (const t of paliers) console.log(`  ${t.padEnd(10)} ${retenu[t]}   (${(100 * moyenne(t, retenu[t])).toFixed(1)} % sur dev)`);
  console.log(`\nÉcrit dans ${SORTIE.split("/").pop()} — à mesurer ensuite sur \`heldout\`.\n`);
}
