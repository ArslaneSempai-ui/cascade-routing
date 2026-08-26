/**
 * Les trois formulations « retenues » le sont-elles vraiment ?
 *
 * `npm run regler` a nommé un vainqueur par palier en prenant le maximum de cinq taux, sans
 * rien garder des cas. Les marges se lisent maintenant : 12 extractions sur 600 pour
 * `gen-0.6b`, **1** pour `gen-4b`, 3 pour `gen-8b`. Ce script remesure, pour chaque palier, le
 * vainqueur **et son second**, garde les résultats cas par cas, et laisse McNemar trancher.
 *
 * Ce qu'il peut conclure est asymétrique, et il faut le dire avant de le lancer :
 *
 *   — si le vainqueur n'est PAS séparable de son second, c'est réglé : rien n'est retenu pour
 *     ce palier, et aucune autre mesure n'y changera quoi que ce soit.
 *   — s'il l'EST, on ne peut toujours pas parler de formulation retenue. L'indiscernabilité
 *     n'est pas transitive — ce dépôt le sait déjà, son optimiseur fait deux passes pour cette
 *     raison exacte. Battre le second ne dit rien du troisième. Il faudrait alors les cinq.
 *
 * Autrement dit : ce passage peut réfuter les trois choix, il ne peut en confirmer aucun.
 *
 *     npm run departager      vainqueur contre second, trois paliers, sur `dev`
 */

import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { FIELDS, generateRecords } from "./corpus.ts";
import { loadGeneratifs, extract, correct, GENERATIFS_PUBLICS } from "./tiers.ts";
import { departager } from "./regler-prompt.ts";

import type { NomPrompt } from "./tiers.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";
import { casDemandes } from "./cas-demandes.ts";

const REGLAGE = fileURLToPath(new URL("../prompts-par-palier.json", import.meta.url));
const SORTIE = fileURLToPath(new URL("../departage-reglage.json", import.meta.url));

export const PEUT_CONFIRMER = false;   // voir l'en-tête : réfuter oui, confirmer non

/** Le vainqueur et son second, par taux, tels que le réglage les a classés. */
export function pairesADepartager(surDev: Record<string, Record<string, number>>) {
  return Object.entries(surDev).map(([palier, taux]) => {
    const classe = Object.entries(taux).sort((a, b) => b[1] - a[1]);
    return {
      palier: palier as TierName,
      vainqueur: classe[0]![0] as NomPrompt,
      second: classe[1]![0] as NomPrompt,
      ecartPoints: Number((classe[0]![1] - classe[1]![1]).toFixed(1)),
    };
  });
}

if (isMain(import.meta)) {
  const cas = casDemandes(120);
  const dossiers = generateRecords(cas, "dev");

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

  const reglage = JSON.parse(readFileSync(REGLAGE, "utf8")) as { surDev: Record<string, Record<string, number>>; code?: { commit: string } };
  const paires = pairesADepartager(reglage.surDev)
    .filter((x) => (GENERATIFS_PUBLICS as readonly string[]).includes(x.palier));

  console.log(`\n${paires.length} pairs × ${FIELDS.length} fields × ${cas} cases, on \`dev\`.`);
  for (const x of paires) console.log(`  ${x.palier.padEnd(10)} ${x.vainqueur} against ${x.second}  (${x.ecartPoints} pt on dev)`);
  console.log(`\nThis pass can refute a choice, never confirm one — indistinguishability is not transitive.`);
  console.log(`Load before starting: ${loadavg()[0]!.toFixed(2)} on ${cpus().length} cores.\n`);
  const journal = ouvrirJournal("departager", {
    quoi: "Le vainqueur du réglage est-il séparable de son second ?", split: "dev", cases: cas,
    commit: version?.commit, sale: version?.sale,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });
  await loadGeneratifs();

  const resultats: Record<string, unknown> = {};
  const tousLesBits: Record<string, Record<string, Record<Field, string>>> = {};
  for (const { palier, vainqueur, second, ecartPoints } of paires) {
    const bits = {} as Record<NomPrompt, Record<Field, string>>;
    for (const nom of [vainqueur, second]) {
      bits[nom] = {} as Record<Field, string>;
      for (const champ of FIELDS) {
        let s = "";
        for (const d of dossiers) {
          const t0 = performance.now();
          const got = await extract(palier, d, champ, nom);
          const ms = performance.now() - t0;
          s += correct(got, d.truth[champ]) ? "1" : "0";
          journal.ligne({ tier: palier, field: champ, caseId: d.id, phrasing: nom, split: "dev",
            outcome: issue(got, d.truth[champ]), ms: Number(ms.toFixed(3)),
            value: got, expected: d.truth[champ] });
        }
        bits[nom]![champ] = s;
      }
      const ok = FIELDS.reduce((a, c) => a + [...bits[nom]![c]!].filter((x) => x === "1").length, 0);
      console.log(`  ${palier.padEnd(10)} ${nom.padEnd(20)} ${(100 * ok / (FIELDS.length * cas)).toFixed(1)} %`);
    }
    const d = departager(bits, [vainqueur, second]);
    tousLesBits[palier] = bits as Record<string, Record<Field, string>>;
    resultats[palier] = { ...d, ecartPointsAuReglage: ecartPoints,
      conclusion: d.decidable
        ? `${d.vainqueur} bat ${d.second} sur les mêmes cas, mais « retenu » demanderait aussi les trois autres formulations.`
        : `rien n'est retenu pour ${palier} : ${d.vainqueur} et ${d.second} ne se départagent pas.` };
    console.log(`    → ${d.gains}–${d.regressions} paired, ${d.ecartExtractions} extraction(s) apart — ${d.decidable ? "DECIDED" : "not decided"}\n`);
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Le vainqueur du réglage est-il séparable de son second, sur les mêmes cas ?",
    portee: "Ce passage réfute ou laisse ouvert. Il ne confirme pas : l'indiscernabilité n'est pas "
      + "transitive, donc battre son second ne rend pas une formulation « retenue ». Pour cela il "
      + "faudrait départager le vainqueur des quatre autres, soit les cinq formulations mesurées.",
    decoupage: "dev", cas, mesureLe: new Date().toISOString(), code: version,
    reglageDepart: reglage.code?.commit ?? null,
    charge: { externalBefore: Number(loadavg()[0]!.toFixed(2)), coeurs: cpus().length },
    resultats, reussites: tousLesBits,
  }, null, 2) + "\n");
  console.log(`Written to ${SORTIE.split("/").pop()}\n`);
}
