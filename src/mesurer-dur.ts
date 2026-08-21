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

import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { isMain } from "./cli.ts";
import { ouvrirJournal } from "./journal.ts";
import { loadExtractors, loadGeneratifs, extract, TIERS } from "./tiers.ts";
import { corpusDur, lireFichier, noterDur, REGLE_DE_NOTATION } from "./corpus-dur.ts";

import type { Attendu, CasDur } from "./corpus-dur.ts";
import type { TierName } from "./paliers.ts";
import type { Field } from "./corpus.ts";

const CLE_AMBIGUS = new URL("../cas-ambigus.json", import.meta.url).pathname;
const SORTIE = new URL("../dur.json", import.meta.url).pathname;

/** Les cas ambigus : leur document vient de la prose, leurs lectures de la clé. */
export function casAmbigus(): CasDur[] {
  const cle = JSON.parse(readFileSync(CLE_AMBIGUS, "utf8")) as {
    cases: { id: string; field: Field; readings: string[]; silenceAccepted: boolean; ambiguousHere: boolean }[] };
  const textes = new Map(lireFichier("cas-ambigus.md").map((c) => [c.id, c]));
  return cle.cases.map((c) => {
    const t = textes.get(c.id);
    if (!t) throw new Error(`le cas ${c.id} n'a pas de document dans la prose.`);
    /* Un seul champ par cas ambigu : les quatre autres ne sont pas déclarés, donc pas notés. */
    return { id: c.id, titre: t.titre, source: "cas-ambigus.md", texte: t.texte,
      attendus: { [c.field]: { lectures: c.readings, silence: false,
        ...(c.silenceAccepted ? { silenceAussi: true } : {}) } as Attendu & { silenceAussi?: boolean } } };
  });
}

if (isMain(import.meta)) {
  const demandes = process.argv.find((a) => a.startsWith("--tiers="))?.split("=")[1]?.split(",");
  const paliers = (demandes ?? TIERS.filter((t) => t !== "human")) as TierName[];

  const version = (() => {
    try {
      const cwd = new URL("..", import.meta.url).pathname;
      return {
        commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim(),
        sale: execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0,
      };
    } catch { return undefined; }
  })();
  if (version?.sale) { console.error("\nArbre modifié : la notation doit être committée avant la mesure.\n"); process.exit(1); }

  const tabulaires = corpusDur();
  const ambigus = casAmbigus();
  const tous = [...tabulaires, ...ambigus];
  const tentatives = tous.reduce((n, c) => n + Object.keys(c.attendus).length, 0);

  console.log(`\n${tous.length} cas (${tabulaires.length} tabulaires, ${ambigus.length} ambigus), `
    + `${tentatives} champs déclarés, ${paliers.length} paliers.`);
  console.log(`Notation : ${REGLE_DE_NOTATION}`);
  console.log(`Charge avant départ : ${loadavg()[0]!.toFixed(2)} sur ${cpus().length} cœurs.\n`);
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

  for (const t of paliers) {
    par[t] = { clean: 0, blank: 0, wrong: 0, overRefusal: 0, overAnswer: 0, parSource: {} };
    for (const c of tous) {
      for (const [champ, attendu] of Object.entries(c.attendus) as [Field, Attendu & { silenceAussi?: boolean }][]) {
        const t0 = performance.now();
        const got = await extract(t, { id: c.id, text: c.texte, truth: {} as never }, champ);
        const ms = performance.now() - t0;
        let note = noterDur(got, attendu);
        /* Certains cas ambigus acceptent aussi le silence : un blanc y est une lecture. */
        if (attendu.silenceAussi && note.outcome === "blank") {
          note = { outcome: "clean", overRefusal: false, overAnswer: false, readingChosen: "(silence)" };
        }
        par[t][note.outcome]++;
        if (note.overRefusal) par[t].overRefusal++;
        if (note.overAnswer) par[t].overAnswer++;
        const s = par[t].parSource[c.source] ?? { clean: 0, total: 0 };
        s.total++; if (note.outcome === "clean") s.clean++;
        par[t].parSource[c.source] = s;
        journal.ligne({
          tier: t, field: champ, caseId: c.id, phrasing: "reference", split: "hard-corpus",
          outcome: note.outcome, ms: Number(ms.toFixed(3)),
          value: got, expected: attendu.silence ? "(silence)" : attendu.lectures.join(" | "),
        });
      }
    }
    const n = par[t].clean + par[t].blank + par[t].wrong;
    console.log(`  ${t.padEnd(10)} juste ${(100 * par[t].clean / n).toFixed(1).padStart(5)} %`
      + `   sur-refus ${String(par[t].overRefusal).padStart(3)}   sur-réponse ${String(par[t].overAnswer).padStart(3)}   (${n} champs)`);
  }

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
    limite: "Aucun taux d'ici ne se compare à un taux du corpus propre : ce ne sont pas les mêmes "
      + "documents ni la même règle de notation. La baisse est attendue et voulue.",
  }, null, 2) + "\n");
  console.log(`\n${j.lignes} tentatives enregistrées. Écrit dans ${SORTIE.split("/").pop()}\n`);
}
