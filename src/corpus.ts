/**
 * Les deux corpus, et leur vérité terrain.
 *
 * Chaîne A — extraire cinq champs d'un dossier d'entrée en relation.
 * Chaîne B — classer une alerte de surveillance dans une typologie.
 *
 * Les deux sont là pour une raison précise : leur routage optimal n'est pas le même, et
 * c'est le seul enseignement qu'un outil de routage puisse vraiment apporter. La chaîne A
 * contient des champs de difficulté très inégale — un numéro de pièce en format fixe se
 * prend au regex, une adresse en texte libre ne se prend qu'au modèle. La chaîne B n'a
 * qu'une décision par dossier : un seul étage la traite, ou aucun.
 *
 * Tout est synthétique et assumé. Un dossier réel ne quitte pas une banque.
 */

export type Champ = "nom" | "naissance" | "piece" | "pays" | "adresse";
export const CHAMPS: Champ[] = ["nom", "naissance", "piece", "pays", "adresse"];

export type Dossier = {
  id: string;
  texte: string;
  verite: Record<Champ, string>;
};

export type Typologie =
  | "fractionnement" | "mouvement rapide" | "lien sanctions"
  | "contrepartie inhabituelle" | "intensite especes";

export const TYPOLOGIES: Typologie[] = [
  "fractionnement", "mouvement rapide", "lien sanctions",
  "contrepartie inhabituelle", "intensite especes",
];

export type Alerte = { id: string; recit: string; verite: Typologie };

function tirage(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat * 1_664_525 + 1_013_904_223) >>> 0;
    return etat / 4_294_967_296;
  };
}
const parmi = <T,>(r: () => number, l: T[]): T => l[Math.floor(r() * l.length)];

const PRENOMS = ["Amina", "Viktor", "Sofia", "Marcus", "Leila", "Tomas", "Nadia", "Piotr", "Ines", "Karim"];
const NOMS = ["Haddad", "Morozov", "Vasquez", "Lindqvist", "Okonkwo", "Novak", "Ferreira", "Mbeki", "Rossi", "Chen"];
const VILLES = ["Paris", "Lyon", "Athens", "Lisbon", "Warsaw", "Milan", "Rotterdam", "Valencia"];
const RUES = ["rue Victor Hugo", "avenue des Fleurs", "Odos Ermou", "Rua da Prata", "ulica Nowy Świat", "via Garibaldi"];
const PAYS = ["France", "Greece", "Portugal", "Poland", "Italy", "Netherlands", "Spain", "Germany"];
const MOIS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/**
 * Les formulations, séparées en deux moitiés qui ne se mélangent jamais.
 *
 * La première mesure a donné 100 % aux règles sur les cinq champs. Ce n'était pas un
 * résultat : j'avais écrit les gabarits, puis les expressions régulières contre ces
 * gabarits. Je mesurais mon propre modèle contre lui-même.
 *
 * C'est l'erreur que j'avais pourtant interdite dans l'agent de triage — « l'agent ne
 * doit pas être une copie de la vérité terrain » — et dans laquelle je suis retombé deux
 * projets plus tard. Elle ne se corrige pas par la vigilance : elle se corrige par une
 * séparation que le code rend impossible à franchir.
 *
 * APPRENTISSAGE : les formes que j'ai eu le droit de regarder en écrivant les règles.
 * ÉPREUVE      : les formes que je n'avais jamais vues. C'est sur elles qu'on mesure.
 */
const APPRENTISSAGE = [
  (c: Record<string, string>) =>
    `Client: ${c.nom}, born ${c.naissance} in ${c.villeNaissance}, residing at ${c.adresse}. Identity document ${c.piece}, issued in ${c.pays}.`,
  (c: Record<string, string>) =>
    `Onboarding file — name ${c.nom} / DOB ${c.naissance} / ID ${c.piece} / nationality ${c.pays}. Correspondence address: ${c.adresse}.`,
  (c: Record<string, string>) =>
    `The applicant, ${c.nom}, was born on ${c.naissance}. They hold document number ${c.piece} delivered by the authorities of ${c.pays} and live at ${c.adresse}.`,
  (c: Record<string, string>) =>
    `${c.nom} (${c.pays}), d.o.b. ${c.naissance}. Address on file: ${c.adresse}. Document reference ${c.piece}.`,
  (c: Record<string, string>) =>
    `Received today: an application from ${c.nom}. Date of birth is ${c.naissance} and the identity document presented carries the number ${c.piece}. Nationality: ${c.pays}. The declared address is ${c.adresse}.`,
];

/**
 * L'épreuve.
 *
 * Les mêmes informations, écrites comme les écrit un humain pressé : ponctuation
 * absente, ordre bousculé, mentions parasites, identifiant collé à un autre mot,
 * formulations qu'aucune de mes expressions régulières n'anticipe. Rien ici n'est
 * gratuit — chaque écart correspond à une saisie qu'on rencontre vraiment.
 */
const EPREUVE = [
  (c: Record<string, string>) =>
    `${c.nom} — dob ${c.naissance} — doc no ${c.piece} — ${c.pays} — lives ${c.adresse} (updated by branch staff, no further checks)`,
  (c: Record<string, string>) =>
    `Further to our call: the person concerned is ${c.nom}. We hold ${c.piece} on file. Born ${c.naissance}. Their postal address reads ${c.adresse} and they present themselves as a national of ${c.pays}.`,
  (c: Record<string, string>) =>
    `KYC REVIEW\nSubject ......... ${c.nom}\nBirth ........... ${c.naissance}\nDocument ........ ${c.piece}\nCitizenship ..... ${c.pays}\nPostal .......... ${c.adresse}`,
  (c: Record<string, string>) =>
    `Application received from ${c.nom} of ${c.adresse}; the identity reference supplied was ${c.piece} and the stated country ${c.pays}. Birth date given as ${c.naissance}.`,
  (c: Record<string, string>) =>
    `re ${c.nom} / ${c.pays} — address ${c.adresse} — id${c.piece} — born ${c.naissance} — file opened pending review`,
];

/**
 * `part` décide de quel côté de la séparation on tire.
 *
 * Les règles se développent sur "apprentissage" et se mesurent sur "epreuve". Passer
 * l'un pour l'autre est le seul moyen de se tromper, et il faut l'écrire pour le faire.
 */
export type Part = "apprentissage" | "epreuve";

export function genererDossiers(combien = 120, part: Part = "epreuve", graine = 20260817): Dossier[] {
  const r = tirage(graine + (part === "epreuve" ? 7717 : 0));
  const FORMES = part === "epreuve" ? EPREUVE : APPRENTISSAGE;
  return Array.from({ length: combien }, (_, i) => {
    const nom = `${parmi(r, PRENOMS)} ${parmi(r, NOMS)}`;
    const jour = 1 + Math.floor(r() * 28);
    const annee = 1955 + Math.floor(r() * 50);
    // Deux écritures de date : le regex en attrape une, pas l'autre.
    const naissance = r() < 0.5
      ? `${jour} ${parmi(r, MOIS)} ${annee}`
      : `${String(jour).padStart(2, "0")}/${String(1 + Math.floor(r() * 12)).padStart(2, "0")}/${annee}`;
    const piece = `${parmi(r, ["FR", "GR", "PT", "PL", "IT"])}-${1000 + Math.floor(r() * 9000)}-${parmi(r, ["K", "M", "T", "X"])}`;
    const pays = parmi(r, PAYS);
    const adresse = `${1 + Math.floor(r() * 200)} ${parmi(r, RUES)}, ${parmi(r, VILLES)}`;
    const villeNaissance = parmi(r, VILLES);

    const c = { nom, naissance, piece, pays, adresse, villeNaissance };
    return {
      id: `D-${String(i + 1).padStart(4, "0")}`,
      texte: parmi(r, FORMES)(c),
      verite: { nom, naissance, piece, pays, adresse },
    };
  });
}

/**
 * Les récits d'alerte.
 *
 * Chaque typologie a son vocabulaire propre — mais les gabarits se chevauchent
 * volontairement : un récit d'espèces mentionne des montants, un récit de fractionnement
 * aussi. Sans ce chevauchement, les mots-clés atteindraient 100 % et il n'y aurait rien
 * à arbitrer.
 */
const RECITS: Record<Typologie, ((r: () => number) => string)[]> = {
  fractionnement: [
    (r) => `Eleven cash deposits of between 8,400 and 9,600 booked over ${4 + Math.floor(r() * 6)} days across three branches, each below the declaration ceiling.`,
    () => `A sequence of transfers just under the reporting limit, repeated on consecutive mornings from the same terminal.`,
    (r) => `Account received ${6 + Math.floor(r() * 8)} payments in one week, none individually notable, together exceeding the annual declared income.`,
  ],
  "mouvement rapide": [
    () => `Funds credited in the morning and fully transferred out to a third party before close of business, leaving a nil balance.`,
    (r) => `${3 + Math.floor(r() * 5)} incoming wires cleared and forwarded within two hours, with no economic purpose stated.`,
    () => `Balance rose and returned to zero on the same day, three times this month.`,
  ],
  "lien sanctions": [
    () => `The beneficiary name returned a partial match against a designated persons list, with a differing middle name.`,
    () => `Counterparty bank is domiciled in a jurisdiction subject to sectoral restrictions, and the stated purpose is generic.`,
    () => `A shareholder identified in the ownership chain shares a date of birth with a listed individual.`,
  ],
  "contrepartie inhabituelle": [
    (r) => `Payments to ${2 + Math.floor(r() * 4)} newly incorporated entities with no trading history and a shared registered address.`,
    () => `Regular remittances to a counterparty whose declared sector bears no relation to the client's stated activity.`,
    () => `A first-time counterparty received an amount larger than the client's entire prior twelve-month turnover.`,
  ],
  "intensite especes": [
    (r) => `Cash represents ${72 + Math.floor(r() * 22)} % of turnover for a business whose sector averages under twenty.`,
    () => `Notes deposited are consistently high denomination and show no pattern of retail takings.`,
    () => `Weekly cash lodgements continued unchanged through a period the premises were closed.`,
  ],
};

/**
 * Les récits de l'épreuve.
 *
 * Même chose que pour les dossiers : les mots-clés ont été écrits contre les gabarits
 * d'apprentissage, et les mesurer dessus donnait 100 %. Ceux-ci décrivent les mêmes
 * typologies avec un autre vocabulaire — celui d'un analyste qui rédige à sa manière,
 * sans reprendre les termes du manuel.
 */
const RECITS_EPREUVE: Record<Typologie, ((r: () => number) => string)[]> = {
  fractionnement: [
    (r) => `Client paid in ${9 + Math.floor(r() * 5)} separate lodgements this fortnight, every one a shade under the level that would have triggered paperwork.`,
    () => `Money arrived in slices rather than in one movement, spread over several counters, with no explanation offered for the pattern.`,
    () => `Amounts were kept small enough individually to pass unnoticed, though together they exceed anything this account has seen.`,
  ],
  "mouvement rapide": [
    () => `Whatever came in was gone again within the working day, to a party the client had never dealt with before.`,
    (r) => `The account held a positive balance for roughly ${2 + Math.floor(r() * 4)} hours on each of the dates reviewed, then emptied.`,
    () => `Money did not rest here. It passed through, repeatedly, and the account ends every period flat.`,
  ],
  "lien sanctions": [
    () => `A name in the ownership structure resembles one on a restricted register closely enough that we cannot rule it out.`,
    () => `The receiving institution sits in a territory currently subject to measures, and the stated reason for payment is vague.`,
    () => `Screening flagged a near-identity between a director and a person the authorities have designated.`,
  ],
  "contrepartie inhabituelle": [
    (r) => `Payments went to ${2 + Math.floor(r() * 4)} companies registered within weeks of each other at one address, none of which appear to trade.`,
    () => `The recipient does business in a field entirely unconnected to what this client told us they do.`,
    () => `A party never seen before on this account received more in a single instruction than the client turned over all last year.`,
  ],
  "intensite especes": [
    (r) => `Notes account for roughly ${70 + Math.floor(r() * 25)} % of what comes through, far above what this line of business normally shows.`,
    () => `The physical money banked does not look like shop takings — too uniform, too large, too clean.`,
    () => `Banking of notes carried on at the usual rate during weeks the premises were shut.`,
  ],
};

export function genererAlertes(combien = 120, part: Part = "epreuve", graine = 20260818): Alerte[] {
  const r = tirage(graine + (part === "epreuve" ? 7717 : 0));
  const jeu = part === "epreuve" ? RECITS_EPREUVE : RECITS;
  return Array.from({ length: combien }, (_, i) => {
    const verite = parmi(r, TYPOLOGIES);
    return { id: `A-${String(i + 1).padStart(4, "0")}`, recit: parmi(r, jeu[verite])(r), verite };
  });
}
