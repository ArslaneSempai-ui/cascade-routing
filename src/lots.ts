/*
 * THE BATCH BEFORE THE SEND, OFFLINE (2026-10-10): candidates 1, 7 and 12 of equipe/AUTOMATISATION.md.
 *
 * cascade-portes sends; this module decides what may be in the batch and when, with nothing
 * but files: the prospect list, the suppression list, the last bounce report. It refuses to
 * prepare a batch while the bounce rate is above the gate (5 %), cuts the list to what passes
 * the checks that need no network (syntax, role addresses, free-mail domains, one contact per
 * firm, suppression), caps the day at the warm-up ramp of the sending address, and gives each
 * row a send slot in the prospect's own time zone (Tuesday to Thursday, 8:30 to 10:30 local,
 * never on a US federal holiday). MX and catch-all probes need the network, which this
 * repository does not open: they stay in cascade-portes, named in the report as "not checked
 * here".
 *
 * Nothing here sends, and the batch file is a proposal: Arslane's typed "oui" in a session
 * is what sends it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isMain, refuserDrapeauxInconnus } from "./cli.ts";

export type Prospect = { email: string; firm?: string; state?: string; name?: string };
export type Ecarte = { email: string; raison: string };

export const PORTE_REBOND = 0.05;
export const RAMPE = [10, 20, 40, 80] as const;
export const PLAFOND = 80;

const ROLES = new Set(["info", "sales", "admin", "support", "contact", "office", "hello", "noreply", "no-reply", "billing", "accounts", "hr", "jobs", "webmaster", "postmaster", "abuse", "privacy", "legal", "marketing", "team"]);
const GRAND_PUBLIC = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com", "msn.com", "proton.me", "protonmail.com", "gmx.com", "mail.com"]);

/** One check, one reason: the first that fails is the one reported. */
export function verifierAdresse(email: string): string | null {
  const e = email.trim().toLowerCase();
  const m = /^([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(e);
  if (!m) return "syntax";
  const [, local, domaine] = m;
  if (local!.startsWith(".") || local!.endsWith(".") || local!.includes("..")) return "syntax";
  if (ROLES.has(local!.split(/[+.]/)[0]!)) return "role address";
  if (GRAND_PUBLIC.has(domaine!)) return "free-mail domain";
  return null;
}

export const domaineDe = (email: string): string => email.trim().toLowerCase().split("@")[1] ?? "";

/** The bounce gate: rate of hard bounces over sent, from the last report; above the gate nothing is prepared. */
export function porte(rapport: { envoyes: number; durs: number }): { taux: number; ouverte: boolean } {
  const taux = rapport.envoyes > 0 ? rapport.durs / rapport.envoyes : 0;
  return { taux, ouverte: taux <= PORTE_REBOND };
}

/** The warm-up cap of a sending address on its n-th sending day (1-based): 10, 20, 40, 80, then 80. */
export function plafondDeChauffe(jourDEnvoi: number): number {
  if (!Number.isInteger(jourDEnvoi) || jourDEnvoi < 1) throw new Error(`day ${jourDEnvoi} of sending is not a whole number from 1.`);
  return RAMPE[Math.min(jourDEnvoi, RAMPE.length) - 1] ?? PLAFOND;
}

/* US states to the IANA zone of their majority; the rest of the world is sent in UTC. */
const ZONES: Record<string, string> = {
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", IN: "America/Indiana/Indianapolis",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", NH: "America/New_York", NJ: "America/New_York",
  NY: "America/New_York", NC: "America/New_York", OH: "America/New_York", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
  VT: "America/New_York", VA: "America/New_York", WV: "America/New_York", KY: "America/New_York", TN: "America/Chicago",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago",
  MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
};

const nieme = (annee: number, mois: number, jourSemaine: number, n: number): string => {
  const premier = new Date(Date.UTC(annee, mois, 1));
  const decalage = (jourSemaine - premier.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(annee, mois, 1 + decalage + 7 * (n - 1))).toISOString().slice(0, 10);
};
const dernier = (annee: number, mois: number, jourSemaine: number): string => {
  const fin = new Date(Date.UTC(annee, mois + 1, 0));
  const decalage = (fin.getUTCDay() - jourSemaine + 7) % 7;
  return new Date(Date.UTC(annee, mois + 1, 0 - decalage)).toISOString().slice(0, 10);
};

/** US federal holidays of a year, as YYYY-MM-DD, observed dates not computed: a Saturday or Sunday holiday is simply not a sending day. */
export function joursFeriesUS(annee: number): Set<string> {
  const a = String(annee);
  return new Set([`${a}-01-01`, nieme(annee, 0, 1, 3), nieme(annee, 1, 1, 3), dernier(annee, 4, 1), `${a}-06-19`, `${a}-07-04`,
    nieme(annee, 8, 1, 1), nieme(annee, 9, 1, 2), `${a}-11-11`, nieme(annee, 10, 4, 4), `${a}-12-25`]);
}

/** Local wall-clock parts of an instant in a zone, through Intl, which needs no network. */
function local(instant: Date, zone: string): { date: string; heure: number; jourSemaine: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(instant);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const jours = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { date: `${p("year")}-${p("month")}-${p("day")}`, heure: Number(p("hour")) + Number(p("minute")) / 60, jourSemaine: jours.indexOf(p("weekday")) };
}

/**
 * The first send slot at or after `depuis` (UTC instant) that falls on a Tuesday, Wednesday or
 * Thursday, between 8:30 and 10:30 in the prospect's zone, not on a US federal holiday. Rows are
 * spread over the window by `rang` of `total` (the n-th of the day's batch for that zone).
 */
export function creneauDEnvoi(prospect: Prospect, depuis: Date, rang = 0, total = 1): { zone: string; instant: string } {
  const zone = (prospect.state && ZONES[prospect.state.toUpperCase()]) || "UTC";
  const minuteDansLaFenetre = 8.5 + (total > 1 ? (2 * rang) / (total - 1) : 0) * 0.95;
  for (let i = 0; i < 24 * 14; i++) {
    const t = new Date(depuis.getTime() + i * 3_600_000);
    const l = local(t, zone);
    if (l.jourSemaine < 2 || l.jourSemaine > 4 || joursFeriesUS(Number(l.date.slice(0, 4))).has(l.date)) continue;
    if (l.heure < 8.5 - 1e-9 || l.heure >= 10.5) continue;
    /* First hour inside the window on an allowed day: align to the window's start plus the row's share. */
    const debut = new Date(t.getTime() - (l.heure - 8.5) * 3_600_000);
    const instant = new Date(debut.getTime() + (minuteDansLaFenetre - 8.5) * 3_600_000);
    if (instant >= depuis) return { zone, instant: instant.toISOString() };
  }
  throw new Error(`no send slot within fourteen days for zone ${zone}: check the calendar table.`);
}

export type Lot = {
  date: string; porte: { taux: number; ouverte: boolean }; plafond: { jourDEnvoi: number; max: number };
  retenus: { email: string; firm?: string; zone: string; instant: string }[]; ecartes: Ecarte[]; nonVerifieIci: string[];
};

/** The whole preparation: gate, checks, one per firm, suppression, cap, slots. Pure; writes nothing. */
export function preparerLeLot(o: { prospects: Prospect[]; suppression: Set<string>; rapport: { envoyes: number; durs: number }; jourDEnvoi: number; depuis: Date }): Lot {
  const date = o.depuis.toISOString().slice(0, 10);
  const p = porte(o.rapport);
  const max = plafondDeChauffe(o.jourDEnvoi);
  const ecartes: Ecarte[] = [];
  const parFirme = new Map<string, Prospect>();
  if (!p.ouverte) {
    return { date, porte: p, plafond: { jourDEnvoi: o.jourDEnvoi, max }, retenus: [], nonVerifieIci: ["MX", "catch-all"],
      ecartes: o.prospects.map((x) => ({ email: x.email, raison: `gate closed: bounce rate ${(100 * p.taux).toFixed(1)} % is above ${100 * PORTE_REBOND} %` })) };
  }
  for (const x of o.prospects) {
    const e = x.email.trim().toLowerCase();
    const raison = verifierAdresse(e);
    if (raison) { ecartes.push({ email: e, raison }); continue; }
    if (o.suppression.has(e) || o.suppression.has(domaineDe(e))) { ecartes.push({ email: e, raison: "suppressed (stop request or hard bounce)" }); continue; }
    const cle = (x.firm?.trim().toLowerCase() || domaineDe(e));
    if (parFirme.has(cle)) { ecartes.push({ email: e, raison: `one contact per firm: ${parFirme.get(cle)!.email} is already in` }); continue; }
    parFirme.set(cle, { ...x, email: e });
  }
  const gardes = [...parFirme.values()];
  for (const x of gardes.slice(max)) ecartes.push({ email: x.email, raison: `warm-up cap: day ${o.jourDEnvoi} allows ${max}` });
  const duJour = gardes.slice(0, max);
  const parZone = new Map<string, Prospect[]>();
  for (const x of duJour) { const z = (x.state && ZONES[x.state.toUpperCase()]) || "UTC"; parZone.set(z, [...(parZone.get(z) ?? []), x]); }
  const retenus: Lot["retenus"] = [];
  for (const [, liste] of parZone) liste.forEach((x, i) => { const c = creneauDEnvoi(x, o.depuis, i, liste.length); retenus.push({ email: x.email, firm: x.firm, zone: c.zone, instant: c.instant }); });
  retenus.sort((a, b) => a.instant.localeCompare(b.instant));
  return { date, porte: p, plafond: { jourDEnvoi: o.jourDEnvoi, max }, retenus, ecartes, nonVerifieIci: ["MX", "catch-all"] };
}

/** A prospects CSV with a header naming email and, optionally, firm, state, name. Quoted cells allowed, no newlines inside. */
export function lireProspects(texte: string): Prospect[] {
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lignes.length < 2) return [];
  const cellules = (l: string): string[] => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).slice(0, -1).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
  const noms = cellules(lignes[0]!).map((n) => n.toLowerCase());
  const col = (n: string) => noms.indexOf(n);
  if (col("email") < 0) throw new Error(`the prospects CSV needs an "email" column; header has ${noms.join(", ")}.`);
  return lignes.slice(1).map(cellules).filter((c) => c[col("email")]).map((c) => ({
    email: c[col("email")]!, firm: col("firm") >= 0 ? c[col("firm")] : undefined, state: col("state") >= 0 ? c[col("state")] : undefined, name: col("name") >= 0 ? c[col("name")] : undefined,
  }));
}

function principal(): void {
  const argv = process.argv.slice(2);
  const valeur = (nom: string) => argv.find((a) => a.startsWith(`${nom}=`))?.split("=").slice(1).join("=");
  refuserDrapeauxInconnus(["--prospects", "--suppression", "--rebonds", "--jour", "--date", "--out"]);
  if (!valeur("--prospects")) {
    console.log(`\nPrepare a cold-email batch, offline; nothing is sent.\n\n  npm run lots -- --prospects=<csv> [--suppression=<one address or domain per line>] [--rebonds=<json {envoyes, durs}>]\n                 [--jour=<n-th sending day of the address, default 1>] [--date=<ISO instant, default now>] [--out=<json>]\n\nWrites the batch as JSON: the rows kept with a send slot each (Tue to Thu, 8:30 to 10:30 local, US holidays skipped),\nthe rows set aside with their reason, the bounce gate and the warm-up cap. MX and catch-all are not checked here.\n`);
    process.exit(0);
  }
  try {
    const prospects = lireProspects(readFileSync(valeur("--prospects")!, "utf8"));
    const suppression = new Set(valeur("--suppression") ? readFileSync(valeur("--suppression")!, "utf8").split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean) : []);
    const rapport = valeur("--rebonds") ? JSON.parse(readFileSync(valeur("--rebonds")!, "utf8")) as { envoyes: number; durs: number } : { envoyes: 0, durs: 0 };
    const lot = preparerLeLot({ prospects, suppression, rapport, jourDEnvoi: Number(valeur("--jour") ?? 1), depuis: valeur("--date") ? new Date(valeur("--date")!) : new Date() });
    const sortie = valeur("--out") ?? `lot-${lot.date}.json`;
    writeFileSync(sortie, JSON.stringify(lot, null, 2) + "\n");
    console.log(`\n${lot.retenus.length} row(s) kept, ${lot.ecartes.length} set aside; bounce gate ${lot.porte.ouverte ? "open" : "CLOSED"} at ${(100 * lot.porte.taux).toFixed(1)} %; cap ${lot.plafond.max} on day ${lot.plafond.jourDEnvoi}.`);
    console.log(`Written to ${sortie}. Nothing was sent: cascade-portes sends after Arslane's "oui". MX and catch-all were not checked here.\n`);
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

if (isMain(import.meta)) principal();
