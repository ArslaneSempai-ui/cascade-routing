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

import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { platform, arch, cpus, loadavg } from "node:os";
import { join } from "node:path";
import { normaliserReponse, correct } from "./tiers.ts";
import { pairedVerdict } from "./interval.ts";
import { fileURLToPath } from "node:url";

export const DOSSIER = fileURLToPath(new URL("../data/tentatives", import.meta.url));

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
  /*
   * Quelle machine. Sans ça, « ne mélange jamais les deux séries de latence » repose sur la
   * mémoire de celui qui écrit la requête, et une seconde machine vient d'apparaître.
   * `plateforme` ne suffit pas : deux Mac Apple Silicon rendent tous les deux `darwin-arm64`.
   * Le modèle de processeur les sépare et ne désigne personne — pas de nom d'hôte ici.
   */
  machine: { cpu: string; coeurs: number };
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
/*
 * ÉLAGUER, PARCE QUE RIEN NE LE FAISAIT.
 *
 * Chaque passe écrit un journal de quelques centaines de kilo-octets et rien ne les purgeait :
 * 353 fichiers et 91 Mo au moment où on l'a mesuré, sur une machine de travail. Ce n'est pas
 * un défaut du produit, c'est un défaut d'hospitalité — un outil qui grossit en silence dans
 * le dossier de quelqu'un d'autre.
 *
 * On garde les GARDE_DERNIERS plus récents et on efface le reste. Le nombre plutôt que l'âge :
 * un dépôt qu'on n'ouvre pas pendant un mois ne doit pas perdre ses journaux au premier appel
 * suivant, et un dépôt qu'on martèle une nuit ne doit pas accumuler trois cents fichiers.
 *
 * ET L'ÉLAGAGE SE DIT. Un outil qui efface en silence dans le dossier de quelqu'un est pire
 * qu'un outil qui accumule : la première fois qu'on cherchera un journal disparu, on cherchera
 * un bogue. C'est la même règle que partout ailleurs ici — tout chiffre qui résulte d'une
 * sélection porte le compte de ce qui a été écarté.
 */
const GARDE_DERNIERS = 40;

export function elaguer(dossier = DOSSIER, garde = GARDE_DERNIERS): number {
  let fichiers: string[];
  try { fichiers = readdirSync(dossier).filter((f) => f.endsWith(".jsonl")); }
  catch (e) {
    /* « PAS ENCORE DE DOSSIER » ET « JE N'AI PAS PU LE LIRE » RENDAIENT TOUS DEUX ZÉRO.
       Le premier est la première passe et c'est un fait ; le second veut dire que l'élagage
       a cessé de fonctionner, et les journaux s'accumuleront sans qu'une ligne le dise —
       jusqu'à ce que quelqu'un trouve trois cents fichiers et se demande depuis quand. */
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(`  CANNOT PRUNE — ${dossier}: ${(e as Error).message}\n`
        + `  Journals are no longer pruned; they will pile up silently.\n`);
    }
    return 0;
  }
  if (fichiers.length <= garde) return 0;
  /* le nom porte l'horodatage ISO en tête : l'ordre lexical EST l'ordre chronologique,
     et ça évite un stat() par fichier sur trois cents fichiers. */
  const parDate = fichiers.sort();

  /*
   * ON NE JETTE JAMAIS LE DERNIER D'UN GENRE.
   *
   * L'élagage gardait les quarante derniers PAR DATE, sans aucune notion de ce qui porte une
   * figure publiée : un journal dont trois commandes dépendent était traité comme un essai
   * jetable. C'est arrivé — une passe de mesure a écrit assez de journaux pour pousser dehors
   * le dernier journal du corpus dur, et `abstention`, `escalade` et `signal` sont morts
   * ensemble, sur trois machines à la fois puisque `data/` n'est pas versionné.
   *
   * Les chiffres publiés ont survécu, parce qu'ils sont gelés ailleurs — mais la capacité de
   * les REFAIRE, non. Un dépôt qui publie un chiffre qu'il ne sait plus recalculer a perdu
   * exactement ce qui le distingue.
   *
   * Le genre est le suffixe du nom : `…-ocr.jsonl`, `…-dur.jsonl`. Garder le dernier de
   * chacun coûte un fichier par genre et ferme la porte.
   */
  const genre = (f: string) => f.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-/, "").replace(/\.jsonl$/, "");
  const dernierDuGenre = new Set<string>();
  const vus = new Set<string>();
  for (const f of [...parDate].reverse()) {
    const g = genre(f);
    if (!vus.has(g)) { vus.add(g); dernierDuGenre.add(f); }
  }

  const vieux = parDate.slice(0, parDate.length - garde).filter((f) => !dernierDuGenre.has(f));
  const epargnes = parDate.slice(0, parDate.length - garde).filter((f) => dernierDuGenre.has(f));
  let efface = 0;
  /* piege:ok catch-muet — un journal déjà effacé ou tenu ouvert par une autre passe est le
     cas normal d'un élagage concurrent, et `efface` compte ce qui a réellement disparu :
     l'échec n'est donc pas avalé, il est compté à zéro. */
  for (const f of vieux) {
    try { rmSync(join(dossier, f)); efface++; } catch { /* déjà parti, ou pris */ }
  }
  if (efface) {
    console.warn(`  ${efface} journal(s) pruned in ${dossier.split("/").slice(-2).join("/")} — `
      + `the last ${garde} are kept.`);
  }
  if (epargnes.length) {
    console.warn(`  ${epargnes.length} spared because they are the last of their kind: `
      + `${epargnes.map(genre).join(", ")}.`);
  }
  return efface;
}

export function ouvrirJournal(nom: string, conditions: Omit<Conditions, "plateforme" | "coeurs" | "machine" | "demarreLe">) {
  const run = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nom}`;
  mkdirSync(DOSSIER, { recursive: true });
  elaguer();
  const chemin = join(DOSSIER, `${run}.jsonl`);
  const entete: Conditions & { kind: "run"; run: string } = {
    kind: "run", run, ...conditions,
    coeurs: cpus().length, plateforme: `${platform()}-${arch()}`,
    machine: { cpu: cpus()[0]?.model ?? "unknown", coeurs: cpus().length },
    demarreLe: new Date().toISOString(),
  };
  appendFileSync(chemin, JSON.stringify(entete) + "\n");

  let lignes = 0;
  /*
   * La charge **pendant**, échantillonnée, pas seulement avant.
   *
   * Une charge relevée au départ ne dit rien de ce qui a démarré ensuite — y compris par la
   * main de celui qui a lancé la passe. C'est arrivé deux fois aujourd'hui, la seconde en
   * écrivant du code pendant que la mesure tournait. Une durée dont on ne sait pas sous quelle
   * charge elle a été prise a l'air valide et ne l'est pas.
   */
  const echantillons: number[] = [];
  const sonde = setInterval(() => echantillons.push(loadavg()[0]!), 5_000);
  sonde.unref?.();
  return {
    run, chemin,
    /* appendFileSync et non un flux : un flux tamponne, et une passe tuée perdrait son tampon. */
    ligne(t: Omit<Tentative, "run">) {
      appendFileSync(chemin, JSON.stringify({ kind: "t", run, ...t }) + "\n");
      lignes++;
    },
    /* Pas de pied de page si la passe meurt — et cette absence dit qu'elle est incomplète. */
    fermer() {
      clearInterval(sonde);
      const pic = echantillons.length ? Math.max(...echantillons) : null;
      appendFileSync(chemin, JSON.stringify({
        kind: "fin", run, lignes, termineLe: new Date().toISOString(),
        chargeApres: Number(loadavg()[0]!.toFixed(2)),
        chargePendant: pic === null ? null : {
          pic: Number(pic.toFixed(2)),
          moyenne: Number((echantillons.reduce((a, x) => a + x, 0) / echantillons.length).toFixed(2)),
          echantillons: echantillons.length,
          parCoeur: Number((pic / cpus().length).toFixed(2)),
        },
        /*
         * Le verdict porte sur la charge **externe**, pas sur le pic total.
         *
         * Première version : `pic / cœurs <= 0.5`. Elle a rendu `false` dès son premier usage
         * réel, sur une passe où rien d'autre ne tournait — parce qu'une passe générative
         * charge la machine par elle-même, et que juger ses durées sur sa propre charge les
         * condamne toutes. measure.ts sépare `externalBefore` de `totalDuring` pour cette
         * raison exacte ; ce pied de page les confondait.
         *
         * Ce qu'on peut dire honnêtement : la charge externe au départ, et de combien le total
         * est monté. La montée ne se décompose pas — on ne sait pas ce qui, du travail de la
         * passe ou d'un intrus, l'a produite — donc elle est rapportée et non jugée.
         */
        /*
         * Nommé pour ce qu'il mesure, et pas plus.
         *
         * Il s'est d'abord appelé `dureesUtilisables`, ce qui promet un verdict que ce fichier
         * ne peut pas rendre : une machine ne distingue pas sa propre charge de celle d'un
         * intrus. Une heure après la correction, une autre session a tiré 1,4 Go de modèle
         * pendant les 71 dernières secondes d'une passe, et le champ disait `true`. Ni la
         * version stricte ni la version large n'avait raison — c'était le **nom** qui mentait.
         */
        chargeExterneAvantSousLeSeuil: conditions.chargeAvant / cpus().length <= 0.5,
        montéePendant: pic === null ? null : Number((pic - conditions.chargeAvant).toFixed(2)),
        commentLire: "Aucun champ ici ne dit si les durées sont réutilisables : de l'intérieur "
          + "d'une passe, sa propre charge ne se distingue pas de celle d'un intrus. "
          + "`chargeExterneAvantSousLeSeuil` ne juge que le départ. Un travail lancé en cours de "
          + "route ne se voit pas ici — il se voit du dehors, et s'annote après coup avec un "
          + "enregistrement `note` ajouté au journal.",
      }) + "\n");
      return { lignes, chemin, chargePic: pic };
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
  let fin: { chargePendant?: unknown; chargeExterneAvantSousLeSeuil?: boolean | null } | undefined;
  const notes: { at: string; par: string; quoi: string; fenetre?: [string, string] }[] = [];
  let complet = false;
  const tentatives: Tentative[] = [];
  let tronquees = 0;
  for (const l of brut) {
    let o: { kind?: string } & Record<string, unknown>;
    try { o = JSON.parse(l); } catch { tronquees++; continue; }
    if (o.kind === "run") conditions = o as never;
    else if (o.kind === "fin") { complet = true; fin = o as never; }
    else if (o.kind === "t") tentatives.push(o as never);
    else if (o.kind === "note") notes.push(o as never);
  }
  return { conditions, tentatives, complet, tronquees, fin, notes };
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
export function parDocument(
  tentatives: readonly Tentative[],
  s: { tier: string; phrasing?: string; champsRequis?: number },
) {
  const docs = new Map<string, Tentative[]>();
  for (const t of tentatives) {
    if (t.tier !== s.tier) continue;
    if (s.phrasing !== undefined && t.phrasing !== s.phrasing) continue;
    (docs.get(t.caseId) ?? docs.set(t.caseId, []).get(t.caseId)!).push(t);
  }
  /*
   * Un document n'est entier que s'il porte tous ses champs.
   *
   * Sans `champsRequis`, un cas où un seul champ est déclaré comptait comme « dossier entier »
   * dès que ce champ était juste — et sur un corpus qui mêle des cas à cinq champs et des cas
   * ambigus à un seul, ça a rendu 12 dossiers entiers là où il y en a 1. Le chiffre publié
   * était quatre fois trop grand et la conclusion qu'on en tirait était l'inverse de la vraie.
   *
   * Le compte des documents écartés est rendu, jamais tu : écarter en silence est la faute
   * qu'on vient de payer.
   */
  const complets = new Map<string, Tentative[]>();
  let ecartes = 0;
  for (const [id, champs] of docs) {
    if (s.champsRequis !== undefined && champs.length !== s.champsRequis) { ecartes++; continue; }
    complets.set(id, champs);
  }
  let propres = 0;
  for (const [, champs] of complets) if (champs.every((t) => t.outcome === "clean")) propres++;
  const parChamp = [...docs.values()].flat();
  const tailles = [...new Set([...docs.values()].map((c) => c.length))].sort((a, b) => a - b);
  return {
    documents: complets.size, propres, ecartes,
    champsParDocument: tailles,
    melange: tailles.length > 1 && s.champsRequis === undefined,
    tauxDocument: complets.size ? propres / complets.size : null,
    tauxChamp: parChamp.length ? parChamp.filter((t) => t.outcome === "clean").length / parChamp.length : null,
    lesquels: [...complets].filter(([, c]) => c.every((t) => t.outcome === "clean")).map(([k]) => k).sort(),
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

/**
 * À quelle fréquence deux paliers indiscernables rendent des dossiers différents.
 *
 * L'indiscernabilité dit que deux paliers **notent** pareil. Elle ne dit pas qu'ils **répondent**
 * pareil — et le routage recommande l'un pour l'autre en les traitant comme interchangeables.
 * Sur un cas à plusieurs lectures défendables, les deux peuvent avoir raison et livrer au
 * client deux valeurs différentes ; ce n'est pas une erreur, ça n'entre pas dans le taux, et
 * c'est peut-être le chiffre le plus utile du lot.
 *
 * Gratuit depuis que les lignes portent la valeur rendue, et impossible avant.
 */
export function desaccord(
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
  let communs = 0, tousDeuxJustes = 0, justesEtDifferents = 0, memeIssueValeursDifferentes = 0;
  const exemples: { field: string; caseId: string; a: string; b: string }[] = [];
  for (const [k, ta] of A) {
    const tb = B.get(k);
    if (!tb) continue;
    communs++;
    const different = normaliserReponse(ta.value) !== normaliserReponse(tb.value);
    if (ta.outcome === "clean" && tb.outcome === "clean") {
      tousDeuxJustes++;
      if (different) {
        justesEtDifferents++;
        if (exemples.length < 10) exemples.push({ field: ta.field, caseId: ta.caseId, a: ta.value, b: tb.value });
      }
    }
    if (ta.outcome === tb.outcome && different) memeIssueValeursDifferentes++;
  }
  return {
    communs, tousDeuxJustes, justesEtDifferents,
    tauxParmiLesJustes: tousDeuxJustes ? justesEtDifferents / tousDeuxJustes : null,
    memeIssueValeursDifferentes, exemples,
  };
}

/**
 * Les latences, refusées dès qu'elles viennent de deux machines.
 *
 * Une latence n'est valide que pour la machine et la charge qui l'ont produite — la méthode le
 * dit depuis le début, et jusqu'ici personne ne pouvait le mettre en défaut faute d'une seconde
 * machine. Maintenant qu'il y en a une, la règle ne doit pas dépendre de la mémoire de celui
 * qui écrit la requête : cette fonction refuse plutôt que de moyenner.
 *
 * L'exactitude, elle, n'a pas cette contrainte — mais ce n'est pas une raison de la supposer.
 * `accordEntreMachines` la mesure au lieu de la croire, et exige l'identité stricte des sorties
 * plutôt qu'une simple égalité de taux : deux machines peuvent afficher le même taux et se
 * tromper sur des cas différents, et à décodage glouton avec les mêmes révisions les chaînes
 * rendues doivent être identiques, pas seulement comparables.
 */
export function latences(lots: readonly { conditions?: { machine?: { cpu: string } }; tentatives: readonly Tentative[] }[]) {
  const machines = new Set(lots.map((l) => l.conditions?.machine?.cpu ?? "inconnue"));
  if (machines.size > 1) {
    throw new Error(
      `Refusing to pool latencies from ${machines.size} machines: ${[...machines].join(", ")}.\n`
      + "  A latency holds only for the machine that produced it. Ask them separately.");
  }
  const ms = lots.flatMap((l) => l.tentatives.map((t) => t.ms)).sort((a, b) => a - b);
  const q = (f: number) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(f * ms.length))]! : null;
  return { machine: [...machines][0]!, n: ms.length, p10: q(0.1), median: q(0.5), p90: q(0.9) };
}

/** Deux machines rendent-elles exactement les mêmes sorties sur les mêmes cas ? */
export function accordEntreMachines(a: readonly Tentative[], b: readonly Tentative[]) {
  const A = new Map(a.map((t) => [`${t.tier}|${t.phrasing}|${cle(t)}`, t]));
  let communs = 0, memeIssue = 0, memeChaine = 0;
  const divergences: { key: string; a: string; b: string }[] = [];
  for (const tb of b) {
    const ta = A.get(`${tb.tier}|${tb.phrasing}|${cle(tb)}`);
    if (!ta) continue;
    communs++;
    if (ta.outcome === tb.outcome) memeIssue++;
    if (ta.value === tb.value) memeChaine++;
    else if (divergences.length < 10) divergences.push({ key: `${tb.tier}/${tb.field}/${tb.caseId}`, a: ta.value, b: tb.value });
  }
  return {
    communs, memeIssue, memeChaine,
    identique: communs > 0 && memeChaine === communs,
    poolingJustifie: communs > 0 && memeChaine === communs,
    divergences,
    note: communs === 0 ? "aucun cas commun : rien n'est comparé, et rien n'autorise à mettre en commun."
      : memeChaine === communs ? "sorties identiques au caractère : mettre les exactitudes en commun est fondé."
      : "les sorties diffèrent : mettre les exactitudes en commun moyennerait deux comportements distincts.",
  };
}

/**
 * Annoter une passe déjà écrite, sans toucher à ce qu'elle a mesuré.
 *
 * Un journal est un fichier en ajout seul : c'est ce qui permet d'y consigner après coup un
 * fait qu'on ignorait pendant la passe — qu'un autre travail tournait, qu'une machine a
 * changé — sans réécrire une seule valeur mesurée. Corriger un relevé et l'annoter ne sont pas
 * la même chose, et seule la seconde est honnête.
 */
export function annoter(chemin: string, note: { par: string; quoi: string; fenetre?: [string, string] }) {
  appendFileSync(chemin, JSON.stringify({ kind: "note", at: new Date().toISOString(), ...note }) + "\n");
}
