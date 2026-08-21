/**
 * What this thing gets wrong, and why.
 *
 * Every tool in this set reports an aggregate accuracy. None of them showed a single
 * failure. That is the wrong way round: "83 % correct" is a claim a reader has to take on
 * trust, while six named inputs with the model's actual output beside the expected one is
 * something they can check.
 *
 * It is also the difference between having written a system and having run one. Anyone
 * who has put a model in front of real work can tell you its failure modes from memory;
 * anyone who has only measured it quotes a percentage.
 *
 * Nothing here is curated for flattery. The gallery takes the first failures it finds, in
 * order, and groups them by what actually went wrong.
 */

import { generateRecords, FIELDS } from "./corpus.ts";
import { loadavg } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { ENCODEURS, GENERATIFS, TIERS, loadExtractors, extract, correct } from "./tiers.ts";
import type { TierName } from "./tiers.ts";
import type { Field } from "./corpus.ts";

export type Failure = {
  tier: TierName;
  field: Field;
  recordId: string;
  text: string;
  expected: string;
  got: string;
  /** What kind of wrong this is. The grouping is the useful part. */
  mode: "empty" | "fragment" | "wrong span" | "over-long" | "other";
};

/**
 * Naming the failure mode.
 *
 * A model that returns nothing has a different problem from one that returns half the
 * address, and the fix is different too. Counting them together as "errors" hides the
 * only thing worth knowing.
 */
export function classify(got: string, expected: string): Failure["mode"] {
  const g = got.trim().toLowerCase(), e = expected.trim().toLowerCase();
  if (g.length === 0) return "empty";
  if (e.includes(g) && g.length > 0) return "fragment";
  if (g.includes(e)) return "over-long";
  // Something was returned, from elsewhere in the text.
  return g.split(/\s+/).some((w) => w.length > 3 && !e.includes(w)) ? "wrong span" : "other";
}

/**
 * Les échecs, palier par palier.
 *
 * Par défaut l'échelle des encodeurs seulement, et c'est un choix de proportion : inclure
 * les paliers génératifs coûte dix-huit cents appels à un serveur local pour composer une
 * galerie de README. Un `npm run failures -- --llm` les ajoute quand on les veut vraiment.
 *
 * Ce n'est pas une optimisation cosmétique. La première version itérait tous les paliers
 * déclarés, et comme la liste est passée de quatre à sept elle s'est mise à taper sur Ollama
 * pendant qu'une mesure y tournait — deux travaux se disputant le même GPU, tous deux
 * ralentis, aucun des deux en erreur.
 */
export async function collect(howMany = 120, paliers: TierName[] = ENCODEURS): Promise<Failure[]> {
  const records = generateRecords(howMany, "heldout");
  await loadExtractors();
  const failures: Failure[] = [];

  /*
   * La galerie ne garde que les échecs, et jette les réussites qu'elle vient de calculer.
   *
   * C'est la cinquième passe du dépôt à mesurer puis à ne rien garder — trouvée par le test
   * qui exige un journal de toute boucle d'extraction, pas par relecture. Les réussites de
   * cette passe valent celles d'une autre : ce sont les mêmes cas, le même correcteur.
   */
  const journal = ouvrirJournal("failures", {
    quoi: "Galerie des échecs : chaque tentative, retenue ou non.",
    split: "heldout", cases: records.length,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });

  for (const tier of paliers) {
    if (tier === "human") continue;   // the human tier is an assumption, not a measurement
    for (const field of FIELDS) {
      for (const r of records) {
        const t0 = performance.now();
        const got = await extract(tier, r, field);
        journal.ligne({
          tier, field, caseId: r.id, phrasing: "reference", split: "heldout",
          outcome: issue(got, r.truth[field]), ms: Number((performance.now() - t0).toFixed(3)),
          value: got, expected: r.truth[field],
        });
        if (!correct(got, r.truth[field])) {
          failures.push({
            tier, field, recordId: r.id,
            text: r.text.replace(/\n/g, " ⏎ ").slice(0, 120),
            expected: r.truth[field], got,
            mode: classify(got, r.truth[field]),
          });
        }
      }
    }
  }
  journal.fermer();
  return failures;
}

/** Failures per tier and mode — the shape of the problem before any example. */
export function shape(failures: Failure[]) {
  const counts: Record<string, number> = {};
  for (const f of failures) {
    const key = `${f.tier} · ${f.field} · ${f.mode}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

if (isMain(import.meta)) {
  const avecLlm = process.argv.includes("--llm");
  const paliers = avecLlm ? [...ENCODEURS, ...GENERATIFS] : ENCODEURS;
  const failures = await collect(120, paliers);
  console.log(`\n${failures.length} failures across ${paliers.filter((x) => x !== "human").length} tiers`
    + `${avecLlm ? "" : " — add --llm for the generative ladder (needs Ollama)"}\n`);

  console.log("WHAT KIND OF WRONG\n");
  for (const [key, n] of shape(failures).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${key}`);
  }

  console.log("\n\nSIX OF THEM, IN FULL\n");
  // One per tier-and-field pair, so the gallery is not six copies of one problem.
  const seen = new Set<string>();
  const gallery = failures.filter((f) => {
    const k = `${f.tier}:${f.field}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);

  for (const f of gallery) {
    console.log(`  ${f.tier} · ${f.field} · ${f.mode}   [${f.recordId}]`);
    console.log(`    text      ${f.text}`);
    console.log(`    expected  ${JSON.stringify(f.expected)}`);
    console.log(`    got       ${JSON.stringify(f.got)}\n`);
  }
}
