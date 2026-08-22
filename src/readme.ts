/**
 * The figures this README is allowed to state.
 *
 * Measured output only. The prose is hand-written; the numbers are not, because the
 * numbers are what went stale twice before this existed.
 */

import { readProfiles } from "./measure.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { INVENTORY } from "./inventory.ts";
import { markdown } from "./provenance.ts";
import { optimiseExtraction, optimiseClassification, budgetShadowPrice, latenceRepresentative, paliersMesures } from "./optimise.ts";
import { ASSUMPTIONS, pricePerThousandExtractions, accuracy } from "./assumptions.ts";
import { collect, shape } from "./failures.ts";
import { FIELDS } from "./corpus.ts";
import { TIERS } from "./tiers.ts";
import { run as emit, table } from "./figures.ts";
import { rate, writeRate, distinguishable } from "./interval.ts";
import { GENERATIFS } from "./paliers.ts";
import { majorityClass, uniformGuess, verdict } from "./baselines.ts";
import { generateAlerts } from "./corpus.ts";
import { TYPOLOGIES } from "./corpus.ts";

const p = readProfiles();
if (!p) { console.error("No profile measured — start with: npm run measure"); process.exit(1); }
const h = ASSUMPTIONS;
/* Les paliers réellement dans le profil, jamais la liste complète : l'échelle générative
   est optionnelle, et un dépôt cloné puis mesuré n'en contient que quatre. */
const mesures = paliersMesures(p).filter((t) => t !== "human");
const pc = (x: number) => (x * 100).toFixed(1) + " %";
const euro = (n: number) => "$" + Math.round(n).toLocaleString("en-GB");

const extraction = table(
  ["Tier", ...FIELDS, "Latency"],
  mesures.map((t) => [
    `\`${t}\``,
    ...FIELDS.map((f) => pc(p.extraction[t][f].accuracy)),
    (FIELDS.reduce((s, f) => s + p.extraction[t][f].latency, 0) / FIELDS.length).toFixed(1) + " ms",
  ]),
);

const classification = table(
  ["Tier", "Accuracy", "95 % interval", "Latency"],
  mesures.map((t) => {
    const prof = p.classification[t];
    const r = rate(Math.round(prof.accuracy * prof.items), prof.items);
    return [`\`${t}\``, pc(prof.accuracy),
      `[${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}]`,
      prof.latency.toFixed(2) + " ms"];
  }),
);

const best = optimiseExtraction(p, h);
const routing = best ? table(
  ["Field", "Tier chosen", "Accuracy", "Cost"],
  FIELDS.map((f) => {
    const t = best.routing[f];
    return [f, `\`${t}\``, pc(accuracy(t, p.extraction[t][f].accuracy, h)),
      euro((h.volume / 1000) * pricePerThousandExtractions(t, h, latenceRepresentative(p, t)))];
  }).concat([["**total**", "", `**${pc(best.accuracy)}**`, `**${euro(best.cost)}**`]]),
) : "";

const shadow = (() => {
  const f = budgetShadowPrice(p, h);
  if (!f || !best) return "";
  if (!f.step) return "No budget buys better: the ceiling is in the tiers available.";
  const m = f.step;
  const changed = FIELDS.filter((c) => m.routing[c] !== best.routing[c]);
  return `Budget used: **${euro(f.currentCost)} of ${euro(f.currentBudget)}** — ${pc(best.budgetShare)}. ` +
    `The constraint ${f.constraintBinds ? "**binds**" : "**does not bind**"}.\n\n` +
    `The next real gain is **+${m.gainPoints.toFixed(1)} points of accuracy**, it costs ` +
    `**${euro(m.extra)} more** — ${(m.budgetNeeded / f.currentCost).toFixed(0)}× current spend — ` +
    `and it buys exactly one field: ${changed.map((c) => `\`${c}\``).join(", ")}.`;
})();

const f = await collect();
const gallery = (() => {
  const seen = new Set<string>();
  const six = f.filter((x) => {
    const k = `${x.tier}:${x.field}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);

  const counts = table(["Failures", "Tier · field · what kind of wrong"],
    shape(f).slice(0, 6).map(([k, n]) => [n, k]));

  const examples = six.map((x) =>
    "```\n" + `${x.tier} · ${x.field} · ${x.mode}   [${x.recordId}]\n` +
    `  text      ${x.text}\n` +
    `  expected  ${JSON.stringify(x.expected)}\n` +
    `  got       ${JSON.stringify(x.got)}\n` + "```").join("\n\n");

  return `${f.length} failures across the machine tiers, grouped by what actually went wrong:\n\n${counts}\n\n${examples}`;
})();

/*
 * A percentage without its baseline invites the one question you cannot answer.
 *
 * The keyword classifier scores 24.2 %. Whether that is bad was unanswerable until the
 * trivial baseline was computed: always naming the most common typology scores 25.0 %.
 * The rules are not "worse" in any measurable sense — they are indistinguishable from a
 * constant, which is the more precise and more damning statement.
 */
const alerts = generateAlerts(120, "heldout");
const majority = majorityClass(alerts.map((a) => a.truth));
const uniform = uniformGuess(TYPOLOGIES.length);

const baselines = table(
  ["", "Accuracy", "Verdict"],
  [
    [`${majority.name}`, pc(majority.accuracy), `*${majority.what}*`],
    [`${uniform.name}`, pc(uniform.accuracy), `*${uniform.what}*`],
    ...mesures.map((t) => [
      `\`${t}\``, pc(p.classification[t].accuracy),
      verdict(p.classification[t].accuracy, majority, p.classification[t].items),
    ]),
  ],
);

/*
 * Les deux échelles côte à côte.
 *
 * C'est la figure qui porte la trouvaille : les plafonds diffèrent par champ, et ils
 * diffèrent *différemment* selon la famille de modèles. Un encodeur spécialisé garde le nom,
 * des règles gratuites gardent trois champs, un génératif prend l'adresse. Aucune famille ne
 * gagne partout, ce qui est exactement l'argument.
 */
const echelles = (() => {
  const gen = mesures.filter((t) => (GENERATIFS as string[]).includes(t));
  if (!gen.length) {
    return "The generative ladder is not in this profile. `npm run measure -- --llm` adds it "
      + "— it needs Ollama and about eight gigabytes of models, which is why it is optional.";
  }
  const lignes = FIELDS.map((c) => {
    const meilleur = mesures.reduce((a, b) =>
      p!.extraction[b][c].accuracy > p!.extraction[a][c].accuracy ? b : a);
    return [`\`${c}\``, ...mesures.map((e) =>
      (e === meilleur ? "**" : "") + pc(p!.extraction[e][c].accuracy) + (e === meilleur ? "**" : "")),
      `\`${meilleur}\``];
  });
  return table(["Field", ...mesures.map((e) => `\`${e}\``), "Best"], lignes);
})();

/*
 * Le budget de temps, resserré cran par cran.
 *
 * Le README disait que la latence était mesurée mais ne jouait aucun rôle dans le routage,
 * et que l'optimiseur enverrait donc volontiers un champ temps réel sur le palier le plus
 * lent. Cette table est la réponse : on voit ce qu'un engagement de service coûte en
 * justesse, ce qui est la seule façon utile de poser la question.
 */
const latence = (() => {
  const paliersMs = [h.latencyBudgetMs, 500, 100, 50, 30];
  const vus = new Set<string>();
  const lignes: (string | number)[][] = [];
  for (const ms of paliersMs) {
    const s = optimiseExtraction(p!, { ...h, latencyBudgetMs: ms });
    const cle = s ? JSON.stringify(s.routing) : "aucune";
    if (vus.has(cle)) continue;      // un plafond qui ne change rien n'apprend rien
    vus.add(cle);
    lignes.push(s
      ? [`${ms} ms`, pc(s.accuracy), euro(s.cost), `${s.latencyPerItem.toFixed(1)} ms`,
         FIELDS.map((c) => `\`${s.routing[c]}\``).join(" ")]
      : [`${ms} ms`, "—", "—", "—", "*no routing is fast enough*"]);
  }
  /*
   * Le prix fictif du temps, et il n'était pas prévu.
   *
   * Le budget d'argent ne mord pas — 193 $ sur 4 000. Le budget de temps, lui, mord : sans
   * plafond, l'optimiseur trouve un routage indiscernable en justesse et nettement moins
   * cher, qu'il doit refuser parce qu'il dépasse la promesse de latence. Deux contraintes
   * dont une seule contraint, et ce n'est pas celle que tout le monde regarde.
   */
  const sans = optimiseExtraction(p!, { ...h, latencyBudgetMs: Number.MAX_SAFE_INTEGER });
  const avec = optimiseExtraction(p!, h);
  const note = (sans && avec && sans.cost < avec.cost)
    ? `\n\n**What the promise costs.** Lift the ceiling entirely and the cheapest routing that is `
      + `statistically indistinguishable in accuracy costs ${euro(sans.cost)} instead of `
      + `${euro(avec.cost)} — it just takes ${sans.latencyPerItem.toFixed(0)} ms per document. `
      + `**Your latency promise is worth ${euro(avec.cost - sans.cost)}**, and the money budget `
      + `never binds at all. That is the shadow price nobody prices.`
    : "";
  return table(["Ceiling per document", "Accuracy", "Cost", "Actual", "Routing"], lignes) + note;
})();

/*
 * Ce que l'échantillon ne sait pas trancher.
 *
 * Publier les égalités à côté des écarts est ce qui a rattrapé une affirmation fausse de ce
 * projet : le grand modèle *est* sous le petit sur l'adresse, de 4,2 points, et les
 * intervalles se chevauchent au point que la phrase ne tenait pas. Un lecteur a le droit de
 * savoir lesquelles de ces comparaisons sont des faits et lesquelles sont des ex æquo.
 */
const egalites = (() => {
  const lignes: string[][] = [];
  for (const c of FIELDS) {
    for (let i = 0; i < mesures.length; i++) {
      for (let j = i + 1; j < mesures.length; j++) {
        const a = mesures[i]!, b = mesures[j]!;
        const qa = p!.extraction[a][c], qb = p!.extraction[b][c];
        const ra = rate(Math.round(qa.accuracy * qa.items), qa.items);
        const rb = rate(Math.round(qb.accuracy * qb.items), qb.items);
        if (qa.accuracy === qb.accuracy) continue;      // une égalité exacte n'étonne personne
        if (!distinguishable(ra, rb)) {
          lignes.push([`\`${c}\``, `\`${a}\``, writeRate(ra), `\`${b}\``, writeRate(rb)]);
        }
      }
    }
  }
  if (!lignes.length) return "On this sample every tier is distinguishable from every other on every field.";
  return table(["Field", "Tier", "Rate", "Tier", "Rate"], lignes.slice(0, 8));
})();

/*
 * Ce que la fuite a coûté, mesuré.
 *
 * L'invite a été réglée en lisant des scores held-out. Plutôt que de s'en excuser, on la
 * fait tourner sur `dev` — une moitié qu'elle n'a jamais vue — et on publie l'écart. Un
 * prompt qui se transporte n'a rien coûté ; un prompt qui s'effondre avait été ajusté au
 * jeu de test, et le chiffre publié était emprunté.
 */
const fuite = (() => {
  const f = new URL("../data/fuite.json", import.meta.url).pathname;
  if (!existsSync(f)) {
    return "Not measured yet — run `npm run fuite`. Until it is, the generative figures on this "
      + "page carry a prompt tuned against the half they are scored on, and are optimistic by an "
      + "unknown amount.";
  }
  const d = JSON.parse(readFileSync(f, "utf8")) as {
    palier: string; champs: Record<string, { dev: number; heldout: number; n: number }>;
  };
  return table(["Field", "Tuned against (`heldout`)", "Never seen (`dev`)", "Gap"],
    Object.entries(d.champs).map(([c, v]) => [`\`${c}\``, pc(v.heldout), pc(v.dev),
      `${((v.dev - v.heldout) * 100).toFixed(1)} pts`]))
    + `\n\nMeasured on \`${d.palier}\`, ${Object.values(d.champs)[0]!.n} cases per half.`;
})();

/*
 * Les deux faits que la table d'extraction contient et que personne ne devine.
 *
 * Ils étaient écrits à la main — « 83 % contre 68 % et 63 % » — et sont devenus faux à la
 * remesure à mille cas, sur la page publiée, sans que rien ne le signale. Une phrase qui
 * cite un chiffre doit être générée par le chiffre.
 */
const deuxfaits = (() => {
  const adr = p!.extraction;
  const petit = adr["small"]["address"].accuracy, grand = adr["large"]["address"].accuracy;
  const doc = FIELDS.includes("document" as never) ? "document" : FIELDS[0]!;
  const parRegle = adr["rules"][doc].accuracy;
  const modeles = mesures.filter((e) => e !== "rules");
  const battus = modeles.filter((e) => adr[e][doc].accuracy < parRegle);
  return `On the address, **the ${grand < petit ? "large model is worse than the small one" : "small model trails the large one"}** `
    + `— ${pc(grand)} against ${pc(petit)} — while costing several times as much. `
    + `And on the identity number, **the free regex beats ${battus.length} of the ${modeles.length} model tiers**: `
    + `${pc(parRegle)} against ${battus.map((e) => pc(adr[e][doc].accuracy)).join(", ")}, for nothing.`
    ;
})();

/*
 * Ce que l'outil a eu faux.
 *
 * Généré depuis un fichier plutôt qu'écrit dans la page, pour la même raison que tout le
 * reste : une liste tapée à la main cesse d'être tenue à jour le jour où elle devient
 * gênante, et c'est précisément le jour où elle compte.
 */
const retractations = (() => {
  const f = new URL("../retractations.json", import.meta.url).pathname;
  if (!existsSync(f)) return "";
  const d = JSON.parse(readFileSync(f, "utf8")) as {
    entries: { date: string; claimed: string; actually: string; caughtBy: string; cost: string; heldBy: string | null }[];
  };
  const tenus = d.entries.filter((e) => e.heldBy).length;
  return table(["When", "What was claimed", "What was true", "What caught it"],
    d.entries.map((e) => [e.date, e.claimed, e.actually, e.caughtBy]))
    + `\n\n${tenus} of these ${d.entries.length} are now held by a named test, so the same mistake `
    + `fails the build rather than reaching a reader.`;
})();

/*
 * La mesure sur données publiques.
 *
 * C'est la seule figure de cette page qui ne dépende pas d'un corpus écrit par moi, donc la
 * seule qui réponde vraiment à l'objection. Elle est générée depuis le relevé versionné, pas
 * recopiée d'un terminal.
 */
const publicJeu = (() => {
  const f = new URL("../benchmarks/banking77.json", import.meta.url).pathname;
  if (!existsSync(f)) return "Not run yet — `npm run benchmark`.";
  const d = JSON.parse(readFileSync(f, "utf8")) as {
    jeu: string; cas: number; etiquettes: number;
    source: { licence: string; citation: string; empreinte: string };
    references: { majoritaire: { nom: string; taux: number }; uniforme: number };
    paliers: Record<string, { bons: number; sur: number; ms: number }>;
  };
  const rangs = Object.entries(d.paliers)
    .map(([k, v]) => ({ k, r: rate(v.bons, v.sur), ms: v.ms }))
    .sort((a, b) => b.r.rate - a.r.rate);
  const lignes = [
    [`*always "${d.references.majoritaire.nom}"*`, pc(d.references.majoritaire.taux), "—", "*trivial baseline*"],
    ["*uniform guess*", pc(d.references.uniforme), "—", "*trivial baseline*"],
    ...rangs.map((x) => [`\`${x.k}\``, pc(x.r.rate),
      `[${(100 * x.r.low).toFixed(0)}–${(100 * x.r.high).toFixed(0)}]`, `${x.ms.toFixed(0)} ms`]),
  ];
  const tete = rangs[0]!;
  const rapide = rangs.reduce((a, b) => (b.ms < a.ms ? b : a));
  const verdict = (tete.k !== rapide.k && !distinguishable(tete.r, rapide.r))
    ? `\n\n**${tete.k} and ${rapide.k} are indistinguishable on ${d.cas} real cases**, and `
      + `${tete.k} is ${(tete.ms / Math.max(rapide.ms, 0.01)).toFixed(0)}× slower. Not "there is no `
      + `difference" — ${((tete.r.rate - rapide.r.rate) * 100).toFixed(1)} points, and this many `
      + `cases cannot establish them.`
    : "";
  return `${d.cas} cases, ${d.etiquettes} labels. ${d.source.licence}, checksum \`${d.source.empreinte}\`.\n\n`
    + table(["Tier", "Accuracy", "95 % interval", "Median latency"], lignes)
    + verdict + `\n\n*${d.source.citation}*`;
})();

/*
 * Quinze commandes, et aucun ordre.
 *
 * Elles se sont accumulées une par une, chacune évidente le jour où elle est née. Le bloc qui
 * les présentait en listait six, écrites à la main, et annonçait un nombre de tests devenu
 * faux. Un lecteur arrivait donc devant un tiers de l'outil, mal compté, sans savoir laquelle
 * lancer d'abord ni laquelle demande Ollama.
 *
 * La classification vit ici et la source reste `package.json` : une commande ajoutée sans être
 * classée fait apparaître un avertissement dans la page plutôt que de se perdre.
 */
const commandes = (() => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url).pathname, "utf8"));
  const ordre: [string, string][] = [
    ["test", "types, figures and the suite — start here, it needs nothing downloaded"],
    ["measure", "measure the encoder tiers and freeze the profile (1.26 GB on the first run)"],
    ["optimise", "the routing, and what the next improvement would cost"],
    ["failures", "every case it gets wrong, with its input and its output"],
    ["sensitivity", "which assumptions decide the answer, and which do not"],
    ["prompt", "what rewording the prompt moves, against what changing tier moves"],
    ["regler", "pick each generative tier's formulation on the dev split, never on held-out"],
    ["apparier", "does the tier ranking depend on the prompt? McNemar on the same cases"],
    ["departager", "is each tuned formulation separable from its runner-up? refutes, never confirms"],
    ["tentatives", "query stored per-attempt outcomes — paired tests and clean rates, no GPU"],
    ["dur", "measure the hard corpus: broken documents, non-Latin scripts, ambiguous readings"],
    ["clone-neuf", "clone from HEAD, install fresh, run the suite — the buyer's first action"],
    ["contrainte", "what the output constraint buys, at a token cap shown not to bind"],
    ["mur", "how far the exhaustive solver goes, in fields and tiers, measured"],
    ["signal", "which key-free signals predict a wrong value, against a random control"],
    ["escalade", "does a guided cascade beat a fixed tier at the same budget?"],
    ["abstention", "silence instead of a doubtful value: wrong ones removed per correct one lost"],
    ["figures", "regenerate every table on this page from the frozen profile"],
    ["landing", "regenerate landing.json — the figures a published page reads, with their provenance"],
    ["dossier", "the validation file a reviewer signs"],
    ["start", "the screen, on localhost:4670"],
    ["measure:yours", "your own cases, from a CSV — nothing leaves your machine"],
    ["benchmark", "the same measurement on a public labelled dataset"],
    ["intake", "turn a filled-in questionnaire into the assumptions a run uses"],
    ["egress", "watch the network while a measurement runs, and record what it sees"],
    ["fuite", "what the prompt owes to the half it was tuned against (needs Ollama)"],
    ["pages", "build docs/ and verify the published screen — required before publishing: docs/ carries a compiled copy of the code and goes stale silently"],
    ["captures", "re-record the images on this page"],
  ];
  const classees = new Set(ordre.map(([n]) => n));
  const oubliees = Object.keys(pkg.scripts).filter((n) => !classees.has(n) && n !== "typage");
  const lignes = ordre.filter(([n]) => n in pkg.scripts).map(([n, quoi]) => [`\`npm run ${n}\``, quoi]);
  const manquantes = ordre.filter(([n]) => !(n in pkg.scripts)).map(([n]) => n);
  let note = "";
  if (oubliees.length) {
    note += `\n\n⚠ ${oubliees.length} command(s) exist in package.json and are not classified above: `
      + oubliees.map((n) => `\`${n}\``).join(", ") + ".";
  }
  if (manquantes.length) {
    note += `\n\n⚠ ${manquantes.length} command(s) are described above and no longer exist: `
      + manquantes.map((n) => `\`${n}\``).join(", ") + ".";
  }
  return table(["Command", "What it does, in the order that makes sense"], lignes) + note;
})();

/* Where every number on this page came from. Generated, and guarded by a test. */
const provenance = markdown(INVENTORY, table);

/*
 * Ce que coûte le pas suivant, calculé et non recopié.
 *
 * Cette phrase disait « 327× » en toutes lettres, tapé à la main, dans un bloc par ailleurs
 * généré. C'est le motif exact que ce dépôt existe pour interdire : un chiffre juste le jour
 * où il a été écrit, faux le jour où l'on remesure, et placé dans la phrase que le lecteur
 * est le plus susceptible de citer.
 */
function suivant(): string {
  const f = budgetShadowPrice(p!, h);
  if (!f || !f.step) return "No available budget buys a better routing.";
  return `The next real gain costs ${(f.step.budgetNeeded / f.currentCost).toFixed(0)}× current `
    + `spend and buys one field.`;
}

/* The finding, in the first screenful. Generated: a headline typed by hand is the figure
 * most likely to go stale and the one a reader is most likely to quote back. */
const finding = (() => {
  const s2 = optimiseExtraction(p, ASSUMPTIONS);
  if (!s2) return "**The finding.** Run `npm run measure` first.";
  const free = FIELDS.filter((f) => s2.routing[f] === "rules").length;
  /*
   * Les tailles d'échantillon peuvent différer d'un palier à l'autre, et ça doit se dire.
   *
   * Les encodeurs se remesurent en minutes, les paliers génératifs en heures : un profil
   * réaliste mélange donc les tailles. Les tableaux portent chacun leur `n`, mais la phrase
   * de tête additionne des mesures de précisions différentes — et c'est elle que le lecteur
   * retient et cite.
   */
  const tailles = [...new Set(paliersMesures(p!).filter((e) => e !== "human")
    .map((e) => p!.extraction[e][FIELDS[0]!].items))].sort((a, b) => b - a);
  const melange = tailles.length > 1
    ? ` Measured on ${tailles.join(" and ")} held-out cases depending on the tier — the tables carry each figure's own \`n\`.`
    : "";
  return `**The finding.** Routing every field to the same tier is the default and it is ` +
    `wrong. Measured per field, ${free} of the ${FIELDS.length} fields are carried by regexes ` +
    `at **zero cost and up to 100 % accuracy**, and the money is worth spending on exactly the ` +
    `ones that need it. Total: **${(s2.accuracy * 100).toFixed(1)} % for $${Math.round(s2.cost)}** ` +
    `of a $${ASSUMPTIONS.budget.toLocaleString("en-GB")} budget — the budget does not bind. ` +
    suivant() + melange;
})();

/**
 * Le nombre de tests, compté plutôt qu'écrit.
 *
 * Le README portait « 54 tests », tapé à la main et enveloppé dans une marque de portfolio
 * — `<!--p:portfolio.parDepot.cascade-->` — qui ne pointait plus sur rien depuis que `cascade`
 * a quitté la liste des dépôts d'outils. Deux défauts superposés : un compteur d'un autre dépôt
 * dans le README du produit, et un chiffre figé à 54 quand la suite en compte le double.
 *
 * Le compte se lit maintenant dans les fichiers de test, comme tout le reste de cette page.
 */
const tests = (() => {
  const dossier = new URL(".", import.meta.url).pathname;
  const fichiers = readdirSync(dossier).filter((n: string) => n.endsWith(".test.ts"));
  const n = fichiers.reduce((a: number, f: string) =>
    a + (readFileSync(join(dossier, f), "utf8").match(/^test\(/gm) ?? []).length, 0);
  if (n < 20) throw new Error(`${n} tests comptés dans ${fichiers.length} fichier(s) : la lecture a échoué.`);
  return `**${n} tests** across ${fichiers.length} files, counted from the sources rather than typed here.`;
})();

emit(new URL("../README.md", import.meta.url).pathname,
  { finding, extraction, classification, routing, shadow, gallery, baselines, provenance,
    echelles, latence, egalites, fuite, deuxfaits, retractations, public: publicJeu, commandes,
    tests });
