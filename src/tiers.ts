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

import { pipeline } from "@huggingface/transformers";
import { FIELDS, TYPOLOGIES } from "./corpus.ts";
import type { Field, ClientFile, Alert, Typology } from "./corpus.ts";

import type { TierName } from "./paliers.ts";
import { estGeneratif } from "./paliers.ts";
export type { TierName };
export { TIERS, ENCODEURS, GENERATIFS, estGeneratif } from "./paliers.ts";

/* ══════════════════ Chain A — extract ══════════════════ */

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
const RULES: Record<Field, (t: string) => string> = {
  document: (t) => t.match(/\b[A-Z]{2}-\d{4}-[A-Z]\b/)?.[0] ?? "",
  birth: (t) =>
    t.match(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/)?.[0]
    ?? t.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0] ?? "",
  country: (t) => {
    const country = ["France", "Greece", "Portugal", "Poland", "Italy", "Netherlands", "Spain", "Germany"];
    // The last country mentioned: in several phrasings the issuing country follows the
    // address. So the rule is wrong the moment the order changes.
    let trouve = "";
    for (const p of country) if (t.includes(p)) trouve = p;
    return trouve;
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
  const DELAI_MS = 30_000;
  let r: Response;
  try {
    r = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
      body: JSON.stringify({
        model: m.tag, prompt, stream: false, think: false, format: schema,
        options: { temperature: 0, num_predict: 200 },
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(
        `${m.tag} n'a pas répondu en ${DELAI_MS / 1000} s. Le serveur est bloqué ou le modèle `
        + `ne se charge pas : vérifier \`ollama ps\`. Les paliers déjà mesurés gardent leurs chiffres.`);
    }
    throw new Error(
      `Ollama injoignable sur ${OLLAMA}. L'échelle générative est optionnelle : ` +
      `\`npm run measure\` sans \`--llm\` mesure les encodeurs et n'a besoin de rien. ` +
      `Pour celle-ci : \`brew install ollama\`, \`ollama serve\`, puis ` +
      `${Object.values(MODELES_LOCAUX).map((x) => `\`ollama pull ${x.tag}\``).join(", ")}.`);
  }
  if (!r.ok) throw new Error(`Ollama a répondu ${r.status} pour ${m.tag}`);
  const j: any = await r.json();
  try { return JSON.parse(String(j.response ?? "{}")); } catch { return {}; }
}

/** Le serveur répond-il, et les trois modèles sont-ils là ? */
export async function loadGeneratifs(): Promise<void> {
  for (const tier of Object.keys(MODELES_LOCAUX)) {
    await ollama(tier as TierName, "ping",
      { type: "object", properties: { ok: { type: "string" } }, required: ["ok"] });
  }
}

let qaSmall: any = null, qaLarge: any = null;

export async function loadExtractors(): Promise<void> {
  qaSmall ??= await pipeline("question-answering", "Xenova/distilbert-base-cased-distilled-squad", { revision: REVISIONS.small });
  qaLarge ??= await pipeline("question-answering", "onnx-community/roberta-base-squad2-ONNX", { revision: REVISIONS.large });
}

export async function extract(
  tier: TierName, d: ClientFile, champ: Field, prompt: NomPrompt = "reference",
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
  if (estGeneratif(tier)) return extraireGeneratif(tier, d.text, champ, prompt);
  const qa = tier === "small" ? qaSmall : qaLarge;
  const r = await qa(QUESTIONS[champ], d.text);
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

export const PROMPTS: Record<NomPrompt, (texte: string, champ: Field) => string> = {
  /* La référence : un exemple unique, dont la question est celle du champ `document`. */
  reference: (texte, champ) =>
    `Copy a single value out of a document, verbatim. Never rephrase, never reformat, ` +
    `never explain. If the value is absent, return an empty string.\n\n` +
    `Example.\n` +
    `Document: ${EXEMPLE_DOC}\n` +
    `Question: ${QUESTIONS.document}\n` +
    `Answer: ${EXEMPLES.document}\n\n` +
    `Now the real one.\n` +
    `Document: ${texte}\n` +
    `Question: ${QUESTIONS[champ]}\n` +
    `Answer:`,

  /* A : ce que l'exemple apporte, isolé en le retirant. */
  "A-sans-exemple": (texte, champ) =>
    `Copy a single value out of a document, verbatim. Never rephrase, never reformat, ` +
    `never explain. If the value is absent, return an empty string.\n\n` +
    `Document: ${texte}\n` +
    `Question: ${QUESTIONS[champ]}\n` +
    `Answer:`,

  /* B : chaque champ voit un exemple qui pose SA question. Même document, aucune information neuve. */
  "B-exemple-apparie": (texte, champ) =>
    `Copy a single value out of a document, verbatim. Never rephrase, never reformat, ` +
    `never explain. If the value is absent, return an empty string.\n\n` +
    `Example.\n` +
    `Document: ${EXEMPLE_DOC}\n` +
    `Question: ${QUESTIONS[champ]}\n` +
    `Answer: ${EXEMPLES[champ]}\n\n` +
    `Now the real one.\n` +
    `Document: ${texte}\n` +
    `Question: ${QUESTIONS[champ]}\n` +
    `Answer:`,

  /* C : une phrase d'instruction, rien d'autre. La longueur sert-elle à quelque chose ? */
  "C-minimal": (texte, champ) =>
    `Extract the requested value from the document exactly as written. Return an empty ` +
    `string if it is not there.\n\n` +
    `Document: ${texte}\n` +
    `Question: ${QUESTIONS[champ]}\n` +
    `Answer:`,

  /* D : même contenu, contrainte après le document. La position d'une instruction compte. */
  "D-document-dabord": (texte, champ) =>
    `Document: ${texte}\n\n` +
    `Question: ${QUESTIONS[champ]}\n\n` +
    `Answer with the value exactly as it appears in the document above. Do not ` +
    `rephrase, reformat or explain. If it is absent, answer with an empty string.\n\n` +
    `Answer:`,
};

async function extraireGeneratif(
  tier: TierName, texte: string, champ: Field, prompt: NomPrompt = "reference",
): Promise<string> {
  const r = await ollama(tier, PROMPTS[prompt](texte, champ),
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
  const n = (x: string) => x
    .toLowerCase()
    .replace(/\s*([\/\-.,;:])\s*/g, "$1")   // spaces the tokeniser added around separators
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return n(got) === n(expected) && n(got).length > 0;
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
  embSmall ??= await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { revision: REVISIONS.embSmall });
  embLarge ??= await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { revision: REVISIONS.embLarge });
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
