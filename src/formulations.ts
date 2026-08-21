/**
 * Les vingt formulations, réécrites au format de la chaîne — et ce qu'il en reste.
 *
 * Le corpus les a écrites pour une extraction à **cinq champs en un appel**. La chaîne qu'on
 * vend extrait **un champ par appel**, avec un schéma JSON imposé. Les transporter change donc
 * la question posée, et il faut le dire plutôt que de laisser croire qu'on répond à l'autre :
 *
 *   abandonnée — « la formulation compte-t-elle, dans l'absolu ? »
 *   posée      — « la formulation déplace-t-elle le résultat **dans la chaîne qu'on vend** ? »
 *
 * La seconde est plus étroite. Elle a un acheteur : un client ne demande pas si les
 * formulations comptent en général, il demande si ce qu'on lui livre bouge quand la consigne
 * change. Mais une portée plus étroite que la promesse est le défaut qu'on a attrapé huit fois
 * aujourd'hui, alors il est écrit ici, dans le fichier, et pas seulement dans un rapport.
 *
 * **Cinq formulations ne survivent pas au transport**, pour deux raisons qu'il ne faut pas
 * confondre :
 *
 *   D — format de sortie (F8, F9) : le schéma imposé écrase toute instruction de format. L'axe
 *       n'est pas perdu par le découpage mais par une contrainte qu'on ne retire pas, puisque
 *       la retirer vaut un facteur 8,4 sur le prix. Il reste mesurable, en la retirant.
 *   F — présentation en liste ou tableau (F12, F13) : il n'y a plus de liste à présenter.
 *   H — ordre des champs (F15) : un champ seul n'a pas d'ordre.
 *
 * Les quinze autres gardent leur axe. Le compte n'est pas une opinion : les invites rendues sur
 * les cinq champs sont comparées caractère par caractère, et un test tient le résultat.
 */

import type { Field } from "./corpus.ts";

export type Formulation = {
  id: string;
  axe: string;
  garde: boolean;
  /** Pourquoi elle s'effondre, quand elle s'effondre. */
  effondrement?: string;
  rendre: (texte: string, champ: Field) => string;
};

const NOM: Record<Field, string> = {
  name: "full name", birth: "date of birth", document: "document type",
  country: "country", address: "address",
};
const COURT: Record<Field, string> = {
  name: "name", birth: "dob", document: "doc_type", country: "ctry", address: "addr",
};
const GREC: Record<Field, string> = {
  name: "ονοματεπώνυμο", birth: "ημερομηνία γέννησης", document: "τύπος εγγράφου",
  country: "χώρα", address: "διεύθυνση",
};
const FR: Record<Field, string> = {
  name: "nom complet", birth: "date de naissance", document: "type de document",
  country: "pays", address: "adresse",
};

const DOC = "Anna Petrova — dob 3 May 1990 — doc no ES-1234-A — Spain — lives 5 Calle Mayor, Madrid";
const REPONSE: Record<Field, string> = {
  name: "Anna Petrova", birth: "3 May 1990", document: "ES-1234-A",
  country: "Spain", address: "5 Calle Mayor, Madrid",
};

/** Le rendu de base, employé tel quel par toutes celles dont l'axe ne survit pas. */
const base = (t: string, c: Field) =>
  `Extract this field from the document below: ${NOM[c]}.\n\nDocument:\n${t}`;

export const FORMULATIONS: Formulation[] = [
  { id: "F1", axe: "base", garde: true, rendre: base },

  { id: "F2", axe: "A longueur — brève", garde: true, rendre: (t, c) =>
    `Extract: ${NOM[c]}.\n\n${t}` },

  { id: "F3", axe: "A longueur — verbeuse", garde: true, rendre: (t, c) =>
    `You will be given the text of an identity or travel document. Your task is to read it and `
    + `report one field from it, exactly as the document records it. Do not correct, normalise `
    + `or reformat what you find. The field is: ${NOM[c]}.\n\nDocument:\n${t}` },

  { id: "F4", axe: "B mode — descriptif", garde: true, rendre: (t, c) =>
    `The task is the extraction of one field from the document below: ${NOM[c]}.\n\nDocument:\n${t}` },

  { id: "F5", axe: "B mode — interrogatif", garde: true, rendre: (t, c) =>
    `What is the ${NOM[c]} in the document below?\n\nDocument:\n${t}` },

  { id: "F6", axe: "C exemples — un", garde: true, rendre: (t, c) =>
    `Extract this field from the document below: ${NOM[c]}.\n\n`
    + `Example.\nDocument: ${DOC}\nField: ${NOM[c]}\nAnswer: ${REPONSE[c]}\n\n`
    + `Document:\n${t}` },

  { id: "F7", axe: "C exemples — trois", garde: true, rendre: (t, c) =>
    `Extract this field from the document below: ${NOM[c]}.\n\n`
    + `Example 1.\nDocument: ${DOC}\nAnswer: ${REPONSE[c]}\n`
    + `Example 2.\nDocument: Jan Novak — born 12.02.1975 — CZ-9987 — Czechia — 8 Vodickova, Prague\n`
    + `Answer: ${c === "country" ? "Czechia" : c === "name" ? "Jan Novak" : c === "birth" ? "12.02.1975"
      : c === "document" ? "CZ-9987" : "8 Vodickova, Prague"}\n`
    + `Example 3.\nDocument: Sofia Rossi — 07/11/1988 — IT-4412-B — Italy — 3 Via Roma, Milan\n`
    + `Answer: ${c === "country" ? "Italy" : c === "name" ? "Sofia Rossi" : c === "birth" ? "07/11/1988"
      : c === "document" ? "IT-4412-B" : "3 Via Roma, Milan"}\n\n`
    + `Document:\n${t}` },

  { id: "F8", axe: "D format de sortie — clés nommées", garde: false,
    effondrement: "le schéma JSON imposé écrase l'instruction de format ; l'axe ne se mesure "
      + "qu'en retirant la contrainte, et la retirer vaut un facteur 8,4 sur le prix",
    rendre: base },

  { id: "F9", axe: "D format de sortie — JSON strict", garde: false,
    effondrement: "même raison que F8 : c'est la contrainte de sortie qui décide, pas l'instruction",
    rendre: base },

  { id: "F10", axe: "E champ absent — laisser vide", garde: true, rendre: (t, c) =>
    `Extract this field from the document below: ${NOM[c]}. If the document does not record it, `
    + `leave it empty.\n\nDocument:\n${t}` },

  { id: "F11", axe: "E champ absent — null, ne pas deviner", garde: true, rendre: (t, c) =>
    `Extract this field from the document below: ${NOM[c]}. If the document does not record it, `
    + `return null. Do not guess.\n\nDocument:\n${t}` },

  { id: "F12", axe: "F présentation — liste numérotée", garde: false,
    effondrement: "il n'y a plus de liste à présenter : un seul champ est demandé",
    rendre: base },

  { id: "F13", axe: "F présentation — tableau", garde: false,
    effondrement: "un tableau d'une seule ligne n'est pas un tableau",
    rendre: base },

  { id: "F14", axe: "G rôle", garde: true, rendre: (t, c) =>
    `You are a document analyst who reads identity and travel documents and records what they `
    + `contain. Extract this field from the document below: ${NOM[c]}.\n\nDocument:\n${t}` },

  { id: "F15", axe: "H ordre des champs", garde: false,
    effondrement: "un champ seul n'a pas d'ordre",
    rendre: base },

  { id: "F16", axe: "I nommage — abrégé", garde: true, rendre: (t, c) =>
    `Extract this field from the document below: ${COURT[c]}.\n\nDocument:\n${t}` },

  { id: "F17", axe: "J contraintes négatives", garde: true, rendre: (t, c) =>
    `Extract this field from the document below: ${NOM[c]}. Never rephrase, never reformat, `
    + `never explain, never infer a value the document does not state.\n\nDocument:\n${t}` },

  { id: "F18", axe: "K langue — grec", garde: true, rendre: (t, c) =>
    `Εξαγάγετε το εξής πεδίο από το παρακάτω έγγραφο: ${GREC[c]}.\n\nΈγγραφο:\n${t}` },

  { id: "F19", axe: "K langue — français", garde: true, rendre: (t, c) =>
    `Extrayez le champ suivant du document ci-dessous : ${FR[c]}.\n\nDocument :\n${t}` },

  { id: "F20", axe: "ancre maximale — rôle, exemple et contraintes", garde: true, rendre: (t, c) =>
    `You are a document analyst who reads identity and travel documents and records what they `
    + `contain. Extract this field from the document below: ${NOM[c]}. Never rephrase, never `
    + `reformat, never explain. If the document does not record it, leave it empty.\n\n`
    + `Example.\nDocument: ${DOC}\nField: ${NOM[c]}\nAnswer: ${REPONSE[c]}\n\n`
    + `Document:\n${t}` },
];

const CHAMPS: Field[] = ["name", "birth", "document", "country", "address"];

/**
 * Les formulations réellement distinctes une fois rendues — comparées, pas jugées.
 *
 * Le rendu est comparé **sur les cinq champs à la fois** : deux formulations ne sont identiques
 * que si elles le sont partout. Comparer sur un seul champ ferait disparaître `F16`, dont le
 * nommage abrégé coïncide avec le nommage complet sur `country` et sur `address`.
 */
export function distinctes(): { representant: string; absorbe: string[] }[] {
  const vues = new Map<string, string[]>();
  for (const f of FORMULATIONS) {
    const cle = CHAMPS.map((c) => f.rendre("<DOC>", c)).join(" ");
    vues.set(cle, [...(vues.get(cle) ?? []), f.id]);
  }
  return [...vues.values()].map((ids) => ({ representant: ids[0]!, absorbe: ids.slice(1) }));
}
