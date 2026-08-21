/**
 * Le corpus des cas durs, lu strictement.
 *
 * Trente documents écrits le 21 août avant toute mesure : dix-huit malformés, douze en
 * écritures non latines. Les chiffres publiés jusqu'ici viennent de cent vingt cas propres et
 * synthétiques ; ceux-ci sont les cas sur lesquels un système d'extraction se casse vraiment.
 *
 * Ce lecteur **refuse** plutôt que d'ignorer. Un analyseur qui laisse tomber en silence une
 * ligne qu'il ne comprend pas rétrécit le corpus sans le dire, et un corpus rétréci en silence
 * est un corpus choisi — exactement la faute que la date d'écriture est là pour empêcher.
 * Toute cellule non reconnue arrête la lecture avec son texte et son numéro de ligne.
 *
 * Trois formes de réponse, et la troisième est le sujet :
 *
 *   — une valeur : le tiers doit la rendre.
 *   — `A / B` : deux lectures, l'une et l'autre justes. Le séparateur est espace-barre-espace,
 *     jamais la barre nue — `ul. Piękna 5/3` est une adresse, pas deux lectures.
 *   — `**REFUSE**` ou `*(not stated)*` : la bonne réponse est de ne rien rendre. Un tiers qui
 *     invente ici échoue ; un tiers qui se tait réussit. C'est l'inverse du corpus propre, où
 *     un blanc est toujours un échec, et c'est pour ça que ces cas valent la peine.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { normaliserReponse, correct } from "./tiers.ts";

import type { Issue } from "./journal.ts";
import type { Field } from "./corpus.ts";

export const DOSSIER = new URL("../corpus-dur", import.meta.url).pathname;

/** La colonne « field » du corpus, vers les noms du dépôt. */
export const CHAMPS: Record<string, Field> = {
  "full name": "name",
  "date of birth": "birth",
  "document type": "document",
  "country": "country",
  "address": "address",
};

export type Attendu = {
  /** Toutes les lectures qui comptent juste. Vide quand la bonne réponse est de se taire. */
  lectures: string[];
  /** Vrai quand ne rien rendre est la bonne réponse. */
  silence: boolean;
  /** Pourquoi le silence : le document est coupé, ou le champ est absent. */
  raison?: "unrecoverable" | "not stated";
};

export type CasDur = {
  id: string;
  /**
   * L'identifiant qui sert de clé, préfixé par son fichier.
   *
   * `M1` désigne deux documents : un passeport allemand dans les malformés, un titre de voyage
   * onusien en quatre écritures dans les non-latins. Les deux corpus ont été écrits la même
   * nuit sans se relire. Indexer sur `id` seul fait collisionner deux documents étrangers l'un
   * à l'autre — et une requête qui compare deux documents différents en croyant comparer deux
   * paliers ne rend pas une erreur : elle rend un chiffre.
   */
  cle: string;
  titre: string; source: string; texte: string;
  attendus: Partial<Record<Field, Attendu>>;
};

class CorpusIllisible extends Error {}

function cellule(brut: string, ligne: number, fichier: string): Attendu {
  const t = brut.trim();
  if (/^\*\*REFUSE\*\*/.test(t)) return { lectures: [], silence: true, raison: "unrecoverable" };
  if (/^\*\(not stated/.test(t)) return { lectures: [], silence: true, raison: "not stated" };
  if (t === "—" || t === "-" || t === "") return { lectures: [], silence: false };

  /* Espace-barre-espace uniquement : une barre nue appartient à la valeur. */
  if (/\S\/\S/.test(t) && / \/ /.test(t)) {
    throw new CorpusIllisible(`${fichier}:${ligne} : « ${t} » mêle une barre nue et un séparateur.`);
  }
  const lectures = t.split(" / ").map((x) => x.trim()).filter((x) => x.length > 0);
  if (lectures.length === 0) throw new CorpusIllisible(`${fichier}:${ligne} : cellule vide non reconnue.`);
  if (lectures.some((x) => x.includes("**") || x.includes("*(")))
    throw new CorpusIllisible(`${fichier}:${ligne} : « ${t} » porte un balisage non interprété.`);
  return { lectures, silence: false };
}

export function lireFichier(fichier: string): CasDur[] {
  const lignes = readFileSync(join(DOSSIER, fichier), "utf8").split("\n");
  const cas: CasDur[] = [];
  let courant: CasDur | null = null;
  let dansCode = false, texte: string[] = [], texteFige = false;

  lignes.forEach((l, i) => {
    const titre = /^### ([A-Z]+\d+) — (.+)$/.exec(l);
    if (titre) {
      if (courant) cas.push(courant);
      courant = { id: titre[1]!, cle: `${fichier.replace(/\.md$/, "")}#${titre[1]!}`,
        titre: titre[2]!, source: fichier, texte: "", attendus: {} };
      dansCode = false; texte = []; texteFige = false;
      return;
    }
    if (!courant) return;

    if (l.trim() === "```") {
      if (dansCode) { courant.texte = texte.join("\n"); texteFige = true; }
      dansCode = !dansCode && !texteFige;
      return;
    }
    if (dansCode) { texte.push(l); return; }

    const rang = /^\|([^|]+)\|(.*)\|$/.exec(l);
    if (!rang) return;
    const nom = rang[1]!.trim().toLowerCase();
    if (nom === "field" || /^-+$/.test(nom)) return;
    const champ = CHAMPS[nom];
    if (!champ) return;

    const colonnes = rang[2]!.split("|");
    const principal = cellule(colonnes[0]!, i + 1, fichier);
    /* La colonne « accepted alternative » élargit la liste ; elle ne la remplace pas. */
    const alt = colonnes.length > 1 ? cellule(colonnes[1]!, i + 1, fichier) : { lectures: [], silence: false };
    courant.attendus[champ] = principal.silence
      ? principal
      : { lectures: [...principal.lectures, ...alt.lectures], silence: false };
  });
  if (courant) cas.push(courant);
  return cas;
}

/** Les trente cas tabulaires — malformés et écritures non latines. */
export function corpusDur(): CasDur[] {
  const fichiers = readdirSync(DOSSIER)
    .filter((n) => n === "documents-malformes.md" || n === "ecritures-non-latines.md")
    .sort();
  const cas = fichiers.flatMap(lireFichier);
  /* Deux cas ne peuvent pas partager leur clé : la collision serait silencieuse et chiffrée. */
  const vues = new Map<string, string>();
  for (const c of cas) {
    const deja = vues.get(c.cle);
    if (deja) throw new CorpusIllisible(`la clé ${c.cle} désigne deux cas (${deja} et ${c.source}).`);
    vues.set(c.cle, c.source);
  }
  for (const c of cas) {
    if (!c.texte.trim()) throw new CorpusIllisible(`${c.source} ${c.id} : aucun document lu.`);
    const manquants = Object.values(CHAMPS).filter((f) => !c.attendus[f]);
    if (manquants.length) throw new CorpusIllisible(`${c.source} ${c.id} : champs absents : ${manquants.join(", ")}.`);
  }
  return cas;
}

/**
 * La note d'une tentative sur le corpus dur.
 *
 * `clean` reste `clean` : la réussite n'est pas redéfinie, elle est seulement élargie aux
 * lectures déclarées avant la mesure. Les deux échecs sont distingués parce qu'ils ne se
 * vendent pas pareil — un blanc se voit, une valeur inventée entre au dossier sans bruit.
 */
export function noterDur(got: string, a: Attendu): {
  outcome: Issue; overRefusal: boolean; overAnswer: boolean; readingChosen: string | null;
} {
  const vide = normaliserReponse(got).length === 0;
  if (a.silence) {
    return vide
      ? { outcome: "clean", overRefusal: false, overAnswer: false, readingChosen: null }
      : { outcome: "wrong", overRefusal: false, overAnswer: true, readingChosen: null };
  }
  const trouve = a.lectures.find((l) => correct(got, l));
  if (trouve) return { outcome: "clean", overRefusal: false, overAnswer: false, readingChosen: trouve };
  return vide
    ? { outcome: "blank", overRefusal: true, overAnswer: false, readingChosen: null }
    : { outcome: "wrong", overRefusal: false, overAnswer: false, readingChosen: null };
}

export const REGLE_DE_NOTATION =
  "correct = any defensible reading declared before measurement; for twenty-one fields the "
  + "declared answer is silence, where a blank is correct and a value is wrong";
