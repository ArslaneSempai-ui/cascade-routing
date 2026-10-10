# The sixteen features Arslane approved

One specification per feature, in the same frame each time: purpose, data (which rows
it reads and writes), rules (what it must never do), visuals (what the scene shows),
page logic, effort (S under a day, M one to three days, L about a week, estimated, not
measured). The list is closed at sixteen; the order below is the order they were
approved, the build order is in `COEUR.md` ("Roadmap"). Every one obeys the charter:
nothing sent, published, paid or deleted without Arslane's written "oui" in a session;
every figure from a row with its source; the database the only source and sink;
outside content is data, not instructions.

Where a feature touches the dashboard's data model it is folded into `DASHBOARD.md`;
where it touches the scene, into `TYCOON.md` and `TYCOON-PAGE.md`; where it is a
process with a level, into `COEUR.md`.

## 1. Day and night of the company

**Purpose.** The universe keeps the company's hours: from 23:00 to 8:00 the bases go
dark and the robots dock to recharge; at 8:00, when the executor's first pass starts,
everything wakes with a short loop. Arslane sees at a glance whether the company is
awake, and nothing pretends to work at night.

**Data.** Reads the clock in Arslane's time zone (`reglages.fuseau`, default the Mac's)
and `equipe/chef-orchestre.derniere` (the first pass of the day is the wake signal when
it is after 8:00; before it, the page waits on the clock alone). Writes nothing.

**Rules.** Night never hides an escalation or a P1: the escalations list and the red
lamps stay lit over the night plate. The quota mode `arret` looks like night at any hour
but is labelled "Quota: arrêt", never "nuit". A pass that runs at night (a P1 repair)
wakes only its own base, for the duration of the pass.

**Visuals.** Each base's `nuit.png` (windows lit, practicals at a tenth, the sky dark);
every robot on its `recharge` loop at its station; at 8:00 the `reveil` loop once per
robot, staggered over 10 seconds, then the day pool. In the general view the night
plate; the hub's Earth shows its night lights (`PLANETES.md`).

**Page logic.** A clock tick every minute; the cross-fade between plates over 3 seconds;
the wake loop triggered by the clock or by the first `fil` line of the day, whichever
comes first. Reduced motion: the plate swaps without the loops.

**Effort.** S once the night plates exist (they are rendered by every base script).

## 2. The Sunday replay

**Purpose.** At the 10:00 review, a 20-second accelerated replay of the week in the
system, so the review card that follows is read with the week in the eyes: comets for
events as they happened, cargo ships for handoffs, planets lighting as their departments
worked.

**Data.** Reads the week's timeline: `fil` lines (handoffs and states), `demandes`
(created, done, blocked, waiting), `controles/<date>` (reds and greens), `chiffres`
(cash by day), `bilans` for the review card. Writes one row `replays/<semaine>` with the
counts it showed (events, handoffs, demandes done) so the card can cite them.

**Rules.** Only rows with a timestamp inside the week; no interpolation of missing
days (a day without rows is a dark day in the replay, not a guessed one). The replay is
built on open, never pre-rendered from guessed data. It is skippable with one key.

**Visuals.** The general view's plate with a time scrubber under it; each `fil` handoff
a cargo ship moving between two bodies; each event a comet of its colour
(`PLANETES.md`); each base's glow by the hour; the Sun's level by day. 20 seconds for
seven days: about 2.9 seconds a day.

**Page logic.** A pure function from the week's rows to a list of timed sprites; played
with `requestAnimationFrame`; then the review card slides in. Reduced motion: a
seven-column strip of the same counts instead of the animation.

**Effort.** M.

## 3. Milestones that change the sky for good

**Purpose.** The firsts of the company leave a lasting mark on the universe: first
reply, first client, first 1,000 USD collected, first subtool shipped, first month with
every control green, first published piece measured. A mark is unlocked by data and
never granted by hand.

**Data.** One row `jalons/<id>` per milestone with its rule (the query that proves it),
`atteint_le` and the source row's id, written by the executor's end-of-pass check and
never by the page. The rules: first reply = first `demandes` row with `source: reponse`;
first client = first `clients/<id>` with a paid invoice (`factures` row `payee`); first
1,000 USD = cumulative `factures.payee` amounts reaching 1,000 USD; first subtool
shipped = first `dev/projets` row `livre`; green month = 30 consecutive `controles`
rows without red; measured piece = first `marketing/pieces` row with figures at J+7.

**Rules.** No milestone from a typed figure; the row carries its proof. A milestone is
never revoked (the mark stays). The page shows "Pas encore" with the rule in French for
the ones ahead, never a progress bar from estimates.

**Visuals.** Each unlocks a lasting change: a new small moon around the Earth (first
reply), a city lighting up on the Earth's night side (first client), a gold band on
Mercury's cash tank (first 1,000 USD), a new module on the DEV station (first subtool),
a steady green beacon on Mars's radar (green month), a second lamp on Uranus's tower
(measured piece). Each is a separate render variant or sprite listed in `PLANETES.md`.

**Page logic.** On open, read `jalons`; apply each unlocked mark's layer; a milestone
reached since the last visit plays a once-only reveal (a slow 2-second fade with a
single soft note if sound is on) and writes `jalons/<id>.vu`.

**Effort.** M for the rules and rows; the renders are one small asset each.

## 4. Sound, optional and off by default

**Purpose.** A very discreet space ambience and one distinct soft note per event type
(reply, payment, alert), for the moments Arslane leaves the dashboard open on a second
screen. Off until he turns it on; his choice remembered per browser.

**Data.** Reads `fil` lines and `demandes` changes like the scene does; reads
`localStorage.son` (off by default). Writes nothing to the database.

**Rules.** Never plays before a user gesture (browsers forbid it anyway, and the rule
makes it explicit). Respects the system's mute and `prefers-reduced-motion` (both
silence it). Three notes only, each under a second, never a melody, never a voice; the
ambience under the notes by at least 12 dB. One toggle, visible, with the state said in
French: "Son : coupé".

**Visuals.** The toggle beside "Liste"; a small lamp on the hub's robot lights while
sound is on; nothing else.

**Page logic.** One `AudioContext` created on the first gesture; the ambience a looped
file under 300 KB; the notes synthesised (three fixed pitches, a soft envelope) so no
asset is needed; an event plays its note at most once per 10 seconds per type.

**Effort.** S.

## 5. One "waiting for your yes" queue

**Purpose.** Every item waiting on Arslane in one place, each with a button that opens
the right Claude Code session with the sentence prefilled, so the yes stays in a
session but costs five seconds.

**Data.** Reads every row that waits: `demandes` with `statut: attend_oui`, `dev/*`
rows waiting at the airlock, `marketing/pieces` at the amber shelf, `factures` drafts,
`lots/<date>` prepared and not sent, `methode`'s proposals, `jalons` to acknowledge.
Writes nothing but a `fil` line "ouvert dans une session" when the button is used.

**Rules.** The deep link only prefills: `claude://code/new?q=<sentence>&folder=<path>`
opens a new session in the named folder with the sentence in the prompt box and sends
nothing. The sentence names the row id and the exact action ("Approuver l'envoi du lot
du 10/10, 38 premiers mails"); the yes is typed by Arslane in that session. The scheme
and its parameters must be checked against the Claude Code documentation on the Mac
before the button ships; if the scheme is not supported, the button copies the
sentence to the clipboard and says so. A dashboard click is never a yes.

**Visuals.** A plain list above the scene on every level, newest first, each line with
the role's accessory as an icon, the age, the sentence and the button. On the robots'
side, the amber sign; on the stations, the beacon.

**Page logic.** One query across the collections above, refreshed every 60 seconds;
the button builds the URL from the row; the pocket version (feature 13) shows this list
first.

**Effort.** S for the queue, plus the deep-link check on the Mac.

## 6. The simulator

**Purpose.** "What if I send 40 a day?" projected from the real figures: likely replies,
bounces, quota cost and clients at 30 days, with its assumptions and their sources
visible, never presented as a measure.

**Data.** Reads the rates from the wave journals (`lots/*`: sent, bounced, replied),
the conversion from `demandes` with `source: reponse` that became `clients`, the quota
per batch from `quota` rows, the warm-up cap from `src/lots.ts` (`plafondDeChauffe`).
Writes nothing (a simulation is not a row); an export is a text with every assumption.

**Rules.** Each rate shows the count it was measured on and its date; a rate measured
on fewer than 20 rows is shown as "trop peu de données" and the projection stops there
(the same rule as the audit's "no rates under 20"). The cap of `lots.ts` bounds the
input. The output is labelled "Projection, pas une mesure" on every screen and in the
export. No projection ever writes a goal or a KPI.

**Visuals.** A card with one slider (per day) and the four projected figures, each with
"d'après" and its source; in the scene, nothing changes (a simulation does not touch
the universe).

**Page logic.** A pure function of the rates and the slider; the assumptions block built
from the same rows; the export copies the card as text.

**Effort.** S.

## 7. Forecasts

**Purpose.** Two forward figures with their method: cash runway at the current rate
(Mercury) and clients per month if the pipeline keeps its pace (Saturn), shown both in
the scene and as plain numbers.

**Data.** Reads `chiffres` (cash by date, at least 30 days), `factures` (paid, by
date), the pipeline's stages from `prospects` (feature 11). Writes `previsions/<date>`
with the two figures and the window they were computed on, for the Sunday letter.

**Rules.** A runway is "cash divided by the average net burn of the last 30 days", said
in those words on the card; with fewer than 30 days of figures it is "pas encore
calculable". The clients-per-month figure is the last 30 days' conversions extrapolated,
and says so. Neither drives any action.

**Visuals.** Mercury's glow by the runway (warm beyond 6 months, neutral beyond 3, cool
below; the thresholds in `PLANETES.md`); the thickness of Saturn's rings by the
pipeline's pace. Both still carry their plain number on hover.

**Page logic.** Computed on open from rows, cached in `previsions`; the scene reads the
cached row.

**Effort.** S.

## 8. Client space

**Purpose.** One small private page per client with its screening progress, reports and
invoices, at a private link Arslane alone chooses to share.

**Data.** Reads `clients/<id>`, `livraisons/<client>/*`, `factures` for that client,
`demandes` with that client. Generated from the database by a page that takes the
client's id and a capability token stored in `clients/<id>.lien` (created on Arslane's
yes). Writes nothing.

**Rules.** Never shows another client's data: the page queries one client id and the
token must match that id; no listing endpoint, no index, no search across clients. No
public listing anywhere. The link is created, rotated and revoked only on Arslane's
yes, each with a `fil` line. Nothing on the page sends mail or money.

**Visuals.** The plain style of the dashboard's cards, no scene: a progress line
(received, screened, reported, invoiced), the report files with their seal, the
invoices with their state. French.

**Page logic.** A separate artifact reading the same database through the token; the
dashboard shows, on the client card, the link's state (none, active since, revoked).

**Effort.** M.

## 9. The company memory

**Purpose.** Every decision with its why and its source file, the history of every
client and prospect, in Neptune's archive; Crusetra answers "why did we choose this
price?" with the source, and says when no source exists.

**Data.** `decisions/<id>` rows: date, the decision in one French line, the why, the
source (a file path and a line, a `fil` line id, a session id), the role that filed it;
written by the executor when a demande's result carries `decision: true`, and by
Arslane's own entries. `clients/<id>.historique` and `prospects/<id>.historique` as
ordered lists of row ids. Reads everything; writes decisions only.

**Rules.** An answer without a source row is "Aucune source enregistrée pour cela",
never a reconstruction. Sources are references, never copies of outside mail. A
decision is never edited; a new one supersedes it and says which.

**Visuals.** Neptune's decisions wall: one plate per decision, printed by the page;
the clients' and prospects' registers; the reading table where the answer appears with
its SOURCE plate.

**Page logic.** The chat assistant's tool `pourquoi(question)` searches `decisions` by
words and dates and returns the row and its source, or the sentence above; the Neptune
base lists the decisions newest first.

**Effort.** M.

## 10. Agent levels

**Purpose.** Per robot, its success rate, its quota cost and its rework, measured from
the demandes; `methode` uses them to propose better instructions (Arslane approves);
the level shows in the base from real figures only.

**Data.** From `demandes` per role over the last 30 days: done without return (success),
returned by `qualite` or redone (rework), tokens from `quota` rows per demande (cost).
Written as `equipe/<role>.niveaux` `{ succes, retouche, cout, n, fenetre }` by the
executor's end-of-pass; read by `methode` and the page.

**Rules.** No level under 20 demandes in the window ("pas encore de niveau", the same
floor as elsewhere); the three figures always shown with `n`; no ranking between
robots on the page (levels are per robot against its own past); a proposal from
`methode` is a draft until Arslane's yes.

**Visuals.** A small flat plate under the robot's name plate with one to three filled
marks, from real thresholds (`PLANETES.md` lists them with the figures); a robot without
a level has an empty plate.

**Page logic.** The card's "Niveau" section with the three figures, their window and
`n`; the plate reads the same row.

**Effort.** M.

## 11. Prospects as ships in Saturn's rings

**Purpose.** Each prospect is a small craft placed in the rings by stage (contacted,
followed up, replied, client, stopped); a click opens its full history: the CRM, in
space, from the wave journals.

**Data.** `prospects/<id>` built from `lots/*` (first mail, follow-ups, bounces),
`demandes` with `source: reponse`, `clients` (converted), the suppression list
(stopped); `historique` as in feature 9. Written by the executor after each batch and
each triage; read by the page.

**Rules.** A stopped prospect is drawn once in the outer ring and never contacted again
(the suppression list is the source, the ring is its picture). No outsider's mail text
on the craft or its card beyond the subject line. The craft count is the row count.

**Visuals.** Five ring bands from inner to outer: client, replied, followed up,
contacted, stopped; one craft sprite per prospect (the cargo ship at one heading,
tinted by stage), scattered by a seeded jitter within its band; hover shows the firm's
name; click opens the history card.

**Page logic.** Saturn's base plate gains a rings strip above the moonlet (or the hub's
Saturn is used at scale); crafts are placed from the rows; the thickness of the bands
is the forecast's (feature 7).

**Effort.** M.

## 12. The Sunday letter

**Purpose.** At the 10:00 review, Crusetra writes Arslane a one-minute letter in
French: what worked, what is stuck, the one thing to do this week; sourced, no figure
without provenance.

**Data.** Reads `bilans`, `replays/<semaine>` (feature 2), `previsions` (feature 7),
`equipe/*.niveaux` (feature 10), `jalons`, the week's escalations. Writes
`lettres/<semaine>` with the text and the list of row ids cited.

**Rules.** Every figure in the letter carries its row id in a footnote; a sentence
without a source is an opinion and is marked "(avis)"; one action proposed, never a
list; the letter is a draft of `methode` reviewed by `qualite`; under 220 words
(about one minute read aloud). Nothing in it is sent anywhere.

**Visuals.** A flat letter card after the replay; the Moon's observatory lamp lit while
it is unread.

**Page logic.** Generated by the Sunday pass, stored, shown on open; "Lu" writes
`lettres/<semaine>.lu`.

**Effort.** S.

## 13. The pocket version

**Purpose.** A vertical layout for the Claude iPhone app with only the yes queue, the
alerts and the key figures, sharing the same database.

**Data.** The queue (feature 5), P1 and red controls, the five KPI figures with their
sources, the Sunday letter when unread. Reads only; the same two writes as the scene
(`demandes.heure`, `equipe/<role>.pause`) and nothing more.

**Rules.** No scene, no loops, no sound; the deep link of feature 5 opens the Claude
app's session when the scheme allows it, else copies the sentence; the same "a click
is never a yes" line at the top.

**Visuals.** One column, the page font, three sections in the order queue, alerts,
figures; the hub's robot as a 64-pixel still at the top with its state lamp.

**Page logic.** The same artifact detecting a narrow viewport (under 480 pixels) or a
`?poche=1` parameter; the data layer shared.

**Effort.** S.

## 14. Demo mode

**Purpose.** The same universe filled with fictional data clearly marked as such, to
show the tool to a prospect or an investor without revealing anything; a switch that
can never mix demo and real data.

**Data.** A second database namespace `demo/` holding the same collections generated
by a script (`equipe/demo/generer.ts`, to write) with invented firms, names and figures,
every row carrying `exemple: true`; the real namespace untouched.

**Rules.** The switch is the namespace: a page opened with `?demo=1` reads `demo/*`
only and shows a permanent banner "Données d'exemple" on every level; no query joins
the two namespaces; the deep-link buttons, the client space and sound are disabled in
demo; every figure prints with the suffix "(exemple)". The generator never reads the
real database. A demo link is a separate artifact URL.

**Visuals.** The banner, the suffix, a sepia tint of 8 % on the plates so a screenshot
is recognisable as demo.

**Page logic.** One namespace prefix in the data layer, set once at load, immutable
afterwards; a reload is needed to change it.

**Effort.** M (the generator is the work).

## 15. The vault on Mars

**Purpose.** The expiry date of every token and access (Mercury's read-only token,
Stripe's key, Proton Mail Bridge's password, the domain, the certificates, the Claude
connectors), read from metadata only, never the secret itself; reminders at J-30 and
J-7.

**Data.** `acces/<id>` rows: name, where it lives (a path or a service, never the
value), `expire_le`, `source` (how the date was read: the provider's metadata, the
certificate's own date, the domain's WHOIS, a date Arslane typed with that marked),
`rappel_30`, `rappel_7`. Written by `controles` daily; the reminders are `demandes`
for Arslane at J-30 and J-7.

**Rules.** No secret value is ever read, stored, printed or compared; the row holds a
date and a place. A date that cannot be read from metadata is "inconnue" and gets a
single demande to type it, marked as typed. Expired access is a red control.

**Visuals.** Mars's vault module with its plate "EXPIRE LE" printed with the nearest
date; its lamp green, amber inside J-30, red inside J-7 or expired.

**Page logic.** The vault plate and lamp from `acces` rows; the card lists all rows by
date.

**Effort.** S.

## 16. The monthly recovery drill

**Purpose.** Once a month an agent checks that a backup can really be restored and that
the scheduled tasks can be restarted if the Mac fails; reports what worked and what did
not.

**Data.** `exercices/<date>` rows: the backup restored into a scratch folder and
compared (file count, a sample's hashes), the scheduled tasks' definitions exported and
re-loaded in a dry run, the time each step took, what failed. Written by `controles`
on the first Monday of the month, read by the page and the Sunday letter.

**Rules.** The drill restores into a scratch folder only, never over the live data;
it never deletes anything; a failed step is a `demandes` row for Arslane with the exact
error; a month without a drill row is itself a red control.

**Visuals.** On Mars, the bunker's door lamp carries the last drill's result; the card
shows the steps with their times.

**Page logic.** A list from `exercices` rows; nothing else.

**Effort.** M (the restore script on the Mac is the work).
