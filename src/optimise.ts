/**
 * Le routing optimal, et le prix de la contrainte.
 *
 * La chaîne A route **par field** : chaque field peut partir à un tier différent, et
 * c'est là que se trouve tout le gain. La chaîne B n'a qu'une décision, donc un seul
 * choix — la comparaison des deux est l'enseignement du projet.
 *
 * Le chiffre qui décide n'est ni le cost ni la accuracy : c'est le **prix fictif** du
 * budget. Combien de accuracy achète le prochain euro ? Tant qu'il achète beaucoup, la
 * contrainte mord et il faut la desserrer. Quand il n'achète plus rien, dépenser plus
 * est du gaspillage, et c'est ailleurs qu'il faut regarder.
 */

import { TIERS } from "./tiers.ts";
import { FIELDS } from "./corpus.ts";
import { pricePerThousand, accuracy, latency, ASSUMPTIONS } from "./assumptions.ts";
import { readProfiles } from "./measure.ts";
import type { TierName } from "./tiers.ts";
import type { Field } from "./corpus.ts";
import type { Assumptions } from "./assumptions.ts";
import type { Profiles } from "./measure.ts";

export type Routing = Record<Field, TierName>;

export type Solution = {
  routing: Routing;
  /** Justesse mean sur les cinq champs. */
  accuracy: number;
  /** Coût pour le volume complet, en euros. */
  cost: number;
  /** Secondes de traitement pour le volume complet. */
  seconds: number;
  /** Split du budget consommée. */
  budgetShare: number;
};

/**
 * La best affectation field par field sous contrainte de budget.
 *
 * Cinq champs, quatre étages : 1 024 combinaisons. On les énumère toutes plutôt que
 * d'appliquer une heuristique — à cette taille, l'exhaustif est instantané et il garantit
 * l'optimum, ce qu'aucune heuristique ne fait.
 */
export function optimiseExtraction(p: Profiles, h: Assumptions): Solution | null {
  let best: Solution | null = null;

  const evaluate = (routing: Routing): Solution => {
    let sommeJustesse = 0, cost = 0, seconds = 0;
    for (const c of FIELDS) {
      const e = routing[c];
      const profil = p.extraction[e][c];
      sommeJustesse += accuracy(e, profil.accuracy, h);
      cost += (h.volume / 1000) * pricePerThousand(e, h);
      seconds += (h.volume * latency(e, profil.latency, h)) / 1000;
    }
    return {
      routing,
      accuracy: sommeJustesse / FIELDS.length,
      cost, seconds,
      budgetShare: h.budget === 0 ? Infinity : cost / h.budget,
    };
  };

  const walk = (i: number, current: Partial<Routing>) => {
    if (i === FIELDS.length) {
      const s = evaluate(current as Routing);
      if (s.cost > h.budget) return;   // hors budget : la solution n'existe pas
      // À accuracy égale, le moins cher gagne — sinon on paierait pour rien.
      if (!best || s.accuracy > best.accuracy
        || (s.accuracy === best.accuracy && s.cost < best.cost)) best = s;
      return;
    }
    for (const e of TIERS) walk(i + 1, { ...current, [FIELDS[i]]: e });
  };
  walk(0, {});
  return best;
}

/** La chaîne B : un seul tier pour tout le monde, donc quatre possibilités. */
export function optimiseClassification(p: Profiles, h: Assumptions) {
  const options = TIERS.map((e) => {
    const profil = p.classification[e];
    const cost = (h.volume / 1000) * pricePerThousand(e, h);
    return {
      tier: e,
      accuracy: accuracy(e, profil.accuracy, h),
      cost,
      affordable: cost <= h.budget,
    };
  });
  const tenables = options.filter((o) => o.affordable);
  const chosen = tenables.length
    ? tenables.reduce((a, b) => (b.accuracy > a.accuracy || (b.accuracy === a.accuracy && b.cost < a.cost) ? b : a))
    : null;
  return { options, chosen };
}

/**
 * Le prix fictif du budget.
 *
 * On desserre le budget d'un pas et on regarde ce que la accuracy gagne. Le rapport est
 * ce que vaut réellement l'euro suivant — et il tombe à zéro bien avant que le budget ne
 * paraisse confortable, ce qui est précisément l'information qu'un comité attend.
 */
export function budgetShadowPrice(p: Profiles, h: Assumptions) {
  const base = optimiseExtraction(p, h);
  if (!base) return null;

  /*
   * La step, pas la pente.
   *
   * Une première version desserrait le budget de 10 % et concluait « le prochain euro
   * n'achète rien ». C'était exact et sans intérêt : le gain suivant ne coûte pas 10 %
   * de plus, il coûte un tier entier — ici quarante fois le budget current. Un prix
   * fictif calculé sur un pas trop court mesure une pente là où le terrain est un
   * escalier, et fait conclure « inutile de dépenser » quand la vraie phrase est
   * « le progrès suivant coûte tant ».
   *
   * On cherche donc le plus small budget qui achète réellement better.
   */
  let step: { budget: number; accuracy: number; routing: Routing } | null = null;
  let low = base.cost, high = Math.max(base.cost * 2, 1);
  const better = (b: number) => {
    const s = optimiseExtraction(p, { ...h, budget: b });
    return s && s.accuracy > base.accuracy + 1e-9 ? s : null;
  };
  // On double jusqu'à trouver une amélioration, puis on resserre par dichotomie.
  let reached = null, rounds = 0;
  while (!(reached = better(high)) && rounds++ < 40) { low = high; high *= 2; }
  if (reached) {
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      const s = better(mid);
      if (s) { high = mid; reached = s; } else low = mid;
    }
    step = { budget: high, accuracy: reached.accuracy, routing: reached.routing };
  }

  return {
    currentBudget: h.budget,
    currentAccuracy: base.accuracy,
    currentCost: base.cost,
    /** La contrainte mord-elle ? Si le budget n'est pas consommé, non. */
    constraintBinds: base.budgetShare > 0.98,
    /** Ce que coûte le prochain progrès réel, et ce qu'il rapporte. */
    step: step && {
      budgetNeeded: step.budget,
      extra: step.budget - base.cost,
      gainPoints: (step.accuracy - base.accuracy) * 100,
      pointsPerThousandEuros: ((step.accuracy - base.accuracy) * 100)
        / ((step.budget - base.cost) / 1000),
      routing: step.routing,
    },
  };
}

if (import.meta.filename === process.argv[1]) {
  const p = readProfiles();
  if (!p) { console.error("No profile measured — start with: npm run measure"); process.exit(1); }
  const h = ASSUMPTIONS;
  const euro = (n: number) => "$" + Math.round(n).toLocaleString("en-GB");
  const pc = (x: number) => (x * 100).toFixed(1) + " %";

  console.log(`\n${h.volume.toLocaleString("en-GB")} records · budget ${euro(h.budget)}`);
  console.log(`human accuracy assumed at ${pc(h.humanAccuracy)} — this is not a measurement\n`);

  const a = optimiseExtraction(p, h);
  if (!a) { console.log("No routing fits this budget.\n"); process.exit(0); }

  console.log("CHAIN A — optimal routing, field by field\n");
  console.log("field         tier chosen    accuracy    cost");
  console.log("─".repeat(52));
  for (const c of FIELDS) {
    const e = a.routing[c];
    const j = accuracy(e, p.extraction[e][c].accuracy, h);
    console.log(`${c.padEnd(13)}${e.padEnd(15)}${pc(j).padStart(7)}   ${euro((h.volume / 1000) * pricePerThousand(e, h)).padStart(8)}`);
  }
  console.log("─".repeat(52));
  console.log(`${"".padEnd(13)}${"total".padEnd(15)}${pc(a.accuracy).padStart(7)}   ${euro(a.cost).padStart(8)}`);

  const b = optimiseClassification(p, h);
  console.log("\n\nCHAIN B — one tier for everyone\n");
  console.log("tier         accuracy       cost   affordable");
  console.log("─".repeat(45));
  for (const o of b.options) {
    console.log(`${o.tier.padEnd(12)}${pc(o.accuracy).padStart(7)}   ${euro(o.cost).padStart(9)}   ${o.affordable ? "yes" : "no"}${b.chosen?.tier === o.tier ? "   <- chosen" : ""}`);
  }

  const f = budgetShadowPrice(p, h);
  if (f) {
    console.log("\n\nPRICE OF THE NEXT IMPROVEMENT\n");
    console.log(`  budget used: ${euro(f.currentCost)} of ${euro(f.currentBudget)} — ${pc(a.budgetShare)}`);
    console.log(`  the constraint ${f.constraintBinds ? "BINDS" : "does not bind"}`);
    if (!f.step) {
      console.log("  aucun budget n'achète better : le plafond est dans les étages disponibles.\n");
    } else {
      const m = f.step;
      console.log(`  next gain: +${m.gainPoints.toFixed(1)} point(s) of accuracy`);
      console.log(`  it costs ${euro(m.extra)} more — ${(m.budgetNeeded / f.currentCost).toFixed(0)}x current spend`);
      console.log(`  yield: ${m.pointsPerThousandEuros.toFixed(3)} point per thousand euros`);
      const change = FIELDS.filter((c) => m.routing[c] !== a.routing[c]);
      console.log(`  what changes: ${change.map((c) => `${c} -> ${m.routing[c]}`).join(", ")}\n`);
    }
  }
}
