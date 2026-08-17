/**
 * Le routage optimal, et le prix de la contrainte.
 *
 * La chaîne A route **par champ** : chaque champ peut partir à un étage différent, et
 * c'est là que se trouve tout le gain. La chaîne B n'a qu'une décision, donc un seul
 * choix — la comparaison des deux est l'enseignement du projet.
 *
 * Le chiffre qui décide n'est ni le coût ni la justesse : c'est le **prix fictif** du
 * budget. Combien de justesse achète le prochain euro ? Tant qu'il achète beaucoup, la
 * contrainte mord et il faut la desserrer. Quand il n'achète plus rien, dépenser plus
 * est du gaspillage, et c'est ailleurs qu'il faut regarder.
 */

import { ETAGES } from "./etages.ts";
import { CHAMPS } from "./corpus.ts";
import { prixMille, justesse, latence, HYPOTHESES } from "./hypotheses.ts";
import { lireProfils } from "./mesurer.ts";
import type { NomEtage } from "./etages.ts";
import type { Champ } from "./corpus.ts";
import type { Hypotheses } from "./hypotheses.ts";
import type { Profils } from "./mesurer.ts";

export type Routage = Record<Champ, NomEtage>;

export type Solution = {
  routage: Routage;
  /** Justesse moyenne sur les cinq champs. */
  justesse: number;
  /** Coût pour le volume complet, en euros. */
  cout: number;
  /** Secondes de traitement pour le volume complet. */
  secondes: number;
  /** Part du budget consommée. */
  partBudget: number;
};

/**
 * La meilleure affectation champ par champ sous contrainte de budget.
 *
 * Cinq champs, quatre étages : 1 024 combinaisons. On les énumère toutes plutôt que
 * d'appliquer une heuristique — à cette taille, l'exhaustif est instantané et il garantit
 * l'optimum, ce qu'aucune heuristique ne fait.
 */
export function optimiserExtraction(p: Profils, h: Hypotheses): Solution | null {
  let meilleure: Solution | null = null;

  const evaluer = (routage: Routage): Solution => {
    let sommeJustesse = 0, cout = 0, secondes = 0;
    for (const c of CHAMPS) {
      const e = routage[c];
      const profil = p.extraction[e][c];
      sommeJustesse += justesse(e, profil.justesse, h);
      cout += (h.volume / 1000) * prixMille(e, h);
      secondes += (h.volume * latence(e, profil.latence, h)) / 1000;
    }
    return {
      routage,
      justesse: sommeJustesse / CHAMPS.length,
      cout, secondes,
      partBudget: h.budget === 0 ? Infinity : cout / h.budget,
    };
  };

  const parcourir = (i: number, courant: Partial<Routage>) => {
    if (i === CHAMPS.length) {
      const s = evaluer(courant as Routage);
      if (s.cout > h.budget) return;   // hors budget : la solution n'existe pas
      // À justesse égale, le moins cher gagne — sinon on paierait pour rien.
      if (!meilleure || s.justesse > meilleure.justesse
        || (s.justesse === meilleure.justesse && s.cout < meilleure.cout)) meilleure = s;
      return;
    }
    for (const e of ETAGES) parcourir(i + 1, { ...courant, [CHAMPS[i]]: e });
  };
  parcourir(0, {});
  return meilleure;
}

/** La chaîne B : un seul étage pour tout le monde, donc quatre possibilités. */
export function optimiserClassement(p: Profils, h: Hypotheses) {
  const options = ETAGES.map((e) => {
    const profil = p.classement[e];
    const cout = (h.volume / 1000) * prixMille(e, h);
    return {
      etage: e,
      justesse: justesse(e, profil.justesse, h),
      cout,
      tenable: cout <= h.budget,
    };
  });
  const tenables = options.filter((o) => o.tenable);
  const retenu = tenables.length
    ? tenables.reduce((a, b) => (b.justesse > a.justesse || (b.justesse === a.justesse && b.cout < a.cout) ? b : a))
    : null;
  return { options, retenu };
}

/**
 * Le prix fictif du budget.
 *
 * On desserre le budget d'un pas et on regarde ce que la justesse gagne. Le rapport est
 * ce que vaut réellement l'euro suivant — et il tombe à zéro bien avant que le budget ne
 * paraisse confortable, ce qui est précisément l'information qu'un comité attend.
 */
export function prixFictifBudget(p: Profils, h: Hypotheses) {
  const base = optimiserExtraction(p, h);
  if (!base) return null;

  /*
   * La marche, pas la pente.
   *
   * Une première version desserrait le budget de 10 % et concluait « le prochain euro
   * n'achète rien ». C'était exact et sans intérêt : le gain suivant ne coûte pas 10 %
   * de plus, il coûte un étage entier — ici quarante fois le budget courant. Un prix
   * fictif calculé sur un pas trop court mesure une pente là où le terrain est un
   * escalier, et fait conclure « inutile de dépenser » quand la vraie phrase est
   * « le progrès suivant coûte tant ».
   *
   * On cherche donc le plus petit budget qui achète réellement mieux.
   */
  let marche: { budget: number; justesse: number; routage: Routage } | null = null;
  let bas = base.cout, haut = Math.max(base.cout * 2, 1);
  const mieux = (b: number) => {
    const s = optimiserExtraction(p, { ...h, budget: b });
    return s && s.justesse > base.justesse + 1e-9 ? s : null;
  };
  // On double jusqu'à trouver une amélioration, puis on resserre par dichotomie.
  let atteint = null, tours = 0;
  while (!(atteint = mieux(haut)) && tours++ < 40) { bas = haut; haut *= 2; }
  if (atteint) {
    for (let i = 0; i < 40; i++) {
      const milieu = (bas + haut) / 2;
      const s = mieux(milieu);
      if (s) { haut = milieu; atteint = s; } else bas = milieu;
    }
    marche = { budget: haut, justesse: atteint.justesse, routage: atteint.routage };
  }

  return {
    budgetActuel: h.budget,
    justesseActuelle: base.justesse,
    coutActuel: base.cout,
    /** La contrainte mord-elle ? Si le budget n'est pas consommé, non. */
    contrainteMord: base.partBudget > 0.98,
    /** Ce que coûte le prochain progrès réel, et ce qu'il rapporte. */
    marche: marche && {
      budgetNecessaire: marche.budget,
      supplement: marche.budget - base.cout,
      gainPoints: (marche.justesse - base.justesse) * 100,
      pointsParMilleEuros: ((marche.justesse - base.justesse) * 100)
        / ((marche.budget - base.cout) / 1000),
      routage: marche.routage,
    },
  };
}

if (import.meta.filename === process.argv[1]) {
  const p = lireProfils();
  if (!p) { console.error("Aucun profil mesuré — lance d'abord : npm run mesurer"); process.exit(1); }
  const h = HYPOTHESES;
  const euro = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
  const pc = (x: number) => (x * 100).toFixed(1) + " %";

  console.log(`\n${h.volume.toLocaleString("en-GB")} dossiers · budget ${euro(h.budget)}`);
  console.log(`justesse humaine postulée à ${pc(h.justesseHumaine)} — ce n'est pas une mesure\n`);

  const a = optimiserExtraction(p, h);
  if (!a) { console.log("Aucun routage ne tient dans ce budget.\n"); process.exit(0); }

  console.log("CHAÎNE A — routage optimal, champ par champ\n");
  console.log("champ         étage retenu    justesse    coût");
  console.log("─".repeat(52));
  for (const c of CHAMPS) {
    const e = a.routage[c];
    const j = justesse(e, p.extraction[e][c].justesse, h);
    console.log(`${c.padEnd(13)}${e.padEnd(15)}${pc(j).padStart(7)}   ${euro((h.volume / 1000) * prixMille(e, h)).padStart(8)}`);
  }
  console.log("─".repeat(52));
  console.log(`${"".padEnd(13)}${"total".padEnd(15)}${pc(a.justesse).padStart(7)}   ${euro(a.cout).padStart(8)}`);

  const b = optimiserClassement(p, h);
  console.log("\n\nCHAÎNE B — un seul étage pour tous\n");
  console.log("étage        justesse       coût   tenable");
  console.log("─".repeat(45));
  for (const o of b.options) {
    console.log(`${o.etage.padEnd(12)}${pc(o.justesse).padStart(7)}   ${euro(o.cout).padStart(9)}   ${o.tenable ? "oui" : "non"}${b.retenu?.etage === o.etage ? "   ← retenu" : ""}`);
  }

  const f = prixFictifBudget(p, h);
  if (f) {
    console.log("\n\nPRIX DU PROCHAIN PROGRÈS\n");
    console.log(`  budget consommé : ${euro(f.coutActuel)} sur ${euro(f.budgetActuel)} — ${pc(a.partBudget)}`);
    console.log(`  la contrainte ${f.contrainteMord ? "MORD" : "ne mord pas"}`);
    if (!f.marche) {
      console.log("  aucun budget n'achète mieux : le plafond est dans les étages disponibles.\n");
    } else {
      const m = f.marche;
      console.log(`  prochain gain : +${m.gainPoints.toFixed(1)} point(s) de justesse`);
      console.log(`  il coûte ${euro(m.supplement)} de plus — soit ${(m.budgetNecessaire / f.coutActuel).toFixed(0)}× la dépense actuelle`);
      console.log(`  rendement : ${m.pointsParMilleEuros.toFixed(3)} point par millier d'euros`);
      const change = CHAMPS.filter((c) => m.routage[c] !== a.routage[c]);
      console.log(`  ce qui change : ${change.map((c) => `${c} → ${m.routage[c]}`).join(", ")}\n`);
    }
  }
}
