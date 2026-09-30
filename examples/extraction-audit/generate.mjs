/**
 * The synthetic receipts of the extraction-audit example, and why they are synthetic.
 *
 * The example wanted a public labelled receipts dataset whose licence allows redistribution.
 * Three were checked on 2026-09-29:
 *
 *   CORD    clovaai/cord on GitHub carries a LICENSE-CC-BY file and states CC BY 4.0, which
 *           allows redistribution with attribution. Its data is hosted on Google Drive and on
 *           the Hugging Face hub, and neither host was reachable from the environment that
 *           wrote this example (network policy). Nothing of it is in this repository.
 *   SROIE   the ICDAR 2019 competition site (rrc.cvc.uab.es) was not reachable, so its terms
 *           could not be read; it is not used.
 *   FUNSD   its page (guillaumejaume.github.io/FUNSD) was not reachable, so its terms could
 *           not be read; it is not used.
 *
 * So the example is SYNTHETIC: a seeded generator, this file, writes every receipt. No shop,
 * no person and no number in them is real, and each text says so. When a machine can reach
 * the hub, CORD is the candidate to replace them, with its citation.
 *
 * What the generator writes:
 *   receipts.csv          id, text, and four fields with declared kinds
 *   vendor-a-values.json  what an invented vendor "returned": mostly right, written in other
 *                         formats (the typed grader's whole point), and wrong on purpose on a
 *                         known share of cases
 *   vendor-b-values.json  a second invented vendor, cheaper and worse on one field
 *
 *   node examples/extraction-audit/generate.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
let state = 20260929;
const random = () => ((state = (state * 1_664_525 + 1_013_904_223) >>> 0) / 4_294_967_296);
const pick = (xs) => xs[Math.floor(random() * xs.length)];
const int = (a, b) => a + Math.floor(random() * (b - a + 1));

const SHOPS = ["SAMPLE MART", "DEMO GROCERS", "PLACEHOLDER CAFE", "FICTIONAL FUELS", "EXAMPLE PHARMACY", "TEST HARDWARE"];
const ITEMS = ["Milk", "Bread", "Coffee", "Batteries", "Paper", "Apples", "Soap", "Tape", "Rice", "Tea"];
const CURRENCIES = ["USD", "USD", "USD", "EUR", "GBP"];
const SYMBOL = { USD: "$", EUR: "EUR ", GBP: "GBP " };

const N = 60;
const rows = [["id", "text", "total:amount", "receipt_date:date", "receipt_id:id", "currency:currency"]];
const vendorA = {};
const vendorB = {};

const csvCell = (s) => `"${String(s).replace(/"/g, "\"\"")}"`;

for (let i = 1; i <= N; i++) {
  const id = `R-${String(i).padStart(4, "0")}`;
  const shop = pick(SHOPS);
  const currency = pick(CURRENCIES);
  const lines = int(1, 4);
  let cents = 0;
  const bought = [];
  for (let k = 0; k < lines; k++) {
    const c = int(99, 4999);
    cents += c;
    bought.push(`${pick(ITEMS)} ${(c / 100).toFixed(2)}`);
  }
  const total = (cents / 100).toFixed(2);
  const y = 2026, m = int(1, 12), d = int(1, 28);
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const printedDate = pick([`${m}/${d}/${y}`, `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`, iso]);
  const receiptId = `${shop.split(" ")[0].slice(0, 2)}${int(100000, 999999)}`;
  const printedId = pick([receiptId, `${receiptId.slice(0, 2)}-${receiptId.slice(2)}`, `${receiptId.slice(0, 2)} ${receiptId.slice(2, 5)} ${receiptId.slice(5)}`]);
  const text = `${shop} (synthetic receipt, no real shop) ${printedDate} Receipt No. ${printedId} ${bought.join(" ")} `
    + `TOTAL ${SYMBOL[currency]}${total} paid in ${currency} thank you`;
  rows.push([id, csvCell(text), total, iso, receiptId, currency]);

  /* Vendor A: right on most cases, in its own formats; wrong on a known share. */
  const a = {};
  a.total = random() < 0.92 ? pick([total, total.replace(".", ","), `${SYMBOL[currency]}${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`]) : (Number(total) + 1).toFixed(2);
  a.receipt_date = random() < 0.95 ? pick([iso, `${m}/${d}/${y}`, `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`]) : "";
  a.receipt_id = random() < 0.9 ? printedId : printedId.slice(0, -1);
  a.currency = random() < 0.97 ? pick([currency, currency.toLowerCase(), SYMBOL[currency].trim() || currency]) : "";
  vendorA[id] = a;

  /* Vendor B: as good on the amount and the date, blind to the identifier, mixed on currency. */
  const b = {};
  b.total = random() < 0.9 ? total : "";
  b.receipt_date = random() < 0.93 ? printedDate : "";
  b.receipt_id = random() < 0.55 ? printedId : "";
  b.currency = random() < 0.85 ? currency : "USD";
  vendorB[id] = b;
}

writeFileSync(HERE + "receipts.csv", rows.map((r) => r.join(",")).join("\n") + "\n");
writeFileSync(HERE + "vendor-a-values.json", JSON.stringify(vendorA, null, 2) + "\n");
writeFileSync(HERE + "vendor-b-values.json", JSON.stringify(vendorB, null, 2) + "\n");
console.log(`${N} synthetic receipts written to ${HERE}`);
