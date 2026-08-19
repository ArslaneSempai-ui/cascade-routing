/**
 * The validation file — what a committee signs.
 *
 * Every other output here is written for someone who wants to know whether the measurement
 * is interesting. This one is written for someone who has to authorise deploying its
 * conclusion, and that reader asks entirely different questions: what changed, what was it
 * measured on, what got worse, and what happens when a provider swaps a model underneath us.
 *
 * ─── Why it is generated and not written ───
 *
 * A validation file typed by hand is the single most dangerous document in this repository.
 * It is read months after the run, by people who were not there, and it is the artefact
 * that says the change is safe. Left to prose it drifts from the figures — and it drifts in
 * the flattering direction, because nobody hand-updates a number downwards. So it is built
 * from the same frozen profile as every table, and a stale one is impossible rather than
 * merely discouraged.
 *
 * ─── What it deliberately does not do ───
 *
 * It does not conclude that anything is fit to deploy. It assembles the evidence a reviewer
 * needs and states, in its own words, what the evidence cannot support. A generated document
 * that awarded itself a pass would be worth nothing to the person signing it.
 */

import { writeFileSync } from "node:fs";
import { isMain } from "./cli.ts";
import { FIELDS } from "./corpus.ts";
import { readProfiles } from "./measure.ts";
import { optimiseExtraction, paliersMesures, latenceRepresentative } from "./optimise.ts";
import { ASSUMPTIONS, STATUSES, pricePerThousandExtractions } from "./assumptions.ts";
import { INVENTORY } from "./inventory.ts";
import { rate, writeRate, distinguishable } from "./interval.ts";
import { MEANING } from "./provenance.ts";
import { table } from "./figures.ts";
import { MODELES_LOCAUX, REVISIONS, LICENCES } from "./tiers.ts";

import type { Profiles } from "./measure.ts";
import type { Assumptions } from "./assumptions.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";

const FICHIER = new URL("../VALIDATION.md", import.meta.url).pathname;

const pc = (x: number) => (x * 100).toFixed(1) + " %";
const euro = (x: number) => "$" + Math.round(x).toLocaleString("en-US");

/** Le taux mesuré d'un palier sur un champ, avec son échantillon. */
const taux = (p: Profiles, e: TierName, c: Field) => {
  const q = p.extraction[e][c];
  return rate(Math.round(q.accuracy * q.items), q.items);
};

export function dossier(p: Profiles, h: Assumptions): string {
  const paliers = paliersMesures(p);
  const s = optimiseExtraction(p, h);
  if (!s) return "# Validation file\n\nNo routing satisfies the stated budgets. Nothing to validate.\n";

  const out: string[] = [];
  const w = (x: string) => out.push(x);

  w(`# Validation file — task-level model routing`);
  w(``);
  w(`Generated from the frozen measurement of \`${p.measuredAt}\`` +
    (p.code ? `, produced by commit \`${p.code.commit}\`${p.code.sale
      ? " **with uncommitted changes in the working tree — this run is not reproducible by anyone, including its author**"
      : ""}` : "") + `. Every figure below is`);
  w(`produced from that same file: this document cannot disagree with the tables elsewhere in`);
  w(`the repository, because it is not written by hand.`);
  w(``);
  /*
   * D'où vient chaque palier, et pas seulement le fichier.
   *
   * Une seule date en tête d'un document signé par un comité laisse croire que tout a été
   * mesuré ensemble. Le fichier est fusionné : deux échelles peuvent venir de deux passes, de
   * deux états d'arbre, de deux jours. Un relecteur doit voir laquelle est laquelle, et un
   * palier sans provenance enregistrée doit le dire plutôt que d'hériter de celle du voisin.
   */
  const prov = paliersMesures(p).map((t) => {
    const v = p.provenance?.[t];
    return [`\`${t}\``, v ? v.measuredAt : "—", v?.commit ? `\`${v.commit}\`` : "not recorded",
      v ? (v.sale === null ? "—" : v.sale ? "**dirty**" : "clean") : "—"];
  });
  if (prov.some((r) => r[1] !== "—")) {
    w(`Not every tier was measured in the same pass. Where a tier predates this record, its`);
    w(`provenance says so rather than borrowing its neighbour's.`);
    w(``);
    w(table(["Tier", "Measured at", "Commit", "Working tree"], prov));
    w(``);
  }
  w(`**This file does not certify anything.** It assembles what a reviewer needs in order to`);
  w(`decide, and states what the evidence will not support. The decision is the committee's.`);

  /* ── 1. Ce qui change ── */
  w(``);
  w(`## 1. What changes`);
  w(``);
  w(`Each field is assigned to the cheapest tier that is not measurably worse than the best`);
  w(`available one. Where two tiers cannot be told apart on this sample, the cheaper is taken`);
  w(`— a difference inside the confidence interval is not a difference to pay for.`);
  w(``);
  w(table(["Field", "Tier", "Accuracy", "95 % interval", "Sample", "Cost at volume"],
    FIELDS.map((c) => {
      const e = s.routing[c], r = taux(p, e, c);
      return [`\`${c}\``, `\`${e}\``, pc(r.rate), `[${(100 * r.low).toFixed(0)}–${(100 * r.high).toFixed(0)}]`,
        `n=${r.n}`, euro((h.volume / 1000) * pricePerThousandExtractions(e, h, p.extraction[e][c].latency))];
    })));
  w(``);
  w(`Overall: **${pc(s.accuracy)}** for **${euro(s.cost)}** against a budget of ${euro(h.budget)}`);
  w(`(${pc(s.budgetShare)} consumed), at **${s.latencyPerItem.toFixed(0)} ms** per document`);
  w(`against a ceiling of ${h.latencyBudgetMs} ms (${pc(s.latencyShare)} consumed).`);

  /* ── 2. Les choix qui ne sont pas mesurables ── */
  w(``);
  w(`## 2. Where the sample cannot decide`);
  w(``);
  const ambigus: string[][] = [];
  for (const c of FIELDS) {
    const choisi = s.routing[c];
    for (const e of paliers) {
      if (e === choisi || e === "human" || choisi === "human") continue;
      const a = taux(p, choisi, c), b = taux(p, e, c);
      if (!distinguishable(a, b)) {
        ambigus.push([`\`${c}\``, `\`${choisi}\``, `\`${e}\``, writeRate(a), writeRate(b)]);
      }
    }
  }
  if (ambigus.length) {
    w(`These pairs are **not distinguishable on this sample**. The routing picked one of them,`);
    w(`and a larger sample could reverse that pick without any model changing. A reviewer`);
    w(`should read these as ties, not as findings.`);
    w(``);
    w(table(["Field", "Chosen", "Indistinguishable from", "Chosen rate", "Other rate"], ambigus));
  } else {
    w(`On this sample every chosen tier is distinguishable from every alternative on its field.`);
    w(`That is a property of this sample size, not a permanent one.`);
  }

  /* ── 3. Ce sur quoi c'est mesuré ── */
  w(``);
  w(`## 3. What it was measured on`);
  w(``);
  w(`**A held-out split, and that is the load-bearing control.** The rules were developed on`);
  w(`one set of phrasings and scored on another they never saw. The first run of this project`);
  w(`scored the hand-written rules at 100 % on all five fields because the regexes had been`);
  w(`written against the very templates used to score them. A test in this repository fails if`);
  w(`the training and held-out phrasings ever share a shape.`);
  w(``);
  w(`**The corpus is synthetic.** It is seeded and reproducible, and it was written by the`);
  w(`author. A held-out split defends against marking your own homework; it does not turn`);
  w(`invented documents into the ones your customers send. On your own documents every figure`);
  w(`in section 1 needs re-measuring, which is what the shipped harness is for.`);
  w(``);
  w(`**The models are pinned by revision**, so a re-run measures the same thing rather than`);
  w(`whatever was published last under the same name.`);
  w(``);
  w(table(["Tier", "Model", "Pinned at", "Licence"], [
    ...Object.entries(REVISIONS).map(([k, v]) => [`\`${k}\``,
      LICENCES[k]?.modele ?? "encoder, local", `\`${v}\``,
      LICENCES[k] ? LICENCES[k]!.licence + (LICENCES[k]!.note ? " ⚠" : "") : "—"]),
    ...Object.entries(MODELES_LOCAUX)
      .filter(([k]) => paliers.includes(k as TierName))
      .map(([k, v]) => [`\`${k}\``, `\`${v.tag}\``, `\`${v.digest}\``,
        LICENCES[k]?.licence ?? "—"]),
  ]));
  const conditionnelles = Object.values(LICENCES).filter((l) => l.note);
  if (conditionnelles.length) {
    w(``);
    w(`⚠ ${conditionnelles.map((l) => `**${l.modele}** — ${l.licence}: ${l.note}`).join("; ")}.`);
    w(`Every other model here is permissive with no practical condition. A routing that places`);
    w(`that tier on a field takes on an obligation the others do not, and no accuracy table`);
    w(`would ever show it.`);
  }

  /* ── 4. Ce qui se dégrade ── */
  w(``);
  w(`## 4. What gets worse`);
  w(``);
  w(`A routing that improves an average still loses ground somewhere, and that is the part a`);
  w(`reviewer must see. Against the best accuracy available on each field regardless of price:`);
  w(``);
  const pertes = FIELDS.map((c) => {
    const choisi = s.routing[c];
    const meilleur = paliers
      .filter((e) => e !== "human")
      .reduce((a, b) => (p.extraction[b][c].accuracy > p.extraction[a][c].accuracy ? b : a));
    const ecart = p.extraction[meilleur][c].accuracy - p.extraction[choisi][c].accuracy;
    return { c, choisi, meilleur, ecart };
  }).filter((x) => x.ecart > 0);
  if (pertes.length) {
    w(table(["Field", "Chosen", "Best available", "Accuracy given up", "Why"],
      pertes.map((x) => [`\`${x.c}\``, `\`${x.choisi}\``, `\`${x.meilleur}\``, pc(x.ecart),
        distinguishable(taux(p, x.choisi, x.c), taux(p, x.meilleur, x.c))
          ? "a real loss, taken for cost or latency"
          : "inside the interval — not a measurable loss"])));
  } else {
    w(`Nothing. The routing takes the best measured tier on every field.`);
  }
  w(``);
  w(`The repository also publishes every individual failure with its input and output rather`);
  w(`than a summary rate — run \`npm run failures\`. A reviewer who wants to know what the`);
  w(`system gets wrong should read those, not this percentage.`);

  /* ── 5. Les hypothèses ── */
  w(``);
  w(`## 5. What is assumed rather than measured`);
  w(``);
  w(`Nothing in section 1 depends on the author's opinion except through these. Each is an`);
  w(`input you replace with your own, and the sensitivity sweep (\`npm run sensitivity\`) says`);
  w(`which of them change the answer and which do not.`);
  w(``);
  w(table(["Input", "Kind", "Value"],
    (Object.keys(STATUSES) as (keyof Assumptions)[])
      .map((k) => [`\`${k}\``, MEANING[STATUSES[k]].label, String(h[k])])));
  w(``);
  w(`The human tier's accuracy is an assumption and never a measurement. An optimiser that`);
  w(`believes a human is infallible routes everything to them, and the conclusion goes wrong`);
  w(`in the direction that costs the most.`);

  /* ── 6. La surveillance ── */
  w(``);
  w(`## 6. Ongoing monitoring`);
  w(``);
  w(`**A routing decision expires.** It was taken against pinned revisions on a fixed sample;`);
  w(`a provider updating a model, or your own traffic drifting, invalidates it silently — no`);
  w(`error is raised, the accuracy simply moves. Three things follow, and they are the`);
  w(`obligation this document creates rather than a recommendation:`);
  w(``);
  w(`1. **Re-measure on a schedule and on every model change.** The harness ships with the`);
  w(`   routing; \`npm run measure\` reproduces the whole table. Anything else is trusting a`);
  w(`   number whose expiry date has passed.`);
  w(`2. **Compare runs rather than reading the latest one.** A rising aggregate can hide cases`);
  w(`   that used to pass and no longer do; only a run-to-run diff surfaces those.`);
  w(`3. **Watch the input distribution, not only the output.** Accuracy falls after the`);
  w(`   population has already moved, which makes it the last indicator to react.`);

  /* ── 7. Les limites ── */
  w(``);
  w(`## 7. What this does not establish`);
  w(``);
  w(`- **Not that the chain is fit for production.** ${pc(s.accuracy)} is a routing result on`);
  w(`  a synthetic corpus, not a control effectiveness statement. Where the field feeds a`);
  w(`  regulatory obligation, the escalation boundary decides that, not this average.`);
  w(`- **Not that the tiers rank this way on your data.** The two chains in this repository`);
  w(`  rank them in opposite orders. Any conclusion that does not begin with measuring your`);
  w(`  own chain is describing someone else's.`);
  w(`- **Not that the cost is what you will pay.** Prices here are assumed and editable;`);
  w(`  batching, caching and streaming each change the economics substantially and none is`);
  w(`  modelled.`);
  w(`- **Not that latency is safe under load.** It is measured one item at a time on an idle`);
  w(`  machine. Queueing behaviour is a different measurement and is not in this file.`);
  w(``);
  w(`---`);
  w(``);
  w(`*Generated by \`npm run dossier\` from \`data/profiles.json\`. Regenerating it after any`);
  w(`re-measurement is the only supported way to keep it true.*`);
  w(``);
  return out.join("\n");
}

if (isMain(import.meta)) {
  const p = readProfiles();
  if (!p) {
    console.error("No frozen profile. Run `npm run measure` first.");
    process.exit(1);
  }
  const texte = dossier(p, ASSUMPTIONS);
  writeFileSync(FICHIER, texte);
  console.log(`\nValidation file written to VALIDATION.md — ${texte.split("\n").length} lines,`
    + ` from the measurement of ${p.measuredAt}.\n`);
}
