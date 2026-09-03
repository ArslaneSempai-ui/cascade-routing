/**
 * Your cases, not mine.
 *
 * Everything else in this repository measures a corpus I wrote. That is the objection every
 * reader raises, and they are right to: a held-out split defends against marking your own
 * homework, it does not turn invented documents into the ones your customers send.
 *
 * This is the answer. Point it at a CSV of your own cases and it runs the same measurement,
 * with the same scorer and the same intervals, on your data. Nothing about your file leaves
 * the machine — the models are local, and there is no network call anywhere in this path.
 *
 * ─── The file it wants ───
 *
 *     id,text,name,birth,document
 *     1,"Anna Petrova — dob 3 May 1990 — doc ES-1234-A",Anna Petrova,3 May 1990,ES-1234-A
 *
 * The first column is an identifier, the second is the input, and **every remaining column
 * is a field to extract**, named by its header. Three columns of expected answers means
 * three fields measured and routed. Nothing is configured anywhere else.
 *
 * ─── What it deliberately does not do ───
 *
 * It cannot measure your hand-written rules, because those are your code and this cannot
 * see them. Supply them as regexes with `--rules=file.json` and they become a tier like any
 * other; leave them out and the routing is over models only. That is a real limitation and
 * it is stated rather than hidden: on my own corpus the free rules carried three fields out
 * of five, so a routing computed without them will overstate what you need to pay.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { examiner, direLesDocumentsSuspects, oublierLesDocuments } from "./document-suspect.ts";
import { noter, direLesFormes, oublierLesFormes } from "./forme-rendue.ts";
import { loadavg } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { normaliserReponse } from "./tiers.ts";
import { loadExtractors, loadClassifiers, loadGeneratifs, extract, correct, classerParmi, MODELES_LOCAUX, questionPour,
  MODELES_EXTRACTION, MODELES_CLASSEMENT, type CleModele } from "./tiers.ts";
import { poidsAbsents, motifDEcart, CODE_ECART_TEMOIN, exigerPoidsSurPlace } from "./poids.ts";
import { TIERS, ENCODEURS, GENERATIFS } from "./paliers.ts";
import { rate, writeRate, cellulesDeTaux, distinguishable, CONFIANCE, ENOUGH } from "./interval.ts";
import { evaluerRegles, direLesRefus, type ReglesEvaluees } from "./regles-bornees.ts";
import { table } from "./figures.ts";

import type { TierName } from "./paliers.ts";

export type Cas = { id: string; text: string; truth: Record<string, string> };

/**
 * Un CSV lu sans dépendance, guillemets compris.
 *
 * Écrire un analyseur CSV à la main est habituellement une mauvaise idée. Ici c'est le prix
 * d'une propriété qui vaut plus que la commodité : ce dépôt n'a aucune dépendance
 * d'exécution, donc rien à auditer avant de lui confier un fichier de cas réels. Un
 * responsable conformité qui doit approuver l'outil lit trois cents lignes, pas un arbre de
 * modules.
 */
/*
 * UNE GUILLEMET NON REFERMÉE MANGEAIT LA MOITIÉ DU FICHIER DU CLIENT, EN SILENCE.
 *
 * Mesuré : deux fichiers de sept lignes, un seul caractère d'écart — une guillemet ouvrante
 * jamais refermée. Le premier rendait six cas, le second trois. Rien n'était signalé, le code
 * de sortie restait zéro, et l'outil imprimait ensuite « 3 cases is below the point where a
 * rate says anything » : il AVERTISSAIT que l'échantillon était petit sans dire QU'IL L'AVAIT
 * RENDU PETIT. Le client lit trois et conclut que son fichier en contenait trois.
 *
 * C'est la pire forme de chiffre faux — celle qui ne se voit pas dans le chiffre — et elle
 * tombait sur les données du client, dans un dépôt dont c'est l'argument de vente.
 *
 * La cause est ordinaire : à l'intérieur d'une guillemet, le retour à la ligne est du contenu.
 * C'est correct, et c'est même la raison d'être des guillemets. Ce qui manquait, c'est que
 * PERSONNE NE VÉRIFIAIT que l'automate en était ressorti à la fin.
 */
/** Ce qu'une lecture rend, y compris ce qu'elle a écarté et comment elle a lu. */
export type Lecture = {
  champs: string[];
  cas: Cas[];
  /** Lignes portant PLUS de cellules que l'en-tête : aucune lecture raisonnable, écartées. */
  ecartees: { ligne: number; champs: number }[];
  /** Lignes plus COURTES : gardées, cellules manquantes vides — mais comptées et annoncées. */
  courtes: { ligne: number; champs: number }[];
  /**
   * Cellules démesurées : gardées, mais nommées avec la cause la plus probable.
   *
   * Une valeur de champ ne fait pas un mégaoctet. Quand une cellule en fait un, c'est presque
   * toujours un guillemet ouvert quelque part et refermé beaucoup plus loin, qui a avalé des
   * milliers de lignes. On ne refuse pas — un texte de document peut légitimement être long,
   * et un refus casserait des données valides — mais on le dit, parce que le lecteur verrait
   * sinon un fichier de dix mille lignes se lire comme trois.
   */
  demesurees: { ligne: number; octets: number; ouvertureLigne: number }[];
  lecture: { colTexte: number; colId: number; noms: string[] };
};

/*
 * ─── LE NOM D'UNE COLONNE EST UNE DONNÉE DU CLIENT ───
 *
 * Il ressort **quatre fois** dans le rapport qu'on lui rend : deux fois entre accents
 * graves — inerte — et **deux fois nu**, dans la phrase de la question et à chaque ligne du
 * tableau d'exactitude. Mesuré le 25 août 2026 sur un en-tête hostile :
 *
 *   | <img src=x onerror=alert(1)> | small | 0.0 % | [0–66] | 2 | 11 ms |
 *
 * Trois conséquences, et la troisième est la plus grave :
 *
 *   — rendu en HTML, l'écho nu **s'exécute** ;
 *   — un `|` dans un nom — `=cmd|' /C calc'!A0` — **ouvre une colonne de plus** et désaligne
 *     en silence le tableau remis au client ;
 *   — `questionPour(champ)` construit « What is the <nom> ? » et ce texte **part dans
 *     l'invite du modèle** : le client écrit une partie de l'invite. Sans `--llm` les paliers
 *     sont extractifs et la portée est bornée ; le palier génératif est précisément ce qui se
 *     vend au-dessus, et un fichier fourni par un tiers devient alors une entrée d'invite.
 *
 * Le modèle d'échappement existait déjà dans ce fichier — deux échos sur quatre le font. Il
 * n'était simplement pas appliqué partout.
 */

/*
 * La question envoyée au modèle, nettoyée SANS changer la recherche.
 *
 * On garde le nom d'origine pour retrouver une question fournie par le client ou l'une des
 * nôtres — c'est la clé, et la nettoyer ferait manquer les deux. Seule la question DÉDUITE
 * contient le nom de colonne, et c'est la seule qu'on refabrique à partir du nom nettoyé.
 */
/**
 * Une énumération bornée qui porte le compte de ce qu'elle écarte : dix mille noms de
 * colonne ne se lisent pas, et une liste coupée en silence ment sur ce qu'elle montre.
 */
export function apercu(noms: readonly string[], max: number): string {
  return noms.length <= max
    ? noms.join(", ")
    : noms.slice(0, max).join(", ") + `, and ${noms.length - max} more`;
}

/** Combien de noms on montre avant de compter le reste. */
export const MONTRES = 12;

/** Au-delà de ce nombre d'appels au modèle, on demande une confirmation explicite. */
export const PLAFOND_APPELS = 10_000;

/**
 * `--sample`, lu comme une entrée et non comme une conversion.
 *
 * Rendre `undefined` veut dire « le drapeau n'a pas été donné ». Toute autre forme illisible
 * s'arrête ici : un drapeau ignoré en silence est un résultat qui répond à une autre question
 * que celle qu'on a posée.
 */
export function lireEchantillon(brut: string | undefined): number | undefined {
  if (brut === undefined) return undefined;
  const n = Number(brut);
  if (brut.trim() === "" || !Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`--sample=${brut} is not a whole number of cases (1 or more).\n`
      + `  Left as it was, this flag would have been ignored without a word and the whole\n`
      + `  corpus measured — a figure answering a different question than the one you asked.`);
  }
  return n;
}

/** Ce que le relevé garde d'un champ sous un palier. */
export type EntreeDuReleve = {
  bons: number; sur: number; ms: number;
  /**
   * Parmi les cas notés faux, ceux dont la réponse porte EXACTEMENT les mêmes mots que la
   * vérité attendue, dans un autre ordre. Un désaccord de convention, pas une extraction
   * ratée — et l'outil ne peut pas trancher lequel des deux ordres est le bon.
   */
  desordre?: number;
};

/**
 * LES MÊMES MOTS DANS UN AUTRE ORDRE.
 *
 * Mesuré sur la liste SDN de l'OFAC : le nom attendu s'écrit « AL-ZOMOR, Abboud Abdul Latif
 * Hassan » et l'outil rend l'ordre naturel. 25,7 % d'exactitude, qui se lit comme un modèle
 * incapable de lire un nom, alors que **les mots trouvés sont les bons**. Nous ne pouvons pas
 * décider quel ordre est le bon — c'est la convention du client — mais nous pouvons cesser de
 * présenter un désaccord de convention comme une extraction ratée.
 *
 * Un seul mot ne compte pas : réordonné, il serait identique, donc déjà juste.
 */
export function memesMots(a: string, b: string): boolean {
  const mots = (x: string) => normaliserReponse(x)
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort();
  const ma = mots(a), mb = mots(b);
  return ma.length > 1 && ma.length === mb.length && ma.every((m, i) => m === mb[i]);
}

/** Ce qu'on sait d'un champ AVANT d'avoir chargé le moindre modèle. */
export type PresenceChamp = {
  champ: string;
  /** Cas dont la vérité attendue se retrouve littéralement dans le texte source. */
  litteral: number;
  /**
   * Cas où elle n'y est pas littéralement, mais où TOUS ses mots y sont.
   *
   * C'est la deuxième forme rencontrée sur l'OFAC, et elle n'appelle pas le même remède que
   * la première : « AL-ZOMOR, Abboud Abdul Latif Hassan » n'est pas dans le texte, et
   * pourtant chacun de ses mots y est. La valeur est là, écrite autrement. Confondre les
   * deux ferait accuser un corpus sain d'être vide.
   */
  reordonne: number;
  /** Cas où le client n'a rien mis : il n'y a pas de vérité à trouver. */
  vides: number;
  total: number;
};

/**
 * LA VÉRITÉ ATTENDUE EST-ELLE SEULEMENT DANS LE TEXTE ?
 *
 * Mesuré sur l'OFAC : l'adresse attendue vient d'un fichier séparé et n'apparaît dans le
 * texte que **40 fois sur 300**. Le 0,7 % obtenu ressemblait à un échec d'extraction ; c'était
 * un corpus dans lequel la réponse n'est pas. Aucun palier ne peut extraire ce qui n'y est
 * pas, et un client construira exactement ce corpus-là, parce que ses champs viennent de sa
 * base et son texte de ses documents.
 *
 * Ça se mesure SANS MODÈLE, donc avant tout. Et ça se dit comme une BORNE INFÉRIEURE : la
 * vérité peut être présente sous une autre forme — « 3 May 1990 » pour « 1990-05-03 » — que
 * cette comparaison littérale ne voit pas. Un compte qui sous-estime se nomme, sinon il
 * accuse un corpus sain.
 */
export function presenceDeLaVerite(cas: Cas[], champs: string[]): PresenceChamp[] {
  const enMots = (x: string) => normaliserReponse(x).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return champs.map((champ) => {
    let litteral = 0, reordonne = 0, vides = 0;
    for (const c of cas) {
      const attendu = normaliserReponse(c.truth[champ] ?? "");
      if (attendu.length === 0) { vides++; continue; }
      const texte = normaliserReponse(c.text);
      if (texte.includes(attendu)) { litteral++; continue; }
      const presents = new Set(enMots(texte));
      const mots = enMots(attendu);
      if (mots.length > 0 && mots.every((m) => presents.has(m))) reordonne++;
    }
    return { champ, litteral, reordonne, vides, total: cas.length };
  });
}

/**
 * La phrase à dire avant de mesurer, ou rien.
 *
 * Le seuil est la MOITIÉ des cas renseignés, et il est CHOISI : en dessous, la majorité de la
 * note d'un champ se joue sur des dossiers où la réponse n'est pas dans le texte, et le taux
 * mesure alors le corpus plutôt que le palier. Aucun chiffre n'est prédit : ce qui s'affiche
 * est un compte et son dénominateur.
 */
export function direLaPresence(p: PresenceChamp[]): string | undefined {
  const renseignes = (x: PresenceChamp) => x.total - x.vides;
  const maigres = p.filter((x) => renseignes(x) > 0
    && (x.litteral + x.reordonne) * 2 < renseignes(x));
  const desordonnes = p.filter((x) => renseignes(x) > 0
    && x.reordonne * 2 >= renseignes(x));
  if (maigres.length === 0 && desordonnes.length === 0) return undefined;

  const blocs: string[] = [];
  if (maigres.length) {
    blocs.push(`⚠ ${maigres.length} field(s) whose expected value is mostly NOT in the text `
      + `you supplied:\n`
      + maigres.map((x) => `    ${x.champ}: found in ${x.litteral + x.reordonne} of the `
        + `${renseignes(x)} case(s) that have an expected value`
        + (x.vides > 0 ? `, and ${x.vides} case(s) have none at all` : ``)).join("\n")
      + `\n  No tier can extract what is not there; the rate below would read as a failed\n`
      + `  extraction and would in fact be measuring your corpus.\n`
      + `  This count is a LOWER bound: a value written another way — "3 May 1990" for\n`
      + `  "1990-05-03" — is present without being found this way.`);
  }
  if (desordonnes.length) {
    blocs.push(`⚠ ${desordonnes.length} field(s) whose expected value is in the text with its `
      + `words in a different order:\n`
      + desordonnes.map((x) => `    ${x.champ}: ${x.reordonne} of ${renseignes(x)} case(s), `
        + `against ${x.litteral} found as written`).join("\n")
      + `\n  The value is there, written another way — "SURNAME, Given" against the natural\n`
      + `  order. That is your convention, and we cannot tell which one is right; but the\n`
      + `  rate below will count these as failed extractions unless you supply the expected\n`
      + `  value in the order your chain produces.`);
  }
  return blocs.join("\n\n");
}

/**
 * Ce qu'il y a à dire APRÈS la mesure sur les désaccords de convention.
 *
 * L'annonce d'avant la mesure regarde la vérité attendue ; celle-ci regarde ce que les
 * paliers ont réellement rendu. Les deux sont nécessaires : un champ peut être écrit dans
 * l'ordre du client ET rendu dans un troisième ordre par un palier.
 *
 * Chaque ligne porte son dénominateur — les cas notés faux pour ce champ sous ce palier —
 * parce qu'un « 12 » sans « sur combien » ne dit pas si c'est l'explication du taux ou une
 * poignée de cas.
 */
export function direLesDesordres(
  releve: Record<string, Record<string, EntreeDuReleve>>,
): string | undefined {
  const lignes: string[] = [];
  for (const [champ, parPalier] of Object.entries(releve)) {
    for (const [palier, r] of Object.entries(parPalier)) {
      const faux = r.sur - r.bons;
      if (!r.desordre || faux <= 0) continue;
      lignes.push(`    ${champ} · ${palier}: ${r.desordre} of the ${faux} case(s) scored wrong`);
    }
  }
  if (lignes.length === 0) return undefined;
  return `⚠ Same words, different order — a convention disagreement, not a failed `
    + `extraction:\n` + lignes.join("\n")
    + `\n  The words found were yours; only the order differs, as in "SURNAME, Given" against\n`
    + `  the natural order. We cannot tell which order is right — it is your convention —\n`
    + `  but these cases are not the tier failing to read the document.\n`
    + `  Supply the expected value in the order your chain produces, or accept both.`;
}

export function questionSure(champ: string, fournies?: Record<string, string>): string {
  const q = questionPour(champ, fournies);
  /* Une question fournie par le client ou l'une des nôtres part telle quelle : ni l'une ni
     l'autre ne contient le nom de colonne. Seule la déduite le contient, et c'est la seule
     qu'on refabrique — depuis le nom nettoyé. */
  return q.provenance === "deduite" ? `What is the ${nomSur(champ)}?` : q.texte;
}

/**
 * Un nom de colonne rendu inoffensif dans une cellule de tableau markdown.
 *
 * LA BARRE ÉCHAPPÉE PAR UN BACKSLASH QUI S'ÉCHAPPAIT LUI-MÊME.
 *
 * `t.replace(/\|/g, "\\|")` seul suffit tant que l'entrée ne contient pas déjà de
 * backslash. Dès qu'elle en contient un juste avant une barre, la sortie porte `\\|` — et
 * en GFM `\\` est un backslash littéral, donc la barre redevient nue et **coupe la
 * cellule**. Mesuré en comptant les cellules de la ligne rendue :
 *
 *     "a|b"    →  `a\|b`      4 cellules   (correct)
 *     "a\|b"   →  `a\\|b`     5 CELLULES  (la ligne se décale)
 *
 * Signalé par une passe adversariale sur les alertes CodeQL, et **le témoin ne pouvait pas
 * le voir** : il cherchait `[^\\]\|`, donc un backslash devant la barre le désarmait. Un
 * motif est une affirmation, et celui-là affirmait la mauvaise chose.
 *
 * ON NE DOUBLE QUE LES BACKSLASHES QUI PRÉCÈDENT UNE BARRE, pas tous. Doubler tous les
 * backslashes rétablit l'intégrité de la ligne, mais un nom de colonne comme `C:\Users\x`
 * s'afficherait `C:\\Users\\x` dans le rapport du client — on aurait réparé la structure en
 * abîmant ce qu'elle contient. Ici seul le backslash adjacent à une barre double, ce qui est
 * inévitable : il faut un nombre pair devant `\|` pour que l'échappement tienne.
 */
export function cellule(v: string | number): string {
  const t = String(v);
  /* La barre d'abord — avec les backslashes qui la précèdent — parce que c'est elle qui casse
     la structure. Les accents graves ensuite, sinon le bloc de code se referme au milieu. */
  return "`" + t.replace(/(\\*)\|/g, (_, dos: string) => dos + dos + "\\|")
    .replace(/`/g, "'") + "`";
}

/** Le même nom, réduit à ce qui peut entrer dans une invite sans la réécrire. */
export function nomSur(champ: string): string {
  /* Liste blanche, pas liste noire : on énumère ce qui passe, jamais ce qui ne passe pas.
     Une liste noire se contourne par le caractère auquel personne n'a pensé. */
  const propre = champ.replace(/[^\p{L}\p{N} _.'-]/gu, " ").replace(/\s+/g, " ").trim();
  /* Vidé par le nettoyage : on ne renvoie pas une chaîne vide dans « What is the … ? »,
     qui produirait une question sans objet. Un repli nommé vaut mieux. */
  return propre.length > 0 ? propre : "unnamed field";
}

/*
 * LE TEXTE DONNÉ AU MODÈLE EST BORNÉ, ET LA BORNE VIENT DE LA FENÊTRE DU MODÈLE.
 *
 * Mesuré étape par étape sur une cellule de 20 Mo : lire le fichier et l'analyser coûte
 * 92 Mo, `loadExtractors` en coûte 1 557 — constant, indépendant du fichier — et
 * **l'extraction croît linéairement avec la longueur du texte**, environ 44 Mo par Mo. Sur
 * une cellule de 20 Mo cela fait près d'un gigaoctet de plus, sur la machine du client.
 *
 * LA BORNE NE RETIRE RIEN, et c'est mesuré et non supposé. Les deux extracteurs ont une
 * fenêtre de 512 et 514 jetons, lue dans leur `config.json` (`max_position_embeddings`), pas
 * estimée. Au-delà, ils ne voient pas le texte — éprouvé en plaçant la réponse à la fin :
 * trouvée à 589 caractères de bourrage, **perdue à 2 789**. Pire que perdue : le modèle rend
 * alors le début du bourrage comme s'il s'agissait de la réponse. Borner rend donc explicite
 * ce qu'il fait déjà en silence, et remplace une réponse inventée par un fait annoncé.
 *
 * LE CHIFFRE. 512 jetons × 16 caractères par jeton. Le 512 est lu ; le 16 est une marge sur
 * un rapport MESURÉ — au plus 4,60 caractères par jeton sur 200 documents du corpus, donc
 * une marge de 3,5×. On borne large exprès : couper avant la fenêtre retirerait au modèle du
 * texte qu'il aurait lu, ce que cette borne ne doit jamais faire.
 *
 * Pour situer : le document le plus long du corpus fait 221 caractères. La borne est à
 * 8 192. Elle ne se déclenche pas sur des données normales, et le cas qui l'accompagne le
 * vérifie dans les deux sens.
 */
export const FENETRE_JETONS = 512;
export const CARACTERES_PAR_JETON = 16;
export const PLAFOND_TEXTE = FENETRE_JETONS * CARACTERES_PAR_JETON;

/*
 * CE QUI A ÉTÉ BORNÉ, POUR LE DIRE. Au module parce que la boucle d'extraction et la sortie
 * qui l'annonce sont dans deux fonctions différentes, et que cette commande tourne une fois
 * par processus. Une troncature silencieuse fabriquerait un taux qui ne porte pas sur ce que
 * le client croit avoir mesuré, et il le citerait.
 */
/*
 * UNE ENTRÉE PAR CAS, PAS PAR EXTRACTION. La boucle passe sur chaque cas une fois PAR PALIER
 * et par champ : un compteur incrémenté là additionnait le même texte deux fois, et la sortie
 * annonçait « 8 484 caractères écartés » pour 4 242 réellement retirés. Trouvé par le cas qui
 * lance la commande — les cas unitaires sur `bornerTexte` ne pouvaient pas le voir.
 */
const casBornes = new Map<string, number>();

/** Pour les cas : remet les compteurs à zéro. */
export function oublierLesBornes(): void { casBornes.clear(); }
/** Ce que la dernière passe a écarté. */
export function bornesPosees(): { cas: number; caracteres: number } {
  return { cas: casBornes.size, caracteres: [...casBornes.values()].reduce((a, b) => a + b, 0) };
}

/** Rend le texte borné, et de combien il a été raccourci. */
export function bornerTexte(texte: string): { texte: string; ecarte: number } {
  if (texte.length <= PLAFOND_TEXTE) return { texte, ecarte: 0 };
  return { texte: texte.slice(0, PLAFOND_TEXTE), ecarte: texte.length - PLAFOND_TEXTE };
}

export function lireCsv(texte: string): Lecture {
  const lignes: string[][] = [];
  /* Le VRAI numéro de ligne du fichier, par ligne parsée. Un texte cité sur trois lignes
     décale tous les index : « line 7 » désignait la ligne 9 du fichier, et le client cherchait
     au mauvais endroit dans son propre export. Audit du 27 août 2026. */
  const numeros: number[] = [];
  let debutDeLigne = 1;
  let ligne: string[] = [], guillemets = false;
  /* Où la guillemet encore ouverte a été ouverte. Sans elle, le refus dirait « quelque part
     dans votre fichier », ce qui est inutilisable sur cinq mille lignes. */
  let ouvertureLigne = 0, numeroDeLigne = 1;

  /*
   * ─── LA CELLULE SE CONSTRUIT PAR TRANCHES, PAS CARACTÈRE PAR CARACTÈRE ───
   *
   * `cellule += c` dans cette boucle coûtait DEUX MILLE CINQ CENTS FOIS la taille du fichier
   * quand une seule cellule est longue. Mesuré le 25 août 2026, à octets égaux :
   *
   *     1 Mo réparti sur 22 310 lignes   →  pic  147 Mo, 0,3 s
   *     1 Mo dans UNE seule cellule      →  pic 2457 Mo, 6,8 s
   *    20 Mo dans une seule cellule      →  pic 4370 Mo, 63 s, puis SIGABRT
   *
   * C'est la FORME du fichier qui coûte, pas sa taille — et le déclencheur le plus probable
   * n'est pas malveillant : un guillemet ouvert puis refermé beaucoup plus loin avale des
   * milliers de lignes dans une cellule. Un export mal formé suffit. Le cas du guillemet
   * JAMAIS refermé était déjà refusé ; celui refermé trop tard n'avait rien pour l'arrêter.
   *
   * On ne recopie donc plus caractère par caractère : on retient l'indice de départ et l'on
   * découpe le texte d'origine quand la cellule se termine. Les morceaux n'existent que pour
   * les guillemets doublés, qui sont rares.
   */
  let debut = 0;
  let morceaux: string[] | null = null;
  const demesurees: { ligne: number; octets: number; ouvertureLigne: number }[] = [];
  const DEMESUREE = 1_000_000;
  const fermer = (fin: number): string => {
    const queue = texte.slice(debut, fin);
    const v = morceaux === null ? queue : (morceaux.push(queue), morceaux.join(""));
    morceaux = null;
    /* Des OCTETS réels, pas des unités UTF-16 : le champ s'appelle `octets` et s'imprime en
       Mo. Une cellule cyrillique de 900 000 caractères pèse ~1,8 Mo réels et n'était PAS
       signalée — la garde ratait précisément les écritures non latines que le produit met en
       avant. `Buffer.byteLength` mesure ce que le nom promet. */
    const octetsReels = Buffer.byteLength(v);
    if (octetsReels >= DEMESUREE) demesurees.push({ ligne: numeroDeLigne, octets: octetsReels,
      ouvertureLigne: guillemets ? ouvertureLigne : debutDeLigne });
    return v;
  };

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]!;
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        (morceaux ??= []).push(texte.slice(debut, i + 1));   /* garde UNE des deux guillemets */
        i++; debut = i + 1;
      } else if (c === '"') {
        (morceaux ??= []).push(texte.slice(debut, i));
        guillemets = false; debut = i + 1;
      } else if (c === "\n") numeroDeLigne++;
    } else if (c === '"') {
      (morceaux ??= []).push(texte.slice(debut, i));
      guillemets = true; ouvertureLigne = numeroDeLigne; debut = i + 1;
    } else if (c === ",") { ligne.push(fermer(i)); debut = i + 1; }
    else if (c === "\n" || c === "\r") {
      ligne.push(fermer(i));
      if (c === "\r" && texte[i + 1] === "\n") i++;
      debut = i + 1;
      numeroDeLigne++;
      if (ligne.some((x) => x.trim() !== "")) { lignes.push(ligne); numeros.push(debutDeLigne); }
      debutDeLigne = numeroDeLigne;
      ligne = [];
    }
  }
  const cellule = fermer(texte.length);
  if (guillemets) {
    throw new Error(
      `Line ${ouvertureLigne} of your CSV opens a quote that is never closed.\n`
      + `  Everything after it was swallowed as the contents of a single cell: the file was read\n`
      + `  to the end, but only ${lignes.length} row(s) remain instead of your data.\n`
      + `  This tool refuses rather than report a rate over what it did not lose.\n\n`
      + `  To write a quote INSIDE a cell, double it: "he said ""hello""".\n`
      + `  To find the offending line: sed -n '${ouvertureLigne}p' <your file>`);
  }
  if (cellule !== "" || ligne.length) { ligne.push(cellule); if (ligne.some((x) => x.trim() !== "")) { lignes.push(ligne); numeros.push(debutDeLigne); } }

  const entete = lignes.shift();
  numeros.shift();   /* la ligne de l'en-tête part avec lui : numeros[i] suit lignes[i] */
  if (!entete || entete.length < 2) {
    throw new Error(
      `Your file has ${entete?.length ?? 0} column(s). It needs at least two: the input text, and\n`
      + `  one expected answer per field you want measured.\n\n`
      + `  The first row is read as the header. If your file has no header, the first record\n`
      + `  was consumed as one — add a header row naming the columns.`);
  }
  /*
   * DEUX COLONNES DU MÊME NOM DÉCALENT TOUT, EN SILENCE.
   *
   * Mesuré sur un fichier `text,name,name` : le texte mesuré devenait « Anna » au lieu de
   * « bonjour Anna », et la vérité attendue devenait la seconde colonne. L'outil ne
   * plantait pas — il mesurait autre chose et rendait un taux, présenté comme un résultat.
   *
   * Un doublon d'en-tête n'a aucune lecture raisonnable : on ne peut pas savoir laquelle des
   * deux colonnes le client voulait, et deviner serait pire que refuser.
   */
  const vus = new Map<string, number>();
  for (const nom of entete) {
    const propre = nom.trim().replace(/^\uFEFF/, "");
    vus.set(propre, (vus.get(propre) ?? 0) + 1);
  }
  const doublons = [...vus.entries()].filter(([, n]) => n > 1).map(([nom]) => nom);
  if (doublons.length > 0) {
    throw new Error(
      `Your header names the same column twice: ${doublons.map((d) => `"${d}"`).join(", ")}.\n\n`
      + `  There is no reasonable reading of that. The columns would shift, and this tool\n`
      + `  would measure a different field from the one you meant — silently, and still\n`
      + `  report a rate.\n\n`
      + `  Rename one of them, or remove it.`);
  }

  /*
   * ─── LES NOMS DÉCIDENT, PAS LE NOMBRE DE COLONNES ───
   *
   * La règle était : deux colonnes veut dire « texte, réponse », trois ou plus veut dire
   * « la première est un identifiant ». Elle est documentée dans l'aide, et elle devine
   * quand même — **elle fait un pari sur les données du client, à sa place.**
   *
   * Mesuré le 24 août 2026 sur un export à trois colonnes sans identifiant, la forme la
   * plus naturelle qu'un système produit : `text,name,birth` était lu comme
   * identifiant = `text`, texte d'entrée = `name`, champ mesuré = `birth`. **Le document
   * du client devenait une étiquette et le nom d'une personne devenait le document.**
   * Sortie 0, aucun avertissement, et un taux publié sur cette lecture.
   *
   * Trois cas hostiles sur dix-neuf venaient de cette seule règle : colonne en trop,
   * colonnes dans le désordre, export sans identifiant.
   *
   * Maintenant : s'il y a un en-tête, on lit les NOMS. `text` nomme le texte d'entrée,
   * `id` nomme l'identifiant s'il existe, tout le reste est un champ à mesurer. Deux
   * colonnes sans `text` gardent la lecture positionnelle — il n'y a qu'une lecture
   * possible et c'est la forme des jeux publics. Trois colonnes ou plus sans `text` sont
   * REFUSÉES : il y a deux lectures et deviner est exactement le défaut.
   */
  const noms = entete.map((x) => x.trim().replace(/^\uFEFF/, ""));
  const iTexte = noms.findIndex((n) => n.toLowerCase() === "text");
  const iId = noms.findIndex((n) => n.toLowerCase() === "id");

  let colTexte: number, colId: number, colChamps: number[];
  if (iTexte >= 0) {
    colTexte = iTexte;
    colId = iId;
    colChamps = noms.map((_, i) => i).filter((i) => i !== iTexte && i !== iId);
  } else if (noms.length === 2) {
    colTexte = 0; colId = -1; colChamps = [1];
  } else {
    throw new Error(
      `Your header names ${noms.map((n) => `"${n}"`).join(", ")} — none of them is "text".\n\n`
      + `  With ${noms.length} columns there are two readings: the first column could be an\n`
      + `  identifier, or it could be the input text. This tool used to guess by counting\n`
      + `  columns, which meant reading your document column as a label without saying so.\n\n`
      + `  Name the column holding the input text "text". Name an identifier column "id"\n`
      + `  if you have one. Every other column is read as a field to measure.`);
  }

  const champs = colChamps.map((i) => noms[i]!);

  /*
   * UNE LIGNE MALFORMÉE EST NOMMÉE ET ÉCARTÉE, PAS INCLUSE.
   *
   * Elle était incluse : une ligne à un seul champ entrait comme un cas dont la réponse
   * attendue est vide — donc comptée comme une erreur de l'outil. **L'export cassé du
   * client dégradait le taux qu'on lui montre**, et il n'aurait jamais su pourquoi.
   *
   * Le compte des lignes écartées voyage avec le taux : un chiffre issu d'une sélection
   * porte le compte de ce qu'il écarte, ou il ne se publie pas.
   */
  const ecartees: { ligne: number; champs: number }[] = [];
  const courtes: { ligne: number; champs: number }[] = [];
  const cas: { id: string; text: string; truth: Record<string, string> }[] = [];
  lignes.forEach((l, i) => {
    /*
     * TROP DE CELLULES : ÉCARTÉ. PAS ASSEZ : GARDÉ, MAIS COMPTÉ.
     *
     * Les deux ne se valent pas et ce dépôt a déjà tranché pour l'un des deux. Une ligne
     * plus COURTE que l'en-tête est une cellule finale vide — cas ordinaire d'un export,
     * et un cas de ce fichier l'exige : « une cellule manquante devient une chaîne vide ».
     * On garde donc ce choix.
     *
     * Mais il a un prix, et il était invisible : la réponse attendue vide compte comme une
     * erreur de l'outil, donc **l'export incomplet du client dégrade le taux qu'on lui
     * montre**. Le compte de ces lignes voyage maintenant à côté du taux. Le choix reste
     * celui du dépôt ; ce qui change, c'est que le client peut le voir.
     *
     * Une ligne plus LONGUE, elle, n'a aucune lecture raisonnable : des cellules qui ne
     * correspondent à aucune colonne. Écartée, nommée par son numéro de ligne.
     */
    if (l.length > noms.length) {
      ecartees.push({ ligne: numeros[i] ?? i + 2, champs: l.length });
      return;
    }
    if (l.length < noms.length) courtes.push({ ligne: numeros[i] ?? i + 2, champs: l.length });
    cas.push({
      /* `ligne-N` et non `N` : un id de secours nu peut collisionner avec un id réel plus
         loin dans le fichier, et la collision devenait un doublon silencieux. */
      id: colId >= 0 ? ((l[colId] ?? "").trim() || `ligne-${numeros[i] ?? i + 2}`) : `ligne-${numeros[i] ?? i + 2}`,
      text: l[colTexte] ?? "",
      truth: Object.fromEntries(colChamps.map((c) => [noms[c]!, (l[c] ?? "").trim()])),
    });
  });

  /*
   * UN IDENTIFIANT EN DOUBLE FAUSSE TOUT CE QUI INDEXE DESSUS, ET TROIS CONSOMMATEURS LE FONT.
   * Deux lignes d'id « 7 » — un doublon d'export parfaitement ordinaire — comptaient DEUX
   * verdicts pour UN document (« bons=2/2, every identifier matches »), et casBornes, une Map
   * par id, écrasait : deux cas tronqués partageant un id s'annonçaient « 1 case cut ».
   * Aggravant : une cellule id manquante recevait String(i+1), qui peut COLLISIONNER avec un
   * id réel plus loin dans le fichier — la ligne 3 sans id devenait « 3 », l'id « 3 » existait.
   *
   * On refuse en NOMMANT les doublons et leurs lignes : l'exactitude d'une chaîne cliente se
   * calculerait fausse en silence, et c'est le chiffre que l'acheteur regarde. Les ids de
   * secours sont préfixés (`ligne-N`) pour ne jamais collisionner avec un id réel.
   * Audit du 27 août 2026.
   */
  const lignesParId = new Map<string, number[]>();
  cas.forEach((c, k) => {
    const l = lignesParId.get(c.id) ?? [];
    l.push(numeros[k] ?? k + 2);
    lignesParId.set(c.id, l);
  });
  const idsEnDouble = [...lignesParId.entries()].filter(([, lignes]) => lignes.length > 1);
  if (idsEnDouble.length) {
    throw new Error(
      `duplicate case identifier(s): `
      + idsEnDouble.slice(0, 5).map(([id, lignes]) => `"${id}" (rows ${lignes.join(", ")})`).join(", ")
      + (idsEnDouble.length > 5 ? ` and ${idsEnDouble.length - 5} more` : "") + `.\n`
      + `  Every rate here is computed per identifier: a duplicate counts one document twice\n`
      + `  and the accuracy of your pipeline comes out wrong without a word. Deduplicate the\n`
      + `  export, or give each row its own id, and run again. Nothing was measured.`);
  }

  return { champs, cas, ecartees, courtes, demesurees, lecture: { colTexte, colId, noms } };
}

/** Des règles fournies par le lecteur, en expressions régulières nommées par champ. */
/**
 * Ce que le client nous envoie : des **issues**, jamais des valeurs.
 *
 * La version précédente de ce mode chargeait ce que sa chaîne avait rendu — des noms, des dates
 * de naissance, des numéros de passeport. C'est-à-dire des données personnelles, arrivant chez
 * nous, dans un outil dont la lettre de mission déclare qu'aucune donnée personnelle ne nous
 * parvient et qu'aucun accord de traitement n'est requis. Sous droit grec l'article 28 en
 * exigeait un. La correction n'est pas de le signer, c'est de ne pas recevoir les valeurs.
 *
 * **La notation se fait chez lui.** Notre outil tourne déjà sur sa machine et sa clé de
 * réponses y est ; il note avec notre correcteur et nous renvoie une issue par cas. Donc son
 * exactitude reste **mesurée** — par notre code, exécuté ailleurs — et pas déclarée. Mais cette
 * distinction ne tient que si le fichier dit **quelle version** l'a notée : sans ça, « noté par
 * notre correcteur là-bas » et « tapé à la main » se lisent pareil, et c'est le défaut du
 * `null` qui vaut deux choses, corrigé partout ailleurs dans ce dépôt.
 *
 * **Ce que ça coûte, écrit plutôt que découvert :** on ne peut plus re-noter ses cas sous un
 * correcteur plus strict sans qu'il remesure. Le balayage de sévérité, gratuit sur nos propres
 * lignes, ne l'est pas sur les siennes. C'est le prix de ne pas recevoir ses données, et il se
 * paie une fois, en connaissance de cause.
 */
export type IssueClient = "clean" | "wrong" | "blank";

export type SortiesFournies = {
  /** Le nom que porte sa chaîne dans les tableaux. */
  nom: string;
  /** `issues[champ][id du cas]` — le verdict, jamais la valeur. */
  issues: Record<string, Record<string, IssueClient>>;
  /** Qui a noté, et avec quoi. Sans ça l'exactitude n'est plus mesurée mais crue. */
  notePar?: { outil?: string; version?: string; correcteur?: string };
  /** Déclarés par lui, jamais mesurés ici. */
  declares?: { coutParMilleDocuments?: number; msParDocument?: number };
};

/**
 * La provenance d'un chiffre déclaré par le client, dans le vocabulaire existant.
 *
 * `déclaré` n'est pas un mot de ce vocabulaire, et le vocabulaire est copié à l'identique dans
 * cinq dépôts : en ajouter un cinquième terme ici les ferait diverger. Le terme juste existe
 * déjà — `assumed`, « une entrée que personne ici ne peut connaître » — et c'est exactement ce
 * qu'est un coût qu'un client nous donne. Ce que le mot ne dit pas, c'est **qui** l'a posée,
 * alors `declarePar` le dit à côté au lieu d'inventer un rang.
 */
export const PROVENANCE_DES_DECLARES = {
  provenance: "assumed" as const,
  declarePar: "le client" as const,
  pourquoi: "Un chiffre que le client nous donne est une entrée que personne ici ne peut "
    + "vérifier. `assumed` est le rang existant pour ça ; ajouter « déclaré » au vocabulaire "
    + "ferait diverger cinq dépôts qui le copient à l'identique.",
};

export const ISSUES_VALIDES: IssueClient[] = ["clean", "wrong", "blank"];

/**
 * Comment une durée s'écrit selon d'où elle vient.
 *
 * Une durée mesurée ici et une durée que le client nous a donnée se ressemblent dans un
 * tableau, et c'est exactement le défaut que la provenance existe pour empêcher. Celle du
 * client porte donc sa marque à chaque ligne où elle apparaît, pas seulement dans un en-tête
 * qu'on lit une fois.
 */
export function ecrireMs(ms: number, declaree: boolean): string {
  if (!Number.isFinite(ms)) return "no declared duration";
  return declaree ? `${ms.toFixed(0)} ms (declared)` : `${ms.toFixed(0)} ms`;
}

/**
 * LE NOM DE LA CHAÎNE DU CLIENT DEVIENT UN NOM DE PALIER, DONC UNE CELLULE DE TABLEAU.
 *
 * `brut.nom ?? "your chain"` n'a jamais demandé ce qu'était `brut.nom`. Mesuré le 25 août
 * 2026 : une barre verticale coupe la cellule du tableau rendu au client et décale toute la
 * ligne ; quatre cents caractères détruisent l'alignement de la console et du tableau ; un
 * retour à la ligne coupe la ligne en deux. Aucun des trois n'était refusé, et aucun ne
 * ressemble à une attaque — ce sont des noms qu'on écrit sans y penser.
 */
/**
 * TOUT CE QUI COMMENCE PAR `--` EST UNE INTENTION, ET UNE INTENTION IGNORÉE EST UN RÉSULTAT
 * QUI RÉPOND À UNE AUTRE QUESTION.
 *
 * Mesuré : `--task=xyz` sortait 0 et rendait un rapport d'extraction sans jamais prononcer le
 * mot « task ». Le client qui écrit `--classifiy` obtient donc un rapport qui a l'air normal
 * et qui mesure autre chose que ce qu'il a demandé. Même forme que `--sample=abc` ignoré en
 * silence, mais celle-ci attrape toutes les fautes de frappe d'un coup, y compris celles
 * qu'on n'a pas prévues.
 */
export const DRAPEAUX_CONNUS: readonly string[] = [
  "cases", "rules", "sorties", "questions", "task", "sample",
  "llm", "journal", "show-questions", "yes-run-it",
];

export const TACHES: readonly string[] = ["extract", "classify"];

export function drapeauxInconnus(argv: readonly string[]): string[] {
  return argv
    .filter((a) => a.startsWith("--"))
    .map((a) => a.slice(2).split("=")[0]!)
    .filter((nom) => !DRAPEAUX_CONNUS.includes(nom));
}

export function exigerDrapeauxConnus(argv: readonly string[]): void {
  const inconnus = drapeauxInconnus(argv);
  if (inconnus.length === 0) return;
  throw new Error(`unknown option(s): ${inconnus.map((d) => "--" + d).join(", ")}\n`
    + `  Accepted: ${DRAPEAUX_CONNUS.map((d) => "--" + d).join(", ")}\n`
    + `  Left as it was, a mistyped option is dropped without a word and the run answers a\n`
    + `  different question than the one you asked.`);
}

export function lireTache(brut: string | undefined): string {
  if (brut === undefined) return "extract";
  if (!TACHES.includes(brut)) {
    throw new Error(`--task=${brut} is not a task. Accepted: ${TACHES.join(", ")}.\n`
      + `  This used to fall through to "extract" in silence.`);
  }
  return brut;
}

export function nomDeChaine(brut: unknown, chemin: string): string {
  if (brut === undefined || brut === null) return "your chain";
  if (typeof brut !== "string") {
    throw new Error(`${chemin}: \`nom\` is ${typeof brut}, not a string.\n`
      + `  It becomes a tier name in the table you are handed, next to ours.`);
  }
  const propre = brut.trim();
  if (propre.length === 0) {
    throw new Error(`${chemin}: \`nom\` is empty. Leave the key out to be called `
      + `"your chain", or give it a name.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(propre)) {
    throw new Error(`${chemin}: \`nom\` contains a line break or a control character.\n`
      + `  It is printed on one line of a table; a second line lands under the wrong column.`);
  }
  const MAX = 40;
  if (propre.length > MAX) {
    throw new Error(`${chemin}: \`nom\` is ${propre.length} characters. `
      + `${MAX} at most — it is a column in the table you are handed.`);
  }
  return propre;
}

export function chargerSorties(chemin: string): SortiesFournies {
  const brut = JSON.parse(readFileSync(chemin, "utf8")) as Partial<SortiesFournies>
    & { valeurs?: unknown };

  /*
   * L'ancienne forme est refusée avec sa raison, pas ignorée.
   *
   * Elle a existé une heure et quelqu'un l'aura copiée. Un fichier de valeurs chargé en
   * silence, ou pire lu comme vide, ferait entrer chez nous exactement ce que ce refus existe
   * pour empêcher.
   */
  if (brut.valeurs !== undefined) {
    throw new Error(`${chemin} carries a \`valeurs\` key, which is no longer accepted.\n`
      + `  Values extracted from an identity document are personal data, and this tool states\n`
      + `  that it receives none. Grade on your side and send only the outcomes:\n`
      + `  { "nom": "…", "issues": { "<champ>": { "<id>": "clean" | "wrong" | "blank" } },\n`
      + `    "notePar": { "outil": "cascade", "version": "<commit>" } }`);
  }
  /*
   * UN NOM DE CHAÎNE ÉGAL À UN NOM DE PALIER EFFACE LA COLONNE DU CLIENT. « small » est un nom
   * parfaitement naturel pour « ma chaîne au petit modèle » — et la boucle des paliers écrivait
   * `releve[champ]["small"]` PAR-DESSUS sa ligne : sa chaîne disparaissait du tableau sans un
   * mot, et trois comparaisons `palier === sorties.nom` devenaient vraies pour le mauvais
   * objet. Audit du 27 août 2026.
   */
  if (typeof brut.nom === "string" && (TIERS as readonly string[]).includes(brut.nom)) {
    throw new Error(`${chemin}: "nom" is "${brut.nom}", which is one of our tier names.\n`
      + `  The results table indexes rows by name: your pipeline's row would be OVERWRITTEN by\n`
      + `  the "${brut.nom}" tier's measurements, and disappear without a word. Name it after\n`
      + `  your system — "my-chain", "prod-v2" — and run again. Nothing was measured.`);
  }
  /*
   * LES CHIFFRES DÉCLARÉS SONT VALIDÉS À L'ENTRÉE, PAS DÉCOUVERTS À L'AFFICHAGE. Un
   * `"msParDocument": "45"` — chaîne, JSON écrit à la main — faisait dire à l'en-tête
   * « declared by you » pendant que chaque ligne du tableau imprimait « no declared
   * duration » : deux lecteurs du même champ, deux verdicts. Audit du 27 août 2026.
   */
  if (brut.declares !== undefined) {
    for (const [cle, v] of Object.entries(brut.declares)) {
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
        throw new Error(`${chemin}: declares.${cle} is ${JSON.stringify(v)}, not a finite number.\n`
          + `  JSON numbers carry no quotes: write ${cle}: 45, not "${String(v)}". Nothing was measured.`);
      }
    }
  }
  if (!brut.issues || typeof brut.issues !== "object") {
    throw new Error(`${chemin}: no \`issues\` key. Expected shape:\n`
      + `  { "nom": "…", "issues": { "<champ>": { "<id du cas>": "clean" | "wrong" | "blank" } },\n`
      + `    "notePar": { "outil": "cascade", "version": "<commit>" },\n`
      + `    "declares": { "coutParMilleDocuments": …, "msParDocument": … } }`);
  }

  /* Toute valeur hors des trois issues est refusée : c'est ainsi qu'une donnée entrerait. */
  for (const [champ, parCas] of Object.entries(brut.issues)) {
    for (const [id, v] of Object.entries(parCas as Record<string, unknown>)) {
      if (!ISSUES_VALIDES.includes(v as IssueClient)) {
        throw new Error(`${chemin}: ${champ}/${id} is ${JSON.stringify(v)}, which is not an `
          + `outcome.\n  The only three accepted are ${ISSUES_VALIDES.join(", ")}. A value here `
          + `would be personal data.`);
      }
    }
  }
  return { nom: nomDeChaine(brut.nom, chemin), issues: brut.issues,
    notePar: brut.notePar, declares: brut.declares };
}

/**
 * Ce qui ne correspond pas entre son fichier et nos cas — compté et nommé, jamais sauté.
 *
 * Un document présent chez lui et absent chez nous, ou l'inverse, est la façon la plus simple
 * de faire mentir une comparaison sans qu'aucun chiffre n'ait l'air faux : le taux se calcule
 * sur ce qui reste, et ce qui reste s'est choisi tout seul.
 */
export function correspondance(cas: Cas[], champs: string[], s: SortiesFournies) {
  const nos = new Set(cas.map((c) => c.id));
  const manquants: Record<string, string[]> = {};
  const inconnus: Record<string, string[]> = {};
  for (const champ of champs) {
    const siens = s.issues[champ] ?? {};
    manquants[champ] = cas.filter((c) => !(c.id in siens)).map((c) => c.id);
    inconnus[champ] = Object.keys(siens).filter((id) => !nos.has(id));
  }
  const total = champs.reduce((a, c) => a + manquants[c]!.length + inconnus[c]!.length, 0);
  return { manquants, inconnus, total, champsSansAucuneValeur: champs.filter((c) => !s.issues[c]) };
}

/*
 * `--rules` EST UNE ENTRÉE CLIENT, ET C'ÉTAIT LA SEULE QUI NE SE FAISAIT PAS TRAITER
 * COMME TELLE.
 *
 * `--questions` refuse un fichier illisible, refuse une valeur qui n'est pas une chaîne, et
 * nomme la clé fautive. Ici, `JSON.parse` puis `Object.entries` puis `new RegExp` acceptaient
 * tout, et chaque forme d'erreur avait sa façon de passer inaperçue :
 *
 *   `["a","b"]`      → Object.entries d'un tableau rend { "0": /a/, "1": /b/ } : des règles
 *                      pour des colonnes nommées « 0 » et « 1 », qui n'existent pas. Aucune
 *                      règle ne s'applique, AUCUNE ligne `rules` n'apparaît, et le rapport
 *                      écrit quand même « That your regexes generalise beyond these cases ».
 *                      Mesuré : le client passe un fichier, rien n'est mesuré, et le rapport
 *                      affirme le contraire de ce qui s'est passé.
 *   `{"champ": 42}`  → new RegExp(42) rend /42/. On invente une règle que le client n'a pas
 *                      écrite, et on lui rend son exactitude.
 *   un nom de colonne mal orthographié → même silence que le tableau.
 *
 * Le fichier est donc validé, et surtout : on vérifie que les règles portent sur des colonnes
 * QUI EXISTENT. Une règle qui ne s'applique à rien n'est pas une règle, c'est un trou.
 */
export function chargerRegles(chemin: string, champs: readonly string[]): Record<string, RegExp> {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(chemin, "utf8"));
  } catch (e) {
    throw new Error(`${chemin}: not readable as JSON — ${(e as Error).message}\n`
      + `  Expected { "your column": "a regular expression" }.`);
  }
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) {
    const quoi = brut === null ? "null" : Array.isArray(brut) ? "an array" : typeof brut;
    throw new Error(`${chemin}: expected an object { "your column": "a regular expression" }, `
      + `got ${quoi}.\n`
      + `  An array would be read as rules for columns named "0", "1", … — none of which\n`
      + `  exist, so nothing would be measured and the report would not say so.`);
  }

  const connus = new Set(champs);
  /* Sans prototype : une clé `__proto__` venue du fichier client écrirait sur le
     prototype de cet objet au lieu d'y ajouter une entrée. */
  const regles: Record<string, RegExp> = Object.create(null);
  const inconnus: string[] = [];
  for (const [champ, motif] of Object.entries(brut as Record<string, unknown>)) {
    if (typeof motif !== "string") {
      throw new Error(`${chemin}: the rule for "${champ}" is ${typeof motif}, not a string.\n`
        + `  A number would become the pattern /${String(motif)}/ — a rule you did not write.`);
    }
    try {
      regles[champ] = new RegExp(motif);
    } catch (e) {
      throw new Error(`${chemin}: the rule for "${champ}" is not a valid regular expression.\n`
        + `  ${(e as Error).message}`);
    }
    if (!connus.has(champ)) inconnus.push(champ);
  }

  const total = Object.keys(regles).length;
  if (total === 0) {
    throw new Error(`${chemin} is empty. Give at least one rule, or drop --rules: without it\n`
      + `  the report says plainly that no free tier was measured.`);
  }
  if (inconnus.length === total) {
    throw new Error(`${chemin}: none of its ${total} rule(s) name a column of your CSV.\n`
      + `  Rules for: ${apercu(inconnus, MONTRES)}\n`
      + `  Your columns: ${apercu([...champs], MONTRES)}\n`
      + `  Nothing would be measured, and a report that measured nothing must not read like`
      + ` one that did.`);
  }
  if (inconnus.length > 0) {
    console.log(`\n⚠ ${inconnus.length} of ${total} rule(s) name a column your CSV does not have `
      + `and were not measured:\n  ${apercu(inconnus, MONTRES)}`);
  }
  return regles;
}

/**
 * Le journal des tentatives est **facultatif ici, et éteint par défaut**.
 *
 * Partout ailleurs dans ce dépôt, garder chaque tentative est le bon réflexe : le corpus est
 * synthétique, écrit par nous, et le jeter coûte une passe de GPU. Ici les cas sont ceux du
 * lecteur — des dossiers d'identité réels, potentiellement. Écrire leur texte et les valeurs
 * extraites dans un fichier qu'il n'a pas demandé n'est pas un service qu'on rend, c'est une
 * copie de données personnelles qu'on fabrique à son insu.
 *
 * Donc : `--journal` pour l'activer, et rien sans ça. Le même format, la même valeur — les
 * six requêtes gratuites marchent sur ses cas comme sur les nôtres — mais c'est lui qui
 * décide qu'une deuxième copie existe.
 */
/**
 * Le rapport que le client garde, construit à part pour pouvoir être éprouvé.
 *
 * Il ne contenait qu'un tableau de taux. Sur des colonnes que nous ne connaissons pas, il
 * annonçait donc « large · 0,0 % » sur le nom, SANS un mot sur la question déduite — et
 * quelqu'un qui le relit la semaine suivante conclut que le modèle ne sait pas lire un nom.
 * Le même champ fait 100 % sous la question du client.
 *
 * L'avertissement vivait dans le terminal et mourait avec lui. **Une réserve qui ne voyage
 * pas avec le chiffre n'existe pas.**
 *
 * Fonction pure, et c'est délibéré : un témoin qui devrait lancer toute la mesure pour la
 * lire chargerait deux modèles, donc ne tournerait pas — et le seul endroit qui a menti
 * resterait sans témoin.
 */
export function rapportPourLeClient(o: {
  cas: number; champs: string[]; date: string;
  questions: Record<string, { texte: string; provenance: "fournie" | "mesuree" | "deduite" }>;
  lignes: (string | number)[][];
  avecRegles: boolean;
}): string {
  const deduites = o.champs.filter((c) => o.questions[c]!.provenance === "deduite");
  const entete = [
    `# Your cases, measured`,
    ``,
    `${o.cas} case(s), ${o.champs.length} field(s), measured on this machine on ${o.date}. `
      + `Nothing left it.`,
    ``,
    `## The question each field was asked`,
    ``,
    table(["Field", "Question", "Where it comes from"], o.champs.map((c) => {
      const q = o.questions[c]!;
      return [cellule(c), cellule(q.texte),
        { fournie: "**yours**",
          mesuree: "measured — our own field, published rates were measured under it",
          deduite: "**derived from your column name**" }[q.provenance]];
    })),
  ];
  if (deduites.length) {
    entete.push(``,
      `> **${deduites.length} question(s) were derived from your column names.** That is a `
      + `choice made on your behalf, not a measurement. **The rates below are not comparable `
      + `to the ones in cascade's README**, which were measured under the questions marked `
      + `"measured" above. On a sample of client cases, the same field scored 0 % under a `
      + `derived question and 100 % under the client's own — the question is worth a hundred `
      + `points. Supply yours with \`--questions=file.json\` and measure again before `
      + `concluding anything about a tier.`);
  }
  /* Un blanc avant et après chaque tableau : un lecteur markdown strict colle sinon le titre
     au tableau, et la section entière se rend en un seul paragraphe. */
  entete.push(``, `## Accuracy per field and tier`, ``, ``);

  const pied = [``, ``, `## What this does not establish`, ``,
    `- That these rates hold on documents other than the ${o.cas} you supplied.`,
    `- ${o.avecRegles ? "That your regexes generalise beyond these cases."
      : "What a free tier would carry: no rule of yours was measured — see `--rules`."}`,
    `- That the tiers here are the ones you should run: they are the ones this repository has.`,
  ];
  return entete.join("\n")
    + table(["Field", "Tier", "Accuracy", "Interval", "n", "Median ms"], o.lignes)
    + pied.join("\n") + "\n";
}

export async function mesurerVosCas(
  cas: Cas[], champs: string[], paliers: TierName[], regles?: ReglesEvaluees,
  journaliser = false, sorties?: SortiesFournies,
  /* Les questions posées aux modèles, une par champ. Absentes, elles se déduisent du nom de
     colonne — et ce choix s'affiche, parce qu'un taux obtenu sous une question déduite n'est
     pas comparable à celui du README. */
  questions?: Record<string, string>,
): Promise<Record<string, Record<TierName, EntreeDuReleve>>> {
  const releve: Record<string, Record<TierName, EntreeDuReleve>> = {};
  const journal = journaliser ? ouvrirJournal("vos-cas", {
    quoi: "Vos cas, palier par palier — journal demandé explicitement avec --journal.",
    split: "vos-cas", cases: cas.length,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  }) : undefined;
  for (const champ of champs) {
    releve[champ] = {} as Record<TierName, { bons: number; sur: number; ms: number }>;

    /*
     * Le palier du client : ses valeurs, notre correcteur.
     *
     * Aucune durée n'est relevée ici — nous n'avons rien exécuté. Le `ms` qui apparaît vient
     * de sa déclaration, ou vaut `null` s'il n'en a pas donné : mettre zéro le ferait passer
     * pour instantané, ce qui est faux dans la seule direction qui l'avantage.
     */
    if (sorties) {
      const siennes = sorties.issues[champ] ?? {};
      let bons = 0, apparies = 0;
      for (const c of cas) {
        if (!(c.id in siennes)) continue;      // absent de son fichier : compté ailleurs, pas ici
        apparies++;
        if (siennes[c.id] === "clean") bons++;
      }
      releve[champ]![sorties.nom as TierName] = {
        bons, sur: apparies,
        ms: sorties.declares?.msParDocument ?? Number.NaN,
      };
    }

    /* Les règles ont déjà été évaluées, bornées, avant qu'un modèle soit chargé. Une règle
       refusée n'a pas de valeurs, donc pas de ligne : elle ne se glisse pas dans le temps
       par palier sous l'étiquette « lent ». */
    const valeursRegle = regles?.valeurs[champ];
    if (valeursRegle) {
      let bons = 0;
      for (let i = 0; i < cas.length; i++) {
        if (correct(valeursRegle[i] ?? "", cas[i]!.truth[champ]!)) bons++;
      }
      releve[champ]!["rules" as TierName] = {
        bons, sur: cas.length, ms: regles!.ms[champ] ?? 0,
      };
    }

    for (const palier of paliers) {
      let bons = 0, desordre = 0;
      const durees: number[] = [];
      /*
       * L'AVANCEMENT SE COMPTE, IL NE SE PRÉDIT PAS.
       *
       * Mesuré le 24 août 2026 : cent mille lignes sont lues, annoncées, puis douze
       * minutes passent sans une ligne de sortie — et il en reste des heures. Rien ne
       * meurt et rien ne ment ; l'acheteur voit un terminal figé et l'arrête.
       *
       * Ce qui s'affiche est le compte fait sur le compte total, connu dès la première
       * ligne. **Pas une durée restante :** une durée devinée qui se trompe d'un facteur
       * deux fait plus de mal que pas de durée du tout, et ce dépôt refuse partout
       * ailleurs de publier un chiffre qu'il n'a pas mesuré.
       */
      const pas = cas.length >= 1000 ? Math.ceil(cas.length / 20) : 0;
      let faits = 0;
      for (const c of cas) {
        if (pas > 0 && faits > 0 && faits % pas === 0) {
          process.stderr.write(`  ${champ} · ${palier} · ${faits}/${cas.length}\n`);
        }
        faits++;
        const t0 = performance.now();
        /* `extract` attend un ClientFile et un Field ; les cas du lecteur ont les mêmes deux
           propriétés utiles, et le champ n'est qu'une clé. Le typage local est plus étroit
           que la réalité, d'où la conversion — explicite plutôt que silencieuse. */
        /* Le document est examiné une fois, avant la première extraction : le signal porte
           sur le texte fourni, pas sur ce que tel palier en a fait. */
        examiner(c.id, c.text);
        const borne = bornerTexte(c.text);
        if (borne.ecarte > 0) casBornes.set(c.id, borne.ecarte);
        const got = await extract(palier, { id: c.id, text: borne.texte, truth: c.truth } as never,
          champ as never, "reference", questionSure(champ, questions));
        const ms = performance.now() - t0;
        durees.push(ms);
        journal?.ligne({
          tier: palier, field: champ, caseId: c.id, phrasing: "reference", split: "vos-cas",
          outcome: issue(got, c.truth[champ]!), ms: Number(ms.toFixed(3)),
          value: got, expected: c.truth[champ]!,
        });
        /* La forme est notée EN MÊME TEMPS que la justesse, sur le même appel : deux
           parcours séparés diraient un jour deux choses différentes du même corpus. */
        if (noter(palier, champ, got, c.truth[champ]!, borne.texte) === "juste") bons++;
        /* Noté faux, mais avec exactement les mêmes mots : c'est un désaccord de convention.
           On compte, on ne garde rien — le compte reste chez le client comme le reste. */
        else if (memesMots(got, c.truth[champ]!)) desordre++;
      }
      durees.sort((a, b) => a - b);
      releve[champ]![palier] = {
        bons, sur: cas.length, ms: durees[Math.floor(durees.length / 2)] ?? 0,
        ...(desordre > 0 ? { desordre } : {}),
      };
    }
  }
  journal?.fermer();
  return releve;
}

/**
 * Le mode classification : une étiquette par cas, prise dans un jeu fermé.
 *
 * Il existe parce qu'un jeu public de classification est la façon la plus rapide de se faire
 * contredire — étiquettes de quelqu'un d'autre, messages de quelqu'un d'autre, et aucun des
 * paliers entraîné dessus. Les références triviales comptent double ici : sur soixante-dix-sept
 * classes, deviner au hasard donne 1,3 %, et un chiffre sans sa référence ne veut rien dire.
 */
export async function classerVosCas(
  cas: Cas[], colonne: string, paliers: TierName[],
): Promise<{ etiquettes: string[]; releve: Record<TierName, { bons: number; sur: number; ms: number }>;
             majoritaire: { nom: string; taux: number } }> {
  const etiquettes = [...new Set(cas.map((c) => c.truth[colonne]!))].sort();
  const compte: Record<string, number> = {};
  for (const c of cas) compte[c.truth[colonne]!] = (compte[c.truth[colonne]!] ?? 0) + 1;
  const [nomMaj, nMaj] = Object.entries(compte).sort((a, b) => b[1] - a[1])[0]!;

  const releve = {} as Record<TierName, { bons: number; sur: number; ms: number }>;
  for (const palier of paliers) {
    let bons = 0;
    const durees: number[] = [];
    for (const c of cas) {
      const t0 = performance.now();
      /* La MÊME borne qu'en mode extract : une cellule de 20 Mo — un guillemet refermé mille
         lignes plus loin — coûte ~44 Mo de RAM par Mo de texte (SIGABRT mesuré). Le mode
         classify passait le texte ENTIER. Audit du 27 août 2026. */
      const got = await classerParmi(palier, bornerTexte(c.text).texte, etiquettes);
      durees.push(performance.now() - t0);
      if (got === c.truth[colonne]) bons++;
    }
    durees.sort((a, b) => a - b);
    releve[palier] = { bons, sur: cas.length, ms: durees[Math.floor(durees.length / 2)] ?? 0 };
  }
  return { etiquettes, releve, majoritaire: { nom: nomMaj, taux: nMaj / cas.length } };
}

/**
 * SOUS LE LANCEUR DE TESTS, LA COMMANDE S'ÉCARTE PLUTÔT QUE DE TÉLÉCHARGER.
 *
 * Mesuré le 3 septembre 2026 par `npm run clone-neuf` : plusieurs témoins lancent cette
 * commande sur un ou deux cas, avec les vrais extracteurs. Dans un clone neuf le cache
 * n'existe pas ; la bibliothèque téléchargeait donc 1,3 Go PENDANT `npm test`, dans des
 * `spawnSync` dont la sortie est capturée, et deux témoins mouraient au délai de 280 s —
 * cinq minutes de silence puis deux rouges, chez un acheteur, sur un dépôt qui écrit
 * « downloads nothing ». Ni cette machine ni le coureur CI ne l'avaient vu : les deux
 * portent le cache.
 *
 * La garde vit ICI, dans l'enfant, et non dans chaque témoin : un témoin de plus qui lance
 * la commande hérite de la règle sans avoir à la connaître. `NODE_TEST_CONTEXT` est posé par
 * `node --test` et hérité par les processus qu'un cas lance ; hors de lui, le comportement
 * de premier lancement — télécharger, en l'annonçant — ne change pas. `CASCADE_POIDS_RACINE`
 * permet à un témoin de pointer un cache factice pour éprouver cette garde sans toucher aux
 * vrais poids.
 */
export function sEcarterSiPoidsAbsents(cles: readonly CleModele[]): void {
  const racine = process.env.CASCADE_POIDS_RACINE;
  const absents = poidsAbsents(cles, racine);
  if (absents.length === 0) return;
  if (process.env.NODE_TEST_CONTEXT) {
    console.log(`\n${motifDEcart(absents)}\n`);
    process.exit(CODE_ECART_TEMOIN);
  }
  /* Hors ligne, le refus est celui de `poids.ts`, contre le MÊME cache — sinon un témoin qui
     pointe un cache factice verrait la bibliothèque partir chercher les vrais poids. */
  if (process.env.CASCADE_OFFLINE === "1") {
    try { exigerPoidsSurPlace(cles, racine); }
    catch (e) { console.error((e as Error).message); process.exit(1); }
  }
}

async function principal(): Promise<void> {
  const arg = (nom: string) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  exigerDrapeauxConnus(process.argv.slice(2));
  const fichier = arg("cases");
  if (!fichier) {
    console.log(`
Measure your own cases, not mine.

  npm run measure:yours -- --cases=your-file.csv [--rules=rules.json] [--sorties=yours.json] [--llm]

The CSV wants an id, the input text, then one column per field to extract:

  id,text,name,birth
  1,"Anna Petrova — dob 3 May 1990",Anna Petrova,3 May 1990

--rules  a JSON of { "field": "regular expression" }, so your own free tier is measured too.
--sorties  a JSON of the OUTCOMES your own chain was graded to, never the values it
         produced — grade on your side, send only issues: { "nom": "…", "issues": { "<field>":
         { "<case id>": "clean" | "wrong" | "blank" } }, "notePar": { "outil": …, "version": … }, "declares": { "coutParMilleDocuments":
         …, "msParDocument": … } }. Your chain runs on your machine; we never see its code, and
         nothing here executes anything you supply. We score its accuracy against your own
         answers — that is measured. Its cost and latency are the ones you give us: assumed,
         never measured here, and marked so everywhere they travel.
         Without it the routing is over models only, and will overstate what you need to pay.
--questions  a JSON of { "your column": "What is …?" }. Without it, the question is derived
         from the column name — a choice made for you, printed before anything loads. On a
         sample of client cases the same field scored 0 % under a derived question and 100 %
         under the client's own: supply these before concluding anything about a tier.
--llm    add the local generative tiers (needs Ollama and the models pulled).
--show-questions  print the derived question for every field, however many there are.
         Without it the list is cut after the first few and the rest are counted.
--yes-run-it  run even when the number of model calls is above the printed ceiling. The
         count is cases × fields × tiers and is printed before anything loads; nothing is
         predicted about how long it takes, since that depends on your machine.

Nothing leaves your machine: the models are local and this path makes no network call.
`);
    process.exit(fichier ? 0 : 1);
  }
  if (!existsSync(fichier)) { console.error(`no such file: ${fichier}`); process.exit(1); }

  const tache = lireTache(arg("task"));
  /*
   * `Number(x)` S'EXÉCUTE AVANT QU'ON DEMANDE SI x EST UN NOMBRE.
   *
   * `Number(arg("sample") ?? 0)` : `--sample=abc` rend NaN, `NaN > 0` est faux, et le
   * drapeau est **ignoré en silence** — le client croit avoir mesuré cent dossiers et en a
   * mesuré dix mille. `--sample=` rend 0, `--sample=-5` est ignoré, `--sample=3.7` tronque
   * à trois sans le dire. Toutes les orthographes de « pas une valeur » atterrissent à la
   * même extrémité, et c'est toujours la moins prudente.
   */
  const echantillonBrut = arg("sample");
  const echantillon = lireEchantillon(echantillonBrut);
  let { champs, cas, ecartees, courtes, demesurees, lecture } = lireCsv(readFileSync(fichier, "utf8"));

  /*
   * UN CORPUS VIDE NE PRODUIT PAS UN DOCUMENT QUI RESSEMBLE À UN AUDIT.
   *
   * `text,total\n` — une ligne d'en-tête et rien dessous — se lisait sans une plainte et
   * rendait un rapport de vingt-trois lignes intitulé « Your cases, measured », qui écrit
   * « 0 case(s), 1 field(s), measured on this machine. Nothing left it. » Chaque phrase est
   * vraie et l'ensemble est un artefact livrable qui n'a rien mesuré. Un fichier tronqué à
   * l'export, une mauvaise feuille, une ligne de trop dans un filtre : c'est un accident
   * ordinaire, et il ne doit pas rendre un document qu'on transfère.
   */
  if (cas.length === 0) {
    throw new Error(`${fichier} has a header line and no cases under it.\n`
      + `  Columns read: ${apercu(champs, MONTRES)}\n`
      + (ecartees.length > 0
        ? `  ${ecartees.length} row(s) were set aside as malformed — that may be where they went.\n`
        : ``)
      + `  Nothing was measured, so nothing was written: a report over zero cases reads like\n`
      + `  one that measured something.`);
  }
  /* Demander plus de cas qu'il n'y en a n'est pas une erreur, mais le silence en est une :
     le client doit savoir que son échantillon est le corpus entier. */
  if (echantillon !== undefined && echantillon >= cas.length) {
    console.log(`\n  --sample=${echantillon} is at least the ${cas.length} case(s) you `
      + `supplied: all of them are measured.`);
  }
  if (echantillon !== undefined && echantillon < cas.length) {
    /* Tirage déterministe : deux exécutions doivent porter sur les mêmes cas, sinon la
       comparaison entre paliers mesure aussi le hasard du tirage. */
    let e = 20260819;
    const alea = () => ((e = (e * 1_664_525 + 1_013_904_223) >>> 0) / 4_294_967_296);
    const melange = [...cas];
    for (let i = melange.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [melange[i], melange[j]] = [melange[j]!, melange[i]!];
    }
    cas = melange.slice(0, echantillon);
  }
  const reglesBrutes = arg("rules") ? chargerRegles(arg("rules")!, champs) : undefined;
  const sorties = arg("sorties") ? chargerSorties(arg("sorties")!) : undefined;
  /* Les questions du client, s'il en fournit. Un fichier illisible se refuse en le disant :
     partir sur des questions déduites alors qu'il en a écrit serait pire que de s'arrêter. */
  const questionsFournies = (() => {
    const chemin = arg("questions");
    if (!chemin) return undefined;
    if (!existsSync(chemin)) { console.error(`no such file: ${chemin}`); process.exit(1); }
    try {
      const o = JSON.parse(readFileSync(chemin, "utf8")) as Record<string, unknown>;
      const propre: Record<string, string> = Object.create(null);
      for (const [k, v] of Object.entries(o)) {
        if (typeof v !== "string" || v.trim().length === 0) {
          console.error(`--questions: "${k}" has no readable question.`); process.exit(1);
        }
        propre[k] = v.trim();
      }
      return propre;
    } catch (e) {
      console.error(`--questions: cannot read ${chemin} — ${(e as Error).message}`);
      process.exit(1);
    }
  })();
  const avecLlm = process.argv.includes("--llm");
  const paliers = [
    ...ENCODEURS.filter((t) => t !== "rules" && t !== "human"),
    ...(avecLlm ? GENERATIFS : []),
  ];

  /* Une énumération sans borne n'informe personne : 9 999 noms de colonne font plus de dix
     mille lignes de console avant la première mesure. On en montre quelques-uns et on dit
     combien restent — une sélection porte le compte de ce qu'elle écarte. */
  console.log(`\n${cas.length} cases, ${champs.length} field(s): ${apercu(champs, MONTRES)}`);

  /*
   * COMBIEN D'APPELS, ANNONCÉ AVANT DE COMMENCER — ET UN REFUS AU-DELÀ.
   *
   * Mesuré le 25 août 2026 : un fichier de **79 Kio** portant dix mille colonnes déclenche
   * ≈ 20 000 inférences, sans un mot et sans borne. Le calcul se fait sur la machine du
   * client, donc ça ne nous attaque pas — mais un fichier plus petit qu'une photo qui
   * occupe une machine pendant des heures sans prévenir reste un défaut d'accueil.
   *
   * Ce qui s'annonce est un COMPTE, pas une durée : le compte est exact et connu d'avance,
   * une durée serait devinée, et une prédiction fausse d'un facteur deux fait plus de mal
   * que pas de prédiction du tout.
   *
   * Au-delà du seuil, on refuse et on dit comment continuer. Un refus qu'on ne peut pas
   * lever se contourne en retirant la garde.
   *
   * D'OÙ VIENT LE PLAFOND. Mesuré ici le 25 août 2026, machine sous charge 5,3 → 6,6,
   * deux paliers d'encodeurs, deux tours par taille :
   *
   *     40 appels (5 cas × 4 champs × 2)  :  2,5 s  et  3,2 s
   *    200 appels (25 cas × 4 champs × 2) :  8,2 s  et 10,1 s
   *
   * La pente — le coût du seul appel, chargement des modèles retiré — vaut (8,2 − 2,5)/160
   * et (10,1 − 3,2)/160, soit 36 et 43 ms par appel : de l'ordre de 25 appels par seconde.
   * Dix mille appels est donc l'endroit où l'exécution cesse d'être quelque chose qu'on
   * attend devant le clavier. Le nombre est CHOISI, la vitesse qui l'a choisi est MESURÉE ;
   * elle dépend de la machine, et le message affiché n'annonce jamais qu'un compte.
   */
  const appels = cas.length * champs.length * paliers.length;
  console.log(`  ${cas.length} × ${champs.length} field(s) × ${paliers.length} tier(s) `
    + `= ${appels.toLocaleString("en-GB")} model call(s) on this machine.`);
  if (appels > PLAFOND_APPELS && !process.argv.includes("--yes-run-it")) {
    console.error(`\n  That is above ${PLAFOND_APPELS.toLocaleString("en-GB")} calls and `
      + `nothing has been measured yet.\n\n`
      + `  Measure a subset first, or pass --yes-run-it to run it anyway.\n`
      + `  Nothing was written.\n`);
    process.exit(3);
  }

  /*
   * DIRE COMMENT ON A LU, AVANT DE DIRE CE QU'ON A MESURÉ.
   *
   * Un décalage de colonnes qui transforme le nom d'une personne en document se voit
   * en une ligne dès qu'on l'annonce, et pas du tout si on ne l'annonce pas. Restituer
   * la lecture ne remplace pas de lire les noms — c'est ce qui permet au client de
   * constater en une seconde que la lecture est la sienne.
   */
  console.log(`  read as: column "${lecture.noms[lecture.colTexte]}" is the input text`
    + (lecture.colId >= 0 ? `, "${lecture.noms[lecture.colId]}" is the identifier` : ", no identifier column")
    + `, the rest are fields to measure.`);

  /*
   * Un chiffre issu d'une sélection porte le compte de ce qu'il écarte, ou il ne se
   * publie pas. Ces lignes étaient INCLUSES, avec une réponse attendue vide comptée
   * comme une erreur de l'outil : l'export cassé du client dégradait le taux qu'on lui
   * montrait, et il n'aurait jamais su pourquoi.
   */
  if (demesurees.length > 0) {
    /*
     * On NOMME la cause la plus probable au lieu de laisser le lecteur découvrir seul que son
     * fichier de dix mille lignes s'est lu comme trois. Une valeur de champ ne fait pas un
     * mégaoctet ; un guillemet ouvert et refermé mille lignes plus loin, si. On n'interdit
     * pas — un texte de document peut légitimement être long, et refuser casserait des
     * données valides — mais un silence ici coûterait au client une mesure entière.
     */
    const d = demesurees[0]!;
    console.log(`  ${demesurees.length} cell(s) are over 1 MB — the largest is ${(d.octets / 1e6).toFixed(1)} MB, `
      + `ending at line ${d.ligne}.`);
    console.log(`  A field value is not a megabyte. The usual cause is a quote opened at line `
      + `${d.ouvertureLigne} and closed much later, which swallows every line in between into one `
      + `cell. If your export is meant to hold long text, this is fine and nothing was dropped.`);
  }
  if (courtes.length > 0) {
    console.log(`  ${courtes.length} row(s) have fewer cells than the ${lecture.noms.length} `
      + `columns named in the header — line ${courtes.slice(0, 5).map((c) => c.ligne).join(", ")}`
      + `${courtes.length > 5 ? `, and ${courtes.length - 5} more` : ""}.`);
    console.log(`  Their missing answers are read as empty, which counts as a miss against `
      + `every tier. Your rates carry that.`);
  }
  if (ecartees.length > 0) {
    const apercu = ecartees.slice(0, 5)
      .map((e) => `line ${e.ligne} has ${e.champs}`).join(", ");
    console.log(`  ${ecartees.length} row(s) set aside: the header names `
      + `${lecture.noms.length} columns and these do not match — ${apercu}`
      + `${ecartees.length > 5 ? `, and ${ecartees.length - 5} more` : ""}.`);
    console.log(`  They are NOT counted in the rates below, in either direction.`);
  }
  /*
   * ZÉRO CAS N'EST PAS UN INTERVALLE LARGE, C'EST L'ABSENCE DE MESURE.
   *
   * Un fichier ne portant qu'un en-tête passait avec un avertissement, puis chargeait les
   * modèles et rendait un tableau. Un taux sur zéro dossier ne se calcule pas — il ne se
   * publie pas non plus, et « les intervalles seront larges » laisse croire qu'il existe
   * quelque part un chiffre trop imprécis, alors qu'il n'y a rien du tout.
   */
  if (cas.length === 0) {
    console.error(
      `\nNo records were read from your file.\n\n`
      + `  A rate over zero records is not a wide interval — it does not exist. Nothing will\n`
      + `  be measured, so nothing is run.\n\n`
      + `  The most common cause is a file holding only a header row. The second is a header\n`
      + `  that names your columns differently from the rows below it.`);
    process.exit(1);
  }
  if (cas.length < 20) {
    console.log(`\n⚠ ${cas.length} cases is below the point where a rate says anything. `
      + `The intervals below will be wider than the differences you are trying to see.`);
  }
  /*
   * LES QUESTIONS, RESOLUES ET AFFICHEES AVANT DE CHARGER QUOI QUE CE SOIT.
   *
   * `QUESTIONS` ne connaissait que nos cinq champs. Un client avec ses propres colonnes
   * obtenait `undefined` : l'encodeur plantait sur un message de bibliotheque qui parle
   * d'autre chose, et le generatif demandait « Question: undefined » puis rendait du bruit
   * SANS RIEN SIGNALER. Le second est le pire des deux, et c'est celui qu'on ne voit pas.
   *
   * Une question deduite est un CHOIX que nous faisons a la place du client. Elle s'affiche
   * donc avant la mesure, pour qu'il puisse la corriger — et le taux qu'elle produit n'est
   * pas comparable au notre, ce qui se dit ici plutot que de se deviner.
   */
  /* La question AFFICHÉE doit être celle qui est POSÉE. Nettoyer l'invite sans nettoyer
   l'affichage montrerait au client une question qui n'a pas été envoyée — un écart
   invisible entre ce qu'on dit avoir demandé et ce qu'on a demandé. */
  const questions = Object.fromEntries(champs.map((c) => {
    const q = questionPour(c, questionsFournies);
    return [c, { ...q, texte: questionSure(c, questionsFournies) }];
  }));
  const deduites = champs.filter((c) => questions[c]!.provenance === "deduite");
  /* Dix mille lignes de questions ne se lisent pas. On en montre autant que le reste des
     annonces, on dit combien sont cachées ET de quelle provenance — une sélection porte le
     compte de ce qu'elle écarte — et on donne le moyen de tout voir. Un affichage tronqué
     sans issue pousse à relancer sans lire. */
  const montrees = process.argv.includes("--show-questions") ? champs : champs.slice(0, MONTRES);
  console.log(`\nThe question each field is asked, and where it comes from:\n`);
  for (const c of montrees) {
    const q = questions[c]!;
    const marque = { fournie: "yours   ", mesuree: "measured", deduite: "derived " }[q.provenance];
    console.log(`  ${marque}  ${c.padEnd(18)} ${q.texte}`);
  }
  const caches = champs.slice(montrees.length);
  if (caches.length) {
    const par = (p: string) => caches.filter((c) => questions[c]!.provenance === p).length;
    console.log(`  … and ${caches.length} more not shown `
      + `(${par("deduite")} derived, ${par("fournie")} yours, ${par("mesuree")} measured). `
      + `Pass --show-questions to see them all.`);
  }
  if (deduites.length) {
    console.log(`\n⚠ ${deduites.length} question(s) derived from your column names — a choice we`);
    console.log(`  made for you, not a measurement. Rates obtained under a derived question are`);
    console.log(`  NOT comparable to the ones in this repository's README, which were measured`);
    console.log(`  under the questions above marked "measured".`);
    console.log(`  Supply your own with --questions=file.json : { "column": "What is …?" }`);
  }

  /*
   * LES RÈGLES DU CLIENT SONT ÉVALUÉES ICI, AVANT QUE LE MOINDRE MODÈLE SOIT CHARGÉ.
   *
   * Découvrir au dossier quatre mille qu'une règle ne termine pas coûte tout ce qui précède.
   * Et une règle refusée doit être annoncée avant la mesure, pas expliquée après.
   */
  /* Ce qui se sait sans modèle se dit avant de charger quoi que ce soit : un champ dont la
     réponse n'est pas dans le texte ne mesure pas le palier, il mesure le corpus. */
  const presence = direLaPresence(presenceDeLaVerite(cas, champs));
  if (presence) console.log(`\n${presence}\n`);

  const regles = reglesBrutes
    ? await evaluerRegles(reglesBrutes, cas.map((c) => c.text))
    : undefined;
  if (regles) {
    const refus = direLesRefus(regles);
    if (refus) console.log(`\n${refus}\n`);
  }

  /* Avant tout chargement : sous `node --test`, des poids absents font s'écarter la commande
     au lieu de la faire télécharger — voir `sEcarterSiPoidsAbsents`. */
  sEcarterSiPoidsAbsents(tache === "classify" ? MODELES_CLASSEMENT : MODELES_EXTRACTION);

  if (avecLlm) await loadGeneratifs();

  if (tache === "classify") {
    await loadClassifiers();
    const colonne = champs[0]!;
    const { etiquettes, releve, majoritaire } = await classerVosCas(cas, colonne, paliers);
    console.log(`\n${etiquettes.length} labels. Trivial baselines first, because a percentage`);
    console.log(`without one says nothing:\n`);
    console.log(`  always "${majoritaire.nom}"   ${(100 * majoritaire.taux).toFixed(1)} %`);
    console.log(`  uniform guess          ${(100 / etiquettes.length).toFixed(1)} %\n`);
    const rangs = Object.entries(releve)
      .map(([palier, r]) => ({ palier, r: rate(r.bons, r.sur), ms: r.ms }))
      .sort((a, b) => b.r.rate - a.r.rate);
    for (const x of rangs) {
      const bat = x.r.low > majoritaire.taux ? "beats the majority baseline"
        : x.r.high < majoritaire.taux ? "WORSE than always guessing the commonest label"
        : "indistinguishable from the majority baseline";
      console.log(`  ${x.palier.padEnd(10)} ${writeRate(x.r).padEnd(28)} `
        + `${ecrireMs(x.ms, x.palier === sorties?.nom).padEnd(20)} ${bat}`);
    }
    console.log("");
    /*
     * On ne force pas la sortie.
     *
     * `process.exit(0)` coupait le processus pendant que le runtime des modèles avait encore
     * des fils natifs en vol : le résultat s'affichait, puis l'abandon, et un code 134 sur une
     * exécution parfaitement réussie. Une intégration continue y aurait lu un échec.
     */
    return;
  }

  await loadExtractors();
  /*
   * Ce qui ne correspond pas, dit avant les taux et non après.
   *
   * Un identifiant présent d'un côté et pas de l'autre fait un taux calculé sur ce qui reste,
   * et ce qui reste s'est choisi tout seul. Annoncé ici, avant le tableau, pour qu'on ne le
   * lise pas comme une note.
   */
  if (sorties) {
    const corr = correspondance(cas, champs, sorties);
    console.log(`\nYour chain: "${sorties.nom}".`);
    /*
     * Qui a noté, et avec quoi — sans quoi l'exactitude n'est plus mesurée mais crue.
     *
     * Les issues sont produites par notre correcteur, exécuté sur sa machine sur sa clé. C'est
     * une mesure, et pas une déclaration — mais seulement si le fichier dit quelle version l'a
     * produite. Sans cette ligne, « noté par notre code là-bas » et « tapé à la main » sont le
     * même fichier, et le second n'est pas une mesure.
     */
    if (sorties.notePar?.version) {
      console.log(`  accuracy: graded by ${sorties.notePar.outil ?? "this tool"}`
        + ` ${sorties.notePar.version}, run on your side against your key.`);
    } else {
      console.log(`  ⚠ accuracy: the file does not say which version graded it.`);
      console.log(`    Without \`notePar.version\`, "graded by this tool on your side" and "typed`
        + ` in by hand" are indistinguishable,`);
      console.log(`    and only the first is a measurement. The rate below reads as declared.`);
    }
    console.log(`  no extracted value is received: outcomes only, per case.`);
    console.log(`  cost and latency: ${sorties.declares ? "declared by you" : "not declared"}`
      + ` — ${PROVENANCE_DES_DECLARES.provenance}, never measured here.`);
    if (corr.champsSansAucuneValeur.length) {
      console.log(`  ⚠ no result supplied for: ${corr.champsSansAucuneValeur.join(", ")}`);
    }
    if (corr.total > 0) {
      console.log(`  ⚠ ${corr.total} identifier(s) with no match — the rate below therefore `
        + `covers the matched cases only:`);
      for (const champ of champs) {
        const m = corr.manquants[champ]!.length, i = corr.inconnus[champ]!.length;
        if (m || i) {
          console.log(`      ${champ.padEnd(14)} ${m} of our cases missing from your file`
            + `${m ? ` (${corr.manquants[champ]!.slice(0, 3).join(", ")}${m > 3 ? "…" : ""})` : ""}`
            + `, ${i} of yours unknown to us`
            + `${i ? ` (${corr.inconnus[champ]!.slice(0, 3).join(", ")}${i > 3 ? "…" : ""})` : ""}`);
        }
      }
    } else {
      console.log(`  every identifier matches.`);
    }
  }

  const releve = await mesurerVosCas(cas, champs, paliers, regles,
    process.argv.includes("--journal"), sorties,
    Object.fromEntries(Object.entries(questions).map(([k, v]) => [k, v.texte])));

  console.log("\nACCURACY PER FIELD, with the interval at "
    + `${(CONFIANCE.niveau * 100).toFixed(0)} %\n`);
  for (const champ of champs) {
    const rangs = Object.entries(releve[champ]!)
      .map(([palier, r]) => ({ palier, r: rate(r.bons, r.sur), ms: r.ms }))
      .sort((a, b) => b.r.rate - a.r.rate);
    console.log(`  ${champ}`);
    for (const x of rangs) {
      console.log(`    ${x.palier.padEnd(10)} ${writeRate(x.r).padEnd(28)} `
        + `${ecrireMs(x.ms, x.palier === sorties?.nom)}`);
    }
    /*
     * La phrase qui compte — et le refus de la prononcer sans échantillon.
     *
     * En dessous du seuil, *rien* n'est distinguable de rien : la règle « prends le moins
     * cher parmi les équivalents » recommanderait alors toujours le plus rapide, sur zéro
     * preuve, avec l'aplomb d'un conseil. C'est le piège exact que cet outil dénonce chez
     * les autres, et il y est tombé à sa première exécution sur trois cas.
     */
    const tete = rangs[0]!;
    if (!tete.r.reportable) {
      console.log(`    → no recommendation: ${tete.r.n} cases cannot separate any of these. `
        + `Bring at least ${ENOUGH}.\n`);
      continue;
    }
    const equivalents = rangs.filter((x) => !distinguishable(x.r, tete.r));
    const retenu = equivalents.reduce((a, b) => (b.ms < a.ms ? b : a));
    console.log(retenu.palier === tete.palier
      ? `    → ${tete.palier} wins outright on this sample.\n`
      : `    → ${retenu.palier} is not measurably worse than ${tete.palier} and is `
        + `${(tete.ms / Math.max(retenu.ms, 0.01)).toFixed(0)}× faster. Take the cheaper one.\n`);
  }

  const desordres = direLesDesordres(releve);
  if (desordres) console.log(`\n${desordres}\n`);

  /* « Un fichier a-t-il été donné ? » et « une règle a-t-elle été mesurée ? » ne sont pas la
     même question, et c'est la seconde que le rapport prétend répondre. */
  const reglesMesurees = Object.values(releve).some((r) => "rules" in r);

  const sortie = fichier.replace(/\.csv$/i, "") + "-measured.md";
  /*
   * LE DIRE, AVEC LE COMPTE. Une troncature qu'on ne rapporte pas produit un taux qui ne
   * porte pas sur ce que le client croit avoir mesuré — et il le citera.
   */
  const suspects = direLesDocumentsSuspects(cas.length);
  if (suspects) console.log(`\n${suspects}`);

  const formes = direLesFormes();
  if (formes) console.log(`\n${formes}`);

  const bornes = bornesPosees();
  if (bornes.cas > 0) {
    console.log(`\n  ${bornes.cas} case(s) had their text cut to the first ${PLAFOND_TEXTE} characters`
      + ` — ${bornes.caracteres.toLocaleString("en-GB")} character(s) set aside in total.`);
    console.log(`  The extractors read at most ${FENETRE_JETONS} tokens, so they never saw that text:`);
    console.log(`  cutting it changes no rate above, and stops one long cell from costing gigabytes.`);
    console.log(`  If your documents are genuinely longer than that, the fields you need must appear`);
    console.log(`  in the first ${PLAFOND_TEXTE} characters, or no tier can find them.`);
  }

  writeFileSync(sortie, rapportPourLeClient({
    cas: cas.length, champs, date: new Date().toISOString().slice(0, 10),
    questions, avecRegles: reglesMesurees,
    lignes: champs.flatMap((champ) => Object.entries(releve[champ]!).map(([palier, r]) => {
      const q = rate(r.bons, r.sur);
      /* Le fichier passe par le MÊME formateur que la console : c'est lui qui porte le
         refus de citer un taux sous ENOUGH observations. Le fichier est ce qui est classé
         et transféré ; il ne peut pas être le chemin le moins prudent des deux. */
      const c = cellulesDeTaux(q);
      /* `palier` est le nom de NOTRE palier — sauf quand il vient de `--sorties`, où c'est
         une chaîne écrite par le client. Mesuré : `"nom": "mine|evil"` coupait la cellule en
         deux et décalait toute la ligne sous les mauvais en-têtes. Le même échappement que
         pour les noms de colonne, un colonne plus loin. */
      return [cellule(champ), cellule(palier), c.taux, c.intervalle, q.n,
        ecrireMs(r.ms, palier === sorties?.nom)];
    })),
  }));
  console.log(`Written to ${sortie}\n`);
  if (!reglesMesurees) {
    console.log(reglesBrutes
      ? "Your --rules file was read, but no rule was measured on any field. The report says so."
      : "No --rules given, so no free tier was measured. On my own corpus free regexes");
    console.log("carried three fields of five — a routing without them overstates what you pay.\n");
  }
  if (avecLlm) {
    console.log("Generative tiers measured: "
      + Object.entries(MODELES_LOCAUX).map(([k, v]) => `${k}=${v.tag}`).join(", ") + "\n");
  }
}

/*
 * UN REFUS DESTINÉ AU CLIENT NE SORT PAS EN TRACE DE PILE.
 *
 * Le message qui explique une guillemet non refermée est écrit pour quelqu'un qui a un CSV et
 * pas ce code sous les yeux. Le laisser remonter brut le noie sous cinq lignes de chemins de
 * fichiers et de numéros internes : le lecteur voit un plantage, pas une instruction. Le code
 * de sortie reste 1 — c'est ce que lit une chaîne d'intégration, et il ne doit pas changer.
 */
if (isMain(import.meta)) {
  try {
    await principal();
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
