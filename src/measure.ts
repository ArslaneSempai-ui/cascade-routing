/**
 * Measure each tier once, then freeze.
 *
 * This is what the field actually does, and it is the only honest option: you do not
 * compare models on figures published by the people selling them. You run them on your
 * own set, record what they return, and keep the record.
 *
 * The saved profile carries accuracy and latency — measured — and nothing else. Price is
 * not a measurement: it is an assumption, it belongs to the screen and it is arguable.
 * Mixing the two would pass a tariff off as a fact.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { dirname } from "node:path";
import { generateRecords, generateAlerts, FIELDS, TYPOLOGIES } from "./corpus.ts";
import { TIERS, ENCODEURS, GENERATIFS, loadExtractors, loadClassifiers, loadGeneratifs, extract, classify, correct, OLLAMA, estLocal, PROMPTS, type NomPrompt, rechauffer, residents} from "./tiers.ts";
import type { TierName } from "./tiers.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const FICHIER = fileURLToPath(new URL("../data/profiles.json", import.meta.url));

export type Profile = {
  /** Share of items this tier gets right. Measured. */
  accuracy: number;
  /**
   * Milliseconds per item — the **median**, not the mean, excluding model load time.
   *
   * It was a mean over the whole batch, which is a single number where there is a
   * distribution. On a generative tier the spread is wide and one slow item drags a mean
   * that is then quoted as if it were the typical case. This repository's own rule is that
   * a rate without its sample is not a measurement; a duration without its spread is the
   * same mistake wearing different clothes.
   */
  latency: number;
  /** The 10th and 90th percentile of that same distribution. Measured. */
  latencyP10: number;
  latencyP90: number;
  items: number;
  /**
   * Quels cas ce palier a réussi, dans l'ordre du tirage.
   *
   * Un taux ne permet que le mauvais test. Deux paliers sont notés **sur les mêmes cas** :
   * comparer leurs intervalles de Wilson les traite comme deux échantillons indépendants,
   * ce qu'ils ne sont pas, et le résultat est trop conservateur — il déclare « indiscernables »
   * des paires qu'un test apparié sépare.
   *
   * Ces bits sont ce qui rend McNemar possible : on compte les cas où l'un réussit et l'autre
   * échoue, et on demande si la répartition se distingue d'une pièce lancée. `pairedVerdict`
   * attend exactement ça et existait, inutilisé, depuis le premier jour.
   *
   * Une chaîne de « 1 » et de « 0 » plutôt qu'un tableau : mille cas font mille caractères au
   * lieu d'un fichier JSON de plusieurs kilooctets par palier et par champ.
   */
  reussites?: string;
  /** Posé sur le palier humain : ce n'est pas une mesure, et le fichier doit le dire. */
  commodite?: string;
  /**
   * Ce que le palier a répondu, cas par cas, avant tout jugement.
   *
   * `reussites` dit « bon » ou « faux » **sous le scoreur du jour**, ce qui suffit à un test
   * apparié et à rien d'autre. Deux questions qu'on veut poser en dépendaient et étaient
   * impossibles : que devient l'exactitude si l'on serre la définition de « correct », et
   * un échec est-il une valeur fausse ou une valeur absente. Les deux exigent la réponse,
   * pas son verdict.
   *
   * Les conserver rend tout re-scorage futur gratuit — hier il a fallu refaire tourner
   * l'extraction pendant dix minutes pour produire une bande de sévérité que ces chaînes
   * auraient donnée en une seconde.
   */
  sorties?: string[];
};

/**
 * La charge externe au-delà de laquelle une durée ne veut plus rien dire.
 *
 * Exprimé par cœur, parce qu'une charge de 4 est confortable sur seize cœurs et étouffante
 * sur deux. La valeur sort de mon jugement et de rien d'autre — c'est un nombre **choisi**,
 * au sens que ce dépôt donne au mot, et il est déclaré dans `INVENTORY` à ce titre.
 *
 * Il porte sur `externalBefore` — la charge que la machine subissait **avant** que la mesure
 * commence — et jamais sur `totalDuring`, qui inclut le travail de la mesure elle-même. Les
 * comparer au mauvais champ ferait refuser toute mesure d'encodeur, puisqu'une inférence
 * sature les cœurs par construction.
 */
export const CHARGE_MAX_PAR_COEUR = 0.5;

/**
 * La passe publiée mesure sur `heldout`, et nulle part ailleurs.
 *
 * Nommé plutôt qu'écrit trois fois : le journal des tentatives doit enregistrer le découpage
 * sur chaque ligne, et deux littéraux qui dérivent l'un de l'autre est exactement la faute que
 * ce dépôt corrige partout.
 */
export const DECOUPAGE_DE_MESURE = "heldout" as const;

/** D'où vient un résultat : quel code, quel arbre, quand, et sous quelle charge. */
export type Provenance = {
  /**
   * Le modèle était-il en mémoire quand la durée a été prise ?
   *
   * L'éviction est silencieuse : `ollama ps` rend une ligne de moins, sans erreur, et le modèle
   * se recharge au premier appel suivant. La durée relevée est alors celle d'un chargement — cinq
   * fois la médiane, mesuré sur les trois paliers — et rien ne la distinguait d'une inférence.
   *
   * Ne concerne que la latence. L'exactitude ne dépend ni de la résidence ni de la charge, et
   * ce dépôt l'a mesuré plutôt que supposé : 984 tentatives, deux charges, identiques au dixième.
   */
  residentAvantLaMesure?: boolean;
  residentsPendant?: string[];
  octetsResidents?: number;
  commit: string | null;
  sale: boolean | null;
  measuredAt: string;
  /** La raison donnée si l'on a mesuré sciemment sur un arbre modifié. */
  malgreArbreSale?: string;
  /**
   * Deux charges, et les confondre était le défaut de la première version.
   *
   * `externalBefore` est ce que la machine subissait juste avant que ce palier commence :
   * c'est la seule qui parle des *conditions*, c'est celle que la garde teste, et c'est celle
   * qu'une page peut publier. `totalDuring` est la moyenne réellement échantillonnée pendant
   * la mesure — elle inclut donc le travail mesuré, et une inférence d'encodeur sature les
   * cœurs par construction : `small` a été chronométré à 9,1 sans que rien d'étranger ne
   * tourne.
   *
   * On garde quand même la seconde, parce que c'est elle qui a permis de s'attraper : un
   * `totalDuring` très au-dessus de ce que le travail explique est le signal qu'un tiers
   * s'est invité pendant la passe, et un relevé pris avant le départ ne l'aurait jamais vu.
   */
  charge?: { externalBefore: number; totalDuring: number; coeurs: number };
  /** La commande qui a fabriqué la charge, quand elle a été fabriquée exprès. */
  chargeFabriqueePar?: string;
  /**
   * La formulation employée, quand ce n'est pas la référence.
   *
   * Une exactitude générative dépend du prompt autant que du modèle — mesuré le 20 août :
   * cinq formulations dispersent `gen-4b` de 45,8 points sur `birth`, contre 12,5 entre les
   * trois modèles. Un taux sans sa formulation n'est donc pas attribuable, et deux relevés
   * pris sous deux prompts se compareraient comme s'ils mesuraient la même chose.
   */
  promptUtilise?: string;
};

/**
 * Deux provenances par palier, parce qu'un relevé porte deux sortes de résultats.
 *
 * L'exactitude est déterministe : elle ne dépend que du code, des cas et du scoreur, et une
 * machine chargée la rend à l'identique. La latence, elle, mesure la machine autant que le
 * modèle — la même passe a rendu `gen-8b` à 7 920 ms sous une charge de 3,45 et à 10 445 ms
 * sous 7,98, sans qu'une ligne ait changé.
 *
 * Une provenance unique forçait donc un choix impossible : garder des durées contaminées pour
 * que le fichier reste cohérent, ou restaurer les bonnes en laissant la provenance affirmer
 * qu'elles viennent d'une passe qui ne les a pas produites. Séparées, le fichier dit
 * simplement la vérité — l'exactitude vient d'ici, la latence de là, et chacune sait sous
 * quelle charge elle a été prise.
 */
export type ProvenanceDuPalier = { accuracy: Provenance; latency: Provenance };

export type Profiles = {
  measuredAt: string;
  /**
   * La version du code qui a produit ces chiffres.
   *
   * Une date ne suffit pas. Deux mesures du même jour, séparées par une correction de
   * l'évaluateur, sont indiscernables dans le fichier — et c'est arrivé aujourd'hui : les
   * chiffres du matin et ceux de l'après-midi ne viennent pas du même code, rien ne le dit,
   * et un lecteur qui compare les deux compare deux instruments différents en croyant
   * comparer deux modèles.
   *
   * `sale` vaut vrai quand l'arbre de travail avait des modifications non enregistrées : la
   * mesure n'est alors reproductible par personne, pas même par son auteur, et le dire est le
   * minimum.
   */
  code?: { commit: string; sale: boolean };
  /**
   * D'où vient **chaque palier**, et pas seulement le fichier.
   *
   * `code` décrit une passe ; le fichier, lui, est le produit de plusieurs. `sauver` fusionne
   * les paliers non mesurés avec ceux qui viennent d'être refaits, si bien qu'une clé globale
   * finit par attribuer à tous l'état d'arbre du dernier passage. C'est arrivé : le relevé a
   * porté `sale: true` pour sept paliers dont trois venaient d'une passe antérieure sur arbre
   * propre — l'inverse de la vérité, dans le sens qui accuse plutôt que dans celui qui
   * rassure, mais faux quand même.
   *
   * Écrite au moment où le palier est mesuré, elle rend le fichier exact sans re-mesurer quoi
   * que ce soit d'autre, et permet de rafraîchir une échelle sans mentir sur l'autre. Un
   * palier antérieur à ce champ vaut `undefined` : on n'invente pas une provenance qui n'a
   * jamais été écrite.
   */
  provenance?: Record<TierName, ProvenanceDuPalier>;
  /**
   * La charge de la machine avant que la passe commence — la seule pleinement étrangère.
   *
   * `externalBefore` par palier dit vrai : la charge avant *ce* palier. Mais à l'intérieur
   * d'une passe, ça inclut la traîne du palier précédent — `large` relevé à 5,48 n'avait
   * aucun tiers sur le dos, c'était `small` qui finissait de s'éteindre dans une moyenne
   * glissante d'une minute. Un champ qui décrit un palier ne peut pas décrire la passe ;
   * comme pour `code` ce matin, on sépare les portées plutôt que de changer la mesure.
   *
   * C'est ce nombre-ci qu'une page publie, et lui seul.
   */
  chargeAvantPasse?: { externalBefore: number; coeurs: number };
  /** Les paliers que ce fichier contient réellement — l'échelle générative est optionnelle. */
  tiers?: TierName[];
  /** Chain A: one profile per tier AND per field — this is where the routing is decided. */
  extraction: Record<TierName, Record<Field, Profile>>;
  /** Chain B: one profile per tier, a single decision per file. */
  classification: Record<TierName, Profile>;
  loadTime: Record<TierName, number>;
};

let refReferenceAnnoncee = false;

/**
 * Le relevé du lecteur, ou celui du dépôt — et jamais l'un pour l'autre.
 *
 * `data/` est ignoré par git : un clone frais n'a donc aucun relevé, alors que le dépôt en
 * **livre** un à la racine. Le premier nombre demandait une copie manuelle que personne ne
 * pouvait deviner, et « clonez et vérifiez » restait une phrase inexécutable.
 *
 * Le repli comble ça, mais il s'annonce, et c'est la moitié qui compte. Un repli silencieux
 * ferait croire à quelqu'un qu'il lit *ses* mesures alors qu'il relit les nôtres — le pire
 * mensonge que cet outil puisse produire, puisqu'il porterait exactement sur la distinction
 * qu'il vend.
 *
 * **La référence est nommée, et elle l'était par sa date.** « La plus récente » semblait éviter
 * d'avoir à mettre un chemin à jour ; ça choisissait en réalité `profiles-2026-08-20-charge-8`,
 * un relevé pris **sous une charge fabriquée exprès** et conservé comme pièce à conviction. Un
 * clone lisait donc d'autres latences que celles dont le README et `landing.json` ont été
 * engendrés, et leurs blocs ne concordaient plus — c'est-à-dire que « quiconque clone reproduit
 * les chiffres ci-dessous » était faux, et le seul contrôle qui pouvait le voir n'existait pas
 * encore. Une référence se déclare ; la trier par date fait entrer n'importe quelle mesure
 * ultérieure, y compris celles qu'on garde justement parce qu'elles sont mauvaises.
 */
export const RELEVE_DE_REFERENCE = "profiles-2026-08-20-coeur-rendu.json";

/*
 * L'EMPREINTE DU RELEVÉ, ET CE QU'ELLE PROUVE EXACTEMENT.
 *
 * Le fichier portait déjà sa provenance — date de mesure, commit, propreté de l'arbre à ce
 * moment-là, et le détail par palier. Il ne portait aucune somme de contrôle de son CONTENU.
 * Conséquence : un taux modifié à la main y était indétectable. La date ne bouge pas, le
 * commit ne bouge pas, tous les tests passent, et le chiffre fabriqué se retrouve publié dans
 * le README avec exactement l'aplomb d'une mesure. C'est le trou central d'un audit vendu sur
 * sa reproductibilité — le seul défaut de cette liste qu'un acheteur ne peut pas trouver seul,
 * parce que rien dans le dépôt ne le contredirait.
 *
 * CE QUE L'EMPREINTE PROUVE : que le fichier n'a pas changé depuis qu'elle a été posée.
 * CE QU'ELLE NE PROUVE PAS : que ce qu'il contenait ce jour-là était juste. Une empreinte est
 * un scellé, pas un témoin. Le premier scellé a été posé sur un fichier déjà écrit, donc il
 * ne dit rien de ce qui l'a précédé — et il vaut mieux l'écrire ici que de laisser croire le
 * contraire à qui lit « checksum » dans un rapport.
 *
 * Sérialisation à clés triées, sinon deux exécutions du même relevé rendent deux empreintes
 * et le contrôle devient du bruit que tout le monde apprend à ignorer.
 */
function canonique(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonique);
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((a, k) => {
      if (k !== "empreinte") a[k] = canonique(o[k]);
      return a;
    }, {});
  }
  return x;
}

export function empreinteDuReleve(profils: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonique(profils))).digest("hex").slice(0, 16);
}
export function readProfiles(): Profiles | null {
  if (existsSync(FICHIER)) {
    const p = JSON.parse(readFileSync(FICHIER, "utf8"));
    /* ON REFUSE, ON NE PRÉVIENT PAS. Un avertissement sur un relevé altéré serait lu une
       fois puis passé — et pendant ce temps la page publierait le chiffre. Le seul niveau
       de sévérité correct pour « la mesure a été modifiée depuis sa mesure » est l'arrêt.
       Le message dit quoi faire, parce qu'un refus sans issue se contourne. */
    const attendue = (p as Record<string, unknown>).empreinte;
    const calculee = empreinteDuReleve(p);
    if (typeof attendue !== "string") {
      throw new Error(
        `${FICHIER} ne porte pas d'empreinte de contenu : impossible de dire si ses chiffres\n`
        + `  sont ceux qui ont été mesurés. Reposez le scellé avec « npm run sceller », ou\n`
        + `  remesurez avec « npm run measure ».`);
    }
    if (attendue !== calculee) {
      throw new Error(
        `${FICHIER} a changé depuis sa mesure — empreinte ${attendue}, contenu ${calculee}.\n`
        + `  Un chiffre de ce fichier a été modifié à la main, ou le fichier a été assemblé\n`
        + `  depuis deux relevés. Aucun chiffre publié à partir de lui n'a de valeur tant que\n`
        + `  ce n'est pas éclairci. Remesurez, ou reposez le scellé si la modification est\n`
        + `  voulue et assumée.`);
    }
    return p;
  }

  const racine = fileURLToPath(new URL("..", import.meta.url));
  const livres = readdirSync(racine)
    .filter((f) => /^profiles-.*\.json$/.test(f))
    .map((f) => {
      try { return { f, p: JSON.parse(readFileSync(join(racine, f), "utf8")) as Profiles }; }
      catch { return null; }
    })
    .filter((x): x is { f: string; p: Profiles } => Boolean(x?.p?.measuredAt))
    .sort((a, b) => b.p.measuredAt.localeCompare(a.p.measuredAt));

  /* Le relevé nommé d'abord ; la date ne sert que s'il a disparu, et le repli se dit. */
  const ref = livres.find((x) => x.f === RELEVE_DE_REFERENCE) ?? livres[0];
  if (!ref) return null;
  /* ET LE SCELLÉ VAUT ICI AUSSI — c'est même ici qu'il compte le plus.
     `data/` est ignoré par git : dans un clone neuf, `data/profiles.json` n'existe pas et
     c'est CE fichier-ci qui produit tous les chiffres publiés. Sceller seulement le premier
     aurait protégé la machine de l'auteur et laissé le chemin du client sans garde — la
     forme exacte du défaut qu'on répare : un contrôle qui ne couvre pas le cas qui voyage. */
  {
    const attendue = (ref.p as unknown as Record<string, unknown>).empreinte;
    const calculee = empreinteDuReleve(ref.p);
    if (typeof attendue !== "string") {
      throw new Error(
        `${ref.f} ne porte pas d'empreinte de contenu : impossible de dire si ses chiffres\n`
        + `  sont ceux qui ont été mesurés. Reposez le scellé : npm run sceller -- ${ref.f}`);
    }
    if (attendue !== calculee) {
      throw new Error(
        `${ref.f} a changé depuis sa mesure — empreinte ${attendue}, contenu ${calculee}.\n`
        + `  C'est le relevé qu'un clone neuf emploie pour engendrer TOUS les chiffres publiés.\n`
        + `  Aucun d'eux n'a de valeur tant que ce n'est pas éclairci.`);
    }
  }
  if (ref.f !== RELEVE_DE_REFERENCE && !refReferenceAnnoncee) {
    console.warn(`\n⚠ ${RELEVE_DE_REFERENCE} est introuvable : repli sur ${ref.f}, dont les`);
    console.warn(`  chiffres ne sont pas ceux dont le README et landing.json ont été engendrés.\n`);
  }
  if (!refReferenceAnnoncee) {
    refReferenceAnnoncee = true;
    console.warn(`\n⚠ Aucune mesure à vous dans data/profiles.json.`);
    console.warn(`  Lecture du relevé de référence livré avec le dépôt : ${ref.f}`);
    console.warn(`  Ce sont NOS chiffres, pas les vôtres — \`npm run measure\` mesure les vôtres.\n`);
  }
  return ref.p;
}

/** Le quantile d'une série, pour dire une durée avec sa dispersion. */
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const tri = [...xs].sort((a, b) => a - b);
  const i = Math.min(tri.length - 1, Math.max(0, Math.round(q * (tri.length - 1))));
  return tri[i]!;
}

/** Le commit courant et la propreté de l'arbre — lu deux fois : par la mesure, et par sa garde. */
function etatDuDepot(): { commit: string; sale: boolean } | undefined {

    try {
      const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" }).trim();
      const sale = execFileSync("git", ["status", "--porcelain"],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" }).trim().length > 0;
      return { commit, sale };
    } catch { return undefined; }   // dépôt cloné sans git, ou git absent : on n'invente rien
}

export async function measure(
  howMany = 120,
  options: { llm?: boolean; tiers?: TierName[]; cases?: Partial<Record<TierName, number>>; malgreArbreSale?: string; latenceValide?: boolean; malgreCharge?: string; prompt?: NomPrompt } = {},
): Promise<Profiles> {
  /*
   * Measured on the held-out half, never on the training half.
   *
   * The first run gave the rules 100 % on all five fields: they had been written against
   * the very templates used to score them. The parameter is explicit so that getting this
   * wrong takes typing it.
   */
  /*
   * Un `n` par palier, et le tirage reste le même pour tous.
   *
   * Une seule taille pour toute l'échelle forçait un choix qui n'avait pas lieu d'être : les
   * encodeurs à mille cas et les génératifs à cent vingt ne tiennent pas dans un seul
   * `--cases`, donc la passe unique était impossible et le fichier finissait produit par deux
   * passes — d'où une provenance qui ne pouvait pas être exacte.
   *
   * Le découpage est propre parce que le tirage est un préfixe : `generateRecords(120)` rend
   * exactement les cent vingt premiers de `generateRecords(1000)`. Un palier à cent vingt lit
   * donc les mêmes cas que les cent vingt premiers d'un palier à mille, et le test apparié
   * garde son sens entre les deux. Un test tient cette propriété.
   */
  /*
   * Enregistre-t-on les durées de cette passe, ou seulement ses exactitudes ?
   *
   * Par défaut oui ; la garde du bloc CLI met ce drapeau à faux quand la machine est trop
   * chargée pour qu'une durée veuille dire quelque chose. Les exactitudes, elles, sont prises
   * dans tous les cas — elles ne dépendent pas de la charge.
   */
  const latenceValide = options.latenceValide ?? true;

  const combien = (t: TierName) => options.cases?.[t] ?? howMany;
  const maxCas = Math.max(howMany, ...Object.values(options.cases ?? {}).map(Number).filter(Number.isFinite));
  const tousDossiers = generateRecords(maxCas, DECOUPAGE_DE_MESURE);
  const toutesAlertes = generateAlerts(maxCas, DECOUPAGE_DE_MESURE);

  /*
   * Quels paliers, et pourquoi c'est un choix et non un défaut.
   *
   * L'échelle générative demande un serveur Ollama et huit gigaoctets de modèles. La
   * propriété la plus précieuse de ce dépôt est qu'un inconnu le clone et reproduit ses
   * chiffres en deux minutes sans rien installer ; la mettre derrière un téléchargement
   * pour gagner une ligne de tableau serait un mauvais échange.
   */
  const demandes = options.tiers?.length ? options.tiers : null;
  const paliers = demandes ?? (options.llm ? [...ENCODEURS, ...GENERATIFS] : ENCODEURS);
  if (options.llm || paliers.some((e) => (GENERATIFS as string[]).includes(e))) await loadGeneratifs();

  const loadTime = {} as Record<TierName, number>;
  let t = performance.now();
  await loadExtractors();
  const chargeExtraction = performance.now() - t;
  t = performance.now();
  await loadClassifiers();
  const chargeClassement = performance.now() - t;

  /*
   * On écrit après chaque palier, pas à la fin.
   *
   * Une passe sur les deux échelles dure une heure et demie. Écrire une seule fois, à la fin,
   * veut dire qu'une coupure à la quatre-vingt-neuvième minute ne laisse rien — pas un
   * chiffre, pas une trace. C'est arrivable pour des raisons idiotes : une machine qui se met
   * en veille, un `ollama serve` qui meurt, un terminal fermé.
   *
   * La fusion existait déjà pour ne pas effacer les paliers non mesurés ; il suffit de s'en
   * servir plus souvent. Un palier terminé est un palier gardé, et relancer ne refait que ce
   * qui manque.
   */
  const version = etatDuDepot();

  const chargeAvantPasse = { externalBefore: Number(loadavg()[0]!.toFixed(2)), coeurs: cpus().length };
  const provenance = {} as NonNullable<Profiles["provenance"]>;
  const sauver = (ex: Profiles["extraction"], cl: Record<TierName, Profile>, lt: Record<TierName, number>) => {
    const ancien = readProfiles();
    const partiel: Profiles = {
      measuredAt: new Date().toISOString(),
      code: version,
      chargeAvantPasse,
      provenance: { ...(ancien?.provenance ?? {}), ...provenance } as NonNullable<Profiles["provenance"]>,
      extraction: { ...(ancien?.extraction ?? {}), ...ex } as Profiles["extraction"],
      classification: { ...(ancien?.classification ?? {}), ...cl } as Record<TierName, Profile>,
      loadTime: { ...(ancien?.loadTime ?? {}), ...lt } as Record<TierName, number>,
      tiers: [],
    };
    partiel.tiers = Object.keys(partiel.extraction) as TierName[];
    mkdirSync(dirname(FICHIER), { recursive: true });
    /*
     * Écrire à côté, puis renommer.
     *
     * La sauvegarde incrémentale, posée il y a vingt minutes, a créé un défaut qui n'existait
     * pas quand le fichier n'était écrit qu'une fois : il est maintenant réécrit toutes les
     * quelques minutes, et `writeFileSync` tronque avant de remplir. Une lecture concurrente —
     * `npm run figures` pendant une mesure, ce que j'ai fait deux fois aujourd'hui — peut
     * tomber sur un JSON coupé en deux, et une coupure pendant l'écriture laisserait le profil
     * gelé en morceaux.
     *
     * Le renommage est atomique sur le même système de fichiers : un lecteur voit l'ancien
     * fichier ou le nouveau, jamais un fichier à moitié écrit.
     */
    const provisoire = FICHIER + ".tmp";
    writeFileSync(provisoire, JSON.stringify(partiel, null, 2));
    renameSync(provisoire, FICHIER);
  };

  /*
   * Un palier à la fois, ses deux chaînes d'affilée.
   *
   * L'ordre précédent faisait toute l'extraction puis toute la classification, donc traversait
   * les trois modèles génératifs **deux fois**. Chaque bascule fait charger et décharger huit
   * gigaoctets de poids par Ollama, hors de ce processus et hors de `loadTime`, qui ne
   * chronomètre que les encodeurs. Regrouper les deux chaînes d'un même palier supprime la
   * moitié de ces allers-retours sans rien changer aux chiffres — les cas, la graine et le
   * scoreur sont identiques.
   */
  const extraction = {} as Profiles["extraction"];
  const classification = {} as Record<TierName, Profile>;

  /*
   * Une ligne par tentative, écrite au fil de la passe.
   *
   * Les taux ci-dessous restent le produit publié ; ce journal est ce qui permet de répondre à
   * la question suivante sans repayer la machine. Trois passes l'ont appris le même jour.
   * `d.id` sert de clé de cas : un petit tirage est le préfixe exact d'un grand, donc le même
   * identifiant désigne le même document d'un palier à l'autre — c'est ce qui rend l'appariement
   * licite, et un test du dépôt le tient déjà.
   */
  const journal = ouvrirJournal("measure", {
    quoi: "Passe de mesure : exactitude et latence par palier et par champ.",
    split: DECOUPAGE_DE_MESURE, cases: tousDossiers.length,
    commit: version?.commit, sale: version?.sale,
    chargeAvant: chargeAvantPasse.externalBefore,
  });

  for (const tier of paliers) {
    /*
     * Réchauffer ce palier et constater sa résidence, juste avant de le chronométrer.
     *
     * L'éviction est silencieuse : un modèle sorti de mémoire se recharge au premier appel, et
     * la durée relevée est celle d'un chargement. Sans ce réchauffage, le premier appel de
     * chaque palier valait cinq fois sa médiane. La résidence est **constatée**, pas déduite de
     * l'ordre de chargement — un essai sur trois perd un modèle même en chargeant du plus gros
     * au plus petit.
     */
    const resident = await rechauffer(tier);
    const memoire = await residents();

    /* Un échantillon avant le départ, puis toutes les cinq secondes : « pendant » doit être vrai. */
    const chargeAvant = Number(loadavg()[0]!.toFixed(2));
    const echantillons: number[] = [];
    const sonde = setInterval(() => echantillons.push(loadavg()[0]!), 5_000);

    const dossiers = tousDossiers.slice(0, combien(tier));
    const alertes = toutesAlertes.slice(0, combien(tier));
    extraction[tier] = {} as Record<Field, Profile>;
    loadTime[tier] = tier === "rules" || tier === "human" ? 0 : chargeExtraction + chargeClassement;

    for (const champ of FIELDS) {
      let right = 0;
      const durees: number[] = [];
      const bits: string[] = [];
      const sorties: string[] = [];
      for (const d of dossiers) {
        const t0 = performance.now();
        const got = await extract(tier, d, champ, options.prompt ?? "reference");
        const ms = performance.now() - t0;
        durees.push(ms);
        sorties.push(got);
        const bon = correct(got, d.truth[champ]);
        bits.push(bon ? "1" : "0");
        if (bon) right++;
        journal.ligne({
          chain: "extraction", tier, field: champ, caseId: d.id,
          phrasing: options.prompt ?? "reference", split: DECOUPAGE_DE_MESURE,
          outcome: issue(got, d.truth[champ]), ms: Number(ms.toFixed(3)),
          value: got, expected: d.truth[champ],
        });
      }
      /* Durées conservées de la passe précédente quand la machine ne permettait pas de les prendre. */
      const ancienChamp = latenceValide ? undefined : readProfiles()?.extraction?.[tier]?.[champ];
      /*
       * LE PALIER HUMAIN N'EST PAS MESURÉ, ET LE FICHIER DOIT LE DIRE.
       *
       * `extract("human", …)` rend la vérité terrain : c'est une commodité pour que la
       * boucle tourne sur tous les paliers, et le code le dit déjà en toutes lettres. Mais
       * le FICHIER, lui, ne le disait pas. Il enregistrait pour l'humain une exactitude de
       * 1,0 sur 1 000 cas, mille bits de réussite tous à 1, une latence de 0,0005 ms, et une
       * provenance identique à celle d'une vraie mesure — commit, arbre propre, date, et
       * jusqu'à la charge de la machine pendant la passe.
       *
       * Personne ne publie ce chiffre : `accuracy()` lui substitue l'hypothèse. Mais c'est le
       * fichier que l'acheteur ouvre pour vérifier, et la ligne la plus damnante qu'il puisse
       * y trouver est une mesure fabriquée portant toute la panoplie d'une vraie. Le scellé
       * qu'on vient de poser dessus le rendait pire : il déclarait que ce contenu fait foi.
       *
       * On n'enregistre donc plus de bits pour lui — mille « 1 » ne sont pas une observation —
       * et on marque la case. Aucun consommateur n'en pâtit : tous filtrent déjà `human`.
       */
      const commodite = tier === "human";
      extraction[tier][champ] = {
        ...(commodite
          ? { commodite: "ground truth returned so the loop can run over every tier — not a measurement; the human accuracy used anywhere is the assumption, never this" }
          : { reussites: bits.join("") }),
        sorties,
        accuracy: right / dossiers.length,
        latency: ancienChamp?.latency ?? quantile(durees, 0.5),
        latencyP10: ancienChamp?.latencyP10 ?? quantile(durees, 0.1),
        latencyP90: ancienChamp?.latencyP90 ?? quantile(durees, 0.9),
        items: dossiers.length,
      };
    }

    {
      let right = 0;
      const durees: number[] = [];
      const bits: string[] = [];
      const sorties: string[] = [];
      for (const a of alertes) {
        const t0 = performance.now();
        const got = await classify(tier, a);
        const ms = performance.now() - t0;
        durees.push(ms);
        sorties.push(String(got));
        const bon = got === a.truth;
        bits.push(bon ? "1" : "0");
        if (bon) right++;
        journal.ligne({
          chain: "classification", tier, field: "typologie", caseId: a.id,
          phrasing: options.prompt ?? "reference", split: DECOUPAGE_DE_MESURE,
          outcome: bon ? "clean" : String(got).trim().length === 0 ? "blank" : "wrong",
          ms: Number(ms.toFixed(3)), value: String(got), expected: a.truth,
        });
      }
      classification[tier] = {
        reussites: bits.join(""),
        sorties,
        accuracy: right / alertes.length,
        latency: quantile(durees, 0.5),
        latencyP10: quantile(durees, 0.1),
        latencyP90: quantile(durees, 0.9),
        items: alertes.length,
      };
    }

    /* La provenance est écrite avec le palier, pas avec le fichier. */
    /*
     * La résidence appartient à la latence, pas à l'exactitude.
     *
     * Une durée prise sur un modèle évincé et une durée prise sur un modèle résident sont deux
     * grandeurs différentes, et rien dans ce fichier ne les distinguait. L'exactitude, elle,
     * ne bouge pas : mesurée identique au dixième sur 984 tentatives à deux charges.
     */
    const residence = {
      residentAvantLaMesure: resident,
      residentsPendant: memoire.map((m) => m.nom),
      octetsResidents: memoire.reduce((a, m) => a + m.octets, 0),
    };

    const bloc: Provenance = {
      commit: version?.commit ?? null,
      sale: version?.sale ?? null,
      measuredAt: new Date().toISOString(),
      ...(options.malgreArbreSale ? { malgreArbreSale: options.malgreArbreSale } : {}),
      ...(options.malgreCharge ? { chargeFabriqueePar: options.malgreCharge } : {}),
      /* Toujours, y compris la référence : sans ça, « mesuré sous la référence » et
         « formulation non enregistrée » se lisent pareil, ce qui est le défaut du `null`
         qu'on corrige partout ailleurs. */
      promptUtilise: options.prompt ?? "reference",
      charge: {
        externalBefore: chargeAvant,
        totalDuring: Number((echantillons.length
          ? echantillons.reduce((a, b) => a + b, 0) / echantillons.length
          : loadavg()[0]!).toFixed(2)),
        coeurs: cpus().length,
      },
    };
    clearInterval(sonde);
    /* L'exactitude est toujours la nôtre ; la latence ne l'est que si la machine le permettait. */
    const avant = readProfiles()?.provenance?.[tier];
    provenance[tier] = {
      accuracy: bloc,
      latency: latenceValide ? { ...bloc, ...residence } : (avant?.latency ?? { ...bloc, ...residence }),
    };
    sauver(extraction, classification, loadTime);
  }

  /*
   * On fusionne, on n'écrase pas.
   *
   * `npm run measure` mesure les encodeurs. S'il réécrivait le fichier entier, il
   * effacerait les paliers génératifs figés — et le dépôt perdrait en silence la moitié de
   * ses figures publiées parce que quelqu'un a lancé la commande la plus inoffensive du
   * projet. Chaque palier n'écrase que lui-même.
   */
  const ancien = readProfiles();
  const profils: Profiles = {
    measuredAt: new Date().toISOString(),
    /*
     * Le commit, que cette écriture-ci oubliait.
     *
     * `sauver` l'inscrit à chaque palier terminé, mais cette écriture finale reconstruit
     * l'objet de zéro et n'en reprenait pas la clé : toute mesure **complète** perdait donc
     * son commit, alors qu'une mesure interrompue le gardait. L'anomalie est exactement à
     * l'envers de l'intuition, et invisible tant qu'on ne regarde que des mesures menées à
     * leur terme — c'est-à-dire toutes celles qu'on publie.
     *
     * Trouvé par le test de provenance, sur la première re-mesure réelle qui l'ait exercé.
     */
    code: version,
    chargeAvantPasse,
    provenance: { ...(ancien?.provenance ?? {}), ...provenance } as NonNullable<Profiles["provenance"]>,
    extraction: { ...(ancien?.extraction ?? {}), ...extraction } as Profiles["extraction"],
    classification: { ...(ancien?.classification ?? {}), ...classification } as Record<TierName, Profile>,
    loadTime: { ...(ancien?.loadTime ?? {}), ...loadTime } as Record<TierName, number>,
    tiers: [],
  };
  profils.tiers = (Object.keys(profils.extraction) as TierName[]);
  mkdirSync(dirname(FICHIER), { recursive: true });
  /* le scellé se pose sur le contenu final, et il s'exclut lui-même du calcul */
  (profils as Record<string, unknown>).empreinte = empreinteDuReleve(profils);
  writeFileSync(FICHIER, JSON.stringify(profils, null, 2));
  const { lignes, chemin } = journal.fermer();
  console.log(`\n${lignes} tentatives enregistrées dans ${chemin.split("/").slice(-2).join("/")}`);
  return profils;
}

if (isMain(import.meta)) {
  const llm = process.argv.includes("--llm");
  /* `--cases=N` : la taille d'échantillon est un réglage, pas une constante. À 120 cas le
     plus petit écart détectable est d'environ dix-huit points ; à 1 000, de six. */
  const cases = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 120);
  if (!Number.isFinite(cases) || cases < 20) {
    console.error("--cases doit valoir au moins 20 : en dessous, un taux n'est pas rapportable.");
    process.exit(1);
  }
  /*
   * `--cases-gen=N` : l'échelle générative se mesure à sa propre taille.
   *
   * Sans ça, monter les encodeurs à mille cas emportait les génératifs avec eux — plusieurs
   * heures pour un intervalle dont aucune décision ne dépend — et les laisser à cent vingt
   * imposait de faire deux passes, donc deux états d'arbre dans un seul fichier.
   */
  const casesGen = Number(process.argv.find((a) => a.startsWith("--cases-gen="))?.split("=")[1] ?? cases);
  if (!Number.isFinite(casesGen) || casesGen < 20) {
    console.error("--cases-gen doit valoir au moins 20 : en dessous, un taux n'est pas rapportable.");
    process.exit(1);
  }

  /* `--tiers=a,b` remesure ces paliers-là seulement. La fusion garde les autres intacts,
     donc on peut refaire une latence sans refaire vingt minutes d'encodeurs. */
  const brut = process.argv.find((a) => a.startsWith("--tiers="))?.split("=")[1]?.split(",");
  /* Un nom de palier mal tapé produisait un profil avec une clé inventée, sans un mot. */
  const inconnus = brut?.filter((e) => !(TIERS as string[]).includes(e)) ?? [];
  if (inconnus.length) {
    console.error(`palier inconnu : ${inconnus.join(", ")}\nles paliers sont : ${TIERS.join(", ")}`);
    process.exit(1);
  }
  const choisis = brut as TierName[] | undefined;

  /* Le message doit décrire ce qui va tourner, pas ce que le drapeau le plus courant suggère.
     Il annonçait « the encoder ladder » pendant une mesure de l'échelle générative parce
     qu'il ne regardait que `--llm` — un rapport faux sur son propre travail, dans un dépôt
     qui n'existe que pour refuser ça. */
  const aTourner = choisis ?? (llm ? [...ENCODEURS, ...GENERATIFS] : ENCODEURS);
  const generatifs = aTourner.filter((e) => (GENERATIFS as string[]).includes(e));
  /*
   * Une durée mesurée sur une machine occupée mesure la machine, pas le modèle.
   *
   * La même passe a rendu `gen-8b` à 7 920 ms sous une charge de 3,45 et à 10 445 ms sous
   * 7,98 — trente-deux pour cent d'écart sans qu'une ligne ait changé, parce que celui qui
   * mesurait faisait tourner autre chose à côté. Le relevé n'en portait aucune trace, et la
   * page publie ces durées contre un plafond de deux secondes.
   *
   * Le seuil est par cœur, pas absolu : une charge de 4 est confortable sur seize cœurs et
   * étouffante sur deux. Au-delà, on mesure quand même l'exactitude — elle est déterministe —
   * mais on **garde les durées précédentes** et on le dit dans la provenance, plutôt que de
   * remplacer de bons chiffres par des moins bons sans que rien ne l'indique.
   */
  const coeurs = cpus().length;
  const chargeParCoeur = loadavg()[0]! / coeurs;
  /*
   * `--allow-load="node src/charger.mjs 8"` — la commande, pas une phrase.
   *
   * `--allow-dirty` inscrivait déjà sa raison ; celle-ci ne le faisait pas, alors que c'est
   * la garde qu'on contourne exprès pour mesurer sous charge. Une raison en texte libre se
   * lit et s'interprète ; nommer le script et son argument fait de la reproduction une
   * commande. Le relevé porte les deux : ce qui a été lancé, et la charge constatée avant.
   */
  const brutCharge = process.argv.find((a) => a.startsWith("--allow-load"));
  const malgreCharge = brutCharge ? (brutCharge.split("=")[1] || "raison non donnée") : undefined;
  const latenceValide = chargeParCoeur <= CHARGE_MAX_PAR_COEUR || malgreCharge !== undefined;
  if (!latenceValide) {
    console.warn(`\n⚠ charge ${loadavg()[0]!.toFixed(2)} sur ${coeurs} cœurs `
      + `(${(100 * chargeParCoeur).toFixed(0)} %, seuil ${(100 * CHARGE_MAX_PAR_COEUR).toFixed(0)} %) — trop pour chronométrer.`);
    console.warn(`  Les exactitudes seront mesurées, les durées précédentes conservées.`);
    console.warn(`  Fermez ce qui tourne, ou --allow-load pour enregistrer quand même.\n`);
  }

  /*
   * On ne mesure pas sur un arbre sale, et ça ne se rattrape pas après coup.
   *
   * Le relevé porte déjà `sale` : on pouvait donc mesurer, s'en apercevoir en lisant le
   * fichier, et recommencer. C'est ce qui vient d'arriver — la leçon « committer avant de
   * mesurer » avait été écrite le matin et n'a pas été appliquée le soir, ce qui a coûté trois
   * paliers marqués non reproductibles et quarante minutes à refaire.
   *
   * Un champ qu'on lit après coup ne protège de rien : il faut que la mesure ne parte pas.
   * `--allow-dirty="raison"` reste possible — on mesure parfois délibérément un code en cours —
   * mais la raison s'écrit alors dans la provenance de chaque palier, pour qu'un relecteur
   * sache que c'était voulu et pourquoi, au lieu de le supposer.
   */
  const etat = etatDuDepot();
  const brutSale = process.argv.find((a) => a.startsWith("--allow-dirty"));
  const malgreArbreSale = brutSale ? (brutSale.split("=")[1] || "raison non donnée") : undefined;
  if (etat?.sale && !malgreArbreSale) {
    console.error(`\nL'arbre de travail porte des modifications non enregistrées.`);
    console.error(`Chaque palier mesuré serait marqué non reproductible, y compris par vous.\n`);
    console.error(`  git commit -am "…"        puis relancez`);
    console.error(`  ou --allow-dirty="pourquoi"  si c'est délibéré — la raison ira dans le relevé\n`);
    process.exit(1);
  }

  /*
   * Le seul chemin par lequel des dossiers peuvent quitter cette machine.
   *
   * Un `OLLAMA_HOST` distant envoie chaque document à un tiers. C'est une configuration
   * légitime — un serveur d'équipe — mais elle contredit la phrase que ce dépôt publie, et
   * quelqu'un qui mesure sur de vrais dossiers doit l'avoir voulue explicitement plutôt que
   * l'avoir héritée d'un `.env` oublié. On s'arrête, on nomme l'hôte, et on demande un
   * drapeau : un consentement se tape, il ne se déduit pas.
   */
  if (!estLocal(OLLAMA) && !process.argv.includes("--remote-ollama")) {
    console.error(`\nOLLAMA_HOST vise ${OLLAMA}, qui n'est pas cette machine.`);
    console.error(`Chaque document mesuré partirait chez cet hôte.\n`);
    console.error(`Si c'est voulu, relancez avec --remote-ollama. Sinon, retirez OLLAMA_HOST.\n`);
    process.exit(1);
  }

  console.log(`\nMeasuring ${aTourner.filter((e) => e !== "human").join(", ")} on ${cases} held-out cases.`);
  if (generatifs.length) console.log("Needs Ollama running. Allow a few minutes per generative tier.");
  else console.log("Encoders only. First run downloads 1.26 GB of model weights — allow several minutes\non a fast line, longer on a slow one. Add --llm for the generative tiers (eight gigabytes more).");
  console.log("Tiers not measured here keep their frozen figures.\n");

  /* `--prompt=C-minimal` : mesurer sous une autre formulation, en l'inscrivant dans le relevé. */
  const brutPrompt = process.argv.find((a) => a.startsWith("--prompt="))?.split("=")[1];
  if (brutPrompt && !(brutPrompt in PROMPTS)) {
    console.error(`formulation inconnue : ${brutPrompt}\nles formulations sont : ${Object.keys(PROMPTS).join(", ")}`);
    process.exit(1);
  }
  const prompt = brutPrompt as NomPrompt | undefined;

  const parPalier = Object.fromEntries(GENERATIFS.map((t) => [t, casesGen])) as Partial<Record<TierName, number>>;
  const p = await measure(cases, { llm, tiers: choisis, cases: parPalier, malgreArbreSale, latenceValide, malgreCharge, prompt });
  const pc = (x: number) => (x * 100).toFixed(1).padStart(5) + " %";

  console.log("CHAIN A — extraction, accuracy per field\n");
  console.log("tier      " + FIELDS.map((c) => c.padStart(10)).join("") + "     latency");
  console.log("─".repeat(76));
  for (const e of (p.tiers ?? [])) {
    const l = FIELDS.map((c) => pc(p.extraction[e][c].accuracy).padStart(10)).join("");
    const lat = (FIELDS.reduce((s, c) => s + p.extraction[e][c].latency, 0) / FIELDS.length).toFixed(2);
    console.log(`${e.padEnd(10)}${l}   ${lat.padStart(7)} ms`);
  }

  console.log("\n\nCHAIN B — alert classification\n");
  console.log("tier         accuracy    latency");
  console.log("─".repeat(36));
  for (const e of (p.tiers ?? [])) {
    console.log(`${e.padEnd(12)}${pc(p.classification[e].accuracy)}   ${p.classification[e].latency.toFixed(2).padStart(7)} ms`);
  }
  console.log(`\nProfiles frozen in data/profiles.json — ${p.measuredAt}\n`);
}
