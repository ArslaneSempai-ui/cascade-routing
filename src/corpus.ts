/**
 * Les deux corpus, et leur vérité terrain.
 *
 * Chaîne A — extract cinq champs d'un dossier d'entrée en relation.
 * Chaîne B — classify une alerte de surveillance dans une typologie.
 *
 * Les deux sont là pour une raison précise : leur routing optimal n'est pas le même, et
 * c'est le seul enseignement qu'un outil de routing puisse vraiment apporter. La chaîne A
 * contient des champs de difficulté très inégale — un numéro de pièce en format fixe se
 * prend au regex, une address en text libre ne se prend qu'au modèle. La chaîne B n'a
 * qu'une décision par dossier : un seul étage la traite, ou aucun.
 *
 * Tout est synthétique et assumé. Un dossier réel ne quitte pas une banque.
 */

/*
 * The five fields, and why these five.
 *
 * They are the identifying particulars a bank collects before an account is opened —
 * `31 CFR 1010.230(a)` requires the identification to happen at that moment, not
 * afterwards, which is what makes extraction from unstructured intake documents a real
 * operational problem rather than a convenience.
 *
 * The chain that consumes them is the onboarding agent in kyc-triage-agent, which until
 * now received files already structured, as if by magic. This is what produces them.
 */
export type Field = "name" | "birth" | "document" | "country" | "address";
export const FIELDS: Field[] = ["name", "birth", "document", "country", "address"];

export type ClientFile = {
  id: string;
  text: string;
  truth: Record<Field, string>;
};

export type Typology =
  | "fractionnement" | "mouvement rapide" | "lien sanctions"
  | "contrepartie inhabituelle" | "intensite especes";

/*
 * The alert typologies.
 *
 * These are internal classifications, not legal categories: no regulation names them. The
 * obligation they feed does have a citation — a suspicious transaction of $5,000 or more
 * must be reported, `31 CFR 1020.320(a)(2)` — but how a bank sorts its alerts on the way
 * there is its own affair, and this set is invented for the demonstration.
 */
export const TYPOLOGIES: Typology[] = [
  "fractionnement", "mouvement rapide", "lien sanctions",
  "contrepartie inhabituelle", "intensite especes",
];

export type Alert = { id: string; narrative: string; truth: Typology };

function draw(seed: number) {
  let etat = seed >>> 0;
  return () => {
    etat = (etat * 1_664_525 + 1_013_904_223) >>> 0;
    return etat / 4_294_967_296;
  };
}
const pick = <T,>(r: () => number, l: T[]): T => l[Math.floor(r() * l.length)];

const FIRST_NAMES = ["Amina", "Viktor", "Sofia", "Marcus", "Leila", "Tomas", "Nadia", "Piotr", "Ines", "Karim"];
const SURNAMES = ["Haddad", "Morozov", "Vasquez", "Lindqvist", "Okonkwo", "Novak", "Ferreira", "Mbeki", "Rossi", "Chen"];
const CITIES = ["Paris", "Lyon", "Athens", "Lisbon", "Warsaw", "Milan", "Rotterdam", "Valencia"];
const STREETS = ["rue Victor Hugo", "avenue des Fleurs", "Odos Ermou", "Rua da Prata", "ulica Nowy Świat", "via Garibaldi"];
const COUNTRIES = ["France", "Greece", "Portugal", "Poland", "Italy", "Netherlands", "Spain", "Germany"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
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
 * TRAINING : les formes que j'ai eu le droit de regarder en écrivant les règles.
 * ÉPREUVE      : les formes que je n'avais jamais vues. C'est sur elles qu'on mesure.
 */
const TRAINING = [
  (c: Record<string, string>) =>
    `Client: ${c.name}, born ${c.birth} in ${c.birthCity}, residing at ${c.address}. Identity document ${c.document}, issued in ${c.country}.`,
  (c: Record<string, string>) =>
    `Onboarding file — name ${c.name} / DOB ${c.birth} / ID ${c.document} / nationality ${c.country}. Correspondence address: ${c.address}.`,
  (c: Record<string, string>) =>
    `The applicant, ${c.name}, was born on ${c.birth}. They hold document number ${c.document} delivered by the authorities of ${c.country} and live at ${c.address}.`,
  (c: Record<string, string>) =>
    `${c.name} (${c.country}), d.o.b. ${c.birth}. Address on file: ${c.address}. Document reference ${c.document}.`,
  (c: Record<string, string>) =>
    `Received today: an application from ${c.name}. Date of birth is ${c.birth} and the identity document presented carries the number ${c.document}. Nationality: ${c.country}. The declared address is ${c.address}.`,
];

/**
 * L'épreuve.
 *
 * Les mêmes informations, écrites comme les écrit un human pressé : ponctuation
 * absente, ordre bousculé, mentions parasites, identifiant collé à un autre mot,
 * formulations qu'aucune de mes expressions régulières n'anticipe. Rien ici n'est
 * gratuit — chaque écart correspond à une saisie qu'on rencontre vraiment.
 */
const HELDOUT = [
  (c: Record<string, string>) =>
    `${c.name} — dob ${c.birth} — doc no ${c.document} — ${c.country} — lives ${c.address} (updated by branch staff, no further checks)`,
  (c: Record<string, string>) =>
    `Further to our call: the person concerned is ${c.name}. We hold ${c.document} on file. Born ${c.birth}. Their postal address reads ${c.address} and they present themselves as a national of ${c.country}.`,
  (c: Record<string, string>) =>
    `KYC REVIEW\nSubject ......... ${c.name}\nBirth ........... ${c.birth}\nDocument ........ ${c.document}\nCitizenship ..... ${c.country}\nPostal .......... ${c.address}`,
  (c: Record<string, string>) =>
    `Application received from ${c.name} of ${c.address}; the identity reference supplied was ${c.document} and the stated country ${c.country}. Birth date given as ${c.birth}.`,
  (c: Record<string, string>) =>
    `re ${c.name} / ${c.country} — address ${c.address} — id${c.document} — born ${c.birth} — file opened pending review`,
];

/**
 * `part` décide de quel côté de la séparation on tire.
 *
 * Les règles se développent sur "training" et se mesurent sur "heldout". Passer
 * l'un pour l'autre est le seul moyen de se tromper, et il faut l'écrire pour le faire.
 */
export type Split = "training" | "heldout";

export function generateRecords(howMany = 120, part: Split = "heldout", seed = 20260817): ClientFile[] {
  const r = draw(seed + (part === "heldout" ? 7717 : 0));
  const SHAPES = part === "heldout" ? HELDOUT : TRAINING;
  return Array.from({ length: howMany }, (_, i) => {
    const name = `${pick(r, FIRST_NAMES)} ${pick(r, SURNAMES)}`;
    const jour = 1 + Math.floor(r() * 28);
    const annee = 1955 + Math.floor(r() * 50);
    // Deux écritures de date : le regex en attrape une, pas l'autre.
    const birth = r() < 0.5
      ? `${jour} ${pick(r, MONTHS)} ${annee}`
      : `${String(jour).padStart(2, "0")}/${String(1 + Math.floor(r() * 12)).padStart(2, "0")}/${annee}`;
    const document = `${pick(r, ["FR", "GR", "PT", "PL", "IT"])}-${1000 + Math.floor(r() * 9000)}-${pick(r, ["K", "M", "T", "X"])}`;
    const country = pick(r, COUNTRIES);
    const address = `${1 + Math.floor(r() * 200)} ${pick(r, STREETS)}, ${pick(r, CITIES)}`;
    const birthCity = pick(r, CITIES);

    const c = { name, birth, document, country, address, birthCity };
    return {
      id: `D-${String(i + 1).padStart(4, "0")}`,
      text: pick(r, SHAPES)(c),
      truth: { name, birth, document, country, address },
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
const NARRATIVES: Record<Typology, ((r: () => number) => string)[]> = {
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
 * d'training, et les measure dessus donnait 100 %. Ceux-ci décrivent les mêmes
 * typologies avec un autre vocabulaire — celui d'un analyste qui rédige à sa manière,
 * sans reprendre les termes du manuel.
 */
const NARRATIVES_HELDOUT: Record<Typology, ((r: () => number) => string)[]> = {
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

export function generateAlerts(howMany = 120, part: Split = "heldout", seed = 20260818): Alert[] {
  const r = draw(seed + (part === "heldout" ? 7717 : 0));
  const jeu = part === "heldout" ? NARRATIVES_HELDOUT : NARRATIVES;
  return Array.from({ length: howMany }, (_, i) => {
    const truth = pick(r, TYPOLOGIES);
    return { id: `A-${String(i + 1).padStart(4, "0")}`, narrative: pick(r, jeu[truth])(r), truth };
  });
}
