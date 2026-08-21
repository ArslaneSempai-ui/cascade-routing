/**
 * Interroger les tentatives déjà mesurées — sans machine.
 *
 * Chacune des questions ci-dessous coûtait une passe de GPU tant que les passes n'écrivaient
 * que des moyennes. Elles coûtent maintenant une lecture de fichier. C'est tout l'objet du
 * changement de format : la question suivante n'est plus une dépense.
 *
 *     npm run tentatives                     ce que contiennent les journaux
 *     npm run tentatives -- --run=<motif>    un journal en particulier
 */

import { isMain } from "./cli.ts";
import { journaux, lireJournal, issues, parDocument, apparie } from "./journal.ts";

import type { Tentative } from "./journal.ts";

/** Les conditions présentes dans un lot de lignes — ce sur quoi une comparaison est licite. */
export function conditions(t: readonly Tentative[]) {
  const vues = new Map<string, { tier: string; phrasing: string; split: string; n: number }>();
  for (const x of t) {
    const k = `${x.tier}|${x.phrasing}|${x.split}`;
    const v = vues.get(k) ?? { tier: x.tier, phrasing: x.phrasing, split: x.split, n: 0 };
    v.n++; vues.set(k, v);
  }
  return [...vues.values()].sort((a, b) => a.tier.localeCompare(b.tier) || a.phrasing.localeCompare(b.phrasing));
}

if (isMain(import.meta)) {
  const motif = process.argv.find((a) => a.startsWith("--run="))?.split("=")[1];
  const fichiers = journaux().filter((f) => !motif || f.includes(motif));
  if (fichiers.length === 0) {
    console.log("\nAucun journal dans data/tentatives/ — lancez une mesure d'abord.\n");
    process.exit(0);
  }

  for (const f of fichiers) {
    const { conditions: c, tentatives, complet, tronquees } = lireJournal(f);
    console.log(`\n${f.split("/").pop()}`);
    console.log(`  ${c?.quoi ?? "(sans en-tête)"}`);
    console.log(`  ${tentatives.length} tentatives, ${complet ? "passe complète" : "PASSE INCOMPLÈTE"}`
      + `${tronquees ? `, ${tronquees} ligne(s) tronquée(s)` : ""}`
      + `${c?.commit ? `, commit ${c.commit}${c.sale ? " (arbre sale)" : ""}` : ""}`);

    for (const cond of conditions(tentatives)) {
      const i = issues(tentatives, { tier: cond.tier, phrasing: cond.phrasing });
      const d = parDocument(tentatives, { tier: cond.tier, phrasing: cond.phrasing });
      const pct = (x: number) => `${(100 * x / i.total).toFixed(1)} %`;
      console.log(`    ${cond.tier.padEnd(10)} ${cond.phrasing.padEnd(18)} ${String(cond.split).padEnd(12)}`
        + ` propre ${pct(i.clean).padStart(7)}  blanc ${pct(i.blank).padStart(7)}  faux ${pct(i.wrong).padStart(7)}`
        + `   dossiers entiers ${d.tauxDocument === null ? "—" : `${(100 * d.tauxDocument).toFixed(1)} %`}`);
    }

    /*
     * Tous les appariements possibles à l'intérieur d'un journal.
     *
     * Chacun d'eux était une passe de quarante minutes il y a une heure. Ils sont ici parce
     * que les lignes sont là, pas parce qu'on a remesuré quoi que ce soit.
     */
    const conds = conditions(tentatives);
    if (conds.length >= 2) {
      console.log("    — appariements (McNemar sur les cas communs) —");
      for (let a = 0; a < conds.length; a++) for (let b = a + 1; b < conds.length; b++) {
        const r = apparie(tentatives, conds[a]!, conds[b]!);
        if (r.communs === 0) continue;
        const g = `${conds[a]!.tier}/${conds[a]!.phrasing}`, p = `${conds[b]!.tier}/${conds[b]!.phrasing}`;
        console.log(`      ${g.padEnd(28)} contre ${p.padEnd(28)} ${r.gains}–${r.regressions}`
          + ` sur ${r.communs}   ${r.decidable ? "DÉPARTAGÉ" : "dans le bruit"}`);
      }
    }
  }
  console.log();
}
