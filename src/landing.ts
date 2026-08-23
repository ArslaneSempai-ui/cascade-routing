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

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { isMain } from "./cli.ts";
import { FIELDS } from "./corpus.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS, UNITS, pricePerThousandExtractions, latency } from "./assumptions.ts";
import { optimiseExtraction, evaluer, paliersMesures, pricePerThousandDocuments, justessePonderee, decompositionDe } from "./optimise.ts";
import { rate, CONFIANCE, distinguishable, pairedVerdict } from "./interval.ts";
import { versLeBas } from "./sensitivity.ts";
import { journaux, lireJournal, issue } from "./journal.ts";
import { lireDerivees, perime, FICHIER as FIGE } from "./derivees.ts";

/**
 * Ce que le dépôt a figé pour les blocs tirés des journaux.
 *
 * `data/` n'est pas versionné, donc un clone frais n'a pas les journaux. Sans ce fichier figé,
 * `landing.ts --check` régénérait des blocs `measured: false` chez lui et `measured: true` ici,
 * et la chaîne s'arrêtait sur un clone frais — un vert qui reposait sur des fichiers absents du
 * dépôt. Le figé fait foi ; les journaux ne servent qu'à le recalculer, par `npm run derivees`.
 */
const fige = (nom: string): unknown => lireDerivees()?.blocs?.[nom] ?? null;
import { normaliserReponse } from "./tiers.ts";
import { FORME } from "./signal.ts";
import { corpusDur } from "./corpus-dur.ts";

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
/** Le commit existe-t-il encore, et sinon où est passé son contenu ? */
function commitReecrit(commit: string | null) {
  if (!commit) return {};
  const f = new URL("../commits-reecrits.json", import.meta.url).pathname;
  if (!existsSync(f)) return {};
  const j = JSON.parse(readFileSync(f, "utf8")) as {
    entries: { missing: string; nowAt: string; establishedBy: string }[] };
  const e = j.entries.find((x) => x.missing === commit);
  return e ? { commitRewrittenTo: e.nowAt, commitMappingEstablishedBy: e.establishedBy } : {};
}

/**
 * Le premier commit où plusieurs formulations existent.
 *
 * Avant lui, `measure.ts` n'avait pas de sélection de prompt : une seule formulation pouvait
 * tourner, et c'était la référence. Ce n'est donc pas une supposition mais une propriété du
 * code de l'époque — et un test la vérifie en demandant à git plutôt qu'en la croyant.
 */
export const PREMIER_COMMIT_MULTI_FORMULATION = "cd05c3c";

function formulation(b: { promptUtilise?: string; measuredAt: string }) {
  if (b.promptUtilise) return { phrasing: b.promptUtilise, phrasingSource: "recorded" };
  return {
    phrasing: "reference",
    phrasingSource: `derived from code: measured before ${PREMIER_COMMIT_MULTI_FORMULATION}, `
      + "when only one formulation existed",
  };
}

/**
 * Les deux points de charge — et lesquels des sept paliers ont réellement été mesurés deux fois.
 *
 * Le relevé « chargé » n'est pas une seconde passe complète : c'est le relevé au repos dont
 * **un seul** palier a été remesuré sous charge, `gen-0.6b`. Les six autres y sont recopiés à
 * l'identique, avec la provenance de la passe au repos. Dire « l'exactitude est identique au
 * millième aux deux charges » en les comptant tous serait donc vrai et vide : six des sept
 * égalités sont des copies, pas des mesures.
 *
 * L'égalité n'est donc affirmée que sur les paliers réellement mesurés deux fois, et leur
 * nombre est écrit à côté. Un lecteur qui voit « 1 palier sur 7 » sait ce qu'il achète ; un
 * lecteur qui voit « identique au millième » sans ce chiffre croit avoir sept confirmations.
 */
function balayageDeCharge() {
  const racine = new URL("..", import.meta.url).pathname;
  const lire = (nom: string, fichier: string) => {
    const chemin = `${racine}/${fichier}`;
    if (!existsSync(chemin)) return null;
    const q = JSON.parse(readFileSync(chemin, "utf8")) as Profiles;
    const o = optimiseExtraction(q, ASSUMPTIONS);
    /* Comme `loadBeforePass` : à défaut de charge de passe, celle du premier palier mesuré. */
    const charge = q.chargeAvantPasse ?? (() => {
      const premiers = paliersMesures(q).map((t) => q.provenance?.[t])
        .filter((v): v is NonNullable<typeof v> => Boolean(v?.latency?.charge))
        .sort((a, b) => a.latency.measuredAt.localeCompare(b.latency.measuredAt));
      const c = premiers[0]?.latency.charge;
      return c ? { externalBefore: c.externalBefore, coeurs: c.coeurs } : undefined;
    })();
    return { nom, fichier, q, o, charge };
  };

  const repos = lire("at rest", "profiles-2026-08-20-coeur-rendu.json");
  const charge = lire("under generated load", "profiles-2026-08-20-charge-8.json");
  if (!repos || !charge) return null;

  const moyenne = (q: Profiles, t: TierName) => {
    const ch = FIELDS.map((c) => q.extraction[t][c].accuracy);
    return 100 * ch.reduce((a, x) => a + x, 0) / ch.length;
  };

  const paliers = paliersMesures(charge.q).map((t) => {
    const auRepos = repos.q.provenance?.[t]?.accuracy?.measuredAt ?? null;
    const sousCharge = charge.q.provenance?.[t]?.accuracy?.measuredAt ?? null;
    const remesure = auRepos !== null && sousCharge !== null && auRepos !== sousCharge;
    const a = moyenne(repos.q, t), b = moyenne(charge.q, t);
    return {
      id: t, remeasuredUnderLoad: remesure,
      accuracyPctAtRest: Number(a.toFixed(3)),
      accuracyPctUnderLoad: Number(b.toFixed(3)),
      accuracyGapPct: Number(Math.abs(a - b).toFixed(4)),
      latencyMsAtRest: Number(repos.q.extraction[t][FIELDS[0]!].latency.toFixed(1)),
      latencyMsUnderLoad: Number(charge.q.extraction[t][FIELDS[0]!].latency.toFixed(1)),
      ...(remesure ? {} : { why: "carried over from the rest pass, not measured again" }),
    };
  });

  const mesuresDeux = paliers.filter((x) => x.remeasuredUnderLoad);
  const ecartMax = mesuresDeux.length === 0 ? null
    : Math.max(...mesuresDeux.map((x) => x.accuracyGapPct));

  /* Le total par document ne bouge pas, et il faut dire pourquoi : le routage retenu n'emploie
     pas le seul palier qui a été remesuré. Sans cette phrase, deux ms/doc identiques passeraient
     pour une preuve que la charge n'agit pas. */
  const routageRetenu = repos.o ? new Set(FIELDS.map((c) => repos.o!.routing[c])) : new Set<TierName>();
  const remesuresUtilisees = mesuresDeux.filter((x) => routageRetenu.has(x.id as TierName));

  return {
    points: [repos, charge].map(({ nom, fichier, q, o, charge: c }) => ({
      name: nom, profile: fichier,
      loadAvg: c?.externalBefore ?? null, cores: c?.coeurs ?? null,
      msPerDoc: o === null ? null : Number(o.latencyPerItem.toFixed(1)),
      tiersMeasuredHere: paliersMesures(q).length,
    })),
    tiers: paliers,
    tiersMeasuredAtBothLoads: mesuresDeux.length,
    tiersTotal: paliers.length,
    accuracyIdenticalToThousandth: ecartMax === null ? null : ecartMax < 0.001,
    largestGapAmongRemeasuredPct: ecartMax,
    msPerDocComparable: remesuresUtilisees.length > 0,
    note: mesuresDeux.length === paliers.length
      ? "Les deux points sont des passes complètes."
      : `Le point chargé n'est pas une passe complète : ${mesuresDeux.length} palier(s) sur `
        + `${paliers.length} y ont été remesurés (${mesuresDeux.map((x) => x.id).join(", ") || "aucun"}). `
        + "Les autres sont recopiés du point au repos, donc leur égalité est une copie et non un "
        + "résultat. L'égalité au millième ne porte que sur les paliers remesurés. Le temps par "
        + "document est identique aux deux points parce que le routage retenu n'emploie aucun "
        + "palier remesuré — ce n'est pas une preuve que la charge est sans effet sur lui.",
  };
}

/**
 * De combien la composition employée s'écarte du vrai total par document.
 *
 * Mesurable seulement là où les durées sont enregistrées tentative par tentative — les relevés
 * du corpus propre sont antérieurs à ce format et n'en portent pas. La comparaison vient donc
 * du corpus dur, sur les documents qui ont bien leurs cinq champs.
 *
 * Le résultat contredit l'intuition rassurante : sommer les percentiles n'est **pas** une borne
 * supérieure. Elle surestime de 4 % sur deux paliers et **sous-estime de 5,8 %** sur `gen-4b`.
 * Un lecteur qui traiterait le p90 publié comme un pire cas se tromperait dans le sens qui coûte.
 */
export function compositionDepuisJournal() {
  const f = journaux().filter((x) => x.includes("-dur.jsonl")).pop();
  if (!f) {
    return { measured: false,
      why: "aucun journal de tentatives : les relevés du corpus propre sont antérieurs au format "
        + "qui enregistre chaque durée, donc l'écart n'est pas calculable depuis eux." };
  }
  const { tentatives } = lireJournal(f);
  const q = (v: number[], part: number) => {
    const t = [...v].sort((a, b) => a - b);
    return t.length ? t[Math.min(t.length - 1, Math.floor(part * t.length))]! : NaN;
  };
  const paliersVus = [...new Set(tentatives.map((t) => t.tier))].filter((t) => t.startsWith("gen-"));
  const parPalier = paliersVus.map((tier) => {
    const v = tentatives.filter((x) => x.tier === tier);
    const champs = new Map<string, number[]>();
    const vus = new Map<string, Set<string>>();
    for (const x of v) {
      champs.set(x.field, [...(champs.get(x.field) ?? []), x.ms]);
      vus.set(x.caseId, (vus.get(x.caseId) ?? new Set()).add(x.field));
    }
    const complets = [...vus.entries()].filter(([, f2]) => f2.size === FIELDS.length).map(([k]) => k);
    const totaux = complets.map((c) =>
      v.filter((x) => x.caseId === c).reduce((a, x) => a + x.ms, 0));
    const sommePct = (part: number) => FIELDS.reduce((a, c) => a + q(champs.get(c) ?? [], part), 0);
    const r0 = (x: number) => Number(x.toFixed(0));
    return {
      tier, documents: complets.length,
      sumOfFieldPercentilesMs: { p10: r0(sommePct(0.1)), median: r0(sommePct(0.5)), p90: r0(sommePct(0.9)) },
      percentilesOfRealTotalMs: { p10: r0(q(totaux, 0.1)), median: r0(q(totaux, 0.5)), p90: r0(q(totaux, 0.9)) },
      p90ErrorPct: Number((100 * (sommePct(0.9) / q(totaux, 0.9) - 1)).toFixed(1)),
    };
  });
  return {
    measured: true, from: f.split("/").slice(-2).join("/"), corpus: "hard-corpus",
    perTier: parPalier,
    conservative: parPalier.every((x) => x.p90ErrorPct >= 0),
    note: "Sommer les percentiles par champ n'est pas une borne supérieure du percentile du "
      + "total : elle sous-estime sur au moins un palier. Un lecteur qui prendrait le p90 publié "
      + "pour un pire cas se tromperait du côté qui coûte.",
    limite: `Le p90 « réel » est estimé sur ${parPalier[0]?.documents ?? 0} documents, donc le `
      + "vingt-septième d'entre eux : imprécis par construction. Ce bloc établit que les deux "
      + "compositions diffèrent et dans quel ordre de grandeur, pas la valeur exacte de l'écart. "
      + "Et il est mesuré sur le corpus dur, seul endroit où chaque durée est enregistrée.",
  };
}

/**
 * Ce qu'une escalade d'un seul champ coûte, contre le plafond.
 *
 * Le total de base et le total escaladé viennent tous deux de la **même** composition — somme
 * des médianes par champ — parce que comparer deux durées obtenues autrement ne compare rien.
 * Et l'escalade est chiffrée **par champ** : escalader `birth` et escalader `address` ne coûtent
 * pas la même chose, et un chiffre unique le cacherait.
 */
function plafondEtEscalade(p: Profiles, optimum: ReturnType<typeof optimiseExtraction>) {
  if (!optimum) return null;
  const cible: TierName = "gen-8b";
  if (!p.extraction[cible]) return null;
  const base = FIELDS.reduce((s, c) => s + p.extraction[optimum.routing[c]][c].latency, 0);
  const plafond = ASSUMPTIONS.latencyBudgetMs;
  const parChamp = FIELDS.map((c) => {
    const total = base + p.extraction[cible][c].latency;
    return {
      field: c, escalatedTo: cible,
      msPerDocument: Number(total.toFixed(1)),
      overrunMs: Number((total - plafond).toFixed(1)),
      overrunPctOfCeiling: Number((100 * (total - plafond) / plafond).toFixed(2)),
      overCeiling: total > plafond,
    };
  });
  return {
    baselineMsPerDocument: Number(base.toFixed(1)),
    ceilingMsPerDocument: plafond,
    tierWorthEscalatingTo: cible,
    composition: "sum of per-field medians — the same composition on both durations",
    perField: parChamp,
    everyFieldOverCeiling: parChamp.every((x) => x.overCeiling),
    /*
     * Ce que l'unique escalade admissible rapporte — dérivé, pas recopié.
     *
     * Ces chiffres vivaient dans la phrase en dessous, calculés à part. Une prose qui porte des
     * nombres que les données ne portent pas est le défaut qu'on venait de corriger dans ce même
     * objet une heure plus tôt ; les recopier en constantes l'aurait seulement déplacé.
     */
    admissibleEscalation: fige("admissibleEscalation") ?? gainDeCountryDepuisJournal(p, optimum, cible),
    fieldsOverCeiling: parChamp.filter((x) => x.overCeiling).map((x) => x.field),
    fieldsUnderCeiling: parChamp.filter((x) => !x.overCeiling).map((x) => x.field),
    /*
     * La note décrit, les champs chiffrent.
     *
     * Sa version précédente portait les cinq nombres de l'escalade dans sa phrase, et eux seuls
     * — donc illisibles par une machine, et libres de dériver du jour où les tentatives
     * changeraient. Ce qui mérite d'être lu mérite d'être émis : ils sont dans
     * `admissibleEscalation` et `perField`, et la prose n'en répète aucun.
     */
    note: "Escalader un champ vers `gen-8b` dépasse le plafond sur tous les champs sauf "
      + "`country` — voir `fieldsOverCeiling` et `fieldsUnderCeiling`. L'exception tient parce "
      + "que le routage recommandé envoie `country` à `rules`, dont la latence est nulle : le "
      + "remplacer ne coûte que le temps de `gen-8b`. Cette escalade-là est donc admissible, et "
      + "`admissibleEscalation` dit ce qu'elle rapporte — l'exactitude par champ monte, le "
      + "nombre de dossiers livrables ne bouge pas, parce que les autres champs continuent "
      + "d'échouer.",
  };
}

/**
 * Le gain de l'unique escalade qui tient sous le plafond, recalculé depuis les tentatives.
 *
 * Sans journal du corpus dur — un clone frais n'en a pas, `data/` est ignoré par git — la clé
 * dit pourquoi elle est vide plutôt que de disparaître.
 */
export function gainDeCountryDepuisJournal(p: Profiles, optimum: ReturnType<typeof optimiseExtraction>, cible: TierName) {
  if (!optimum) return null;
  const f = journaux().filter((x) => x.includes("-dur.jsonl")).pop();
  if (!f) return { measured: false, why: "aucun journal du corpus dur : `data/` n'est pas versionné, "
    + "donc un clone frais n'a pas les tentatives d'où ce gain se calcule. `npm run dur` les produit." };

  const { tentatives } = lireJournal(f);
  const rep = new Map(tentatives.map((t) => [`${t.tier}|${t.caseId}|${t.field}`, t]));
  const complets = corpusDur()
    .filter((c) => Object.keys(c.attendus).length === FIELDS.length).map((c) => c.cle);
  const textes = new Map(corpusDur().map((c) => [c.cle, c.texte]));

  /* Les deux signaux gratuits, identiques à ceux du banc : blanc, forme, absence. */
  const suspect = (t: { value: string; field: string; caseId: string }) => {
    const v = normaliserReponse(t.value);
    if (v.length === 0) return true;
    const texte = textes.get(t.caseId);
    if (texte !== undefined && !normaliserReponse(texte).includes(v)) return true;
    const r = FORME[t.field];
    return r !== undefined && !r(t.value);
  };

  let avant = 0, apres = 0, escalades = 0, gains = 0, pertes = 0;
  let entiersAvant = 0, entiersApres = 0, champs = 0;
  let coutAvant = 0, coutApres = 0;
  for (const cas of complets) {
    let okAvant = true, okApres = true;
    for (const c of FIELDS) {
      const base = rep.get(`${optimum.routing[c]}|${cas}|${c}`);
      if (!base) { okAvant = okApres = false; continue; }
      champs++;
      const prixBase = pricePerThousandExtractions(optimum.routing[c], ASSUMPTIONS,
        p.extraction[optimum.routing[c]][c].latency) / 1000;
      coutAvant += prixBase; coutApres += prixBase;
      let final = base;
      if (c === "country" && suspect(base)) {
        escalades++;
        coutApres += pricePerThousandExtractions(cible, ASSUMPTIONS, p.extraction[cible][c].latency) / 1000;
        final = rep.get(`${cible}|${cas}|${c}`) ?? base;
      }
      const a = base.outcome === "clean", b = final.outcome === "clean";
      if (a) avant++; else okAvant = false;
      if (b) apres++; else okApres = false;
      if (a && !b) pertes++; else if (b && !a) gains++;
    }
    if (okAvant) entiersAvant++;
    if (okApres) entiersApres++;
  }
  const v = pairedVerdict(gains, pertes);
  return {
    measured: true, corpus: "hard-corpus", escalatedField: "country", escalatedTo: cible,
    documents: complets.length, fields: champs, escalations: escalades,
    fieldsCorrectBefore: avant, fieldsCorrectAfter: apres,
    paired: { gains, losses: pertes, decidable: v.decidable },
    wholeDocumentsBefore: entiersAvant, wholeDocumentsAfter: entiersApres,
    wholeDocumentsGained: entiersApres - entiersAvant,
    extraCostPerThousandDocuments: Number((1000 * (coutApres - coutAvant) / complets.length).toFixed(4)),
    note: "Admissible, mesurable, et sans effet sur ce que le client consomme : "
      + "l'exactitude par champ monte nettement, le nombre de dossiers livrables ne bouge pas.",
  };
}

/**
 * Ce que se taire coûte et rapporte, et à partir de quel rapport de prix.
 *
 * Recalculé depuis les tentatives, jamais recopié : les chiffres d'un rapport écrits en dur ici
 * seraient faux à la première remesure sans que rien ne le dise.
 */
export function abstentionDepuisJournal(p: Profiles, optimum: ReturnType<typeof optimiseExtraction>) {
  if (!optimum) return null;
  const f = journaux().filter((x) => x.includes("-dur.jsonl")).pop();
  if (!f) return { measured: false, why: "aucun journal du corpus dur : `data/` n'est pas versionné. "
    + "`npm run dur` le produit, `npm run abstention` en tire ce bloc." };

  const { tentatives } = lireJournal(f);
  const rep = new Map(tentatives.map((t) => [`${t.tier}|${t.caseId}|${t.field}`, t]));
  const durs = corpusDur().filter((c) => Object.keys(c.attendus).length === FIELDS.length);
  const textes = new Map(durs.map((c) => [c.cle, c.texte]));

  const score = (t: { value: string; field: string; caseId: string }) => {
    const v = normaliserReponse(t.value);
    if (v.length === 0) return 1;
    let n = 0;
    const texte = textes.get(t.caseId);
    if (texte !== undefined && !normaliserReponse(texte).includes(v)) n++;
    const r = FORME[t.field];
    if (r !== undefined && !r(t.value)) n++;
    return n;
  };

  const regle = (seuil: number) => {
    let abst = 0, fauxElimines = 0, justesSacrifies = 0, livrees = 0, justesLivrees = 0;
    for (const c of durs) for (const champ of FIELDS) {
      const t = rep.get(`${optimum.routing[champ]}|${c.cle}|${champ}`);
      if (!t) continue;
      const juste = t.outcome === "clean";
      if (score(t) >= seuil) { abst++; if (juste) justesSacrifies++; else fauxElimines++; continue; }
      livrees++; if (juste) justesLivrees++;
    }
    const r = livrees ? rate(justesLivrees, livrees) : null;
    /* Bascule : trous créés par erreur évitée. Sans dimension, donc transportable. */
    const bascule = fauxElimines > 0 ? Number((abst / fauxElimines).toFixed(3)) : null;
    return {
      signalsRequired: seuil, abstentions: abst,
      wrongRemoved: fauxElimines, correctSacrificed: justesSacrifies,
      breakEvenCostRatio: bascule,
      delivered: livrees, deliveredCorrect: justesLivrees,
      deliveredPrecisionPct: r ? Number((100 * r.rate).toFixed(1)) : null,
      deliveredPrecisionInterval: r ? [Number((100 * r.low).toFixed(1)), Number((100 * r.high).toFixed(1))] : null,
      /* Ce que « n'en sacrifie aucune » vaut vraiment sur si peu d'abstentions. */
      neverSacrificesInterval: abst > 0
        ? [Number((100 * rate(fauxElimines, abst).low).toFixed(1)), Number((100 * rate(fauxElimines, abst).high).toFixed(1))]
        : null,
    };
  };

  const sans = regle(99);      // seuil inatteignable : aucune abstention
  const base = rate(sans.deliveredCorrect, sans.delivered);
  return {
    measured: true, corpus: "hard-corpus", documents: durs.length,
    valuesMeasured: sans.delivered,
    baselinePrecisionPct: Number((100 * base.rate).toFixed(1)),
    baselinePrecisionInterval: [Number((100 * base.low).toFixed(1)), Number((100 * base.high).toFixed(1))],
    rules: [regle(1), regle(2)],
    declaredCostRatio: Number((ASSUMPTIONS.costWrongValue / ASSUMPTIONS.costBlankField).toFixed(3)),
    note: "Le rapport de bascule est le prix d'une valeur inventée divisé par celui d'un trou, "
      + "au-delà duquel se taire est rentable. Il ne dépend d'aucun des deux prix, seulement de "
      + "leur rapport, donc il survit à un client qui remplace `assumptions` par les siennes. "
      + "Au rapport déclaré, qui est l'égalité, aucune règle ne rapporte quoi que ce soit.",
  };
}

/** Les trente-cinq comptes que les sorties brutes fournissent, pour les geler. */
function tableDeDecomposition(p: Profiles) {
  const t: Record<string, { vide: number; faux: number }> = {};
  for (const tier of paliersMesures(p)) {
    for (const c of FIELDS) {
      const d = decompositionDe(p, tier, c);
      if (d) t[`${tier}|${c}`] = d;
    }
  }
  return t;
}

function decomposeErreurs(p: Profiles, routing: Routing) {
  const perThousand: Record<string, { tier: TierName; blank: number | null; wrong: number | null }> = {};
  let couverts = 0;
  for (const c of FIELDS) {
    const t = routing[c];
    const q = p.extraction[t][c];
    /*
     * Passer par `decompositionDe`, qui sait retomber sur la table gelée.
     *
     * Cette boucle relisait `q.sorties` elle-même, en double du solveur. Le repli ajouté à
     * l'autre ne l'atteignait donc pas, et un clone continuait de rendre `null` sur les cinq
     * champs — la correction avait l'air faite et ne l'était qu'à moitié. Deux lectures de la
     * même donnée finissent toujours par diverger ; celle-ci a divergé sur un correctif.
     */
    const d = decompositionDe(p, t, c);
    if (!d) { perThousand[c] = { tier: t, blank: null, wrong: null }; continue; }
    couverts++;
    perThousand[c] = { tier: t, blank: Math.round(d.vide * 1000), wrong: Math.round(d.faux * 1000) };
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
          /*
           * Où est passé ce commit, quand il n'existe plus.
           *
           * Réécrire l'historique pour purger les sorties brutes a changé onze empreintes, et
           * le relevé de référence a continué d'afficher une empreinte que personne ne peut
           * extraire. Enregistrer un commit n'a qu'une raison d'être : que le lecteur aille
           * voir. Un commit introuvable est donc un champ mort qui a l'air vivant.
           */
          ...commitReecrit(b.commit),
          /*
           * La formulation, toujours — y compris quand c'est la référence.
           *
           * `promptUtilise` n'était écrit que lorsqu'il différait, donc « mesuré sous la
           * référence » et « personne ne l'a noté » se lisaient pareil. Corrigé dans la mesure ;
           * il fallait qu'il ressorte jusqu'ici. Pour les relevés antérieurs au drapeau, la
           * réponse est déductible du code plutôt qu'inventée — et la déduction est nommée.
           */
          ...formulation(b),
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

    /*
     * D'où vient toute durée de ce fichier, dit une fois plutôt que vingt-quatre.
     *
     * Vingt-quatre chiffres en millisecondes sont publiés ici et aucun ne porte sa dispersion
     * dans son propre objet. Ce n'est pas un oubli : aucun n'est une mesure fraîche, tous sont
     * des sommes de médianes par champ tirées du même relevé, dont la dispersion vit dans
     * `latencySpread.perDoc`. Le déclarer une fois vaut mieux que de le répéter, et surtout
     * mieux qu'un contrôle qui reniflerait les noms de clés et crierait sur les vingt-quatre.
     *
     * La distinction qui gouverne : **un compte se compte, une durée se chronomètre.** Un
     * nombre de jetons est un fait sur la sortie du modèle et se reproduit ailleurs ; une durée
     * est un fait sur la machine, sa charge et l'instant, et ne se transporte pas. Deux chiffres
     * ont dû être retirés cette nuit pour avoir confondu les deux.
     */
    /*
     * POURQUOI HUIT EXACTITUDES DE CE FICHIER NE PORTENT PAS D'INTERVALLE.
     *
     * Trente-huit taux sont publiés ici ; trente portent leur borne et leur effectif. Les
     * huit qui n'en portent pas sont l'exactitude du routage et celles des sept paliers
     * seuls — et ce n'est pas un oubli, c'est un refus. `evaluer()` rend
     * `sommeJustesse / champs.length` : une MOYENNE de cinq taux mesurés sur des échantillons
     * différents, 1 000 cas pour les paliers machine et 120 pour l'échelle générative. Ce
     * n'est pas une proportion. Un intervalle de Wilson dessus aurait l'exactitude d'un
     * relevé et la valeur d'une invention.
     *
     * Les taux qui SONT des proportions, eux, portent tous leur borne : ils sont dans
     * `tiers[].acc[champ]`, un par palier et par champ, avec leur `n`. Un lecteur qui veut
     * une borne sur une exactitude de document doit la chercher là, champ par champ — et
     * c'est la vraie réponse, pas une borne agrégée qui n'existe pas.
     *
     * Déclaré une fois plutôt que répété huit fois, comme les durées juste en dessous : un
     * contrôle qui reniflerait les noms de clés crierait sur les huit sans rien comprendre.
     */
    accuracyFigures: {
      whichCarryNoInterval: ["routing.accuracy", "singleTierBaselines[].accuracy"],
      why: "Each is the mean of the 5 per-field rates of that assignment, measured on "
        + "separate samples — not a proportion, so a Wilson bound would be fabricated.",
      boundedRatesLiveIn: "tiers[].acc[field]",
      humanIsAssumed: "The human tier's accuracy is an assumption, not a measurement: it "
        + "carries no bound because there is no sample behind it.",
    },

    latencyFigures: {
      origin: "Toutes les durées de ce fichier sont dérivées d'un seul relevé mesuré, jamais "
        + "mesurées à nouveau ici. Chacune est une somme de médianes par champ.",
      dispersionLivesIn: "latencySpread.perDoc",
      composition: "sum of per-field medians",
      countedVersusTimed: "Un compte de jetons ou de cas est un fait sur la sortie : il se "
        + "compte, il se reproduit sur une autre machine, et il se publie tel quel. Une durée "
        + "est un fait sur la machine, sa charge et l'instant : elle ne vaut que pour la passe "
        + "qui l'a prise, et elle ne se publie qu'avec sa dispersion. Confondre les deux a coûté "
        + "deux rétractations le 21 août.",
      noFreshTimingHere: true,
    },

    latencySpread: {
      /*
       * Laquelle des deux compositions, dite plutôt que devinée.
       *
       * Cinq latences par champ deviennent un total par document, et il y a deux façons de le
       * faire : sommer les percentiles de chaque champ, ou prendre le percentile de la somme
       * réelle. Elles ne donnent pas le même chiffre, et jusqu'ici le fichier n'annonçait pas
       * laquelle il employait — ce qui laisse le lecteur en choisir une et se tromper sans le
       * savoir.
       */
      composition: "sum of per-field percentiles",
      compositionCheck: fige("compositionCheck") ?? compositionDepuisJournal(),
      /*
       * Le plafond, et de combien une seule escalade le dépasse.
       *
       * La page ne peut pas publier le résultat d'escalade sans ces valeurs, et les taper à la
       * main est la faute qu'on retire d'elle depuis ce matin. La composition est émise avec
       * elles : sur une marge de soixante-neuf millisecondes, laquelle des deux compositions a
       * produit les deux durées est la première question d'un lecteur attentif.
       */
      escalationCeiling: plafondEtEscalade(p, optimum),
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
      /*
       * L'affirmation inverse, enregistrée plutôt que crue.
       *
       * `thresholds` cherche le point de rupture vers le haut. La page affirme aussi qu'aucune
       * baisse de prix ne déplace le routage — une affirmation différente, vraie, et qui
       * n'était écrite nulle part. Une affirmation vraie et non enregistrée ne se distingue
       * pas d'une fausse tant que personne n'a regardé.
       */
      downward: versLeBas(p, ASSUMPTIONS),
      note: "Chaque hypothèse est balayée seule, les autres restant à leur valeur en usage : "
        + "deux prix qui bougent ensemble peuvent basculer le routage plus tôt qu'aucun des "
        + "deux séparément. Le balayage ne couvre que les entrées qui tarifent un palier — le "
        + "plafond de latence et le volume ne sont pas des prix et changent la réponse par "
        + "d'autres chemins.",
    },

    /*
     * Les deux points de charge, avec leur exactitude.
     *
     * La page dit l'exactitude « identique au millième aux deux charges ». C'est probablement
     * vrai — le décodage est glouton, il ne dépend pas de la charge — et ça n'avait jamais été
     * relevé : les deux points ne portaient que la charge, le temps par document et un nom de
     * fichier. Ici la comparaison est faite et son résultat écrit, y compris s'il dément.
     */
    loadSweep: balayageDeCharge(),

    /*
     * Le seul chiffre du dossier qui survive au remplacement de toutes nos hypothèses.
     *
     * Le point de bascule ne dépend que du **rapport** entre le prix d'une valeur inventée et
     * celui d'un trou, et d'aucun des deux prix. Un client qui jette `assumptions` et met les
     * siens le garde tel quel.
     */
    abstention: fige("abstention") ?? abstentionDepuisJournal(p, optimum),

    /*
     * Gelé pour la même raison que les blocs de journal : il ne se recalcule pas d'un clone.
     *
     * `decomposeErreurs` distingue un blanc d'une valeur fausse, ce qui demande les **sorties
     * brutes par cas**. Les relevés livrés à la racine en sont dépourvus depuis qu'on a sorti
     * 1,4 Mo de sorties de git, donc un clone rendait `null` partout et divergeait du fichier
     * livré. Les deux seuils qui tarifent ces erreurs tombaient avec lui.
     */
    errorSplit: optimum === null ? null : decomposeErreurs(p, optimum.routing),
    cleanPerDocument: optimum === null ? null : dossiersPropres(p, optimum.routing),
    paired: egalitesTranchees(p),

    /*
     * Le journal, compté plutôt que recopié.
     *
     * `vueParPersonne` est le seul critère qui compte et il est écrit à la main dans le
     * journal, pas déduit d'une phrase par un générateur : « personne ne l'a vue » est un
     * jugement sur une histoire, et le laisser inférer d'un texte français le rendrait
     * généreux au premier cas ambigu. Trois sur dix seulement — la sévérité de ce champ est
     * ce qui empêche l'argument de se retourner.
     */
    retractions: (() => {
      const f = new URL("../retractations.json", import.meta.url).pathname;
      if (!existsSync(f)) return null;
      const j = JSON.parse(readFileSync(f, "utf8")) as {
        entries: { date: string; headline?: string; caughtBeforeAnyoneSawIt?: boolean }[] };
      return {
        total: j.entries.length,
        caughtBeforeAnyoneSawIt: j.entries.filter((e) => e.caughtBeforeAnyoneSawIt === true).length,
        entries: j.entries.map((e) => ({
          date: e.date,
          headline: e.headline ?? null,
          caughtBeforeAnyoneSawIt: e.caughtBeforeAnyoneSawIt ?? null,
        })),
      };
    })(),

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
      "Le routage est calibré à la taille de document du corpus — 166 caractères en moyenne, "
      + "environ 185 jetons d'entrée — et le rapport de coût entre paliers bouge avec la "
      + "longueur d'entrée. Deux balayages du 21 août donnent des rapports différents sur les "
      + "mêmes points, parce que la dispersion d'un appel isolé y est large : à 200 jetons, "
      + "`gen-0.6b` va de 167 à 802 ms sur cinq répétitions. Ce qui est établi est que le "
      + "rapport bouge et qu'un client aux documents nettement plus longs doit recalibrer ; "
      + "aucune valeur de ce rapport n'est publiée, faute d'un échantillon qui la tienne. Les "
      + "latences par palier du relevé, elles, portent sur cent vingt appels et leur p10/p90.",
      "Le prix des paliers génératifs est du temps machine, donc il dépend de la configuration "
      + "de l'appel autant que du modèle. La sortie est contrainte par un schéma JSON, et le "
      + "prix publié suppose cette contrainte : sans elle, `gen-4b` produit 200 jetons contre "
      + "15,6 — c'est-à-dire exactement le plafond `num_predict`, donc sa longueur réelle n'est "
      + "pas observée mais seulement minorée — et rend du raisonnement au lieu d'une valeur. "
      + "Aucun rapport de prix n'est publié pour cet écart : les vingt durées qui le chiffraient "
      + "ont été prises sans leur dispersion, sur une machine dont un appel isolé varie d'un "
      + "facteur cinq. Ce qui est établi est le compte de jetons, qui se compte au lieu de se "
      + "chronométrer, et sur un seul palier.",
      "La latence est mesurée un élément à la fois sur une machine au repos ; rien ici ne dit "
      + "ce qu'elle devient sous charge.",
      "Ces chiffres sont ceux de la chaîne d'extraction. La chaîne de classification range les "
      + "paliers dans l'ordre inverse, ce qui interdit d'en tirer un classement général.",
      "Un routage expire : il est calculé sur des révisions épinglées et un échantillon figé. "
      + "Une dérive du trafic ou une mise à jour de modèle l'invalide sans lever d'erreur.",
      "L'indiscernabilité est mesurée sous une seule formulation de prompt, celle du dépôt. "
      + "Elle n'y survit pas partout : sur le découpage de réglage, `gen-4b` et `gen-8b` sont "
      + "indiscernables sous cette formulation (McNemar 13–25 sur 600 extractions), et "
      + "départagés en faveur de `gen-4b` sous `A-sans-exemple` (64–1, portés par name, "
      + "document et address). « Ce palier vaut celui-là » est donc une propriété du couple "
      + "palier-formulation, pas du palier.",
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
  const geler = process.argv.includes("--derivees");
  const p = readProfiles();

  if (!p) {
    console.error("aucun relevé dans data/profiles.json — lancer `npm run measure` d'abord.");
    process.exit(1);
  }

  /*
   * Le gel des blocs tirés des journaux, avant tout le reste.
   *
   * Il s'écrit ici parce que les trois calculs y vivent ; le mettre dans `derivees.ts` fermait
   * un cycle d'import qui bloquait le chargement sans erreur.
   */
  if (geler) {
    const optimum0 = optimiseExtraction(p, ASSUMPTIONS);
    const js = journaux().filter((x) => x.includes("-dur.jsonl"));
    const dernier = js[js.length - 1] ?? null;
    writeFileSync(FIGE, JSON.stringify({
      quoi: "Les blocs de landing.json calculés depuis les journaux de tentatives, figés parce "
        + "que `data/` n'est pas versionné et qu'un clone frais doit pouvoir vérifier landing.json.",
      journal: dernier ? dernier.split("/").slice(-2).join("/") : null,
      journalModifieLe: dernier ? new Date(statSync(dernier).mtimeMs).toISOString() : null,
      calculeLe: new Date().toISOString(),
      blocs: {
        compositionCheck: compositionDepuisJournal(),
        /*
         * L'ENTRÉE, pas la sortie.
         *
         * Geler `errorSplit` et `thresholds` mettait le générateur en contradiction avec son
         * propre invariant : il publiait des seuils figés et vérifiait en direct qu'ils
         * encadrent une vraie bascule, ce qu'un clone ne peut pas faire faute de sorties
         * brutes. Il refusait donc d'écrire, à juste titre. Ce qui manque à un clone n'est pas
         * le résultat mais la donnée dont il sort : trente-cinq comptes de blancs et de faux,
         * par palier et par champ. Gelés, tout le reste se recalcule et l'invariant tourne
         * pour de vrai.
         */
        decomposition: tableDeDecomposition(p),
        admissibleEscalation: gainDeCountryDepuisJournal(p, optimum0, "gen-8b" as TierName),
        abstention: abstentionDepuisJournal(p, optimum0),
      },
    }, null, 2) + "\n");
    console.log(`Figé depuis ${dernier?.split("/").pop() ?? "aucun journal"} dans ${FIGE.split("/").pop()}`);
    process.exit(0);
  }

  /*
   * Le produit ne doit jamais être plus vieux que sa source. Arrêt, pas avertissement.
   *
   * Un contrôle qui lit un artefact dépassé par ce qui le produit rend un vert sur du travail
   * que personne n'a vu. Un avertissement dans une sortie qui défile est un avertissement qui
   * n'existe pas — c'est un arrêt ou rien.
   */
  const age = perime();
  if (age.perime) {
    console.error(`\n${age.raison}\n`);
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
