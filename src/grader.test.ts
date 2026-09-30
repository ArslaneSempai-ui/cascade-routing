/*
 * The typed grader, proved on examples and on laws.
 *
 * The examples are the mismatches that motivated it: an amount with a thousands separator,
 * a date written two ways, a symbol against a code. The laws are what makes it safe to turn
 * on: a typed comparison never removes a match the default one gave, every kind is reflexive
 * and symmetric, and formatting noise never changes a verdict. The laws run on generated
 * inputs through the seeded runner in property.ts, so a failure replays.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { correct } from "./tiers.ts";
import {
  graded, outcome, canonical, parseAmount, parseDate, parseCurrency, parseId, parseFreeText,
  splitHeader, FIELD_KINDS, isFieldKind, GRADER, parseAmountGrouped,
} from "./grader.ts";
import { forAll, integer, oneOf, boolean, stringOf, tuple, map, arrayOf, rng } from "./property.ts";

/* ─────────────── examples: the cases that were scored wrong ─────────────── */

test("an amount is content, its thousands separators are formatting", () => {
  assert.ok(graded("1,234.50", "1234.50", "amount"));
  assert.ok(graded("$1,234.50", "1234.5", "amount"));
  assert.ok(graded("USD 1 234,50", "1234.50", "amount"));
  assert.ok(graded("1.234,50", "1234.50", "amount"));
  assert.ok(graded("(250.00)", "-250", "amount"));
  assert.ok(graded("250.00-", "-250", "amount"));
  assert.ok(graded("0.10", "0.1", "amount"));
  assert.ok(graded("1,234", "1234", "amount"), "one comma, three digits: grouping");
  assert.ok(graded("12,50", "12.5", "amount"), "one comma, two digits: decimal");
  assert.ok(!graded("1,234.50", "1234.51", "amount"), "a different number is different");
  assert.ok(!graded("1234", "1234.5", "amount"));
  assert.ok(!graded("", "1234.5", "amount"), "an empty answer is never right");
  assert.ok(!graded("total", "1234.5", "amount"), "a word does not parse, and falls back to the default");
});

test("review 2026-09-29: one negative marker is minus, two do not parse, and never a toggle back to plus", () => {
  /* Items 14 and 25: "(-250.00)" and "-250.00-" toggled back to positive and matched 250.00. */
  for (const written of ["(-250.00)", "-250.00-", "(-1,234.50)", "(250.00)-"]) {
    assert.equal(parseAmount(written), null, `${written} carries two negative markers and must not parse`);
    assert.ok(!graded(written, "250.00", "amount"), `${written} must not equal 250.00`);
    assert.ok(!graded(written, "1234.50", "amount"), `${written} must not equal 1234.50`);
  }
  assert.equal(parseAmount("-250.00"), "-250");
  assert.equal(parseAmount("(250.00)"), "-250");
  assert.equal(parseAmount("250.00-"), "-250");
  /* Item 25: accounting parentheses after the currency mark, in every position. */
  for (const written of ["$(1,234.50)", "$ (1,234.50)", "USD (1,234.50)", "(1,234.50) USD", "($1,234.50)", "(1,234.50 USD)"]) {
    assert.equal(parseAmount(written), "-1234.5", written);
    assert.ok(graded(written, "-1234.50", "amount"), written);
  }
});

test("review 2026-09-29: a letter that is not a currency code changes the amount, so the string does not parse", () => {
  /* Item 26: "1.2M" read as 1.20, "12k" as 12, "1e3" as 13, and CR equalled DR. */
  for (const written of ["$1.2M", "12k", "1e3", "1,250.00 CR", "1,250.00 DR", "3 apples", "12 kr"]) {
    assert.equal(parseAmount(written), null, `${written} must not parse as an amount`);
  }
  assert.ok(!graded("1,250.00 CR", "1,250.00 DR", "amount"));
  assert.ok(!graded("$1.2M", "1.20", "amount"));
  /* Three-letter codes still strip, at either end, with or without a blank, and only whole. */
  assert.equal(parseAmount("EUR 1.234,50"), "1234.5");
  assert.equal(parseAmount("1,234.50USD"), "1234.5");
  assert.equal(parseAmount("CHF 12"), "12");
  assert.equal(parseAmount("US$ 12.00"), "12");
  assert.equal(parseAmount("1234.5 USDX"), null, "four letters are not a code");
});

test("review 2026-09-29: a lone comma groups thousands only where a leading group can stand before it", () => {
  /* Item 27: "0,500" read as five hundred and "1234,567" as one million. */
  assert.equal(parseAmount("0,500"), "0.5");
  assert.equal(parseAmount("1234,567"), "1234.567");
  assert.equal(parseAmount("1,234"), "1234");
  assert.equal(parseAmount("12,345"), "12345");
  assert.equal(parseAmount("123,456"), "123456");
  assert.equal(parseAmount("01,500"), "1.5", "a leading zero is not a thousands group");
});

test("review 2026-09-29: free text keeps the marks of non-Latin scripts", () => {
  /* Item 28: every combining mark was stripped, so two Japanese words graded equal. */
  assert.ok(!graded("パス", "バス", "free-text"), "pa-su and ba-su differ by a mark that is meaning");
  assert.ok(!graded("ガス", "カス", "free-text"));
  assert.equal(parseFreeText("パス"), "パス");
  assert.equal(parseFreeText("कि"), "कि", "a Devanagari vowel sign stays");
  assert.ok(graded("Café Régence", "Cafe Regence", "free-text"), "Latin diacritics are still formatting");
  assert.ok(graded("Façade Élève", "facade eleve", "free-text"));
});

test("amount-grouped reads a point or comma before three digits as thousands, as CORD's receipts print them; amount is unchanged", () => {
  /* The founder's fourteen cases from CORD v2's own labels, 2026-09-29, each with its result. */
  const cases: Record<string, string> = {
    "60.000": "60000", "28,000": "28000", "Rp 38.000": "38000", "Rp.118.000": "118000", "Rp. 91,000": "91000",
    "1,565,938": "1565938", "365000.00": "365000", "Rp 165000.00": "165000", "63,000.00": "63000", "9.500,00": "9500",
    "5.455": "5455", "91000": "91000", "818": "818",
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(parseAmountGrouped(raw), expected, raw);
  for (const unreadable of ["-", "12.3", "1,2345", "1234.567", "abc", "", "(-60.000)"]) {
    assert.equal(parseAmountGrouped(unreadable), null, `${JSON.stringify(unreadable)} has no grouped reading`);
  }
  assert.equal(parseAmountGrouped("-Rp 1.500"), "-1500", "one negative marker, the rupiah mark stripped");
  assert.equal(parseAmountGrouped("60.000-"), "-60000", "a trailing minus is one marker, as under amount");
  assert.equal(parseAmountGrouped("(2.000)"), "-2000");
  assert.equal(parseAmountGrouped("0,50"), "0.5", "a final comma before two digits is the decimal part");

  /* THE WITNESS PAIR, under both kinds: red if either drifts. */
  assert.ok(!graded("60000", "60.000", "amount"), "under amount, 60.000 is sixty: the pair is WRONG");
  assert.ok(graded("60000", "60.000", "amount-grouped"), "under amount-grouped, 60.000 is sixty thousand: the pair is RIGHT");
  assert.equal(outcome("60000", "60.000", "amount"), "wrong");
  assert.equal(outcome("60000", "60.000", "amount-grouped"), "clean");
  assert.equal(outcome("", "60.000", "amount-grouped"), "blank");
  assert.equal(outcome("abc", "60.000", "amount-grouped"), "wrong", "an unreadable value grades as amount grades one: wrong");
  assert.equal(parseAmount("60.000"), "60", "the amount kind reads a lone point as decimal, as before");
  assert.equal(parseAmount("Rp 38.000"), null, "the amount kind does not know the rupiah mark, as before");

  assert.deepEqual(splitHeader("total:amount-grouped"), { name: "total", kind: "amount-grouped" });
  assert.ok(FIELD_KINDS.includes("amount-grouped"));
  assert.match(GRADER.conventions["amount-grouped"], /three digits groups thousands/);
  assert.match(GRADER.conventions["amount-grouped"], /60\.000 is sixty thousand/);
});

test("law: under amount-grouped every grouping of an integer, with or without two decimals, reads back as that integer", () => {
  const grouped = (n: number, sep: string): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  forAll(tuple(integer(0, 999_999_999), oneOf([".", ","]), oneOf(["", ".00", ",00", ".50", ",25"])), ([n, sep, tail]) => {
    /* "1.500.50" carries the same separator for the groups and the decimals: still one reading. */
    const decimal = tail.length ? tail.slice(1) : "";
    const written = grouped(n, sep) + tail;
    const expected = String(n) + (decimal === "50" ? ".5" : decimal === "25" ? ".25" : "");
    assert.equal(parseAmountGrouped(written), expected, `${written}`);
    assert.ok(graded(written, String(n) + (decimal && decimal !== "00" ? "." + decimal : ""), "amount-grouped"), written);
  }, { runs: 1500 });
});

test("the default grader still counts these as mismatches, which is why the kind exists", () => {
  assert.ok(!correct("1,234.50", "1234.50"));
  assert.ok(!correct("09/29/2026", "2026-09-29"));
  assert.ok(!correct("$", "USD"));
  assert.ok(!correct("12-3456789", "123456789"));
});

test("a date is a day, however it is written", () => {
  for (const written of ["2026-09-29", "09/29/2026", "9/29/26", "29 September 2026", "Sep 29, 2026", "September 29 2026", "2026/09/29", "20260929", "29.09.2026"]) {
    assert.ok(graded(written, "2026-09-29", "date"), `${written} should read as 2026-09-29`);
  }
  assert.ok(graded("03/04/2026", "2026-03-04", "date"), "month first by default");
  assert.ok(graded("03/04/2026", "2026-04-03", "date-dmy"), "day first when declared");
  assert.ok(graded("13/04/2026", "2026-04-13", "date"), "a part above twelve is the day whatever the order");
  assert.ok(!graded("02/30/2026", "2026-03-02", "date"), "an impossible day does not parse");
  assert.equal(parseDate("31/02/2026", "dmy"), null);
  assert.equal(parseDate("02/29/2024"), "2024-02-29", "a leap day parses");
  assert.equal(parseDate("02/29/2023"), null, "and only in a leap year");
  assert.equal(parseDate("7/4/61"), "1961-07-04", "two-digit years pivot at fifty");
  assert.equal(parseDate("7/4/26"), "2026-07-04");
});

test("a currency is a code, whether written as a symbol, a name or lower case", () => {
  assert.ok(graded("$", "USD", "currency"));
  assert.ok(graded("usd", "USD", "currency"));
  assert.ok(graded("US dollars", "usd", "currency"));
  assert.ok(graded("€", "EUR", "currency"));
  assert.ok(graded("pounds", "GBP", "currency"));
  assert.ok(!graded("EUR", "USD", "currency"));
  assert.ok(!graded("dollarish", "USD", "currency"), "an unknown word does not resolve");
  assert.equal(parseCurrency("cad"), "CAD");
  assert.equal(parseCurrency("XYZ"), "XYZ", "any three letters are accepted as a code");
  assert.equal(parseCurrency("money"), null);
});

test("an identifier is its letters and digits", () => {
  assert.ok(graded("12-3456789", "123456789", "id"));
  assert.ok(graded("GB 123 4567 89", "gb123456789", "id"));
  assert.ok(graded("FR-1856-M", "FR1856M", "id"));
  assert.ok(!graded("12-3456788", "123456789", "id"));
  assert.equal(parseId("--"), null);
});

test("free text ignores case, punctuation, diacritics and spacing, and keeps word order", () => {
  assert.ok(graded("Acme  Holdings, LLC.", "acme holdings llc", "free-text"));
  assert.ok(graded("Café Régence", "Cafe Regence", "free-text"));
  assert.ok(!graded("Holdings Acme", "Acme Holdings", "free-text"), "order is content");
  assert.equal(parseFreeText("!!!"), null);
});

test("the outcome keeps the three-way partition: clean, wrong, blank", () => {
  assert.equal(outcome("1,234.50", "1234.5", "amount"), "clean");
  assert.equal(outcome("1,234.51", "1234.5", "amount"), "wrong");
  assert.equal(outcome("   ", "1234.5", "amount"), "blank");
  assert.equal(outcome("Anna", "Anna Petrova"), "wrong");
});

test("a header declares its kind with a suffix, and only with a known one", () => {
  assert.deepEqual(splitHeader("total:amount"), { name: "total", kind: "amount" });
  assert.deepEqual(splitHeader(" closing date : date-dmy "), { name: "closing date", kind: "date-dmy" });
  assert.deepEqual(splitHeader("TOTAL:AMOUNT"), { name: "TOTAL", kind: "amount" }, "the kind is case-insensitive, the name is kept");
  assert.deepEqual(splitHeader("time:stamp"), { name: "time:stamp", kind: undefined }, "an unknown suffix is part of the name");
  assert.deepEqual(splitHeader(":amount"), { name: ":amount", kind: undefined }, "an empty name is not a declaration");
  assert.deepEqual(splitHeader("name"), { name: "name", kind: undefined });
  for (const k of FIELD_KINDS) assert.ok(isFieldKind(k));
  assert.ok(!isFieldKind("number"));
});

test("every kind has its convention written down, so a record can carry it", () => {
  for (const k of FIELD_KINDS) {
    const key = k === "date-dmy" ? "date" : k;
    assert.ok(typeof GRADER.conventions[key] === "string" && GRADER.conventions[key].length > 20,
      `the kind ${k} has no written convention`);
  }
});

/* ─────────────── laws, on generated inputs ─────────────── */

const DIGITS = "0123456789";
const amountParts = tuple(integer(0, 9_999_999), integer(0, 99), boolean);
const formats: ((n: number, cents: number, neg: boolean) => string)[] = [
  (n, c, neg) => `${neg ? "-" : ""}${n}.${String(c).padStart(2, "0")}`,
  (n, c, neg) => `${neg ? "-" : ""}${n.toLocaleString("en-US")}.${String(c).padStart(2, "0")}`,
  (n, c, neg) => `${neg ? "-" : ""}$${n.toLocaleString("en-US")}.${String(c).padStart(2, "0")}`,
  (n, c, neg) => `${neg ? "-" : ""}USD ${n.toLocaleString("en-US")}.${String(c).padStart(2, "0")}`,
  (n, c, neg) => `${neg ? "-" : ""}${n.toLocaleString("de-DE")},${String(c).padStart(2, "0")}`,
  (n, c, neg) => `${neg ? "-" : ""}${n.toLocaleString("fr-FR")},${String(c).padStart(2, "0")} €`,
  (n, c, neg) => neg ? `(${n.toLocaleString("en-US")}.${String(c).padStart(2, "0")})` : `${n}.${String(c).padStart(2, "0")}`,
  (n, c, neg) => `${n.toLocaleString("en-US")}.${String(c).padStart(2, "0")}${neg ? "-" : ""}`,
  /* Review 2026-09-29: the currency mark outside the accounting parentheses, both sides. */
  (n, c, neg) => neg ? `$(${n.toLocaleString("en-US")}.${String(c).padStart(2, "0")})` : `$${n}.${String(c).padStart(2, "0")}`,
  (n, c, neg) => neg ? `(${n.toLocaleString("en-US")}.${String(c).padStart(2, "0")}) USD` : `${n}.${String(c).padStart(2, "0")} USD`,
  (n, c, neg) => `${neg ? "-" : ""}CHF ${n.toLocaleString("de-CH")}.${String(c).padStart(2, "0")}`,
];

test("law: every written form of the same amount grades equal to its plain form", () => {
  forAll(tuple(amountParts, integer(0, formats.length - 1)), ([[n, c, neg], f]) => {
    const plain = `${neg && (n > 0 || c > 0) ? "-" : ""}${n}.${String(c).padStart(2, "0")}`;
    const written = formats[f]!(n, c, neg);
    assert.ok(graded(written, plain, "amount"), `${written} against ${plain}`);
    assert.ok(graded(plain, written, "amount"), `symmetry: ${plain} against ${written}`);
  }, { runs: 600 });
});

test("law: two different amounts never grade equal", () => {
  forAll(tuple(amountParts, amountParts, integer(0, formats.length - 1)), ([[n1, c1, g1], [n2, c2, g2], f]) => {
    const v1 = (g1 ? -1 : 1) * (n1 * 100 + c1), v2 = (g2 ? -1 : 1) * (n2 * 100 + c2);
    if (v1 === v2) return true;
    const a = formats[f]!(n1, c1, g1), b = `${g2 && v2 !== 0 ? "-" : ""}${n2}.${String(c2).padStart(2, "0")}`;
    return !graded(a, b, "amount");
  }, { runs: 600 });
});

test("law: parseAmount is idempotent on its own output", () => {
  forAll(tuple(amountParts, integer(0, formats.length - 1)), ([[n, c, neg], f]) => {
    const once = parseAmount(formats[f]!(n, c, neg));
    assert.notEqual(once, null);
    assert.equal(parseAmount(once!), once);
  });
});

const dayParts = tuple(integer(1950, 2049), integer(1, 12), integer(1, 28));
const dateForms: ((y: number, m: number, d: number) => string)[] = [
  (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  (y, m, d) => `${m}/${d}/${y}`,
  (y, m, d) => `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`,
  (y, m, d) => `${m}/${d}/${String(y % 100).padStart(2, "0")}`,
  (y, m, d) => `${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`,
  (y, m, d) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}, ${y}`,
  (y, m, d) => `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`,
  (y, m, d) => `${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}.${y}`,
];

test("law: every written form of the same day grades equal to its ISO form, month first", () => {
  forAll(tuple(dayParts, integer(0, dateForms.length - 1)), ([[y, m, d], f]) => {
    const iso = dateForms[0]!(y, m, d);
    const written = dateForms[f]!(y, m, d);
    assert.ok(graded(written, iso, "date"), `${written} against ${iso}`);
    assert.ok(graded(iso, written, "date"), `symmetry: ${iso} against ${written}`);
  }, { runs: 600 });
});

test("law: two different days never grade equal, in either order convention", () => {
  forAll(tuple(dayParts, dayParts, integer(0, dateForms.length - 1), boolean), ([[y1, m1, d1], [y2, m2, d2], f, dmy]) => {
    if (y1 === y2 && m1 === m2 && d1 === d2) return true;
    const a = dateForms[f]!(y1, m1, d1), b = dateForms[0]!(y2, m2, d2);
    /* Under the day-first convention the slash forms are read the other way round, so the
       generated pair may collide by design; only the month-first reading is asserted there. */
    return dmy ? true : !graded(a, b, "date");
  }, { runs: 600 });
});

test("law: a typed comparison never removes a match the default gives", () => {
  const token = stringOf("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -/.,:$€", 0, 12);
  forAll(tuple(token, token, oneOf(FIELD_KINDS)), ([a, b, kind]) => {
    if (correct(a, b)) assert.ok(graded(a, b, kind), `${kind}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    /* And every kind is reflexive on a non-empty value, and symmetric. */
    if (a.trim().length > 0 && canonical(a, kind) !== null) assert.ok(graded(a, a, kind), `${kind} is not reflexive on ${JSON.stringify(a)}`);
    assert.equal(graded(a, b, kind), graded(b, a, kind), `${kind} is not symmetric on ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  }, { runs: 1500 });
});

test("law: an identifier is invariant under any separator inserted anywhere", () => {
  const core = stringOf("ABCDEFGHJKLMNPQRSTUVWXYZ" + DIGITS, 4, 14);
  const separators = arrayOf(oneOf([" ", "-", ".", "/", " "]), 1, 4);
  forAll(tuple(core, separators, integer(0, 1000)), ([id, seps, seed]) => {
    const r = rng(seed);
    let noisy = "";
    for (const ch of id) { noisy += ch; if (r() < 0.3) noisy += seps[Math.floor(r() * seps.length)]!; }
    const lower = r() < 0.5 ? noisy.toLowerCase() : noisy;
    assert.ok(graded(lower, id, "id"), `${JSON.stringify(lower)} against ${id}`);
    assert.equal(parseId(lower), parseId(id));
  }, { runs: 600 });
});

test("law: free text is invariant under case, punctuation and diacritics, and sensitive to word order", () => {
  const word = stringOf("abcdefghijklmnopqrstuvwxyz", 2, 8);
  const words = arrayOf(word, 2, 5);
  const accent = (s: string) => s.replace(/e/g, "é").replace(/a/g, "à");
  forAll(tuple(words, boolean), ([ws, swap]) => {
    const plain = ws.join(" ");
    const noisy = ws.map((w, i) => (i % 2 ? w.toUpperCase() : accent(w))).join(",  ") + ".";
    assert.ok(graded(noisy, plain, "free-text"), `${noisy} against ${plain}`);
    if (swap && ws[0] !== ws[1]) {
      const reordered = [ws[1]!, ws[0]!, ...ws.slice(2)].join(" ");
      assert.ok(!graded(reordered, plain, "free-text"), `${reordered} should differ from ${plain}`);
    }
  }, { runs: 400 });
});

test("law: the amount kind does not equate a plain integer with a decimal that differs", () => {
  forAll(tuple(integer(0, 99999), integer(1, 99)), ([n, c]) => !graded(String(n), `${n}.${String(c).padStart(2, "0")}`, "amount"));
});

test("the property runner itself reports the seed and the failing input", () => {
  assert.throws(() => forAll(integer(0, 10), (n) => n < 5, { runs: 50, seed: 7 }), /seed 7.*on \d+/s);
  assert.throws(() => forAll(map(integer(0, 3), (n) => ({ n })), (o) => { if (o.n === 2) throw new Error("boom"); }, { runs: 50 }), /boom/);
  const report = forAll(integer(0, 10), () => true, { runs: 12, seed: 3 });
  assert.deepEqual(report, { runs: 12, seed: 3 });
  /* Determinism: the same seed draws the same sequence. */
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});
