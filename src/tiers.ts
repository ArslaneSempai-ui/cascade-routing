/**
 * Les étages de la cascade.
 *
 * Quatre par chaîne, du moins cher au plus cher : des règles, un small modèle, un gros,
 * un human. C'est le gradin qu'on trouve dans toute chaîne de traitement réelle, et la
 * question que personne ne pose est : **faut-il vraiment le même étage partout ?**
 *
 * Les modèles tournent en local. Aucune clé d'API, aucun appel réseau, et le dépôt reste
 * exécutable par quiconque le clone sans payer.
 */

import { pipeline } from "@huggingface/transformers";
import { FIELDS, TYPOLOGIES } from "./corpus.ts";
import type { Field, ClientFile, Alert, Typology } from "./corpus.ts";

export type TierName = "rules" | "small" | "large" | "human";
export const TIERS: TierName[] = ["rules", "small", "large", "human"];

/* ══════════════════ Chaîne A — extract ══════════════════ */

const QUESTIONS: Record<Field, string> = {
  name: "What is the name of the client?",
  birth: "What is the date of birth?",
  document: "What is the identity document number?",
  country: "What is the nationality or country?",
  address: "What is the address?",
};

/**
 * Les règles.
 *
 * Elles sont excellentes là où la forme est contrainte et lamentables ailleurs — c'est
 * exactement pour ça qu'un routing par champ a un sens. Un numéro de pièce en
 * `XX-9999-Y` ne demande pas de modèle ; une address en text libre, si.
 */
const RULES: Record<Field, (t: string) => string> = {
  document: (t) => t.match(/\b[A-Z]{2}-\d{4}-[A-Z]\b/)?.[0] ?? "",
  birth: (t) =>
    t.match(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/)?.[0]
    ?? t.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0] ?? "",
  country: (t) => {
    const country = ["France", "Greece", "Portugal", "Poland", "Italy", "Netherlands", "Spain", "Germany"];
    // Le dernier country cité : dans plusieurs formulations, le country de délivrance suit
    // l'address. La règle a donc tort dès que l'ordre change.
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

let qaSmall: any = null, qaLarge: any = null;

export async function loadExtractors(): Promise<void> {
  qaSmall ??= await pipeline("question-answering", "Xenova/distilbert-base-cased-distilled-squad");
  qaLarge ??= await pipeline("question-answering", "onnx-community/roberta-base-squad2-ONNX");
}

export async function extract(tier: TierName, d: ClientFile, champ: Field): Promise<string> {
  if (tier === "rules") return RULES[champ](d.text);
  /*
   * L'human rend la vérité terrain ICI, et seulement ici.
   *
   * C'est une commodité de mesure, pas un modèle : elle sert à faire tourner la boucle
   * sur les quatre étages. La accuracy humaine réellement utilisée par l'optimiseur ne
   * vient PAS de cette ligne — elle vient des hypothèses, où elle est posée sous 100 %
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
 * modèle qui rend « 26 ulica Nowy Świat, Lisbon » plutôt que le même sans virgule a
 * trouvé la bonne réponse, et compter cela comme une erreur mesurerait la mise en forme.
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


/* ══════════════════ Chaîne B — classify ══════════════════ */

/** Ce à quoi chaque typologie ressemble, pour une comparaison par le sens. */
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
  embSmall ??= await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  embLarge ??= await pipeline("feature-extraction", "Xenova/multilingual-e5-small");
  vectorsSmall ??= await Promise.all(TYPOLOGIES.map(async (t) => mean(await embSmall(DESCRIPTIONS[t]))));
  // e5 attend ses préfixes : les omettre dégrade sans rien casser, donc sans se voir.
  vectorsLarge ??= await Promise.all(TYPOLOGIES.map(async (t) => mean(await embLarge(`passage: ${DESCRIPTIONS[t]}`))));
}

export async function classify(tier: TierName, a: Alert): Promise<Typology | ""> {
  if (tier === "human") return a.truth;
  if (tier === "rules") {
    // Le premier motif qui répond l'emporte : c'est ce que fait une vraie liste de
    // mots-clés, et c'est pour ça qu'elle se trompe sur les récits qui en citent deux.
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
