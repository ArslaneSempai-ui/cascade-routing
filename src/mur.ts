/**
 * Jusqu'où le solveur va — F champs, T paliers — mesuré sur le solveur qu'on vend.
 *
 * Le trou nommé de la méthode : « exhaustif » n'est une promesse que si l'on dit jusqu'où.
 * Avant la correction, la limite n'était pas le temps mais la mémoire : chaque solution
 * admissible était retenue dans un tableau pour être refiltrée ensuite, et à sept paliers et
 * huit champs le tas était épuisé. L'outil ne ralentissait pas, il s'arrêtait.
 *
 * Le solveur énumère maintenant deux fois en mémoire constante. La limite redevient le temps,
 * qui prévient au lieu de tuer : une passe qui prend une minute se voit, une passe qui plante
 * à quatre gigaoctets ne dit rien de ce qu'il aurait fallu réduire.
 *
 *     npm run mur                  la grille F × T, avec le temps de chacune
 */

import { writeFileSync } from "node:fs";
import { isMain } from "./cli.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS } from "./assumptions.ts";
import { optimiseExtraction, paliersMesures } from "./optimise.ts";
import { FIELDS } from "./corpus.ts";

import type { Profiles } from "./measure.ts";
import type { Field } from "./corpus.ts";
import type { TierName } from "./paliers.ts";

const SORTIE = new URL("../mur.json", import.meta.url).pathname;

/**
 * Un profil synthétique à F champs et T paliers, bâti par recopie du profil réel.
 *
 * Les chiffres n'ont pas à être réalistes — on mesure une combinatoire, pas une exactitude —
 * mais ils doivent être **distincts**, sinon les paliers deviennent indiscernables et la
 * seconde passe s'arrête au premier candidat, ce qui mesurerait un travail que le solveur ne
 * fait pas dans la vraie vie.
 */
export function profilSynthetique(reel: Profiles, champs: readonly Field[], nbPaliers: number): Profiles {
  const modeles = paliersMesures(reel);
  const paliers = Array.from({ length: nbPaliers }, (_, i) => `t${i}` as TierName);
  const extraction = {} as Profiles["extraction"];
  const loadTime = {} as Record<TierName, number>;
  for (let i = 0; i < nbPaliers; i++) {
    const source = reel.extraction[modeles[i % modeles.length]!]!;
    const t = paliers[i]!;
    extraction[t] = {} as never;
    for (const c of champs) {
      const base = source[FIELDS[0]!]!;
      extraction[t]![c] = {
        ...base,
        /* Décalés palier par palier, sinon tout est indiscernable et la passe 2 ne travaille pas. */
        accuracy: Math.min(0.999, Math.max(0.01, base.accuracy - i * 0.017)),
        latency: base.latency * (1 + i * 0.11),
      };
    }
    loadTime[t] = 0;
  }
  return { ...reel, tiers: paliers, extraction, loadTime,
    classification: {} as never, provenance: undefined };
}

if (isMain(import.meta)) {
  const reel = readProfiles();
  if (!reel) { console.error("aucun relevé"); process.exit(1); }
  const plafondMs = Number(process.argv.find((a) => a.startsWith("--plafond="))?.split("=")[1] ?? 60_000);

  console.log(`\nMur du solveur — deux énumérations, mémoire constante. Plafond ${plafondMs / 1000} s par point.\n`);
  console.log("   T\\F " + [4, 5, 6, 7, 8].map((f) => String(f).padStart(11)).join(""));

  const grille: { paliers: number; champs: number; affectations: number; ms: number | null }[] = [];
  for (const T of [4, 5, 6, 7, 8, 9]) {
    const ligne: string[] = [];
    for (const F of [4, 5, 6, 7, 8]) {
      const champs = Array.from({ length: F }, (_, i) => (FIELDS[i % FIELDS.length]! + (i >= FIELDS.length ? `_${i}` : "")) as Field);
      const p = profilSynthetique(reel, champs, T);
      const paliers = p.tiers as TierName[];
      /*
       * Budgets desserrés exprès.
       *
       * On mesure une combinatoire, pas une recommandation : si tout dépasse le budget, chaque
       * feuille est rejetée avant la comparaison et la seconde passe ne fait aucun travail
       * d'indiscernabilité — on chronométrerait un solveur qui ne résout rien.
       */
      const large = { ...ASSUMPTIONS, budget: 1e12, latencyBudgetMs: 1e9 };
      const affectations = T ** F;
      /* Au-delà du plafond estimé, on ne lance pas : mesurer un point à dix minutes ne dit
         rien de plus que le point précédent, et immobilise la machine. */
      const precedent = grille.filter((g) => g.ms !== null).sort((a, b) => b.affectations - a.affectations)[0];
      const estime = precedent ? precedent.ms! * (affectations / precedent.affectations) : 0;
      if (estime > plafondMs) { ligne.push("—".padStart(11)); grille.push({ paliers: T, champs: F, affectations, ms: null }); continue; }
      const t0 = performance.now();
      optimiseExtraction(p, large, champs, paliers);
      const ms = performance.now() - t0;
      grille.push({ paliers: T, champs: F, affectations, ms: Number(ms.toFixed(1)) });
      ligne.push(`${ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(1)} s`}`.padStart(11));
    }
    console.log(`  ${String(T).padStart(2)}  ` + ligne.join(""));
  }

  const mesures = grille.filter((g) => g.ms !== null);
  const plusGrand = mesures.sort((a, b) => b.affectations - a.affectations)[0]!;
  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Jusqu'où le solveur exhaustif va, en champs et en paliers.",
    solveur: "deux énumérations, mémoire constante",
    mesureLe: new Date().toISOString(),
    plafondParPointMs: plafondMs,
    grille,
    plusGrandPointMesure: plusGrand,
    limite: "Le temps, pas la mémoire. Le solveur énumère deux fois sans rien retenir, donc il "
      + "ralentit au lieu de s'arrêter — un point qui prend une minute se voit et se réduit, "
      + "un tas épuisé ne dit pas quoi réduire. Les points marqués `—` n'ont pas été lancés : "
      + "leur durée estimée depuis le point précédent dépassait le plafond.",
    avantLaCorrection: "Le solveur retenait chaque solution admissible en mémoire pour la "
      + "refiltrer. À sept paliers et huit champs, tas de quatre gigaoctets épuisé : arrêt, pas "
      + "ralentissement.",
  }, null, 2) + "\n");
  console.log(`\nÉcrit dans ${SORTIE.split("/").pop()}\n`);
}
