# COEUR: the dashboard as the company's operating system

The operating model in one place. The Crusetra Dashboard is where every piece of work
starts (Arslane's request, an event, a schedule), runs (through one role), and ends (a
result, its proof, a KPI). Its database is the single source of truth: nothing important
lives only in a chat. Companions: `STRUCTURE.md` (departments), `CHARTE.md` (rules),
`EXECUTEUR-DISPATCH.md` (routing), `DEV.md`, `MARKETING.md`, `AUTOMATISATION.md`.

## Automation levels

- L0 manual: Arslane does it, the dashboard records that it was done.
- L1 prepared: an agent prepares everything; Arslane acts and the agent records.
- L2 done and reported: the agent does it within its rules and reports every time.
- L3 done, exceptions reported: the agent does it and speaks only when something is off.
- L4 self-correcting: the agent does it, detects its own failures and repairs them within
  its rules, and reports the repair once.

Permanent human gates, never automated: Arslane's written "oui" in a session for anything
that sends, publishes, pays, deletes or commits him (money, law, a client), and strategic
choices (positioning, offers, a plan, a form in look development). Everything else is
pushed to the highest level the guardrails allow.

## Processes, their level today, their target, what it takes

| Department | Process | Today | Target | What it takes |
|---|---|---|---|---|
| Direction | Dispatch of due demandes | L2 | L3 | `EXECUTEUR-DISPATCH.md` installed; a pass with nothing to say writes no report |
| Direction | Verification before Arslane sees a result | L0 | L2 | `qualite` installed and routed for outward and money work |
| Direction | Weekly instruction improvement | L0 | L1 | `methode` on the Sunday review; Arslane applies with a "oui" |
| Direction | Budget rule by quota | L0 | L4 | the quota figure in the database; the chef reads it each pass and degrades models by itself |
| Direction | Watchdog | L0 | L4 | heartbeat rows and the 9:00 and 18:00 check (below) |
| Commercial | Batch preparation (list hygiene, gate, cap, slots) | L1 (lots) | L3 | `npm run lots` run by the executor before each batch; only a closed gate or an empty batch is reported |
| Commercial | Sending the batch | L1 | L1 | permanent gate: the "oui" |
| Commercial | Bounce loop | L0 | L3 | the bridge's bounce mails parsed hourly; the suppression list updated; only a rate over the gate reported |
| Commercial | Inbox triage | L1 | L3 | `boite` hourly; only stop requests, disputes and replies needing a text are reported |
| Commercial | Reply drafting | L1 | L1 | the "oui" sends; the draft is the deliverable |
| Delivery | Client delivery folder | L1 (livrer) | L2 | `npm run livrer` run by `livraison` on an order demande; reported every time |
| Delivery | Sending the deliverable | L0 | L1 | the "oui" |
| Finance | Reconciliation Stripe and Mercury | L0 | L3 | read-only exports daily; only unmatched money and overdue invoices reported |
| Finance | Invoicing | L0 | L1 | invoice drafts from the register; the "oui" sends |
| Finance | Dunning | L0 | L1 | follow-up drafts at 30, 45, 60 days; the "oui" sends |
| Finance | Cash figure | L2 | L3 | read daily; only a stale figure reported |
| Finance | Deadlines and reminders | L2 | L3 | J-30, J-7, J-1 rows; only the pack not ready at J-7 reported |
| Finance | Accountant pack | L0 | L1 | monthly pack assembled; Arslane sends it |
| Infrastructure | Controls | L2 | L4 | checks hourly on the Mac; a red control that a documented repair fixes (restart the bridge, rerun the backup) is repaired once and reported once; the rest P1 |
| Infrastructure | Sanctions-list freshness | L0 | L3 | publishers' dates read daily; only a stale copy reported |
| Infrastructure | Dependency advisories | L0 | L3 | `dev-veille` weekly; only an advisory on an installed version reported |
| DEV | Plan from an idea | L0 | L1 | `dev-architecte`; the plan is validated with a "oui" when it adds a surface |
| DEV | Slice build and witness | L1 | L2 | `dev-testeur` then `dev-developpeur`; reported per slice |
| DEV | Suite kept green | L1 | L3 | `dev-testeur` after each slice; only red reported, with its cause |
| DEV | Review | L0 | L2 | `dev-relecteur` on every `a_relire` |
| DEV | Release or merge | L0 | L1 | `dev-integrateur` prepares; the "oui" executes |
| Marketing | Weekly plan | L0 | L1 | `mkt-stratege`; the "oui" validates |
| Marketing | Drafts (text, visuals, pages) | L0 | L1 | the roles draft; `qualite` checks; the "oui" publishes |
| Marketing | Measures at J+7 | L0 | L2 | `mkt-analyste` from exports, every time |
| Marketing | Market watch | L0 | L3 | `mkt-veille` daily; only a brief-worthy item reaches the plan |
| Rituals | Morning and evening reports | L2 | L2 | from rows only, 9:00 and 18:00 |
| Rituals | Sunday review and three goals | L2 | L2 | `bilans`, `objectifs`, `methode`'s proposals |

## Event-driven where possible, scheduled only for rituals

Events that start work the hour they happen: a reply or a stop request arrives (`boite`); a
payment lands or fails (`tresorier`); a control turns red (`controles`); a suite turns
red (`dev-testeur`); a deadline tier is reached (`comptable`); a piece reaches J+7
(`mkt-analyste`); an order arrives (`livraison`); a list publisher moved (`veille`). The
executor's hourly pass is the clock these events are read on until the Mac can wake on
them; the demande carries the event's time so the delay is measured.

Schedules, for rituals only: the hourly executor (8:00 to 23:00 Athens); the reports at
9:00 and 18:00; the Sunday 10:00 review and 11:00 controls; the Monday marketing plan; the
weekly dependency watch; the monthly accountant pack.

## Self-healing: the watchdog

Every scheduled task writes a heartbeat row `battements/<tache>` {debut, fin, statut,
passe}. At 9:00 and 18:00 a Haiku check (`controles`, in the Infrastructure department)
compares each heartbeat with its cadence and looks for: a task that missed two runs; an
agent `travaille` for more than two passes on one demande; a figure older than its
freshness (cash over 24 h, controls over 2 h, suite over a week for an active project); a
check red twice in a row.

For each finding, in this order: a documented repair within the rules (rerun the task
once; mark the stuck demande `bloque` with the reason; refetch the figure; rerun the
check), then one escalation if the repair did not hold: a push notification in French and
a demande `a_toi`, with a `fil` line. Never a second alarm for the same finding while the
first is open: the watchdog reads its own open findings before writing.

## Cost control: the quota as a budget

The weekly Claude quota is split by department, in shares Arslane sets in `quota/budget`
(a first split over the nine departments: Direction 8 %, Commercial 20 %, Clients 5 %,
Delivery 20 %, Finance 8 %, Infrastructure 5 %, Compliance 4 %, DEV 20 %, Marketing 10 %). The executor records each pass's spend per
role (`quota/<semaine>.parRole`) and reads the total before dispatching. Model choice by
quota: under 85 % the role's model; from 85 % Opus runs as Sonnet; from 95 % only P1
incidents and demandes due within 48 hours. Low-value work (market watch, dependency watch,
cosmetics of the dashboard) is deferred first when a department is over its share;
Delivery and a client's reply are deferred last. The Sunday review shows the week's spend
per department beside its KPIs, so the split is corrected from figures.

## Roadmap: one order for everything, four weekly phases

Supersedes the four weeks above. Everything the `equipe/` files describe (the hub's
bodies, the team of 37 roles, the eleven bases and the general view, the sixteen
features of `FEATURES.md`) in one priority order: first what makes the company run,
then what makes it visible, then what makes it beautiful. Each phase names its measures;
a phase is done when its measures read true from rows, not when its files exist.
Arslane's decisions are marked (decision).

**Phase 1, week 1: the heart beats and nothing is lost.** The executor with
`EXECUTEUR-DISPATCH.md`; `budget` first in every pass; the roles of Direction,
Commercial, Finance and Infrastructure installed from `agents/`; `equipe/*` written
every pass; heartbeats and the watchdog; `npm run lots` before each batch, `npm run
livrer` for the next order; the yes queue (feature 5) as a plain list on the hub, deep
link checked on the Mac; the vault on Mars (15) as rows and reminders; the recovery
drill (16) scheduled for the first Monday. Decisions: merge of `equipe-agents`,
`automatisation-livraison` and `automatisation-lots`; the quota split. Measures: every
demande worked this week has a role and a `fil` line; zero passes without a heartbeat;
every access has an `expire_le` or a demande to type it; the gate read before every
send; the queue shows every `attend_oui` row.

**Phase 2, week 2: the exceptions only, and the sky tells the truth.** Inbox triage,
bounce loop, cash figure and controls at L3; Clients and Compliance roles installed;
`prospects` kept from the wave journals (11) and forecasts (7) computed; agent levels
(10) measured; milestones (3) checked at the end of each pass; day and night (1) on the
hub with the night variants of `PLANETES.md`; the pocket version (13). Decisions: the
first thresholds of `PLANETES.md` confirmed or corrected. Measures: stop requests
handled within the hour; the bounce rate of the last batch under the gate; no stale
figure on the hub; every prospect in a stage; a runway printed with its window; one
escalation per finding, never two.

**Phase 3, week 3: the money, the law, the memory.** Reconciliation daily; invoice and
dunning drafts; deadline packs at J-30; `qualite` on everything outward; the company
memory (9) with `pourquoi()`; the Sunday letter (12) and the replay (2); the client
space (8) for the first client on a yes; the simulator (6). Decisions: the first client
link; the letter's form after reading two. Measures: zero unmatched movement older than
7 days; every invoice sent within 2 days of a delivery yes; every outward text checked
before Arslane sees it; every decision of the week has a source row; the letter cites
every figure.

**Phase 4, week 4 and after: the builders, the voice, the bases.** DEV board live with
the first subtool's plan; Marketing plan validated on Monday and measured at J+7;
`methode`'s first proposals from the levels; the Blender look-dev run on the Mac
(`base_terre.py --apercu` first, then the three forms of `TYCOON.md` compared), then
the bases rendered one per day in the order Earth, Mercury, Saturn, Jupiter, Mars,
Venus, the Moon, Uranus, Pluto, Neptune, the station, the general view; `TYCOON-PAGE.md`
built with the minimal loop set first; sound (4) and demo mode (14) last. Decisions:
the form after look-dev; each base's still before its loops render; demo data before a
demo link exists. Measures: one slice `livre` per week with its witness; three marketing
goals measured; the week's spend within budget; each rendered base passes the quality
checklist of `TYCOON.md`; the heaviest base under 40 MB as sheets.

## Amendments of 2026-10-10: the sixteen features as processes

Each feature of `FEATURES.md` that is a process has a level today and a target; the
page-only ones (day and night, sound, pocket version, demo mode, the yes queue, the
simulator) are built once and have no level.

| Feature | Process | Today | Target | What it takes |
|---|---|---|---|---|
| 2 Sunday replay | the week's timeline drawn from rows | L0 | L2 | the replay function; the `replays` row written each Sunday |
| 3 Milestones | the end-of-pass milestone check | L0 | L3 | the six rules as queries; only a new milestone reported |
| 7 Forecasts | runway and pace computed daily | L0 | L3 | 30 days of `chiffres`; only a window too short reported |
| 8 Client space | the client page from rows | L0 | L1 | the token page; the link created on a "oui" |
| 9 Company memory | decisions filed with their source | L0 | L2 | `demandes.decision`; `pourquoi()` in the assistant |
| 10 Agent levels | levels measured per role | L0 | L3 | the 30-day window; `methode` reads them; only a fall under threshold reported |
| 11 Prospects as ships | `prospects` kept from the wave journals | L0 | L3 | written after each batch and triage |
| 12 Sunday letter | the letter drafted and checked | L0 | L1 | `methode` drafts, `qualite` checks, Arslane reads |
| 15 Vault | access expiries read from metadata | L0 | L3 | `controles` daily; reminders at J-30 and J-7 as demandes |
| 16 Recovery drill | monthly restore and restart check | L0 | L2 | the restore script on the Mac; reported every month |
