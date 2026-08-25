/**
 * The tiers of the cascade.
 *
 * Four per chain, cheapest to dearest: rules, a small model, a large one, a human. That is
 * the ladder found in every real processing chain, and the question nobody asks is:
 * **does it really have to be the same tier everywhere?**
 *
 * The models run locally. No API key, no network call, and the repository stays runnable
 * by anyone who clones it without paying.
 */

import { pipeline, env as envHF } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { FIELDS, TYPOLOGIES } from "./corpus.ts";
import type { Field, ClientFile, Alert, Typology } from "./corpus.ts";

import type { TierName } from "./paliers.ts";
import { estGeneratif } from "./paliers.ts";
export type { TierName };
export { TIERS, ENCODEURS, GENERATIFS, estGeneratif } from "./paliers.ts";

/* ══════════════════ Chain A — extract ══════════════════ */

/**
 * LA QUESTION D'UN CHAMP, ET D'OU ELLE VIENT.
 *
 * `QUESTIONS` n'a jamais connu que NOS cinq champs. Un client qui lance `measure:yours` avec
 * ses propres colonnes — `nom_complet`, `pays` — obtenait donc `undefined`, et les deux
 * chemins echouaient differemment : l'encodeur plantait avec un message de bibliotheque qui
 * parle d'autre chose, et le generatif demandait litteralement « Question: undefined » puis
 * rendait du bruit **sans rien signaler**. Le second est le pire des deux.
 *
 * La question se resout donc en un seul endroit, et elle porte sa provenance :
 *
 *   fournie   le client l'a ecrite — c'est un CHOIX, le sien
 *   mesuree   c'est un de nos cinq champs, et le taux publie a ete mesure sous cette question
 *   deduite   fabriquee depuis le nom de colonne — un CHOIX que nous faisons pour lui, et
 *             qui doit s'afficher pour qu'il puisse le corriger
 *
 * Une question deduite n'est pas une mesure. Le taux qu'elle produit n'est pas comparable a
 * celui du README, et l'outil doit le dire la ou il l'affiche.
 */
export type Question = { texte: string; provenance: "fournie" | "mesuree" | "deduite" };

export function questionPour(champ: string, fournies?: Record<string, string>): Question {
  const f = fournies?.[champ];
  if (typeof f === "string" && f.trim().length > 0) return { texte: f.trim(), provenance: "fournie" };
  const nôtre = (QUESTIONS as Record<string, string>)[champ];
  if (nôtre) return { texte: nôtre, provenance: "mesuree" };
  /* Deduite du nom de colonne : les separateurs deviennent des espaces, rien d'autre. On ne
     traduit pas et on ne devine pas le sens — inventer « date de naissance » a partir de
     `date_naissance` marcherait ici et echouerait sur la colonne suivante. */
  const lisible = champ.replace(/[_\-.]+/g, " ").trim();
  return { texte: `What is the ${lisible}?`, provenance: "deduite" };
}

const QUESTIONS: Record<Field, string> = {
  name: "What is the name of the client?",
  birth: "What is the date of birth?",
  document: "What is the identity document number?",
  country: "What is the nationality or country?",
  address: "What is the address?",
};

/**
 * The rules.
 *
 * Excellent where the format is constrained and dismal everywhere else — which is exactly
 * why routing per field makes sense. A document number shaped `XX-9999-Y` needs no model;
 * a free-text address does.
 */
/* Les 280 noms de pays d'ICU, triés du plus long au plus court pour que « United States »
   gagne sur « States ». Construits une fois : `Intl.DisplayNames` coûte à chaque appel. */
const PAYS_DU_MONDE: string[] = (() => {
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  const out: string[] = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const c = String.fromCharCode(a, b);
    const n = dn.of(c);
    if (n && n !== c && !/^\d/.test(n) && n.length > 3) out.push(n);
  }
  return out.sort((x, y) => y.length - x.length);
})();

export const RULES: Record<Field, (t: string) => string> = {
  /*
   * ─── LA FORME TROUVE LES CANDIDATS, LE MOT-CLÉ DÉPARTAGE ───
   *
   * Cette règle cherchait `[A-Z]{2}-\d{4}-[A-Z]` : le seul format que notre générateur
   * produit. 81,7 % ici, et **0,0 % sur 198 numéros de pièce réels** de la liste SDN de
   * l'OFAC. Ce n'était pas une règle, c'était une copie du vocabulaire du corpus.
   *
   * DEUX APPROCHES ONT ÉCHOUÉ AVANT CELLE-CI, ET LEURS ÉCHECS DONNENT LA CONSTRUCTION.
   *
   * Le MOT-CLÉ SEUL est un vocabulaire : notre corpus produit à lui seul cent neuf
   * introducteurs différents — « doc no », « Document ........ », « reference supplied was »,
   * « We hold », « id » — et l'OFAC en a d'autres. Mesuré : 98 % sur la distribution qui l'a
   * écrit, 40 % sur l'autre.
   *
   * La FORME SEULE trouve tous les candidats et choisit mal quand il y en a plusieurs : elle
   * rendait un numéro de sécurité sociale là où un passeport était attendu. 72,7 %.
   *
   * Donc le mot-clé n'est pas une PORTE, il est un DÉPARTAGE. Un texte sans aucun mot-clé
   * connu obtient quand même une réponse ; un texte qui en porte un fait gagner le candidat
   * qui le suit. C'est ce qui permet de tenir sur une distribution dont on ne connaît pas le
   * vocabulaire — la seule propriété qui compte pour un client.
   *
   * Mesuré sur les deux : 81,7 % ici (identique à l'ancienne, donc le chiffre publié ne
   * bouge pas) et 76,8 % sur l'OFAC, où l'ancienne rendait zéro.
   */
  document: (t) => {
    const MOIS = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    const INDICES = /(?:passport|national id|c\.u\.r\.p\.|cedula|r\.f\.c\.|tax id|identification number|residency|identity card|licen[cs]e|document|doc\.? ?no|référence|reference|id\b|we hold|pièce)/gi;
    const candidats: { v: string; at: number; score: number; distance: number }[] = [];
    /* Une espace interne est permise : « AO 2879097 » et « 265 216 » sont des numéros. */
    for (const m of t.matchAll(/\b[A-Z0-9][A-Z0-9\-/]*(?: [A-Z0-9\-/]+)?[A-Z0-9]\b/g)) {
      const v = m[0].trim();
      if (v.length < 5) continue;
      const lettres = (v.match(/[A-Z]/g) ?? []).length;
      const chiffres = (v.match(/\d/g) ?? []).length;
      if (MOIS.test(v)) continue;
      if (chiffres && !lettres && (v.match(/\//g) ?? []).length >= 2) continue;   /* une date */
      if (!lettres && chiffres < 5) continue;                                      /* une année */
      if (lettres && !chiffres) continue;                                          /* un mot */
      candidats.push({ v, at: m.index, score: chiffres + lettres * 2 + (v.includes("-") ? 3 : 0), distance: Infinity });
    }
    if (!candidats.length) return "";
    const indices = [...t.matchAll(INDICES)].map((m) => m.index + m[0].length);
    for (const c of candidats) {
      const avant = indices.filter((i) => i <= c.at);
      c.distance = avant.length ? c.at - Math.max(...avant) : Infinity;
    }
    const proche = Math.min(...candidats.map((c) => c.distance));
    const enTete = proche <= 3 ? candidats.filter((c) => c.distance === proche) : candidats;
    enTete.sort((a, b) => b.score - a.score || b.v.length - a.v.length);
    return enTete[0]!.v;
  },
  /*
   * ─── LES MOIS ABRÉGÉS, ET LA PREMIÈRE DATE PLUTÔT QUE N'IMPORTE LAQUELLE ───
   *
   * Cette règle exigeait les mois en toutes lettres — « October » — parce que c'est ce que
   * notre générateur écrit. L'OFAC écrit « Jun ». 100 % ici, 6,9 % sur 290 dates réelles.
   *
   * Quatre formes maintenant, et le même départage : `DOB`, `born`, `date of birth` font
   * gagner la date qui suit. Sans mot-clé, la PREMIÈRE — une date de naissance précède les
   * dates d'expiration d'un document.
   *
   * Mesuré : 100 % ici (inchangé) et 100 % sur l'OFAC, contre 6,9 % avant.
   */
  birth: (t) => {
    const MOIS = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*`;
    const formes = [
      new RegExp(String.raw`\b\d{1,2}\s+${MOIS}\.?\s+\d{4}\b`, "g"),
      new RegExp(String.raw`\b${MOIS}\.?\s+\d{1,2},?\s+\d{4}\b`, "g"),
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
      /\b\d{4}-\d{2}-\d{2}\b/g,
    ];
    const cands: { v: string; at: number; distance: number }[] = [];
    const indices = [...t.matchAll(/(?:DOB|date of birth|born|dob|b\.|naissance)/gi)].map((m) => m.index + m[0].length);
    for (const f of formes) {
      for (const m of t.matchAll(f)) {
        const av = indices.filter((x) => x <= m.index);
        cands.push({ v: m[0], at: m.index, distance: av.length ? m.index - Math.max(...av) : Infinity });
      }
    }
    if (!cands.length) return "";
    const proche = Math.min(...cands.map((c) => c.distance));
    const enTete = (proche <= 4 ? cands.filter((c) => c.distance === proche) : cands).sort((a2, b2) => a2.at - b2.at);
    return enTete[0]!.v;
  },
  /*
   * ─── LA LISTE VIENT DU MONDE, PAS DE NOUS ───
   *
   * Cette règle énumérait huit pays : exactement les huit que `corpus.ts` engendre. Les deux
   * listes étaient identiques mot pour mot, donc le 100 % publié mesurait que la règle et le
   * corpus avaient été écrits par la même main. Sur 266 pays réels de la liste SDN : 1,9 %.
   *
   * `Intl.DisplayNames` rend les 280 noms de pays d'ICU, intégré à Node : aucune dépendance,
   * et surtout un vocabulaire que nous n'avons pas choisi. C'est la seule propriété qui
   * compte — une liste qu'on écrit soi-même décrit ce qu'on a imaginé.
   *
   * Même construction que `document` : le nom de pays trouve les candidats, le mot-clé
   * (`nationality`, `citizen`, `POB`) départage. Sans mot-clé, le DERNIER mentionné, comme
   * avant — c'est une heuristique, et elle est dite plutôt que cachée.
   *
   * Mesuré sur les deux : 100 % ici (inchangé) et 88,7 % sur l'OFAC, au-dessus de l'encodeur
   * payant qui rend 85,3 %.
   */
  country: (t) => {
    const indices = [...t.matchAll(/(?:nationality|citizen(?:ship)?|POB|place of birth|national of|issued (?:in|by))/gi)]
      .map((m) => m.index + m[0].length);
    const trouves: { p: string; at: number; distance: number }[] = [];
    for (const p of PAYS_DU_MONDE) {
      let i = -1;
      while ((i = t.indexOf(p, i + 1)) !== -1) {
        const avant = t[i - 1], apres = t[i + p.length];
        if ((avant === undefined || !/[A-Za-z]/.test(avant)) && (apres === undefined || !/[A-Za-z]/.test(apres))) {
          const av = indices.filter((x) => x <= i);
          trouves.push({ p, at: i, distance: av.length ? i - Math.max(...av) : Infinity });
        }
      }
    }
    if (!trouves.length) return "";
    const proche = Math.min(...trouves.map((c) => c.distance));
    if (proche <= 4) {
      const t2 = trouves.filter((c) => c.distance === proche).sort((a2, b2) => b2.p.length - a2.p.length);
      return t2[0]!.p;
    }
    trouves.sort((a2, b2) => a2.at - b2.at);
    return trouves[trouves.length - 1]!.p;
  },
  name: (t) =>
    t.match(/(?:Client|name|application from|The applicant,)\s*:?\s*([A-Z][a-zà-ÿ]+\s[A-Z][a-zà-ÿ]+)/)?.[1]
    ?? t.match(/^([A-Z][a-zà-ÿ]+\s[A-Z][a-zà-ÿ]+)\s*\(/)?.[1] ?? "",
  address: (t) =>
    t.match(/(?:residing at|address(?: on file)?:?|live at|declared address is)\s*([^.]+?)\./i)?.[1]?.trim() ?? "",
};

/*
 * The exact revision of each model, not just its name.
 *
 * A name on a public hub points at whatever was uploaded last. Someone cloning this in
 * six months would download a different set of weights and get different numbers from the
 * ones this README publishes — and would have no way to tell that is what happened.
 *
 * These hashes are what was actually measured.
 */
export const REVISIONS = {
  small: "bdbb0a5e9c61",
  large: "6d1aeed784b6",
  embSmall: "751bff37182d",
  embLarge: "761b726dd34f",
} as const;

/**
 * La licence de chaque modèle, à côté de sa révision.
 *
 * Une révision épinglée dit *quoi* a été mesuré. Une licence dit si le résultat est
 * déployable — et c'est la première question d'un service achats, posée avant même de
 * regarder un chiffre d'exactitude. Une réponse manquante ne ralentit pas une vente, elle
 * la bloque.
 *
 * Une seule mérite qu'on s'y arrête : `roberta-base-squad2` est en CC-BY-4.0, qui **exige
 * l'attribution**. Les six autres sont permissives sans condition pratique. Un routage qui
 * met ce palier sur un champ engage donc une obligation que les autres n'engagent pas, et
 * personne ne s'en apercevrait en lisant un tableau d'exactitudes.
 *
 * Relevé le 19 août 2026 depuis les fiches officielles.
 */
export const LICENCES: Record<string, { modele: string; licence: string; note?: string }> = {
  small: { modele: "distilbert-base-cased-distilled-squad", licence: "Apache-2.0" },
  large: {
    modele: "roberta-base-squad2", licence: "CC-BY-4.0",
    note: "attribution required — the only practical condition in the whole set",
  },
  embSmall: { modele: "all-MiniLM-L6-v2", licence: "Apache-2.0" },
  embLarge: { modele: "multilingual-e5-small", licence: "MIT" },
  "gen-0.6b": { modele: "Qwen3-0.6B", licence: "Apache-2.0" },
  "gen-4b": { modele: "Qwen3-4B", licence: "Apache-2.0" },
  "gen-8b": { modele: "Qwen3-8B", licence: "Apache-2.0" },
};

/* ══════════════════ L'échelle générative, par Ollama ══════════════════ */

/**
 * Les trois modèles génératifs, épinglés par leur empreinte.
 *
 * Même raison que `REVISIONS` : `qwen3:4b` désigne ce qui a été publié en dernier sous ce
 * nom. Quelqu'un qui clone dans six mois tirerait d'autres poids et obtiendrait d'autres
 * chiffres, sans aucun moyen de s'en apercevoir. Ces empreintes sont ce qui a été mesuré.
 */
export const MODELES_LOCAUX: Record<string, { tag: string; digest: string }> = {
  "gen-0.6b": { tag: "qwen3:0.6b", digest: "7df6b6e09427" },
  "gen-4b": { tag: "qwen3:4b", digest: "359d7dd4bcda" },
  "gen-8b": { tag: "qwen3:8b", digest: "500a1f067a9f" },
};

/**
 * Le seul hôte qu'une mesure contacte — et la seule façon dont vos dossiers pourraient sortir.
 *
 * Tout le reste du chemin d'une mesure est local : le corpus est engendré en mémoire, les
 * encodeurs tournent dans le processus, rien n'est téléversé. Il reste exactement un appel
 * réseau, celui-ci, et il vise par défaut la boucle locale.
 *
 * Mais `OLLAMA_HOST` est une variable d'environnement. Pointée sur une machine distante — un
 * serveur d'équipe, un Ollama hébergé — chaque document part chez ce tiers, et la phrase
 * « rien ne quitte votre machine » devient fausse sans qu'une ligne de code ait changé. C'est
 * la seule configuration où ça arrive, et rien ne la signalait.
 *
 * `estLocal` existe donc pour être vérifiable : par un test, et par la mesure elle-même, qui
 * refuse de partir vers un hôte distant sans un consentement écrit dans la commande.
 */
export const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/**
 * Les poids d'encodeur sont-ils déjà sur cette machine ?
 *
 * POURQUOI CETTE QUESTION REMPLACE UNE QUESTION DE DURÉE. Un cas qui lance le chemin client
 * et l'entoure d'un délai suppose une vitesse de réseau. Le premier chargement prend 578 s
 * mesurées sur un lien ; sur un lien deux fois plus lent, n'importe quel délai qu'on choisit
 * se fait dépasser. Un chiffre de marge est un chiffre contre un seul réseau.
 *
 * La présence des poids, elle, ne dépend d'aucun réseau. On la regarde, et le mur de dix
 * minutes devient une étape nommée au lieu d'un cas de test qui meurt à mi-téléchargement.
 *
 * Les poids vivent sous `node_modules`, ce que le paquet décide et pas nous — donc on cherche
 * les dossiers de modèles plutôt que d'affirmer un chemin de fichier. Si la bibliothèque
 * change sa disposition, cette fonction rend `false` et le cas se déclare ignoré : c'est la
 * bonne dégradation, elle ne fabrique pas un vert.
 */
export function racineDesPoids(racine?: string): string {
  return racine
    ?? fileURLToPath(new URL("../node_modules/@huggingface/transformers/.cache", import.meta.url));
}

/**
 * LE POIDS EXACT DE CHAQUE MODÈLE ÉPINGLÉ.
 *
 * Un total ne dit pas si un fichier est entier. L'ancien contrôle additionnait tout le cache
 * et demandait « plus de 50 Mo ? » : un `model.onnx` **tronqué à 57 Mo** lui suffisait, et il
 * répondait oui. Le cas s'exécutait, onnxruntime ouvrait un protobuf coupé, et le PROCESSUS
 * s'abattait — `libc++abi … mutex lock failed: Invalid argument`, code 134, sans nommer le
 * fichier. Le bon ordre de grandeur était écrit trois lignes plus haut, dans le commentaire du
 * garde appelant : « un téléchargement de 740 Mo ». Deux fichiers, deux chiffres, personne ne
 * les avait lus ensemble.
 *
 * PROVENANCE DE CES OCTETS : relevés le 25 août 2026 sur **quatre caches indépendants**
 * (`casc-clean`, `casc-head`, `casc-ref`, `casc-mut`), qui donnent les quatre mêmes tailles au
 * bit près. Ce sont les tailles servies pour les révisions épinglées ci-dessus ; changer une
 * révision oblige à relever la sienne, et c'est voulu — un poids non relevé n'a rien à
 * vérifier.
 */
export const POIDS_MODELES = {
  small: { depot: "Xenova/distilbert-base-cased-distilled-squad", revision: REVISIONS.small,
    octets: 260_905_268 },
  large: { depot: "onnx-community/roberta-base-squad2-ONNX", revision: REVISIONS.large,
    octets: 496_550_525 },
  embSmall: { depot: "Xenova/all-MiniLM-L6-v2", revision: REVISIONS.embSmall,
    octets: 90_387_606 },
  embLarge: { depot: "Xenova/multilingual-e5-small", revision: REVISIONS.embLarge,
    octets: 470_268_533 },
} as const;

export type CleModele = keyof typeof POIDS_MODELES;

/** Les modèles que `loadExtractors` ouvre, et ceux que `loadClassifiers` ouvre. */
export const MODELES_EXTRACTION: readonly CleModele[] = ["small", "large"];
export const MODELES_CLASSEMENT: readonly CleModele[] = ["embSmall", "embLarge"];

export type EtatModele = { cle: CleModele; chemin: string; taille: number; attendu: number };

/**
 * Les modèles PRÉSENTS mais dont le fichier n'a pas la taille servie.
 *
 * Absent et tronqué ne sont pas la même chose et n'appellent pas la même réponse : un modèle
 * absent est un premier lancement, qui doit télécharger ; un modèle tronqué est un
 * téléchargement interrompu, qui ne guérira jamais tout seul et qui abat le processus.
 */
export function modelesTronques(cles: readonly CleModele[], racine?: string): EtatModele[] {
  const base = racineDesPoids(racine);
  const abimes: EtatModele[] = [];
  for (const cle of cles) {
    const m = POIDS_MODELES[cle];
    /* Les deux dispositions que la bibliothèque écrit : avec la révision épinglée, et sans.
       Ce sont des chemins CALCULÉS depuis `POIDS_MODELES`, pas une liste de fichiers écrite
       à la main — ce que la table déclare est confronté au disque juste en dessous. */
    const avecRevision = join(base, m.depot, m.revision, "onnx", "model.onnx");
    const sansRevision = join(base, m.depot, "onnx", "model.onnx");
    for (const chemin of [avecRevision, sansRevision]) {
      if (!existsSync(chemin)) continue;
      const taille = statSync(chemin).size;
      if (taille !== m.octets) abimes.push({ cle, chemin, taille, attendu: m.octets });
    }
  }
  return abimes;
}

/** Les modèles dont aucun fichier n'est là — un premier lancement, pas une panne. */
export function modelesAbsents(cles: readonly CleModele[], racine?: string): CleModele[] {
  const base = racineDesPoids(racine);
  return cles.filter((cle) => {
    const m = POIDS_MODELES[cle];
    return !existsSync(join(base, m.depot, m.revision, "onnx", "model.onnx"))
      && !existsSync(join(base, m.depot, "onnx", "model.onnx"));
  });
}

const enMo = (n: number): string => (n / 1_000_000).toFixed(1) + " MB";

/**
 * REFUSER AVANT `pipeline(...)`, PARCE QU'APRÈS IL N'Y A PLUS DE JS POUR PARLER.
 *
 * Un abort natif ne désigne rien : ni le fichier, ni la taille, ni la commande. Le client qui
 * a coupé son premier téléchargement le revoit à chaque exécution suivante et n'a aucun moyen
 * de savoir quoi faire. Le refus, lui, se résout sans nous.
 */
export function exigerModelesEntiers(cles: readonly CleModele[], racine?: string): void {
  const abimes = modelesTronques(cles, racine);
  if (abimes.length === 0) return;
  const lignes = abimes.map((a) =>
    `  ${a.chemin}\n    is ${enMo(a.taille)}, should be ${enMo(a.attendu)} `
    + `(${a.taille.toLocaleString("en-GB")} of ${a.attendu.toLocaleString("en-GB")} bytes)`);
  throw new Error(
    `${abimes.length} model file(s) in the cache are incomplete — an interrupted download.\n\n`
    + lignes.join("\n") + `\n\n`
    + `  Loading one of these aborts the process natively, which is why this stops here.\n`
    + `  Delete the directory above and run the same command again; it downloads what is missing.\n`);
}

/**
 * POURQUOI LES POIDS NE SONT PAS UTILISABLES — parce que « pas là » et « là mais coupé »
 * n'appellent pas la même action.
 *
 * Mesuré le 25 août 2026 avec un `model.onnx` tronqué à 57 905 102 octets : le garde
 * répondait « les poids sont là », le cas s'exécutait, le sous-processus s'abattait, et le
 * cas se déclarait ignoré avec **« sous-processus tué par le délai »** — en 242 ms. Le
 * message accusait une lenteur là où il y avait un fichier coupé, et le contrôle le plus
 * important du dépôt passait pour un ignoré ordinaire.
 */
export function diagnosticDesPoids(
  cles: readonly CleModele[] = MODELES_EXTRACTION, racine?: string,
): string | undefined {
  const abimes = modelesTronques(cles, racine);
  if (abimes.length > 0) {
    const a = abimes[0]!;
    return `${abimes.length} model file(s) in the cache are incomplete — an interrupted `
      + `download, not a slow machine.\n  ${a.chemin}\n    is ${enMo(a.taille)}, should be `
      + `${enMo(a.attendu)}.\n  Delete that directory and run a command that loads the models.`;
  }
  const absents = modelesAbsents(cles, racine);
  if (absents.length > 0) {
    return `${absents.length} model(s) are not in the cache. Running this would download `
      + `them\n  and prove nothing meanwhile. Run a command that loads the models first, `
      + `then this suite.`;
  }
  return undefined;
}

/**
 * Les poids d'EXTRACTION sont-ils là et entiers ?
 *
 * Ce que le seul appelant demande, et rien de plus : il lance `your-cases.ts`, qui ouvre les
 * deux extracteurs. « Y a-t-il des octets dans le cache ? » et « ce cas peut-il tourner ? »
 * étaient deux questions pour une seule constante.
 */
export function poidsEnCache(racine?: string): boolean {
  const base = racineDesPoids(racine);
  if (!existsSync(base)) return false;
  try {
    return modelesAbsents(MODELES_EXTRACTION, racine).length === 0
      && modelesTronques(MODELES_EXTRACTION, racine).length === 0;
  } catch { return false; }
}

/**
 * Les modèles déjà sollicités DANS CE PROCESSUS.
 *
 * Sert à savoir si l'attente qui commence inclut un chargement. Volontairement par processus
 * et non persisté : Ollama évince les modèles inactifs, donc un état gardé sur disque
 * affirmerait « déjà chargé » pour un modèle qui ne l'est plus, et poserait le délai serré
 * pile sur l'attente longue. Se tromper dans ce sens coûte une passe entière.
 */
const modelesDejaSollicites = new Map<string, number>();

/**
 * Combien de temps demander à Ollama de garder un modèle en mémoire.
 *
 * Sans ce réglage, Ollama évince après cinq minutes d'inactivité — et une passe qui parcourt
 * six paliers y passe plus que ça, donc elle recharge sans arrêt et paie une minute à chaque
 * retour. C'est un CHOIX : trente minutes couvrent les passes de ce dépôt, mais un modèle
 * gardé occupe la mémoire graphique de qui utilise la machine à côté. La bonne valeur dépend
 * de ce qu'on fait d'autre pendant, et rien ici ne le mesure.
 */
export const GARDER_EN_MEMOIRE = "30m";

/** Ce que borne chaque attente. Exportés pour qu'un contrôle puisse les confronter au relevé. */
export const DELAI_DE_GENERATION_MS = 30_000;
export const DELAI_DE_CHARGEMENT_MS = 180_000;

/** Ce qu'un premier appel a réellement coûté ici, le 23/08/2026, modèles évincés avant chaque essai. */
export const CHARGEMENTS_MESURES_MS: Record<string, number> = {
  "qwen3:0.6b": 3_700, "qwen3:4b": 54_800, "qwen3:8b": 68_000,
};

/**
 * Un hôte est local quand il désigne cette machine, et rien d'autre.
 *
 * La première version testait `/^127\./`, ce qui accepte `127.0.0.1.evil.example` : un nom de
 * domaine qui *commence* par une adresse de boucle et continue chez quelqu'un d'autre. Le
 * préfixe est la mauvaise question — il faut que la totalité du nom soit une adresse locale,
 * d'où les ancres des deux côtés. Attrapé par le test qui accompagne cette fonction, à sa
 * première exécution.
 */
export function estLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "localhost" || h === "::1") return true;
    return /^127(\.\d{1,3}){3}$/.test(h);
  } catch { return false; }
}

/**
 * LA GARDE EST ICI PARCE QUE C'EST ICI QUE LA FRONTIÈRE SE TRAVERSE.
 *
 * Elle vivait dans `measure.ts`, au point d'entrée : refus de démarrer si `OLLAMA_HOST` ne
 * vise pas cette machine, sauf `--remote-ollama` écrit dans la commande. Correcte, et posée
 * au mauvais endroit — parce qu'il y a d'AUTRES points d'entrée.
 *
 * Une session de contrôle l'a montré le 24 août 2026 : `npm run measure:yours -- --llm` passe
 * par `your-cases.ts`, qui n'appelle pas cette garde. Un `OLLAMA_HOST` hérité d'un `.env`
 * envoyait alors CHAQUE DOSSIER DU CLIENT — noms, dates de naissance, adresses, numéros de
 * pièce d'identité — chez un tiers, sans un mot. Et c'est exactement la commande dont le
 * README dit « nothing leaves your machine ».
 *
 * Recopier la garde dans `your-cases.ts` aurait fermé ce chemin-là et laissé le suivant
 * ouvert. Une frontière se pose là où on la traverse, pas à chaque porte d'entrée : ici,
 * juste avant l'envoi, sur le seul chemin par lequel un document peut partir.
 *
 * La promesse du README redevient donc VRAIE, au lieu d'être affaiblie pour coller au défaut.
 */
export function exigerHoteLocal(url: string = OLLAMA): void {
  if (estLocal(url)) return;
  if (process.argv.includes("--remote-ollama")) return;
  throw new Error(
    `refus d'envoyer un document à « ${url} », qui n'est pas cette machine.\n\n`
    + "  Ce que vous mesurez peut contenir des données personnelles : noms, dates de\n"
    + "  naissance, adresses, numéros de pièce d'identité. Elles partiraient chez un tiers.\n\n"
    + "  Si c'est voulu, écrivez-le dans la commande : --remote-ollama\n"
    + "  Sinon, retirez OLLAMA_HOST de votre environnement — il vient peut-être d'un .env\n"
    + "  que vous n'avez pas relu.");
}

/**
 * Un appel au serveur local, sous schéma.
 *
 * La sortie structurée n'est pas un raffinement ici, c'est la seule chose qui fonctionne.
 * Mesuré le 19 août 2026 : en texte libre qwen3 répond « We are given a document string and
 * we need to extract… ». Il raisonne en prose ordinaire et non entre balises `<think>`, donc
 * `think: false` ne supprime rien et `/no_think` renvoie une chaîne vide. Deux passages
 * complets ont noté 0,0 % sur les cinq champs avant que le schéma ne soit posé — un harnais
 * cassé pris pour un modèle cassé, pour la troisième fois dans ce dépôt.
 */
async function ollama(tier: TierName, prompt: string, schema: unknown): Promise<any> {
  const m = MODELES_LOCAUX[tier];
  if (!m) throw new Error(`palier ${tier} inconnu de l'échelle générative`);
  /*
   * Un délai, parce qu'une mesure qui attend pour toujours n'échoue jamais.
   *
   * Rien ne limitait cet appel. Un serveur bloqué, un modèle qui ne se charge pas, une machine
   * qui se met en veille au milieu d'une passe de quarante minutes — et le processus attend,
   * indéfiniment, sans erreur, sans sortie, sans rien dire. C'est la pire forme de panne :
   * elle ressemble à du travail.
   *
   * Trente secondes est large : le palier le plus lent mesuré ici répond en 1,5 seconde, donc
   * le délai ne se déclenche que sur une vraie anomalie, jamais sur une lenteur normale.
   */
  /*
   * DEUX DÉLAIS, PARCE QU'IL Y A DEUX ATTENTES, ET UNE SEULE ÉTAIT BORNÉE.
   *
   * Le délai unique valait trente secondes, et la prose ci-dessus le justifiait ainsi : « le
   * palier le plus lent mesuré ici répond en 1,5 seconde, donc le délai ne se déclenche que
   * sur une vraie anomalie ». Le raisonnement est juste et il porte SUR LE MAUVAIS OBJET : il
   * compare le délai au temps de GÉNÉRATION d'un modèle déjà en mémoire, alors que le délai
   * borne aussi le CHARGEMENT — trois à cinq gigaoctets à monter en mémoire graphique.
   *
   * Mesuré le 23 août 2026 sur cette machine, modèles évincés avant chaque essai :
   *
   *     qwen3:0.6b   premier appel  3,7 s
   *     qwen3:4b     premier appel 54,8 s      appel suivant 2,5 s
   *     qwen3:8b     premier appel 68,0 s
   *
   * Deux paliers sur trois dépassaient donc le délai AU PREMIER APPEL, systématiquement, et
   * Ollama évince les modèles inactifs au bout de quelques minutes — une passe longue
   * recharge en cours de route. C'est ce qui a tué `npm run dur` après neuf minutes de
   * travail, en annonçant « le serveur est bloqué » alors qu'il chargeait normalement.
   *
   * LE DÉLAI DE GÉNÉRATION RESTE À TRENTE SECONDES, et c'est là que le raisonnement d'origine
   * devient vrai : 2,5 s mesuré, donc douze fois la marge. LE DÉLAI DE CHARGEMENT EST UN
   * CHOIX, PAS UNE MESURE : 68 s constaté ici, posé à cent quatre-vingts. Une machine plus
   * lente, un disque plus lent ou une mémoire plus disputée allongent le chargement, et rien
   * dans ce dépôt ne mesure de combien. Le nommer « choisi » plutôt que le présenter comme
   * une borne mesurée est la seule façon honnête de l'écrire.
   */
  /*
   * « DÉJÀ SOLLICITÉ » N'EST PAS « ENCORE CHARGÉ », ET LA DIFFÉRENCE A TUÉ UNE SECONDE PASSE.
   *
   * Le registre en mémoire savait qu'on avait demandé ce modèle, donc il posait le délai
   * serré. Mais OLLAMA ÉVINCE LES MODÈLES INACTIFS au bout de cinq minutes, et une passe
   * mesure plusieurs minutes par palier : quand elle revient au précédent, il est parti. Le
   * message le disait — « ou le modèle a été évincé » — et je n'en avais pas tiré la
   * conséquence, ce qui est la définition d'un diagnostic écrit sans être lu.
   *
   * Deux réponses, et la première est la vraie. `keep_alive` demande à Ollama de le garder :
   * vérifié, un appel avec `30m` fait passer l'échéance de trois à vingt-neuf minutes. Et par
   * sécurité, si le dernier appel à ce modèle remonte à plus longtemps que le délai
   * d'éviction par défaut, on repasse au délai de chargement — parce qu'une garde qui suppose
   * que l'autre a marché n'est plus une garde.
   */
  const EVICTION_PAR_DEFAUT_MS = 5 * 60_000;
  const vuA = modelesDejaSollicites.get(m.tag);
  const premierAppel = vuA === undefined || Date.now() - vuA > EVICTION_PAR_DEFAUT_MS;
  modelesDejaSollicites.set(m.tag, Date.now());
  const DELAI_MS = premierAppel ? DELAI_DE_CHARGEMENT_MS : DELAI_DE_GENERATION_MS;
  /* Rien ne part avant ça. Voir `exigerHoteLocal` : la garde est au passage, pas à l'entrée. */
  exigerHoteLocal();
  let r: Response;
  try {
    r = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
      body: JSON.stringify({
        model: m.tag, prompt, stream: false, think: false, format: schema,
        keep_alive: GARDER_EN_MEMOIRE,
        options: { temperature: 0, num_predict: 200 },
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(premierAppel
        ? `${m.tag} n'a pas fini de CHARGER en ${DELAI_MS / 1000} s. C'est son premier appel de `
          + `cette passe, donc le poids monte en mémoire : compter environ une minute pour un `
          + `modèle de cinq gigaoctets, plus sur une machine chargée. Au-delà de trois minutes, `
          + `le serveur est en cause : vérifier \`ollama ps\`. Les paliers déjà mesurés gardent `
          + `leurs chiffres.`
        : `${m.tag} n'a pas répondu en ${DELAI_MS / 1000} s alors qu'il était déjà chargé — `
          + `douze fois le temps de génération mesuré. Le serveur est bloqué ou le modèle a été `
          + `évincé : vérifier \`ollama ps\`. Les paliers déjà mesurés gardent leurs chiffres.`);
    }
    throw new Error(
      `Ollama injoignable sur ${OLLAMA}. L'échelle générative est optionnelle : ` +
      `\`npm run measure\` sans \`--llm\` mesure les encodeurs et n'a besoin de rien. ` +
      `Pour celle-ci : \`brew install ollama\`, \`ollama serve\`, puis ` +
      `${Object.values(MODELES_LOCAUX).map((x) => `\`ollama pull ${x.tag}\``).join(", ")}.`);
  }
  if (!r.ok) throw new Error(`Ollama answered ${r.status} for ${m.tag}`);
  const j: any = await r.json();
  try { return JSON.parse(String(j.response ?? "{}")); } catch { return {}; }
}

/** Le serveur répond-il, et les trois modèles sont-ils là ? */
/** Ce qu'Ollama garde effectivement en mémoire, à cet instant. */
export async function residents(): Promise<{ nom: string; octets: number }[]> {
  /* Gardé comme les autres : même une demande de métadonnées révèle à un tiers qu'on
     tourne, et une règle au cas par cas se re-dérive à chaque ajout. */
  exigerHoteLocal();
  const r = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(10_000) });
  const j = await r.json() as { models?: { name: string; size: number }[] };
  return (j.models ?? []).map((m) => ({ nom: m.name, octets: m.size }));
}

/** La taille de chaque modèle sur disque, pour savoir lequel charger en premier. */
/*
 * LE DIGEST ÉTAIT LU, PUIS JETÉ À LA LIGNE OÙ IL AURAIT SERVI.
 *
 * `MODELES_LOCAUX` déclare le digest de chacun des trois modèles génératifs, et il ne
 * servait qu'à l'affichage d'un tableau. `/api/tags` le renvoie ; cette fonction ne gardait
 * que le nom et la taille. Conséquence : `ollama pull qwen3:4b` change tous les échecs
 * génératifs, ne fait bouger aucune source, donc ne fait bouger aucune clé de cache et ne
 * déclenche aucune garde. Pas besoin d'éditer quoi que ce soit — c'est un geste de routine.
 *
 * Et la clé du cache ne pouvait pas l'attraper, contrairement à ce qu'on pourrait croire :
 * elle hache le TEXTE des modules, donc le digest DÉCLARÉ. Un modèle réinstallé ne modifie
 * aucune déclaration. La seule parade possible est de comparer le déclaré à l'installé —
 * exactement ce que fait le scellé du relevé, appliqué au modèle plutôt qu'au fichier.
 *
 * Trouvé par une relecture croisée. La forme est celle de la garde mémoire « documentée et
 * importée par personne », en un cran plus vicieux : ici la valeur est lue, puis abandonnée.
 */
/*
 * ─── ET LE REFUS DE SÉCURITÉ ÉTAIT AVALÉ PAR CETTE MÊME FONCTION ───
 *
 * `exigerHoteLocal()` vivait À L'INTÉRIEUR du `try`, dont le `catch` rendait une carte vide.
 * Or une carte vide est exactement ce que `digestsQuiDivergent` interprète — délibérément,
 * et à raison — comme « aucun écart » : une machine sans Ollama ne doit pas faire crier la
 * garde.
 *
 * Les deux décisions sont bonnes séparément. Ensemble elles font ceci : posez OLLAMA_HOST sur
 * une machine distante, la garde de sécurité lève, son message est jeté, et la garde des
 * empreintes annonce que tout correspond. Le refus le plus important du dépôt sortait par la
 * porte de la moins importante des dégradations. Vérifié en le lançant, pas en le lisant.
 *
 * Et le `catch` nu confondait quatre situations qui n'ont rien à voir : Ollama éteint (une
 * absence légitime), un hôte distant (un refus), un délai dépassé (on ne sait pas), et une
 * faute de programmation dans l'analyse du JSON (un défaut, masqué pour toujours). La
 * troisième et la quatrième se lisent « aucun modèle installé », et la sentinelle de dérive
 * que le palier le plus cher promet de vendre repose là-dessus.
 *
 * Un `catch` sans discrimination ne rattrape pas une erreur : il la renomme.
 */
async function tailles(): Promise<Map<string, { octets: number; digest: string }>> {
  /* HORS DU `try` : un refus d'envoyer vers un hôte distant traverse, il ne se dégrade pas. */
  exigerHoteLocal();
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      throw new Error(
        `${OLLAMA}/api/tags answered ${r.status}. That is not "no model installed":\n`
        + "  a service refusing to answer says nothing about the models, and treating it as a\n"
        + "  silence would turn the digest guard green without it having compared anything.");
    }
    const j = await r.json() as { models?: { name: string; size: number; digest?: string }[] };
    return new Map((j.models ?? []).map((m) =>
      [m.name, { octets: m.size, digest: (m.digest ?? "").replace(/^sha256:/, "").slice(0, 12) }]));
  } catch (e) {
    /*
     * LA SEULE DÉGRADATION ADMISE : Ollama n'écoute pas sur cette machine. C'est le cas
     * courant sur un clone frais, et il ne doit pas faire échouer la suite.
     *
     * Tout le reste — délai dépassé, réponse illisible, faute d'analyse — remonte. Un
     * silence qui ne s'explique pas ne se convertit pas en « rien à signaler ».
     */
    const injoignable = e instanceof TypeError
      || (e as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED";
    if (injoignable) return new Map();
    throw e;
  }
}

/**
 * Le modèle installé est-il celui qu'on a déclaré mesurer ?
 *
 * Rend la liste des écarts. Vide si tout correspond, ou si Ollama n'a rien dit — on ne
 * prétend pas qu'un silence est une correspondance, et l'appelant décide quoi en faire.
 */
export function digestsQuiDivergent(
  installes: Map<string, { octets: number; digest: string }>,
): { tier: string; tag: string; declare: string; installe: string }[] {
  const ecarts: { tier: string; tag: string; declare: string; installe: string }[] = [];
  for (const [tier, m] of Object.entries(MODELES_LOCAUX)) {
    const vu = installes.get(m.tag);
    if (!vu || !vu.digest) continue;          /* absent : ce n'est pas un écart, c'est une absence */
    if (vu.digest !== m.digest) {
      ecarts.push({ tier, tag: m.tag, declare: m.digest, installe: vu.digest });
    }
  }
  return ecarts;
}

/**
 * Charger du plus gros au plus petit, et vérifier la résidence au lieu de la supposer.
 *
 * L'ordre de chargement décide de la survie en mémoire, et l'éviction est **silencieuse** :
 * `ollama ps` rend une ligne de moins, sans erreur. Un modèle qu'on croit résident se recharge
 * depuis le disque à l'appel suivant, et la durée mesurée est alors celle d'un chargement, pas
 * celle d'une inférence — sans que rien ne le signale.
 *
 * Mesuré sur cette machine, dix-sept gigaoctets, trois essais par sens :
 *
 *   du plus gros au plus petit   3 résidents, 3, puis 2   (jusqu'à 10,1 Go)
 *   du plus petit au plus gros   1 résident, 1, 1         (seul le 8b survit)
 *
 * Le sens décroissant n'est donc pas une garantie — un essai sur trois a perdu un modèle — et
 * c'est précisément pourquoi la résidence est **vérifiée** ici plutôt que déduite de l'ordre.
 * La fonction rend ce qu'elle a constaté ; l'appelant décide si ça lui suffit.
 */
export async function loadGeneratifs(): Promise<{ demandes: string[]; residents: string[]; totalOctets: number }> {
  const t = await tailles();
  const tiers = Object.keys(MODELES_LOCAUX) as TierName[];
  const ordre = [...tiers].sort((a, b) =>
    (t.get(MODELES_LOCAUX[b]!.tag)?.octets ?? 0) - (t.get(MODELES_LOCAUX[a]!.tag)?.octets ?? 0));

  /* ON REFUSE, ON NE PRÉVIENT PAS — même règle que le scellé du relevé. Un modèle réinstallé
     rend toutes les mesures génératives fausses sans qu'aucun fichier ne change ; un
     avertissement serait lu une fois puis enjambé, et les chiffres partiraient quand même. */
  const ecarts = digestsQuiDivergent(t);
  if (ecarts.length) {
    throw new Error(
      `${ecarts.length} installed model(s) are not the ones that were measured:\n`
      + ecarts.map((e) => `  ${e.tag} — déclaré ${e.declare}, installé ${e.installe}`).join("\n")
      + `\n  Un « ollama pull » change tous les résultats génératifs sans modifier un seul\n`
      + `  fichier de ce dépôt. Remesurez, ou mettez MODELES_LOCAUX à jour en sachant que\n`
      + `  les chiffres publiés ne viennent plus de ces modèles-là.`);
  }

  for (const tier of ordre) {
    await ollama(tier, "ping",
      { type: "object", properties: { ok: { type: "string" } }, required: ["ok"] });
  }
  const vus = await residents();
  return {
    demandes: ordre.map((x) => MODELES_LOCAUX[x]!.tag),
    residents: vus.map((v) => v.nom),
    totalOctets: vus.reduce((a, v) => a + v.octets, 0),
  };
}

/**
 * Réchauffer un palier juste avant de le mesurer.
 *
 * Le premier appel d'un palier était systématiquement un rechargement — 1 066 ms contre 213 de
 * médiane pour `gen-0.6b`, 2 346 contre 679, 3 102 contre 1 057 — et un seul par palier, ce qui
 * laissait la médiane intacte sur cent vingt appels. Intact n'est pas propre : un appel sur
 * cent vingt mesurait autre chose que ce que la colonne annonce.
 */
export async function rechauffer(tier: TierName): Promise<boolean> {
  if (!estGeneratif(tier)) return true;
  await ollama(tier, "ping", { type: "object", properties: { ok: { type: "string" } }, required: ["ok"] });
  const vus = await residents();
  return vus.some((v) => v.nom === MODELES_LOCAUX[tier]!.tag);
}

let qaSmall: any = null, qaLarge: any = null;


/**
 * LE RÉSEAU N'EST PAS ACQUIS CHEZ LE CLIENT.
 *
 * `pipeline(...)` va chercher 1,3 Go sur huggingface.co au premier lancement. Dans une banque
 * ce domaine est bloqué par défaut, et l'échec qui en sortait était un message de fetch brut :
 * il ne nommait ni le modèle, ni la taille, ni le remède. **Le premier écran de l'acheteur
 * était une erreur de connexion, sur un produit vendu sur le fait qu'il ne dépend de personne.**
 *
 * Deux gestes, et il en faut deux. `CASCADE_OFFLINE=1` refuse AVANT de tenter — un refus
 * précoce qui nomme la commande d'import vaut mieux qu'un échec tardif qui ne nomme rien.
 * Et quand le drapeau n'est pas mis, ce qui est le cas de celui qui découvre le blocage,
 * l'échec est réénoncé avec sa cause probable et sa sortie.
 *
 * L'import est DIFFÉRÉ parce que `poids.ts` importe ce fichier : au chargement il y aurait un
 * cycle, ici il n'y en a pas. `loadExtractors` est déjà asynchrone, donc ça ne coûte rien.
 */
const HORS_LIGNE = (): boolean => process.env.CASCADE_OFFLINE === "1";

async function chargerAvecFilet<T>(cles: readonly CleModele[], charger: () => Promise<T>): Promise<T> {
  const poids = await import("./poids.ts");
  if (HORS_LIGNE()) {
    poids.exigerPoidsSurPlace(cles);
    /* LE REFUS PRÉALABLE N'EST PAS LA GARANTIE. Il regarde `model.onnx` ; la bibliothèque va
       aussi chercher un tokenizer, une configuration, et un fichier ajouté par une version
       future que notre liste ne connaît pas. Couper le réseau ferme la question pour tout ce
       qu'on n'a pas pensé à énumérer — mesuré le 25 août 2026 : avec `allowRemoteModels` à
       faux et les poids en cache, le modèle se charge et répond. Un contrôle qui vérifie ce
       qu'on a listé promet moins que la coupure qui vérifie ce qu'on a oublié. */
    envHF.allowRemoteModels = false;
  }
  try {
    return await charger();
  } catch (e) {
    /* Ne réénoncer QUE ce qui ressemble à un échec de réseau : une erreur de modèle
       réhabillée en problème de proxy enverrait le client chercher au mauvais endroit, et
       un diagnostic qui désigne la mauvaise cause coûte plus cher qu'aucun diagnostic. */
    const m = e instanceof Error ? e.message : String(e);
    if (!poids.ressembleAUnEchecReseau(m)) throw e;
    throw new Error(poids.messageDeTelechargement(e, cles));
  }
}

export async function loadExtractors(): Promise<void> {
  exigerModelesEntiers(MODELES_EXTRACTION);
  await chargerAvecFilet(MODELES_EXTRACTION, async () => {
    qaSmall ??= await pipeline("question-answering", "Xenova/distilbert-base-cased-distilled-squad", { revision: REVISIONS.small });
    qaLarge ??= await pipeline("question-answering", "onnx-community/roberta-base-squad2-ONNX", { revision: REVISIONS.large });
  });
}

export async function extract(
  tier: TierName, d: ClientFile, champ: Field, prompt: NomPrompt = "reference",
  /* La question a poser. Absente, c'est la notre — celle sous laquelle le taux publie a ete
     mesure. Presente, elle vient d'un client dont les champs ne sont pas les notres. */
  question?: string,
): Promise<string> {
  if (tier === "rules") return RULES[champ](d.text);
  /*
   * The human returns ground truth HERE, and only here.
   *
   * It is a measurement convenience, not a model: it exists so the loop can run over all
   * four tiers. The human accuracy the optimiser actually uses does NOT come from this
   * line — it comes from the assumptions, where it is set below 100 %
   * et discutable. Confondre les deux ferait croire l'human infaillible.
   */
  if (tier === "human") return d.truth[champ];
  if (estGeneratif(tier)) return extraireGeneratif(tier, d.text, champ, prompt, question);
  const qa = tier === "small" ? qaSmall : qaLarge;
  const r = await qa(question ?? questionPour(champ).texte, d.text);
  return String(r?.answer ?? "").trim();
}

/**
 * L'extraction par un modèle génératif.
 *
 * L'exemple travaillé n'est pas décoratif. Sans lui, et même avec le schéma, qwen3:4b
 * remplit le champ tantôt avec l'intitulé de la question — « the identity document
 * number » — tantôt avec le document entier. Un seul cas montré corrige les deux, et a fait
 * passer l'adresse de 0 % à 95,8 %.
 *
 * L'exemple est délibérément hors corpus : ni ses noms, ni son format de date, ni son pays
 * n'apparaissent dans les documents mesurés. Un exemple tiré du jeu d'évaluation serait la
 * même faute que d'écrire les expressions régulières contre ses propres gabarits, qui a
 * déjà coûté un corpus entier à ce dépôt.
 */
/**
 * Les cinq formulations mises à l'épreuve, écrites avant qu'aucune ne tourne.
 *
 * La question que ce dépôt ne s'était jamais posée : si reformuler un prompt déplace
 * l'exactitude autant que changer de palier, alors comparer des modèles revient à comparer
 * des prompts, et tout le routage optimise le mauvais axe.
 *
 * Les quatre alternatives ont été écrites par quelqu'un qui n'est pas l'auteur de la
 * référence — même principe que l'audit croisé. Aucune n'est volontairement mauvaise : ce
 * sont trois styles courants plus une correction d'un défaut réel. Elles sont figées ici
 * **avant** la première exécution, parce que connaître un résultat permet d'ajouter une
 * variante de plus et que personne ne le fait consciemment.
 *
 * Réserve à porter avec le chiffre : leur auteur avait lu la référence, donc ce sont des
 * voisines. La dispersion mesurée est une **borne basse** de la vraie sensibilité au prompt.
 */
/** Les paliers dont la formulation se règle : ceux qui ont un prompt. */
export const GENERATIFS_PUBLICS = ["gen-0.6b", "gen-4b", "gen-8b"] as const;

export const EXEMPLE_DOC =
  "Anna Petrova — dob 3 May 1990 — doc no ES-1234-A — Spain — lives 5 Calle Mayor, Madrid";

const EXEMPLES: Record<Field, string> = {
  name: "Anna Petrova",
  birth: "3 May 1990",
  document: "ES-1234-A",
  country: "Spain",
  address: "5 Calle Mayor, Madrid",
};

export type NomPrompt = "reference" | "A-sans-exemple" | "B-exemple-apparie" | "C-minimal" | "D-document-dabord";

export const PROMPTS: Record<NomPrompt,
  /* `question` absente = la nôtre, celle sous laquelle le taux publié a été mesuré. */
  (texte: string, champ: Field, question?: string) => string> = {
  /* La référence : un exemple unique, dont la question est celle du champ `document`. */
  reference: (texte, champ, question) =>
    `Copy a single value out of a document, verbatim. Never rephrase, never reformat, ` +
    `never explain. If the value is absent, return an empty string.\n\n` +
    `Example.\n` +
    `Document: ${EXEMPLE_DOC}\n` +
    `Question: ${QUESTIONS.document}\n` +
    `Answer: ${EXEMPLES.document}\n\n` +
    `Now the real one.\n` +
    `Document: ${texte}\n` +
    `Question: ${question ?? questionPour(champ).texte}\n` +
    `Answer:`,

  /* A : ce que l'exemple apporte, isolé en le retirant. */
  "A-sans-exemple": (texte, champ, question) =>
    `Copy a single value out of a document, verbatim. Never rephrase, never reformat, ` +
    `never explain. If the value is absent, return an empty string.\n\n` +
    `Document: ${texte}\n` +
    `Question: ${question ?? questionPour(champ).texte}\n` +
    `Answer:`,

  /* B : chaque champ voit un exemple qui pose SA question. Même document, aucune information neuve. */
  "B-exemple-apparie": (texte, champ, question) =>
    `Copy a single value out of a document, verbatim. Never rephrase, never reformat, ` +
    `never explain. If the value is absent, return an empty string.\n\n` +
    `Example.\n` +
    `Document: ${EXEMPLE_DOC}\n` +
    `Question: ${question ?? questionPour(champ).texte}\n` +
    `Answer: ${EXEMPLES[champ]}\n\n` +
    `Now the real one.\n` +
    `Document: ${texte}\n` +
    `Question: ${question ?? questionPour(champ).texte}\n` +
    `Answer:`,

  /* C : une phrase d'instruction, rien d'autre. La longueur sert-elle à quelque chose ? */
  "C-minimal": (texte, champ, question) =>
    `Extract the requested value from the document exactly as written. Return an empty ` +
    `string if it is not there.\n\n` +
    `Document: ${texte}\n` +
    `Question: ${question ?? questionPour(champ).texte}\n` +
    `Answer:`,

  /* D : même contenu, contrainte après le document. La position d'une instruction compte. */
  "D-document-dabord": (texte, champ, question) =>
    `Document: ${texte}\n\n` +
    `Question: ${question ?? questionPour(champ).texte}\n\n` +
    `Answer with the value exactly as it appears in the document above. Do not ` +
    `rephrase, reformat or explain. If it is absent, answer with an empty string.\n\n` +
    `Answer:`,
};

async function extraireGeneratif(
  tier: TierName, texte: string, champ: Field, prompt: NomPrompt = "reference",
  question?: string,
): Promise<string> {
  const r = await ollama(tier, PROMPTS[prompt](texte, champ, question),
    { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] });
  return String(r.answer ?? "").trim();
}

/**
 * Un champ est correct ou faux, sans demi-mesure.
 *
 * La comparaison ignore la casse, la ponctuation de bord et les espaces multiples : un
 * model returning "26 ulica Nowy Świat, Lisbon" rather than the same without the comma
 * has found the right answer, and counting that as a failure would measure formatting.
 */
/**
 * La normalisation que `correct` applique aux deux côtés.
 *
 * Exportée parce que le journal des tentatives en a besoin pour distinguer un blanc d'une
 * valeur fausse : « rien » doit vouloir dire la même chose ici et là, sinon deux fichiers du
 * même dépôt comptent les blancs différemment.
 */
export function normaliserReponse(x: string): string {
  return x
    .toLowerCase()
    .replace(/\s*([\/\-.,;:])\s*/g, "$1")   // spaces the tokeniser added around separators
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function correct(got: string, expected: string): boolean {
  /*
   * Formatting is not an error, and counting it as one measures the wrong thing.
   *
   * The failure gallery caught this immediately: the small model returned
   * "10 / 07 / 1987" for "10/07/1987" and was scored wrong. That is a tokeniser putting
   * spaces around punctuation, not a model failing to find the date — and 58 of its
   * recorded failures on that field were this and nothing else.
   *
   * So separators are normalised on both sides. What is NOT normalised is content: a
   * missing word, a wrong span or an empty answer stays wrong, which is the whole point.
   */
  return normaliserReponse(got) === normaliserReponse(expected) && normaliserReponse(got).length > 0;
}


/* ══════════════════ Chain B — classify ══════════════════ */

/** What each typology looks like, for a comparison by meaning. */
const DESCRIPTIONS: Record<Typology, string> = {
  fractionnement: "many small deposits kept below the reporting threshold, split across days or branches",
  "mouvement rapide": "funds arrive and leave the account almost immediately, leaving no balance",
  "lien sanctions": "a name, bank or owner matches or relates to a sanctions or designated persons list",
  "contrepartie inhabituelle": "payments to new companies or counterparties unrelated to the declared business",
  "intensite especes": "an unusually high proportion of cash for the sector, or cash inconsistent with activity",
};

const KEYWORDS: Record<Typology, RegExp> = {
  fractionnement: /\b(below the (declaration|reporting)|just under|sequence of|deposits of between|none individually)\b/i,
  "mouvement rapide": /\b(same day|within two hours|nil balance|returned to zero|before close of business|forwarded)\b/i,
  "lien sanctions": /\b(sanction|designated persons|restrictions|listed individual|partial match)\b/i,
  "contrepartie inhabituelle": /\b(newly incorporated|counterpart(y|ies)|no trading history|registered address|first-time)\b/i,
  "intensite especes": /\b(cash|notes|denomination|lodgements|takings)\b/i,
};

let embSmall: any = null, embLarge: any = null;
let vectorsSmall: number[][] | null = null, vectorsLarge: number[][] | null = null;

const mean = (t: any): number[] => {
  const d = t.dims.at(-1), n = t.data.length / d;
  const v = new Array(d).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) v[j] += t.data[i * d + j];
  const norme = Math.hypot(...v.map((x) => x / n));
  return v.map((x) => x / n / norme);
};
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export async function loadClassifiers(): Promise<void> {
  exigerModelesEntiers(MODELES_CLASSEMENT);
  await chargerAvecFilet(MODELES_CLASSEMENT, async () => {
    embSmall ??= await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { revision: REVISIONS.embSmall });
    embLarge ??= await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { revision: REVISIONS.embLarge });
  });
  vectorsSmall ??= await Promise.all(TYPOLOGIES.map(async (t) => mean(await embSmall(DESCRIPTIONS[t]))));
  // e5 expects its prefixes: omitting them degrades quality without breaking anything, so invisibly.
  vectorsLarge ??= await Promise.all(TYPOLOGIES.map(async (t) => mean(await embLarge(`passage: ${DESCRIPTIONS[t]}`))));
}

/**
 * Classer dans un jeu d'étiquettes quelconque, pas seulement les cinq d'ici.
 *
 * `classify` est câblé sur les typologies de ce dépôt. Pour mesurer une chaîne étrangère il
 * faut la même mécanique avec les étiquettes du lecteur — sinon l'outil ne sait faire que la
 * démonstration qu'il porte, ce qui est précisément le reproche qu'il adresse aux autres.
 *
 * Les descriptions sont facultatives : sans elles, l'intitulé de l'étiquette sert de
 * description. C'est ce qu'un lecteur fera par défaut, donc c'est ce qu'il faut mesurer.
 */
export async function classerParmi(
  tier: TierName, texte: string, etiquettes: string[], descriptions?: Record<string, string>,
): Promise<string> {
  const decrire = (e: string) => descriptions?.[e] ?? e.replace(/[_-]+/g, " ");

  if (tier === "rules") return "";
  if (estGeneratif(tier)) {
    const r = await ollama(tier,
      `Classify the message into exactly one category.\n\nCategories:\n`
      + etiquettes.map((e) => `- ${e}: ${decrire(e)}`).join("\n")
      + `\n\nMessage:\n${texte}`,
      { type: "object", properties: { category: { type: "string", enum: etiquettes } }, required: ["category"] });
    const c = String(r.category ?? "");
    return etiquettes.includes(c) ? c : "";
  }

  const emb = tier === "small" ? embSmall : embLarge;
  if (!emb) throw new Error("appeler loadClassifiers() avant classerParmi()");
  const cle = `${tier}|${etiquettes.length}|${etiquettes[0]}|${etiquettes.at(-1)}`;
  if (refsCache.cle !== cle) {
    refsCache.cle = cle;
    refsCache.vecteurs = await Promise.all(etiquettes.map(async (e) =>
      mean(await emb(tier === "large" ? `passage: ${decrire(e)}` : decrire(e)))));
  }
  const v = mean(await emb(tier === "large" ? `query: ${texte}` : texte));
  let meilleur = 0, score = -Infinity;
  refsCache.vecteurs!.forEach((ref, i) => { const s = cos(v, ref); if (s > score) { score = s; meilleur = i; } });
  return etiquettes[meilleur]!;
}

/* Les vecteurs des étiquettes se recalculent seulement quand le jeu change : sur trois mille
   messages et soixante-dix-sept classes, les refaire à chaque appel triplerait la mesure. */
const refsCache: { cle: string | null; vecteurs: number[][] | null } = { cle: null, vecteurs: null };

export async function classify(tier: TierName, a: Alert): Promise<Typology | ""> {
  if (tier === "human") return a.truth;
  if (tier === "rules") {
    // First pattern to match wins: that is what a real keyword list does, and it is why
    // it gets narratives mentioning two of them wrong.
    for (const t of TYPOLOGIES) if (KEYWORDS[t].test(a.narrative)) return t;
    return "";
  }
  if (estGeneratif(tier)) {
    /*
     * L'énumération dans le schéma garantit une étiquette valide.
     *
     * Le modèle ne peut pas inventer une catégorie, ce qui est plus juste envers lui que
     * de compter un hors-piste comme une erreur de jugement : les encodeurs, eux, sont
     * contraints par construction — ils choisissent le plus proche parmi cinq vecteurs.
     * Sans l'énumération, on mesurerait l'obéissance au format et non la classification.
     */
    const r = await ollama(tier,
      `Classify the alert into exactly one category.\n\nCategories:\n` +
      TYPOLOGIES.map((t) => `- ${t}: ${DESCRIPTIONS[t]}`).join("\n") +
      `\n\nAlert:\n${a.narrative}`,
      { type: "object", properties: { category: { type: "string", enum: TYPOLOGIES } }, required: ["category"] });
    const c = String(r.category ?? "");
    return (TYPOLOGIES as string[]).includes(c) ? c as Typology : "";
  }
  const emb = tier === "small" ? embSmall : embLarge;
  const refs = tier === "small" ? vectorsSmall! : vectorsLarge!;
  const v = mean(await emb(tier === "large" ? `query: ${a.narrative}` : a.narrative));
  let meilleur = 0, score = -Infinity;
  refs.forEach((ref, i) => { const s = cos(v, ref); if (s > score) { score = s; meilleur = i; } });
  return TYPOLOGIES[meilleur];
}

export { FIELDS, TYPOLOGIES };
