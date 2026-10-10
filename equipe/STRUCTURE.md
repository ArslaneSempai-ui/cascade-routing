# Crusetra: the structure behind the dashboard

Design note, 2026-10-10. Current state after the amendments at the end of this file: nine
departments (Direction, Commercial, Clients, Delivery with Data and Product, Finance,
Infrastructure, Compliance, DEV, Marketing), 37 roles in `agents/`, the budget role on
the Sun; `LISEZ-MOI.md` has the one-page summary. Three structures were weighed for the agents behind the Crusetra
Dashboard. The third is recommended; the reasons follow each option, then the decisions
that hold whatever the structure.

## What the structure must carry

- One scheduled executor (hourly, 8:00 to 23:00 Athens) that reads `demandes`, works each
  due row with one subagent, verifies, writes back.
- Work that touches outsiders, money, law or data is prepared, never done: Arslane's written
  "oui" in a session is the only yes. A dashboard row is not a yes.
- A small company: one person, a few clients, cold-email waves, Stripe and Mercury, one
  accountant, three fixed legal deadlines. Anything heavier than that is overhead.

## Option A: a flat list of roles

Eight roles side by side (chef, prospection, boite, encaissement, controles,
juridique-compta, redaction, veille), each with one job, the executor dispatching.

- For: the simplest to read and to install; one file per role; no ceremony.
- Against: nobody owns the paid work itself (screening runs, routing audits, client
  reports); the executor verifies its own dispatch, so doer and checker are the same agent;
  nothing reads the week and proposes changes; the eight roles have no grouping, so the
  dashboard would show eight dots of equal weight.

## Option B: a minimal trio

Three agents: chef (dispatch and verification), operations (everything mechanical:
batches, inbox triage, controls, registers), redaction (every outward text, Opus).

- For: the cheapest in tokens and in attention; few handoffs.
- Against: "operations" is five jobs under one name, which is the generic subagent again
  with a new label; one agent holding Gmail, Stripe, Mercury and the shell at once is a
  wider blast radius than the ladder allows; no delivery role either.

## Option C (recommended): six departments, eleven roles, doer and checker apart

| Department | Roles | Why it exists |
|---|---|---|
| Direction | Arslane decides; `chef-orchestre` (the executor) dispatches and escalates; `qualite` checks other roles' output before it reaches Arslane; `methode` reads the week on Sunday and proposes changes to the agents' instructions | Decision, verification and improvement are three different jobs; merging them is how a generic agent grades its own homework |
| Commercial | `prospection` (batches, follow-ups, bounces, list hygiene), `boite` (inbox triage, routing, stop requests) | Outbound and inbound are two rhythms and two tool sets |
| Delivery | `livraison` (the paid work: screening runs, routing audits, reports for paying clients) | Nothing covered it; it is what the invoices are for |
| Finance | `encaissement` (payments, receipts, invoices, registers, Mercury cash figure), `juridique-compta` (deadlines, accountant pack, filings) | Cash and compliance share documents but not rhythms |
| Infrastructure | `controles` (domain, site, backups, secrets, sanctions-list freshness) | Mechanical, cheap, frequent; the first to raise a P1 |
| Growth | `redaction` (every outward text, always a draft), `veille` (market, competitors, list updates) | Texts for outsiders are judged work (Opus); watching is reading (Sonnet) |

Eleven roles is more files than Option A, not more running cost: a pass spawns only the
roles that have a due demande, and most hours that is zero or one.

- For: every demande has an owner, including the paid work; an independent checker
  (`qualite`) sits between a doer and Arslane for anything an outsider will see or that
  money depends on; a weekly loop (`methode`) turns escalations into proposed instruction
  changes instead of repeated incidents; departments give the dashboard its rings.
- Against: two more handoffs per outward text (doer to redaction to qualite). Accepted:
  those are exactly the texts where a second reading is worth its cost.

## Decisions that hold whatever the structure

**Budget rule, owned by the chef, not a role.** A rule needs no agent. At weekly quota
at or above 85 %, Opus becomes Sonnet; at or above 95 %, only P1 incidents and demandes
with `echeance` within 48 hours are worked, the rest stays `a_faire` with a `fil` line
saying why. The chef reads the figure where the dashboard keeps it; until it keeps one,
the figure is unknown and the 85 % rule applies as written to what the chef can see.

**Severity, three levels, mapped onto the ladder.**
- P1 incident: red control, failed payment, dispute, stop or unsubscribe request, bounce
  rate over 5 % on a batch. Push notification at once, in French, then a demande
  `a_toi`.
- P2 decision needed today: anything that sends, publishes, pays, deletes or commits
  Arslane. Prepared, `statut: attend_oui`, never done.
- P3 information: goes to the Sunday review (`bilans`), nothing before.

**Handoffs are demandes.** A role that needs another role creates a new demande with
`role` (target), `de_role` (origin), `titre` starting with the origin role in brackets,
and writes one line in the `fil` timeline: `[de_role] -> [role] : <one line>`. The chef
dispatches it on the next pass; nothing is called directly between roles.

**KPIs, one or two per role, measured from files or the database, never typed.**
`prospection`: batches sent after a "oui" this week, bounce rate of the last batch.
`boite`: mails older than 24 h without a triage decision. `livraison`: client
deliverables due within 7 days and their state. `recouvrement`: open invoices older
than 30 days. `tresorier`: cash figure date, runway. `comptable`: days to the next deadline.
`controles`: red controls now, age of the last green backup. `redaction`: drafts
awaiting a "oui". `veille`: days since the last sanctions-list update seen.
`qualite`: returns to the doer this week. `methode`: proposals accepted of proposals
made. `chef-orchestre`: demandes worked this pass, demandes `bloque`.

**Models.** Haiku for mechanical work, Sonnet by default, Opus for anything judged: texts
for outsiders, money, law, strategy. Per role: `controles` Haiku; `chef-orchestre`,
`prospection`, `boite`, `livraison`, `veille`, `qualite` Sonnet; `tresorier`,
`comptable`, `recouvrement`, `redaction`, `methode` Opus. The role's floor wins over a lower
`modele` on the row; the budget rule wins over both.

**What was weighed and left out.** A separate "budget" agent (a rule, not a job). A
"client success" role apart from `boite` (one inbox, one triage, until there are more
clients than days). A "security" role apart from `controles` (same checks, same hour).

## Amendments of 2026-10-10: Marketing and DEV

- **Growth is absorbed by Marketing** (`MARKETING.md`, planet Uranus): `mkt-veille` takes
  the market watch; `redaction` stays with Commercial for the operational texts (replies,
  follow-ups, dunning); `veille` keeps the sanctions-list freshness only and reports to
  Infrastructure. Seven marketing roles, one job each, Opus for the strategist, the writer
  and the visual designer.
- **DEV is a department** (`DEV.md`, the station in Earth orbit): eight roles built on
  Arslane's existing `executant`, `verificateur` and `lecteur` agents; a board from `idee` to
  `livre`; the suite's colour per repository and the quota spent on dev on the dashboard.
- The budget split of the quota by department lives in `COEUR.md`.

## Amendments of 2026-10-10, second round: more departments, one body each

- **Finance on Mercury**: `tresorier` (cash and runway, the 1,000 USD alert), `comptable`
  (books, the accountant pack, Form 5472, the Wyoming report, the reminders), `recouvrement`
  (invoices and polite reminders as drafts). They replace `encaissement` and
  `juridique-compta`, whose files are removed; the legal deadlines move to `comptable`, the
  legal paper to `contrats`.
- **Clients on Jupiter**, beside the inbox: `onboarding` (welcome, access, kick-off once a
  payment lands), `compte` (renewals, re-screening subscriptions, upsell as proposals),
  `support` (clients' questions as drafts).
- **Compliance on Pluto**: `veille-reglementaire` (OFAC, UN, EU, UK list and rule changes
  that matter to clients, with the unread state the planet shows), `contrats` (engagement
  letters, terms, the licence of every data source reused), `donnees-perso` (GDPR,
  CAN-SPAM and unsubscribe compliance of every batch, the register of data requests).
- **Data and Product inside Delivery, on Venus**: `listes` (fetch, diff, freshness of each
  list), `donnees-qualite` (false positives and misses on the reference set, with
  intervals), `benchmarks` (speed and cost, sealed). They live with Delivery because their
  output is what a delivery runs on; a separate body would split the engine from its work.
- **The Sun stands for the week's quota**: the `budget` role lives there and runs first in
  every pass (mode plein, sonnet, urgent).
- `veille` (sanctions-list freshness for Infrastructure) hands its fetching to `listes`
  and keeps the daily check that the product's copies match the publishers' dates.
