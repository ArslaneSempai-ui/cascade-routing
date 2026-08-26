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

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { FIELDS } from "./corpus.ts";
import { readProfiles } from "./measure.ts";
import { optimiseExtraction, paliersMesures } from "./optimise.ts";
import "./figer.ts";  /* pose la table figée : voir figer.ts */
import { ASSUMPTIONS, STATUSES, UNITS, symboleDe, pricePerThousandExtractions } from "./assumptions.ts";

import { rate, writeRate, distinguishable } from "./interval.ts";
import { MEANING } from "./provenance.ts";
import { table } from "./figures.ts";
import { MODELES_LOCAUX, REVISIONS, LICENCES, RULES } from "./tiers.ts";
import { plancherDeBruit } from "./entree.ts";
import { SEUIL_DE_L_INDUSTRIE, OBSERVATIONS_MINIMALES } from "./psi.ts";

import type { Profiles } from "./measure.ts";
import type { Assumptions } from "./assumptions.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const FICHIER = fileURLToPath(new URL("../VALIDATION.md", import.meta.url));

const pc = (x: number) => (x * 100).toFixed(1) + " %";
/*
 * L'ARGENT NE PASSE PAS PAR LA LOCALE DE LA MACHINE.
 *
 * `toLocaleString("en-US")` dépend de la locale et de la présence d'un ICU complet : le même
 * montant se rendait « 1,234 » ici, « 1.234 » dans le rapport signé qui emploie `en-GB`, et
 * « 1234 » tout court sur un Node sans ICU. Trois chaînes pour un chiffre, selon la page
 * qu'on lit et la machine qui l'a produite.
 *
 * Le groupage ci-dessous est celui de `grouper()` dans `rapport.ts` du dépôt licencié, copié
 * à l'identique — les deux dépôts ne peuvent pas s'importer l'un l'autre, donc la copie est
 * forcée ; ce qui ne l'est pas, c'est qu'elle soit reconnaissable. **Si l'une des deux change,
 * l'autre change avec.** Ici les montants sont déjà arrondis à l'entier, donc seule la partie
 * entière est groupée ; l'expression de groupage est la même, mot pour mot.
 *
 * Et le symbole vient de `symboleDe(UNITS.…)`, jamais tapé ici : une devise écrite à la main
 * au site de rendu est exactement comment ce dépôt s'est mis à publier le même chiffre en
 * dollars et en euros selon la page.
 */
const grouperEntier = (n: number): string => {
  const neg = n < 0;
  const ent = String(Math.abs(n));
  return (neg ? "-" : "") + ent.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};
const SYMBOLE_MONETAIRE = symboleDe(UNITS.budget);
const euro = (x: number) => SYMBOLE_MONETAIRE + grouperEntier(Math.round(x));

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
  const prov = paliersMesures(p).flatMap((t) => {
    const v = p.provenance?.[t];
    if (!v) return [[`\`${t}\``, "—", "—", "not recorded", "—"]];
    /* Relevé antérieur à la séparation par type : une seule ligne, et on ne prétend pas mieux. */
    if ((v as { accuracy?: unknown }).accuracy === undefined) {
      const plat = v as unknown as { measuredAt: string; commit: string | null; sale: boolean | null };
      return [[`\`${t}\``, "both", plat.measuredAt, plat.commit ? `\`${plat.commit}\`` : "not recorded", "not recorded"]];
    }
    return (["accuracy", "latency"] as const).map((quoi) => {
      const b = v[quoi];
      return [`\`${t}\``, quoi, b.measuredAt, b.commit ? `\`${b.commit}\`` : "not recorded",
        b.charge ? `${b.charge.externalBefore} external / ${b.charge.coeurs} cores` : "—"];
    });
  });
  if (prov.some((r) => r[2] !== "—")) {
    w(`Accuracy and latency do not always come from the same pass, and they are not the same`);
    w(`kind of number: accuracy is deterministic, latency measures the machine as much as the`);
    w(`model. Each carries its own provenance rather than borrowing the other's.`);
    w(``);
    w(table(["Tier", "Measured", "At", "Commit", "Load during"], prov));
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
  /*
   * LA MÉTHODE DE L'INTERVALLE EST NOMMÉE, ET ELLE NE L'ÉTAIT PAS.
   *
   * Ce document citait « 95 % interval » quatre fois sans jamais dire lequel. Un acheteur
   * sceptique — celui qui vaut la peine d'être convaincu — se demande d'abord si c'est du
   * Wald, parce que c'est le défaut de la plupart des outils et parce que c'est celui qui
   * FLATTE : près de 0 ou de 1 il sort de [0, 1], et sur petit échantillon il rétrécit à
   * tort. Un intervalle trop étroit fait paraître un écart significatif quand il ne l'est
   * pas, et c'est précisément la décision que ce tableau porte.
   *
   * C'est du Wilson, et ça l'a toujours été. Une session voisine l'a établi en
   * réimplémentant la formule depuis sa définition plutôt qu'en relisant le code : six
   * formules recalculées, zéro écart sur dix-neuf couples, accord à 1e-12.
   *
   * Un chiffre juste qui ne dit pas pourquoi il est juste se fait attaquer comme un chiffre
   * faux. Les deux valeurs aux extrêmes sont écrites ici parce qu'elles sont exactement ce
   * que Wald rate, et elles sont figées dans `interval.test.ts` : elles ne peuvent plus
   * bouger en silence.
   */
  /*
   * CE QUE LE 100 % DES RÈGLES GRATUITES MESURE RÉELLEMENT.
   *
   * `RULES.country` énumère huit pays. `corpus.ts` en engendre huit. Les deux listes étaient
   * identiques mot pour mot, et `RULES.document` cherche le seul format que le générateur
   * produit. Le taux publié pour ces champs n'est donc pas la mesure d'une capacité : c'est
   * le fait que la règle et le corpus ont été écrits par la même main.
   *
   * Mesuré le 25 août 2026 sur la liste SDN de l'OFAC — 300 cas d'une distribution que nous
   * n'avons pas écrite, chaque bonne réponse vérifiée présente mot pour mot dans le texte.
   * L'outil n'est pas en cause : l'encodeur `large` fait 96,7 % et 85,3 % sur ces mêmes
   * données. C'est la partie GRATUITE qui est ajustée à nous-mêmes.
   *
   * Ça se dit ici plutôt que de se corriger en silence : élargir la règle ou le corpus
   * déplacerait le chiffre qu'on vend, et ce n'est pas une décision d'entretien.
   */
  w(`**The free tier is fitted to this corpus, and here is what that costs.** The rules for`);
  w(`\`birth\`, \`document\` and \`country\` enumerate exactly what the generator emits: the`);
  w(`country rule lists eight countries and the corpus produces those same eight, and the`);
  w(`document rule matches the single identifier format the generator uses. Their published`);
  w(`rate is therefore not a measurement of a capability — it is the two lists having been`);
  w(`written by the same hand.`);
  w(``);
  w(`Measured against a distribution we did not write — 300 records from the OFAC SDN list,`);
  w(`every expected answer verified to appear verbatim in the source text:`);
  w(``);
  /*
   * CES CHIFFRES SONT CALCULÉS ICI, JAMAIS TAPÉS.
   *
   * Écrits à la main, ils décrivaient un état du 25 août et auraient survécu à n'importe
   * quelle modification des règles. Le premier contrôle que j'ai écrit pour les tenir
   * cherchait « un nombre proche quelque part dans le document » — et passait au vert sur une
   * règle volontairement cassée, parce qu'un document plein de pourcentages en contient
   * toujours un qui tombe juste. Un contrôle qui cherche partout ne vérifie nulle part.
   *
   * Ils viennent maintenant du corpus externe versionné, à chaque régénération.
   */
  const externe = (() => {
    const p = fileURLToPath(new URL("../corpus-externe/ofac-300.csv", import.meta.url));
    if (!existsSync(p)) return null;
    const lignes = readFileSync(p, "utf8").trim().split("\n");
    const entete = lignes[0]!.split(",");
    const cas = lignes.slice(1).map((l) => {
      const c: string[] = []; let ch = "", dans = false;
      for (let i = 0; i < l.length; i++) {
        const x = l[i]!;
        if (dans) { if (x === '"' && l[i + 1] === '"') { ch += '"'; i++; } else if (x === '"') dans = false; else ch += x; }
        else if (x === '"') dans = true; else if (x === ",") { c.push(ch); ch = ""; } else ch += x;
      }
      c.push(ch);
      return Object.fromEntries(entete.map((k, i) => [k, c[i] ?? ""])) as Record<string, string>;
    });
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    const score = (champ: string) => {
      const r = (RULES as Record<string, ((t: string) => string) | undefined>)[champ];
      const avec = cas.filter((c) => c[champ]);
      if (!r || avec.length < 50) return null;
      return {
        taux: 100 * avec.filter((c) => norm(r(c["text"]!)) === norm(c[champ]!)).length / avec.length,
        n: avec.length,
        rendus: avec.filter((c) => r(c["text"]!) !== "").length,
      };
    };
    return { score, total: cas.length };
  })();

  /*
   * DEUX COLONNES SUR TROIS ETAIENT TAPEES, SOUS UN COMMENTAIRE QUI DISAIT LE CONTRAIRE.
   *
   * « CES CHIFFRES SONT CALCULES ICI, JAMAIS TAPES » ne portait que sur la colonne du
   * milieu. « This corpus, rules » et « OFAC, large » arrivaient en chaines litterales
   * — six taux — et ce document est dispense du cliquet des taux tapes parce qu'il est
   * repute engendre. L'exemption reposait donc sur une phrase fausse : `--check` compare
   * le fichier a la sortie du generateur, qui rend les memes litteraux, alors il verifie
   * une transcription et jamais une mesure.
   *
   * La premiere colonne vient du releve, comme le reste du document. La seconde ne se
   * derive pas ici — elle demande de faire tourner `large` sur la liste SDN, donc le
   * modele — alors elle est GELEE avec sa date et la raison de son absence, et le
   * document le dit sous la table.
   */
  const OFAC_LARGE: Record<string, string> = {
    birth: "96.7 %",
    document: "35.3 %",
    country: "85.3 %",
  };
  const OFAC_LARGE_MESURE_LE = "2026-08-25";
  const OFAC_LARGE_PAS_DERIVABLE_ICI =
    "running `large` over the SDN list needs the model, which `npm test` does not download";

  if (externe) {
    const ligne = (champ: Field) => {
      const e = externe.score(champ);
      return [`\`${champ}\``, pc(taux(p, "rules", champ).rate),
        e ? `**${e.taux.toFixed(1)} %** (n=${e.n})` : "—", OFAC_LARGE[champ] ?? "—"];
    };
    w(table(["Field", "This corpus, rules", "OFAC, rules", "OFAC, \`large\`"], [
      ligne("birth"),
      ligne("document"),
      ligne("country"),
    ]));
  }
  w(``);
  /*
   * CETTE PHRASE ETAIT FAUSSE, ET ELLE CONTREDISAIT LA TABLE TROIS LIGNES PLUS HAUT.
   *
   * « they do not answer at all: 0, 15 and 24 values returned » : mesure sur ce meme CSV,
   * les regles rendent 290, 198 et 259 valeurs. Un taux de 100,0 % sur n=290, imprime juste
   * au-dessus, est incompatible avec « zero valeur rendue ». La phrase decrivait un etat
   * revolu et elle a survecu parce que ce document est dispense du cliquet.
   *
   * Ce qui la remplace se calcule. Ce qui reste a decider n'est pas de l'entretien : sur
   * cette liste les regles tiennent mieux que ce paragraphe ne l'annonce, et c'est
   * l'argument du paragraphe qui doit etre repris, pas le chiffre.
   */
  if (externe) {
    const champs: Field[] = ["birth", "document", "country"];
    const vus = champs.map((c) => ({ c, e: externe.score(c), ici: 100 * taux(p, "rules", c).rate }));
    const nomme = (x: string) => "`" + x + "`";
    const rendus = vus.map((v) => (v.e ? v.e.rendus : 0));
    const totaux = vus.map((v) => (v.e ? v.e.n : 0));
    const abstentions = vus.reduce((s2, v) => s2 + (v.e ? v.e.n - v.e.rendus : 0), 0);
    const ecarts = vus.map((v) => {
      if (!v.e) return nomme(v.c) + " —";
      const d = v.ici - v.e.taux;
      /* « \u22120.0 points » se lit comme une perte ; un ecart qui s'arrondit a zero se dit. */
      if (Math.abs(d) < 0.05) return nomme(v.c) + " unchanged";
      return nomme(v.c) + " " + (d >= 0 ? "\u2212" : "+") + Math.abs(d).toFixed(1) + " points";
    });
    w(`They do answer: ${rendus.join(", ")} values returned for ${champs.map(nomme).join(", ")}`);
    w(`out of ${totaux.join(", ")} cases, with ${abstentions} abstentions in all. What moves is`);
    w(`the accuracy: ${ecarts.join(", ")} against this corpus.`);
    w(``);
    w(`The \`large\` column is not measured here. It was taken on ${OFAC_LARGE_MESURE_LE} and`);
    w(`is frozen in the generator, because ${OFAC_LARGE_PAS_DERIVABLE_ICI}.`);
    w(``);
    w(`On a real`);
  }

  /*
   * CE CHIFFRE ÉTAIT FAUX D'UN FACTEUR VINGT À QUATRE-VINGTS, DANS LE SENS QUI NOUS ABÎME.
   *
   * J'avais écrit « 60 à 480 » en prenant `pricePerThousand*`, qui est le prix d'un
   * fournisseur HÉBERGÉ. Les encodeurs de ce dépôt tournent sur la machine du client — c'est
   * la promesse centrale du produit — donc leur coût est du TEMPS MACHINE, à
   * `machineHourlyCost`. Trois champs sur cent mille documents : 2,7 à 4,9 heures.
   *
   * Se tromper de colonne de prix sur son propre produit est la faute qu'un acheteur
   * remarquerait en premier, et elle rendait notre offre plus chère qu'elle n'est.
   */
  /*
   * ─── D'OÙ VIENNENT CES DEUX LATENCES, DANS LE CODE ET NON DANS UN COMMENTAIRE ───
   *
   * Elles étaient écrites `{ small: 32, large: 59 }` avec, à côté, un commentaire disant
   * « mesuré sur l'OFAC, 300 cas ». Un commentaire n'est pas une provenance : rien ne le
   * relie à un relevé, et rien ne tombe s'il devient faux.
   *
   * Ce qu'un lecteur du dépôt peut vérifier, et qui rend la réserve nécessaire : le relevé
   * scellé livré ici porte, par champ, 18 · 18 · 18 · 20 · 22 pour `small` et
   * 43 · 45 · 45 · 45 · 48 pour `large`. **Aucune des deux valeurs ci-dessous n'y
   * correspond** — ni un champ, ni la médiane, ni le maximum. Elles viennent d'un corpus
   * externe qui n'est pas versionné ici, donc personne ne peut les contrôler depuis ce
   * dépôt.
   *
   * La valeur n'est pas changée ici : la déplacer déplacerait des montants dans un document
   * commercial, et c'est une décision, pas une maintenance. Ce qui change, c'est que la
   * provenance est désormais une donnée — datée, nommée, et marquée non dérivable — et
   * qu'elle VOYAGE avec le chiffre jusque dans le document.
   */
  const LATENCE_RATTRAPAGE = {
    small: 32,
    large: 59,
    /** Le jour où elle a cessé d'être une mesure pour devenir une hypothèse qu'on garde. */
    geleeLe: "2026-08-20",
    /** Ce qui manque pour la re-dériver, nommé : « non dérivable » seul ne dit pas quoi faire. */
    corpusAbsent: "OFAC SDN list is not shipped here",
    /** Vrai le jour où ces deux valeurs se lisent dans un relevé d'ici. Pas aujourd'hui. */
    derivableIci: false,
  } as const;
  const msParChamp = { small: LATENCE_RATTRAPAGE.small, large: LATENCE_RATTRAPAGE.large };
  const coutRattrapage = (ms: number) =>
    Math.round(3 * ASSUMPTIONS.volume * ms / 1000 / 3600 * ASSUMPTIONS.machineHourlyCost);
  w(`distribution those three fields fall back to a measured tier. That is machine time on the`);
  w(`client's own hardware, not a provider fee — ${symboleDe(UNITS.budget)}${coutRattrapage(msParChamp.small)} to`);
  w(`${symboleDe(UNITS.budget)}${coutRattrapage(msParChamp.large)} per period at the declared volume,`);
  /*
   * UNE SEULE SOURCE POUR UNE SEULE GRANDEUR.
   *
   * Cette ligne portait `${Math.round(191)}` — un littéral enveloppé dans un arrondi, ce qui
   * le faisait tenir visuellement dans la même famille que les deux montants dérivés juste
   * au-dessus. Vingt lignes plus bas, la MÊME grandeur s'écrit `${euro(s.cost)}`, elle
   * dérivée du relevé. Les deux rendaient `$191`, donc rien ne se voyait — jusqu'au jour où
   * `s.cost` bouge : une ligne suivrait, l'autre resterait, et `--check` figerait la
   * contradiction comme référence.
   *
   * `euro(s.cost)` rend exactement ce que le littéral rendait aujourd'hui : le document
   * publié ne bouge pas d'un caractère. Ce qui change, c'est qu'il ne PEUT plus diverger.
   */
  w(`against a published ${euro(s.cost)} for the whole routing.`);
  w(``);
  w(`The two amounts above rest on a **frozen assumption, not a measurement**: the `);
  w(`per-field latencies behind them were fixed on ${LATENCE_RATTRAPAGE.geleeLe} and are `);
  w(`**not re-measurable from this repository**: the ${LATENCE_RATTRAPAGE.corpusAbsent}. `);
  w(`Every other figure in this document derives from the sealed record shipped with it; `);
  w(`these two do not, and you cannot check them here.`);
  w(``);
  w(`This is disclosed rather than corrected, because widening either the rule or the corpus`);
  w(`moves the headline figure, and that is a decision rather than maintenance.`);
  w(``);
  w(`The interval is **Wilson**, not Wald. The distinction matters at the extremes, which is`);
  w(`where per-record rates live: Wald leaves [0, 1] near 0 % or 100 % and narrows wrongly on`);
  w(`a small sample — an interval that is too tight makes a difference look real when it is`);
  w(`not, and this table decides on exactly that. Wilson stays inside the bounds and widens`);
  w(`correctly: 0 of 20 gives [0 – 16.1 %], and 20 of 20 gives [83.9 % – 100 %]. Both values`);
  w(`are pinned in the suite, so no change can move them without saying so.`);
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

  /*
   * LE CHIFFRE QUE LE RELECTEUR SIGNE DOIT ETRE DANS L'UNITE QU'IL CLASSE.
   *
   * Ce paragraphe annoncait la moyenne de cinq taux par champ, dans le document qu'une
   * personne signe de son nom. Or elle ne classe pas des champs : elle classe des dossiers,
   * et un dossier n'est complet que si les cinq champs sont justes ENSEMBLE — 76,7 %, pas
   * 94,4 %. Omettre ce chiffre-la ne se lit pas comme une omission : ca se lit comme si la
   * question ne se posait pas.
   *
   * Et c'est le plus defendable des deux : une vraie proportion, donc un intervalle de
   * Wilson legitime, la ou la moyenne de cinq taux mesures sur cinq echantillons n'en porte
   * aucun. Le dire ici sert le relecteur, pas nous.
   */
  const parDossier = (() => {
    const chemin = fileURLToPath(new URL("../document.json", import.meta.url));
    if (!existsSync(chemin)) return null;
    return JSON.parse(readFileSync(chemin, "utf8")) as {
      publie: { complets: number; n: number }; vise: { complets: number; n: number; cost: number };
      identiques: boolean; apparie: { gains: number; regressions: number; discordant: number };
    };
  })();
  w(``);
  if (parDossier) {
    const t = rate(parDossier.publie.complets, parDossier.publie.n);
    w(`**Per record, which is the unit that gets filed: ${writeRate(t)}.** A record counts as`);
    w(`complete only when all ${FIELDS.length} fields are right together —`);
    w(`${parDossier.publie.complets} of ${parDossier.publie.n}. This is a true proportion and`);
    w(`carries an interval; the ${pc(s.accuracy)} above is a mean of ${FIELDS.length} rates measured on`);
    w(`different samples and carries none, which is why this file does not give it one.`);
    if (!parDossier.identiques) {
      w(``);
      w(`A routing that optimises for complete records rather than the mean per field delivers`);
      w(`${parDossier.vise.complets} of ${parDossier.vise.n} for ${euro(parDossier.vise.cost)}, worse on no record in this`);
      w(`sample. On ${parDossier.apparie.discordant} discordant pairs the sample cannot separate the two rates, so`);
      w(`what it establishes is the cost and not the accuracy. It is not the recommendation above,`);
      w(`and the difference is stated here rather than left for a reader to find.`);
    }
  } else {
    w(`**Per record: not computed here.** The delivered profile does not carry per-case`);
    w(`outcomes for every chosen cell, and a per-record rate over four fields instead of`);
    w(`${FIELDS.length} would be wrong in the one direction that flatters this report. Restore document.json with \`git checkout document.json\`.`);
  }

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
  /* Les trois chiffres du point 3 sont MESURÉS ici, pas tapés : le plancher de bruit dépend
     du corpus, et un corpus qui bouge doit déplacer la phrase qui justifie le refus. */
  const SEUiL = String(SEUIL_DE_L_INDUSTRIE);
  const floor120 = plancherDeBruit("heldout", 120).toFixed(3);
  const floorMin = plancherDeBruit("heldout", OBSERVATIONS_MINIMALES).toFixed(3);

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
  w(`   \`npm run diff <before> <after>\` compares two sealed runs case by case, and refuses`);
  w(`   the comparison — naming the cell and the reason — rather than returning a zero it`);
  w(`   cannot support.`);
  w(`3. **Watch the input distribution, not only the output.** Accuracy falls after the`);
  w(`   population has already moved, which makes it the last indicator to react.`);
  w(`   \`npm run entree\` computes a population stability index on the documents alone — no`);
  w(`   labels, so it runs where no ground truth exists, which is production. It reports that`);
  w(`   index next to its own noise floor: what the same sample size produces on a population`);
  w(`   that has **not** moved. An index below the floor is a draw, not a drift, and the floor`);
  w(`   is what decides whether the ${SEUiL} threshold means anything at that sample size — on`);
  w(`   this corpus it is ${floor120} at 120 observations, which is above the threshold, and`);
  w(`   ${floorMin} at ${OBSERVATIONS_MINIMALES}, which is below it. That is why the tool`);
  w(`   refuses to read under ${OBSERVATIONS_MINIMALES}: any smaller and the threshold fires`);
  w(`   on a population that never moved.`);

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
  /*
   * L'ÉTAGE DE LECTURE MANQUAIT À CE DOSSIER, ET C'EST LE DÉFAUT LE PLUS SÉRIEUX QU'IL AIT EU.
   *
   * Tout ce qui précède est mesuré sur du TEXTE. Un relecteur qui signe ne pouvait pas
   * savoir que les documents d'un client arrivent en IMAGES, ni ce que cette marche coûte —
   * or elle coûte, et sur un palier elle sort du bruit. Une omission dans un fichier de
   * validation ne se lit pas comme une omission : elle se lit comme « ce n'est pas un sujet ».
   *
   * Le chiffre est repris du relevé, jamais retapé : s'il n'existe pas, la phrase le dit au
   * lieu d'affirmer un coût qu'on n'a pas mesuré.
   */
  const lecture = (() => {
    const chemin = fileURLToPath(new URL("../ocr.json", import.meta.url));
    if (!existsSync(chemin)) {
      return `- **Not that these rates survive a scan.** Everything above is measured on text. `
        + `Your documents arrive as images, and the reading stage between the two has not been `
        + `measured on this machine — run \`npm run ocr\`. An unmeasured step is not a free one.`;
    }
    const r = JSON.parse(readFileSync(chemin, "utf8")) as {
      documents: number;
      fideliteDeLaTranscription: { taux: number };
      paliers: { palier: string; ecartEnPoints: number; separable: boolean }[];
    };
    const perdants = r.paliers.filter((x) => x.separable && x.ecartEnPoints > 0);
    const chiffre = perdants.length === 0
      ? `no tier lost a distinguishable amount on ${r.documents} rendered documents`
      : perdants.map((x) => `\`${x.palier}\` gives up ${x.ecartEnPoints.toFixed(1)} points`).join(", ");
    return `- **Not that these rates survive a scan.** Everything above is measured on text. `
      + `The same documents read back from images through the operating system's OCR recover `
      + `${(r.fideliteDeLaTranscription.taux * 100).toFixed(1)} % of words, and ${chiffre}. `
      + `Those images are rendered rather than photographed, so that gap is a floor: a `
      + `photographed page brings columns, skew and reading order that these do not.`;
  })();
  w(lecture);
  w(``);
  w(`---`);
  w(``);
  /* LES SOURCES SE NOMMENT TOUTES. Cette ligne disait `data/profiles.json` seul ; depuis que
     le §7 porte l'étage de lecture, elle lisait aussi `ocr.json` sans le dire. Un document qui
     se trompe sur ses propres sources apprend au relecteur à ne pas les croire. */
  const sources = ["`data/profiles.json`"];
  if (existsSync(fileURLToPath(new URL("../ocr.json", import.meta.url)))) sources.push("`ocr.json`");
  w(`*Generated by \`npm run dossier\` from ${sources.join(" and ")}. Regenerating it after any`);
  w(`re-measurement is the only supported way to keep it true.*`);
  w(``);
  return out.join("\n");
}

if (isMain(import.meta)) {

  refuserDrapeauxInconnus(["--check"]);
  const p = readProfiles();
  if (!p) {
    console.error("No frozen profile. Run `npm run measure` first.");
    process.exit(1);
  }
  const texte = dossier(p, ASSUMPTIONS);

  /*
   * `--check`, ET IL MANQUAIT AU SEUL DOCUMENT QUE L'ACHETEUR OUVRE POUR VÉRIFIER.
   *
   * `npm test` lançait `readme.ts --check` et `landing.ts --check`. Pas celui-ci. Le dossier
   * signé — celui qui porte les obligations de §6 et les aveux de §7 — pouvait donc dériver
   * du relevé sans que rien ne proteste : trente-quatre taux engendrés, aucun vérifié.
   *
   * Il était à jour le jour où on l'a regardé, ce qui est exactement le problème : rien ne
   * garantissait qu'il le reste, et un document juste par chance est indiscernable d'un
   * document juste par construction — jusqu'au jour où il ne l'est plus.
   *
   * Même formulation de refus que les deux autres : on nomme le fichier, on dit la commande
   * qui répare, et on sort en erreur pour que la porte le voie.
   */
  if (process.argv.includes("--check")) {
    const surDisque = existsSync(FICHIER) ? readFileSync(FICHIER, "utf8") : "";
    if (surDisque === texte) {
      console.log(`VALIDATION.md is up to date — from the measurement of ${p.measuredAt}.`);
      process.exit(0);
    }
    console.error(`VALIDATION.md is stale — it no longer matches the frozen profile.`);
    console.error(`  Run: npm run dossier`);
    process.exit(1);
  }

  writeFileSync(FICHIER, texte);
  console.log(`\nValidation file written to VALIDATION.md — ${texte.split("\n").length} lines,`
    + ` from the measurement of ${p.measuredAt}.\n`);
}
