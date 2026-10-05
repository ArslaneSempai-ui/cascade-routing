/**
 * The typed grader: a field declares what kind of value it holds, and the comparison follows.
 *
 * `correct()` in tiers.ts compares two strings after separator clean-up. That is the right
 * default for a name or a document number, and it is exactly wrong for an amount: "1,234.50"
 * and "1234.50" are the same money and score as a mismatch, so a vendor that writes thousands
 * separators loses points it did not lose. The same goes for "09/29/2026" against
 * "2026-09-29", for "usd" against "$", and for "12-3456789" against "123456789".
 *
 * A field therefore declares its KIND, in the case file itself: the header `total:amount`
 * names a field `total` graded as an amount. Six kinds:
 *
 *   exact       the default, and the current behaviour: `correct()` unchanged.
 *   amount      a decimal number: currency symbols, codes, thousands separators and the
 *               decimal-comma convention are formatting, the number is content.
 *   date        a calendar day: ISO, numeric with slashes or dots, or a written month.
 *   currency    an ISO 4217 code, given as a code, a symbol or a common name.
 *   id          a tax or registration identifier: only letters and digits count.
 *   free-text   words: case, punctuation, diacritics and spacing are formatting.
 *
 * ONE RULE HOLDS FOR EVERY KIND, AND A PROPERTY TEST HOLDS IT: a typed comparison can only
 * ADD matches to the default one, never remove any. `graded(got, expected, kind)` is true
 * whenever `correct(got, expected)` is, and it is additionally true when both sides parse as
 * the declared kind to the same value. A value that does not parse falls back to the default,
 * so a mistyped header degrades to today's behaviour instead of scoring everything wrong.
 *
 * WHAT IS DECIDED HERE, AND IS A CONVENTION RATHER THAN A FACT. Two are worth knowing:
 *   - a lone comma followed by exactly three digits is a thousands separator ("1,234" is
 *     one thousand two hundred and thirty-four), any other lone comma is a decimal one
 *     ("12,50" is twelve and a half). A lone point is always decimal. When both appear, the
 *     last one is the decimal separator.
 *   - an all-numeric date with slashes or dashes is read month first (09/29/2026), because
 *     the buyers this serves are in the United States. A day above twelve resolves the
 *     ambiguity on its own; when both parts are twelve or under, the declared order decides,
 *     and it can be changed to day-first with the kind `date-dmy`.
 * Both are written in the record the grading produces, so a reader knows which convention
 * scored their file.
 */

import { correct, normaliserReponse } from "./tiers.ts";

export type FieldKind = "exact" | "amount" | "amount-grouped" | "date" | "date-dmy" | "currency" | "id" | "free-text";

export const FIELD_KINDS: readonly FieldKind[] = ["exact", "amount", "amount-grouped", "date", "date-dmy", "currency", "id", "free-text"];

export function isFieldKind(x: unknown): x is FieldKind {
  return typeof x === "string" && (FIELD_KINDS as readonly string[]).includes(x);
}

/**
 * A header cell, split into the field name and its declared kind.
 *
 * Only a suffix that is EXACTLY a known kind is read as one: `total:amount` declares, while
 * `time:stamp` keeps its whole name, because "stamp" is not a kind. A colon inside a field
 * name is rare, and a name silently shortened would be worse than a kind silently ignored,
 * so the rule is narrow on purpose.
 */
export function splitHeader(cell: string): { name: string; kind: FieldKind | undefined } {
  const i = cell.lastIndexOf(":");
  if (i < 0) return { name: cell, kind: undefined };
  const suffix = cell.slice(i + 1).trim().toLowerCase();
  if (!isFieldKind(suffix)) return { name: cell, kind: undefined };
  const name = cell.slice(0, i).trim();
  if (name.length === 0) return { name: cell, kind: undefined };
  return { name, kind: suffix };
}

/* ───────────────────────────── amount ───────────────────────────── */

/**
 * A decimal amount as a canonical string: sign, integer digits without leading zeros, and
 * fractional digits without trailing zeros. Strings rather than numbers, so that "0.1" and
 * "0.10" are equal and no floating-point rounding ever enters a verdict.
 */
/**
 * What may surround a number without being part of it: currency symbols, a three-letter
 * code, and blanks. Nothing else. "1.2M", "12k", "1e3" and "1,250.00 CR" carry a letter
 * that changes the amount, and the first version deleted every ASCII letter before parsing
 * them, so "1.2M" read as 1.20 and "1,250.00 CR" equalled "1,250.00 DR". Reviewed 2026-09-29.
 */
const CURRENCY_MARK = /^(?:US\$|CA\$|AU\$|MX\$|C\$|A\$|[$€£¥₹₩₽₺]|[A-Za-z]{3}(?![A-Za-z]))/;

function stripCurrency(s: string): string {
  let out = s.trim();
  for (;;) {
    const before = out;
    const lead = CURRENCY_MARK.exec(out);
    if (lead) out = out.slice(lead[0].length).trim();
    const tail = /(?:US\$|CA\$|AU\$|MX\$|C\$|A\$|[$€£¥₹₩₽₺]|(?<![A-Za-z])[A-Za-z]{3})$/.exec(out);
    if (tail) out = out.slice(0, out.length - tail[0].length).trim();
    if (out === before) return out;
  }
}

export function parseAmount(raw: string): string | null {
  let s = stripCurrency(raw.replace(/[  ]/g, " "));
  if (s.length === 0) return null;
  /*
   * Negative markers: parentheses around the number, a leading minus, a trailing minus. ONE
   * of them makes the amount negative; two are not a double negative, they are a string
   * nobody writes for money, and it does not parse. The first version toggled a flag per
   * marker, so "(-250.00)" came out positive and matched 250.00. Reviewed 2026-09-29.
   */
  let markers = 0;
  if (/^\(.*\)$/.test(s)) { markers++; s = stripCurrency(s.slice(1, -1)); }
  if (/-\s*$/.test(s)) { markers++; s = s.replace(/-\s*$/, "").trim(); }
  if (s.startsWith("-")) { markers++; s = s.slice(1).trim(); }
  else if (s.startsWith("+")) s = s.slice(1).trim();
  if (markers > 1) return null;
  const negative = markers === 1;
  /* The sign may have stood before the currency mark ("-CHF 12.50"): strip again. */
  s = stripCurrency(s);
  /* Apostrophes and blanks are thousands separators in some locales. */
  s = s.replace(/['’ ]/g, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(","), lastPoint = s.lastIndexOf(".");
  let integer: string, fraction: string;
  if (lastComma >= 0 && lastPoint >= 0) {
    /* Both present: the last one is the decimal separator, the other is grouping. */
    const dec = Math.max(lastComma, lastPoint);
    const decChar = s[dec]!;
    const groupChar = decChar === "," ? "." : ",";
    const before = s.slice(0, dec), after = s.slice(dec + 1);
    if (after.includes(decChar) || after.includes(groupChar)) return null;
    if (!groupsWellFormed(before, groupChar)) return null;
    integer = before.split(groupChar).join(""); fraction = after;
  } else if (lastComma >= 0 || lastPoint >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    if (parts.length > 2) {
      /* Several of the same separator: grouping, every group of three. */
      if (!groupsWellFormed(s, sep)) return null;
      integer = parts.join(""); fraction = "";
    } else if (sep === "," && parts[1]!.length === 3 && /^[1-9]\d{0,2}$/.test(parts[0]!)) {
      /* The convention stated in the header comment: one comma, three digits, grouping. Only
         when the group before it could be a leading group: "0,500" and "1234,567" are
         decimals, not "0500" and "1234567". Reviewed 2026-09-29. */
      integer = parts[0]! + parts[1]!; fraction = "";
    } else {
      integer = parts[0]!; fraction = parts[1]!;
    }
  } else {
    integer = s; fraction = "";
  }
  if (integer.length === 0 && fraction.length === 0) return null;
  integer = integer.replace(/^0+(?=\d)/, "");
  if (integer.length === 0) integer = "0";
  fraction = fraction.replace(/0+$/, "");
  const zero = /^0*$/.test(integer) && fraction.length === 0;
  const sign = negative && !zero ? "-" : "";
  return sign + integer + (fraction.length ? "." + fraction : "");
}

/**
 * The grouped reading: a point or comma followed by exactly three digits groups thousands,
 * a FINAL point or comma followed by exactly two digits is the decimal part, and any other
 * shape is unreadable. Indonesian receipts print sixty thousand rupiah as "60.000", and so do
 * German ones for euros; the `amount` kind reads a lone point as decimal
 * and turned that into sixty. Measured on Google Document AI's output for the 100 receipts
 * of CORD v2 by the founder on 2026-09-29: 60 of 95 totals right under `amount`, 90 of 95
 * under this rule. The grader would have blamed the vendor for our own reading. Declared per
 * field in the header (`total:amount-grouped`); `amount` is unchanged.
 *
 * "Rp" and "Rp." are the rupiah's marks and are stripped like a currency code; the rest of
 * what may surround a number is what `amount` allows.
 */
export function parseAmountGrouped(raw: string): string | null {
  const stripRupiah = (x: string): string => x.replace(/^Rp\.?(?![A-Za-z])\s*/i, "").replace(/\s*(?<![A-Za-z])Rp\.?$/i, "").trim();
  const strip = (x: string): string => stripCurrency(stripRupiah(stripCurrency(x)));
  let s = strip(raw.replace(/[\u00a0\u202f]/g, " "));
  if (s.length === 0) return null;
  let markers = 0;
  if (/^\(.*\)$/.test(s)) { markers++; s = strip(s.slice(1, -1)); }
  /* A blank or an apostrophe between digit groups is a thousands separator in some locales
     ("1 234,56", "1'234.56"): read as grouping, like `amount` does (audit, 2026-10-04). */
  s = s.replace(/(?<=\d)[ '\u2019](?=\d{3}\b)/g, "");
  if (/-\s*$/.test(s)) { markers++; s = s.replace(/-\s*$/, "").trim(); }
  if (s.startsWith("-")) { markers++; s = s.slice(1).trim(); }
  else if (s.startsWith("+")) s = s.slice(1).trim();
  if (markers > 1) return null;
  const negative = markers === 1;
  s = strip(s);
  const m = /^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{2}))?$/.exec(s);
  if (!m) return null;
  let integer = m[1]!.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
  if (integer.length === 0) integer = "0";
  const fraction = (m[2] ?? "").replace(/0+$/, "");
  const zero = /^0*$/.test(integer) && fraction.length === 0;
  const sign = negative && !zero ? "-" : "";
  return sign + integer + (fraction.length ? "." + fraction : "");
}

/** "1,234,567" is well formed; "12,34" with a grouping comma is not. */
function groupsWellFormed(s: string, groupChar: string): boolean {
  const groups = s.split(groupChar);
  if (groups.length === 1) return /^\d+$/.test(s);
  if (!/^\d{1,3}$/.test(groups[0]!)) return false;
  return groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

/* ───────────────────────────── date ───────────────────────────── */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * A calendar day as "YYYY-MM-DD", or null. Two-digit years pivot at fifty: 26 is 2026,
 * 61 is 1961. That is a convention, and it is the one an identity document's dates need.
 */
export function parseDate(raw: string, order: "mdy" | "dmy" = "mdy"): string | null {
  const s = raw.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  if (s.length === 0) return null;
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) {
    y = +match[1]!; m = +match[2]!; d = +match[3]!;
  } else if ((match = /^(\d{8})$/.exec(s))) {
    y = +s.slice(0, 4); m = +s.slice(4, 6); d = +s.slice(6, 8);
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const a = +match[1]!, b = +match[2]!;
    y = pivot(match[3]!);
    /* A part above twelve can only be the day, whatever the declared order. */
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (b > 12 && a <= 12) { m = a; d = b; }
    else if (order === "mdy") { m = a; d = b; }
    else { d = a; m = b; }
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+)\.? (\d{2}|\d{4})$/.exec(s))) {
    d = +match[1]!; const mo = MONTHS[match[2]!.toLowerCase()]; if (!mo) return null; m = mo; y = pivot(match[3]!);
  } else if ((match = /^([A-Za-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? (\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[match[1]!.toLowerCase()]; if (!mo) return null; m = mo; d = +match[2]!; y = pivot(match[3]!);
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function pivot(year: string): number {
  if (year.length === 4) return +year;
  const n = +year;
  return n < 50 ? 2000 + n : 1900 + n;
}

function daysIn(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/* ───────────────────────────── currency ───────────────────────────── */

/**
 * The symbols and names this grader resolves to a code. The yen sign goes to JPY, which is
 * the convention of the sign itself; a client whose documents mean yuan writes CNY.
 */
const CURRENCY_ALIASES: Record<string, string> = {
  "$": "USD", "us$": "USD", "usd": "USD", "dollar": "USD", "dollars": "USD", "us dollar": "USD", "us dollars": "USD",
  "€": "EUR", "eur": "EUR", "euro": "EUR", "euros": "EUR",
  "£": "GBP", "gbp": "GBP", "pound": "GBP", "pounds": "GBP", "pound sterling": "GBP", "sterling": "GBP",
  "¥": "JPY", "jpy": "JPY", "yen": "JPY",
  "cad": "CAD", "c$": "CAD", "ca$": "CAD", "canadian dollar": "CAD", "canadian dollars": "CAD",
  "aud": "AUD", "a$": "AUD", "au$": "AUD", "australian dollar": "AUD", "australian dollars": "AUD",
  "chf": "CHF", "franc": "CHF", "francs": "CHF", "swiss franc": "CHF", "swiss francs": "CHF",
  "cny": "CNY", "rmb": "CNY", "yuan": "CNY", "renminbi": "CNY",
  "mxn": "MXN", "mx$": "MXN", "peso": "MXN", "pesos": "MXN", "mexican peso": "MXN", "mexican pesos": "MXN",
  "inr": "INR", "₹": "INR", "rupee": "INR", "rupees": "INR",
};

export function parseCurrency(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  if (s.length === 0) return null;
  const alias = CURRENCY_ALIASES[s];
  if (alias) return alias;
  /* Any three letters are accepted as a code: the grader compares, it does not validate
     against the full ISO list, which changes and which the client's documents may lead. */
  if (/^[a-z]{3}$/.test(s)) return s.toUpperCase();
  return null;
}

/* ───────────────────────────── id and free text ───────────────────────────── */

export function parseId(raw: string): string | null {
  const s = raw.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  return s.length > 0 ? s : null;
}

export function parseFreeText(raw: string): string | null {
  /*
   * Only the diacritics of LATIN letters are formatting: "Cafe" for "Café". A combining mark
   * on any other script is meaning: the dakuten that separates the Japanese "pa" from "ha",
   * the vowel signs of Devanagari. The first version stripped every mark after NFD, so
   * two different Japanese words graded equal. Reviewed 2026-09-29. The text is recomposed
   * (NFC) before the punctuation pass so that the marks kept are not swept as punctuation.
   */
  const s = raw.normalize("NFD").replace(/(\p{Script=Latin})[̀-ͯ]+/gu, "$1").normalize("NFC")
    .toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
  return s.length > 0 ? s : null;
}

/* ───────────────────────────── the verdict ───────────────────────────── */

/** The canonical value of a string under a kind, or null when it does not parse. */
export function canonical(raw: string, kind: FieldKind): string | null {
  switch (kind) {
    case "exact": { const n = normaliserReponse(raw); return n.length ? n : null; }
    case "amount": return parseAmount(raw);
    case "amount-grouped": return parseAmountGrouped(raw);
    case "date": return parseDate(raw, "mdy");
    case "date-dmy": return parseDate(raw, "dmy");
    case "currency": return parseCurrency(raw);
    case "id": return parseId(raw);
    case "free-text": return parseFreeText(raw);
  }
}

/**
 * THE ABSENT MARKER: an expected cell that holds exactly "-" says "this document has no such
 * line". A source that returns nothing is then right (clean) and a source that returns a
 * value has invented one (wrong). Before it, a receipt without a tax line was left ungraded,
 * so a vendor that invents a tax was never penalised (audit of 4 October 2026: in CORD, both
 * vendors returned a tax on 1 of the 60 receipts with no tax label). An empty cell still
 * means unknown and is still graded by nobody; only the marker carries the claim.
 */
export const MARQUEUR_ABSENT = "-";
export function attenduAbsent(expected: string): boolean {
  return expected.trim() === MARQUEUR_ABSENT;
}

/**
 * Is `got` right for `expected` under this kind?
 *
 * The default comparison first, so nothing that scored right yesterday scores wrong today;
 * then, only if both sides parse, equality of the parsed values. An empty answer is never
 * right: it is a blank, and blanks are counted apart; except against the absent marker,
 * where an empty answer is the right one.
 */
export function graded(got: string, expected: string, kind: FieldKind = "exact"): boolean {
  if (attenduAbsent(expected)) return normaliserReponse(got).length === 0;
  if (correct(got, expected)) return true;
  if (kind === "exact") return false;
  const a = canonical(got, kind), b = canonical(expected, kind);
  return a !== null && b !== null && a === b;
}

export type Outcome = "clean" | "wrong" | "blank";

/** The three outcomes, with the kind applied: the same partition as `issue()` in journal.ts. */
export function outcome(got: string, expected: string, kind: FieldKind = "exact"): Outcome {
  if (graded(got, expected, kind)) return "clean";
  return normaliserReponse(got).length === 0 ? "blank" : "wrong";
}

/** Can the declared kind read this expected value at all? An unreadable one grades every
    answer wrong, so the command flags it before anything is measured (audit, 2026-10-04). */
export function attenduLisible(expected: string, kind: FieldKind): boolean {
  if (attenduAbsent(expected) || expected.trim() === "") return true;
  if (kind === "exact" || kind === "free-text") return true;
  return canonical(expected, kind) !== null;
}

/**
 * DOES A COLUMN WITHOUT A KIND LOOK LIKE AMOUNTS OR DATES? (client journey audit, 2026-10-05)
 *
 * A client who wrote the header as the site showed it, `id,text,total`, got the default comparison, exact text with
 * separators and case set aside: "$1,234.50" against "1234.50" was wrong on every case, in silence. Reproduced on the
 * CORD receipts with the kinds stripped from the header: google-expense read 4.2 % of totals instead of 93.7 %, and the
 * report looked clean. The expected values are enough to see it coming: when more than half of them parse as an amount
 * or as a date AND carry a mark exact text trips on (a currency sign or code, a decimal or thousands separator, a date
 * separator or a month name), the column is named before anything is graded. Digit-only values are left alone: an id of
 * digits, a year, a count, is not an amount, and `parseAmount` reads "INV-0042" as minus forty-two, which is why the
 * mark is required and the parse alone is not enough.
 */
export type GenreSuggere = { kind: "amount" | "date"; part: number; exemples: string[] } | null;
const MARQUE_MONTANT = /[$€£¥]|(?:^|[^A-Za-z])[A-Z]{3}(?![A-Za-z])|\d[.,]\d|\d \d{3}(?!\d)/;
const MARQUE_DATE = /\d[\/.\-]\d|[A-Za-z]{3,}/;
export function genreSuggere(expected: readonly string[]): GenreSuggere {
  const vals = expected.map((v) => v.trim()).filter((v) => v !== "" && !attenduAbsent(v));
  if (vals.length === 0) return null;
  const montant = (v: string) => parseAmount(v) !== null && MARQUE_MONTANT.test(v);
  const date = (v: string) => parseDate(v, "mdy") !== null && MARQUE_DATE.test(v) && /\d/.test(v);
  for (const [kind, lit] of [["amount", montant], ["date", date]] as const) {
    const vus = vals.filter(lit);
    if (vus.length * 2 > vals.length) return { kind, part: vus.length / vals.length, exemples: [...new Set(vus)].slice(0, 3) };
  }
  return null;
}

/**
 * The conventions a grading rests on, written into every record it produces. A reader who
 * disagrees with one can re-grade; a reader who does not know it was applied cannot.
 */
export const GRADER = {
  version: 1,
  conventions: {
    amount: "one comma followed by exactly three digits groups thousands; any other lone comma is decimal; a lone point is decimal; with both, the last one is decimal; currency symbols and codes are ignored",
    "amount-grouped": "a point or comma followed by exactly three digits groups thousands and a final point or comma followed by exactly two digits is the decimal part, as Indonesian and German receipts print amounts (60.000 is sixty thousand); any other shape is unreadable; Rp, currency symbols and codes are ignored",
    date: "all-numeric dates are read month first unless the kind is date-dmy; a part above twelve is the day; two-digit years pivot at fifty",
    currency: "symbols and common names resolve to ISO 4217 codes; any other three letters are taken as a code",
    id: "only letters and digits count, case does not",
    "free-text": "case, punctuation, diacritics and spacing do not count; word order does",
    exact: "the default comparison of this repository, separators and case set aside",
    absent: "an expected cell that holds exactly \"-\" means the document has no such line: a blank answer is clean and any value is wrong; an empty expected cell means unknown and is graded by nobody",
  },
} as const;
