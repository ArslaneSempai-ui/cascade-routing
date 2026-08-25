/**
 * La formulation change-t-elle le classement des paliers, ou seulement leurs moyennes ?
 *
 * Sous `reference`, `gen-8b` mène `gen-4b` de deux points ; sous `A-sans-exemple`, `gen-4b`
 * mène de dix. Un Wilson non apparié sur les cinq champs groupés dit que le premier écart est
 * dans le bruit et le second non — donc pas d'inversion d'un ordre établi, mais un écart qui
 * naît. Reste que grouper cinq champs et ignorer l'appariement est grossier : les deux paliers
 * voient **les mêmes cas**, et McNemar est le test qui le sait.
 *
 * Ce script mesure les quatre conditions et **garde les résultats cas par cas**. Les deux
 * expériences précédentes n'ont gardé que des taux, et il a fallu remesurer les deux fois pour
 * répondre à la question suivante. Deux fois la même leçon dans la même journée suffit.
 *
 *     npm run apparier        gen-4b et gen-8b, sous reference et A-sans-exemple, sur `dev`
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { FIELDS, generateRecords } from "./corpus.ts";
import { loadGeneratifs, extract, correct, PROMPTS } from "./tiers.ts";
import { pairedVerdict } from "./interval.ts";

import type { NomPrompt } from "./tiers.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const SORTIE = fileURLToPath(new URL("../apparie-prompt.json", import.meta.url));
const PALIERS = ["gen-4b", "gen-8b"] as TierName[];
const FORMULATIONS = ["reference", "A-sans-exemple"] as NomPrompt[];

if (isMain(import.meta)) {
  const cas = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 120);
  const dossiers = generateRecords(cas, "dev");   // l'observation vient de `dev` ; on y reste

  const version = (() => {
    try {
      const cwd = fileURLToPath(new URL("..", import.meta.url));
      return {
        commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim(),
        sale: execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0,
      };
    } catch { return undefined; }
  })();
  if (version?.sale) { console.error("\nModified tree: commit before measuring.\n"); process.exit(1); }

  console.log(`\n${PALIERS.length} paliers × ${FORMULATIONS.length} formulations × ${FIELDS.length} champs × ${cas} cas, sur \`dev\`.`);
  console.log(`Load before starting: ${loadavg()[0]!.toFixed(2)} on ${cpus().length} cores.\n`);
  const journal = ouvrirJournal("apparier", {
    quoi: "Le classement de gen-4b et gen-8b dépend-il de la formulation ?", split: "dev", cases: cas,
    commit: version?.commit, sale: version?.sale,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });
  await loadGeneratifs();

  /* Les bits, cas par cas — ce que les deux expériences précédentes ont omis de garder. */
  const bits = {} as Record<string, Record<Field, string>>;
  for (const f of FORMULATIONS) {
    for (const t of PALIERS) {
      const cle = `${t}|${f}`;
      bits[cle] = {} as Record<Field, string>;
      for (const champ of FIELDS) {
        let s = "";
        for (const d of dossiers) {
          const t0 = performance.now();
          const got = await extract(t, d, champ, f);
          const ms = performance.now() - t0;
          s += correct(got, d.truth[champ]) ? "1" : "0";
          journal.ligne({ tier: t, field: champ, caseId: d.id, phrasing: f, split: "dev",
            outcome: issue(got, d.truth[champ]), ms: Number(ms.toFixed(3)),
            value: got, expected: d.truth[champ] });
        }
        bits[cle]![champ] = s;
        console.log(`  ${cle.padEnd(28)} ${champ.padEnd(10)} ${(100 * [...s].filter((x) => x === "1").length / s.length).toFixed(1)} %`);
      }
    }
  }

  const compte = (s: string) => [...s].filter((x) => x === "1").length;
  const verdicts: Record<string, unknown> = {};
  for (const f of FORMULATIONS) {
    const a = bits[`gen-4b|${f}`]!, b = bits[`gen-8b|${f}`]!;
    const parChamp = FIELDS.map((c) => {
      let g = 0, p = 0;
      for (let i = 0; i < a[c].length; i++) {
        const x = a[c][i] === "1", y = b[c][i] === "1";
        if (x && !y) g++; else if (y && !x) p++;
      }
      const v = pairedVerdict(g, p);
      return { field: c, gen4bWins: g, gen8bWins: p, decidable: v.decidable,
        gen4b: Number((100 * compte(a[c]) / a[c].length).toFixed(1)),
        gen8b: Number((100 * compte(b[c]) / b[c].length).toFixed(1)) };
    });
    /* Groupé sur les cinq champs, toujours apparié : chaque cas compte une fois par champ. */
    let G = 0, P = 0;
    for (const c of FIELDS) for (let i = 0; i < a[c].length; i++) {
      const x = a[c][i] === "1", y = b[c][i] === "1";
      if (x && !y) G++; else if (y && !x) P++;
    }
    const groupe = pairedVerdict(G, P);
    verdicts[f] = { parChamp, groupe: { gen4bWins: G, gen8bWins: P, decidable: groupe.decidable } };
    console.log(`\n  ${f} — pooled: gen-4b wins ${G}, gen-8b wins ${P} — ${groupe.decidable ? "DECIDED" : "within the noise"}`);
    console.log(`    fields decided: ${parChamp.filter((x) => x.decidable).map((x) => x.field).join(", ") || "none"}`);
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Le classement de gen-4b et gen-8b dépend-il de la formulation du prompt ?",
    decoupage: "dev", cas, mesureLe: new Date().toISOString(), code: version,
    charge: { externalBefore: Number(loadavg()[0]!.toFixed(2)), coeurs: cpus().length },
    formulations: Object.fromEntries(FORMULATIONS.map((f) => [f, PROMPTS[f]("<DOCUMENT>", "document" as Field)])),
    reussites: bits,
    verdicts,
  }, null, 2) + "\n");
  const j = journal.fermer();
  console.log(`${j.lignes} attempts in ${j.chemin.split("/").slice(-2).join("/")}`);
  console.log(`\nWritten to ${SORTIE.split("/").pop()}\n`);
}
