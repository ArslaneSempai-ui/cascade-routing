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

/** Le même nombre que la clause ; un test vérifie que LICENCES.md dit toujours trente. */
export const JOURS_EVALUATION = 30;

export const FICHIER_DEFAUT = join(homedir(), ".cascade", "premiere-utilisation.json");

export interface PremierUsage {
  premiere: string;          // ISO du premier lancement
  neuf: boolean;             // vrai si ce lancement vient de l'horodater
  avarie: boolean;           // vrai si un fichier illisible a été remplacé
  ecritureRatee?: string;    // la raison, si le marqueur n'a pas pu être écrit
}

/** Lit le marqueur de premier usage, ou le crée. Ne lève jamais : une mesure ne doit
 *  pas échouer parce qu'un disque refuse une écriture — mais le raté se DIT. */
export function marquer(fichier: string = FICHIER_DEFAUT, maintenant: Date = new Date()): PremierUsage {
  let avarie = false;
  if (existsSync(fichier)) {
    try {
      const lu = JSON.parse(readFileSync(fichier, "utf8")) as { premiereUtilisation?: string };
      const d = new Date(lu.premiereUtilisation ?? "");
      if (!Number.isNaN(d.getTime())) {
        return { premiere: d.toISOString(), neuf: false, avarie: false };
      }
      avarie = true;
    } catch {
      avarie = true;
    }
  }
  const premiere = maintenant.toISOString();
  try {
    mkdirSync(dirname(fichier), { recursive: true });
    writeFileSync(fichier, JSON.stringify({
      premiereUtilisation: premiere,
      note: "local only, never transmitted; the thirty-day evaluation clause in LICENCES.md counts from this date",
    }, null, 2) + "\n");
  } catch (e) {
    return { premiere, neuf: true, avarie, ecritureRatee: (e as Error).message };
  }
  return { premiere, neuf: true, avarie };
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
    sortie.push("is an engagement: https://cascade-routing.com/engagement.html");
    sortie.push("Noncommercial use has no clock (LICENCES.md).");
  }
  return sortie;
}
