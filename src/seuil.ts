/**
 * De combien un chiffre déclaré devrait être faux avant que la clause bascule.
 *
 * Le balayage de sensibilité répond à une autre question : de combien une entrée doit bouger
 * avant que le **routage recommandé** change. Ce n'est pas celle qui décide de l'argent. Une
 * déclaration peut déplacer la recommandation sans franchir la barre du remboursement, et la
 * franchir sans déplacer la recommandation.
 *
 * **Deux seuils, et ils sont ordonnés.** L'ordre n'est pas arbitraire : c'est celui de la
 * méthode — le plafond décide de l'admissibilité, les prix ne classent que ce qui est déjà
 * admissible.
 *
 *   1. sur la **latence déclarée** du titulaire. De combien elle devrait être fausse avant
 *      qu'il cesse de tenir le plafond. S'il ne le tient pas, la mesure l'a établi, les
 *      honoraires sont dus, et la comparaison de coût ne se pose plus. Ce seuil décide seul.
 *
 *   2. sur le **coût déclaré**, admissibilité tenue. De combien il devrait être faux avant que
 *      bascule « il existe une alternative admissible moins chère à exactitude indistinguable
 *      champ par champ ».
 *
 * Un seuil de coût calculé sur un titulaire inadmissible ne veut rien dire, donc il est
 * **refusé** plutôt que rendu trompeur.
 *
 * **Les deux sont rendus que la condition soit remplie ou non.** Un seuil qui n'apparaît que
 * quand on rembourse est un aveu, pas une mesure.
 *
 * **Et les deux sont `assumed`.** Ils sont calculés sur une entrée que le client déclare et que
 * personne ici ne peut vérifier ; un résultat dérivé porte la provenance la plus faible de ses
 * entrées. Sans exception, y compris quand la condition est confortablement remplie — un
 * chiffre dont la provenance change selon qu'il nous arrange serait pire que pas de chiffre.
 */

import { FIELDS } from "./corpus.ts";
import { rate, distinguishable } from "./interval.ts";
import { paliersMesures } from "./optimise.ts";
import { latency, pricePerThousandExtractions } from "./assumptions.ts";

import type { Profiles } from "./measure.ts";
import type { Assumptions } from "./assumptions.ts";
import type { Field } from "./corpus.ts";
import type { TierName } from "./paliers.ts";
import type { Provenance } from "./provenance.ts";

/** Le titulaire : son exactitude notée chez lui par notre correcteur, ses deux chiffres déclarés. */
export type Titulaire = {
  nom: string;
  parChamp: Partial<Record<Field, { bons: number; sur: number }>>;
  declares: { msParDocument?: number; coutParMilleDocuments?: number };
};

const PROVENANCE: Provenance = "assumed";

/**
 * Seuil 1 — la latence déclarée, et son asymétrie.
 *
 * L'asymétrie mérite d'être écrite parce qu'elle ne va pas dans le sens qu'on croit. Une latence
 * déclarée **trop basse** fait passer le titulaire pour admissible alors qu'il ne l'est pas :
 * elle nous expose à rembourser à tort. **Trop haute**, elle le sort du plafond et rend nos
 * honoraires dus. Celle qui joue contre le client n'est pas celle qu'il redoute.
 */
export function seuilAdmissibilite(h: Assumptions, t: Titulaire) {
  const plafond = h.latencyBudgetMs;
  const declaree = t.declares.msParDocument;
  if (declaree === undefined || !Number.isFinite(declaree)) {
    return {
      calculable: false as const, provenance: PROVENANCE, plafondMs: plafond,
      pourquoi: "aucune latence déclarée. L'admissibilité du titulaire n'est ni établie ni "
        + "réfutée, et le seuil de coût ne se calcule pas sans elle.",
    };
  }
  const admissible = declaree <= plafond;
  return {
    calculable: true as const, provenance: PROVENANCE,
    plafondMs: plafond, declareeMs: declaree, admissible,
    /* Bilatéral : les deux distances sont rendues, celle qui bascule est nommée. */
    margeMs: Number((plafond - declaree).toFixed(1)),
    facteurDeBascule: Number((plafond / declaree).toFixed(4)),
    bascule: admissible
      ? `la latence déclarée devrait être sous-estimée d'au moins ${(plafond - declaree).toFixed(0)} ms `
        + `par document — un facteur ${(plafond / declaree).toFixed(2)} — pour que le titulaire cesse `
        + `de tenir le plafond`
      : `la latence déclarée devrait être surestimée d'au moins ${(declaree - plafond).toFixed(0)} ms `
        + `par document — un facteur ${(declaree / plafond).toFixed(2)} — pour que le titulaire le tienne`,
    asymetrie: "Trop basse, la latence déclarée fait passer le titulaire pour admissible alors "
      + "qu'il ne l'est pas, et nous expose à rembourser à tort. Trop haute, elle le sort du "
      + "plafond et rend les honoraires dus. La direction qui joue contre le client n'est pas "
      + "celle qu'il redoute.",
    siFranchi: "Si le titulaire ne tient pas le plafond, la mesure l'a établi et les honoraires "
      + "sont dus quelle que soit la comparaison de coût.",
  };
}

/**
 * Seuil 2 — le coût déclaré, admissibilité tenue.
 *
 * « Indistinguable champ par champ » est appliqué à la lettre : sur chaque champ, l'intervalle
 * du titulaire et celui de l'alternative doivent se chevaucher. Une alternative **meilleure de
 * façon départageable** n'y satisfait donc pas, ce qui surprend — et c'est ce que les mots
 * disent. Le compte des routages écartés pour cette raison est rendu à côté, pour que l'écart
 * entre la lettre et l'intention se voie au lieu d'être tranché ici.
 */
export function seuilDeCout(p: Profiles, h: Assumptions, t: Titulaire) {
  const admis = seuilAdmissibilite(h, t);
  if (!admis.calculable) {
    return { calculable: false as const, provenance: PROVENANCE, pourquoi: admis.pourquoi };
  }
  if (!admis.admissible) {
    return {
      calculable: false as const, provenance: PROVENANCE, refuse: true as const,
      pourquoi: "le titulaire ne tient pas le plafond de latence. Un seuil de coût calculé sur "
        + "un titulaire inadmissible ne veut rien dire : les prix ne classent que ce qui est "
        + "déjà admissible. Les honoraires sont dus par le seuil 1, et la comparaison de coût "
        + "ne se pose pas.",
    };
  }
  const coutDeclare = t.declares.coutParMilleDocuments;
  if (coutDeclare === undefined || !Number.isFinite(coutDeclare)) {
    return { calculable: false as const, provenance: PROVENANCE,
      pourquoi: "aucun coût déclaré pour le titulaire." };
  }

  const champs = FIELDS.filter((c) => t.parChamp[c] !== undefined);
  if (champs.length === 0) {
    return { calculable: false as const, provenance: PROVENANCE,
      pourquoi: "aucun champ noté pour le titulaire : rien à comparer." };
  }

  const paliers = paliersMesures(p);
  const tauxTitulaire = Object.fromEntries(champs.map((c) =>
    [c, rate(t.parChamp[c]!.bons, t.parChamp[c]!.sur)])) as Record<Field, ReturnType<typeof rate>>;
  const tauxNotre = (tier: TierName, c: Field) => {
    const e = p.extraction[tier][c]!;
    return rate(Math.round(e.accuracy * e.items), e.items);
  };
  const prix = (tier: TierName, c: Field) =>
    pricePerThousandExtractions(tier, h, p.extraction[tier][c]!.latency);
  /* `latency()` rend des millisecondes par élément. La première version multipliait par mille,
     donc chaque routage dépassait le plafond et le seuil rendait « aucun routage admissible
     n'est indistinguable » — une conclusion fausse, et de celles qui font signer une clause. */
  const ms = (tier: TierName, c: Field) => latency(tier, p.extraction[tier][c]!.latency, h);

  let meilleur: { routage: Record<Field, TierName>; cout: number; ms: number } | null = null;
  let ecartesPourMieux = 0, admissibles = 0;
  /*
   * Compter séparément ce qui échoue sur l'exactitude et ce qui échoue sur le plafond.
   *
   * « Aucun seuil » a deux causes très différentes : soit rien ne vous égale champ par champ,
   * soit tout ce qui vous égale est trop lent. La seconde est un fait sur votre plafond et pas
   * sur nos paliers, et un client ne peut pas agir sur la même chose dans les deux cas.
   */
  let egauxMaisTropLents = 0, plusRapideDesEgaux = Number.POSITIVE_INFINITY;
  const parcours = (i: number, acc: Partial<Record<Field, TierName>>) => {
    if (i === champs.length) {
      const r = acc as Record<Field, TierName>;
      const msTotal = champs.reduce((a, c) => a + ms(r[c]!, c), 0);
      let indistinguable = true, mieuxQuelquePart = false;
      for (const c of champs) {
        const n = tauxNotre(r[c]!, c);
        if (distinguishable(n, tauxTitulaire[c])) {
          indistinguable = false;
          if (n.rate > tauxTitulaire[c].rate) mieuxQuelquePart = true;
        }
      }
      if (indistinguable && msTotal > h.latencyBudgetMs) {
        egauxMaisTropLents++;
        if (msTotal < plusRapideDesEgaux) plusRapideDesEgaux = msTotal;
      }
      if (msTotal > h.latencyBudgetMs) return;
      admissibles++;
      if (!indistinguable) { if (mieuxQuelquePart) ecartesPourMieux++; return; }
      const cout = champs.reduce((a, c) => a + prix(r[c]!, c), 0);
      if (!meilleur || cout < meilleur.cout) meilleur = { routage: r, cout, ms: msTotal };
      return;
    }
    for (const tier of paliers) parcours(i + 1, { ...acc, [champs[i]!]: tier });
  };
  parcours(0, {});

  const m = meilleur as { routage: Record<Field, TierName>; cout: number; ms: number } | null;
  if (!m) {
    return {
      calculable: false as const, provenance: PROVENANCE,
      routagesAdmissibles: admissibles, ecartesPourEtreMeilleurs: ecartesPourMieux,
      egauxMaisTropLents,
      plusRapideDesEgauxMs: Number.isFinite(plusRapideDesEgaux)
        ? Number(plusRapideDesEgaux.toFixed(1)) : null,
      pourquoi: egauxMaisTropLents > 0
        ? `${egauxMaisTropLents} routage(s) égalent le titulaire sur les cinq champs, et tous `
          + `dépassent le plafond — le plus rapide tient ${plusRapideDesEgaux.toFixed(0)} ms par `
          + `document contre ${h.latencyBudgetMs} autorisées. Le seuil n'existe pas, et c'est un `
          + `fait sur le plafond fixé, pas sur nos paliers : relever le plafond de `
          + `${(plusRapideDesEgaux - h.latencyBudgetMs).toFixed(0)} ms le ferait exister.`
        : "aucun routage, admissible ou non, n'égale le titulaire sur les cinq champs. Le seuil "
          + "n'existe pas, et c'est un fait sur l'exactitude : aucun plafond ne le ferait "
          + "apparaître.",
      distinctionUtile: "« Aucun seuil » a deux causes qu'un client ne peut pas confondre : rien "
        + "ne vous égale, ou tout ce qui vous égale est trop lent. Seule la seconde se corrige "
        + "en déplaçant le plafond.",
    };
  }

  const remplie = coutDeclare > m.cout;
  return {
    calculable: true as const, provenance: PROVENANCE,
    coutDeclareParMille: coutDeclare,
    alternativeLaMoinsChere: { routage: m.routage, coutParMille: Number(m.cout.toFixed(4)),
      msParDocument: Number(m.ms.toFixed(1)) },
    conditionRemplie: remplie,
    /* Bilatéral : les deux distances, et laquelle bascule. */
    basculeAParMille: Number(m.cout.toFixed(4)),
    ecartParMille: Number((coutDeclare - m.cout).toFixed(4)),
    facteurDeBascule: coutDeclare > 0 ? Number((m.cout / coutDeclare).toFixed(4)) : null,
    bascule: remplie
      ? `le coût déclaré devrait être surestimé d'au moins ${(coutDeclare - m.cout).toFixed(2)} `
        + `par millier de documents — un facteur ${(m.cout / coutDeclare).toFixed(2)} — pour que `
        + `la condition cesse d'être remplie`
      : `le coût déclaré devrait être sous-estimé d'au moins ${(m.cout - coutDeclare).toFixed(2)} `
        + `par millier — un facteur ${(m.cout / coutDeclare).toFixed(2)} — pour qu'elle le soit`,
    routagesAdmissibles: admissibles,
    ecartesPourEtreMeilleurs: ecartesPourMieux,
    surLaLettre: "« Indistinguable champ par champ » est appliqué à la lettre : une alternative "
      + "meilleure de façon départageable n'y satisfait pas. `ecartesPourEtreMeilleurs` compte "
      + "les routages admissibles écartés pour cette seule raison, afin que l'écart entre la "
      + "lettre et l'intention se voie plutôt que d'être tranché ici.",
  };
}

/** Les deux seuils, dans leur ordre, rendus que la condition soit remplie ou non. */
export function seuilsDeRemboursement(p: Profiles, h: Assumptions, t: Titulaire) {
  return {
    quoi: "De combien un chiffre déclaré devrait être faux avant que la clause bascule.",
    titulaire: t.nom,
    provenance: PROVENANCE,
    surLaProvenance: "Calculés sur des entrées que le client déclare et que personne ici ne peut "
      + "vérifier. Un résultat dérivé porte la provenance la plus faible de ses entrées, donc "
      + "ces seuils sont `assumed` sans exception — y compris quand la condition est "
      + "confortablement remplie.",
    ordre: "Le plafond décide de l'admissibilité, les prix ne classent que ce qui est déjà "
      + "admissible. Le seuil de coût est refusé, et non rendu, sur un titulaire inadmissible.",
    admissibilite: seuilAdmissibilite(h, t),
    cout: seuilDeCout(p, h, t),
  };
}
