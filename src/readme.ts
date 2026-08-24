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
import { optimiseExtraction, optimiseClassification, budgetShadowPrice, latenceRepresentative, paliersMesures, decompositionDe } from "./optimise.ts";
import "./figer.ts";  /* pose la table figée : voir figer.ts */
import { ASSUMPTIONS, pricePerThousandExtractions, accuracy } from "./assumptions.ts";
import { collect, shape } from "./failures.ts";
import { FIELDS, type Field } from "./corpus.ts";
import { TIERS } from "./tiers.ts";
import { run as emit, table } from "./figures.ts";
import { citation, provenance as sourceDuTexte } from "./regulations.ts";
import { rate, writeRate, distinguishable, precision, ENOUGH } from "./interval.ts";
import { GENERATIFS, type TierName } from "./paliers.ts";
import { majorityClass, uniformGuess, verdict } from "./baselines.ts";
import { generateAlerts } from "./corpus.ts";
import { TYPOLOGIES } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const p = readProfiles();
if (!p) { console.error("No profile measured — start with: npm run measure"); process.exit(1); }
const h = ASSUMPTIONS;
/* Les paliers réellement dans le profil, jamais la liste complète : l'échelle générative
   est optionnelle, et un dépôt cloné puis mesuré n'en contient que quatre. */
const mesures = paliersMesures(p).filter((t) => t !== "human");
const pc = (x: number) => (x * 100).toFixed(1) + " %";
const euro = (n: number) => "$" + Math.round(n).toLocaleString("en-GB");

/* TRENTE TAUX PUBLIÉS, ET PAS UN SEUL n. C'était le plus gros trou de la page :
   le bloc d'ouverture affirme que « les tableaux portent chacun leur n », et
   c'était faux ici — le tableau le plus lu du document. Un taux sans son
   effectif n'est pas une mesure, c'est une anecdote, et c'est la première chose
   qu'un lecteur sceptique attaque.
   Une colonne suffit et ne coûte rien en largeur : l'effectif est constant sur
   les cinq champs d'un même palier — 1 000 pour les paliers machine, 120 pour
   l'échelle générative. Cet écart d'un facteur huit est lui-même l'information
   qui manquait : il dit pourquoi les taux génératifs bougent plus, et il se
   voyait nulle part. */
/*
 * TRENTE TAUX AVEC LEUR `n` ET SANS LEUR INTERVALLE.
 *
 * Le tableau le plus lu de la page portait la taille d'échantillon — ce qui est déjà mieux que
 * la plupart — et laissait au lecteur le soin d'en déduire la précision. Personne ne le fait.
 * Résultat : `gen-4b` à 79,2 % et `rules` à 79,7 % se lisent comme un écart, alors qu'à ces
 * effectifs-là aucun des deux ne sait où il est à sept points près.
 *
 * Mettre l'intervalle dans chaque cellule rendrait six colonnes illisibles. On publie donc la
 * PIRE DEMI-LARGEUR DU PALIER — celle du champ dont l'intervalle est le plus large — parce que
 * c'est le seul résumé qui ne flatte jamais : si le lecteur s'y fie, il se trompe toujours du
 * côté prudent.
 *
 * Mesuré : ±2,5 à ±3,1 points pour les encodeurs à mille cas, ±6,8 à ±8,1 pour l'échelle
 * générative à cent vingt. C'est l'information qui manquait, et elle change la lecture de la
 * moitié du tableau.
 */
/*
 * POURQUOI CES CINQ CHAMPS, ET PAS D'AUTRES.
 *
 * Le tableau ci-dessus publie une exactitude par champ. Il ne disait nulle part POURQUOI ces
 * champs-la sont mesures — un lecteur en conformite ne demande pas d'abord un taux, il demande
 * ce qui l'oblige. La reponse etait deja dans le depot, dans `regulations.ts`, retrouvee a la
 * source et jamais affichee : le module etait importe par personne ici.
 *
 * Quatre des cinq champs sont nommes par le texte. LE PAYS NE L'EST PAS, et il est ecrit comme
 * tel plutot que rattache de force : il se deduit de l'adresse ou du document, mais aucune
 * ligne du CFR ne l'exige comme donnee propre. Un rattachement invente vaudrait moins que rien
 * dans un document dont l'argument est qu'une decision automatique doit etre defendable.
 */
/*
 * CE QUE CHAQUE PALIER COUTE SELON L'ENDROIT OU IL TOURNE.
 *
 * Ce depot mesure six paliers, et il les fait TOUS tourner sur la machine — les encodeurs
 * dans le processus, l'echelle generative sur Ollama en boucle locale. Mais il n'en tarife
 * que trois au temps machine : `small` et `large` portent un prix a l'appel, parce que
 * l'hypothese declaree est que vous les appellerez chez un fournisseur en production. C'est
 * defendable, et ce n'etait ecrit nulle part ou un lecteur le verrait.
 *
 * L'ecart est le fait le plus vendable de ce depot et il n'etait pas publie : un facteur cent
 * sur `large`. Et il renverse la lecture du tableau — l'echelle generative locale coute moins
 * cher que l'encodeur heberge ET se trompe moins souvent. Un acheteur qui se demande s'il a
 * besoin d'une API payante a sa reponse ici, mesuree, sur ses propres axes.
 *
 * Les deux colonnes sortent du MEME relevé : aucune n'est estimee. La difference n'est pas
 * une mesure de plus, c'est le meme temps facture selon deux regimes.
 */
const ouCaTourne = (() => {
  const H = ASSUMPTIONS;
  const surLaMachine = (t: TierName) => FIELDS.reduce((s, f) => {
    const lat = p!.extraction[t]?.[f]?.latency;
    return lat === undefined || t === "rules" ? s : s + (lat / 3_600_000) * H.machineHourlyCost * 1000;
  }, 0);
  const facture = (t: TierName) => FIELDS.reduce((s, f) => {
    const lat = p!.extraction[t]?.[f]?.latency;
    return lat === undefined ? s : s + pricePerThousandExtractions(t, H, lat);
  }, 0);

  const lignes = mesures.map((t) => {
    const a = facture(t), b = surLaMachine(t);
    const rapport = b > 0 && a / b > 1.05 ? `${(a / b).toFixed(0)}x` : "—";
    const m = FIELDS.map((f) => p!.extraction[t][f].accuracy);
    const moy = (m.reduce((x, y) => x + y, 0) / m.length) * 100;
    return [`\`${t}\``, `$${a.toFixed(2)}`, `$${b.toFixed(2)}`, rapport, `${moy.toFixed(1)} %`];
  });

  /* Le renversement se calcule plutot que de s'affirmer : si un jour il cesse d'etre vrai,
     la phrase disparait au lieu de rester juste sur le papier. */
  const local = mesures.filter((t) => (GENERATIFS as string[]).includes(t))
    .map((t) => ({ t, cout: surLaMachine(t), acc: FIELDS.reduce((s, f) => s + p!.extraction[t][f].accuracy, 0) / FIELDS.length }))
    .sort((x, y) => y.acc - x.acc)[0];
  const heberge = { t: "large" as TierName, cout: facture("large" as TierName),
    acc: FIELDS.reduce((s, f) => s + p!.extraction["large" as TierName][f].accuracy, 0) / FIELDS.length };
  const renverse = local && local.cout < heberge.cout && local.acc > heberge.acc;

  return `**What each tier costs depends on where it runs.** Every tier here was measured ON `
    + `THIS MACHINE. Two of them — \`small\` and \`large\` — are nonetheless priced per call, `
    + `because the declared assumption is that you would call them at a provider in production. `
    + `The other column prices the same measured time as machine time.\n\n`
    + table(["Tier", "At a provider", "On your machine", "Ratio", "Accuracy"], lignes)
    + `\n\n*Per thousand documents of five fields each, from the same frozen profile. Neither `
    + `column is an estimate: it is the same measured latency billed under two regimes.*`
    + (renverse
        ? `\n\n**This reverses the table.** \`${local.t}\` running locally costs `
          + `$${local.cout.toFixed(2)} at ${(local.acc * 100).toFixed(1)} % — cheaper AND more `
          + `accurate than calling \`large\` at a provider for $${heberge.cout.toFixed(2)} at `
          + `${(heberge.acc * 100).toFixed(1)} %. If you are asking whether you need a paid API, `
          + `that is the measured answer on this corpus.`
        : "");
})();

const obligation = (() => {
  const EXIGES: Partial<Record<Field, string>> = {
    name: "Name",
    birth: "Date of birth, for an individual",
    document: "Identification number",
    address: "Address",
  };
  const nommes = FIELDS.filter((f) => f in EXIGES);
  const absents = FIELDS.filter((f) => !(f in EXIGES));
  return `**Why these fields.** ${citation("customerIdentification")}\n\n`
    + table(["Field", "What the rule names", "Measured here"],
        FIELDS.map((f) => [`\`${f}\``, EXIGES[f] ?? "—", f in EXIGES ? "yes" : "yes, but not required by name"]))
    + `\n\n${nommes.length} of the ${FIELDS.length} fields are named by the text; `
    + `${absents.map((f) => `\`${f}\``).join(", ")} ${absents.length > 1 ? "are" : "is"} not — `
    + `it follows from the address or the document, and no line of the CFR requires it as a `
    + `datum of its own. It is measured anyway, and said so rather than attached by force.\n\n`
    + `*${sourceDuTexte("customerIdentification")}*`;
})();

const extraction = table(
  ["Tier", ...FIELDS, "Latency", "n", "±"],
  mesures.map((t) => {
    const n = FIELDS.map((f) => p.extraction[t][f].items);
    const memeN = n.every((x) => x === n[0]);
    const demies = FIELDS.map((f) => {
      const q = p.extraction[t][f];
      return precision(Math.round(q.accuracy * q.items), q.items);
    });
    return [
      `\`${t}\``,
      ...FIELDS.map((f) => pc(p.extraction[t][f].accuracy)),
      (FIELDS.reduce((s, f) => s + p.extraction[t][f].latency, 0) / FIELDS.length).toFixed(1) + " ms",
      /* si un jour les champs cessent d'être mesurés sur le même échantillon,
         la colonne le DIT au lieu d'afficher le premier et de taire les autres */
      memeN ? String(n[0]) : n.join(" / "),
      `±${Math.max(...demies).toFixed(1)}`,
    ];
  }),
) + `\n\n**The \`±\` column is the widest half-interval on that row**, at 95 %, taken over the `
  + `five fields — so it never flatters. Two rates on the same row that differ by less than `
  + `twice it are not separated by this sample, and the generative tiers carry roughly `
  + `${Math.max(...FIELDS.map((f) => precision(Math.round(p!.extraction["gen-4b"]![f]!.accuracy * p!.extraction["gen-4b"]![f]!.items), p!.extraction["gen-4b"]![f]!.items))).toFixed(0)} `
  + `points of it against ${Math.max(...FIELDS.map((f) => precision(Math.round(p!.extraction["large"]![f]!.accuracy * p!.extraction["large"]![f]!.items), p!.extraction["large"]![f]!.items))).toFixed(0)} `
  + `for the encoders, because they were measured on fewer cases.`;

const classification = table(
  ["Tier", "Accuracy", "95 % interval", "Latency", "n"],
  mesures.map((t) => {
    const prof = p.classification[t];
    const r = rate(Math.round(prof.accuracy * prof.items), prof.items);
    /* l'intervalle était là, l'effectif non : on peut vérifier la borne sans
       pouvoir vérifier ce sur quoi elle porte, ce qui la rend invérifiable. */
    return [`\`${t}\``, pc(prof.accuracy),
      `[${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}]`,
      prof.latency.toFixed(2) + " ms", String(prof.items)];
  }),
);

const best = optimiseExtraction(p, h);
const routing = best ? table(
  ["Field", "Tier chosen", "Accuracy", "Cost"],
  FIELDS.map((f) => {
    const t = best.routing[f];
    /* LA LATENCE DU CHAMP, PAS LA MOYENNE DU PALIER — et c'est la colonne qui
       ne s'additionnait pas. `latenceRepresentative` rend la moyenne des cinq
       champs ; sur un palier local le tarif est du TEMPS MACHINE, et le temps
       dépend du champ — le commentaire de `pricePerThousandDocuments` le dit
       déjà en toutes lettres : « l'adresse ne coûte pas la date de naissance ».
       Chiffré : `address` sur `gen-4b` demande 919,74 ms et non les 340 ms de
       la moyenne du palier, donc 30,66 $ et non 26,27 $.

       Conséquence visible, et c'est la première chose qu'un lecteur sceptique
       vérifie : la colonne affichait 160 + 0 + 0 + 0 + 26 = 186 sous un total
       de 191. Les lignes et le total venaient de DEUX CALCULS différents — les
       lignes recomputées ici, le total pris de l'optimiseur — donc deux objets
       pour une seule grandeur. Le total avait raison : avec la latence propre,
       la somme des lignes tombe sur 190,6581, à l'unité près de `best.cost`. */
    const q = p.extraction[t][f];
    /* L'INTERVALLE S'ARRÊTE OÙ LA MESURE S'ARRÊTE. `accuracy()` rend le chiffre
       mesuré pour les paliers machine et l'HYPOTHÈSE pour l'humain — la seule
       valeur affichée du projet qui ne soit pas une mesure, son propre
       commentaire le dit. Encadrer une hypothèse par un intervalle de Wilson
       lui donnerait l'apparence d'un relevé : ce serait la faute exacte que
       cette colonne est censée réparer. */
    const cellule = t === "human"
      ? `${pc(accuracy(t, q.accuracy, h))} *(assumed)*`
      : writeRate(rate(Math.round(q.accuracy * q.items), q.items));
    return [f, `\`${t}\``, cellule,
      euro((h.volume / 1000) * pricePerThousandExtractions(t, h, q.latency))];
  }).concat([["**total**", "", `**${pc(best.accuracy)}**`, `**${euro(best.cost)}**`]]),
) + `\n\nThe total is the **mean of the five field rates**, each measured on its own sample `
  + `(${FIELDS.map((f) => p!.extraction[best.routing[f]][f].items).join(", ")} cases). `
  + `It is not a proportion, so it carries no interval: a Wilson bound on a mean of `
  + `proportions drawn from different samples would be a fabricated statistic, and this `
  + `report would rather publish a number without a bound than a bound without a meaning.`
: "";

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
  const parPaire = f.filter((x) => {
    const k = `${x.tier}:${x.field}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  /* Le nombre de paires qui ONT un échec, pour que la phrase publiée puisse dire ce qu'elle
     écarte au lieu de promettre « chacune ». */
  const pairesAvecEchec = parPaire.length;
  const six = parPaire.slice(0, 5);

  const counts = table(["Failures", "Tier · field · what kind of wrong"],
    shape(f).slice(0, 6).map(([k, n]) => [n, k]));

  /*
   * LA PHRASE QUI COMMENTE LA GALERIE PROMETTAIT L'EXHAUSTIVITÉ, EN PROSE LIBRE.
   *
   * Elle disait : « The gallery takes the first failure of EACH tier-and-field pair, in order,
   * and shows what came back. » Le code en prend cinq sur les neuf paires qui ont un échec, et
   * le bloc engendré juste au-dessus le disait honnêtement — « 5 of them ». LE DOCUMENT SE
   * CONTREDISAIT À DEUX LIGNES D'INTERVALLE, la figure étant juste et la prose fausse.
   *
   * Corriger la phrase ne suffirait pas : elle vit hors bloc, donc elle rouillerait de nouveau
   * au premier palier ajouté. Elle est donc ENGENDRÉE ici, avec ses deux nombres, et elle ne
   * peut plus s'écarter de ce que la boucle fait juste au-dessus.
   */
  const commentaire = `Nothing here is curated for flattery. The gallery takes the FIRST failure `
    + `of a tier-and-field pair, in order, and shows what came back — `
    + `${six.length} of the ${pairesAvecEchec} pairs that have one, not a chosen sample.`;

  const examples = six.map((x) =>
    "```\n" + `${x.tier} · ${x.field} · ${x.mode}   [${x.recordId}]\n` +
    `  text      ${x.text}\n` +
    `  expected  ${JSON.stringify(x.expected)}\n` +
    `  got       ${JSON.stringify(x.got)}\n` + "```").join("\n\n");

  /* CE QUE LA GALERIE COUVRE, ET CE QU'ELLE NE COUVRE PAS. Le tableau des garanties
     annonçait « every failure published in full » ; mesuré, c'est faux trois fois — trois
     paliers sur les six mesurés (l'échelle générative demande `--llm`), les six premiers
     genres seulement, et cinq exemples. Aucun de ces trois écrêtages n'était dit.
     Un relevé qui résulte d'une sélection porte le compte de ce qu'il a écarté, ou il ne
     se publie pas : c'est la même règle que le seuil qui refuse un taux sous vingt cas.
     Les nombres se calculent — ils ne peuvent donc pas vieillir quand un palier s'ajoute. */
  const paliersVus = [...new Set(f.map((x) => x.tier))];
  const paliersMesuresSansHumain = paliersMesures(p!).filter((t) => t !== "human");
  const absents = paliersMesuresSansHumain.filter((t) => !paliersVus.includes(t));
  const genres = shape(f).length;
  return `${f.length} failures across ${paliersVus.length} of the ${paliersMesuresSansHumain.length} measured tiers`
    + `, grouped by what actually went wrong.\n\n${counts}\n\n`
    + `Shown above: the ${Math.min(6, genres)} most common of ${genres} kinds. Below: `
    + `${six.length} of the ${pairesAvecEchec} tier-and-field pairs that have a failure, `
    + `with their input and output. `
    + (absents.length
        ? `Not here at all — ${absents.map((t) => `\`${t}\``).join(", ")}: the generative ladder is `
          + `measured only with \`npm run measure -- --llm\`. `
        : "")
    + `\`npm run failures\` prints every case of the tiers it runs.\n\n${commentaire}\n\n${examples}`;
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

const nEtiquettes = p.classification[mesures[0]!]!.items;
const baselines = table(
  ["", "Accuracy", "Verdict", "n"],
  [
    /* LES DEUX RÉFÉRENCES SE CALCULENT SUR LE MÊME JEU D'ÉTIQUETTES que les
       paliers de la colonne du dessous, donc le même effectif. `Baseline` ne le
       porte pas — j'ai d'abord écrit `majority.n`, et le compilateur a refusé :
       inventer un champ pour publier un chiffre aurait été la faute même que
       cette colonne répare. On le prend là où il est mesuré. */
    [`${majority.name}`, pc(majority.accuracy), `*${majority.what}*`, String(nEtiquettes)],
    [`${uniform.name}`, pc(uniform.accuracy), `*${uniform.what}*`, String(nEtiquettes)],
    ...mesures.map((t) => [
      `\`${t}\``, pc(p.classification[t].accuracy),
      verdict(p.classification[t].accuracy, majority, p.classification[t].items),
      String(p.classification[t].items),
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
  /*
   * « BEST » ÉTAIT UN ARGMAX, ET UN ARGMAX N'EST PAS UN RÉSULTAT.
   *
   * La colonne nommait le taux le plus haut et le tableau le mettait en gras. Sur QUATRE
   * CHAMPS SUR CINQ, ce vainqueur n'est pas séparable de son second : `large` 96,6 [95–98]
   * contre `gen-8b` 91,7 [85–95], `rules` 79,7 [77–82] contre `gen-8b` 83,3 [76–89] — où le
   * « meilleur » a même le taux le plus bas des deux bornes basses. Le gras affirmait une
   * supériorité que l'échantillon ne porte pas, dans le tableau le plus lu de la page, sur un
   * produit dont c'est exactement le service vendu.
   *
   * Le remède n'est pas de retirer la colonne : le lecteur a besoin de savoir où regarder.
   * C'est de ne couronner que ce qui se sépare, et de NOMMER l'égalité quand il y en a une —
   * « ces deux-là, cet échantillon ne les distingue pas » est une information, pas une
   * absence d'information.
   */
  let indistincts = 0;
  const lignes = FIELDS.map((c) => {
    const classe = mesures
      .map((t) => ({ t, q: p!.extraction[t][c] }))
      .sort((a, b) => b.q.accuracy - a.q.accuracy);
    const [premier, second] = classe;
    const r1 = rate(Math.round(premier!.q.accuracy * premier!.q.items), premier!.q.items);
    const r2 = second ? rate(Math.round(second.q.accuracy * second.q.items), second.q.items) : r1;
    const separe = !!second && distinguishable(r1, r2);
    if (!separe) indistincts++;
    const meilleur = premier!.t;
    return [`\`${c}\``, ...mesures.map((e) =>
      (separe && e === meilleur ? "**" : "") + pc(p!.extraction[e][c].accuracy) + (separe && e === meilleur ? "**" : "")),
      separe ? `\`${meilleur}\`` : `\`${meilleur}\` = \`${second!.t}\``];
  });
  /* L'EFFECTIF VARIE PAR COLONNE, PAS PAR LIGNE — donc pas de colonne « n »
     possible ici, et c'est pour ça que ce tableau était le dernier sans. Une
     ligne de pied le porte : trente taux publiés sans savoir sur combien de cas
     chacun repose, et l'écart va de 1 000 à 120. */
  const effectifs = mesures.map((e) => `\`${e}\` ${p!.extraction[e][FIELDS[0]!].items}`).join(" · ");
  const note = indistincts
    ? `\n\n**On ${indistincts} of ${FIELDS.length} fields the leading tier is not separable from `
      + `the runner-up** at this sample size — written \`a\` = \`b\`, and left unbolded. Picking `
      + `the higher number there would be picking noise; the two are interchangeable on `
      + `accuracy and the choice belongs to cost or latency.`
    : "";
  return table(["Field", ...mesures.map((e) => `\`${e}\``), "Best"], lignes)
    + `\n\nCases behind each column — ${effectifs}.` + note;
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
  /* MÊME AVERTISSEMENT QUE LE TOTAL DU ROUTAGE, et pour la même raison : la
     colonne « Accuracy » de ce tableau est la moyenne des cinq taux de champ du
     routage retenu, chacun mesuré sur son propre échantillon. Ce n'est pas une
     proportion, donc pas d'intervalle. Le dire une fois par tableau plutôt
     qu'une fois pour toute la page : un lecteur qui arrive par un lien d'ancre
     ne lit pas le paragraphe d'à côté. */
  const noteMoyenne = `\n\nEach accuracy is the **mean of the five field rates** of that routing, `
    + `measured on separate samples — a mean of proportions, so no interval is quoted.`;
  const sans = optimiseExtraction(p!, { ...h, latencyBudgetMs: Number.MAX_SAFE_INTEGER });
  const avec = optimiseExtraction(p!, h);
  const note = (sans && avec && sans.cost < avec.cost)
    ? `\n\n**What the promise costs.** Lift the ceiling entirely and the cheapest routing that is `
      + `statistically indistinguishable in accuracy costs ${euro(sans.cost)} instead of `
      + `${euro(avec.cost)} — it just takes ${sans.latencyPerItem.toFixed(0)} ms per document. `
      /* L'ÉCART SE PREND SUR LES CHIFFRES AFFICHÉS, pas sur les valeurs pleines.
         `euro(avec.cost - sans.cost)` arrondissait la DIFFÉRENCE (123,4 → 123)
         pendant que la phrase affiche les deux opérandes arrondis, 191 et 67 :
         le lecteur qui soustrait obtient 124 et voit une page qui se contredit.
         Aucun des trois chiffres n'était faux, et c'est bien le problème — un
         document dont l'argument est « vérifiez notre arithmétique » doit
         d'abord tomber juste quand on la vérifie. On arrondit donc les deux
         opérandes puis on soustrait : l'écart reste à moins d'un dollar de la
         valeur pleine, ce qui est exactement ce que veut dire arrondir, et la
         page est cohérente pour qui la contrôle au crayon. */
      + `**Your latency promise is worth ${euro(Math.round(avec.cost) - Math.round(sans.cost))}**, and the money budget `
      + `never binds at all. That is the shadow price nobody prices.`
    : "";
  return table(["Ceiling per document", "Accuracy", "Cost", "Actual", "Routing"], lignes) + noteMoyenne + note;
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
  let egalitesExactes = 0;
  for (const c of FIELDS) {
    for (let i = 0; i < mesures.length; i++) {
      for (let j = i + 1; j < mesures.length; j++) {
        const a = mesures[i]!, b = mesures[j]!;
        const qa = p!.extraction[a][c], qb = p!.extraction[b][c];
        const ra = rate(Math.round(qa.accuracy * qa.items), qa.items);
        const rb = rate(Math.round(qb.accuracy * qb.items), qb.items);
        if (qa.accuracy === qb.accuracy) { egalitesExactes++; continue; }  // n'étonne personne, mais se compte
        if (!distinguishable(ra, rb)) {
          lignes.push([`\`${c}\``, `\`${a}\``, writeRate(ra), `\`${b}\``, writeRate(rb)]);
        }
      }
    }
  }
  if (!lignes.length) return "On this sample every tier is distinguishable from every other on every field.";
  /*
   * CE TABLEAU EST UNE SÉLECTION, ET IL LE DISAIT PAS.
   *
   * `slice(0, 8)` publiait huit lignes sur dix-huit et se présentait comme « les paires que
   * cet échantillon ne sait pas trancher » — c'est-à-dire comme la liste, alors que c'en est
   * un extrait. Dix paires disparaissaient sans un mot, et vingt et une égalités exactes
   * étaient écartées plus haut par un `continue` dont rien ne rendait compte.
   *
   * C'est la cinquième fois que cette règle se paie dans ce dépôt : toute figure issue d'une
   * sélection porte le compte de ce qu'elle exclut, ou elle ne se publie pas. Un lecteur qui
   * compte huit paires et conclut « il y en a huit » a été trompé par la mise en page.
   */
  const MONTREES = 8;
  const cachees = lignes.length - MONTREES;
  const rendu = table(["Field", "Tier", "Rate", "Tier", "Rate"], lignes.slice(0, MONTREES));
  if (cachees <= 0 && !egalitesExactes) return rendu;
  const parts = [
    cachees > 0 ? `${cachees} further pair${cachees > 1 ? "s" : ""} this sample cannot separate` : "",
    egalitesExactes ? `${egalitesExactes} exact tie${egalitesExactes > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return `${rendu}\n\n*Showing ${Math.min(MONTREES, lignes.length)} of ${lignes.length + egalitesExactes} `
    + `indistinguishable pairs — ${parts.join(" and ")} not listed. A table that shows a selection `
    + `carries the count of what it leaves out.*`;
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
  const f = fileURLToPath(new URL("../data/fuite.json", import.meta.url));
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
  /* CETTE PHRASE A DÉJÀ ÉTÉ RÉTRACTÉE UNE FOIS, et le journal des rétractations
     le dit à la date du 19/08 : « sur un seul champ — et sur 120 cas l'écart
     était de 4,2 points avec des intervalles qui se recouvraient presque
     entièrement ». Elle a été corrigée, puis republiée SANS ses effectifs et
     SANS son verdict de distinguabilité — donc réexposée à la faute exacte qui
     l'avait fait tomber. Un chiffre qu'on a déjà payé mérite plus qu'une
     correction : il mérite la garde qui empêche la rechute.
     On publie donc les taux avec leur intervalle et leur n, et on dit
     explicitement si l'échantillon départage — « moins exact » et « on ne peut
     pas les départager » sont deux affirmations différentes, et seule la
     seconde est parfois vraie. */
  const qGrand = adr["large"]["address"], qPetit = adr["small"]["address"];
  const rGrand = rate(Math.round(qGrand.accuracy * qGrand.items), qGrand.items);
  const rPetit = rate(Math.round(qPetit.accuracy * qPetit.items), qPetit.items);
  const tranche = distinguishable(rGrand, rPetit);
  const qRegle = adr["rules"][doc];
  const rRegle = rate(Math.round(qRegle.accuracy * qRegle.items), qRegle.items);
  return `On the address, **the ${grand < petit ? "large model is worse than the small one" : "small model trails the large one"}** `
    + `— ${writeRate(rGrand)} against ${writeRate(rPetit)} — while costing several times as much. `
    + (tranche
        ? `The sample separates them. `
        : `**The sample does not separate them**: the intervals overlap, so this is a gap we can see and cannot establish. `)
    + `And on the identity number, **the free regex beats ${battus.length} of the ${modeles.length} model tiers**: `
    + `${writeRate(rRegle)} against ${battus.map((e) => {
        const q = adr[e][doc];
        return writeRate(rate(Math.round(q.accuracy * q.items), q.items));
      }).join(", ")}, for nothing.`
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
  const f = fileURLToPath(new URL("../retractations.json", import.meta.url));
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
  const f = fileURLToPath(new URL("../benchmarks/banking77.json", import.meta.url));
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
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const ordre: [string, string][] = [
    /* « IT NEEDS NOTHING DOWNLOADED » ÉTAIT FAUX, et c'était la première ligne du
       premier tableau — la seule phrase qui parle de coût réseau, lue avant le
       moindre chiffre d'exactitude. Mesuré : `node src/readme.ts --check` charge
       les deux modèles d'extraction (`src/readme.ts` appelle `collect()` au
       niveau module, donc en mode --check aussi), soit 722 Mo de poids .onnx.
       Sur un poste derrière un proxy qui laisse passer npm et pas huggingface,
       la commande d'accueil meurt en douze secondes.
       On ne remet pas de chiffre ici : ce dépôt s'interdit les nombres tapés à
       la main, et la taille est déjà publiée plus bas, mesurée. On dit le fait
       et on laisse le chiffre où il est vérifiable. */
    /* LA PROMESSE EST REDEVENUE VRAIE, donc on la remet — mais bornée. `collect()` sert
       désormais une galerie mise en cache et scellée sur ses entrées, y compris le texte
       des modules qui la produisent : tant que le code ne bouge pas, aucun modèle n'est
       chargé et la suite tombe de 103 s à 22 s. Quand la clé diffère, l'outil recalcule et
       le dit — et c'est là qu'il télécharge. Le libellé porte cette borne : une promesse
       sans sa condition est la même faute qu'avant, écrite dans l'autre sens. */
    ["test", "types, figures and the suite — start here; downloads nothing while the cached failure gallery matches the code"],
    ["measure", "measure the encoder tiers and freeze the profile (1.26 GB on the first run)"],
    ["sceller", "seal a profile: the fingerprint that makes a silently edited measurement fail loudly"],
    ["diff", "compare two sealed runs case by case — a rising rate can still have lost cases"],
    ["entree", "population drift on the documents alone, no labels, read against its own noise floor"],
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
    ["derivees", "refreeze the three landing figures drawn from the journals git does not carry"],
    ["dossier", "the validation file a reviewer signs"],
    ["sonde", "the generative probe, regenerated from the frozen profile — it was hand-typed and eleven of its figures had gone stale"],
    ["start", "the screen, on localhost:4670"],
    ["measure:yours", "your own cases, from a CSV — nothing leaves your machine"],
    ["benchmark", "the same measurement on a public labelled dataset"],
    ["intake", "turn a filled-in questionnaire into the assumptions a run uses"],
    ["egress", "watch the network while a measurement runs, and record what it sees"],
    ["fuite", "what the prompt owes to the half it was tuned against (needs Ollama)"],
    ["pages", "build docs/ and verify the published screen — required before publishing: docs/ carries a compiled copy of the code and goes stale silently"],
    ["captures", "re-record the images on this page"],
    ["ocr", "read the same documents as images and measure what the reading stage costs (macOS: Vision, no API)"],
    ["exposition", "what the routing costs when it is wrong, and the price ratio at which the recommendation changes"],
    ["document", "the rate per FILE — all five fields right together — against the mean per field"],
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
/* « EXHAUSTIVE OVER ALL 1,024 COMBINATIONS » ÉTAIT LE COMPTE D'AVANT.
   1 024, c'est 4^5 — quatre paliers, cinq champs — et l'échelle générative en a
   ajouté trois depuis. Le dépôt en énumère 16 807. La phrase se lit comme une
   garantie, et elle sous-estimait de seize fois l'espace réellement parcouru :
   la vérité était MEILLEURE que l'affirmation, ce qui est la forme la plus
   bête de perdre la confiance d'un lecteur qui vérifie.
   `INVENTORY` est une déclaration statique et n'a pas accès au profil ; le
   compte se calcule donc ici, là où le profil existe, et ne peut plus vieillir
   quand un palier s'ajoute. */
const nCombinaisons = Math.pow(paliersMesures(p).length, FIELDS.length);
/* L'ADJECTIF ÉTAIT FAUX, PAS LE NOMBRE — et il l'est devenu par ricochet.
   L'optimiseur énumère bien 7^5 = 16 807 : les sept paliers du relevé, humain compris.
   Mais « of the MEASURED tiers » est faux depuis qu'on a établi que personne n'a jamais
   mesuré un humain — `optimise.ts` l'écrit à l'écran à chaque passe, « human accuracy
   assumed … this is not a measurement ».
   La preuve que c'est un ricochet et non un choix : ce fichier filtre `human` hors de
   `paliersMesures()` deux lignes plus haut, et pas ici. Les auteurs connaissent la
   distinction ; une seule ligne ne l'avait pas apprise, et `--check` disait « up to date ».
   On garde 16 807 — sous-estimer l'espace de recherche serait mentir dans l'autre sens —
   et on nomme le septième. Trouvé par une relecture croisée, pas par ce dépôt. */
const nAvecHypothese = paliersMesures(p).filter((t) => t === "human").length;
/*
 * CE QUE LA PASSE A RÉELLEMENT COÛTÉ, pris dans le relevé lui-même.
 *
 * Trois phrases écrites à la main annonçaient ce coût, et deux se contredisaient
 * frontalement : « a few tens of megabytes » d'un côté, « 1.26 GB of model weights » de
 * l'autre, pour la même commande. Et la durée annoncée — « about two minutes » — n'était
 * celle d'aucune passe : les horodatages de provenance du relevé publié courent de 10:08:32
 * à 10:40:28, soit trente-deux minutes. Un facteur seize sur le premier chiffre qu'un
 * acheteur vérifie, puisqu'il le vérifie en lançant la commande.
 *
 * Aucune de ces trois phrases ne pouvait rester juste : elles étaient tapées à la main dans
 * un dépôt dont la règle est que les chiffres ne s'écrivent pas à la main. Celle-ci se
 * calcule depuis la donnée, donc elle vieillit avec elle.
 */
const coutDeReproduction = (() => {
  const dates: string[] = [];
  const ramasse = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(ramasse); return; }
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === "measuredAt" && typeof v === "string") dates.push(v);
        else ramasse(v);
      }
    }
  };
  ramasse((p as unknown as { provenance?: unknown }).provenance);
  if (dates.length < 2) return "";
  dates.sort();
  const min = (new Date(dates.at(-1)!).getTime() - new Date(dates[0]!).getTime()) / 60000;
  return `**What the published pass actually took.** The provenance stamps of the profile `
    + `shipped with this repository run from ${dates[0]!.slice(11, 19)} to `
    + `${dates.at(-1)!.slice(11, 19)} — **${min.toFixed(0)} minutes** of measurement on the `
    + `machine named in the seal, on top of the weight download. That is the figure to plan `
    + `for, not a round number: it is read from the relevé, so it moves when the relevé does.`;
})();

/*
 * L'EMBAUCHE EST UNE MARCHE, PAS UNE PENTE — et ce dépôt la facture en pente.
 *
 * `pricePerThousandExtractions` calcule un coût horaire d'analyste
 * (`analystAnnualCost / (heures × jours)`) puis facture au prorata des secondes. C'est
 * l'erreur que le dépôt voisin `alert-triage-economics` nomme dans son propre README :
 * « Headcount is a step, not a slope. You hire whole people. » On n'embauche pas trois
 * dixièmes de personne, et sous une marche, resserrer n'achète rien.
 *
 * Ce qu'on en fait ici, et pourquoi ce n'est pas une réécriture : mesuré, aux valeurs en
 * usage l'écart est de 1,06 — 0,95 personne, donc presque une marche pleine — et le routage
 * retenu n'emploie pas le palier humain, donc la réponse publiée ne change pas. Au bas du
 * balayage de `humanSeconds` l'écart monte à 3,17. C'est assez pour être dit, pas assez pour
 * refaire le modèle de coût avant d'avoir branché celui d'`economics`, qui le porte déjà.
 *
 * Le dire coûte une phrase et rend l'hypothèse attaquable ; se taire laisse un ingénieur la
 * trouver seul, et il conclura que le reste est du même acabit.
 */
const embauche = (() => {
  const heuresAn = h.productiveHoursPerDay * h.workingDaysPerYear;
  const fraction = (s: number) => (h.volume * s) / 3600 / heuresAn;
  const prorata = (s: number) => ((h.volume * s) / 3600) * (h.analystAnnualCost / heuresAn);
  const reel = (s: number) => Math.ceil(fraction(s)) * h.analystAnnualCost;
  const rapport = (s: number) => reel(s) / Math.max(prorata(s), 1);
  const enUsage = h.humanSeconds;
  return `**The human tier is priced as a slope, and headcount is a step.** At `
    + `${h.humanSeconds} s per item and ${h.volume.toLocaleString("en-GB")} documents the `
    + `human tier would occupy **${fraction(enUsage).toFixed(2)} of an analyst**, billed pro `
    + `rata at ${euro(prorata(enUsage))} where a payroll pays ${euro(reel(enUsage))} — a factor `
    + `of ${rapport(enUsage).toFixed(2)}. You do not hire a fraction of a person. At the bottom `
    + `of the swept range the factor reaches ${rapport(15).toFixed(2)}. It does not change the `
    + `answer here — the routing above does not select the human tier — but the cost model is `
    + `a slope where the world has steps, and that is stated rather than left to be found.`;
})();

const provenance = markdown(
  INVENTORY.map((e) => e.name === "routing"
    ? { ...e, note: `exhaustive over all ${nCombinaisons.toLocaleString("en-GB")} combinations of the ${paliersMesures(p).length} tiers in the profile`
        + (nAvecHypothese ? `, ${nAvecHypothese} of which carries an assumed accuracy rather than a measured one` : "")
        + ` — no heuristic, nothing to tune` }
    : e),
  table,
);

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
/**
 * L'ETAGE DE LECTURE — ce que coute le passage par une image.
 *
 * Tout le reste de ce depot mesure l'extraction DEPUIS UN TEXTE. Un client, lui, recoit des
 * scans. La question qu'il pose n'est donc pas « quel palier lit le mieux un texte » mais
 * « que reste-t-il de votre exactitude quand le texte vient d'une image ». Personne n'y
 * repondait, et c'etait le trou le plus visible entre ce qui est mesure et ce qui est vendu.
 *
 * La mesure est appariee : memes documents, memes paliers, une fois en texte et une fois en
 * image de ce texte. L'ecart est le cout de l'etage, et rien d'autre.
 *
 * Le bloc publie aussi ce qu'il n'a PAS mesure — images rendues et non photographiees,
 * documents courts, paliers ecartes — parce qu'un plancher publie sans son qualificatif se lit
 * comme un cout observe.
 */
const lecture = (() => {
  const chemin = fileURLToPath(new URL("../ocr.json", import.meta.url));
  if (!existsSync(chemin)) {
    throw new Error("ocr.json est absent — ce bloc publie une mesure. Lancez : npm run ocr");
  }
  const r = JSON.parse(readFileSync(chemin, "utf8"));

  const fid = rate(Math.round(r.fideliteDeLaTranscription.taux * r.fideliteDeLaTranscription.n),
    r.fideliteDeLaTranscription.n);
  const lignes = r.paliers.map((x: { palier: string; surTexte: { taux: number; n: number };
      surImage: { taux: number; n: number }; ecartEnPoints: number; separable: boolean }) => [
    `\`${x.palier}\``,
    writeRate(rate(Math.round(x.surTexte.taux * x.surTexte.n), x.surTexte.n)),
    writeRate(rate(Math.round(x.surImage.taux * x.surImage.n), x.surImage.n)),
    `${Math.abs(x.ecartEnPoints) < 0.05 ? "" : x.ecartEnPoints > 0 ? "-" : "+"}`
      + `${Math.abs(x.ecartEnPoints).toFixed(1)} pts`,
    x.separable ? "yes" : "no",
  ]);

  /* LE VERDICT SE CALCULE. Si aucun ecart ne sort du bruit, la phrase le dit — au lieu de
     laisser un tableau d'ecarts suggerer un cout que la mesure ne porte pas. */
  const separables = r.paliers.filter((x: { separable: boolean }) => x.separable);
  const verdictLecture = separables.length === 0
    ? `**At this scale, no tier loses a measurable amount.** Every gap in the table overlaps its `
      + `own interval: the reading stage costs nothing this measurement can distinguish from `
      + `noise. That is a statement about ${r.documents} documents of this kind, not a promise `
      + `about your scans.`
    : `**${separables.length} of ${r.paliers.length} tiers ${separables.length === 1 ? "loses" : "lose"} `
      + `more than noise.** `
      + separables.map((x: { palier: string; ecartEnPoints: number }) =>
          `\`${x.palier}\` gives up ${Math.abs(x.ecartEnPoints).toFixed(1)} points`).join(", ")
      + ` when the same document arrives as an image instead of as text.`;

  return `**Your documents are scans; every other table here starts from text.** This one does `
    + `not. The same ${r.documents} documents were rendered to images, read back with Apple's `
    + `Vision OCR, and put through the same extractors. Nothing else changed, so the difference `
    + `is the reading stage and nothing else.\n\n`
    + `Transcription fidelity: **${writeRate(fid)}** of words recovered.\n\n`
    + table(["Tier", "From text", "From the image", "Gap", "Beyond noise"], lignes)
    + `\n\n${verdictLecture}\n\n`
    + `**What this does not measure.** The images are rendered, not photographed — clean, `
    + `square, no glare or fold — and the documents average `
    + `${r.lignesParDocument.moyenne.toFixed(1)} lines (at most ${r.lignesParDocument.maximum}). `
    + `A photographed full page brings problems these do not: columns, reading order, skew. `
    + `**The gaps above are a floor, not a production cost.**`
    + (r.paliersEcartes.length
        ? ` ${r.paliersEcartes.length} tier${r.paliersEcartes.length === 1 ? " was" : "s were"} excluded — `
          + r.paliersEcartes.map((t: string) => `\`${t}\``).join(", ")
          + ` — because ${r.paliersEcartes.length === 1 ? "it returns" : "they return"} the right `
          + `answer from scrambled text: ${r.paliersEcartes.length === 1 ? "it never reads" : "they never read"} `
          + `the document, so degrading it cannot move ${r.paliersEcartes.length === 1 ? "it" : "them"}. `
          + `${r.paliersEcartes.length === 1 ? "Its" : "Their"} gap would be 0.0 points by construction, `
          + `which measures the instrument rather than the scan.`
        : ``)
    + ` The OCR step runs on the machine, through the operating system: no API, no per-page fee.`;
})();

/**
 * LE CHAPEAU, ET SON COMPTE.
 *
 * Il disait « Four tiers » — la premiere phrase que lit un acheteur — devant un tableau qui
 * en montre sept. L'echelle generative locale est OPTIONNELLE : un clone sans Ollama en
 * mesure quatre, cette machine en mesure sept. Une phrase qui compte a la main se dement
 * toute seule des que la mesure grandit, et celle-ci se dementait deja.
 *
 * Le meme defaut vivait a trois endroits de l'ecran, dont les deux etiquettes
 * d'accessibilite, que personne ne relit puisque personne ne les voit.
 */
const chapeau = (() => {
  const n = mesures.length + 1;   // les paliers mesures, plus `human` qui n'est pas mesure
  return `**${n} tiers**, from a regular expression to a human, measured on held-out data and `
    + `then routed under a budget. The answer is rarely "buy the bigger model", and this says `
    + `why.`;
})();

/**
 * LES DEUX CHAINES VEULENT DES CHOSES OPPOSEES — et le compte se calcule.
 *
 * La phrase disait « trois champs sur les regles » et « le grand modele exactement une
 * fois ». Elle etait vraie le jour ou elle a ete ecrite, et rien ne la tenait : elle n'a pas
 * d'unite, donc la garde des chiffres nus ne la voyait pas, et une remesure qui deplace un
 * champ la laissait fausse sur la page la plus lue du depot.
 *
 * La moitie « chaine B » reste en prose : elle porte sur un jeu de cas client qui ne vit pas
 * dans ce depot, donc rien ici ne peut la recalculer. Le dire est la moitie de l'honnetete.
 */
const chaines = (() => {
  const opt = optimiseExtraction(p!, h)?.routing;
  if (!opt) throw new Error("l'optimiseur ne rend pas de routage : cette phrase ne peut pas être écrite.");
  const compte = (t: string) => FIELDS.filter((f) => opt[f] === t).length;
  const gratuits = compte("rules");
  const grand = compte("large");
  const mot = (n: number) => ["no", "one", "two", "three", "four", "five", "six"][n] ?? String(n);
  const fois = grand === 0 ? "never needs the large model"
    : grand === 1 ? "needs the large model exactly once"
    : `needs the large model ${mot(grand)} times`;
  return `**The two chains want opposite things.** Chain A puts ${mot(gratuits)} of the `
    + `${mot(FIELDS.length)} fields on free rules and ${fois}. Chain B finds rules useless and the `
    + `*small* model better than the large one. Any advice that does not begin with measuring `
    + `your own chain is selling you someone else's.`;
})();

/**
 * CE QUE LE ROUTAGE COUTE QUAND IL SE TROMPE.
 *
 * Le solveur maximise un taux. Un client ne paie pas un point de pourcentage : il paie le
 * cout d'avoir tort. Et l'outil mesure deja DEUX facons de se tromper qui ne coutent pas la
 * meme chose — un champ vide declenche une relecture, une valeur fausse entre au dossier.
 *
 * Deux faits sortent de la, et le second est le plus important :
 *   1. la recommandation publiee tient sur un large intervalle de prix — c'est rassurant ;
 *   2. l'exposition vaut des dizaines de fois le cout de traitement, donc **l'optimiseur se
 *      dispute sur la petite variable**. Le dire est plus honnete que de le taire.
 */
const expositionBloc = (() => {
  const chemin = fileURLToPath(new URL("../exposition.json", import.meta.url));
  if (!existsSync(chemin)) {
    throw new Error("exposition.json est absent — ce bloc publie une mesure. Lancez : npm run exposition");
  }
  const r = JSON.parse(readFileSync(chemin, "utf8")) as {
    publie: Record<string, string>;
    seuil: { bas: number; haut: number } | null;
    points: { rapport: number; traitement: number | null; exposition: number | null }[];
  };
  const base = r.points[0]!;
  const facteur = Math.round((base.exposition ?? 0) / (base.traitement || 1));

  /* L'asymetrie se calcule : quel palier echoue en s'abstenant, lequel en inventant. */
  const vide = (t: TierName, c: Field) => p!.extraction[t]?.[c]
    ? decompositionDe(p!, t, c) : null;
  const parAbstention = FIELDS.map((c) => ({ c, d: vide("rules" as TierName, c) }))
    .filter((x) => x.d && x.d.vide > 0 && x.d.faux === 0);

  return `**A tier can be wrong in two ways, and they do not cost the same.** A blank field `
    + `says "I do not know" and triggers a review. A wrong value enters the record. This `
    + `repository measures the split for every tier and field, and the asymmetry is the part `
    + `the accuracy figure hides: **regexes fail by abstaining, models fail by inventing.**`
    + (parAbstention.length
        ? ` On ${parAbstention.length} of the ${FIELDS.length} fields, \`rules\` produces `
          + `blanks and **not one wrong value**.`
        : ``)
    + `\n\n**The recommendation is robust.** `
    + (r.seuil
        ? `A wrong value would have to cost **${r.seuil.bas} reviews** before the optimal `
          + `routing changes — bracketed by bisection between ${r.seuil.bas} and ${r.seuil.haut}, `
          + `not a point. Below that ratio, the published routing is also the one that minimises `
          + `total exposure.`
        : `Across every price ratio tested, the optimal routing never moves away from the `
          + `published one.`)
    + `\n\n**And the number that matters most is not the one being optimised.** At equal `
    + `prices, the same volume costs $${Math.round(base.traitement ?? 0).toLocaleString("en-GB")} `
    + `to process and $${Math.round(base.exposition ?? 0).toLocaleString("en-GB")} in expected `
    + `cost of being wrong — **${facteur}x more**. The optimiser argues about the small `
    + `variable. Both prices are yours to set: they are assumptions, marked as such, and only `
    + `you know what a misfiled record costs.`;
})();

/**
 * LE DOSSIER, PAS LE CHAMP.
 *
 * Le titre annonce la moyenne de cinq taux par champ. Un responsable conformite ne classe
 * pas des champs : il classe des dossiers, et un dossier n'est complet que si les cinq
 * champs sont justes ENSEMBLE.
 *
 * Et le taux par dossier est une VRAIE PROPORTION — complet ou pas — donc il porte
 * legitimement un intervalle de Wilson, ce que la moyenne de cinq taux mesures sur cinq
 * echantillons differents ne peut pas porter. Le chiffre par dossier est plus defendable
 * que le titre.
 */
const documentBloc = (() => {
  const chemin = fileURLToPath(new URL("../document.json", import.meta.url));
  if (!existsSync(chemin)) {
    throw new Error("document.json est absent — ce bloc publie une mesure. Lancez : npm run document");
  }
  const d = JSON.parse(readFileSync(chemin, "utf8")) as {
    publie: { routing: Record<string, string>; complets: number; n: number; cost: number };
    vise: { routing: Record<string, string>; complets: number; n: number; cost: number };
    identiques: boolean;
    apparie: { n: number; gains: number; regressions: number; discordant: number; decidable: boolean; note?: string };
  };
  const tx = (x: { complets: number; n: number }) => writeRate(rate(x.complets, x.n));
  const lignes = [
    ["what the published routing delivers", `\`${FIELDS.map((c) => d.publie.routing[c]).join(", ")}\``,
      tx(d.publie), `$${Math.round(d.publie.cost).toLocaleString("en-GB")}`],
    ["what aiming at the file delivers", `\`${FIELDS.map((c) => d.vise.routing[c]).join(", ")}\``,
      tx(d.vise), `$${Math.round(d.vise.cost).toLocaleString("en-GB")}`],
  ];

  const moinsCher = d.publie.cost > 0 ? d.publie.cost / Math.max(d.vise.cost, 1e-9) : 1;
  return `**Your unit is the file, and the headline is not.** ${pc(best!.accuracy)} is the `
    + `mean of ${FIELDS.length} per-field rates. A file is only complete when all `
    + `${FIELDS.length} fields are right **together**, and that is what gets filed.\n\n`
    + table(["", "Routing", "Complete files", "Cost"], lignes)
    + `\n\n*Unlike the headline, this one is a true proportion — a file is complete or it is `
    + `not — so it carries a Wilson interval. The mean of five rates measured on five `
    + `different samples cannot, and this report refuses to invent one.*`
    + (d.identiques
        ? `\n\nAiming at the file changes nothing here: both objectives pick the same routing.`
        : `\n\n**Aiming at the file changes the routing, and it is never worse on any file in `
          + `the sample** — ${d.apparie.gains} gained, ${d.apparie.regressions} lost, for `
          + `**${moinsCher.toFixed(1)}x less**. But ${d.apparie.discordant} discordant pairs `
          + `cannot separate two rates: what the sample establishes is the cost, not the `
          + `accuracy. ${d.apparie.note ?? ""}`);
})();

/**
 * LES DEUX LEVIERS, ET CELUI QU'IL FAUT TIRER D'ABORD.
 *
 * Ce depot mesure deux facons de reduire le cout d'avoir tort, et il ne les avait jamais
 * comparees — chacune vivait dans sa commande.
 *
 *   RE-ROUTER : changer quel palier porte quel champ.
 *   S'ABSTENIR : ne rien rendre quand un signal dit que la valeur est douteuse.
 *
 * Les deux se resument par un rapport SANS DIMENSION — « une valeur fausse vaut combien de
 * relectures ? » — donc les deux se transportent chez un client sans extrapoler quoi que ce
 * soit. Et les deux seuils ne sont pas du tout au meme endroit.
 *
 * C'est la phrase la plus decisive que l'outil sache dire, et elle etait invisible.
 */
const leviers = (() => {
  const cheminExp = fileURLToPath(new URL("../exposition.json", import.meta.url));
  if (!existsSync(cheminExp)) throw new Error("exposition.json absent — lancez : npm run exposition");
  const exp = JSON.parse(readFileSync(cheminExp, "utf8")) as { seuil: { bas: number; haut: number } | null };

  const abst = (() => {
    const l = JSON.parse(readFileSync(fileURLToPath(new URL("../landing.json", import.meta.url)), "utf8")) as {
      abstention?: { documents: number; valuesMeasured: number; baselinePrecisionPct: number;
        rules: { signalsRequired: number; abstentions: number; wrongRemoved: number;
          correctSacrificed: number; breakEvenCostRatio: number | null;
          deliveredPrecisionPct: number | null; deliveredPrecisionInterval: number[] | null }[] } | null;
    };
    const r = l.abstention?.rules?.find((x) => x.breakEvenCostRatio !== null);
    return r && l.abstention ? { ...r, ...l.abstention } : null;
  })();
  if (!abst) throw new Error("landing.json ne porte pas de frontiere d'abstention exploitable.");

  const seuilRoutage = exp.seuil ? exp.seuil.bas : null;
  const seuilAbstention = abst.breakEvenCostRatio!;
  const ecart = seuilRoutage ? Math.round(seuilRoutage / seuilAbstention) : null;

  return `**There are two levers, and they are not equally close.** Both reduce the cost of `
    + `being wrong, and both reduce to one dimensionless question — *how many reviews is one `
    + `wrong value worth to you?* — so both transfer to your numbers without extrapolating `
    + `anything.\n\n`
    + table(["Lever", "Pays off once a wrong value is worth", "What it does"], [
      ["**Abstain**", `**${seuilAbstention} reviews**`,
        `returns nothing when a signal says the value is doubtful — ${abst.wrongRemoved} wrong `
        + `values removed for ${abst.correctSacrificed} correct ones lost, precision `
        + `${abst.baselinePrecisionPct} % → ${abst.deliveredPrecisionPct} %`],
      ["Re-route", seuilRoutage ? `${seuilRoutage} reviews` : "never, in the range tested",
        "moves a field to a different tier — the published recommendation is stable below that"],
    ])
    + `\n\n${ecert(ecart)}`
    + `\n\n*The abstention figures are measured on the **hard corpus** — `
    + `${abst.documents} deliberately difficult documents, ${abst.valuesMeasured} values — not `
    + `on the main sample. That is where abstention is worth measuring, and it is also why the `
    + `baseline precision there is ${abst.baselinePrecisionPct} % rather than the headline. The `
    + `ratio itself carries no unit and does not depend on that choice.*`;

  function ecert(n: number | null) {
    return n === null
      ? `Abstention pays almost immediately; re-routing never became worthwhile in the range tested.`
      : `**Abstention pays roughly ${n} times sooner than re-routing.** For almost any client, `
        + `the lever is refusing to answer — not moving fields between tiers. That is the `
        + `opposite of where attention usually goes.`;
  }
})();

/**
 * LA FRONTIERE D'ABSTENTION, DANS LA MONNAIE DU CLIENT.
 *
 * Le levier principal se lisait en points de precision. Un responsable conformite ne decide
 * pas sur des points : il decide sur des HEURES d'analyste et sur des erreurs classees.
 *
 * La conversion ne demande qu'une hypothese — le temps d'une relecture — et elle est deja
 * declaree dans `assumptions`, marquee comme supposee. Tout le reste est mesure.
 *
 * Ce qui n'est PAS fait ici, et qui se dit : extrapoler au volume du client. La frontiere est
 * mesuree sur le corpus DUR, choisi difficile. Le rapport de bascule, lui, est sans dimension
 * et se transporte ; le nombre d'heures ne se transporte qu'a proportion des valeurs douteuses
 * du client, que nous ne connaissons pas.
 */
const frontiere = (() => {
  const l = JSON.parse(readFileSync(fileURLToPath(new URL("../landing.json", import.meta.url)), "utf8")) as {
    abstention: { documents: number; valuesMeasured: number; baselinePrecisionPct: number;
      rules: { signalsRequired: number; abstentions: number; wrongRemoved: number;
        correctSacrificed: number; delivered: number; deliveredPrecisionPct: number | null;
        deliveredPrecisionInterval: number[] | null; breakEvenCostRatio: number | null;
        neverSacrificesInterval: number[] | null }[] } | null;
  };
  const a = l.abstention;
  if (!a) throw new Error("landing.json ne porte pas de frontiere d'abstention.");

  const parCent = (x: number) => (100 * x) / a.valuesMeasured;
  const heures = (n: number) => (n * h.humanSeconds) / 3600;

  const lignes = a.rules.map((r) => {
    const relectures = parCent(r.abstentions);
    const evites = parCent(r.wrongRemoved);
    /*
     * LE PLANCHER PORTE SUR LE DENOMINATEUR DU TAUX, PAS SUR UN VOISIN.
     *
     * Premiere version : elle testait `wrongRemoved`. Or la precision livree se calcule sur
     * les valeurs LIVREES — 146 a deux signaux — et le garde-fou supprimait donc un chiffre
     * parfaitement citable, en laissant croire que la mesure est plus faible qu'elle n'est.
     * Ce qui repose vraiment sur quatre observations, c'est « aucune juste sacrifiee », et
     * cette reserve-la est portee separement, plus bas.
     */
    const precision = r.delivered >= ENOUGH && r.deliveredPrecisionPct !== null
      ? `${r.deliveredPrecisionPct} % [${r.deliveredPrecisionInterval![0]}–${r.deliveredPrecisionInterval![1]}]`
      : `— (${r.delivered} delivered, too few to quote)`;
    return [
      `**${r.signalsRequired}**`,
      `${relectures.toFixed(0)} reviews · ${heures(relectures).toFixed(1)} h`,
      `${evites.toFixed(0)}`,
      `${parCent(r.correctSacrificed).toFixed(0)}`,
      precision,
      r.breakEvenCostRatio === null ? "—" : `${r.breakEvenCostRatio}`,
    ];
  });

  const fort = a.rules.find((r) => r.wrongRemoved >= ENOUGH);
  const gratuit = a.rules.find((r) => r.correctSacrificed === 0 && r.wrongRemoved > 0);

  return `**In your currency, per hundred values processed.** The lever reads in precision `
    + `points; nobody signs off on precision points. Below, the same measurement in analyst `
    + `reviews and in errors that never reach a file.\n\n`
    + table(["Signals required", "Reviews added", "Wrong values avoided", "Correct values lost",
      "Precision of what is delivered", "Break-even ratio"], lignes)
    + `\n\n*Reviews are converted at ${h.humanSeconds} seconds each — the one assumption in `
    + `this table, and it is yours to change. Everything else is counted.*`
    + (fort
        ? `\n\n**At ${fort.signalsRequired} signal${fort.signalsRequired > 1 ? "s" : ""}, the trade `
          + `is ${(fort.wrongRemoved / Math.max(fort.correctSacrificed, 1)).toFixed(1)} wrong values `
          + `removed for every correct one lost**, and precision goes from `
          + `${a.baselinePrecisionPct} % to ${fort.deliveredPrecisionPct} %. Whether that is worth `
          + `${heures(parCent(fort.abstentions)).toFixed(1)} hours per hundred values is your `
          + `arithmetic, not ours — it depends on what a misfiled record costs you.`
        : ``)
    /* DEUX TAUX VOISINS NE DISENT RIEN. Le seuil prudent ameliore-t-il la precision, ou
       est-ce du bruit ? La question se tranche, elle ne se laisse pas suggerer. */
    + (() => {
        const prudent = a.rules.find((r) => r.correctSacrificed === 0 && r.deliveredPrecisionPct !== null);
        if (!prudent || !prudent.deliveredPrecisionInterval) return "";
        const base = rate(Math.round(a.baselinePrecisionPct / 100 * a.valuesMeasured), a.valuesMeasured);
        const apres = rate(Math.round(prudent.deliveredPrecisionPct! / 100 * prudent.delivered), prudent.delivered);
        return distinguishable(base, apres)
          ? `\n\n**And the cautious threshold does move precision**, separably: `
            + `${a.baselinePrecisionPct} % to ${prudent.deliveredPrecisionPct} %, intervals apart.`
          : `\n\n**And the cautious threshold moves nothing.** ${a.baselinePrecisionPct} % to `
            + `${prudent.deliveredPrecisionPct} % — the intervals overlap almost entirely, so the `
            + `sample cannot tell the two apart. It is nearly free and nearly useless, which is `
            + `worth saying rather than letting two adjacent numbers suggest a gain.`;
      })()
    + (gratuit && gratuit.wrongRemoved < ENOUGH
        ? `\n\n**And a caution on the row that looks free.** At ${gratuit.signalsRequired} signals `
          + `no correct value is lost at all — but on ${gratuit.abstentions} abstentions, which is `
          + `below this repository's floor of ${ENOUGH}. "Never sacrifices a correct value" is a `
          + `claim that sample cannot carry`
          + (gratuit.neverSacrificesInterval
              ? `: the interval on it runs from ${gratuit.neverSacrificesInterval[0]} % to `
                + `${gratuit.neverSacrificesInterval[1]} %.`
              : `.`)
        : ``)
    + `\n\n*Measured on the **hard corpus** — ${a.documents} deliberately difficult documents, `
    + `${a.valuesMeasured} values. The break-even ratio carries no unit and transfers as is; the `
    + `hours transfer only in proportion to how many of your values are doubtful, which we do `
    + `not know.*`;
})();

const tests = (() => {
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const fichiers = readdirSync(dossier).filter((n: string) => n.endsWith(".test.ts"));
  const n = fichiers.reduce((a: number, f: string) =>
    a + (readFileSync(join(dossier, f), "utf8").match(/^test\(/gm) ?? []).length, 0);
  if (n < 20) throw new Error(`${n} tests comptés dans ${fichiers.length} fichier(s) : la lecture a échoué.`);
  return `**${n} tests** across ${fichiers.length} files, counted from the sources rather than typed here.`;
})();

emit(fileURLToPath(new URL("../README.md", import.meta.url)),
  { chapeau, chaines, finding, obligation, ouCaTourne, lecture, exposition: expositionBloc, document: documentBloc, leviers, frontiere, extraction, classification, routing, shadow, gallery, baselines, provenance, coutDeReproduction, embauche,
    echelles, latence, egalites, fuite, deuxfaits, retractations, public: publicJeu, commandes,
    tests });
