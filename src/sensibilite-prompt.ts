/**
 * Reformuler le prompt déplace-t-il autant que changer de palier ?
 *
 * C'est la question qui commande tout le reste. Ce dépôt compare sept paliers à prompt fixe
 * et en tire un routage ; si la simple formulation déplace l'exactitude d'autant, alors la
 * comparaison de modèles est une comparaison de prompts et le routage optimise le mauvais
 * axe. Personne ne l'avait mesuré.
 *
 * ─── Ce que le protocole protège ───
 *
 * Les cinq formulations sont figées dans `tiers.ts` **avant** la première exécution, et leur
 * texte complet est enregistré à côté du résultat : un chiffre qu'on ne peut pas relier au
 * geste qui l'a produit n'est pas reproductible. Les quatre alternatives ont été écrites par
 * quelqu'un qui n'est pas l'auteur de la référence — mais qui l'avait lue, ce qui en fait des
 * voisines et fait de la dispersion mesurée une **borne basse**.
 *
 * Le comparateur est posé d'avance, et c'est l'essentiel : la dispersion entre paliers à
 * prompt fixe, qu'on connaît déjà du relevé. Le choisir après coup reviendrait à choisir
 * celui qui rend le résultat intéressant.
 *
 *     npm run prompt          les cinq variantes, gen-4b, cinq champs, 120 cas
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { FIELDS, generateRecords } from "./corpus.ts";
import { loadGeneratifs, extract, correct, PROMPTS, type NomPrompt } from "./tiers.ts";
import { readProfiles } from "./measure.ts";

import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const SORTIE = fileURLToPath(new URL("../prompts-2026-08-20.json", import.meta.url));
const PALIER = "gen-4b" as const;

if (isMain(import.meta)) {
  const cas = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 120);
  const dossiers = generateRecords(cas, "heldout");
  const noms = Object.keys(PROMPTS) as NomPrompt[];

  const version = (() => {
    try {
      const cwd = fileURLToPath(new URL("..", import.meta.url));
      return {
        commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim(),
        sale: execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0,
      };
    } catch { return undefined; }
  })();

  if (version?.sale) {
    console.error("\nThe tree carries uncommitted changes: the variants must be committed before");
    console.error("running, or nothing proves none of them was added afterwards.\n");
    process.exit(1);
  }

  console.log(`\n${noms.length} prompts × ${FIELDS.length} fields × ${cas} cases on ${PALIER}.`);
  console.log(`Load before starting: ${loadavg()[0]!.toFixed(2)} on ${cpus().length} cores.\n`);
  await loadGeneratifs();

  const resultats: Record<string, Record<Field, number>> = {};
  /* Septième passe à mesurer sans rien garder — et la première dont l'oubli a coûté une
     remesure, le matin même où la question « mauvaises dates ou mauvais format ? » s'est posée. */
  const journal = ouvrirJournal("sensibilite", {
    quoi: "Sensibilité d'un palier à la formulation du prompt.",
    split: "heldout", cases: cas,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });
  for (const nom of noms) {
    resultats[nom] = {} as Record<Field, number>;
    for (const champ of FIELDS) {
      let bons = 0;
      for (const d of dossiers) {
        const t0 = performance.now();
        const got = await extract(PALIER, d, champ, nom);
        journal.ligne({
          tier: PALIER, field: champ, caseId: d.id, phrasing: nom, split: "heldout",
          outcome: issue(got, d.truth[champ]), ms: Number((performance.now() - t0).toFixed(3)),
          value: got, expected: d.truth[champ],
        });
        if (correct(got, d.truth[champ])) bons++;
      }
      resultats[nom]![champ] = bons / dossiers.length;
      console.log(`  ${nom.padEnd(20)} ${champ.padEnd(10)} ${(100 * bons / dossiers.length).toFixed(1)} %`);
    }
  }

  /*
   * Le comparateur, lu dans le relevé et non recalculé ici : l'écart entre le meilleur et le
   * pire palier sur chaque champ, à prompt fixe. C'est la grandeur que la dispersion des
   * formulations doit être comparée à — et elle existait avant cette expérience.
   */
  const p = readProfiles();
  const entrePaliers = {} as Record<Field, number | null>;
  for (const champ of FIELDS) {
    if (!p?.tiers) { entrePaliers[champ] = null; continue; }
    const taux = p.tiers.filter((t) => t !== "human").map((t) => p.extraction[t][champ].accuracy);
    entrePaliers[champ] = 100 * (Math.max(...taux) - Math.min(...taux));
  }

  const parFormulation = {} as Record<Field, number>;
  for (const champ of FIELDS) {
    const taux = noms.map((n) => resultats[n]![champ]);
    parFormulation[champ] = 100 * (Math.max(...taux) - Math.min(...taux));
  }

  journal.fermer();
  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Ce que la formulation du prompt déplace, comparé à ce que le choix du palier déplace.",
    limite: "Les quatre alternatives ont été écrites après lecture de la référence : ce sont des "
      + "voisines, et la dispersion mesurée est une borne basse de la vraie sensibilité au prompt.",
    palier: PALIER, cas, mesureLe: new Date().toISOString(), code: version,
    charge: { externalBefore: Number(loadavg()[0]!.toFixed(2)), coeurs: cpus().length },
    /* Le texte complet, pas seulement le nom : sans lui le résultat ne se relie à rien. */
    formulations: Object.fromEntries(noms.map((n) => [n, PROMPTS[n]("<DOCUMENT>", "document" as Field)])),
    exactitudes: Object.fromEntries(noms.map((n) => [n,
      Object.fromEntries(FIELDS.map((c) => [c, Number((100 * resultats[n]![c]).toFixed(1))]))])),
    dispersion: {
      parFormulation: Object.fromEntries(FIELDS.map((c) => [c, Number(parFormulation[c].toFixed(1))])),
      entrePaliers: Object.fromEntries(FIELDS.map((c) => [c, entrePaliers[c] === null ? null : Number(entrePaliers[c]!.toFixed(1))])),
    },
  }, null, 2) + "\n");

  console.log("\nfield        prompt      between tiers");
  for (const c of FIELDS) {
    console.log(`  ${c.padEnd(10)} ${parFormulation[c].toFixed(1).padStart(8)} pts ${(entrePaliers[c] ?? 0).toFixed(1).padStart(11)} pts`);
  }
  console.log(`\nWritten to ${SORTIE.split("/").pop()}\n`);
}
