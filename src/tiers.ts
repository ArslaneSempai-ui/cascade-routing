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
export type { TierName };
export { TIERS } from "./paliers.ts";

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

let qaSmall: any = null, qaLarge: any = null;

export async function loadExtractors(): Promise<void> {
  qaSmall ??= await pipeline("question-answering", "Xenova/distilbert-base-cased-distilled-squad", { revision: REVISIONS.small });
  qaLarge ??= await pipeline("question-answering", "onnx-community/roberta-base-squad2-ONNX", { revision: REVISIONS.large });
}

export async function extract(tier: TierName, d: ClientFile, champ: Field): Promise<string> {
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
  const qa = tier === "small" ? qaSmall : qaLarge;
  const r = await qa(QUESTIONS[champ], d.text);
  return String(r?.answer ?? "").trim();
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

export async function classify(tier: TierName, a: Alert): Promise<Typology | ""> {
  if (tier === "human") return a.truth;
  if (tier === "rules") {
    // First pattern to match wins: that is what a real keyword list does, and it is why
    // it gets narratives mentioning two of them wrong.
    for (const t of TYPOLOGIES) if (KEYWORDS[t].test(a.narrative)) return t;
    return "";
  }
  const emb = tier === "small" ? embSmall : embLarge;
  const refs = tier === "small" ? vectorsSmall! : vectorsLarge!;
  const v = mean(await emb(tier === "large" ? `query: ${a.narrative}` : a.narrative));
  let meilleur = 0, score = -Infinity;
  refs.forEach((ref, i) => { const s = cos(v, ref); if (s > score) { score = s; meilleur = i; } });
  return TYPOLOGIES[meilleur];
}

export { FIELDS, TYPOLOGIES };
