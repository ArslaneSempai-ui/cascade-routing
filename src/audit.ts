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
 * For each field, the HEAD is the source with the highest measured accuracy among those with
 * ENOUGH graded cases, priced or not: a vendor without a price can still be the best, and
 * leaving it out printed "best on this sample" under a source that was not (reviewed
 * 2026-09-29, items 7 and 8). Every other source is compared with the head case for case, on
 * the cases both graded, with the paired-difference interval of `paired-difference.ts`. It is
 * NOT SEPARABLE when that interval covers zero, SEPARABLY WORSE or BETTER when it does not,
 * and, once the client has declared a margin, NON-INFERIOR when the head's worst-case
 * advantage stays inside it. Fewer than ENOUGH cases graded on both sides compare nothing,
 * whatever the two rates say (item 9), and no rate is quoted under ENOUGH cases anywhere
 * (item 13).
 *
 * NOTHING IS RECOMMENDED WITHOUT A MARGIN. "Not separable" is not "not worse": on twenty
 * cases a source twenty-five points behind the head is not separable from it, and a routing
 * that took it stated a saving on a loss the client had never accepted (items 2 and 11,
 * reproduced). Without `--margin` the audit lists, per field, the options the sample cannot
 * separate from the head and says that a margin is needed. With one, it enumerates every
 * subset of the priced vendors: within a subset a vendor's pages are already paid, so each
 * field takes its cheapest admissible source (a local tier costs its measured machine time;
 * a vendor in the subset costs nothing more), and the subset with the lowest total wins.
 * Ties go to fewer vendors, then to the higher mean accuracy. Every pick is then tested
 * against every other source in the running, directly: flagged where the sample cannot
 * separate the two, where the pick is measurably worse than another admissible source
 * (item 12), and where the two share too few cases to be compared at all.
 *
 * ─── What is assumed ───
 *
 * Prices are declared by the client, or taken from `vendor-prices.json` and marked as list
 * prices read on a date. A list price is a first-tier price: when the declared yearly volume
 * exceeds the tier, no annual figure is stated (item 23). Local tiers cost machine time at a
 * declared hourly rate. Pages per document and pages per year are the client's numbers. None
 * of it is measured here, and the record says so beside every figure that depends on it.
 */

import { fileURLToPath } from "node:url";
import { rate, writeRate, ENOUGH, type Rate } from "./interval.ts";
import { pairedDifference, type PairedDifference } from "./paired-difference.ts";
import { symboleDe, UNITS } from "./assumptions.ts";
import { readJsonFile } from "./json-file.ts";
import type { FieldKind } from "./grader.ts";
import { GENRES, estDuGenre } from "./genres.ts";

export type Billing = "page" | "document";

export type ListPriceRef = { key: string; readOn: string; url: string; verified: boolean; tierPagesPerMonth: number | null };

/**
 * What a chain costs and where the figure comes from. `pricePerThousand` is per thousand
 * units of `billing`: a chain billed per document declares dollars per thousand DOCUMENTS,
 * and every label says so (reviewed 2026-09-29, item 6: a per-document price was read as a
 * per-page one and printed under a per-page label).
 */
export type SourcePrice =
  | { kind: "vendor"; name: string; pricePerThousand: number; billing: Billing; provenance: "declared" }
  | { kind: "vendor"; name: string; pricePerThousand: number; billing: Billing; provenance: "list-price"; listPrice: ListPriceRef }
  | { kind: "vendor"; name: string; pricePerThousand: null; billing: null; provenance: "unpriced" };

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
  /** Dollars per 1,000 pages of OCR that a local tier needs before it reads anything: declared,
      or 0 when not declared, and then the record says it is assumed (audit, 2026-10-04). */
  ocrPricePerThousandPages?: number;
  /** Dollars per hour of the machine running a local tier. */
  machineHourlyCost: number;
  /** The loss the client accepts, as a proportion; without it nothing is recommended. */
  margin?: number;
};

export type Standing =
  | "head" | "not-separable" | "non-inferior" | "separably-worse" | "separably-better"
  | "too-few" | "no-verdicts" | "no-overlap" | "too-few-paired";

/** The paired comparison with the head, on the cases both graded (ENOUGH of them or more). */
export type Paired = {
  n: number; discordant: number; p: number | null;
  /** Head accuracy minus this source's, on the paired cases, with its interval. `high` is the
      head's worst-case advantage: the most this source may be behind at 95 %. */
  difference: number; low: number; high: number; separable: boolean;
};

export type SourceVerdict = {
  successes: number; n: number;
  /** null under ENOUGH cases: no rate is quoted, in the console or in this file. */
  accuracy: number | null; low: number | null; high: number | null;
  /** Cost of taking THIS field from this source, per thousand pages: machine time for a local
      tier, the page price for a vendor (paid once, whatever the number of fields); null for
      a chain without a price. */
  costPerThousandPages: number | null;
  /** F9 (2026-09-29): the price as declared, in its own unit, for a priced chain; null for a
      local tier (machine time, per page by construction) and for an unpriced chain. The lines
      print this, never the per-page conversion under the other unit's name. */
  declaredPrice: { perThousand: number; billing: "page" | "document" } | null;
  standing: Standing;
  paired?: Paired;
  /** With the standing too-few-paired: how many cases both graded. */
  pairedCases?: number;
  /** Admissible sources this one is separably worse than, case for case (item 12). */
  measurablyWorseThan?: string[];
};

export type FieldAudit = {
  kind: FieldKind;
  head: string | null;
  sources: Record<string, SourceVerdict>;
  /** Sources the sample cannot separate from the head: a pick among them is not a finding. */
  inseparable: string[];
  /** With a margin: the sources a routing may take for this field. Empty without one. */
  admissible: string[];
  chosen: string | null;
  note?: string;
};

export type Pair = { field: string; source: string; against: string; n: number; discordant: number; p: number | null };

export type Audit = {
  version: 1;
  margin: number | null;
  fields: Record<string, FieldAudit>;
  routing: Record<string, string | null>;
  cost: {
    recommended: {
      perThousandPages: number; vendors: string[]; localPerThousandPages: number; complete: boolean;
      /** F9: the unit the total is stated in: "document" when every vendor routed to bills per
          document, "page" otherwise (a mixed routing is stated per page, with the conversion). */
      unit: "page" | "document";
    } | null;
    current: { chain: string; perThousandPages: number; declared: { perThousand: number; billing: "page" | "document" } } | null;
    annual: { pagesPerYear: number; current: number; recommended: number; saving: number } | null;
  };
  /** Pairs the sample cannot separate: with a margin, the pick against another source in the
      running; without one, the head against each source it cannot be separated from. */
  inseparable: Pair[];
  /** Picks that are measurably worse than another admissible source, case for case. */
  worse: (Pair & { low: number; high: number })[];
  /** Picks that share fewer than ENOUGH graded cases with another source in the running. */
  uncompared: { field: string; source: string; against: string; n: number }[];
  assumptions: {
    pagesPerDocument: number; pagesPerYear: number | null; machineHourlyCost: number; margin: number | null;
    /** The OCR a local tier needs, per 1,000 pages: declared, or assumed at 0 and said so. */
    ocrPricePerThousandPages?: { value: number; provenance: "declared" | "assumed" };
    prices: SourcePrice[];
    note: string;
  };
  omitted: string[];
};

/* ───────────────────────────── the list-price table ───────────────────────────── */

export type ListPriceEntry = {
  vendor: string; product: string; pricePerThousandPages: number; billing: Billing;
  tier?: string; tierPagesPerMonth?: number; url: string; readOn: string; verified: boolean;
};
export type ListPrices = { version: number; readOn: string; currency: string; vendors: Record<string, ListPriceEntry> };

/** The shape of vendor-prices.json this reader understands; the file says which one it is. */
export const LIST_PRICES_VERSION = 1;

export function readListPrices(path = fileURLToPath(new URL("../vendor-prices.json", import.meta.url))): ListPrices {
  const raw = readJsonFile(path) as Partial<ListPrices> & { kind?: string };
  /* Les deux noms du genre (genres.ts) : une table copiée avant le 5/10/2026 porte « cascade-… ». */
  if (!estDuGenre(raw.kind, GENRES.prixCatalogue) || !raw.vendors || typeof raw.readOn !== "string") {
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
    if (v.tierPagesPerMonth !== undefined && (typeof v.tierPagesPerMonth !== "number" || !(v.tierPagesPerMonth > 0))) {
      throw new Error(`${path}: ${key} has a tier that is not a positive number of pages a month.`);
    }
  }
  return raw as ListPrices;
}

/** What a chain's outcomes file may declare about its price. */
export type DeclaredPrice = {
  pricePerThousandPages?: number; pricePerThousandDocuments?: number;
  /** The original key of `--sorties` files: dollars per thousand DOCUMENTS (item 5). */
  coutParMilleDocuments?: number;
  billing?: Billing; vendor?: string;
};
export const PRICE_KEYS = ["pricePerThousandPages", "pricePerThousandDocuments", "coutParMilleDocuments"] as const;

/**
 * The price of a chain, from what it declared, else from the list-price table, else none.
 * A declared price wins over a list price even when both exist: the client's contract is the
 * only figure that will appear on their invoice. One price key at most, and the unit is the
 * key's: `pricePerThousandPages` is billed per page, the two document keys per document; a
 * `billing` that contradicts the key is refused rather than believed (item 6). A negative
 * price is refused here too, whatever loader let it through (item 20).
 */
export function priceOf(name: string, declared: DeclaredPrice | undefined, list: ListPrices | null): SourcePrice {
  const given = PRICE_KEYS.filter((k) => declared?.[k] !== undefined);
  if (given.length > 1) {
    throw new Error(`the chain "${name}" declares ${given.join(" and ")}: one price, in one unit.\n`
      + `  Keep pricePerThousandPages (billed per page) or pricePerThousandDocuments (billed per document), not both.`);
  }
  if (given.length === 1) {
    const key = given[0]!;
    const value = declared![key]!;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`the chain "${name}" declares ${key} = ${String(value)}, which is not a price (dollars, zero or more).`);
    }
    const billing: Billing = key === "pricePerThousandPages" ? "page" : "document";
    if (declared!.billing !== undefined && declared!.billing !== billing) {
      throw new Error(`the chain "${name}" declares ${key} (a price per ${billing}) and billing "${declared!.billing}": one of the two is wrong.\n`
        + `  A per-page price is pricePerThousandPages; a per-document price is pricePerThousandDocuments.`);
    }
    return { kind: "vendor", name, pricePerThousand: value, billing, provenance: "declared" };
  }
  if (declared?.vendor && list) {
    const l = list.vendors[declared.vendor];
    if (!l) {
      throw new Error(`the chain "${name}" declares vendor "${declared.vendor}", which is not a key of vendor-prices.json.\n`
        + `  Known keys: ${Object.keys(list.vendors).join(", ")}. Declare a price instead, or use one of those keys.`);
    }
    return { kind: "vendor", name, pricePerThousand: l.pricePerThousandPages, billing: l.billing, provenance: "list-price",
      listPrice: { key: declared.vendor, readOn: l.readOn, url: l.url, verified: l.verified, tierPagesPerMonth: l.tierPagesPerMonth ?? null } };
  }
  return { kind: "vendor", name, pricePerThousand: null, billing: null, provenance: "unpriced" };
}

/* ───────────────────────────── costs ───────────────────────────── */

/** What a vendor costs per thousand PAGES, whatever it bills: a per-document price is spread over the pages of a document. */
export function vendorCostPerThousandPages(p: SourcePrice, pagesPerDocument: number): number | null {
  if (p.pricePerThousand === null) return null;
  return p.billing === "page" ? p.pricePerThousand : p.pricePerThousand / pagesPerDocument;
}

/** What a local tier costs to read ONE field of a thousand pages: its measured time, priced. */
export function localCostPerThousandPages(msPerDocument: number, machineHourlyCost: number, pagesPerDocument: number): number {
  if (!Number.isFinite(msPerDocument)) return 0;
  const perThousandDocuments = (msPerDocument / 3_600_000) * machineHourlyCost * 1000;
  return perThousandDocuments / pagesPerDocument;
}

/* The symbol comes from the unit table, never typed here: the one place the repository allows it. */
const money = (n: number): string => symboleDe(UNITS.budget) + (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-GB") : n.toFixed(2));

/** A price in words, in its own unit: "$40 per 1,000 documents", never "per pages" for a per-document price. */
export function priceWords(p: SourcePrice): string {
  if (p.pricePerThousand === null) return "no price";
  return `${symboleDe(UNITS.budget)}${p.pricePerThousand} per 1,000 ${p.billing}s`;
}

/* ───────────────────────────── the audit ───────────────────────────── */

const pairedOf = (pd: PairedDifference): Paired => ({
  n: pd.n, discordant: pd.table.b + pd.table.c, p: pd.p,
  difference: pd.difference, low: pd.low, high: pd.high, separable: pd.separable,
});

/** Head order: the higher rate, then the larger sample, then the chain run today, then the name. */
const ahead = (rb: Rate, b: string, ra: Rate, a: string, current: string | null): boolean =>
  rb.rate > ra.rate || (rb.rate === ra.rate && (rb.n > ra.n || (rb.n === ra.n && (b === current || (a !== current && b < a)))));

export function audit(inputs: AuditInputs): Audit {
  const { fields, releve, pagesPerDocument, machineHourlyCost, margin } = inputs;
  const ocr = inputs.ocrPricePerThousandPages ?? 0;
  if (!(Number.isFinite(ocr) && ocr >= 0)) throw new Error(`audit(): an OCR price of ${String(inputs.ocrPricePerThousandPages)} is not a number of dollars, zero or more.`);
  if (margin !== undefined && !(margin > 0 && margin < 1)) {
    throw new Error(`audit(): a margin of ${margin} is not a proportion strictly between 0 and 1.`);
  }
  const chainByName = new Map(inputs.chains.map((c) => [c.name, c]));
  const omitted: string[] = [];
  const perField: Record<string, FieldAudit> = {};
  const bitsOf = (field: string, name: string): string | undefined => releve[field]?.[name]?.reussites;
  const costOf = (name: string, c: Cell): number | null => {
    const chain = chainByName.get(name);
    return chain ? vendorCostPerThousandPages(chain, pagesPerDocument) : localCostPerThousandPages(c.ms, machineHourlyCost, pagesPerDocument);
  };
  const declaredOf = (name: string): SourceVerdict["declaredPrice"] => {
    const chain = chainByName.get(name);
    return chain && chain.pricePerThousand !== null && chain.billing ? { perThousand: chain.pricePerThousand, billing: chain.billing } : null;
  };

  /* 1. Per field: the head, every source's standing against it, and the admissible set. */
  for (const field of fields) {
    const cells = releve[field] ?? {};
    const kind = inputs.kinds[field] ?? "exact";
    const rates: Record<string, Rate> = {};
    for (const [name, c] of Object.entries(cells)) rates[name] = rate(c.bons, c.sur);
    const reportable = Object.keys(cells).filter((n) => rates[n]!.reportable);
    const head = reportable.length ? reportable.reduce((a, b) => (ahead(rates[b]!, b, rates[a]!, a, inputs.current) ? b : a)) : null;
    const sources: Record<string, SourceVerdict> = {};
    const inseparable: string[] = [];
    for (const [name, c] of Object.entries(cells)) {
      const r = rates[name]!;
      const base: SourceVerdict = {
        successes: r.successes, n: r.n,
        accuracy: r.reportable ? r.rate : null, low: r.reportable ? r.low : null, high: r.reportable ? r.high : null,
        costPerThousandPages: costOf(name, c), declaredPrice: declaredOf(name), standing: "too-few",
      };
      if (!r.reportable) { sources[name] = base; continue; }
      if (name === head) { sources[name] = { ...base, standing: "head" }; continue; }
      const bt = bitsOf(field, head!), bx = c.reussites;
      if (!bt || !bx || bt.length !== bx.length) { sources[name] = { ...base, standing: "no-verdicts" }; continue; }
      const pd = pairedDifference(bt, bx);
      if (!pd) { sources[name] = { ...base, standing: "no-overlap" }; continue; }
      if (pd.tooFew) { sources[name] = { ...base, standing: "too-few-paired", pairedCases: pd.n }; continue; }
      /* Non-inferiority before separation, as in `juger`: a client who accepts two points has
         said what they want to know, and a source measurably 0.4 point behind is inside it. */
      const standing: Standing = margin !== undefined && pd.high < margin ? "non-inferior"
        : pd.separable ? (pd.difference > 0 ? "separably-worse" : "separably-better") : "not-separable";
      sources[name] = { ...base, standing, paired: pairedOf(pd) };
      if (!pd.separable) inseparable.push(name);
    }
    /* Admissible, with a margin only: the head when it has a price to route to, and every
       non-inferior source with one. A vendor without a price can be the head and is never
       taken: nothing can be costed on it (items 7 and 8). */
    const admissible = margin === undefined ? [] : Object.entries(sources)
      .filter(([, s]) => s.costPerThousandPages !== null && (s.standing === "head" || s.standing === "non-inferior"))
      .map(([n]) => n);
    /* Item 12: within the admissible, who is measurably worse than whom, case for case. The
       margin stays the criterion (it is the client's declaration); the fact is reported. */
    for (const x of admissible) {
      const worse: string[] = [];
      for (const y of admissible) {
        if (x === y) continue;
        const by = bitsOf(field, y), bx = bitsOf(field, x);
        if (!by || !bx || by.length !== bx.length) continue;
        const pd = pairedDifference(by, bx);
        if (pd && !pd.tooFew && pd.separable && pd.difference > 0) worse.push(y);
      }
      if (worse.length) sources[x]!.measurablyWorseThan = worse;
    }
    perField[field] = { kind, head, sources, inseparable, admissible, chosen: null };
    if (!head) perField[field]!.note = `no source has ${ENOUGH} or more graded cases on this field: nothing can be compared or chosen.`;
  }

  /* 2. The routing, with a margin only. */
  const routing: Record<string, string | null> = Object.fromEntries(fields.map((f) => [f, null]));
  const flags: Pick<Audit, "inseparable" | "worse" | "uncompared"> = { inseparable: [], worse: [], uncompared: [] };
  let recommended: Audit["cost"]["recommended"] = null;
  for (const c of inputs.chains) {
    if (c.provenance === "unpriced") omitted.push(`${c.name}: no declared price and no list price; it can be the best on a field, and it enters no costed routing`);
  }
  if (margin === undefined) {
    omitted.push("no margin was declared (--margin=<points>), so no routing is recommended and no saving is stated: "
      + "\"not separable from the best\" is not \"not worse\", and only a declared margin says what loss you accept. "
      + "The options this sample cannot separate from the best are listed per field above.");
    for (const field of fields) {
      const fa = perField[field]!;
      for (const other of fa.inseparable) {
        const p = fa.sources[other]!.paired!;
        flags.inseparable.push({ field, source: fa.head!, against: other, n: p.n, discordant: p.discordant, p: p.p });
      }
    }
  } else {
    const pricedVendors = inputs.chains.filter((c) => c.provenance !== "unpriced");
    type Plan = { routing: Record<string, string | null>; total: number; vendors: string[]; local: number; meanAccuracy: number; complete: boolean };
    let best: Plan | null = null;
    for (let mask = 0; mask < (1 << pricedVendors.length); mask++) {
      const chosenVendors = pricedVendors.filter((_, i) => mask & (1 << i));
      const inSubset = new Set(chosenVendors.map((c) => c.name));
      const plan: Plan = { routing: {}, total: 0, vendors: chosenVendors.map((c) => c.name), local: 0, meanAccuracy: 0, complete: true };
      let accSum = 0, decided = 0;
      for (const field of fields) {
        const fa = perField[field]!;
        let pick: { name: string; marginal: number; accuracy: number } | null = null;
        for (const name of fa.admissible) {
          const s = fa.sources[name]!;
          const isVendor = chainByName.has(name);
          if (isVendor && !inSubset.has(name)) continue;
          const marginal = isVendor ? 0 : (s.costPerThousandPages ?? 0);
          const accuracy = s.accuracy ?? 0;
          if (!pick || marginal < pick.marginal - 1e-12
            || (Math.abs(marginal - pick.marginal) <= 1e-12 && (accuracy > pick.accuracy || (accuracy === pick.accuracy && name < pick.name)))) {
            pick = { name, marginal, accuracy };
          }
        }
        if (!pick) { plan.routing[field] = null; if (fa.head) plan.complete = false; continue; }
        plan.routing[field] = pick.name; plan.local += pick.marginal; accSum += pick.accuracy; decided++;
      }
      /* OCR is paid once per page when at least one field reads a local tier, like a vendor's
         page: a local tier reads OCR'd text, and production has to produce it. */
      const litLocal = fields.some((f) => plan.routing[f] !== null && !chainByName.has(plan.routing[f]!));
      if (litLocal) plan.local += ocr;
      plan.total = chosenVendors.reduce((s, c) => s + (vendorCostPerThousandPages(c, pagesPerDocument) ?? 0), 0) + plan.local;
      plan.meanAccuracy = decided ? accSum / decided : 0;
      const better = !best
        || (plan.complete && !best.complete)
        || (plan.complete === best.complete && (plan.total < best.total - 1e-9
          || (Math.abs(plan.total - best.total) <= 1e-9 && (plan.vendors.length < best.vendors.length
            || (plan.vendors.length === best.vendors.length && plan.meanAccuracy > best.meanAccuracy)))));
      if (better) best = plan;
    }
    /*
     * The flags: each pick against every other source that was in the running, compared
     * DIRECTLY. The standings above are all against the head; a local tier taken over a vendor
     * because both were admissible has never been compared with that vendor, and "not
     * separable from the head" does not make two sources inseparable from each other.
     */
    for (const field of fields) {
      const fa = perField[field]!;
      const chosen = best?.routing[field] ?? null;
      routing[field] = chosen; fa.chosen = chosen;
      if (!chosen) {
        if (fa.head) {
          fa.note = `${fa.head} has the highest accuracy here and no price to route to; nothing priced is non-inferior to it within your margin: the field stays where it is, and no annual saving is stated.`;
          omitted.push(`${field}: ${fa.note}`);
        }
        continue;
      }
      const bitsChosen = bitsOf(field, chosen);
      for (const other of Object.keys(fa.sources)) {
        if (other === chosen) continue;
        const st = fa.sources[other]!.standing;
        if (st === "too-few" || st === "no-verdicts") continue;
        const bitsOther = bitsOf(field, other);
        if (!bitsChosen || !bitsOther || bitsChosen.length !== bitsOther.length) continue;
        const pd = pairedDifference(bitsChosen, bitsOther);
        if (!pd || pd.tooFew) { flags.uncompared.push({ field, source: chosen, against: other, n: pd?.n ?? 0 }); continue; }
        if (!pd.separable) flags.inseparable.push({ field, source: chosen, against: other, n: pd.n, discordant: pd.table.b + pd.table.c, p: pd.p });
      }
      for (const y of fa.sources[chosen]!.measurablyWorseThan ?? []) {
        const pd = pairedDifference(bitsOf(field, y)!, bitsChosen!)!;
        flags.worse.push({ field, source: chosen, against: y, n: pd.n, discordant: pd.table.b + pd.table.c, p: pd.p, low: pd.low, high: pd.high });
      }
    }
    if (best && fields.some((f) => routing[f] !== null)) {
      const perDocument = best.vendors.length > 0 && best.vendors.every((v) => chainByName.get(v)?.billing === "document");
      recommended = { perThousandPages: best.total, vendors: best.vendors, localPerThousandPages: best.local, complete: best.complete, unit: perDocument ? "document" : "page" };
    }
  }

  /* 3. Costs: the current chain, and the year. */
  let current: Audit["cost"]["current"] = null;
  if (inputs.current) {
    const c = chainByName.get(inputs.current);
    const cost = c ? vendorCostPerThousandPages(c, pagesPerDocument) : null;
    if (cost !== null) current = { chain: inputs.current, perThousandPages: cost, declared: { perThousand: c!.pricePerThousand!, billing: c!.billing! } };
    else omitted.push(`the current chain "${inputs.current}" has no price, so no saving against it can be stated`);
  }
  let annual: Audit["cost"]["annual"] = null;
  if (recommended && current && inputs.pagesPerYear !== null) {
    const perMonth = inputs.pagesPerYear / 12;
    const overTier: string[] = [];
    for (const name of new Set([...recommended.vendors, current.chain])) {
      const c = chainByName.get(name);
      if (c?.provenance === "list-price" && c.listPrice.tierPagesPerMonth !== null && perMonth > c.listPrice.tierPagesPerMonth) {
        overTier.push(`the list price of ${c.listPrice.key} (chain "${name}") applies to the first ${c.listPrice.tierPagesPerMonth.toLocaleString("en-GB")} pages a month; `
          + `at ${inputs.pagesPerYear.toLocaleString("en-GB")} pages a year (${Math.round(perMonth).toLocaleString("en-GB")} a month) part of the volume is priced above that tier, `
          + `and this table does not carry it: no annual figure until a price is declared for "${name}"`);
      }
    }
    if (overTier.length) omitted.push(...overTier);
    else if (!recommended.complete) omitted.push("the routing is incomplete (a field above has no admissible costed source), so no annual saving is stated");
    else {
      annual = {
        pagesPerYear: inputs.pagesPerYear,
        current: (current.perThousandPages * inputs.pagesPerYear) / 1000,
        recommended: (recommended.perThousandPages * inputs.pagesPerYear) / 1000,
        saving: ((current.perThousandPages - recommended.perThousandPages) * inputs.pagesPerYear) / 1000,
      };
    }
  }
  if (recommended && current && inputs.pagesPerYear === null) omitted.push("no annual page volume was declared (--pages-per-year), so the saving is given per thousand pages only");

  return {
    version: 1, margin: margin ?? null,
    fields: perField, routing,
    cost: { recommended, current, annual },
    ...flags,
    assumptions: {
      pagesPerDocument, pagesPerYear: inputs.pagesPerYear, machineHourlyCost, margin: margin ?? null,
      ocrPricePerThousandPages: { value: ocr, provenance: inputs.ocrPricePerThousandPages === undefined ? "assumed" : "declared" },
      prices: inputs.chains,
      note: "Every dollar here rests on a declared price or a list price read on a date, on the declared pages per document and per year, on the declared hourly cost of the machine for local tiers, and on the OCR price per thousand pages a local tier needs (declared, or assumed at zero and marked so). Accuracies and the separation verdicts are measured; the money is not.",
    },
    omitted,
  };
}

/* ───────────────────────────── the words ───────────────────────────── */

const pts = (x: number): string => (100 * x).toFixed(1);
const pVal = (p: number | null): string => (p === null ? "no disagreement" : p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const marginWords = (m: number): string => { const p = Math.round(1000 * m) / 10; return `${Number.isInteger(p) ? p.toFixed(0) : p.toFixed(1)}-point`; };

function standingWords(s: SourceVerdict, head: string): string {
  const p = s.paired;
  const behind = (x: number): string => (x > 0 ? `${pts(x)} points behind` : `${pts(-x)} points ahead`);
  const words = {
    head: "best on this sample",
    "not-separable": `not separable from ${head} (${p?.discordant} disagreement(s), ${pVal(p?.p ?? null)}; worst case ${behind(p?.high ?? 0)})`,
    "non-inferior": `non-inferior to ${head} within the margin (worst case ${behind(p?.high ?? 0)}${p?.separable ? "; separably worse case for case" : ""})`,
    "separably-worse": `separably worse than ${head} (${p?.discordant} disagreement(s), ${pVal(p?.p ?? null)}; at least ${behind(p?.low ?? 0)})`,
    "separably-better": `separably better than ${head} case for case (${p?.discordant} disagreement(s), ${pVal(p?.p ?? null)})`,
    "too-few": `fewer than ${ENOUGH} graded cases: not compared`,
    "no-verdicts": "no case-by-case verdicts: not compared",
    "no-overlap": `no case graded on both sides: not compared with ${head}`,
    "too-few-paired": `only ${s.pairedCases} case(s) graded on both sides (${ENOUGH} needed): not compared with ${head}`,
  }[s.standing];
  return s.measurablyWorseThan?.length ? `${words}; measurably worse than ${s.measurablyWorseThan.join(", ")} case for case` : words;
}

/** The audit as lines for the console and the report: the same words in both. */
export function auditLines(a: Audit): string[] {
  const out: string[] = [];
  const ppd = a.assumptions.pagesPerDocument;
  const pagesWords = `${ppd} page${ppd === 1 ? "" : "s"}`;
  out.push(`AUDIT: per field, the cheapest source within your declared margin of the best, case for case`);
  out.push(a.margin === null ? `  (no margin declared: nothing is recommended, the options are listed)` : `  (margin: ${marginWords(a.margin)}, your declaration)`);
  out.push(``);
  for (const [field, fa] of Object.entries(a.fields)) {
    out.push(`  ${field} (${fa.kind})`);
    if (!fa.head) { out.push(`    ${fa.note}`); continue; }
    const names = Object.keys(fa.sources).sort((x, y) => (fa.sources[y]!.accuracy ?? -1) - (fa.sources[x]!.accuracy ?? -1) || x.localeCompare(y));
    for (const name of names) {
      const s = fa.sources[name]!;
      /* The shared formatter, which refuses to quote a rate under ENOUGH cases (item 13). */
      const quoted = writeRate(rate(s.successes, s.n));
      /* F9: a declared price in its own unit; machine time per page, as it is computed. */
      const cost = s.declaredPrice ? `${money(s.declaredPrice.perThousand)} per 1,000 ${s.declaredPrice.billing}s`
        : s.costPerThousandPages === null ? "unpriced" : `${money(s.costPerThousandPages)} per 1,000 pages`;
      const mark = name === fa.chosen ? "→ " : "  ";
      out.push(`    ${mark}${name.padEnd(18)} ${quoted.padEnd(30)} ${cost.padEnd(26)} ${standingWords(s, fa.head)}`);
    }
    if (a.margin === null) {
      out.push(fa.inseparable.length
        ? `    no margin declared: nothing is recommended for ${field}. Options this sample cannot separate from ${fa.head}: ${fa.inseparable.join(", ")}.`
        : `    no margin declared: nothing is recommended for ${field}. No other source is inseparable from ${fa.head} on this sample.`);
    } else if (fa.chosen === null) {
      out.push(`    ${fa.note}`);
    }
  }
  out.push(``);
  if (a.margin === null) {
    out.push(`  No routing is recommended and no saving is stated without a declared margin: the loss, in points,`);
    out.push(`  you would accept to take a cheaper source (--margin=2). The audit then routes within it.`);
  } else if (a.cost.recommended) {
    const r = a.cost.recommended;
    out.push(`  Recommended routing: ${Object.entries(a.routing).map(([f, s]) => `${f} ← ${s ?? "none"}`).join(", ")}`
      + (r.complete ? "" : " (incomplete: a field above has no admissible costed source)"));
    /*
     * F9 (2026-09-29): every price in its declared unit. The founder's run declared both chains
     * per thousand documents and this line printed them "per 1,000 pages"; with one page a
     * document the numbers were equal, and item 6 says a price is never shown under the other
     * unit's name. When every vendor routed to bills per document the total is stated per
     * thousand documents; a routing that mixes units is stated per thousand pages and says
     * how many pages a document the per-document prices were counted at.
     */
    const priced = (v: string): string => {
      const p = a.assumptions.prices.find((x) => x.name === v);
      return p && p.pricePerThousand !== null ? `${v} ${money(p.pricePerThousand)} per 1,000 ${p.billing}s` : v;
    };
    const mixed = r.unit === "page" && r.vendors.some((v) => a.assumptions.prices.find((x) => x.name === v)?.billing === "document");
    const factor = r.unit === "document" ? ppd : 1;
    const o = a.assumptions.ocrPricePerThousandPages;
    const litLocal = Object.values(a.routing).some((s) => s !== null && !a.assumptions.prices.some((p) => p.name === s));
    out.push(`  Cost: ${money(r.perThousandPages * factor)} per 1,000 ${r.unit}s`
      + (r.vendors.length ? ` (vendor prices: ${r.vendors.map(priced).join(" + ")}` : " (no vendor pages")
      + `, local machine time${litLocal && o ? ` and OCR at ${money(o.value)} per 1,000 pages (${o.provenance})` : ""} ${money(r.localPerThousandPages * factor)}`
      + (mixed ? `; per-document prices counted at ${pagesWords} a document` : "") + `).`);
    if (litLocal && o && o.provenance === "assumed") {
      out.push(`  ⚠ a local tier is routed to and no OCR price was declared: its cost counts machine time only.`);
      out.push(`    In production a local tier reads OCR'd text; declare what that costs you with --ocr-price-per-thousand-pages.`);
    }
  } else {
    out.push(`  No routing: no field has an admissible costed source within your margin.`);
  }
  if (a.cost.current) {
    const d = a.cost.current.declared;
    out.push(`  Current chain ${a.cost.current.chain}: ${money(d.perThousand)} per 1,000 ${d.billing}s.`);
  }
  if (a.cost.annual) {
    const y = a.cost.annual;
    const anyPerDocument = a.cost.current?.declared.billing === "document"
      || (a.cost.recommended?.vendors ?? []).some((v) => a.assumptions.prices.find((x) => x.name === v)?.billing === "document");
    out.push(`  At ${y.pagesPerYear.toLocaleString("en-GB")} pages a year${anyPerDocument ? ` (${pagesWords} a document)` : ""}: `
      + `${money(y.current)} today, ${money(y.recommended)} recommended, `
      + `${y.saving >= 0 ? "saving" : "COSTING"} ${money(Math.abs(y.saving))} a year.`);
  }
  if (a.inseparable.length) {
    out.push(``);
    out.push(a.margin === null
      ? `  ${a.inseparable.length} pair(s) this sample cannot separate; with a margin, these are the candidates:`
      : `  ⚠ ${a.inseparable.length} pick(s) rest on pairs this sample cannot separate; a larger sample could reverse them:`);
    for (const p of a.inseparable) out.push(`    ${p.field}: ${p.source} and ${p.against} (n=${p.n}, ${p.discordant} disagreement(s), ${pVal(p.p)})`);
  }
  if (a.worse.length) {
    out.push(``);
    out.push(`  ⚠ ${a.worse.length} comparison(s) where the pick is measurably worse than another admissible source, case for case; each pick stays inside your margin against the best:`);
    for (const p of a.worse) out.push(`    ${p.field}: ${p.source} is at least ${pts(p.low)} points behind ${p.against} (n=${p.n}, ${p.discordant} disagreement(s), ${pVal(p.p)})`);
  }
  if (a.uncompared.length) {
    out.push(``);
    out.push(`  ⚠ ${a.uncompared.length} pair(s) share fewer than ${ENOUGH} graded cases and were not compared:`);
    for (const p of a.uncompared) out.push(`    ${p.field}: ${p.source} and ${p.against} (${p.n} case(s) graded on both sides)`);
  }
  for (const o of a.omitted) out.push(`  ⚠ ${o}`);
  out.push(``);
  out.push(`  ${a.assumptions.note}`);
  return out;
}
