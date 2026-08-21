/**
 * Garder les issues, pas les taux.
 *
 * Trois passes se sont terminées de la même façon aujourd'hui : la question suivante demandait
 * les résultats cas par cas, la passe n'avait gardé que des moyennes, et la machine a repayé.
 * Quarante minutes de GPU, trois fois, pour retrouver ce qui était en mémoire et qu'on a jeté.
 * Ce n'est pas un problème de vitesse, c'est un problème de format d'écriture.
 *
 * Une ligne par tentative. Rien n'est agrégé à l'écriture — agréger est une requête, et une
 * requête se refait ; une passe ne se refait pas sans machine.
 *
 * Trois choses que ce fichier tient et qu'un taux ne tient pas :
 *
 *   — `outcome` a **trois** valeurs. Un blanc et une valeur fausse sont deux produits
 *     différents : l'un se voit et se rattrape, l'autre entre dans le dossier sans bruit.
 *     Les confondre à l'écriture détruit la distinction sur laquelle la méthode repose, et
 *     aucun agrégat ne la restitue.
 *   — `phrasing` est **toujours** écrit, référence comprise. Ne l'écrire que quand il diffère
 *     rend « mesuré sous la référence » et « personne ne l'a noté » indiscernables.
 *   — `value` et `expected` sont gardés, donc changer de correcteur est un recalcul et non une
 *     remesure. Le balayage de sévérité du correcteur devient gratuit.
 *
 * Les lignes sont écrites **au fil de la passe**. Une passe qui meurt à la trente-huitième
 * minute doit laisser trente-huit minutes de lignes exploitables ; aujourd'hui elle ne laisse
 * rien. Les conditions sont écrites une fois, en tête — une ligne sans sa passe n'est pas
 * reproductible, une passe qui répète ses conditions à chaque ligne est illisible.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { platform, arch, cpus, loadavg } from "node:os";
import { join } from "node:path";
import { normaliserReponse, correct } from "./tiers.ts";
import { pairedVerdict } from "./interval.ts";

export const DOSSIER = new URL("../data/tentatives", import.meta.url).pathname;

/** `clean` quand la réponse est juste, `blank` quand il n'y en a pas, `wrong` quand elle est fausse. */
export type Issue = "clean" | "blank" | "wrong";

export type Tentative = {
  run: string; tier: string; field: string; caseId: string;
  chain?: string;   // "extraction" ou "classification" — measure.ts fait les deux
  phrasing: string; split: string; outcome: Issue; ms: number;
  value: string; expected: string;
};

export type Conditions = {
  quoi: string; split: string; cases: number;
  commit?: string; sale?: boolean;
  coeurs: number; chargeAvant: number; plateforme: string;
  demarreLe: string;
};

/**
 * L'issue d'une tentative, en trois valeurs.
 *
 * `clean` est exactement `correct()` : les taux déjà publiés se relisent sans changer d'un
 * millième. `blank` et `wrong` ne font que partager les échecs — ce qui était un seul chiffre.
 *
 * Cette partition suppose qu'aucune vérité de terrain n'est vide : si elle l'était, un modèle
 * qui répond correctement « rien » serait compté `blank`, donc en échec. Le corpus actuel n'a
 * aucun champ vide sur 3 000, et un test tient cette hypothèse au cas où le corpus change.
 */
export function issue(got: string, expected: string): Issue {
  if (correct(got, expected)) return "clean";
  return normaliserReponse(got).length === 0 ? "blank" : "wrong";
}

/** Ouvre un journal et rend de quoi y écrire ligne à ligne. */
export function ouvrirJournal(nom: string, conditions: Omit<Conditions, "plateforme" | "coeurs" | "demarreLe">) {
  const run = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nom}`;
  mkdirSync(DOSSIER, { recursive: true });
  const chemin = join(DOSSIER, `${run}.jsonl`);
  const entete: Conditions & { kind: "run"; run: string } = {
    kind: "run", run, ...conditions,
    coeurs: cpus().length, plateforme: `${platform()}-${arch()}`,
    demarreLe: new Date().toISOString(),
  };
  appendFileSync(chemin, JSON.stringify(entete) + "\n");

  let lignes = 0;
  return {
    run, chemin,
    /* appendFileSync et non un flux : un flux tamponne, et une passe tuée perdrait son tampon. */
    ligne(t: Omit<Tentative, "run">) {
      appendFileSync(chemin, JSON.stringify({ kind: "t", run, ...t }) + "\n");
      lignes++;
    },
    /* Pas de pied de page si la passe meurt — et cette absence dit qu'elle est incomplète. */
    fermer() {
      appendFileSync(chemin, JSON.stringify({
        kind: "fin", run, lignes, termineLe: new Date().toISOString(),
        chargeApres: Number(loadavg()[0]!.toFixed(2)),
      }) + "\n");
      return { lignes, chemin };
    },
  };
}

/**
 * Relit un journal, y compris tronqué.
 *
 * Une passe tuée laisse une dernière ligne incomplète : elle est ignorée, et tout ce qui
 * précède est rendu. C'est la raison d'être du format — refuser de lire un fichier parce que
 * sa dernière ligne est coupée reviendrait à jeter les trente-huit minutes qu'il contient.
 */
export function lireJournal(chemin: string) {
  const brut = readFileSync(chemin, "utf8").split("\n").filter((l) => l.trim().length > 0);
  let conditions: (Conditions & { run: string }) | undefined;
  let complet = false;
  const tentatives: Tentative[] = [];
  let tronquees = 0;
  for (const l of brut) {
    let o: { kind?: string } & Record<string, unknown>;
    try { o = JSON.parse(l); } catch { tronquees++; continue; }
    if (o.kind === "run") conditions = o as never;
    else if (o.kind === "fin") complet = true;
    else if (o.kind === "t") tentatives.push(o as never);
  }
  return { conditions, tentatives, complet, tronquees };
}

export function journaux(): string[] {
  if (!existsSync(DOSSIER)) return [];
  return readdirSync(DOSSIER).filter((n) => n.endsWith(".jsonl")).sort().map((n) => join(DOSSIER, n));
}

/* ---- Ce que les lignes rendent gratuit. Des requêtes, plus des mesures. ---- */

const cle = (t: Tentative) => `${t.field}|${t.caseId}`;

/** McNemar entre deux conditions quelconques, sur les cas qu'elles ont réellement en commun. */
export function apparie(
  tentatives: readonly Tentative[],
  a: { tier: string; phrasing?: string },
  b: { tier: string; phrasing?: string },
) {
  const prendre = (s: { tier: string; phrasing?: string }) => {
    const m = new Map<string, Tentative>();
    for (const t of tentatives) {
      if (t.tier !== s.tier) continue;
      if (s.phrasing !== undefined && t.phrasing !== s.phrasing) continue;
      m.set(cle(t), t);
    }
    return m;
  };
  const A = prendre(a), B = prendre(b);
  let gains = 0, regressions = 0, communs = 0;
  for (const [k, ta] of A) {
    const tb = B.get(k);
    if (!tb) continue;
    communs++;
    const x = ta.outcome === "clean", y = tb.outcome === "clean";
    if (x && !y) gains++; else if (y && !x) regressions++;
  }
  return { communs, gains, regressions, ...pairedVerdict(gains, regressions) };
}

/**
 * Le taux de dossiers entièrement propres — impossible à tirer de taux par champ.
 *
 * La moyenne de cinq taux par champ n'est pas le taux auquel un dossier passe : cinq champs à
 * 95 % donnent entre 75 % et 95 % de dossiers propres selon que les erreurs se groupent ou
 * non, et rien dans les moyennes ne dit laquelle. C'est l'acheteur qui voit ce chiffre-là.
 */
export function parDocument(tentatives: readonly Tentative[], s: { tier: string; phrasing?: string }) {
  const docs = new Map<string, Tentative[]>();
  for (const t of tentatives) {
    if (t.tier !== s.tier) continue;
    if (s.phrasing !== undefined && t.phrasing !== s.phrasing) continue;
    (docs.get(t.caseId) ?? docs.set(t.caseId, []).get(t.caseId)!).push(t);
  }
  let propres = 0;
  for (const [, champs] of docs) if (champs.every((t) => t.outcome === "clean")) propres++;
  const parChamp = [...docs.values()].flat();
  return {
    documents: docs.size, propres,
    tauxDocument: docs.size ? propres / docs.size : null,
    tauxChamp: parChamp.length ? parChamp.filter((t) => t.outcome === "clean").length / parChamp.length : null,
  };
}

/** La répartition des trois issues — la distinction qu'un booléen efface. */
export function issues(tentatives: readonly Tentative[], s?: { tier?: string; phrasing?: string; field?: string }) {
  const c = { clean: 0, blank: 0, wrong: 0 };
  for (const t of tentatives) {
    if (s?.tier !== undefined && t.tier !== s.tier) continue;
    if (s?.phrasing !== undefined && t.phrasing !== s.phrasing) continue;
    if (s?.field !== undefined && t.field !== s.field) continue;
    c[t.outcome]++;
  }
  return { ...c, total: c.clean + c.blank + c.wrong };
}
