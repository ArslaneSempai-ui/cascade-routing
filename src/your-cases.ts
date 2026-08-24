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
import { loadavg } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { loadExtractors, loadClassifiers, loadGeneratifs, extract, correct, classerParmi, MODELES_LOCAUX, questionPour } from "./tiers.ts";
import { ENCODEURS, GENERATIFS } from "./paliers.ts";
import { rate, writeRate, distinguishable, CONFIANCE, ENOUGH } from "./interval.ts";
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
  lecture: { colTexte: number; colId: number; noms: string[] };
};

export function lireCsv(texte: string): Lecture {
  const lignes: string[][] = [];
  let ligne: string[] = [], cellule = "", guillemets = false;
  /* Où la guillemet encore ouverte a été ouverte. Sans elle, le refus dirait « quelque part
     dans votre fichier », ce qui est inutilisable sur cinq mille lignes. */
  let ouvertureLigne = 0, numeroDeLigne = 1;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]!;
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { cellule += '"'; i++; }
      else if (c === '"') guillemets = false;
      else { if (c === "\n") numeroDeLigne++; cellule += c; }
    } else if (c === '"') { guillemets = true; ouvertureLigne = numeroDeLigne; }
    else if (c === ",") { ligne.push(cellule); cellule = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      numeroDeLigne++;
      ligne.push(cellule); cellule = "";
      if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
      ligne = [];
    } else cellule += c;
  }
  if (guillemets) {
    throw new Error(
      `Line ${ouvertureLigne} of your CSV opens a quote that is never closed.\n`
      + `  Everything after it was swallowed as the contents of a single cell: the file was read\n`
      + `  to the end, but only ${lignes.length} row(s) remain instead of your data.\n`
      + `  This tool refuses rather than report a rate over what it did not lose.\n\n`
      + `  To write a quote INSIDE a cell, double it: "he said ""hello""".\n`
      + `  To find the offending line: sed -n '${ouvertureLigne}p' <your file>`);
  }
  if (cellule !== "" || ligne.length) { ligne.push(cellule); if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne); }

  const entete = lignes.shift();
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
      ecartees.push({ ligne: i + 2, champs: l.length });
      return;
    }
    if (l.length < noms.length) courtes.push({ ligne: i + 2, champs: l.length });
    cas.push({
      id: colId >= 0 ? (l[colId] ?? String(i + 1)).trim() : String(i + 1),
      text: l[colTexte] ?? "",
      truth: Object.fromEntries(colChamps.map((c) => [noms[c]!, (l[c] ?? "").trim()])),
    });
  });

  return { champs, cas, ecartees, courtes, lecture: { colTexte, colId, noms } };
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
  if (!Number.isFinite(ms)) return "durée non déclarée";
  return declaree ? `${ms.toFixed(0)} ms (déclaré)` : `${ms.toFixed(0)} ms`;
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
  return { nom: brut.nom ?? "your chain", issues: brut.issues,
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

function chargerRegles(chemin: string): Record<string, RegExp> {
  const brut = JSON.parse(readFileSync(chemin, "utf8")) as Record<string, string>;
  return Object.fromEntries(Object.entries(brut).map(([champ, motif]) => [champ, new RegExp(motif)]));
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
      return [`\`${c}\``, q.texte,
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
      : "What a free tier would carry: no `--rules` was given, so none was measured."}`,
    `- That the tiers here are the ones you should run: they are the ones this repository has.`,
  ];
  return entete.join("\n")
    + table(["Field", "Tier", "Accuracy", "Interval", "n", "Median ms"], o.lignes)
    + pied.join("\n") + "\n";
}

export async function mesurerVosCas(
  cas: Cas[], champs: string[], paliers: TierName[], regles?: Record<string, RegExp>,
  journaliser = false, sorties?: SortiesFournies,
  /* Les questions posées aux modèles, une par champ. Absentes, elles se déduisent du nom de
     colonne — et ce choix s'affiche, parce qu'un taux obtenu sous une question déduite n'est
     pas comparable à celui du README. */
  questions?: Record<string, string>,
): Promise<Record<string, Record<TierName, { bons: number; sur: number; ms: number }>>> {
  const releve: Record<string, Record<TierName, { bons: number; sur: number; ms: number }>> = {};
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

    if (regles?.[champ]) {
      let bons = 0;
      const t0 = performance.now();
      for (const c of cas) if (correct(c.text.match(regles[champ]!)?.[0] ?? "", c.truth[champ]!)) bons++;
      releve[champ]!["rules" as TierName] = { bons, sur: cas.length, ms: (performance.now() - t0) / cas.length };
    }

    for (const palier of paliers) {
      let bons = 0;
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
        const got = await extract(palier, { id: c.id, text: c.text, truth: c.truth } as never,
          champ as never, "reference", questionPour(champ, questions).texte);
        const ms = performance.now() - t0;
        durees.push(ms);
        journal?.ligne({
          tier: palier, field: champ, caseId: c.id, phrasing: "reference", split: "vos-cas",
          outcome: issue(got, c.truth[champ]!), ms: Number(ms.toFixed(3)),
          value: got, expected: c.truth[champ]!,
        });
        if (correct(got, c.truth[champ]!)) bons++;
      }
      durees.sort((a, b) => a - b);
      releve[champ]![palier] = { bons, sur: cas.length, ms: durees[Math.floor(durees.length / 2)] ?? 0 };
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
      const got = await classerParmi(palier, c.text, etiquettes);
      durees.push(performance.now() - t0);
      if (got === c.truth[colonne]) bons++;
    }
    durees.sort((a, b) => a - b);
    releve[palier] = { bons, sur: cas.length, ms: durees[Math.floor(durees.length / 2)] ?? 0 };
  }
  return { etiquettes, releve, majoritaire: { nom: nomMaj, taux: nMaj / cas.length } };
}

async function principal(): Promise<void> {
  const arg = (nom: string) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  const fichier = arg("cases");
  if (!fichier) {
    console.log(`
Measure your own cases, not mine.

  npm run measure:yours -- --cases=your-file.csv [--rules=rules.json] [--sorties=yours.json] [--llm]

The CSV wants an id, the input text, then one column per field to extract:

  id,text,name,birth
  1,"Anna Petrova — dob 3 May 1990",Anna Petrova,3 May 1990

--rules  a JSON of { "field": "regular expression" }, so your own free tier is measured too.
--sorties  a JSON of what YOUR OWN chain produced: { "nom": "…", "valeurs": { "<field>":
         { "<case id>": "<what your chain returned>" } }, "declares": { "coutParMilleDocuments":
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

Nothing leaves your machine: the models are local and this path makes no network call.
`);
    process.exit(fichier ? 0 : 1);
  }
  if (!existsSync(fichier)) { console.error(`no such file: ${fichier}`); process.exit(1); }

  const tache = arg("task") ?? "extract";
  const echantillon = Number(arg("sample") ?? 0);
  let { champs, cas, ecartees, courtes, lecture } = lireCsv(readFileSync(fichier, "utf8"));
  if (echantillon > 0 && echantillon < cas.length) {
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
  const regles = arg("rules") ? chargerRegles(arg("rules")!) : undefined;
  const sorties = arg("sorties") ? chargerSorties(arg("sorties")!) : undefined;
  /* Les questions du client, s'il en fournit. Un fichier illisible se refuse en le disant :
     partir sur des questions déduites alors qu'il en a écrit serait pire que de s'arrêter. */
  const questionsFournies = (() => {
    const chemin = arg("questions");
    if (!chemin) return undefined;
    if (!existsSync(chemin)) { console.error(`no such file: ${chemin}`); process.exit(1); }
    try {
      const o = JSON.parse(readFileSync(chemin, "utf8")) as Record<string, unknown>;
      const propre: Record<string, string> = {};
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

  console.log(`\n${cas.length} cases, ${champs.length} field(s): ${champs.join(", ")}`);

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
  const questions = Object.fromEntries(champs.map((c) => [c, questionPour(c, questionsFournies)]));
  const deduites = champs.filter((c) => questions[c]!.provenance === "deduite");
  console.log(`\nThe question each field is asked, and where it comes from:\n`);
  for (const c of champs) {
    const q = questions[c]!;
    const marque = { fournie: "yours   ", mesuree: "measured", deduite: "derived " }[q.provenance];
    console.log(`  ${marque}  ${c.padEnd(18)} ${q.texte}`);
  }
  if (deduites.length) {
    console.log(`\n⚠ ${deduites.length} question(s) derived from your column names — a choice we`);
    console.log(`  made for you, not a measurement. Rates obtained under a derived question are`);
    console.log(`  NOT comparable to the ones in this repository's README, which were measured`);
    console.log(`  under the questions above marked "measured".`);
    console.log(`  Supply your own with --questions=file.json : { "column": "What is …?" }`);
  }

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
      console.log(`  ⚠ ${corr.total} identifier(s) with no match — the rate below therefore covers`
        + ` que sur les cas appariés :`);
      for (const champ of champs) {
        const m = corr.manquants[champ]!.length, i = corr.inconnus[champ]!.length;
        if (m || i) {
          console.log(`      ${champ.padEnd(14)} ${m} of our cases missing from your file`
            + `${m ? ` (${corr.manquants[champ]!.slice(0, 3).join(", ")}${m > 3 ? "…" : ""})` : ""}`
            + `, ${i} des vôtres inconnus de nous`
            + `${i ? ` (${corr.inconnus[champ]!.slice(0, 3).join(", ")}${i > 3 ? "…" : ""})` : ""}`);
        }
      }
    } else {
      console.log(`  tous les identifiants correspondent.`);
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

  const sortie = fichier.replace(/\.csv$/i, "") + "-measured.md";
  writeFileSync(sortie, rapportPourLeClient({
    cas: cas.length, champs, date: new Date().toISOString().slice(0, 10),
    questions, avecRegles: Boolean(regles),
    lignes: champs.flatMap((champ) => Object.entries(releve[champ]!).map(([palier, r]) => {
      const q = rate(r.bons, r.sur);
      return [champ, palier, (q.rate * 100).toFixed(1) + " %",
        `[${(q.low * 100).toFixed(0)}–${(q.high * 100).toFixed(0)}]`, q.n,
        ecrireMs(r.ms, palier === sorties?.nom)];
    })),
  }));
  console.log(`Written to ${sortie}\n`);
  if (!regles) {
    console.log("No --rules given, so no free tier was measured. On my own corpus free regexes");
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
