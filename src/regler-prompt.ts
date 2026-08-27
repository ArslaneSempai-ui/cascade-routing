/**
 * Choisir la formulation de chaque palier — sur `dev`, jamais sur `heldout`.
 *
 * La mesure du 20 août a montré qu'aucune formulation ne domine : `C-minimal` gagne trois
 * points sur `gen-4b` et en coûte trente à `gen-0.6b`, qui sans exemple ne comprend plus ce
 * qu'on lui demande. Le meilleur prompt dépend donc du modèle, et un prompt unique pour les
 * trois est un compromis que personne n'avait choisi.
 *
 * Le régler par palier est légitime ; le régler sur les cas qui servent à publier ne l'est
 * pas. C'est la faute que ce dépôt a commise à sa première mesure — des expressions
 * régulières écrites contre les gabarits qui servaient à les noter, 100 % sur cinq champs, et
 * un corpus entier à reconstruire. `dev` existe depuis pour ça : c'est la moitié sur laquelle
 * on a le droit de regarder les scores en travaillant.
 *
 * Ce script ne nomme un vainqueur que s'il le départage de son second sur les mêmes cas. Sa
 * première version prenait le maximum de cinq taux : `gen-4b` en est ressorti « réglé » sur
 * `A-sans-exemple` avec **une** extraction d'avance sur 600, et `gen-8b` sur
 * `B-exemple-apparie` avec trois. Un maximum n'est pas une mesure.
 *
 *     npm run regler          cinq formulations × trois paliers, sur `dev`
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { FIELDS, generateRecords } from "./corpus.ts";
import { loadGeneratifs, extract, correct, PROMPTS, GENERATIFS_PUBLICS, type NomPrompt } from "./tiers.ts";

import { pairedVerdict } from "./interval.ts";

import type { Field } from "./corpus.ts";
import type { TierName } from "./paliers.ts";
import { fileURLToPath } from "node:url";
/* La garde était écrite ici ET dans l'autre commande, et son commentaire disait déjà que sa
   place n'était pas la copie. Six autres commandes n'en avaient aucune : voir cas-demandes.ts. */
import { casDemandes, DRAPEAUX_CAS } from "./cas-demandes.ts";
import { exigerArbrePropre, DRAPEAUX_ARBRE } from "./arbre-propre.ts";

const SORTIE = fileURLToPath(new URL("../prompts-par-palier.json", import.meta.url));

/**
 * Le vainqueur sur `dev` est-il séparable de son second, sur les mêmes cas ?
 *
 * Deux formulations voient exactement les mêmes documents : comparer leurs moyennes revient à
 * jeter cette information. McNemar la garde. Quand il ne tranche pas, rien n'est retenu — et
 * les deux prétendants sont nommés, parce qu'« aucune formulation ne se détache » est un
 * résultat, alors qu'un vainqueur tiré du bruit n'en est pas un.
 */
export function departager(bits: Record<NomPrompt, Record<Field, string>>, noms: readonly NomPrompt[]) {
  const reussites = (n: NomPrompt) =>
    FIELDS.reduce((s, c) => s + [...bits[n]![c]!].filter((x) => x === "1").length, 0);
  const total = FIELDS.reduce((s, c) => s + bits[noms[0]!]![c]!.length, 0);
  const classe = [...noms].sort((a, b) => reussites(b) - reussites(a));
  const vainqueur = classe[0]!, second = classe[1]!;

  let gains = 0, regressions = 0;
  for (const c of FIELDS) {
    const a = bits[vainqueur]![c]!, b = bits[second]![c]!;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] === "1", y = b[i] === "1";
      if (x && !y) gains++; else if (y && !x) regressions++;
    }
  }
  const { decidable } = pairedVerdict(gains, regressions);
  return { retenu: decidable ? vainqueur : null, vainqueur, second, gains, regressions, total,
    ecartExtractions: reussites(vainqueur) - reussites(second), decidable };
}


if (isMain(import.meta)) {
  const cas = casDemandes(120);
  /* Sur `dev`. Le mettre en dur plutôt qu'en option : un réglage sur `heldout` ne doit pas
     être à une faute de frappe près. */
  const dossiers = generateRecords(cas, "dev");
  const noms = Object.keys(PROMPTS) as NomPrompt[];
  const paliers = GENERATIFS_PUBLICS;

  /* Un drapeau mal tapé ne se laisse pas ignorer : la commande tournerait entièrement,
     avec les réglages par défaut, et rendrait un résultat qui ne répond pas à la question
     posée. Les drapeaux des aides sont IMPORTÉS, pas recopiés. */
  refuserDrapeauxInconnus([...DRAPEAUX_ARBRE, ...DRAPEAUX_CAS]);
  const { etat: version, malgreArbreSale } = exigerArbrePropre("the prompt tuning");

  console.log(`\n${noms.length} phrasings × ${paliers.length} tiers × ${FIELDS.length} fields × ${cas} cases — on \`dev\`.`);
  console.log(`Load before starting: ${loadavg()[0]!.toFixed(2)} on ${cpus().length} cores.\n`);
  const journal = ouvrirJournal("regler", {
    quoi: "Cinq formulations par palier, sur le découpage de réglage.", split: "dev", cases: cas,
    commit: version?.commit, sale: (version?.sale.length ?? 0) > 0,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });
  await loadGeneratifs();

  const scores = {} as Record<TierName, Record<NomPrompt, Record<Field, number>>>;
  const bits = {} as Record<TierName, Record<NomPrompt, Record<Field, string>>>;
  for (const t of paliers) {
    scores[t] = {} as Record<NomPrompt, Record<Field, number>>;
    bits[t] = {} as Record<NomPrompt, Record<Field, string>>;
    for (const nom of noms) {
      scores[t][nom] = {} as Record<Field, number>;
      bits[t][nom] = {} as Record<Field, string>;
      for (const champ of FIELDS) {
        /* Le résultat de chaque cas, pas seulement leur moyenne : c'est ce qui permet de
           départager deux formulations sur les mêmes cas, et son absence a déjà coûté deux
           remesures à ce dépôt. */
        let s = "";
        for (const d of dossiers) {
          const t0 = performance.now();
          const got = await extract(t, d, champ, nom);
          const ms = performance.now() - t0;
          s += correct(got, d.truth[champ]) ? "1" : "0";
          journal.ligne({ tier: t, field: champ, caseId: d.id, phrasing: nom, split: "dev",
            outcome: issue(got, d.truth[champ]), ms: Number(ms.toFixed(3)),
            value: got, expected: d.truth[champ] });
        }
        bits[t][nom]![champ] = s;
        scores[t][nom]![champ] = [...s].filter((x) => x === "1").length / dossiers.length;
      }
      const m = FIELDS.reduce((s, c) => s + scores[t][nom]![c], 0) / FIELDS.length;
      console.log(`  ${t.padEnd(10)} ${nom.padEnd(20)} ${(100 * m).toFixed(1)} %`);
    }
  }

  const moyenne = (t: TierName, n: NomPrompt) => FIELDS.reduce((s, c) => s + scores[t][n]![c], 0) / FIELDS.length;
  const depart = Object.fromEntries(paliers.map((t) => [t, departager(bits[t]!, noms)]));
  const retenu = Object.fromEntries(paliers.map((t) => [t, depart[t]!.retenu]));

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "La formulation retenue pour chaque palier génératif, quand elle est départageable de sa suivante.",
    decoupage: "dev", cas, mesureLe: new Date().toISOString(), code: version,
    limite: "Choisi sur `dev` et jamais sur `heldout` : les chiffres publiés viennent d'une autre "
      + "moitié du corpus, que ce réglage n'a pas vue. Un réglage fait sur les cas de publication "
      + "aurait produit un score flatteur et faux, ce qui est arrivé une fois à ce dépôt.",
    limiteDuChoix: "`retenu` vaut `null` quand le vainqueur n'est pas départageable de son second "
      + "sur les mêmes cas. Un maximum entre cinq taux n'est pas un résultat : le lire comme tel "
      + "revient à publier le bruit du découpage de réglage. `depart` donne l'écart et le compte "
      + "apparié pour chaque palier, départagé ou non.",
    formulations: Object.fromEntries(noms.map((n) => [n, PROMPTS[n]("<DOCUMENT>", "document" as Field)])),
    surDev: Object.fromEntries(paliers.map((t) => [t,
      Object.fromEntries(noms.map((n) => [n, Number((100 * moyenne(t, n)).toFixed(1))]))])),
    retenu, depart, reussites: bits,
  }, null, 2) + "\n");

  console.log("\nkept per tier, on `dev`:");
  for (const t of paliers) {
    const d = depart[t]!;
    console.log(d.retenu
      ? `  ${t.padEnd(10)} ${d.retenu.padEnd(20)} ${(100 * moyenne(t, d.retenu)).toFixed(1)} % — ${d.gains}–${d.regressions} contre ${d.second}`
      : `  ${t.padEnd(10)} ${"— non départagé —".padEnd(20)} ${d.vainqueur} devant ${d.second} de ${d.ecartExtractions} extraction(s) sur ${d.total} ; apparié ${d.gains}–${d.regressions}`);
  }
  const j = journal.fermer();
  console.log(`${j.lignes} attempts in ${j.chemin.split("/").slice(-2).join("/")}`);
  console.log(`\nWritten to ${SORTIE.split("/").pop()} — to be measured next on \`heldout\`.\n`);
}
