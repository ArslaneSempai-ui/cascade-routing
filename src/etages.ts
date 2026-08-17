/**
 * Les étages de la cascade.
 *
 * Quatre par chaîne, du moins cher au plus cher : des règles, un petit modèle, un gros,
 * un humain. C'est le gradin qu'on trouve dans toute chaîne de traitement réelle, et la
 * question que personne ne pose est : **faut-il vraiment le même étage partout ?**
 *
 * Les modèles tournent en local. Aucune clé d'API, aucun appel réseau, et le dépôt reste
 * exécutable par quiconque le clone sans payer.
 */

import { pipeline } from "@huggingface/transformers";
import { CHAMPS, TYPOLOGIES } from "./corpus.ts";
import type { Champ, Dossier, Alerte, Typologie } from "./corpus.ts";

export type NomEtage = "regles" | "petit" | "grand" | "humain";
export const ETAGES: NomEtage[] = ["regles", "petit", "grand", "humain"];

/* ══════════════════ Chaîne A — extraire ══════════════════ */

const QUESTIONS: Record<Champ, string> = {
  nom: "What is the name of the client?",
  naissance: "What is the date of birth?",
  piece: "What is the identity document number?",
  pays: "What is the nationality or country?",
  adresse: "What is the address?",
};

/**
 * Les règles.
 *
 * Elles sont excellentes là où la forme est contrainte et lamentables ailleurs — c'est
 * exactement pour ça qu'un routage par champ a un sens. Un numéro de pièce en
 * `XX-9999-Y` ne demande pas de modèle ; une adresse en texte libre, si.
 */
const REGLES: Record<Champ, (t: string) => string> = {
  piece: (t) => t.match(/\b[A-Z]{2}-\d{4}-[A-Z]\b/)?.[0] ?? "",
  naissance: (t) =>
    t.match(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/)?.[0]
    ?? t.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0] ?? "",
  pays: (t) => {
    const pays = ["France", "Greece", "Portugal", "Poland", "Italy", "Netherlands", "Spain", "Germany"];
    // Le dernier pays cité : dans plusieurs formulations, le pays de délivrance suit
    // l'adresse. La règle a donc tort dès que l'ordre change.
    let trouve = "";
    for (const p of pays) if (t.includes(p)) trouve = p;
    return trouve;
  },
  nom: (t) =>
    t.match(/(?:Client|name|application from|The applicant,)\s*:?\s*([A-Z][a-zà-ÿ]+\s[A-Z][a-zà-ÿ]+)/)?.[1]
    ?? t.match(/^([A-Z][a-zà-ÿ]+\s[A-Z][a-zà-ÿ]+)\s*\(/)?.[1] ?? "",
  adresse: (t) =>
    t.match(/(?:residing at|address(?: on file)?:?|live at|declared address is)\s*([^.]+?)\./i)?.[1]?.trim() ?? "",
};

let qaPetit: any = null, qaGrand: any = null;

export async function chargerExtracteurs(): Promise<void> {
  qaPetit ??= await pipeline("question-answering", "Xenova/distilbert-base-cased-distilled-squad");
  qaGrand ??= await pipeline("question-answering", "onnx-community/roberta-base-squad2-ONNX");
}

export async function extraire(etage: NomEtage, d: Dossier, champ: Champ): Promise<string> {
  if (etage === "regles") return REGLES[champ](d.texte);
  /*
   * L'humain rend la vérité terrain ICI, et seulement ici.
   *
   * C'est une commodité de mesure, pas un modèle : elle sert à faire tourner la boucle
   * sur les quatre étages. La justesse humaine réellement utilisée par l'optimiseur ne
   * vient PAS de cette ligne — elle vient des hypothèses, où elle est posée sous 100 %
   * et discutable. Confondre les deux ferait croire l'humain infaillible.
   */
  if (etage === "humain") return d.verite[champ];
  const qa = etage === "petit" ? qaPetit : qaGrand;
  const r = await qa(QUESTIONS[champ], d.texte);
  return String(r?.answer ?? "").trim();
}

/**
 * Un champ est juste ou faux, sans demi-mesure.
 *
 * La comparaison ignore la casse, la ponctuation de bord et les espaces multiples : un
 * modèle qui rend « 26 ulica Nowy Świat, Lisbon » plutôt que le même sans virgule a
 * trouvé la bonne réponse, et compter cela comme une erreur mesurerait la mise en forme.
 */
export function juste(obtenu: string, attendu: string): boolean {
  const n = (x: string) => x.toLowerCase().replace(/[.,;:]+$/g, "").replace(/\s+/g, " ").trim();
  return n(obtenu) === n(attendu) && n(obtenu).length > 0;
}

/* ══════════════════ Chaîne B — classer ══════════════════ */

/** Ce à quoi chaque typologie ressemble, pour une comparaison par le sens. */
const DESCRIPTIONS: Record<Typologie, string> = {
  fractionnement: "many small deposits kept below the reporting threshold, split across days or branches",
  "mouvement rapide": "funds arrive and leave the account almost immediately, leaving no balance",
  "lien sanctions": "a name, bank or owner matches or relates to a sanctions or designated persons list",
  "contrepartie inhabituelle": "payments to new companies or counterparties unrelated to the declared business",
  "intensite especes": "an unusually high proportion of cash for the sector, or cash inconsistent with activity",
};

const MOTS: Record<Typologie, RegExp> = {
  fractionnement: /\b(below the (declaration|reporting)|just under|sequence of|deposits of between|none individually)\b/i,
  "mouvement rapide": /\b(same day|within two hours|nil balance|returned to zero|before close of business|forwarded)\b/i,
  "lien sanctions": /\b(sanction|designated persons|restrictions|listed individual|partial match)\b/i,
  "contrepartie inhabituelle": /\b(newly incorporated|counterpart(y|ies)|no trading history|registered address|first-time)\b/i,
  "intensite especes": /\b(cash|notes|denomination|lodgements|takings)\b/i,
};

let embPetit: any = null, embGrand: any = null;
let vecteursPetit: number[][] | null = null, vecteursGrand: number[][] | null = null;

const moyenne = (t: any): number[] => {
  const d = t.dims.at(-1), n = t.data.length / d;
  const v = new Array(d).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) v[j] += t.data[i * d + j];
  const norme = Math.hypot(...v.map((x) => x / n));
  return v.map((x) => x / n / norme);
};
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export async function chargerClasseurs(): Promise<void> {
  embPetit ??= await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  embGrand ??= await pipeline("feature-extraction", "Xenova/multilingual-e5-small");
  vecteursPetit ??= await Promise.all(TYPOLOGIES.map(async (t) => moyenne(await embPetit(DESCRIPTIONS[t]))));
  // e5 attend ses préfixes : les omettre dégrade sans rien casser, donc sans se voir.
  vecteursGrand ??= await Promise.all(TYPOLOGIES.map(async (t) => moyenne(await embGrand(`passage: ${DESCRIPTIONS[t]}`))));
}

export async function classer(etage: NomEtage, a: Alerte): Promise<Typologie | ""> {
  if (etage === "humain") return a.verite;
  if (etage === "regles") {
    // Le premier motif qui répond l'emporte : c'est ce que fait une vraie liste de
    // mots-clés, et c'est pour ça qu'elle se trompe sur les récits qui en citent deux.
    for (const t of TYPOLOGIES) if (MOTS[t].test(a.recit)) return t;
    return "";
  }
  const emb = etage === "petit" ? embPetit : embGrand;
  const refs = etage === "petit" ? vecteursPetit! : vecteursGrand!;
  const v = moyenne(await emb(etage === "grand" ? `query: ${a.recit}` : a.recit));
  let meilleur = 0, score = -Infinity;
  refs.forEach((ref, i) => { const s = cos(v, ref); if (s > score) { score = s; meilleur = i; } });
  return TYPOLOGIES[meilleur];
}

export { CHAMPS, TYPOLOGIES };
