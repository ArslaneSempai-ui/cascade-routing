/**
 * LE COMPTEUR D'ÉVALUATION — la clause existait sur le papier, nulle part dans le code.
 *
 * LICENCES.md accorde à une organisation trente jours d'évaluation « from first use ».
 * Jusqu'ici rien ne matérialisait ce compteur : un évaluateur de bonne foi n'avait aucun
 * moyen de savoir où il en était, et la clause devenait invisible dès l'outil installé.
 * C'est la définition d'un trou : une règle écrite qu'aucun mécanisme ne rappelle.
 *
 * CE QUE C'EST : un RAPPEL, pas une serrure. Au premier lancement d'une commande de
 * mesure, l'outil horodate LOCALEMENT ce premier usage, puis affiche le jour courant.
 * Passé trente jours, le rappel devient explicite et donne la suite (l'engagement).
 *
 * CE QUE ÇA REFUSE D'ÊTRE :
 *   · un appel réseau — rien ne part, jamais : c'est la promesse centrale du produit,
 *     et un test grep en garde les imports ;
 *   · un blocage — une serrure serait hostile à l'évaluateur honnête et triviale à
 *     contourner pour l'autre ; le public de ce fichier est le premier ;
 *   · un espion — le fichier contient UNE date, se lit à l'œil nu, et se déclare.
 *
 * ET LA LIMITE, ASSUMÉE : effacer le fichier remet le compteur à zéro, comme mentir
 * remet la clause à zéro. Le droit tient la clause ; ce fichier tient la mémoire.
 *
 * PRÉCISION QUI COMPTE : l'usage NON COMMERCIAL n'a pas d'horloge (premier palier de
 * LICENCES.md, sans limite de temps). Le message le dit à chaque fois : un chercheur
 * au jour 200 n'est en faute de rien.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PAGE_ENGAGEMENT } from "./adresses.ts";

/** Le même nombre que la clause ; un test vérifie que LICENCES.md dit toujours trente. */
export const JOURS_EVALUATION = 30;

export const FICHIER_DEFAUT = join(homedir(), ".crusetra", "premiere-utilisation.json");

/*
 * LE DÉMÉNAGEMENT DU 6 OCTOBRE 2026 : ~/.cascade DEVIENT ~/.crusetra.
 *
 * Le marqueur vivait sous ~/.cascade, du nom de l'outil d'avant. Le déplacer sans le relire
 * remettrait à zéro l'évaluation de chaque client qui l'a commencée : un changement de nom
 * offrirait trente jours de plus. L'inverse serait aussi faux : un marqueur neuf ne doit pas
 * effacer une date plus ancienne. D'où trois règles, chacune éprouvée par
 * `evaluation-demenagement.test.ts` :
 *   - le neuf se lit d'abord, l'ancien ensuite ;
 *   - quand seul l'ancien existe, SA date est gardée et recopiée dans le neuf ;
 *   - quand les deux existent, la date la plus ANCIENNE gagne : un essai ne s'allonge jamais.
 * L'ancien fichier n'est ni déplacé, ni effacé, ni réécrit. Et ce module ne lit RIEN d'autre
 * sous ~/.cascade que ce marqueur précis : pas de liste du dossier, pas de copie, aucun autre
 * nom. Ce dossier peut porter d'autres fichiers qui ne le regardent pas.
 */
export const ANCIEN_FICHIER = join(homedir(), ".cascade", "premiere-utilisation.json");

/** Les anciens emplacements à relire : ceux de la maison quand on lit le marqueur de la
 *  maison, aucun quand on lit un fichier nommé (un test ne doit jamais lire le vrai). */
export function anciensPour(fichier: string): string[] {
  return fichier === FICHIER_DEFAUT ? [ANCIEN_FICHIER] : [];
}

export interface PremierUsage {
  premiere: string;          // ISO du premier lancement
  neuf: boolean;             // vrai si ce lancement vient de l'horodater
  avarie: boolean;           // vrai si un fichier illisible a été remplacé
  ecritureRatee?: string;    // la raison, si le marqueur n'a pas pu être écrit
  reprisDe?: string;         // l'ancien emplacement dont la date vient d'être reprise
}

/** La date d'un marqueur : absente (pas de fichier), lisible, ou avariée (fichier illisible). */
function lireDate(fichier: string): { date: Date | null; avarie: boolean } {
  if (!existsSync(fichier)) return { date: null, avarie: false };
  try {
    const lu = JSON.parse(readFileSync(fichier, "utf8")) as { premiereUtilisation?: string };
    const d = new Date(lu.premiereUtilisation ?? "");
    if (!Number.isNaN(d.getTime())) return { date: d, avarie: false };
  } catch {
    /* illisible : traité comme avarié, plus bas */
  }
  return { date: null, avarie: true };
}

/** Écrit le marqueur ; rend la raison d'un échec au lieu de lever. */
function ecrire(fichier: string, premiere: string, reprisDe?: string): string | undefined {
  try {
    mkdirSync(dirname(fichier), { recursive: true });
    writeFileSync(fichier, JSON.stringify({
      premiereUtilisation: premiere,
      ...(reprisDe ? { reprisDe } : {}),
      note: "local only, never transmitted; the thirty-day evaluation clause in LICENCES.md counts from this date",
    }, null, 2) + "\n");
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Lit le marqueur de premier usage, ou le crée. Ne lève jamais : une mesure ne doit
 *  pas échouer parce qu'un disque refuse une écriture, mais le raté se DIT. */
export function marquer(
  fichier: string = FICHIER_DEFAUT, maintenant: Date = new Date(), anciens: readonly string[] = anciensPour(fichier),
): PremierUsage {
  const ici = lireDate(fichier);
  /* La date la plus ancienne que portent le neuf et les anciens : jamais une plus récente. */
  let plusTot = ici.date;
  let source: string | undefined;
  const lus = anciens.map((chemin) => ({ chemin, ...lireDate(chemin) }));
  for (const a of lus) {
    if (a.date !== null && (plusTot === null || a.date.getTime() < plusTot.getTime())) {
      plusTot = a.date;
      source = a.chemin;
    }
  }
  if (plusTot !== null) {
    const premiere = plusTot.toISOString();
    if (source === undefined) return { premiere, neuf: false, avarie: false };
    /* La date vient d'un ancien emplacement : le neuf la reçoit, l'ancien reste où il est. */
    const rate = ecrire(fichier, premiere, source);
    return { premiere, neuf: false, avarie: false, reprisDe: source, ...(rate ? { ecritureRatee: rate } : {}) };
  }
  const avarie = ici.avarie || lus.some((a) => a.avarie);
  const premiere = maintenant.toISOString();
  const rate = ecrire(fichier, premiere);
  return rate ? { premiere, neuf: true, avarie, ecritureRatee: rate } : { premiere, neuf: true, avarie };
}

/** Jour 1 le jour du premier usage ; jamais moins que 1 même si l'horloge recule. */
export function jourDepuis(premiereIso: string, maintenant: Date = new Date()): number {
  const ecart = maintenant.getTime() - new Date(premiereIso).getTime();
  return Math.max(1, Math.floor(ecart / 86_400_000) + 1);
}

/** Les lignes à imprimer en tête d'une commande de mesure. Anglais, comme toute la
 *  façade ; le point médian plutôt que le tiret, comme tout ce que la maison publie. */
export function lignesEvaluation(fichier: string = FICHIER_DEFAUT, maintenant: Date = new Date()): string[] {
  const u = marquer(fichier, maintenant);
  const date = u.premiere.slice(0, 10);
  const j = jourDepuis(u.premiere, maintenant);
  const sortie: string[] = [];
  if (u.avarie) {
    sortie.push("the first-use marker was unreadable and has been rewritten; the clock restarts today.");
  }
  if (u.ecritureRatee) {
    sortie.push(`the first-use marker could not be written (${u.ecritureRatee}); `
      + "the thirty-day clause still runs from your actual first use.");
  }
  if (j <= JOURS_EVALUATION) {
    sortie.push(`evaluation clock · day ${j} of ${JOURS_EVALUATION} since first use (${date}) `
      + "· noncommercial use has no clock (LICENCES.md)");
  } else {
    sortie.push(`day ${j} since first use (${date}).`);
    sortie.push("If this was a commercial evaluation, its thirty days have passed. The next step");
    sortie.push(`is an engagement: ${PAGE_ENGAGEMENT}`);
    sortie.push("Noncommercial use has no clock (LICENCES.md).");
  }
  return sortie;
}
