/**
 * Mesurer chaque étage, une fois, puis figer.
 *
 * C'est la pratique du métier et c'est aussi la seule honnête : on ne compare pas des
 * modèles sur des chiffres annoncés par ceux qui les vendent. On les fait tourner sur son
 * propre jeu, on note ce qu'ils rendent, et on garde le relevé.
 *
 * Le profil enregistré porte la justesse et la latence — mesurées — et rien d'autre. Le
 * prix, lui, n'est pas une mesure : c'est une hypothèse, elle appartient à l'écran et se
 * discute. Les mélanger reviendrait à faire passer un tarif pour un fait.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { genererDossiers, genererAlertes, CHAMPS, TYPOLOGIES } from "./corpus.ts";
import { ETAGES, chargerExtracteurs, chargerClasseurs, extraire, classer, juste } from "./etages.ts";
import type { NomEtage } from "./etages.ts";
import type { Champ } from "./corpus.ts";

const FICHIER = new URL("../data/profils.json", import.meta.url).pathname;

export type Profil = {
  /** Part des items que cet étage traite correctement. Mesurée. */
  justesse: number;
  /** Millisecondes par item, hors chargement du modèle. Mesurée. */
  latence: number;
  items: number;
};

export type Profils = {
  mesureLe: string;
  /** Chaîne A : un profil par étage ET par champ — c'est là que se joue le routage. */
  extraction: Record<NomEtage, Record<Champ, Profil>>;
  /** Chaîne B : un profil par étage, une seule décision par dossier. */
  classement: Record<NomEtage, Profil>;
  chargement: Record<NomEtage, number>;
};

export function lireProfils(): Profils | null {
  return existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, "utf8")) : null;
}

export async function mesurer(combien = 120): Promise<Profils> {
  /*
   * On mesure sur l'épreuve, jamais sur l'apprentissage.
   *
   * La première campagne donnait 100 % aux règles sur les cinq champs : elles avaient
   * été écrites contre les gabarits qui servaient à les noter. Le paramètre est explicite
   * pour que se tromper demande de l'écrire.
   */
  const dossiers = genererDossiers(combien, "epreuve");
  const alertes = genererAlertes(combien, "epreuve");

  const chargement = {} as Record<NomEtage, number>;
  let t = performance.now();
  await chargerExtracteurs();
  const chargeExtraction = performance.now() - t;
  t = performance.now();
  await chargerClasseurs();
  const chargeClassement = performance.now() - t;

  const extraction = {} as Profils["extraction"];
  for (const etage of ETAGES) {
    extraction[etage] = {} as Record<Champ, Profil>;
    chargement[etage] = etage === "regles" || etage === "humain" ? 0 : chargeExtraction + chargeClassement;

    for (const champ of CHAMPS) {
      let justes = 0;
      const debut = performance.now();
      for (const d of dossiers) {
        if (juste(await extraire(etage, d, champ), d.verite[champ])) justes++;
      }
      const duree = performance.now() - debut;
      extraction[etage][champ] = {
        justesse: justes / dossiers.length,
        latence: duree / dossiers.length,
        items: dossiers.length,
      };
    }
  }

  const classement = {} as Record<NomEtage, Profil>;
  for (const etage of ETAGES) {
    let justes = 0;
    const debut = performance.now();
    for (const a of alertes) if (await classer(etage, a) === a.verite) justes++;
    const duree = performance.now() - debut;
    classement[etage] = {
      justesse: justes / alertes.length,
      latence: duree / alertes.length,
      items: alertes.length,
    };
  }

  const profils: Profils = {
    mesureLe: new Date().toISOString(), extraction, classement, chargement,
  };
  mkdirSync(dirname(FICHIER), { recursive: true });
  writeFileSync(FICHIER, JSON.stringify(profils, null, 2));
  return profils;
}

if (import.meta.filename === process.argv[1]) {
  console.log("\nMesure en cours — les modèles se chargent la première fois, comptez quelques minutes.\n");
  const p = await mesurer();
  const pc = (x: number) => (x * 100).toFixed(1).padStart(5) + " %";

  console.log("CHAÎNE A — extraction, justesse par champ\n");
  console.log("étage      " + CHAMPS.map((c) => c.padStart(10)).join("") + "     latence");
  console.log("─".repeat(76));
  for (const e of ETAGES) {
    const l = CHAMPS.map((c) => pc(p.extraction[e][c].justesse).padStart(10)).join("");
    const lat = (CHAMPS.reduce((s, c) => s + p.extraction[e][c].latence, 0) / CHAMPS.length).toFixed(2);
    console.log(`${e.padEnd(10)}${l}   ${lat.padStart(7)} ms`);
  }

  console.log("\n\nCHAÎNE B — classement d'alertes\n");
  console.log("étage        justesse    latence");
  console.log("─".repeat(36));
  for (const e of ETAGES) {
    console.log(`${e.padEnd(12)}${pc(p.classement[e].justesse)}   ${p.classement[e].latence.toFixed(2).padStart(7)} ms`);
  }
  console.log(`\nProfils figés dans data/profils.json — ${p.mesureLe}\n`);
}
