/*
 * ONE-COMMAND CLIENT DELIVERY OF THE EXTRACTION COST AUDIT (2026-10-10).
 *
 * A client's CSV and the graded outcomes of their vendor chains go in; a dated folder comes
 * out: the report measure:yours writes, the sealed record, a SHA-256 manifest of every file,
 * and a French cover-note draft for Arslane to read and send himself. The command sends
 * nothing, publishes nothing, and runs offline (CASCADE_OFFLINE=1): the only network the
 * repository ever uses is the one measure:yours already refuses.
 *
 * Why a command and not a checklist: an order can arrive on any day, and the delivery must
 * be the same on a good day and a bad one. Everything a reader of the folder needs to trust
 * it is inside the folder: the inputs copied as received, the outputs, their hashes, and the
 * seal of the record (`scelleIntact`). No PDF: this repository has no PDF path, and the
 * note says so rather than promising one.
 *
 * Nothing of the client's values is written by this file: the report and the record already
 * carry outcomes and aggregates only, and the note is built from the record alone.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";
import { readJsonFile } from "./json-file.ts";
import { scelleIntact } from "./empreinte.ts";

export const FLAGS = ["--client", "--cases", "--sorties", "--rules", "--current", "--margin", "--pages-per-document",
  "--pages-per-year", "--machine-hourly-cost", "--questions", "--out", "--date"] as const;

/** Flags handed to measure:yours as they are; the others are this command's. */
const TRANSMIS = new Set(["--sorties", "--rules", "--current", "--margin", "--pages-per-document", "--pages-per-year",
  "--machine-hourly-cost", "--questions"]);

const MESURE = fileURLToPath(new URL("./your-cases.ts", import.meta.url));

/** A client name is a folder name: lower-case letters, digits and hyphens, 2 to 40 characters. */
export function nomDeClient(brut: string | undefined): string {
  if (!brut || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(brut)) {
    throw new Error(`--client=${brut ?? ""} is not a client slug: lower-case letters, digits and hyphens, 2 to 40 characters (acme-logistics).`);
  }
  return brut;
}

/** True when a regular file exists anywhere under the folder; empty folders do not count. */
function aDesFichiers(d: string): boolean {
  return readdirSync(d).some((nom) => (statSync(join(d, nom)).isDirectory() ? aDesFichiers(join(d, nom)) : true));
}

/** The dated delivery folder, created empty; an existing folder with files in it is never written over. */
export function dossierDeLivraison(racine: string, client: string, date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date=${date} is not a date written YYYY-MM-DD.`);
  const dossier = join(racine, client, date);
  if (existsSync(dossier) && aDesFichiers(dossier)) {
    throw new Error(`${dossier} already holds a delivery. Nothing is overwritten: give another --date or move it.`);
  }
  mkdirSync(join(dossier, "entrees"), { recursive: true });
  return dossier;
}

export type Manifeste = { version: 1; client: string; date: string; ecritLe: string; scelle: string | null;
  fichiers: { chemin: string; octets: number; sha256: string }[] };

const sha256 = (chemin: string): string => createHash("sha256").update(readFileSync(chemin)).digest("hex");

/** Every file of the folder, hashed; written twice: as JSON and in `sha256sum -c` format. */
export function manifeste(dossier: string, client: string, date: string, scelle: string | null): Manifeste {
  const fichiers: Manifeste["fichiers"] = [];
  const descendre = (d: string): void => {
    for (const nom of readdirSync(d).sort()) {
      const p = join(d, nom);
      if (statSync(p).isDirectory()) descendre(p);
      else if (!/^MANIFESTE\./.test(relative(dossier, p))) fichiers.push({ chemin: relative(dossier, p).split("\\").join("/"), octets: statSync(p).size, sha256: sha256(p) });
    }
  };
  descendre(dossier);
  const m: Manifeste = { version: 1, client, date, ecritLe: new Date().toISOString(), scelle, fichiers };
  writeFileSync(join(dossier, "MANIFESTE.json"), JSON.stringify(m, null, 2) + "\n");
  writeFileSync(join(dossier, "MANIFESTE.sha256"), fichiers.map((f) => `${f.sha256}  ${f.chemin}`).join("\n") + "\n");
  return m;
}

type Releve = {
  source?: { file?: string; cases?: number }; fields?: string[]; tiers?: string[]; margin?: number | null;
  measuredAt?: string; empreinte?: string;
  audit?: { routing?: Record<string, string | null>; inseparable?: unknown[];
    cost?: { recommended?: { perThousandPages?: number; unit?: string; vendors?: string[] };
      current?: { chain?: string; perThousandPages?: number; declared?: { billing?: string } | null };
      annual?: { pagesPerYear?: number; current?: number; recommended?: number; saving?: number } | null } } | null;
};

/* French typography as the repository's rule has it (c27d1db): a no-break space (U+00A0)
   before a colon and between the groups of a number; the locale's narrow one is replaced. */
export const NBSP = "\u00a0";
export const nombreFr = (n: number): string => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[\u202f\u00a0 ]/g, NBSP);
const dollars = (n: number): string => `${nombreFr(n)}${NBSP}$`;
const unite = (u: string | undefined): string => (u === "document" ? `pour 1${NBSP}000 documents` : `pour 1${NBSP}000 pages`);

/**
 * The cover note, in French, for Arslane to read and send himself. Built from the sealed
 * record only: counts, fields, routing, costs, margin, caveats, seal, files. Never a value.
 */
export function noteDEnvoi(releve: Releve, o: { client: string; date: string; fichiers: readonly string[] }): string {
  const cas = releve.source?.cases ?? 0;
  const champs = releve.fields ?? [];
  const a = releve.audit ?? null;
  const lignes: string[] = [
    `# Note d'envoi : audit d'extraction pour ${o.client}, ${o.date}`,
    ``,
    `Brouillon pour Arslane. Rien n'a été envoyé : à relire, puis à envoyer par toi.`,
    ``,
    `## Ce que le dossier contient`,
    ``,
    `- Le rapport (\`rapport.md\`) et le relevé scellé (\`releve.json\`, sceau \`${releve.empreinte ?? "absent"}\`), mesurés le ${(releve.measuredAt ?? "").slice(0, 10)} sur ${cas} cas, ${champs.length} champ(s) : ${champs.join(", ")}.`,
    `- Les entrées telles que reçues (\`entrees/\`) et le manifeste SHA-256 de chaque fichier (\`MANIFESTE.sha256\`), pour que le client vérifie que rien n'a bougé.`,
    `- Aucune valeur extraite n'y figure : des issues (juste, faux, vide) et des agrégats, jamais une donnée du client.`,
    ``,
  ];
  if (a && a.routing && Object.keys(a.routing).length > 0) {
    lignes.push(`## Ce que l'audit conclut, à dire au client`, ``);
    for (const [champ, source] of Object.entries(a.routing)) {
      lignes.push(source === null
        ? `- ${champ} : aucune source moins chère n'est admissible dans la marge sur cet échantillon.`
        : `- ${champ} : la source la moins chère que l'échantillon ne peut pas montrer pire que la meilleure est ${source}.`);
    }
    const c = a.cost;
    if (c?.recommended?.perThousandPages !== undefined) {
      const rec = c.recommended;
      lignes.push(``, `- Coût du routage recommandé : ${dollars(rec.perThousandPages!)} ${unite(rec.unit)}`
        + (rec.vendors && rec.vendors.length > 0 ? ` (${rec.vendors.join(", ")})` : "") + `.`);
    }
    if (c?.current?.chain) {
      lignes.push(`- Chaîne actuelle, ${c.current.chain} : ${dollars(c.current.perThousandPages ?? 0)} ${unite(c.current.declared?.billing ?? "page")}, prix déclaré par le client, jamais mesuré ici.`);
    }
    if (c?.annual?.saving !== undefined && c.annual.pagesPerYear) {
      lignes.push(`- Sur ${nombreFr(c.annual.pagesPerYear)} pages par an : ${dollars(c.annual.current ?? 0)} aujourd'hui, ${dollars(c.annual.recommended ?? 0)} avec le routage recommandé, soit ${dollars(c.annual.saving)} d'écart.`);
    }
    if (releve.margin !== undefined && releve.margin !== null) {
      lignes.push(`- Marge déclarée par le client : ${nombreFr(100 * releve.margin)} point(s). C'est sa déclaration, pas une mesure.`);
    }
    if (a.inseparable && a.inseparable.length > 0) {
      lignes.push(`- ${a.inseparable.length} paire(s) que l'échantillon ne sépare pas : nommées dans le rapport, à lire avant toute décision.`);
    }
    lignes.push(``);
  } else {
    lignes.push(`## Ce que l'audit conclut`, ``,
      `- Aucune chaîne du client n'a été fournie (\`--sorties\`) : le rapport mesure les paliers locaux seuls et ne route rien contre un fournisseur. Pour l'audit complet, il faut les issues notées de sa chaîne (\`npm run grade\`).`, ``);
  }
  lignes.push(`## Les réserves à écrire telles quelles`, ``,
    `- Les taux valent pour ces ${cas} cas ; rien n'est affirmé sur d'autres documents.`,
    `- Les prix sont ceux déclarés par le client ou lus sur une page publique à une date ; aucun n'est mesuré ici.`,
    `- Sous vingt cas appariés, rien n'est comparé ; le rapport le dit champ par champ.`,
    ``,
    `## Fichiers`, ``,
    ...o.fichiers.map((f) => `- \`${f}\``),
    ``,
    `Pas de PDF : ce dépôt n'en produit pas ; le rapport est en Markdown, lisible tel quel.`, ``);
  return lignes.join("\n");
}

export type OptionsDeLivraison = { client: string; cases: string; date: string; racine: string; transmis: readonly string[] };

/** Copies the inputs, runs measure:yours offline on the copy, files the outputs, hashes everything, writes the note. */
export function livrer(o: OptionsDeLivraison): { dossier: string; scelle: string | null } {
  if (!existsSync(o.cases)) throw new Error(`${o.cases} does not exist: --cases must name the client's CSV.`);
  const dossier = dossierDeLivraison(o.racine, o.client, o.date);
  const csv = join(dossier, "entrees", basename(o.cases));
  copyFileSync(o.cases, csv);
  const drapeaux: string[] = [];
  for (const d of o.transmis) {
    const [nom, ...reste] = d.split("=");
    const valeur = reste.join("=");
    if (nom === "--sorties" || nom === "--rules" || nom === "--questions") {
      if (!existsSync(valeur)) throw new Error(`${valeur} does not exist (${nom}).`);
      const copie = join(dossier, "entrees", basename(valeur));
      copyFileSync(valeur, copie);
      drapeaux.push(`${nom}=${copie}`);
    } else drapeaux.push(d);
  }
  const r = spawnSync(process.execPath, [MESURE, `--cases=${csv}`, ...drapeaux],
    { encoding: "utf8", env: { ...process.env, CASCADE_OFFLINE: "1" }, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(dossier, "journal-mesure.txt"), (r.stdout ?? "") + (r.stderr ?? ""));
  if (r.status !== 0) {
    throw new Error(`measure:yours exited ${r.status}; its output is in ${join(dossier, "journal-mesure.txt")}. Nothing else was written.`);
  }
  const base = csv.replace(/\.csv$/i, "");
  const sorties: [string, string][] = [["-measured.md", "rapport.md"], ["-measured.json", "releve.json"], ["-trace.json", "trace.json"]];
  for (const [suffixe, nom] of sorties) if (existsSync(base + suffixe)) renameSync(base + suffixe, join(dossier, nom));
  const releve = readJsonFile(join(dossier, "releve.json")) as Releve & Record<string, unknown>;
  if (!scelleIntact(releve)) throw new Error(`${join(dossier, "releve.json")} does not carry an intact seal: the delivery is not trustworthy, nothing more is written.`);
  const scelle = releve.empreinte ?? null;
  const avant = manifeste(dossier, o.client, o.date, scelle);
  writeFileSync(join(dossier, "note-envoi.md"), noteDEnvoi(releve, { client: o.client, date: o.date, fichiers: avant.fichiers.map((f) => f.chemin) }));
  manifeste(dossier, o.client, o.date, scelle);
  return { dossier, scelle };
}

function principal(): void {
  refuserDrapeauxInconnus(FLAGS);
  const argv = process.argv.slice(2);
  const valeur = (nom: string) => argv.find((a) => a.startsWith(`${nom}=`))?.split("=").slice(1).join("=");
  if (!valeur("--client") || !valeur("--cases")) {
    console.log(`
Deliver the extraction cost audit to a client, in one command, offline.

  npm run livrer -- --client=<slug> --cases=<their.csv> [--sorties=<graded outcomes>]... [--current=<chain>]
                    [--margin=<points>] [--pages-per-document=<n>] [--pages-per-year=<n>] [--rules=<file>]
                    [--questions=<file>] [--out=<folder>] [--date=YYYY-MM-DD]

Writes <out>/<client>/<date>/: entrees/ (the inputs as received), rapport.md, releve.json (sealed),
trace.json when asked, journal-mesure.txt, MANIFESTE.json and MANIFESTE.sha256, and note-envoi.md,
a French cover-note draft. Sends nothing; the note is for Arslane to send himself. Default --out is
./livraisons, default --date is today. The flags after --cases are measure:yours's own.
`);
    process.exit(valeur("--client") || valeur("--cases") ? 1 : 0);
  }
  try {
    const client = nomDeClient(valeur("--client"));
    const transmis = argv.filter((a) => TRANSMIS.has(a.split("=")[0]!));
    const { dossier, scelle } = livrer({
      client, cases: resolve(valeur("--cases")!), date: valeur("--date") ?? new Date().toISOString().slice(0, 10),
      racine: resolve(valeur("--out") ?? "livraisons"), transmis,
    });
    console.log(`\nDelivery written to ${dossier} (record seal ${scelle}). Nothing was sent: read note-envoi.md first.\n`);
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

if (isMain(import.meta)) principal();
