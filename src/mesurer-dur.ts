/**
 * La passe sur les cas durs.
 *
 * Les chiffres publiés viennent de cent vingt documents synthétiques et propres. Ceux-ci sont
 * les documents cassés : coupés en plein milieu d'une valeur, écrits en grec, en arabe, en
 * japonais, ou porteurs de deux lectures également défendables. L'exactitude va **baisser**,
 * c'est attendu et c'est l'objet — un chiffre qui ne tombe pas sur des documents cassés ne
 * mesure rien.
 *
 * La notation est déclarée dans NOTATION-CAS-DURS.md et committée avant cette passe. Elle
 * tient en une phrase, et tout taux sorti d'ici la porte : **juste = toute lecture défendable
 * déclarée avant mesure**. Pour vingt et un champs sur cent cinquante, la lecture déclarée est
 * le silence, et c'est un blanc qui est juste.
 *
 *     npm run dur                 les trente cas tabulaires et les cas ambigus
 *     npm run dur -- --tiers=…    un sous-ensemble de paliers
 */

import { writeFileSync, readFileSync, writeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { CHARGE_MAX_PAR_COEUR } from "./measure.ts";
import { isMain } from "./cli.ts";
import { FIELDS } from "./corpus.ts";
import { ouvrirJournal } from "./journal.ts";
import { loadExtractors, loadGeneratifs, extract, TIERS } from "./tiers.ts";
import { corpusDur, lireFichier, noterDur, REGLE_DE_NOTATION } from "./corpus-dur.ts";

import type { Attendu, CasDur } from "./corpus-dur.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const CLE_AMBIGUS = fileURLToPath(new URL("../cas-ambigus.json", import.meta.url));
const SORTIE = fileURLToPath(new URL("../dur.json", import.meta.url));

/** Les cas ambigus : leur document vient de la prose, leurs lectures de la clé. */
export function casAmbigus(): CasDur[] {
  const cle = JSON.parse(readFileSync(CLE_AMBIGUS, "utf8")) as {
    cases: { id: string; field: Field; readings: string[]; silenceAccepted: boolean; ambiguousHere: boolean }[] };
  const textes = new Map(lireFichier("cas-ambigus.md").map((c) => [c.id, c]));
  return cle.cases.map((c) => {
    const t = textes.get(c.id);
    if (!t) throw new Error(`case ${c.id} has no document in the prose.`);
    /* Un seul champ par cas ambigu : les quatre autres ne sont pas déclarés, donc pas notés. */
    return { id: c.id, cle: `cas-ambigus#${c.id}`, titre: t.titre, source: "cas-ambigus.md", texte: t.texte,
      attendus: { [c.field]: { lectures: c.readings, silence: false,
        ...(c.silenceAccepted ? { silenceAussi: true } : {}) } as Attendu & { silenceAussi?: boolean } } };
  });
}

/*
 * UN REFUS CORRECT QUI SORT PAR UN ABANDON NATIF N'EST PAS UN REFUS.
 *
 * `npm run dur` est mort après neuf minutes de travail sur ceci :
 *
 *     Error: qwen3:4b n'a pas répondu en 30 s. Le serveur est bloqué…
 *     libc++abi: terminating due to uncaught exception … mutex lock failed
 *
 * Le message était juste. Ce qui s'affichait ensuite ne l'était pas : le runtime natif des
 * encodeurs tient des ressources dans ce processus, et une exception non capturée le fait
 * abandonner pendant sa destruction — SIGABRT, code 134, trace de pile C++ par-dessus le
 * message. Une session voisine a mesuré le même 134 ailleurs et l'a d'abord attribué à
 * l'enveloppe npm ; ce n'était pas npm, `npm run` transmet les codes à l'identique. C'était
 * ceci, et le même défaut explique les deux observations.
 *
 * Un utilisateur voit donc un plantage là où l'outil avait quelque chose de précis à dire, et
 * il cherche du côté de son installation plutôt que du modèle qui charge.
 */
if (isMain(import.meta)) {
  try {
  const demandes = process.argv.find((a) => a.startsWith("--tiers="))?.split("=")[1]?.split(",");
  /*
   * LE `as TierName[]` NE VÉRIFIE RIEN — C'EST UNE AFFIRMATION, PAS UN CONTRÔLE.
   *
   * `--tiers=gen8b` (le tiret oublié) traversait : le cast tait la question, et `extract()`
   * envoyait tout palier inconnu vers le grand encodeur. `dur.json` publiait alors un palier
   * INVENTÉ portant les chiffres de `large` — cohérent, plausible, et impossible à rapprocher
   * de quoi que ce soit.
   *
   * La liste des paliers valides se DEMANDE à `TIERS`, elle ne se récite pas ici.
   */
  const inconnus = (demandes ?? []).filter((t) => !(TIERS as readonly string[]).includes(t));
  if (inconnus.length > 0) {
    console.error(`\n  unknown tier(s): ${inconnus.join(", ")}`);
    console.error(`  known tiers: ${TIERS.join(", ")}`);
    console.error("\n  A tier that does not exist used to reach the large encoder, and its figures");
    console.error("  were published under the made-up name.\n");
    process.exit(1);
  }
  const paliers = (demandes ?? TIERS.filter((t) => t !== "human")) as TierName[];

  const version = (() => {
    try {
      const cwd = fileURLToPath(new URL("..", import.meta.url));
      return {
        commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim(),
        sale: execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0,
      };
    } catch { return undefined; }
  })();
  if (version?.sale) { console.error("\nModified tree: the scoring must be committed before the measurement.\n"); process.exit(1); }

  const tabulaires = corpusDur();
  const ambigus = casAmbigus();
  const tous = [...tabulaires, ...ambigus];
  const tentatives = tous.reduce((n, c) => n + Object.keys(c.attendus).length, 0);

  console.log(`\n${tous.length} cases (${tabulaires.length} tabular, ${ambigus.length} ambiguous), `
    + `${tentatives} declared fields, ${paliers.length} tiers.`);
  console.log(`Scoring: ${REGLE_DE_NOTATION}`);
  /*
   * MESURER SUR UNE MACHINE SATURÉE MESURE LA MACHINE.
   *
   * Cette passe ANNONÇAIT la charge et démarrait quand même, alors que `measure.ts` — qui fait
   * le même genre de travail dans le même dépôt — refuse de chronométrer au-delà de
   * `CHARGE_MAX_PAR_COEUR`. Une garde présente dans un fichier et absente de son voisin : c'est
   * la forme interne de « la garde ne voyage pas », et elle s'est payée deux fois ce soir.
   *
   * Elle ne s'est pas payée en durées faussées — cette passe n'en publie pas — mais en PASSES
   * MORTES. À une charge de 26,81 sur dix cœurs, une génération qui prend 2,5 s au repos
   * dépasse les trente secondes du délai, et la passe s'arrête après neuf minutes de travail
   * en annonçant que le serveur est bloqué. Il ne l'était pas : le modèle était résident, avec
   * vingt-six minutes devant lui. C'est la machine qui était pleine, et c'est moi qui l'avais
   * remplie en faisant travailler quatre sessions en parallèle.
   *
   * Le refus porte donc sur le TEMPS PERDU, pas sur la justesse : l'exactitude est
   * déterministe et resterait vraie. Mais dépenser vingt minutes pour un abandon est un coût
   * réel, et le seul moment où on peut l'éviter est avant de partir.
   */
  const chargeParCoeur = loadavg()[0]! / cpus().length;
  const malgreCharge = process.argv.find((a) => a.startsWith("--allow-load="))?.split("=")[1];
  console.log(`Load before starting: ${loadavg()[0]!.toFixed(2)} on ${cpus().length} cores.\n`);
  if (chargeParCoeur > CHARGE_MAX_PAR_COEUR && malgreCharge === undefined) {
    console.error(
      `Load of ${(100 * chargeParCoeur).toFixed(0)} % per core, threshold `
      + `${(100 * CHARGE_MAX_PAR_COEUR).toFixed(0)} %. This pass takes about twenty minutes `
      + `and the generative calls have a thirty-second timeout: under this load they exceed\n`
      + `  it, and the pass dies after working for nothing.\n\n`
      + `  Wait for the machine to go quiet, or force it by saying WHY and with what:\n`
      + `  npm run dur -- --allow-load="what else is running"\n`
      + `  La raison est écrite dans le relevé, pour que personne n'ait à la deviner plus tard.`);
    process.exit(1);
  }
  await loadExtractors();
  if (paliers.some((t) => t.startsWith("gen-"))) await loadGeneratifs();

  const journal = ouvrirJournal("dur", {
    quoi: "Cas durs : documents malformés, écritures non latines, cas ambigus.",
    split: "hard-corpus", cases: tous.length,
    commit: version?.commit, sale: version?.sale,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });

  const par = {} as Record<TierName, { clean: number; blank: number; wrong: number;
    overRefusal: number; overAnswer: number; parSource: Record<string, { clean: number; total: number }> }>;
  /* Le taux par document, tenu à côté du taux par champ — c'est lui que le client consomme. */
  const entiers = new Map<TierName, Set<string>>();
  const completsAttendus = tous.filter((c) => Object.keys(c.attendus).length === FIELDS.length).length;

  for (const t of paliers) {
    par[t] = { clean: 0, blank: 0, wrong: 0, overRefusal: 0, overAnswer: 0, parSource: {} };
    const propres = new Set<string>(); const sales = new Set<string>();
    entiers.set(t, propres);
    for (const c of tous) {
      for (const [champ, attendu] of Object.entries(c.attendus) as [Field, Attendu & { silenceAussi?: boolean }][]) {
        const t0 = performance.now();
        const got = await extract(t, { id: c.cle, text: c.texte, truth: {} as never }, champ);
        const ms = performance.now() - t0;
        let note = noterDur(got, attendu);
        /* Certains cas ambigus acceptent aussi le silence : un blanc y est une lecture. */
        if (attendu.silenceAussi && note.outcome === "blank") {
          note = { outcome: "clean", overRefusal: false, overAnswer: false, readingChosen: "(silence)" };
        }
        par[t][note.outcome]++;
        if (note.overRefusal) par[t].overRefusal++;
        if (note.overAnswer) par[t].overAnswer++;
        if (Object.keys(c.attendus).length === FIELDS.length) {
          if (note.outcome === "clean") { if (!sales.has(c.cle)) propres.add(c.cle); }
          else { sales.add(c.cle); propres.delete(c.cle); }
        }
        const s = par[t].parSource[c.source] ?? { clean: 0, total: 0 };
        s.total++; if (note.outcome === "clean") s.clean++;
        par[t].parSource[c.source] = s;
        journal.ligne({
          tier: t, field: champ, caseId: c.cle, phrasing: "reference", split: "hard-corpus",
          outcome: note.outcome, ms: Number(ms.toFixed(3)),
          value: got, expected: attendu.silence ? "(silence)" : attendu.lectures.join(" | "),
        });
      }
    }
    const n = par[t].clean + par[t].blank + par[t].wrong;
    const d = entiers.get(t)!;
    console.log(`  ${t.padEnd(10)} fields ${(100 * par[t].clean / n).toFixed(1).padStart(5)} %`
      + `   whole files ${String(d.size).padStart(2)}/${completsAttendus}`
      + `   over-refusal ${String(par[t].overRefusal).padStart(3)}   over-answer ${String(par[t].overAnswer).padStart(3)}`);
  }

  /*
   * Le plafond d'un routage par document, et il est bas.
   *
   * L'oracle — le meilleur des six paliers pour CHAQUE document, choisi après coup, donc
   * irréalisable — rend un certain nombre de dossiers entiers. Le meilleur palier seul en rend
   * un autre. L'écart entre les deux est TOUT ce qu'un routage par document peut rapporter
   * ici, quelle que soit l'ingéniosité du routeur, et il se mesure avant d'écrire la moindre
   * ligne. Sur ce corpus il est petit : les paliers se trompent largement sur les mêmes
   * documents, et les points d'exactitude qui les séparent se dispersent sur des champs qui ne
   * suffisent pas à sauver un dossier de plus.
   *
   * CE COMMENTAIRE NE CITE PLUS SES CHIFFRES, ET C'EST DÉLIBÉRÉ. Il en citait trois — « douze
   * dossiers chacun, dont onze les mêmes », « un sur quarante-quatre », « l'oracle en rend
   * quinze, trois de plus ». Les trois étaient faux au 23 août 2026 : la mesure rend 2 contre
   * 1 sur 30. Ils n'étaient pas faux à l'écriture ; le corpus et les paliers ont bougé, et
   * personne ne relit un commentaire pour y répercuter une remesure.
   *
   * Les chiffres exacts vivent dans `dur.json`, sous `plafondDuRoutageParDocument`, et la
   * sortie console les imprime à chaque passe. Un commentaire porte le RAISONNEMENT, qui ne
   * rouille pas ; les nombres appartiennent au relevé, qui se refait.
   */
  const oracle = new Set([...entiers.values()].flatMap((s) => [...s]));

  /*
   * ET ON L'IMPRIME, parce que le commentaire ci-dessus renvoie ici.
   *
   * En retirant les chiffres périmés du commentaire, j'ai écrit que « la sortie console les
   * imprime à chaque passe ». C'était faux : rien ne les imprimait. La phrase qui corrigeait
   * une affirmation fausse en introduisait une autre, dans le même geste.
   *
   * Affaiblir la phrase aurait été le réflexe. La rendre vraie coûte trois lignes, et ce
   * chiffre est le plus décisif de la passe : il borne tout ce qu'un routeur peut rapporter,
   * avant qu'on en écrive un.
   */
  const meilleurSeul = Math.max(...[...entiers.values()].map((s) => s.size));
  console.log(`\nCeiling for per-document routing: the oracle returns ${oracle.size} whole file(s) `
    + `out of ${completsAttendus}, the best single tier ${meilleurSeul}.`);
  console.log(`  Any per-document router is bounded by that gap of ${oracle.size - meilleurSeul}, `
    + `and the oracle chooses after the fact: it is not achievable.\n`);

  const j = journal.fermer();
  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Exactitude sur les cas durs — documents cassés, écritures non latines, cas ambigus.",
    scoringRule: REGLE_DE_NOTATION,
    scoringRuleDeclaredIn: "NOTATION-CAS-DURS.md, committed before this pass",
    decoupage: "hard-corpus", cas: tous.length, champs: tentatives,
    mesureLe: new Date().toISOString(), code: version,
    charge: { externalBefore: Number(loadavg()[0]!.toFixed(2)), coeurs: cpus().length },
    journal: j.chemin.split("/").slice(-2).join("/"),
    paliers: par,
    parDocument: Object.fromEntries([...entiers].map(([t, s]) => [t, {
      entiers: s.size, sur: completsAttendus,
      tauxDocument: Number((s.size / completsAttendus).toFixed(4)),
      lesquels: [...s].sort(),
    }])),
    plafondDuRoutageParDocument: {
      oracle: oracle.size, sur: completsAttendus,
      meilleurPalierSeul: Math.max(...[...entiers.values()].map((s) => s.size)),
      gainDeLOracle: oracle.size - Math.max(...[...entiers.values()].map((s) => s.size)),
      quoi: "L'oracle choisit après coup le meilleur palier pour chaque document. Il est "
        + "irréalisable et donne le plafond de ce qu'un routage par document peut rapporter. "
        + "Le mesurer coûte une requête ; l'écrire coûterait un routeur.",
    },
    limite: "Aucun taux d'ici ne se compare à un taux du corpus propre : ce ne sont pas les mêmes "
      + "documents ni la même règle de notation. La baisse est attendue et voulue.",
  }, null, 2) + "\n");
  console.log(`\n${j.lignes} attempts recorded. Written to ${SORTIE.split("/").pop()}\n`);
  } catch (e) {
    /*
     * ÉCRIRE EN SYNCHRONE, PUIS SORTIR SANS RENDRE LA MAIN.
     *
     * `console.error` suivi de `process.exit(1)` laissait encore sortir un code 134 : le
     * runtime natif des encodeurs abandonne dans son propre fil pendant qu'on écrit, et son
     * SIGABRT gagne la course. Un appelant lit alors 134 — « le processus a planté » — pour un
     * refus parfaitement propre, et une chaîne d'intégration le classe en incident.
     *
     * `writeSync` sur le descripteur 2 ne repasse pas par la boucle d'événements, donc il n'y
     * a plus d'intervalle où l'autre fil puisse tomber avant la sortie.
     */
    writeSync(2, `\n${e instanceof Error ? e.message : String(e)}\n\n`);
    process.exit(1);
  }
}
