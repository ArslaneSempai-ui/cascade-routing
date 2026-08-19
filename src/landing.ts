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
import { ASSUMPTIONS, pricePerThousandExtractions } from "./assumptions.ts";
import { optimiseExtraction, evaluer, paliersMesures, pricePerThousandDocuments } from "./optimise.ts";
import { rate, CONFIANCE } from "./interval.ts";

import type { Field } from "./corpus.ts";
import type { TierName } from "./paliers.ts";
import type { Profiles } from "./measure.ts";
import type { Provenance } from "./provenance.ts";

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

export function construire(p: Profiles): unknown {
  const paliers = paliersMesures(p);
  const optimum = optimiseExtraction(p, ASSUMPTIONS);

  return {
    $comment: "Généré par `npm run landing` depuis data/profiles.json. Ne pas éditer à la main : "
      + "`npm test` échoue si ce fichier ne correspond plus au relevé.",
    generatedFrom: {
      measuredAt: p.measuredAt,
      commit: p.code?.commit ?? null,
      treeDirty: p.code?.sale ?? null,
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

export function rendre(p: Profiles): string {
  const vue = construire(p) as Record<string, unknown>;
  verifierCoherence(vue);
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
