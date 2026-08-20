/**
 * La source unique des chiffres qu'une page publiée affiche.
 *
 * Une page de vente a été écrite sans accès au dépôt, avec des valeurs « illustratives ».
 * Quatre d'entre elles étaient fausses, deux dans le sens qui flattait l'offre. Recopier des
 * chiffres à la main est la façon la plus fiable de publier un relevé périmé : la mesure
 * bouge, la page ne bouge pas, et rien ne lève.
 *
 * Ce fichier retire l'étape manuelle. Il ne calcule rien de neuf — il transcrit le profil
 * gelé et le routage que `optimise.ts` en tire, avec, pour chaque nombre, d'où il vient.
 *
 * `--check` est la moitié qui compte, exactement comme pour `figures.ts` : il n'écrit pas et
 * sort en erreur quand le fichier ne correspond plus au relevé. Il tourne dans `npm test`,
 * donc dans la CI, donc on ne peut pas l'oublier — un contrôle qu'on oublie ne vaut pas
 * mieux que le fichier statique qu'il remplace.
 *
 * Deux règles tenues par la forme du fichier plutôt que par la vigilance :
 *
 *   1. Rien d'inventé. Ce qui n'est pas mesuré vaut `null`, jamais une valeur par défaut.
 *   2. Chaque coût porte sa provenance. Aucun prix de ce dépôt n'est mesuré, et une page
 *      qui les affiche à côté d'exactitudes mesurées doit dire lesquels sont lesquels.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { isMain } from "./cli.ts";
import { FIELDS } from "./corpus.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS, UNITS, pricePerThousandExtractions, latency } from "./assumptions.ts";
import { optimiseExtraction, evaluer, paliersMesures, pricePerThousandDocuments, justessePonderee } from "./optimise.ts";
import { rate, CONFIANCE, distinguishable, pairedVerdict } from "./interval.ts";

import type { Field } from "./corpus.ts";
import type { TierName } from "./paliers.ts";
import type { Routing } from "./optimise.ts";
import type { Profiles } from "./measure.ts";
import type { Provenance } from "./provenance.ts";
import type { Assumptions } from "./assumptions.ts";

const SORTIE = new URL("../landing.json", import.meta.url).pathname;

/** Un nombre, et d'où il vient. Jamais l'un sans l'autre sur une page publiée. */
type Chiffre = { value: number | null; provenance: Provenance; basis: string };

/** Une exactitude mesurée, avec son intervalle et son échantillon. */
type Exactitude = {
  accuracy: number | null;
  low: number | null;
  high: number | null;
  n: number;
  provenance: Provenance | null;
  note?: string;
};

/**
 * Ce que le palier `human` doit afficher, et pourquoi ce n'est pas 100 %.
 *
 * Dans le corpus, ce palier renvoie la vérité terrain : sa « justesse » est une tautologie,
 * pas une mesure. La valeur dont l'optimiseur se sert est l'hypothèse `humanAccuracy`, et
 * les deux ne doivent jamais apparaître sous la même étiquette.
 */
const HUMAIN_NON_MESURE = "ce palier renvoie la vérité terrain du corpus : sa justesse est une "
  + "tautologie, pas une mesure. La valeur utilisée par l'optimiseur est l'hypothèse "
  + "`humanAccuracy`, reportée sous `assumptions`.";

function exactitude(p: Profiles, tier: TierName, champ: Field): Exactitude {
  const profil = p.extraction[tier][champ];
  if (tier === "human") {
    return { accuracy: null, low: null, high: null, n: profil.items, provenance: null, note: HUMAIN_NON_MESURE };
  }
  const r = rate(Math.round(profil.accuracy * profil.items), profil.items);
  const pc = (x: number) => Number((100 * x).toFixed(1));
  return { accuracy: pc(r.rate), low: pc(r.low), high: pc(r.high), n: r.n, provenance: "measured" };
}

/** Le coût d'un millier de **documents** — cinq champs chacun — et sa provenance réelle. */
function cout(p: Profiles, tier: TierName): Chiffre {
  const value = Number(pricePerThousandDocuments(p, ASSUMPTIONS, tier).toFixed(4));
  if (tier === "rules") {
    return { value, provenance: "chosen", basis: "les règles n'appellent rien : zéro par construction, pas par mesure" };
  }
  if (tier === "small" || tier === "large") {
    return { value, provenance: "assumed", basis: "tarif à l'appel supposé, × les cinq champs d'un document" };
  }
  if (tier === "human") {
    return { value, provenance: "assumed", basis: "temps supposé par élément × coût analyste supposé, × les cinq champs" };
  }
  return { value, provenance: "assumed", basis: "latence mesurée × tarif machine supposé, sommée sur les cinq champs" };
}

/** Les trois percentiles de latence d'un palier, sommés sur les cinq champs d'un document. */
type Dispersion = { p10: number; median: number; p90: number };

/**
 * La dispersion de latence, parce qu'une médiane ne dit pas ce qui arrive les mauvais jours.
 *
 * Le plafond est par document, donc les percentiles sont sommés sur les cinq champs : c'est le
 * niveau auquel la contrainte s'applique et le seul auquel la comparaison ait un sens.
 *
 * `null` dès que la valeur ne mesure pas ce que son nom prétend — qu'elle existe ou non. Le
 * palier `human` en est le cas intéressant : son relevé **porte** des percentiles, de l'ordre du
 * millième de milliseconde, mais ce sont ceux d'une lecture de la vérité terrain et non d'un
 * travail. L'optimiseur ne s'en sert jamais : il substitue l'hypothèse `humanSeconds`. Publier
 * ces trois nombres serait publier les percentiles d'une tautologie — pire qu'un trou, parce
 * qu'un trou se voit et qu'un chiffre faux se cite.
 */
function dispersion(p: Profiles, tier: TierName): Dispersion | null {
  if (tier === "human") return null;
  const parChamp = p.extraction[tier];
  if (!parChamp) return null;
  const somme = (cle: "latencyP10" | "latency" | "latencyP90") =>
    FIELDS.reduce((s, c) => s + (parChamp[c]?.[cle] ?? NaN), 0);
  const [p10, median, p90] = [somme("latencyP10"), somme("latency"), somme("latencyP90")];
  if (![p10, median, p90].every(Number.isFinite)) return null;   // percentiles absents du relevé
  const r1 = (x: number) => Number(x.toFixed(1));
  return { p10: r1(p10), median: r1(median), p90: r1(p90) };
}

type Deplacement = { field: Field; from: TierName; to: TierName };
type Seuil = {
  inUse: number;
  /** L'unité de `inUse` et de `breaksAt`. Publiée pour que la page n'ait jamais à la deviner. */
  unit: string;
  breaksAt: number | null;
  factor: number | null;
  moves: Deplacement[];
  reason: "moves the routing" | "tier not selected" | "tier priced out" | "genuinely insensitive";
};

/**
 * Jusqu'où chaque prix peut bouger avant que la recommandation change.
 *
 * « Nos prix sont des hypothèses » est une phrase honnête et inutilisable : elle ne dit pas si
 * la conclusion y survit. Ce bloc répond par un nombre — le grand modèle peut coûter vingt-cinq
 * fois son tarif supposé avant que le routage bouge — et un lecteur peut confronter ce nombre à
 * sa propre facture, ce qu'aucune bande de plausibilité ne permet.
 *
 * Le seuil est cherché par dichotomie plutôt que lu dans une table : une table se fige, et on a
 * mesuré qu'un de ces seuils perd un tiers de sa valeur en une journée sans qu'aucun prix ni
 * aucun modèle ne change — seulement les latences, dont dépend le prix des paliers locaux.
 *
 * ─── Les trois raisons de n'avoir aucun seuil, et pourquoi elles ne se confondent pas ───
 *
 * Un `null` sans sa raison se lit « robuste », et c'est faux deux fois sur trois.
 *
 *   moves the routing — un seuil existe, il est chiffré.
 *   tier not selected — le palier tarifé n'est dans aucun champ du routage, donc son prix
 *                       n'entre jamais dans le calcul. Ce n'est pas de la robustesse, c'est
 *                       une absence.
 *   tier priced out   — le palier est retenu nulle part parce qu'il dépasse le budget à ce
 *                       volume. Il dominerait à un volume dix fois moindre, et un lecteur dont
 *                       le volume diffère doit aller regarder là.
 */
function seuils(p: Profiles, h: Assumptions): Record<string, Seuil> {
  const paliers = paliersMesures(p);
  const base = optimiseExtraction(p, h);
  const out: Record<string, Seuil> = {};
  if (base === null) return out;
  const reference = FIELDS.map((c) => base.routing[c]);

  const identique = (essai: Assumptions) => {
    const s = optimiseExtraction(p, essai);
    return s !== null && FIELDS.every((c, i) => s.routing[c] === reference[i]);
  };

  for (const cle of Object.keys(h) as (keyof Assumptions)[]) {
    const v0 = h[cle] as number;
    /*
     * Ce qui mérite d'être balayé : tout ce qui change ce que l'optimiseur voit d'un palier.
     *
     * La règle ne dit plus « tarife un palier » mais « déplace une des trois entrées du
     * routage » — prix, justesse pesée, latence. La première version ratait les deux coûts
     * d'erreur : ils ne tarifent rien, ils pèsent les échecs, et ils décident pourtant. Une
     * règle trop étroite ne se voit pas, elle produit simplement un balayage plus court que
     * la réalité, avec le même air de complétude.
     */
    const double = { ...h, [cle]: v0 * 2 };
    const tarifes = paliers.filter((t) =>
      pricePerThousandDocuments(p, double, t) !== pricePerThousandDocuments(p, h, t)
      || FIELDS.some((c) => justessePonderee(p, double, t, c) !== justessePonderee(p, h, t, c))
      || FIELDS.some((c) => latency(t, p.extraction[t][c].latency, double) !== latency(t, p.extraction[t][c].latency, h)));
    if (tarifes.length === 0) continue;

    let bas = v0 === 0 ? 1e-9 : v0;
    let haut = v0 * 1e7;
    if (identique({ ...h, [cle]: haut })) {
      /*
       * Aucun seuil : reste à dire laquelle des **trois** absences c'est.
       *
       * Cette classification n'en connaissait que deux, alors que `sensitivity.ts` en connaît
       * trois depuis ce soir — et les deux fichiers ont aussitôt divergé sur le premier cas
       * venu : le coût d'un champ vide, rapporté ici « palier jamais choisi » alors que
       * `rules` produit les vides et se trouve dans trois champs du routage. Un palier
       * gouverné qui est **en usage** et que le balayage ne déplace pas, c'est de la vraie
       * robustesse, et c'est la seule des trois qui mérite d'être lue comme rassurante.
       */
      const retenus = new Set(FIELDS.map((c) => base.routing[c]));
      const enUsage = tarifes.some((t) => retenus.has(t));
      const horsBudget = tarifes.every((t) =>
        (pricePerThousandDocuments(p, h, t) * h.volume) / 1000 > h.budget);
      out[cle] = { inUse: v0, unit: UNITS[cle], breaksAt: null, factor: null, moves: [],
        reason: enUsage ? "genuinely insensitive" : horsBudget ? "tier priced out" : "tier not selected" };
      continue;
    }
    /*
     * Quarante pas, pas deux cents.
     *
     * Chaque pas coûte une énumération complète des routages. Deux cents pas donnaient une
     * précision de l'ordre du dix-millionième de ce qu'on publie à quatre chiffres — cent
     * soixante pas dépensés sous le dernier chiffre affiché. Quarante suffisent largement à
     * une valeur arrondie à `toPrecision(4)`, et l'invariant qui suit vérifie de toute façon
     * que le nombre publié encadre une vraie bascule.
     */
    for (let i = 0; i < 40; i++) {
      const m = (bas + haut) / 2;
      if (identique({ ...h, [cle]: m })) bas = m; else haut = m;
    }
    const apres = optimiseExtraction(p, { ...h, [cle]: haut })!;
    out[cle] = {
      inUse: v0,
      unit: UNITS[cle],
      breaksAt: Number(haut.toPrecision(4)),
      factor: Number((haut / v0).toPrecision(3)),
      moves: FIELDS.filter((c) => apres.routing[c] !== base.routing[c])
        .map((c) => ({ field: c, from: base.routing[c], to: apres.routing[c] })),
      reason: "moves the routing",
    };
  }
  return out;
}

/**
 * Les trois chiffres qui voyageaient à la main sous un nom qui avait l'air calculé.
 *
 * Ils étaient exacts et invérifiables : recalculés une fois, recopiés dans une page, puis
 * figés — donc muets à la prochaine mesure, et personne pour le dire. Un audit croisé les a
 * trouvés parce qu'ils ressemblaient à toutes les autres clés vues du côté qui les consomme.
 *
 * Ils se dérivent entièrement de `reussites` et `sorties` : un bit dit l'échec, une sortie
 * vide dit lequel des deux échecs c'était. Aucun scoreur n'est rejoué ici — la vérité terrain
 * a servi au moment de la mesure, et la relire ferait entrer un runtime de modèles dans un
 * générateur qui n'a besoin que d'arithmétique.
 */
function decomposeErreurs(p: Profiles, routing: Routing) {
  const perThousand: Record<string, { tier: TierName; blank: number | null; wrong: number | null }> = {};
  let couverts = 0;
  for (const c of FIELDS) {
    const t = routing[c];
    const q = p.extraction[t][c];
    if (!q.sorties || !q.reussites || q.reussites.length !== q.sorties.length) {
      perThousand[c] = { tier: t, blank: null, wrong: null };
      continue;
    }
    couverts++;
    let vide = 0, faux = 0;
    for (let i = 0; i < q.sorties.length; i++) {
      if (q.reussites[i] === "1") continue;
      if ((q.sorties[i] ?? "").trim() === "") vide++; else faux++;
    }
    const n = q.sorties.length;
    perThousand[c] = { tier: t, blank: Math.round((1000 * vide) / n), wrong: Math.round((1000 * faux) / n) };
  }
  return { perThousand, coverage: { fields: couverts, of: FIELDS.length } };
}

/**
 * Le taux de dossiers entièrement propres — le chiffre de l'acheteur.
 *
 * Une moyenne de cinq taux par champ n'est pas le taux auquel un dossier sort sans humain.
 * Il se compte sur les cas où **les cinq** champs sont bons à la fois, donc sur l'intersection
 * des échantillons : un palier mesuré sur cent vingt cas plafonne le compte, et c'est dit.
 */
function dossiersPropres(p: Profiles, routing: Routing) {
  const n = Math.min(...FIELDS.map((c) => p.extraction[routing[c]][c].items));
  if (!FIELDS.every((c) => p.extraction[routing[c]][c].reussites)) return null;
  let propres = 0;
  for (let i = 0; i < n; i++) {
    if (FIELDS.every((c) => p.extraction[routing[c]][c].reussites![i] === "1")) propres++;
  }
  const r = rate(propres, n);
  const pc = (x: number) => Number((100 * x).toFixed(1));
  return { pct: pc(r.rate), lo: pc(r.low), hi: pc(r.high), n, clean: propres };
}

/**
 * Ce que le test apparié tranche que le recouvrement d'intervalles laissait flou.
 *
 * Le compte seul ne suffisait pas. La page écrivait « quatre verdicts déplacés, chacun d'eux
 * contre `gen-0.6b` » à partir d'un `{pairs, flipped}` qui ne portait que deux nombres : la
 * seconde moitié de la phrase était vraie et invérifiable, ce qui est la forme même du défaut
 * qu'on vient de retirer ailleurs. Un résumé qui ne soutient pas la prose qu'il sert est un
 * résumé de trop.
 *
 * Chaque verdict déplacé sort donc avec son champ, ses deux paliers, et le compte des cas où
 * chacun l'emporte — ce dernier étant ce qui rend la conclusion lisible : zéro victoire d'un
 * côté ne se lit pas comme un écart serré.
 */
function egalitesTranchees(p: Profiles) {
  const T = paliersMesures(p).filter((t) => t !== "human");
  const details: { field: Field; a: TierName; b: TierName; aWins: number; bWins: number }[] = [];
  let pairs = 0, flipped = 0;
  for (const c of FIELDS) {
    for (let i = 0; i < T.length; i++) {
      for (let j = i + 1; j < T.length; j++) {
        const a = p.extraction[T[i]!][c], b = p.extraction[T[j]!][c];
        if (!a.reussites || !b.reussites || a.reussites.length !== b.reussites.length) continue;
        pairs++;
        let g = 0, pe = 0;
        for (let k = 0; k < a.reussites.length; k++) {
          const x = a.reussites[k] === "1", y = b.reussites[k] === "1";
          if (x && !y) g++; else if (y && !x) pe++;
        }
        const flou = !distinguishable(rate(Math.round(a.accuracy * a.items), a.items),
          rate(Math.round(b.accuracy * b.items), b.items));
        if (flou && pairedVerdict(g, pe).decidable) {
          flipped++;
          details.push({ field: c, a: T[i]!, b: T[j]!, aWins: g, bWins: pe });
        }
      }
    }
  }
  return { test: "McNemar", pairs, flipped, decided: details };
}

export function construire(p: Profiles): unknown {
  const paliers = paliersMesures(p);
  const optimum = optimiseExtraction(p, ASSUMPTIONS);

  return {
    $comment: "Généré par `npm run landing` depuis data/profiles.json. Ne pas éditer à la main : "
      + "`npm test` échoue si ce fichier ne correspond plus au relevé.",
    generatedFrom: {
      /* Le fichier entier — la date de sa dernière écriture, et le code de la dernière passe. */
      measuredAt: p.measuredAt,
      commit: p.code?.commit ?? null,
      treeDirty: p.code?.sale ?? null,
      /*
       * Et la provenance réelle, palier par palier.
       *
       * Les clés ci-dessus décrivent une passe ; le fichier est le produit de plusieurs. Un
       * palier mesuré avant que cette provenance existe vaut `null` — on ne reconstitue pas
       * ce qui n'a jamais été écrit, et un `null` visible vaut mieux qu'une date empruntée
       * au voisin.
       */
      /*
       * Traduit vers les clés publiques, et `externalBefore` seul.
       *
       * `totalDuring` reste au relevé et ne monte pas ici : il inclut le travail mesuré, donc
       * un lecteur le prendrait pour une contamination là où il n'y a qu'un encodeur qui
       * sature les cœurs. Ce qu'une page peut affirmer, c'est ce que la machine faisait
       * **par ailleurs**.
       */
      /*
       * La charge de passe, ou son équivalent démontrable.
       *
       * Les relevés antérieurs à ce champ n'ont pas de valeur enregistrée — mais le palier
       * mesuré **en premier** porte exactement la même chose dans son `externalBefore` :
       * rien de cette passe n'avait encore tourné avant lui. Ce n'est pas une estimation,
       * c'est la même grandeur lue ailleurs, et le repli le dit plutôt que de le supposer.
       */
      loadBeforePass: (() => {
        if (p.chargeAvantPasse) {
          return { loadAvg: p.chargeAvantPasse.externalBefore, cores: p.chargeAvantPasse.coeurs, from: "pass" };
        }
        const premiers = paliersMesures(p)
          .map((t) => p.provenance?.[t])
          .filter((v): v is NonNullable<typeof v> => Boolean(v?.latency?.charge))
          .sort((a, b) => a.latency.measuredAt.localeCompare(b.latency.measuredAt));
        const c = premiers[0]?.latency.charge;
        return c ? { loadAvg: c.externalBefore, cores: c.coeurs, from: "first tier measured" } : null;
      })(),
      perTier: Object.fromEntries(paliersMesures(p).map((t) => {
        const v = p.provenance?.[t];
        if (!v?.accuracy) return [t, null];
        const bloc = (b: typeof v.accuracy) => ({
          commit: b.commit, treeDirty: b.sale, measuredAt: b.measuredAt,
          ...(b.charge ? { loadAvg: b.charge.externalBefore, cores: b.charge.coeurs } : {}),
        });
        return [t, { accuracy: bloc(v.accuracy), latency: bloc(v.latency) }];
      })),
    },
    confidence: { level: CONFIANCE.niveau, method: "Wilson" },
    fields: FIELDS,
    /* L'unité, écrite une fois, parce qu'elle a déjà fait publier un chiffre faux. */
    costUnit: "par millier de documents ; un document porte les cinq champs",
    tiers: paliers.map((t) => ({
      id: t,
      n: p.extraction[t][FIELDS[0]!].items,
      costPerThousandDocuments: cout(p, t),
      costPerThousandExtractions: {
        value: Number(pricePerThousandExtractions(t, ASSUMPTIONS,
          p.extraction[t][FIELDS[0]!].latency).toFixed(4)),
        provenance: cout(p, t).provenance,
        basis: "un cinquième d'un document — ne jamais afficher ce nombre sous « par document »",
      },
      acc: Object.fromEntries(FIELDS.map((c) => [c, exactitude(p, t, c)])),
    })),
    routing: optimum === null ? null : {
      fields: optimum.routing,
      accuracy: Number((100 * optimum.accuracy).toFixed(1)),
      costPerThousandDocuments: Number((optimum.cost / ASSUMPTIONS.volume * 1000).toFixed(4)),
      latencyMsPerDocument: Number(optimum.latencyPerItem.toFixed(0)),
      budgetShare: Number(optimum.budgetShare.toFixed(4)),
      latencyShare: Number(optimum.latencyShare.toFixed(4)),
      provenance: "measured" as Provenance,
      basis: "routage calculé par `optimiseExtraction` sur le relevé gelé, sous le budget et "
        + "le plafond de latence supposés ci-dessous",
    },
    /*
     * Le comparateur, sans lequel le coût du routage ne veut rien dire.
     *
     * « 1,93 $ par millier de documents » ne se lit pas seul : il se lit contre ce que
     * coûterait le même travail confié à un seul palier. Une page qui choisit son
     * comparateur au hasard peut faire dire n'importe quoi à l'écart — et le comparateur
     * flatteur est celui qu'on prend sans y penser.
     *
     * `admissible` est la colonne qui tranche : un palier unique qui dépasse le budget ou le
     * plafond de latence n'est pas une alternative moins bonne, c'est une alternative qui
     * n'existe pas. Publier le routage comme « moins cher que gen-8b » alors que gen-8b
     * consomme près de quatre fois le budget de temps compare à quelque chose d'impossible.
     */
    singleTierBaselines: paliers.map((t) => {
      const s = evaluer(p, ASSUMPTIONS, Object.fromEntries(FIELDS.map((c) => [c, t])) as Record<Field, TierName>);
      return {
        id: t,
        accuracy: Number((100 * s.accuracy).toFixed(1)),
        accuracyProvenance: (t === "human" ? "assumed" : "measured") as Provenance,
        costPerThousandDocuments: Number((s.cost / ASSUMPTIONS.volume * 1000).toFixed(4)),
        latencyMsPerDocument: Number(s.latencyPerItem.toFixed(0)),
        budgetShare: Number(s.budgetShare.toFixed(4)),
        latencyShare: Number(s.latencyShare.toFixed(4)),
        admissible: s.cost <= ASSUMPTIONS.budget && s.latencyPerItem <= ASSUMPTIONS.latencyBudgetMs,
      };
    }),

    latencySpread: {
      perDoc: Object.fromEntries(paliers.map((t) => [t, dispersion(p, t)])),
      routed: optimum === null ? null : (() => {
        const somme = (cle: "latencyP10" | "latency" | "latencyP90") =>
          FIELDS.reduce((s, c) => s + p.extraction[optimum.routing[c]][c][cle], 0);
        const r1 = (x: number) => Number(x.toFixed(1));
        return { p10: r1(somme("latencyP10")), median: r1(somme("latency")), p90: r1(somme("latencyP90")) };
      })(),
      ceilingMsPerDoc: ASSUMPTIONS.latencyBudgetMs,
    },

    sensitivity: {
      measuredAt: p.measuredAt,
      method: "bisection",
      thresholds: seuils(p, ASSUMPTIONS),
      note: "Chaque hypothèse est balayée seule, les autres restant à leur valeur en usage : "
        + "deux prix qui bougent ensemble peuvent basculer le routage plus tôt qu'aucun des "
        + "deux séparément. Le balayage ne couvre que les entrées qui tarifent un palier — le "
        + "plafond de latence et le volume ne sont pas des prix et changent la réponse par "
        + "d'autres chemins.",
    },

    errorSplit: optimum === null ? null : decomposeErreurs(p, optimum.routing),
    cleanPerDocument: optimum === null ? null : dossiersPropres(p, optimum.routing),
    paired: egalitesTranchees(p),

    /* Les entrées que le lecteur remplace. Aucune n'est mesurée, et la page doit le dire. */
    assumptions: {
      humanAccuracy: ASSUMPTIONS.humanAccuracy,
      humanSeconds: ASSUMPTIONS.humanSeconds,
      analystAnnualCost: ASSUMPTIONS.analystAnnualCost,
      machineHourlyCost: ASSUMPTIONS.machineHourlyCost,
      pricePerThousandSmall: ASSUMPTIONS.pricePerThousandSmall,
      pricePerThousandLarge: ASSUMPTIONS.pricePerThousandLarge,
      volume: ASSUMPTIONS.volume,
      budget: ASSUMPTIONS.budget,
      latencyBudgetMs: ASSUMPTIONS.latencyBudgetMs,
      provenance: "assumed" as Provenance,
    },
    caveats: [
      "Le corpus est synthétique et écrit par l'auteur, sur une coupe held-out. Cela protège "
      + "contre l'auto-notation, pas contre l'écart avec de vrais documents.",
      "Les paliers ne sont pas mesurés au même n : les encodeurs sur l'échantillon complet, "
      + "les génératifs sur ses premiers cas seulement. Chaque chiffre porte son propre n.",
      "Aucun prix n'est mesuré. Tous sortent de `assumptions`, que le lecteur remplace.",
      "La latence est mesurée un élément à la fois sur une machine au repos ; rien ici ne dit "
      + "ce qu'elle devient sous charge.",
      "Ces chiffres sont ceux de la chaîne d'extraction. La chaîne de classification range les "
      + "paliers dans l'ordre inverse, ce qui interdit d'en tirer un classement général.",
      "Un routage expire : il est calculé sur des révisions épinglées et un échantillon figé. "
      + "Une dérive du trafic ou une mise à jour de modèle l'invalide sans lever d'erreur.",
    ],
  };
}

/**
 * Deux clés qui sortent du même relevé doivent dire la même chose.
 *
 * `routing.latencyMsPerDocument` vient de `optimiseExtraction` ; `latencySpread.routed.median`
 * resomme les cinq champs à la main. Si les deux divergent, l'une des deux est fausse et le
 * fichier ne doit pas exister — le générateur refuse d'écrire plutôt que de produire un fichier
 * que la page citerait.
 *
 * La comparaison se fait **à l'arrondi près** et non à l'identique : la clé publiée passe par
 * `toFixed(0)`, donc une égalité stricte tomberait en rouge sur du bruit de virgule. Un contrôle
 * qui échoue pour une raison qui n'est pas celle qu'il surveille finit désactivé, et c'est
 * comme ça qu'on perd un test.
 */
function verifierCoherence(vue: Record<string, unknown>): void {
  const routing = vue.routing as { latencyMsPerDocument: number } | null;
  const spread = (vue.latencySpread as { routed: { median: number } | null }).routed;
  if (routing === null || spread === null) return;
  if (Math.round(spread.median) !== Math.round(routing.latencyMsPerDocument)) {
    throw new Error(
      `landing.json serait incohérent : latencySpread.routed.median = ${spread.median} ms, `
      + `mais routing.latencyMsPerDocument = ${routing.latencyMsPerDocument} ms.\n`
      + `  → les deux somment les mêmes cinq champs du même relevé ; une divergence veut dire `
      + `qu'un des deux calculs est faux, et aucun des deux ne doit être publié.`);
  }
}

/**
 * Un seuil est une affirmation vérifiable, donc il se vérifie avant d'être publié.
 *
 * Deux bornes et non une. Qu'au seuil le routage change ne suffit pas : il faut aussi qu'en
 * dessous il soit encore celui de référence. Un seuil qui n'**encadre** pas la bascule est faux
 * même quand il tombe du bon côté — il annoncerait « ça tient jusqu'à ce prix » alors que ça a
 * cédé avant, ce qui est l'erreur exactement dans le sens qui rassure.
 *
 * ─── Pourquoi une tolérance, et pourquoi celle-là ───
 *
 * La première version comparait à la virgule près et refusait d'écrire un fichier pourtant
 * juste. `breaksAt` est publié à quatre chiffres significatifs : la valeur affichée tombe donc
 * à un cheveu au-dessus ou au-dessous du seuil réel, et exiger que ce décimal-là produise
 * exactement la bascule revient à contrôler l'arrondi et non le calcul.
 *
 * On vérifie donc ce que le lecteur peut vérifier : le nombre publié encadre une vraie bascule
 * **à sa propre précision**. Un pour mille de part et d'autre, soit dix fois le pas d'arrondi.
 * C'est la même leçon que la comparaison de `routed.median` : un contrôle qui échoue pour une
 * raison qui n'est pas celle qu'il surveille finit par être désactivé, et on perd alors ce
 * qu'il surveillait vraiment.
 *
 * Et le déplacement annoncé doit être celui qui se produit. `moves` est un tableau parce qu'un
 * seuil peut en déplacer plusieurs ; un format qui ne saurait représenter que le cas observé
 * forcerait un jour le générateur à mentir ou à refuser d'écrire pour une raison étrangère à ce
 * qu'il surveille.
 */
const MARGE = 1e-3;   // dix fois le pas d'arrondi de `toPrecision(4)`

function verifierSeuils(p: Profiles, vue: Record<string, unknown>): void {
  const bloc = vue.sensitivity as { thresholds: Record<string, {
    breaksAt: number | null; moves: { field: Field; from: TierName; to: TierName }[] }> };
  const base = optimiseExtraction(p, ASSUMPTIONS);
  if (base === null) return;

  for (const [cle, s] of Object.entries(bloc.thresholds)) {
    if (s.breaksAt === null) continue;
    const routageA = (v: number) => optimiseExtraction(p, { ...ASSUMPTIONS, [cle]: v });

    const au_dessus = routageA(s.breaksAt * (1 + MARGE));
    const change = au_dessus !== null && FIELDS.some((c) => au_dessus.routing[c] !== base.routing[c]);
    if (!change) {
      throw new Error(`seuil faux pour ${cle} : au-dessus de ${s.breaksAt} le routage ne change pas.\n`
        + `  → un seuil qui n'annonce aucune bascule ne devrait pas être publié.`);
    }

    const au_dessous = routageA(s.breaksAt * (1 - MARGE));
    const intact = au_dessous !== null && FIELDS.every((c) => au_dessous.routing[c] === base.routing[c]);
    if (!intact) {
      throw new Error(`seuil faux pour ${cle} : le routage a déjà changé avant ${s.breaksAt}.\n`
        + `  → le seuil n'encadre pas la bascule, donc il annonce une marge qui n'existe pas.`);
    }

    for (const m of s.moves) {
      if (au_dessus.routing[m.field] !== m.to || base.routing[m.field] !== m.from) {
        throw new Error(`seuil faux pour ${cle} : il annonce ${m.field} ${m.from}→${m.to}, `
          + `mais la bascule donne ${base.routing[m.field]}→${au_dessus.routing[m.field]}.`);
      }
    }
  }
}

export function rendre(p: Profiles): string {
  const vue = construire(p) as Record<string, unknown>;
  verifierCoherence(vue);
  verifierSeuils(p, vue);
  return JSON.stringify(vue, null, 2) + "\n";
}

if (isMain(import.meta)) {
  const check = process.argv.includes("--check");
  const p = readProfiles();

  if (!p) {
    console.error("aucun relevé dans data/profiles.json — lancer `npm run measure` d'abord.");
    process.exit(1);
  }

  const attendu = rendre(p);
  const actuel = existsSync(SORTIE) ? readFileSync(SORTIE, "utf8") : null;

  if (actuel === attendu) {
    console.log("landing.json is up to date.");
  } else if (check) {
    console.error("landing.json ne correspond plus au relevé gelé.");
    console.error(actuel === null
      ? "  - le fichier n'existe pas encore"
      : "  - son contenu diverge de ce que le code produit");
    console.error("\nRun: npm run landing");
    process.exit(1);
  } else {
    writeFileSync(SORTIE, attendu);
    console.log(actuel === null ? "landing.json created." : "landing.json updated.");
  }
}
