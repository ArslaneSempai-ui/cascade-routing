/**
 * Your cases, not mine.
 *
 * Everything else in this repository measures a corpus I wrote. That is the objection every
 * reader raises, and they are right to: a held-out split defends against marking your own
 * homework, it does not turn invented documents into the ones your customers send.
 *
 * This is the answer. Point it at a CSV of your own cases and it runs the same measurement,
 * with the same scorer and the same intervals, on your data. Nothing about your file leaves
 * the machine — the models are local, and there is no network call anywhere in this path.
 *
 * ─── The file it wants ───
 *
 *     id,text,name,birth,document
 *     1,"Anna Petrova — dob 3 May 1990 — doc ES-1234-A",Anna Petrova,3 May 1990,ES-1234-A
 *
 * The first column is an identifier, the second is the input, and **every remaining column
 * is a field to extract**, named by its header. Three columns of expected answers means
 * three fields measured and routed. Nothing is configured anywhere else.
 *
 * ─── What it deliberately does not do ───
 *
 * It cannot measure your hand-written rules, because those are your code and this cannot
 * see them. Supply them as regexes with `--rules=file.json` and they become a tier like any
 * other; leave them out and the routing is over models only. That is a real limitation and
 * it is stated rather than hidden: on my own corpus the free rules carried three fields out
 * of five, so a routing computed without them will overstate what you need to pay.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadavg } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { loadExtractors, loadClassifiers, loadGeneratifs, extract, correct, classerParmi, MODELES_LOCAUX } from "./tiers.ts";
import { ENCODEURS, GENERATIFS } from "./paliers.ts";
import { rate, writeRate, distinguishable, CONFIANCE, ENOUGH } from "./interval.ts";
import { table } from "./figures.ts";

import type { TierName } from "./paliers.ts";

export type Cas = { id: string; text: string; truth: Record<string, string> };

/**
 * Un CSV lu sans dépendance, guillemets compris.
 *
 * Écrire un analyseur CSV à la main est habituellement une mauvaise idée. Ici c'est le prix
 * d'une propriété qui vaut plus que la commodité : ce dépôt n'a aucune dépendance
 * d'exécution, donc rien à auditer avant de lui confier un fichier de cas réels. Un
 * responsable conformité qui doit approuver l'outil lit trois cents lignes, pas un arbre de
 * modules.
 */
export function lireCsv(texte: string): { champs: string[]; cas: Cas[] } {
  const lignes: string[][] = [];
  let ligne: string[] = [], cellule = "", guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]!;
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { cellule += '"'; i++; }
      else if (c === '"') guillemets = false;
      else cellule += c;
    } else if (c === '"') guillemets = true;
    else if (c === ",") { ligne.push(cellule); cellule = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(cellule); cellule = "";
      if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
      ligne = [];
    } else cellule += c;
  }
  if (cellule !== "" || ligne.length) { ligne.push(cellule); if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne); }

  const entete = lignes.shift();
  if (!entete || entete.length < 2) {
    throw new Error("the file needs at least two columns: the input text and one expected answer");
  }
  /*
   * Deux colonnes veut dire « texte, réponse » — pas d'identifiant.
   *
   * C'est la forme de tous les jeux publics de classification, et exiger une colonne d'ids
   * que personne ne fournit reviendrait à demander au lecteur de préparer ses données pour
   * l'outil plutôt que l'inverse.
   */
  const sansId = entete.length === 2;
  const champs = (sansId ? entete.slice(1) : entete.slice(2)).map((x) => x.trim());
  const cas = lignes.map((l, i) => ({
    id: sansId ? String(i + 1) : (l[0] ?? String(i + 1)).trim(),
    text: (sansId ? l[0] : l[1]) ?? "",
    truth: Object.fromEntries(champs.map((c, j) => [c, (l[(sansId ? 1 : 2) + j] ?? "").trim()])),
  }));
  return { champs, cas };
}

/** Des règles fournies par le lecteur, en expressions régulières nommées par champ. */
/**
 * Ce que le client a produit lui-même — ses sorties, jamais son code.
 *
 * Un client fait tourner sa chaîne chez lui et nous envoie ce qu'elle a rendu, document par
 * document et champ par champ. On le note exactement comme un palier : une valeur **fournie**
 * au lieu d'une valeur trouvée. Sa technologie n'entre pas — modèle, API, script maison,
 * chaîne propriétaire, prose : on ne voit que des valeurs.
 *
 * **Aucune porte d'exécution**, et c'est délibéré. « Trois cents lignes sans dépendance » et
 * « un outil qui lance ce qu'on lui indique » ne s'approuvent pas par les mêmes personnes, et
 * le premier est ce qui permet à un responsable conformité de dire oui. On ne l'échange pas
 * contre de la commodité.
 *
 * Ce qu'on mesure de sa chaîne et ce qu'on ne mesure pas :
 *
 *   son exactitude — **mesurée** : on note ses valeurs contre ses réponses de référence,
 *                    c'est un calcul fait ici, reproductible par lui.
 *   son coût et sa latence — il les **déclare**. On ne les a pas vus.
 *
 * Or l'admissibilité se décide sur un plafond en millisecondes. Toute comparaison qui met sa
 * chaîne en balance porte donc la provenance la plus faible de ses entrées, et ce n'est pas une
 * faiblesse à cacher : c'est une phrase à écrire. Nous mesurons l'exactitude de votre chaîne
 * sur vos cas ; son coût et sa latence sont ceux que vous nous donnez.
 */
export type SortiesFournies = {
  /** Le nom que porte sa chaîne dans les tableaux. */
  nom: string;
  /** `valeurs[champ][id du cas]` — ce que sa chaîne a rendu. */
  valeurs: Record<string, Record<string, string>>;
  /** Déclarés par lui, jamais mesurés ici. */
  declares?: { coutParMilleDocuments?: number; msParDocument?: number };
};

/**
 * La provenance d'un chiffre déclaré par le client, dans le vocabulaire existant.
 *
 * `déclaré` n'est pas un mot de ce vocabulaire, et le vocabulaire est copié à l'identique dans
 * cinq dépôts : en ajouter un cinquième terme ici les ferait diverger. Le terme juste existe
 * déjà — `assumed`, « une entrée que personne ici ne peut connaître » — et c'est exactement ce
 * qu'est un coût qu'un client nous donne. Ce que le mot ne dit pas, c'est **qui** l'a posée,
 * alors `declarePar` le dit à côté au lieu d'inventer un rang.
 */
export const PROVENANCE_DES_DECLARES = {
  provenance: "assumed" as const,
  declarePar: "le client" as const,
  pourquoi: "Un chiffre que le client nous donne est une entrée que personne ici ne peut "
    + "vérifier. `assumed` est le rang existant pour ça ; ajouter « déclaré » au vocabulaire "
    + "ferait diverger cinq dépôts qui le copient à l'identique.",
};

/**
 * Comment une durée s'écrit selon d'où elle vient.
 *
 * Une durée mesurée ici et une durée que le client nous a donnée se ressemblent dans un
 * tableau, et c'est exactement le défaut que la provenance existe pour empêcher. Celle du
 * client porte donc sa marque à chaque ligne où elle apparaît, pas seulement dans un en-tête
 * qu'on lit une fois.
 */
export function ecrireMs(ms: number, declaree: boolean): string {
  if (!Number.isFinite(ms)) return "durée non déclarée";
  return declaree ? `${ms.toFixed(0)} ms (déclaré)` : `${ms.toFixed(0)} ms`;
}

export function chargerSorties(chemin: string): SortiesFournies {
  const brut = JSON.parse(readFileSync(chemin, "utf8")) as Partial<SortiesFournies>;
  if (!brut.valeurs || typeof brut.valeurs !== "object") {
    throw new Error(`${chemin} : pas de clé \`valeurs\`. Forme attendue : `
      + `{ "nom": "…", "valeurs": { "<champ>": { "<id du cas>": "<valeur rendue>" } } }`);
  }
  return { nom: brut.nom ?? "votre chaîne", valeurs: brut.valeurs, declares: brut.declares };
}

/**
 * Ce qui ne correspond pas entre son fichier et nos cas — compté et nommé, jamais sauté.
 *
 * Un document présent chez lui et absent chez nous, ou l'inverse, est la façon la plus simple
 * de faire mentir une comparaison sans qu'aucun chiffre n'ait l'air faux : le taux se calcule
 * sur ce qui reste, et ce qui reste s'est choisi tout seul.
 */
export function correspondance(cas: Cas[], champs: string[], s: SortiesFournies) {
  const nos = new Set(cas.map((c) => c.id));
  const manquants: Record<string, string[]> = {};
  const inconnus: Record<string, string[]> = {};
  for (const champ of champs) {
    const siens = s.valeurs[champ] ?? {};
    manquants[champ] = cas.filter((c) => !(c.id in siens)).map((c) => c.id);
    inconnus[champ] = Object.keys(siens).filter((id) => !nos.has(id));
  }
  const total = champs.reduce((a, c) => a + manquants[c]!.length + inconnus[c]!.length, 0);
  return { manquants, inconnus, total, champsSansAucuneValeur: champs.filter((c) => !s.valeurs[c]) };
}

function chargerRegles(chemin: string): Record<string, RegExp> {
  const brut = JSON.parse(readFileSync(chemin, "utf8")) as Record<string, string>;
  return Object.fromEntries(Object.entries(brut).map(([champ, motif]) => [champ, new RegExp(motif)]));
}

/**
 * Le journal des tentatives est **facultatif ici, et éteint par défaut**.
 *
 * Partout ailleurs dans ce dépôt, garder chaque tentative est le bon réflexe : le corpus est
 * synthétique, écrit par nous, et le jeter coûte une passe de GPU. Ici les cas sont ceux du
 * lecteur — des dossiers d'identité réels, potentiellement. Écrire leur texte et les valeurs
 * extraites dans un fichier qu'il n'a pas demandé n'est pas un service qu'on rend, c'est une
 * copie de données personnelles qu'on fabrique à son insu.
 *
 * Donc : `--journal` pour l'activer, et rien sans ça. Le même format, la même valeur — les
 * six requêtes gratuites marchent sur ses cas comme sur les nôtres — mais c'est lui qui
 * décide qu'une deuxième copie existe.
 */
export async function mesurerVosCas(
  cas: Cas[], champs: string[], paliers: TierName[], regles?: Record<string, RegExp>,
  journaliser = false, sorties?: SortiesFournies,
): Promise<Record<string, Record<TierName, { bons: number; sur: number; ms: number }>>> {
  const releve: Record<string, Record<TierName, { bons: number; sur: number; ms: number }>> = {};
  const journal = journaliser ? ouvrirJournal("vos-cas", {
    quoi: "Vos cas, palier par palier — journal demandé explicitement avec --journal.",
    split: "vos-cas", cases: cas.length,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  }) : undefined;
  for (const champ of champs) {
    releve[champ] = {} as Record<TierName, { bons: number; sur: number; ms: number }>;

    /*
     * Le palier du client : ses valeurs, notre correcteur.
     *
     * Aucune durée n'est relevée ici — nous n'avons rien exécuté. Le `ms` qui apparaît vient
     * de sa déclaration, ou vaut `null` s'il n'en a pas donné : mettre zéro le ferait passer
     * pour instantané, ce qui est faux dans la seule direction qui l'avantage.
     */
    if (sorties) {
      const siennes = sorties.valeurs[champ] ?? {};
      let bons = 0, apparies = 0;
      for (const c of cas) {
        if (!(c.id in siennes)) continue;      // absent de son fichier : compté ailleurs, pas ici
        apparies++;
        if (correct(siennes[c.id]!, c.truth[champ]!)) bons++;
      }
      releve[champ]![sorties.nom as TierName] = {
        bons, sur: apparies,
        ms: sorties.declares?.msParDocument ?? Number.NaN,
      };
    }

    if (regles?.[champ]) {
      let bons = 0;
      const t0 = performance.now();
      for (const c of cas) if (correct(c.text.match(regles[champ]!)?.[0] ?? "", c.truth[champ]!)) bons++;
      releve[champ]!["rules" as TierName] = { bons, sur: cas.length, ms: (performance.now() - t0) / cas.length };
    }

    for (const palier of paliers) {
      let bons = 0;
      const durees: number[] = [];
      for (const c of cas) {
        const t0 = performance.now();
        /* `extract` attend un ClientFile et un Field ; les cas du lecteur ont les mêmes deux
           propriétés utiles, et le champ n'est qu'une clé. Le typage local est plus étroit
           que la réalité, d'où la conversion — explicite plutôt que silencieuse. */
        const got = await extract(palier, { id: c.id, text: c.text, truth: c.truth } as never, champ as never);
        const ms = performance.now() - t0;
        durees.push(ms);
        journal?.ligne({
          tier: palier, field: champ, caseId: c.id, phrasing: "reference", split: "vos-cas",
          outcome: issue(got, c.truth[champ]!), ms: Number(ms.toFixed(3)),
          value: got, expected: c.truth[champ]!,
        });
        if (correct(got, c.truth[champ]!)) bons++;
      }
      durees.sort((a, b) => a - b);
      releve[champ]![palier] = { bons, sur: cas.length, ms: durees[Math.floor(durees.length / 2)] ?? 0 };
    }
  }
  journal?.fermer();
  return releve;
}

/**
 * Le mode classification : une étiquette par cas, prise dans un jeu fermé.
 *
 * Il existe parce qu'un jeu public de classification est la façon la plus rapide de se faire
 * contredire — étiquettes de quelqu'un d'autre, messages de quelqu'un d'autre, et aucun des
 * paliers entraîné dessus. Les références triviales comptent double ici : sur soixante-dix-sept
 * classes, deviner au hasard donne 1,3 %, et un chiffre sans sa référence ne veut rien dire.
 */
export async function classerVosCas(
  cas: Cas[], colonne: string, paliers: TierName[],
): Promise<{ etiquettes: string[]; releve: Record<TierName, { bons: number; sur: number; ms: number }>;
             majoritaire: { nom: string; taux: number } }> {
  const etiquettes = [...new Set(cas.map((c) => c.truth[colonne]!))].sort();
  const compte: Record<string, number> = {};
  for (const c of cas) compte[c.truth[colonne]!] = (compte[c.truth[colonne]!] ?? 0) + 1;
  const [nomMaj, nMaj] = Object.entries(compte).sort((a, b) => b[1] - a[1])[0]!;

  const releve = {} as Record<TierName, { bons: number; sur: number; ms: number }>;
  for (const palier of paliers) {
    let bons = 0;
    const durees: number[] = [];
    for (const c of cas) {
      const t0 = performance.now();
      const got = await classerParmi(palier, c.text, etiquettes);
      durees.push(performance.now() - t0);
      if (got === c.truth[colonne]) bons++;
    }
    durees.sort((a, b) => a - b);
    releve[palier] = { bons, sur: cas.length, ms: durees[Math.floor(durees.length / 2)] ?? 0 };
  }
  return { etiquettes, releve, majoritaire: { nom: nomMaj, taux: nMaj / cas.length } };
}

async function principal(): Promise<void> {
  const arg = (nom: string) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
  const fichier = arg("cases");
  if (!fichier) {
    console.log(`
Measure your own cases, not mine.

  npm run measure:yours -- --cases=your-file.csv [--rules=rules.json] [--sorties=vôtres.json] [--llm]

The CSV wants an id, the input text, then one column per field to extract:

  id,text,name,birth
  1,"Anna Petrova — dob 3 May 1990",Anna Petrova,3 May 1990

--rules  a JSON of { "field": "regular expression" }, so your own free tier is measured too.
--sorties  a JSON of what YOUR OWN chain produced: { "nom": "…", "valeurs": { "<field>":
         { "<case id>": "<what your chain returned>" } }, "declares": { "coutParMilleDocuments":
         …, "msParDocument": … } }. Your chain runs on your machine; we never see its code, and
         nothing here executes anything you supply. We score its accuracy against your own
         answers — that is measured. Its cost and latency are the ones you give us: assumed,
         never measured here, and marked so everywhere they travel.
         Without it the routing is over models only, and will overstate what you need to pay.
--llm    add the local generative tiers (needs Ollama and the models pulled).

Nothing leaves your machine: the models are local and this path makes no network call.
`);
    process.exit(fichier ? 0 : 1);
  }
  if (!existsSync(fichier)) { console.error(`no such file: ${fichier}`); process.exit(1); }

  const tache = arg("task") ?? "extract";
  const echantillon = Number(arg("sample") ?? 0);
  let { champs, cas } = lireCsv(readFileSync(fichier, "utf8"));
  if (echantillon > 0 && echantillon < cas.length) {
    /* Tirage déterministe : deux exécutions doivent porter sur les mêmes cas, sinon la
       comparaison entre paliers mesure aussi le hasard du tirage. */
    let e = 20260819;
    const alea = () => ((e = (e * 1_664_525 + 1_013_904_223) >>> 0) / 4_294_967_296);
    const melange = [...cas];
    for (let i = melange.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [melange[i], melange[j]] = [melange[j]!, melange[i]!];
    }
    cas = melange.slice(0, echantillon);
  }
  const regles = arg("rules") ? chargerRegles(arg("rules")!) : undefined;
  const sorties = arg("sorties") ? chargerSorties(arg("sorties")!) : undefined;
  const avecLlm = process.argv.includes("--llm");
  const paliers = [
    ...ENCODEURS.filter((t) => t !== "rules" && t !== "human"),
    ...(avecLlm ? GENERATIFS : []),
  ];

  console.log(`\n${cas.length} cases, ${champs.length} field(s): ${champs.join(", ")}`);
  if (cas.length < 20) {
    console.log(`\n⚠ ${cas.length} cases is below the point where a rate says anything. `
      + `The intervals below will be wider than the differences you are trying to see.`);
  }
  if (avecLlm) await loadGeneratifs();

  if (tache === "classify") {
    await loadClassifiers();
    const colonne = champs[0]!;
    const { etiquettes, releve, majoritaire } = await classerVosCas(cas, colonne, paliers);
    console.log(`\n${etiquettes.length} labels. Trivial baselines first, because a percentage`);
    console.log(`without one says nothing:\n`);
    console.log(`  always "${majoritaire.nom}"   ${(100 * majoritaire.taux).toFixed(1)} %`);
    console.log(`  uniform guess          ${(100 / etiquettes.length).toFixed(1)} %\n`);
    const rangs = Object.entries(releve)
      .map(([palier, r]) => ({ palier, r: rate(r.bons, r.sur), ms: r.ms }))
      .sort((a, b) => b.r.rate - a.r.rate);
    for (const x of rangs) {
      const bat = x.r.low > majoritaire.taux ? "beats the majority baseline"
        : x.r.high < majoritaire.taux ? "WORSE than always guessing the commonest label"
        : "indistinguishable from the majority baseline";
      console.log(`  ${x.palier.padEnd(10)} ${writeRate(x.r).padEnd(28)} `
        + `${ecrireMs(x.ms, x.palier === sorties?.nom).padEnd(20)} ${bat}`);
    }
    console.log("");
    /*
     * On ne force pas la sortie.
     *
     * `process.exit(0)` coupait le processus pendant que le runtime des modèles avait encore
     * des fils natifs en vol : le résultat s'affichait, puis l'abandon, et un code 134 sur une
     * exécution parfaitement réussie. Une intégration continue y aurait lu un échec.
     */
    return;
  }

  await loadExtractors();
  /*
   * Ce qui ne correspond pas, dit avant les taux et non après.
   *
   * Un identifiant présent d'un côté et pas de l'autre fait un taux calculé sur ce qui reste,
   * et ce qui reste s'est choisi tout seul. Annoncé ici, avant le tableau, pour qu'on ne le
   * lise pas comme une note.
   */
  if (sorties) {
    const corr = correspondance(cas, champs, sorties);
    console.log(`\nVotre chaîne : « ${sorties.nom} ».`);
    console.log(`  exactitude : mesurée ici, sur vos réponses de référence.`);
    console.log(`  coût et latence : ${sorties.declares ? "déclarés par vous" : "non déclarés"}`
      + ` — ${PROVENANCE_DES_DECLARES.provenance}, jamais mesurés ici.`);
    if (corr.champsSansAucuneValeur.length) {
      console.log(`  ⚠ aucun résultat fourni pour : ${corr.champsSansAucuneValeur.join(", ")}`);
    }
    if (corr.total > 0) {
      console.log(`  ⚠ ${corr.total} identifiant(s) sans correspondance — le taux ci-dessous ne porte`
        + ` que sur les cas appariés :`);
      for (const champ of champs) {
        const m = corr.manquants[champ]!.length, i = corr.inconnus[champ]!.length;
        if (m || i) {
          console.log(`      ${champ.padEnd(14)} ${m} de nos cas absents de votre fichier`
            + `${m ? ` (${corr.manquants[champ]!.slice(0, 3).join(", ")}${m > 3 ? "…" : ""})` : ""}`
            + `, ${i} des vôtres inconnus de nous`
            + `${i ? ` (${corr.inconnus[champ]!.slice(0, 3).join(", ")}${i > 3 ? "…" : ""})` : ""}`);
        }
      }
    } else {
      console.log(`  tous les identifiants correspondent.`);
    }
  }

  const releve = await mesurerVosCas(cas, champs, paliers, regles,
    process.argv.includes("--journal"), sorties);

  console.log("\nACCURACY PER FIELD, with the interval at "
    + `${(CONFIANCE.niveau * 100).toFixed(0)} %\n`);
  for (const champ of champs) {
    const rangs = Object.entries(releve[champ]!)
      .map(([palier, r]) => ({ palier, r: rate(r.bons, r.sur), ms: r.ms }))
      .sort((a, b) => b.r.rate - a.r.rate);
    console.log(`  ${champ}`);
    for (const x of rangs) {
      console.log(`    ${x.palier.padEnd(10)} ${writeRate(x.r).padEnd(28)} `
        + `${ecrireMs(x.ms, x.palier === sorties?.nom)}`);
    }
    /*
     * La phrase qui compte — et le refus de la prononcer sans échantillon.
     *
     * En dessous du seuil, *rien* n'est distinguable de rien : la règle « prends le moins
     * cher parmi les équivalents » recommanderait alors toujours le plus rapide, sur zéro
     * preuve, avec l'aplomb d'un conseil. C'est le piège exact que cet outil dénonce chez
     * les autres, et il y est tombé à sa première exécution sur trois cas.
     */
    const tete = rangs[0]!;
    if (!tete.r.reportable) {
      console.log(`    → no recommendation: ${tete.r.n} cases cannot separate any of these. `
        + `Bring at least ${ENOUGH}.\n`);
      continue;
    }
    const equivalents = rangs.filter((x) => !distinguishable(x.r, tete.r));
    const retenu = equivalents.reduce((a, b) => (b.ms < a.ms ? b : a));
    console.log(retenu.palier === tete.palier
      ? `    → ${tete.palier} wins outright on this sample.\n`
      : `    → ${retenu.palier} is not measurably worse than ${tete.palier} and is `
        + `${(tete.ms / Math.max(retenu.ms, 0.01)).toFixed(0)}× faster. Take the cheaper one.\n`);
  }

  const sortie = fichier.replace(/\.csv$/i, "") + "-measured.md";
  writeFileSync(sortie, table(["Field", "Tier", "Accuracy", "Interval", "n", "Median ms"],
    champs.flatMap((champ) => Object.entries(releve[champ]!).map(([palier, r]) => {
      const q = rate(r.bons, r.sur);
      return [champ, palier, (q.rate * 100).toFixed(1) + " %",
        `[${(q.low * 100).toFixed(0)}–${(q.high * 100).toFixed(0)}]`, q.n,
        ecrireMs(r.ms, palier === sorties?.nom)];
    }))) + "\n");
  console.log(`Written to ${sortie}\n`);
  if (!regles) {
    console.log("No --rules given, so no free tier was measured. On my own corpus free regexes");
    console.log("carried three fields of five — a routing without them overstates what you pay.\n");
  }
  if (avecLlm) {
    console.log("Generative tiers measured: "
      + Object.entries(MODELES_LOCAUX).map(([k, v]) => `${k}=${v.tag}`).join(", ") + "\n");
  }
}

if (isMain(import.meta)) await principal();
