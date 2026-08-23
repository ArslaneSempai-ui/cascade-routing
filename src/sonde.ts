/**
 * La sonde générative — mesurée, plus tapée.
 *
 * Ce document répond à l'objection la plus juste qu'on puisse faire au dépôt : « votre échelle
 * est faite d'encodeurs, ce n'est pas du routage de LLM ». Il met de vrais modèles génératifs
 * sur le même corpus, jugés par le même évaluateur, et regarde si la conclusion survit.
 *
 * ─── POURQUOI IL EST ENGENDRÉ, ET CE QUE ÇA A COÛTÉ DE NE PAS L'ÊTRE ───
 *
 * Il ne l'était pas. Cinquante-huit chiffres tapés à la main, aucun générateur, aucun contrôle
 * dans `npm test`. Le 23 août 2026, onze de ses chiffres ont été confrontés au relevé scellé :
 * LES ONZE ÉTAIENT FAUX. Pas faux le jour où ils ont été écrits — faux depuis, parce que les
 * paliers encodeurs ont été remesurés le 20 août à mille cas au lieu de cent vingt, et que
 * personne ne relit un document de sept kilo-octets pour y répercuter une remesure.
 *
 * L'écart n'était pas cosmétique. Deux phrases de conclusion étaient fausses :
 *
 *   — « Against roberta's 38.3 %, that is +57.5 points » — roberta est à 32,8 %, l'écart est
 *     de +63,0 points. Le document sous-vendait son propre résultat.
 *   — « the free regex ties the 8B model, 83.3 % against 83.3 % » — le regex est à 79,7 %.
 *     Il ne fait plus jeu égal, il PERD de 3,6 points, et la phrase qui s'en servait pour
 *     dire « l'encodeur n'est pas dépassé » disait le contraire de la mesure.
 *
 * Et les cinq latences publiées étaient fausses de −31 % à +37 %.
 *
 * D'où la règle appliquée ici : AUCUN CHIFFRE N'EST ÉCRIT DANS CE FICHIER. Les taux viennent
 * du relevé, les écarts se soustraient, et les verdicts de séparation sont rendus par
 * `distinguishable()` plutôt que recopiés. Une phrase qui dit « les intervalles ne se touchent
 * pas » est calculée : si un jour ils se touchent, la phrase change toute seule.
 *
 * ─── LES DEUX TAILLES D'ÉCHANTILLON ───
 *
 * Les encodeurs sont mesurés à mille cas, les génératifs à cent vingt. Ce n'est pas une
 * négligence : cent vingt cas de génératif local, c'est vingt-cinq minutes d'inférence, et
 * aucune décision de ce dépôt ne dépend d'un intervalle plus serré sur cette échelle-là. Mais
 * ça se dit, parce qu'un lecteur qui compare deux colonnes compare aussi deux précisions —
 * et le document précédent affirmait « 120 held-out cases per chain » pour tout le monde,
 * ce qui était devenu faux sans que rien ne l'écrive.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";
import { FIELDS, type Field } from "./corpus.ts";
import { readProfiles, type Profiles } from "./measure.ts";
import { rate, writeRate, distinguishable, type Rate } from "./interval.ts";
import { table } from "./figures.ts";
import { MODELES_LOCAUX } from "./tiers.ts";
import type { TierName } from "./paliers.ts";

const FICHIER = fileURLToPath(new URL("../SONDE.md", import.meta.url));

/** Les six paliers que la sonde compare, dans l'ordre où le lecteur les découvre. */
const PALIERS: TierName[] = ["rules", "small", "large", "gen-0.6b", "gen-4b", "gen-8b"];
const GEN: TierName[] = ["gen-0.6b", "gen-4b", "gen-8b"];

/**
 * La FAMILLE d'un palier — règles, encodeur, génératif.
 *
 * Séparée du palier parce qu'un compte a failli sortir sous le mauvais nom : « spans 4
 * families » comptait en réalité quatre PALIERS, dont deux de la même famille générative.
 * Un nombre juste sous un qualificatif faux se cite tel quel et ne se revérifie jamais.
 */
const FAMILLE: Record<string, string> = {
  rules: "free rules", small: "extractive encoders", large: "extractive encoders",
  "gen-0.6b": "local generative", "gen-4b": "local generative", "gen-8b": "local generative",
};

/** Les noms publics. Le relevé nomme des paliers ; le lecteur connaît des modèles. */
const NOM: Record<string, string> = {
  rules: "rules", small: "distilbert", large: "roberta",
  "gen-0.6b": "qwen3:0.6b", "gen-4b": "qwen3:4b", "gen-8b": "qwen3:8b",
};

type Cellule = { accuracy: number; items: number; latency?: number };

const cellule = (p: Profiles, chaine: "extraction" | "classification", t: TierName, f?: Field) => {
  const c = chaine === "extraction"
    ? (p as never as Record<string, Record<string, Record<string, Cellule>>>).extraction?.[t]?.[f!]
    : (p as never as Record<string, Record<string, Cellule>>).classification?.[t];
  return c;
};

/** Un taux avec son intervalle, depuis une cellule du relevé. L'idiome du dépôt. */
const taux = (c: Cellule | undefined): Rate | undefined =>
  c && c.items ? rate(Math.round(c.accuracy * c.items), c.items) : undefined;

const pc = (r: Rate | undefined, gras = false) =>
  !r ? "—" : gras ? `**${(r.rate * 100).toFixed(1)} %**` : `${(r.rate * 100).toFixed(1)} %`;

const pts = (a: number, b: number) => `${a - b >= 0 ? "+" : ""}${(a - b).toFixed(1)}`;

/**
 * « Les intervalles se touchent-ils ? » — rendu par la mesure, jamais par la mémoire.
 *
 * C'est la phrase qui a le plus de valeur dans ce document et c'est aussi la plus facile à
 * laisser rouiller : elle reste grammaticalement vraie quand les chiffres bougent.
 */
const separe = (a: Rate | undefined, b: Rate | undefined) =>
  a && b && distinguishable(a, b);

export function sonde(p: Profiles): string {
  const out: string[] = [];
  const w = (l: string) => out.push(l);

  const ex = (t: TierName, f: Field) => taux(cellule(p, "extraction", t, f));
  const cl = (t: TierName) => taux(cellule(p, "classification", t));
  const lat = (t: TierName) => cellule(p, "extraction", t, "name")?.latency;

  const nEnc = ex("large", "name")?.n ?? 0;
  const nGen = ex("gen-4b", "name")?.n ?? 0;

  w(`# Probe — does a local generative ladder change the finding?`);
  w(``);
  w(`*Generated by \`npm run sonde\` from \`data/profiles.json\`, measured`);
  w(`${String(p.measuredAt).slice(0, 10)}. Local generative tiers through Ollama;`);
  w(`${Object.values(MODELES_LOCAUX).map((m) => `\`${m.tag}\``).join(", ")}, scored by this`);
  w(`repository's own \`correct()\`, on the same held-out split as every other figure here.*`);
  w(``);
  w(`**Two sample sizes, and the difference is not cosmetic.** The encoder tiers carry`);
  w(`n=${nEnc}; the generative tiers carry n=${nGen}, because ${nGen} cases of local`);
  w(`inference is roughly twenty-five minutes and no decision here needs a tighter interval`);
  w(`than that. Every rate below is written with its own interval and its own n, so the two`);
  w(`are never silently compared as if they were measured the same way.`);
  w(``);
  w(`---`);
  w(``);
  w(`## What was asked`);
  w(``);
  w(`The repository's ladder is encoder models — extractive QA and embeddings. The standing`);
  w(`objection, and the fair one, is that this is not LLM routing. So: put real generative`);
  w(`models on the same corpus, judged by the same scorer, and see whether the finding`);
  w(`survives.`);
  w(``);
  w(`Qwen3 at 0.6B, 4B and 8B, local through Ollama. 32B was ruled out before starting: at`);
  w(`4-bit it needs roughly 20 GB of weights, and this machine has 16 GB of unified memory.`);
  w(``);
  w(`## Chain A — extraction`);
  w(``);
  w(table(
    ["Field", ...PALIERS.map((t) => `\`${NOM[t]}\``)],
    FIELDS.map((f) => {
      const rs = PALIERS.map((t) => ex(t, f));
      const meilleur = Math.max(...rs.map((r) => r?.rate ?? -1));
      return [`\`${f}\``, ...rs.map((r) => pc(r, !!r && r.rate === meilleur))];
    }),
  ));
  w(``);
  w(`Every rate with its 95 % interval and its sample size:`);
  w(``);
  w(table(
    ["Field", ...PALIERS.map((t) => `\`${NOM[t]}\``)],
    FIELDS.map((f) => [`\`${f}\``, ...PALIERS.map((t) => { const r = ex(t, f); return r ? writeRate(r) : "—"; })]),
  ));
  w(``);
  w(`## Chain B — classification`);
  w(``);
  w(table(
    PALIERS.map((t) => `\`${NOM[t]}\``),
    [PALIERS.map((t) => { const r = cl(t); return r ? writeRate(r) : "—"; })],
  ));
  w(``);
  w(`## Latency, per call`);
  w(``);
  w(table(
    PALIERS.map((t) => `\`${NOM[t]}\``),
    [PALIERS.map((t) => { const l = lat(t); return l === undefined ? "—" : l < 1 ? "<1 ms" : `${Math.round(l).toLocaleString("en-US")} ms`; })],
  ));
  w(``);
  w(`These move by 20–30 % between runs depending on what is warm, and the frozen profile`);
  w(`records the machine load at the moment each was taken. Treat them as an order of`);
  w(`magnitude, not a measurement — the same caveat the README already carries.`);
  w(``);

  /* ── ce que la sonde change, calculé et non recopié ── */
  const adr4b = ex("gen-4b", "address"), adrLarge = ex("large", "address"), adr8b = ex("gen-8b", "address");
  w(`## The finding this changes, and why that is good news`);
  w(``);
  w(`The README's strongest sentence is that no available tier can read an address, and that`);
  w(`the next gain is a step and not a slope — buying exactly one field.`);
  w(``);
  if (adr4b && adrLarge) {
    w(`**A 4B model reads the address at ${writeRate(adr4b)}.** Against \`roberta\`'s`);
    w(`${writeRate(adrLarge)}, that is ${pts(adr4b.rate * 100, adrLarge.rate * 100)} points on`);
    w(`the one field the optimiser singled out, and the intervals`);
    w(`${separe(adr4b, adrLarge) ? "do not touch" : "**overlap — this sample cannot separate them**"}.`);
    w(``);
  }
  w(`That does not refute the finding. It *pays it out.* The tool predicted, from measurement`);
  w(`alone, that the gain worth wanting was on the address field and that it would cost a step`);
  w(`change rather than more budget. Encoder to generative is exactly a step change, and it`);
  w(`moved exactly that field. A prediction that came true is a better result than a ceiling.`);
  w(``);

  w(`## The finding is now sharper, not weaker`);
  w(``);
  /* La phrase historique porte un verdict — « c'était faux » — que le calcul rend deux lignes
     plus bas. Les deux doivent venir de la même source, sinon la prose survit au chiffre. */
  const sepAdresse = separe(ex("gen-8b", "address"), ex("gen-4b", "address"));
  w(`At 20 cases the probe read 4B and 8B as indistinguishable on extraction. At ${nGen} that`);
  w(sepAdresse
    ? `is wrong, and wrong in the interesting direction.`
    : `still holds on the address: this sample does not separate them either, and the`
      + ` paragraph below says so rather than claiming a difference.`);
  w(``);
  if (adr8b && adr4b) {
    const pire = adr8b.rate < adr4b.rate;
    const l8 = lat("gen-8b"), l4 = lat("gen-4b");
    w(`**On the address, the 8B model is ${pire ? "worse" : "no better"} than the 4B:**`);
    w(`${writeRate(adr8b)} against ${writeRate(adr4b)}. The intervals`);
    w(`${separe(adr8b, adr4b) ? "do not overlap" : "**overlap, so this sample cannot separate them**"}.`);
    if (pire && l8 && l4) {
      w(`Doubling the model loses ${Math.abs(+pts(adr8b.rate * 100, adr4b.rate * 100)).toFixed(1)} points`);
      w(`and costs ${(((l8 - l4) / l4) * 100).toFixed(0)} % more latency.`);
    }
    w(``);
  }
  const clGen = GEN.map((t) => cl(t));
  const monotone = clGen.every((r, i) => i === 0 || (r && clGen[i - 1] && r.rate >= clGen[i - 1]!.rate));
  w(`**On classification the same ladder is ${monotone ? "strictly monotonic" : "NOT monotonic"}**:`);
  w(`${clGen.map((r) => pc(r)).join(", ")}. ${monotone ? "Bigger is better, cleanly." : "Bigger is not reliably better here."}`);
  w(``);
  w(`Same three models, same machine, same run. Bigger is worse on one task and better on the`);
  w(`other. That is the thesis of this repository stated as sharply as it can be stated, and`);
  w(`it is measured on real generative models rather than inferred from encoders.`);
  w(``);

  /* ── là où l'encodeur tient encore, décidé par la mesure ── */
  w(`## The encoders were not superseded`);
  w(``);
  const tenus = FIELDS.filter((f) => {
    const best = Math.max(...GEN.map((t) => ex(t, f)?.rate ?? -1));
    const enc = Math.max(...(["rules", "small", "large"] as TierName[]).map((t) => ex(t, f)?.rate ?? -1));
    return enc >= best;
  });
  /* Si un jour aucun champ ne tient, le titre de cette section devient faux et la liste vide.
     Un document engendré doit pouvoir annoncer sa propre réfutation. */
  if (!tenus.length) {
    w(`**On this measurement, that is no longer true.** A generative tier now equals or beats`);
    w(`the best encoder on all ${FIELDS.length} fields. The section title above is kept because`);
    w(`it records what was true, and this paragraph records that it stopped being true.`);
  } else {
    w(`The result that would have been easy to assume — that a generative ladder simply wins —`);
    w(`is false here, on ${tenus.length} of ${FIELDS.length} fields:`);
  }
  w(``);
  if (tenus.length)
  for (const f of tenus) {
    const encT = (["rules", "small", "large"] as TierName[])
      .reduce((a, b) => ((ex(b, f)?.rate ?? -1) > (ex(a, f)?.rate ?? -1) ? b : a));
    const genT = GEN.reduce((a, b) => ((ex(b, f)?.rate ?? -1) > (ex(a, f)?.rate ?? -1) ? b : a));
    const e = ex(encT, f)!, g = ex(genT, f)!;
    /*
     * LE VERBE SUIT LE VERDICT, PAS LE CLASSEMENT.
     *
     * « still wins » sortait dès que le taux encodeur était le plus haut — y compris quand les
     * intervalles se chevauchaient, c'est-à-dire quand l'échantillon ne sépare pas les deux. Un
     * document qui existe pour dire ce que la mesure ne porte pas ne peut pas écrire « wins »
     * sur une différence que sa propre borne refuse.
     */
    const egal = Math.abs(e.rate - g.rate) < 1e-9;
    const verbe = egal ? "ties" : separe(e, g) ? "still wins" : "is not beaten";
    w(`- **\`${f}\`: \`${NOM[encT]}\` ${verbe}**, ${writeRate(e)} against`);
    w(`  ${writeRate(g)} for \`${NOM[genT]}\`${separe(e, g) ? " — the intervals do not touch" : " — the intervals overlap, so this sample does not separate them"}.`);
  }
  w(``);

  /* ── le meilleur assignement, calculé ── */
  const parChamp = FIELDS.map((f) => {
    const t = PALIERS.reduce((a, b) => ((ex(b, f)?.rate ?? -1) > (ex(a, f)?.rate ?? -1) ? b : a));
    return { f, t, r: ex(t, f)! };
  });
  const moyenne = parChamp.reduce((s, x) => s + x.r.rate, 0) / parChamp.length;
  const gratuits = parChamp.filter((x) => x.t === "rules").length;
  const publie = FIELDS.reduce((s, f) => {
    const t = (["rules", "small", "large"] as TierName[])
      .reduce((a, b) => ((ex(b, f)?.rate ?? -1) > (ex(a, f)?.rate ?? -1) ? b : a));
    return s + (ex(t, f)?.rate ?? 0);
  }, 0) / FIELDS.length;
  const familles = new Set(parChamp.map((x) => FAMILLE[x.t]!));
  w(`On accuracy alone, the best per-field assignment now spans all`);
  w(`${familles.size} families at once — ${[...familles].join(", ")} —`);
  w(`${parChamp.map((x) => `\`${NOM[x.t]}\` for the ${x.f}`).join(", ")}, giving`);
  w(`${(moyenne * 100).toFixed(1)} % against ${(publie * 100).toFixed(1)} % for the best`);
  w(`encoder-only assignment, with ${gratuits} of ${FIELDS.length} fields still free. Which is`);
  w(`the argument for measuring per field, made without a sentence of advocacy.`);
  w(``);
  w(`**This average is a mean of five per-field rates measured on separate samples, not a`);
  w(`proportion of anything.** It carries no interval for that reason, and the per-field rates`);
  w(`above are the figures to quote.`);
  w(``);

  /* ── prose pure : aucun chiffre, donc rien à rouiller ── */
  w(`## What the probe cost me in wrong answers first`);
  w(``);
  w(`Two full runs scored zero on every field before anything worked, and both were the`);
  w(`harness, not the model.`);
  w(``);
  w(`**Free-text generation does not work at all here.** qwen3 reasons in ordinary prose — "We`);
  w(`are given a document string and we need to extract…" — not inside \`<think>\` tags, so`);
  w(`\`think: false\` suppresses nothing and \`/no_think\` returns an empty string. A JSON schema`);
  w(`on the response is not a refinement; it is the only thing that produces a value.`);
  w(``);
  w(`**And a schema alone is not enough.** With one, the model filled the field with the`);
  w(`*question* ("the identity document number") or with the entire document. One worked`);
  w(`example in the prompt fixed both, and took the address from nothing to the rate above.`);
  w(``);
  w(`Both were my errors, recorded because this is the third time in this repository that a`);
  w(`broken harness has been mistaken for a broken model, and the first two cost more.`);
  w(``);

  w(`## What is not honest to claim yet`);
  w(``);
  w(`- **The probe's own first reading was wrong**, and it took the full sample to see it.`);
  w(`  Twenty cases said "indistinguishable on extraction"; ${nGen} said otherwise. A`);
  w(`  conclusion drawn from twenty cases was confidently wrong in this repository, which is`);
  w(`  why every figure here carries its interval.`);
  w(`- **This document was itself typed by hand until ${String(p.measuredAt).slice(0, 10)}**,`);
  w(`  and eleven of its figures had gone stale against the frozen profile — including two`);
  w(`  sentences of conclusion. It is generated now, which is the only reason the numbers`);
  w(`  above can be trusted to still be the measured ones.`);
  w(`- **The generative tier got prompt engineering the encoders cannot receive.** A one-shot`);
  w(`  example and a constrained schema are not available to an extractive QA head. That is a`);
  w(`  property of the tier type rather than a thumb on the scale, but the comparison is not`);
  w(`  like-for-like and should say so.`);
  w(`- **The cost model does not fit a local tier.** Prices here are per thousand API calls. A`);
  w(`  model on your own silicon costs time and electricity, and at these latencies that is`);
  w(`  not a rounding error. A budget in seconds belongs beside the budget in dollars.`);
  w(``);
  w(`## What a full build would take`);
  w(``);
  w(`Ollama and the three models are installed and the harness is repository code. What`);
  w(`remains is the cost basis for a local tier, then figures, README, tests and demo data`);
  w(`regenerated. The recommendation stands: keep the encoder ladder as the default that`);
  w(`reproduces with no download, and the generative ladder behind \`--llm\`.`);
  w(``);
  w(`*Regenerate with \`npm run sonde\` after any re-measurement. \`npm test\` refuses a stale`);
  w(`copy.*`);
  w(``);
  return out.join("\n");
}

if (isMain(import.meta)) {
  const p = readProfiles();
  if (!p) {
    console.error("No frozen profile. Run `npm run measure` first.");
    process.exit(1);
  }
  const texte = sonde(p);

  if (process.argv.includes("--check")) {
    const surDisque = existsSync(FICHIER) ? readFileSync(FICHIER, "utf8") : "";
    if (surDisque === texte) {
      console.log(`SONDE.md is up to date — from the measurement of ${p.measuredAt}.`);
      process.exit(0);
    }
    console.error(`SONDE.md is stale — it no longer matches the frozen profile.`);
    console.error(`  Run: npm run sonde`);
    process.exit(1);
  }

  writeFileSync(FICHIER, texte);
  console.log(`SONDE.md written from the measurement of ${p.measuredAt}.`);
}
