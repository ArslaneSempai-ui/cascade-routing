/**
 * The extraction cost audit: per field, the cheapest source that is not measurably worse,
 * what it costs per thousand pages at the client's volume, and what that saves a year.
 *
 * ─── Why the cost is per page, and why it is not in optimise.ts ───
 *
 * `optimise.ts` prices a field extraction: a call to a model costs the same whichever field
 * it reads, so a document of five fields costs five calls. That is right for a model called
 * per question and wrong for a document vendor. Textract, Document AI and Azure Document
 * Intelligence bill PER PAGE (or per document), once, and hand back every field they found;
 * taking one field from a vendor or ten costs the same, and taking one field each from two
 * vendors pays both. A routing optimiser that adds a cost per field cannot see that, and it
 * would recommend spreading fields across vendors as if that were free.
 *
 * So the audit has its own cost model, here, and leaves the published optimiser and the
 * frozen profile untouched: `optimise.ts` is compiled into the public page and every figure
 * on the README derives from it. This module reads the client's record and nothing else.
 *
 * ─── What is decided ───
 *
 * For each field, the HEAD is the source with the highest measured accuracy. A source is
 * ADMISSIBLE when the sample cannot separate it from the head case for case (McNemar exact,
 * `comparaison-appariee.ts`), or, when the client declared a margin, when it is non-inferior
 * within that margin. The routing then enumerates every subset of the priced vendors: within
 * a subset a vendor's pages are already paid, so each field takes its cheapest admissible
 * source at the margin (a local tier costs its measured machine time; a vendor in the subset
 * costs nothing more), and the subset with the lowest total wins. Ties go to fewer vendors,
 * then to the higher mean accuracy. Everything the sample could not separate is listed,
 * because a larger sample could reverse any of those picks without any vendor changing.
 *
 * ─── What is assumed ───
 *
 * Prices are declared by the client, or taken from `vendor-prices.json` and marked as list
 * prices read on a date. Local tiers cost machine time at a declared hourly rate. Pages per
 * document and pages per year are the client's numbers. None of it is measured here, and the
 * record says so beside every figure that depends on it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rate, ENOUGH, type Rate } from "./interval.ts";
import { apparier, juger, type Verdict } from "./comparaison-appariee.ts";
import { symboleDe, UNITS } from "./assumptions.ts";
import type { FieldKind } from "./grader.ts";

export type Billing = "page" | "document";

/** What a source costs and where the figure comes from. */
export type SourcePrice =
  | { kind: "vendor"; name: string; pricePerThousandPages: number; billing: Billing; provenance: "declared" | "list-price"; listPrice?: { key: string; readOn: string; url: string; verified: boolean } }
  | { kind: "vendor"; name: string; pricePerThousandPages: null; billing: Billing; provenance: "unpriced" }
  | { kind: "local"; name: string; provenance: "machine-time" };

export type Cell = { bons: number; sur: number; ms: number; reussites?: string };

export type AuditInputs = {
  fields: readonly string[];
  kinds: Record<string, FieldKind>;
  /** `releve[field][source]`: our tiers and the client's chains alike. */
  releve: Record<string, Record<string, Cell>>;
  /** Every source that is a client chain, with its price. Our tiers are everything else. */
  chains: SourcePrice[];
  /** The chain the client runs today; null when none was named. */
  current: string | null;
  pagesPerDocument: number;
  /** Annual volume in pages; null when not declared, and then no annual figure is given. */
  pagesPerYear: number | null;
  /** Dollars per hour of the machine running a local tier. */
  machineHourlyCost: number;
  margin?: number;
};

export type SourceVerdict = {
  accuracy: number; low: number; high: number; n: number;
  /** Cost of taking THIS field from this source, per thousand pages: machine time for a local
      tier, the page price for a vendor (paid once, whatever the number of fields). */
  costPerThousandPages: number | null;
  /** How this source stands against the head on these cases. */
  standing: "head" | "not-separable" | "non-inferior" | "separably-worse" | "separably-better" | "too-few" | "unpriced" | "no-verdicts";
  discordant?: number; p?: number | null; worstCasePoints?: number;
};

export type FieldAudit = {
  kind: FieldKind;
  head: string | null;
  sources: Record<string, SourceVerdict>;
  chosen: string | null;
  /** Sources this sample cannot separate from the head: the pick among them is not a finding. */
  inseparable: string[];
  note?: string;
};

export type Audit = {
  version: 1;
  fields: Record<string, FieldAudit>;
  routing: Record<string, string | null>;
  cost: {
    recommended: { perThousandPages: number; vendors: string[]; localPerThousandPages: number } | null;
    current: { chain: string; perThousandPages: number } | null;
    annual: { pagesPerYear: number; current: number; recommended: number; saving: number } | null;
  };
  /** Every pair the sample cannot separate, flat, for a reader who wants the list. */
  inseparable: { field: string; chosen: string; other: string; n: number; discordant: number; p: number | null }[];
  assumptions: {
    pagesPerDocument: number; pagesPerYear: number | null; machineHourlyCost: number; margin: number | null;
    prices: SourcePrice[];
    note: string;
  };
  omitted: string[];
};

/* ───────────────────────────── the list-price table ───────────────────────────── */

export type ListPrices = {
  version: number; readOn: string; currency: string;
  vendors: Record<string, { vendor: string; product: string; pricePerThousandPages: number; billing: Billing; url: string; readOn: string; verified: boolean }>;
};

/** The shape of vendor-prices.json this reader understands; the file says which one it is. */
export const LIST_PRICES_VERSION = 1;

export function readListPrices(path = fileURLToPath(new URL("../vendor-prices.json", import.meta.url))): ListPrices {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ListPrices> & { kind?: string };
  if (raw.kind !== "cascade-vendor-list-prices" || !raw.vendors || typeof raw.readOn !== "string") {
    throw new Error(`${path} is not a vendor price table this tool reads.`);
  }
  if (raw.version !== LIST_PRICES_VERSION) {
    throw new Error(`${path} is version ${String(raw.version)} of the price table; this tool reads version ${LIST_PRICES_VERSION}.`);
  }
  for (const [key, v] of Object.entries(raw.vendors)) {
    if (typeof v.pricePerThousandPages !== "number" || !Number.isFinite(v.pricePerThousandPages) || v.pricePerThousandPages < 0) {
      throw new Error(`${path}: ${key} has no readable price.`);
    }
    if (v.billing !== "page" && v.billing !== "document") throw new Error(`${path}: ${key} has no billing unit.`);
    if (typeof v.url !== "string" || typeof v.readOn !== "string") throw new Error(`${path}: ${key} names no source or date.`);
  }
  return raw as ListPrices;
}

/**
 * The price of a chain, from what it declared, else from the list-price table, else none.
 * A declared price wins over a list price even when both exist: the client's contract is the
 * only figure that will appear on their invoice.
 */
export function priceOf(name: string, declared: { pricePerThousandPages?: number; billing?: Billing; vendor?: string } | undefined,
  list: ListPrices | null): SourcePrice {
  const billing = declared?.billing ?? "page";
  if (declared?.pricePerThousandPages !== undefined) {
    return { kind: "vendor", name, pricePerThousandPages: declared.pricePerThousandPages, billing, provenance: "declared" };
  }
  if (declared?.vendor && list) {
    const l = list.vendors[declared.vendor];
    if (!l) {
      throw new Error(`the chain "${name}" declares vendor "${declared.vendor}", which is not a key of vendor-prices.json.\n`
        + `  Known keys: ${Object.keys(list.vendors).join(", ")}. Declare a price instead, or use one of those keys.`);
    }
    return { kind: "vendor", name, pricePerThousandPages: l.pricePerThousandPages, billing: l.billing, provenance: "list-price",
      listPrice: { key: declared.vendor, readOn: l.readOn, url: l.url, verified: l.verified } };
  }
  return { kind: "vendor", name, pricePerThousandPages: null, billing, provenance: "unpriced" };
}

/* ───────────────────────────── costs ───────────────────────────── */

/** What a vendor costs per thousand PAGES, whatever it bills: a per-document price is spread over the pages of a document. */
export function vendorCostPerThousandPages(p: SourcePrice, pagesPerDocument: number): number | null {
  if (p.kind !== "vendor" || p.pricePerThousandPages === null) return null;
  return p.billing === "page" ? p.pricePerThousandPages : p.pricePerThousandPages / pagesPerDocument;
}

/** What a local tier costs to read ONE field of a thousand pages: its measured time, priced. */
export function localCostPerThousandPages(msPerDocument: number, machineHourlyCost: number, pagesPerDocument: number): number {
  if (!Number.isFinite(msPerDocument)) return 0;
  const perThousandDocuments = (msPerDocument / 3_600_000) * machineHourlyCost * 1000;
  return perThousandDocuments / pagesPerDocument;
}

/* ───────────────────────────── the audit ───────────────────────────── */

function standingOf(v: Verdict, a: { discordants: number; p: number | null; bornes: [number, number] }): Pick<SourceVerdict, "standing" | "discordant" | "p" | "worstCasePoints"> {
  const base = { discordant: a.discordants, p: a.p, worstCasePoints: a.bornes[1] * 100 };
  if (v.genre === "non-inferieur") return { standing: "non-inferior", ...base };
  if (v.genre === "separable") return { standing: v.sens === "tete" ? "separably-worse" : "separably-better", ...base };
  return { standing: "not-separable", ...base };
}

export function audit(inputs: AuditInputs): Audit {
  const { fields, releve, pagesPerDocument, machineHourlyCost, margin } = inputs;
  const chainByName = new Map(inputs.chains.map((c) => [c.name, c]));
  const omitted: string[] = [];
  const perField: Record<string, FieldAudit> = {};
  const flat: Audit["inseparable"] = [];

  /* 1. Per field: the head, and every source's standing against it. */
  for (const field of fields) {
    const cells = releve[field] ?? {};
    const kind = inputs.kinds[field] ?? "exact";
    const sources: Record<string, SourceVerdict> = {};
    const rates: Record<string, Rate> = {};
    for (const [name, c] of Object.entries(cells)) rates[name] = rate(c.bons, c.sur);
    const candidates = Object.keys(cells).filter((n) => rates[n]!.reportable && (chainByName.get(n)?.kind !== "vendor" || chainByName.get(n)?.provenance !== "unpriced"));
    const head = candidates.length
      ? candidates.reduce((a, b) => (rates[b]!.rate > rates[a]!.rate ? b : a))
      : null;
    const inseparable: string[] = [];
    for (const [name, c] of Object.entries(cells)) {
      const r = rates[name]!;
      const chain = chainByName.get(name);
      const cost = chain
        ? vendorCostPerThousandPages(chain, pagesPerDocument)
        : localCostPerThousandPages(c.ms, machineHourlyCost, pagesPerDocument);
      const base = { accuracy: r.rate, low: r.low, high: r.high, n: r.n, costPerThousandPages: cost };
      if (!r.reportable) { sources[name] = { ...base, standing: "too-few" }; continue; }
      if (chain && chain.kind === "vendor" && chain.provenance === "unpriced") { sources[name] = { ...base, standing: "unpriced" }; continue; }
      if (name === head) { sources[name] = { ...base, standing: "head" }; continue; }
      const bt = cells[head!]!.reussites, bx = c.reussites;
      if (!bt || !bx || bt.length !== bx.length) { sources[name] = { ...base, standing: "no-verdicts" }; continue; }
      const a = apparier(bt, bx);
      const v = juger(a, margin);
      const s = standingOf(v, a);
      sources[name] = { ...base, ...s };
      if (s.standing === "not-separable" || (s.standing === "non-inferior" && !a.separables)) inseparable.push(name);
    }
    perField[field] = { kind, head, sources, chosen: null, inseparable };
    if (!head) perField[field]!.note = `no source has ${ENOUGH} or more graded cases on this field: nothing can be chosen.`;
  }

  /* 2. The routing: every subset of the priced vendors, each field's cheapest admissible source within it. */
  const pricedVendors = inputs.chains.filter((c): c is Extract<SourcePrice, { provenance: "declared" | "list-price" }> => c.kind === "vendor" && c.provenance !== "unpriced");
  for (const c of inputs.chains) if (c.kind === "vendor" && c.provenance === "unpriced") omitted.push(`${c.name}: no declared price and no list price, so it enters no costed routing (its accuracy is still in the tables)`);
  const admissible = (field: string, name: string): boolean => {
    const s = perField[field]!.sources[name];
    if (!s) return false;
    if (s.standing === "head") return true;
    if (margin !== undefined) return s.standing === "non-inferior";
    return s.standing === "not-separable" || s.standing === "separably-better";
  };
  type Plan = { routing: Record<string, string | null>; total: number; vendors: string[]; local: number; meanAccuracy: number; complete: boolean };
  let best: Plan | null = null;
  const subsets = 1 << pricedVendors.length;
  for (let mask = 0; mask < subsets; mask++) {
    const chosenVendors = pricedVendors.filter((_, i) => mask & (1 << i));
    const inSubset = new Set(chosenVendors.map((c) => c.name));
    const routing: Record<string, string | null> = {};
    let local = 0, accSum = 0, decided = 0, complete = true;
    for (const field of fields) {
      const fa = perField[field]!;
      let pick: { name: string; marginal: number; accuracy: number } | null = null;
      for (const [name, s] of Object.entries(fa.sources)) {
        if (!admissible(field, name)) continue;
        const isVendor = chainByName.has(name);
        if (isVendor && !inSubset.has(name)) continue;
        const marginal = isVendor ? 0 : (s.costPerThousandPages ?? 0);
        if (!pick || marginal < pick.marginal - 1e-12
          || (Math.abs(marginal - pick.marginal) <= 1e-12 && (s.accuracy > pick.accuracy || (s.accuracy === pick.accuracy && name < pick.name)))) {
          pick = { name, marginal, accuracy: s.accuracy };
        }
      }
      if (!pick) { routing[field] = null; if (fa.head) complete = false; continue; }
      routing[field] = pick.name; local += pick.marginal; accSum += pick.accuracy; decided++;
    }
    const vendorsCost = chosenVendors.reduce((s, c) => s + (vendorCostPerThousandPages(c, pagesPerDocument) ?? 0), 0);
    const plan: Plan = { routing, total: vendorsCost + local, vendors: chosenVendors.map((c) => c.name), local, meanAccuracy: decided ? accSum / decided : 0, complete };
    const better = !best
      || (plan.complete && !best.complete)
      || (plan.complete === best.complete && (plan.total < best.total - 1e-9
        || (Math.abs(plan.total - best.total) <= 1e-9 && (plan.vendors.length < best.vendors.length
          || (plan.vendors.length === best.vendors.length && plan.meanAccuracy > best.meanAccuracy)))));
    if (better) best = plan;
  }

  /*
   * The flags: for each field, the chosen source against every other source that was in the
   * running, compared DIRECTLY case for case. The standings above are all against the head;
   * a local tier chosen over a vendor because both were admissible has never been compared
   * with that vendor, and "not separable from the head" does not make two sources inseparable
   * from each other. So the pair is tested here, and only a pair the sample cannot separate
   * is flagged.
   */
  const routing: Record<string, string | null> = {};
  for (const field of fields) {
    const chosen = best?.routing[field] ?? null;
    routing[field] = chosen;
    perField[field]!.chosen = chosen;
    if (!chosen) continue;
    const fa = perField[field]!;
    const bitsChosen = releve[field]![chosen]!.reussites;
    for (const other of Object.keys(fa.sources)) {
      if (other === chosen) continue;
      const st = fa.sources[other]!.standing;
      if (st === "too-few" || st === "no-verdicts") continue;
      const bitsOther = releve[field]![other]!.reussites;
      if (!bitsChosen || !bitsOther || bitsChosen.length !== bitsOther.length) continue;
      const a = apparier(bitsChosen, bitsOther);
      if (a.separables) continue;
      flat.push({ field, chosen, other, n: a.n, discordant: a.discordants, p: a.p });
    }
  }

  /* 3. Costs: the recommendation, the current chain, and the year. */
  const recommended = best && fields.some((f) => routing[f] !== null)
    ? { perThousandPages: best.total, vendors: best.vendors, localPerThousandPages: best.local }
    : null;
  let current: Audit["cost"]["current"] = null;
  if (inputs.current) {
    const c = chainByName.get(inputs.current);
    const cost = c ? vendorCostPerThousandPages(c, pagesPerDocument) : null;
    if (cost !== null) current = { chain: inputs.current, perThousandPages: cost };
    else omitted.push(`the current chain "${inputs.current}" has no price, so no saving against it can be stated`);
  }
  const annual = recommended && current && inputs.pagesPerYear !== null
    ? {
      pagesPerYear: inputs.pagesPerYear,
      current: (current.perThousandPages * inputs.pagesPerYear) / 1000,
      recommended: (recommended.perThousandPages * inputs.pagesPerYear) / 1000,
      saving: ((current.perThousandPages - recommended.perThousandPages) * inputs.pagesPerYear) / 1000,
    }
    : null;
  if (recommended && current && inputs.pagesPerYear === null) omitted.push("no annual page volume was declared (--pages-per-year), so the saving is given per thousand pages only");

  return {
    version: 1,
    fields: perField, routing,
    cost: { recommended, current, annual },
    inseparable: flat,
    assumptions: {
      pagesPerDocument, pagesPerYear: inputs.pagesPerYear, machineHourlyCost, margin: margin ?? null,
      prices: inputs.chains,
      note: "Every dollar here rests on a declared price or a list price read on a date, on the declared pages per document and per year, and on the declared hourly cost of the machine for local tiers. Accuracies and the separation verdicts are measured; the money is not.",
    },
    omitted,
  };
}

/* ───────────────────────────── the words ───────────────────────────── */

/* The symbol comes from the unit table, never typed here: the one place the repository allows it. */
const money = (n: number): string => symboleDe(UNITS.budget) + (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-GB") : n.toFixed(2));
const pct = (x: number): string => (100 * x).toFixed(1) + " %";

/** The audit as lines for the console and the report: the same words in both. */
export function auditLines(a: Audit): string[] {
  const out: string[] = [];
  out.push(`AUDIT: the cheapest source per field that this sample cannot show to be worse`);
  out.push(``);
  for (const [field, fa] of Object.entries(a.fields)) {
    out.push(`  ${field} (${fa.kind})`);
    if (!fa.head) { out.push(`    ${fa.note}`); continue; }
    const names = Object.keys(fa.sources).sort((x, y) => fa.sources[y]!.accuracy - fa.sources[x]!.accuracy);
    for (const name of names) {
      const s = fa.sources[name]!;
      const cost = s.costPerThousandPages === null ? "unpriced" : `${money(s.costPerThousandPages)} per 1,000 pages`;
      const mark = name === fa.chosen ? "→ " : "  ";
      const standing = {
        head: "best on this sample", "not-separable": `not separable from ${fa.head} (${s.discordant} disagreement(s), p = ${s.p === null || s.p === undefined ? "n/a" : s.p.toFixed(3)})`,
        "non-inferior": `non-inferior to ${fa.head} within the margin`, "separably-worse": `separably worse than ${fa.head}`,
        "separably-better": `separably better than ${fa.head} case for case`, "too-few": `fewer than ${ENOUGH} graded cases: not compared`,
        unpriced: "no price: not in any costed routing", "no-verdicts": "no case-by-case verdicts: not compared",
      }[s.standing];
      out.push(`    ${mark}${name.padEnd(18)} ${pct(s.accuracy)} [${(100 * s.low).toFixed(0)}-${(100 * s.high).toFixed(0)}], n=${s.n}   ${cost.padEnd(28)} ${standing}`);
    }
    if (fa.chosen === null) out.push(`    no admissible source within the priced ones: ${fa.head} is unpriced or nothing else keeps up with it.`);
  }
  out.push(``);
  if (a.cost.recommended) {
    const r = a.cost.recommended;
    out.push(`  Recommended routing: ${Object.entries(a.routing).map(([f, s]) => `${f} ← ${s ?? "none"}`).join(", ")}`);
    out.push(`  Cost: ${money(r.perThousandPages)} per 1,000 pages`
      + (r.vendors.length ? ` (vendor pages: ${r.vendors.join(" + ")}` : " (no vendor pages")
      + `, local machine time ${money(r.localPerThousandPages)}).`);
  }
  if (a.cost.current) out.push(`  Current chain ${a.cost.current.chain}: ${money(a.cost.current.perThousandPages)} per 1,000 pages.`);
  if (a.cost.annual) {
    const y = a.cost.annual;
    out.push(`  At ${y.pagesPerYear.toLocaleString("en-GB")} pages a year: ${money(y.current)} today, ${money(y.recommended)} recommended, `
      + `${y.saving >= 0 ? "saving" : "COSTING"} ${money(Math.abs(y.saving))} a year.`);
  }
  if (a.inseparable.length) {
    out.push(``);
    out.push(`  ⚠ ${a.inseparable.length} pick(s) rest on pairs this sample cannot separate; a larger sample could reverse them:`);
    for (const p of a.inseparable) out.push(`    ${p.field}: ${p.chosen} over ${p.other} (n=${p.n}, ${p.discordant} disagreement(s), p = ${p.p === null ? "n/a" : p.p.toFixed(3)})`);
  }
  for (const o of a.omitted) out.push(`  ⚠ ${o}`);
  out.push(``);
  out.push(`  ${a.assumptions.note}`);
  return out;
}
