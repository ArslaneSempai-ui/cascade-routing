/**
 * Measure each tier once, then freeze.
 *
 * This is what the field actually does, and it is the only honest option: you do not
 * compare models on figures published by the people selling them. You run them on your
 * own set, record what they return, and keep the record.
 *
 * The saved profile carries accuracy and latency — measured — and nothing else. Price is
 * not a measurement: it is an assumption, it belongs to the screen and it is arguable.
 * Mixing the two would pass a tariff off as a fact.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { generateRecords, generateAlerts, FIELDS, TYPOLOGIES } from "./corpus.ts";
import { TIERS, loadExtractors, loadClassifiers, extract, classify, correct } from "./tiers.ts";
import type { TierName } from "./tiers.ts";
import type { Field } from "./corpus.ts";

const FICHIER = new URL("../data/profiles.json", import.meta.url).pathname;

export type Profile = {
  /** Split des items que cet tier traite correctement. Mesurée. */
  accuracy: number;
  /** Millisecondes par item, hors loadTime du modèle. Mesurée. */
  latency: number;
  items: number;
};

export type Profiles = {
  measuredAt: string;
  /** Chaîne A : un profil par tier ET par champ — c'est là que se joue le routing. */
  extraction: Record<TierName, Record<Field, Profile>>;
  /** Chaîne B : un profil par tier, une seule décision par dossier. */
  classification: Record<TierName, Profile>;
  loadTime: Record<TierName, number>;
};

export function readProfiles(): Profiles | null {
  return existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, "utf8")) : null;
}

export async function measure(howMany = 120): Promise<Profiles> {
  /*
   * On mesure sur l'épreuve, jamais sur l'training.
   *
   * La première campagne donnait 100 % aux règles sur les cinq champs : elles avaient
   * été écrites contre les gabarits qui servaient à les noter. Le paramètre est explicite
   * pour que se tromper demande de l'écrire.
   */
  const dossiers = generateRecords(howMany, "heldout");
  const alertes = generateAlerts(howMany, "heldout");

  const loadTime = {} as Record<TierName, number>;
  let t = performance.now();
  await loadExtractors();
  const chargeExtraction = performance.now() - t;
  t = performance.now();
  await loadClassifiers();
  const chargeClassement = performance.now() - t;

  const extraction = {} as Profiles["extraction"];
  for (const tier of TIERS) {
    extraction[tier] = {} as Record<Field, Profile>;
    loadTime[tier] = tier === "rules" || tier === "human" ? 0 : chargeExtraction + chargeClassement;

    for (const champ of FIELDS) {
      let right = 0;
      const start = performance.now();
      for (const d of dossiers) {
        if (correct(await extract(tier, d, champ), d.truth[champ])) right++;
      }
      const duration = performance.now() - start;
      extraction[tier][champ] = {
        accuracy: right / dossiers.length,
        latency: duration / dossiers.length,
        items: dossiers.length,
      };
    }
  }

  const classification = {} as Record<TierName, Profile>;
  for (const tier of TIERS) {
    let right = 0;
    const start = performance.now();
    for (const a of alertes) if (await classify(tier, a) === a.truth) right++;
    const duration = performance.now() - start;
    classification[tier] = {
      accuracy: right / alertes.length,
      latency: duration / alertes.length,
      items: alertes.length,
    };
  }

  const profils: Profiles = {
    measuredAt: new Date().toISOString(), extraction, classification, loadTime,
  };
  mkdirSync(dirname(FICHIER), { recursive: true });
  writeFileSync(FICHIER, JSON.stringify(profils, null, 2));
  return profils;
}

if (import.meta.filename === process.argv[1]) {
  console.log("\nMeasuring — models download on the first run, allow a few minutes.\n");
  const p = await measure();
  const pc = (x: number) => (x * 100).toFixed(1).padStart(5) + " %";

  console.log("CHAIN A — extraction, accuracy per field\n");
  console.log("tier      " + FIELDS.map((c) => c.padStart(10)).join("") + "     latency");
  console.log("─".repeat(76));
  for (const e of TIERS) {
    const l = FIELDS.map((c) => pc(p.extraction[e][c].accuracy).padStart(10)).join("");
    const lat = (FIELDS.reduce((s, c) => s + p.extraction[e][c].latency, 0) / FIELDS.length).toFixed(2);
    console.log(`${e.padEnd(10)}${l}   ${lat.padStart(7)} ms`);
  }

  console.log("\n\nCHAIN B — alert classification\n");
  console.log("tier         accuracy    latency");
  console.log("─".repeat(36));
  for (const e of TIERS) {
    console.log(`${e.padEnd(12)}${pc(p.classification[e].accuracy)}   ${p.classification[e].latency.toFixed(2).padStart(7)} ms`);
  }
  console.log(`\nProfiles frozen in data/profiles.json — ${p.measuredAt}\n`);
}
