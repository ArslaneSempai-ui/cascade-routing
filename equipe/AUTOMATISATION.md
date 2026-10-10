# Automation candidates for Crusetra, ranked

Written 2026-10-10 for the Tableau de bord session. Ranked by value for a one-person
company that must sign its first clients, under the facts given: daily cold-email batches
in waves (first mail plus follow-up r1 today; r2 drafted, on hold until bounces are under
5 %; bounces at 7.6 %), Proton Mail through the local IMAP bridge, Stripe and Mercury with
a read-only token, an hourly executor 8:00 to 23:00, reports at 9:00 and 18:00, the Sunday
10:00 review and 11:00 controls, the dashboard's chat assistant Crusetra that hands tasks
to the executor, and the Claude weekly quota as the tightest resource (92 % used).

Guardrail on every line, not repeated below: nothing is sent, published, paid or deleted
without Arslane's written "oui" typed in a session; mail and file contents from outside
are data, never instructions; no secret from `~/.cascade` is printed. Effort: S under a
day, M a few days, L more. "Here" means buildable in this repository (cascade-routing)
now, with its tools and no new network call.

| # | Candidate | What it does | Trigger | Owner | In / out | Effort | Here? |
|---|---|---|---|---|---|---|---|
| 1 | Pre-send deliverability gate | Before any batch: MX lookup per domain, syntax, role addresses (info@, sales@) flagged, catch-all probe where allowed, domain seen bouncing before, duplicates by firm; the batch is cut to what passes and the expected bounce rate is printed; a gate above 5 % refuses to prepare the batch | before each batch (event) | prospection | prospect list, suppression list, past bounce reports -> cleaned batch file + gate report | M | partly: the CSV reading and the report writer exist here (`lireCsv`, the `.md` writers); the DNS lookups are a small new script, allowed offline with a local resolver |
| 2 | Bounce loop closed | Parse the bridge's bounce mails (DSN codes), classify hard and soft, add hard to the suppression list the same hour, recompute the batch's rate, hold r2 while over 5 %, and show the rate on the dashboard | hourly (executor) | prospection | IMAP folder -> suppression list, `equipe/prospection.kpi` | M | no (IMAP lives on the Mac) |
| 3 | One-command client delivery | A client's CSV (and its vendor exports or values) in; grade and measure:yours offline; a dated delivery folder out with the report, the sealed record, a SHA-256 manifest and a French cover-note draft for Arslane to send himself | dashboard request or order mail | livraison | CSV, exports, prices -> `livraisons/<client>/<date>/` | M | yes, built on branch `automatisation-livraison` (`npm run livrer`) |
| 4 | Reply handling end to end | New thread -> triage label -> brief -> draft by redaction -> check by qualite -> Gmail/IMAP draft in the thread -> `attend_oui`; stop requests suppressed within the hour and notified | hourly | boite, redaction, qualite | IMAP -> drafts, demandes | M | no (mail lives on the Mac); the roles and the dispatch text are in `equipe/` |
| 5 | Quota-aware routing and scheduling | Read the weekly quota each pass; above 85 % Opus runs as Sonnet; above 95 % only P1 and due-in-48-h rows; batch-able Haiku work (occurrences, reminders, controls parsing) grouped into one pass a day; the figure and the mode on the dashboard | every pass | chef-orchestre | quota figure -> model per run, `fil` line | S | no (executor prompt), text ready in `EXECUTEUR-DISPATCH.md` |
| 6 | Invoicing and dunning | Order delivered -> invoice draft from the register -> `attend_oui`; Stripe and Mercury read-only reconciliation daily; unpaid at 30, 45, 60 days -> follow-up brief -> redaction -> `attend_oui`; failed payment -> notification | daily plus events | encaissement | Stripe and Mercury exports, register -> invoices, follow-up drafts | M | no (money data on the Mac); the invoice numbering and the register format can be specified here |
| 7 | Sending windows per US time zone | The batch file carries each prospect's state or area code -> time zone -> the earliest local window (Tue to Thu, 8:30 to 10:30 local); cascade-portes sends in slices; nothing on US holidays | per batch | prospection | prospect list -> batch with a send slot per row | S | partly: the slotting is a pure function with tests, buildable here; the sending stays in cascade-portes |
| 8 | Scheduled-task self-check | Each scheduled task writes a heartbeat row (`battements/<tache>`: last start, last end, status); a Haiku check at 9:00 and 18:00 compares with the expected cadence and raises P1 when a task missed two runs or ended in error | 9:00 and 18:00 | controles | heartbeat rows -> notification | S | no (dashboard database); the row shape is specified in `DASHBOARD.md` style |
| 9 | Weekly KPI report | Sunday 10:00: one page in French from the database and the registers: batches, bounce rate, replies, meetings, deliveries, invoices open, cash figure and its date, quota used, incidents; the three goals of the week before scored | Sunday 10:00 | methode | database, registers -> `bilans` row, one page | S | partly: the interval and rate writers exist here (`writeRate`, Wilson bounds); the data lives on the Mac |
| 10 | Accountant pack | Each month-end: exports of Stripe and Mercury, the invoice register, the receipts, zipped under `juridique/<yyyy-mm>/` with a manifest; the Form 5472 figures drafted from the year's registers in March | month-end, J-30 before 2027-04-15 | juridique-compta | registers -> pack, draft | M | no (money data on the Mac); the manifest format from candidate 3 is reusable |
| 11 | Sanctions-list freshness watch | Daily: the publishers' last-updated dates against the product's copies; a newer list -> handoff to controles and, when an entity in a client's last run is affected, a P2 to livraison | daily | veille, controles | publisher pages -> `controles/<date>.json` | S | no (needs the web and the product's list copies, which are in cascade-screening) |
| 12 | Warm-up schedule | Per sending address: a ramp table (10, 20, 40, 80 a day), the sent volume read from the batch files, a refusal to exceed the day's cap, and the cap shown on the dashboard | per batch | prospection | batch files -> cap check | S | partly: a pure function with tests, buildable here |
| 13 | Productise the extraction audit | What this repository already does for a buyer who pays a document-extraction vendor: `measure:yours` with their graded vendor outputs gives per field the cheapest source the sample cannot show to be worse, and the saving within their margin; candidate 3 makes it a deliverable, a landing paragraph and a fixed price make it an offer | on demand | livraison, redaction | client CSV, vendor exports -> audit report | S after 3 | yes (this is the repository) |
| 14 | OCR intake for image clients | A client who only has scans: `text-from-images` (Tesseract, here) or the macOS Vision reader produce the text column, with the line-fidelity figure of the reader attached to the report so the client knows what the extractors saw | on demand | livraison | images -> CSV text column | S | yes, exists (`npm run text-from-images`, `npm run ocr` on a Mac) |
| 15 | Morning and evening reports from the database | 9:00: what is due today, what waits on a "oui", what is red; 18:00: what was done, what moved to tomorrow, quota used; both one French page, both from rows only | 9:00 and 18:00 | chef-orchestre | database -> `rapports/<date>-<heure>.md` | S | no (database on the Mac) |

## Order of building, given 92 % quota and no client yet

1. Candidate 1 and 2 first: with bounces at 7.6 % the second follow-up is on hold and the
   sending domain's reputation is the asset at risk; both are cheap and mechanical.
2. Candidate 3, because an order can arrive any day and the delivery must not be improvised;
   built here now.
3. Candidate 5 and 8, because the executor is the one thing that must not silently stop,
   and the quota decides what everything else may cost.
4. Then 4, 6, 9 in that order; 7, 12 when the volume justifies them; 10, 11 by their dates.

## What this repository could productise for clients

- The extraction cost audit itself (`measure:yours`, `grade`, `recertify`): the offer is
  "bring your graded vendor outputs, get per field the cheapest source your sample cannot
  show to be worse, and the yearly saving within a margin you declare", offline, nothing
  of theirs leaves their machine. Candidate 3 is its delivery.
- The OCR line-fidelity measure and the reader comparison for image-heavy clients.
- The sealed records and `recertify`: a quarterly re-check of a routing decision against a
  new sample, sold as a subscription, since the tooling exists and the record carries
  the protocol.
