# The tycoon view: each planet opens on its department's base

How a planet of the Crusetra Dashboard hub opens into a small management view of the
department that lives there: an isometric base on the planet's surface, pre-rendered in
Blender (sprites and short loops, no browser 3D), one little robot per agent at its
workstation, demandes travelling between stations as crates on belts, one or two live
counters per station, and cards that allow only what the rules allow. Companion to
`STRUCTURE.md` (the departments), `DASHBOARD.md` (the `equipe` collection and the hub's
rings) and `CHARTE.md` (what each role may do).

## Principles that keep it buildable and honest

- **Pre-rendered, not simulated.** Every scene is a flat background PNG plus sprites placed
  at fixed anchors. A robot is one sprite sheet with four loops: working (animated), idle
  (breathing), blocked (still, red light on), waiting (still, amber beacon). A crate is one
  sprite moved along a fixed path in CSS. No physics, no camera, no WebGL.
- **State comes from the database only.** `equipe/<role>` gives each robot its loop
  (`etat`), its card (`resume`, `derniere`, `kpi`, `demandes_en_cours`); `demandes` gives
  the crates (one crate per demande `en_cours` or `a_faire` with a `role`, moving on a
  handoff when `de_role` is set); `fil` gives the belt events; `controles/<date>.json`
  colours the Infrastructure base; `chiffres` (the Mercury cash figure and its date) feeds
  the Finance counter. Nothing in the scene is computed from anything else.
- **The plain list is one click away.** Every planet keeps its current view (Aujourd'hui,
  Boîte, Pipeline, Semaine, Contrôles, Chantiers, Notes) behind a "Liste" toggle at the top
  right; the tycoon scene is the other face of the same data, never a replacement.
- **The only actions are the rules'.** From a robot's card: "Approuver dans une session"
  (copies the demande id, opens nothing, sends nothing: Arslane's typed "oui" in a Claude
  Code session is the only yes), "Repasser en tête" (sets `heure` to the next pass and
  writes a `fil` line), "Mettre en pause" (sets a `pause: true` flag on `equipe/<role>`
  that the chef reads before dispatching, written by the page, undone the same way). No
  button sends, pays, deletes or edits a text.
- **French for Arslane.** Every label, card line and counter title on the page is French;
  the asset names and this file are English.

## Planets and departments

The hub's seven views map onto the six departments of `STRUCTURE.md` with one addition,
Planning, which is the chef's calendar work and earns the Moon:

| Planet | View | Department | Robots on the base |
|---|---|---|---|
| Earth | Aujourd'hui | Direction | chef-orchestre (the core), qualite, methode |
| Jupiter | Boîte | Commercial, inbound | boite, with redaction at a side desk |
| Saturn | Pipeline | Commercial, outbound | prospection, with redaction at a side desk |
| Moon | Semaine | Planning (the chef's occurrences, reminders, deadlines) | chef-orchestre's planner arm, juridique-compta |
| Mars | Contrôles | Infrastructure | controles, veille |
| Venus | Chantiers | Delivery | livraison, qualite at the exit gate |
| Neptune | Notes | Growth and Finance | veille, redaction, encaissement, methode's archive |

`redaction` and `qualite` appear on more than one planet because their work does: the
robot is the same sprite, its state is the same document, only the desk differs. Finance
has no planet of its own in the seven; its robot and its counter live on Neptune's base
until an eighth view exists, and the cash counter is also shown on Earth's control tower.

## Scene by scene

Each scene lists: the stations, the events that animate it, what stays as text, the data
each station reads.

### Earth, Aujourd'hui, Direction

Scene: a control tower on a green planet; the chef at the top with the ring display of the
hub behind it; qualite at a checkpoint desk; methode in a small library.

Stations and counters: Tower (chef): "Passe de HH:MM" and "travaillées / bloquées" from
`equipe/chef-orchestre.kpi`. Checkpoint (qualite): "retours cette semaine". Library
(methode): "propositions acceptées / faites".

Events: a pass starts, the tower light sweeps (`equipe/chef-orchestre.etat = travaille`);
each dispatched demande is a crate leaving the tower on the belt to its planet's launch pad
(a `fil` line `[chef] -> [role]`); a crate coming back to the checkpoint is a `qualite`
handoff; a crate pushed off the belt onto a red pallet is a `bloque`; an amber beacon on the
tower means at least one `attend_oui` anywhere.

Text one click away: the Aujourd'hui list as it is today (due, done, waiting, blocked).
Escalations waiting on Arslane stay as text above the scene, always.

Data: `equipe/chef-orchestre`, `equipe/qualite`, `equipe/methode`, `demandes` where
`quand` is today, `fil` of the last pass.

### Jupiter, Boîte, Commercial inbound

Scene: a receiving dock under the storm bands; a conveyor from the sky brings mail crates;
boite at the sorting desk with six chutes (prospect reply, client, vendor, payment, legal,
noise); redaction at a writing desk; an exit slot marked "oui" where drafts wait.

Counters: "fils non triés > 24 h" (red when above zero); "demandes d'arrêt traitées dans
l'heure" (from `equipe/boite.kpi`); redaction: "brouillons en attente de oui".

Events: a new thread is a crate on the sky conveyor; triage drops it in a chute; a stop
request flashes red and a crate leaves on the belt to Saturn (handoff to prospection); a
reply needing text goes to redaction's desk, then to qualite's checkpoint (a small
checkpoint sprite shared with Earth), then rests at the exit slot with the amber beacon.

Text: the Boîte view (threads and their labels) unchanged.

Data: `equipe/boite`, `equipe/redaction`, `demandes` with `role: boite | redaction`,
`fil` lines from or to `boite`.

### Saturn, Pipeline, Commercial outbound

Scene: a launch facility on the rings; a staging hall where the day's batch is assembled;
a gate with a lamp that is green under 5 % bounce rate and red above; a warm-up gauge on
the sending address's silo; launch pads per US time zone (East, Central, Mountain, Pacific,
Alaska, Hawaii, Elsewhere) that light up in their sending window.

Counters: "lots envoyés après oui, semaine"; "taux de rebond du dernier lot" with the gate
colour; "plafond du jour" from the warm-up ramp.

Events: `npm run lots` output (the `lot-<date>.json` the Mac writes after each
preparation) fills the staging hall with crates, one per kept row, each parked at its
zone's pad with its slot time; rows set aside appear on a side shelf with their reason;
the whole hall waits under the amber beacon until the batch's demande turns from
`attend_oui` to `fait`; a bounce report above 5 % switches the gate lamp to red and empties
the hall into the shelf.

Text: the Pipeline view (prospects and steps) unchanged; the batch's own JSON is one click
from the hall.

Data: `equipe/prospection`, the latest `lot-<date>.json` (uploaded by the executor as a
row `lots/<date>` with its counts and slots, never the addresses), `demandes` with
`role: prospection`.

### Moon, Semaine, Planning

Scene: a quiet observatory; a wall calendar of the week with seven columns; the chef's
planner arm placing crates on the days; juridique-compta at a desk under three clocks
labelled 5472, Wyoming, Domaine, each counting down.

Counters: "occurrences créées cette semaine"; "jours avant la prochaine échéance" (red
under 7); "dossiers prêts / dus".

Events: the hourly pass places new occurrence crates on their day; a J-30, J-7 or J-1
reminder lights a clock; a reminder turning `a_toi` raises the amber beacon on that clock;
the Sunday review slides a crate to methode's library on Earth (a `fil` line to
`methode`).

Text: the Semaine view (the week's rows) unchanged.

Data: `demandes` of the week with `recurrente` and `echeance`, `equipe/juridique-compta`,
`juridique/echeances.json` mirrored as a row `echeances`.

### Mars, Contrôles, Infrastructure

Scene: a red desert outpost; five instruments on masts (Domaine, Site, Sauvegardes,
Secrets, Listes), each with a lamp; controles at the console; veille in a radio dome
listening to four dishes (OFAC, EU, UK, UN).

Counters: "contrôles rouges maintenant"; "âge de la dernière sauvegarde verte"; veille:
"jours depuis la dernière mise à jour de liste vue".

Events: each `controles/<date>.json` repaints the five lamps (green, amber, red) at its
time; a red lamp sounds the outpost siren once and raises a P1 crate that leaves for Earth
(the `a_toi` demande); a list update seen by veille makes the matching dish turn and sends
a crate to the console (handoff to controles).

Text: the Contrôles view (the latest results as a table) unchanged.

Data: `controles/<date>.json` (stored as rows), `equipe/controles`, `equipe/veille`,
`veille/<date>.md` summaries as rows.

### Venus, Chantiers, Delivery

Scene: a cloud-top workshop; a receiving bay for client orders; livraison at a workbench
running the screening and audit machines (two machines, lamps on while a run lasts); an
exit gate where qualite inspects the crate; a shelf of delivered folders with their seal
stamp; a chute to Neptune's cashier (invoice handoff).

Counters: "livrables dus sous 7 jours" with their states; "jours de la commande au
livrable".

Events: a new order crate arrives in the bay (`demandes` with `role: livraison`); the
machine lamps animate while `equipe/livraison.etat = travaille`; the finished crate goes
to the gate (qualite handoff), then to the shelf with its seal stamp
(`livraisons/<client>/<date>` manifest row) under the amber beacon until Arslane's "oui"
sends it; an invoice crate leaves through the chute (handoff to encaissement).

Text: the Chantiers view (orders and deliverables) unchanged; a delivered folder's
`note-envoi.md` is one click away.

Data: `equipe/livraison`, `equipe/qualite`, `demandes` with `role: livraison`, the
delivery manifests as rows `livraisons/<client>/<date>` (counts, seal, file names; never a
client value).

### Neptune, Notes, Growth and Finance

Scene: a deep-blue archive and counting house; veille's reading room with the week's notes
on a board; redaction's writing room; encaissement at the cashier window with a cash
figure display and its date; methode's archive of proposals; a ledger wall with open
invoices as tags, older ones redder.

Counters: encaissement: "factures ouvertes > 30 jours" and "chiffre de trésorerie du
<date>"; veille: "notes portées à la revue"; redaction: "brouillons retournés par
qualite".

Events: a payment matched turns a ledger tag green; a failed payment or dispute flashes the
cashier window red (P1 crate to Earth); a draft finished moves from the writing room to
Jupiter's exit slot; the Sunday review stacks the week's notes into one crate for Earth.

Text: the Notes view unchanged; the cash figure stays a number with its date.

Data: `equipe/encaissement`, `equipe/veille`, `equipe/redaction`, `chiffres` (cash and
date), `demandes` with those roles, invoice register summary as a row `factures`
(counts and ages, never amounts of a named client on the page without Arslane's choice).

## Blender assets to render

Rendered once, isometric, 2:1 pixel ratio, PNG with alpha, two sizes (1x and 2x); every
loop 12 frames at 8 frames per second, which reads as alive and weighs little.

- Seven base backgrounds (one per planet), 1600 by 900 at 1x, with the station anchors
  exported as JSON (name, x, y) from the Blender scene so the page never hard-codes a
  position.
- One robot sprite sheet, four loops (working, idle, blocked, waiting), one colour band
  per department applied as a tint in CSS, so one sheet serves eleven roles.
- Station props as separate stills: tower, checkpoint desk, library, sorting desk and six
  chutes, writing desk, exit slot, staging hall, gate with lamp (three stills), warm-up
  gauge (five fill levels), launch pad (lit and unlit), calendar wall, three clocks (five
  fill levels), five instrument masts (three lamp colours), radio dome and four dishes,
  workbench with two machines (lamps on and off), inspection gate, shelf with seal stamp,
  cashier window, ledger wall, reading board.
- One crate sprite (plain), one crate with a red band (P1), one with an amber band
  (attend_oui), one pallet (blocked).
- Belt segments: straight, corner, up-ramp, down-ramp, and a launch arc, as stills; the
  crate moves, the belt does not.
- Lamps and beacons as two-frame loops (on, off) in green, amber, red.
- Weather loops per planet (dust on Mars, storm bands on Jupiter, cloud drift on Venus),
  optional, 12 frames each, drawn behind the base.

## Page logic

- One component per planet scene, taking the planet's anchor JSON and the rows it needs;
  the same crate and robot components everywhere.
- On open: fetch `equipe/*`, the planet's `demandes`, the last 50 `fil` lines; place the
  robots by role at their anchors with the loop of their `etat`; place a crate per open
  demande at its role's station, or on the belt between `de_role` and `role` if the
  handoff is less than one pass old (`fil` time within the hour).
- Every 60 seconds while open: refetch; animate the difference (a crate that changed
  station travels the belt over 2 seconds; a state that changed swaps the loop; a counter
  that changed ticks).
- Escalations waiting on Arslane are rendered as text above the scene on every planet,
  with the amber beacon on the robot concerned.
- Card on a robot click: `resume`, `derniere` as relative time, the two KPIs, the queue
  (its `demandes_en_cours` with titres), the escalations of that role; the three actions
  described above and nothing else; the "Liste" toggle at the top right.
- Reduced motion (the OS setting) disables the loops and the belt animation; everything
  stays readable as stills and text.
- Nothing in the page talks to a mail, a payment or a file system; it reads and writes the
  dashboard's database only, and the only fields it writes are `heure` and the `pause`
  flag, each with a `fil` line.
