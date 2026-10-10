# The tycoon view: each planet opens on its department's base

Look development first, then the build. This file is written for Arslane to choose a
style in thirty seconds, then for whoever renders and wires the chosen one. Companion to
`STRUCTURE.md` (departments and roles), `DASHBOARD.md` (the `equipe` collection and the
hub's rings), `CHARTE.md` (what each role may do). Everything here is pre-rendered in
Blender with Cycles and composited as flat layers; nothing is built from browser 3D
primitives or CSS boxes pretending to be objects.

## What "there" means for this view

The hub already works because it is a real place: NASA textures, real scale, one sun on the
Earth's limb, the robot leaning on the planet. A base must keep that contract when the
camera comes down. The test is the one a tilt-shift photograph passes: real materials under
one light, depth of field, a few objects with weight, people (robots) busy in their own
corner. The clarity bar is Factorio's logistics (a crate on a belt is a thing you can
follow), the calm bar is Mini Motorways (one palette, one rhythm, no alarm that is not
one), the charm bar is a diorama (small, dense, hand-placed).

Non-negotiables, from the taste learned today:
- No ring of anything, no glitter, no trails, no dust, no spheres turning. Motion is
  purposeful: a crate moves because a demande moved; a robot moves because it works.
- Matte materials: roughness never under 0.42, no chrome, no emissive bling. Light does
  the work: one key, one fill, one practical per station. Contrast comes from value
  (light against dark pieces), never from dimming everything but one thing.
- Robots are never in a formation. Scattered, at different heights and depths, each doing
  its own thing, each facing its own work.
- A word in the scene is a flat printed plate (a stencil on a panel, a tag on a crate),
  never extruded letters.
- The plain list is one click away on every planet. The scene is the other face of the
  same rows, never a replacement.
- The only actions are the rules': approve in a session, reprioritise, pause a role.
  Nothing on this page sends, pays, deletes or edits a text.

## Three base styles, different in form

Pick one. Each sentence is the value it buys.

**A. The outpost.** Low, wide, modular: pressurised modules and open yards on the surface,
connected by covered walkways, crates on ground belts between them; the camera sits at
30 degrees, close to the ground, so the planet's horizon and sky are always in frame.
Value: the most "I am there": the place is a settlement, not a diagram; it reads as a
photograph of a model.

**B. The vertical plant.** One tall structure per department: a stack of open floors on a
steel frame, each floor a station, lifts carrying crates between floors, the robots
visible on their floor like a cutaway; the camera at 45 degrees, higher, looking into the
cutaway. Value: the clearest logistics: a demande's path is vertical and obvious, the
whole department fits one screen without scrolling.

**C. The field of pads.** No building: a few concrete pads on the terrain, each a station
under its own mast light, far apart, long belts crossing the ground between them; the
camera at 35 degrees, far, so the terrain dominates and the stations are small. Value: the
calmest and the most planetary: the department is a scatter of lights on a world; it
carries very little information and that is its restraint.

**Recommendation: A, the outpost.** It is the only one of the three that keeps the hub's
promise at every scale: come down from orbit, the horizon stays, the sun is the same sun,
the robot leaning on the Earth could walk into frame. B is the clearest but it is an
indoor view: the planet becomes a backdrop, and a cutaway always reads as a game. C is
beautiful and under-informs: three to five robots on a field cannot show a queue. The
rest of this file specifies A.

## The outpost: common grammar

**Camera.** Isometric-like but not orthographic: a long lens (85 mm equivalent), 30
degrees elevation, 35 degrees yaw, tilt-shift depth of field with the focus plane across
the working stations, foreground and horizon soft. One camera per planet, never moved by
the page; the page pans the rendered plate at most 10 % when a card opens.

**Light.** One sun per planet, low (12 to 20 degrees), from the hub's sun direction, so
the planet's own sunrise continues the hub's. One soft fill from the sky dome of that
planet's real colour. One practical per station (a work lamp, a monitor glow) at 2700 K,
never stronger than the sun. Shadows long and soft; no light that has no source.

**Materials palette, every planet.** Hull panels: matte painted aluminium, roughness 0.55,
two values (a light warm grey and a dark warm grey) in a ratio near 70:30 so pieces read
against each other. Decking: ribbed rubber, roughness 0.8, near black. Belts: dark canvas
with pale edge rails. Crates: plywood with a stencil plate (plain), a red band (P1), an
amber band (attend_oui); never glossy. Glass: only the small station monitors, roughness
0.42, with the planet reflected faintly. Robots: the same warm grey hull as the modules,
one coloured band on the shoulder for the department (Direction slate blue, Commercial
ochre, Delivery moss green, Finance oxblood, Infrastructure rust, Growth deep teal), eyes
as two small matte lenses with a practical behind them, no face. Ground: the planet's
real surface material, from the hub's texture family, at the camera's scale.

**Robots.** One rig, one size (about a head and a half taller than a crate), four loops
rendered as sprite sheets per department colour: working (a task animation specific to the
station: typing, sorting, lifting, reading), idle (weight shifting, a look around every
few seconds, never a dance), blocked (still, head down, the shoulder lamp red, a slow
blink), waiting (still, upright, the shoulder lamp amber, the beacon on the station mast
pulsing slowly). Never two robots in the same pose at the same time: each robot's loop
starts at a random frame.

**Crates and belts.** A crate is a demande. It appears at the station of its `role` when
the row is `a_faire` or `en_cours`; it travels the belt from `de_role` to `role` over four
seconds when a `fil` line of the last hour says so; it drops onto a red pallet beside the
station when `bloque`; it rests on the amber shelf of the station when `attend_oui`; it
leaves on the outbound belt and fades when `fait`. The stencil on the crate is the
demande's `titre` cut to 24 characters, printed flat.

**Counters.** A station has one or two plates on its wall: a printed title in French and a
number set in a flip-counter style but rendered as a flat printed plate that the page
overlays with text (no 3D digits). Values come from `equipe/<role>.kpi` and nothing else.

**Text and controls on the page.** The planet name and the department name as a flat
header in the page font; the "Liste" toggle at the top right; the escalations waiting on
Arslane as a text list above the scene whenever there is one, in French: "En attente de
ton oui, dans une session Claude Code. Un clic ici n'est pas un oui." A card is a flat
panel sliding from the right, page font, no 3D.

## Interaction states

- **Rest.** The plate with its loops at 8 frames per second; counters live; crates placed.
- **Hover a robot or a station.** The sprite gains a thin pale outline (a second sprite
  layer), its name plate lights by one stop, the cursor is a hand; nothing else moves.
- **Selected.** The card opens; the rest of the scene drops one stop in exposure (a flat
  overlay at 20 % black, never a blur); the selected robot keeps full exposure; the belts
  that touch its station are highlighted with a pale dashed edge; the page pans up to
  10 % so the station sits in the left two thirds.
- **Waiting on Arslane.** The station mast beacon pulses amber at 0.5 Hz; the crate sits
  on the amber shelf; the card's first line is the exact action awaiting, in French, with
  "Approuver dans une session" (copies the demande id, opens nothing, sends nothing).
- **Blocked.** The robot's loop is blocked; the crate sits on the red pallet; the card
  shows the one-line reason and "Repasser en tête" (sets `heure` to the next pass and
  writes a `fil` line).
- **Paused.** A robot paused by Arslane sits idle with the shoulder lamp off and a small
  printed "PAUSE" plate hung on its station; the card offers "Reprendre".
- **Reduced motion.** Loops stop on their first frame, belts show crates in place, the
  beacon becomes a steady amber plate. Everything stays readable.
- **Empty.** A department with nothing to do shows its robots idle, the belts empty, and
  one French line under the header: "Rien en cours. Prochaine passe à HH:MM."

## Data each element reads

| Element | Rows | Fields | Refresh |
|---|---|---|---|
| Robot loop and lamp | `equipe/<role>` | `etat`, `pause` | 60 s |
| Robot card | `equipe/<role>`, `demandes` | `resume`, `derniere`, `kpi`, `demandes_en_cours`, each demande's `titre`, `statut`, `resultat` | on open |
| Crates | `demandes` with `role` | `statut`, `role`, `de_role`, `titre`, `heure` | 60 s |
| Belt travel | `fil` | lines `[de_role] -> [role]` of the last hour | 60 s |
| Counters | `equipe/<role>.kpi` | the one or two keys named in `STRUCTURE.md` | 60 s |
| Instrument lamps (Mars) | `controles/<date>` rows | each check's grade and raw value | 60 s |
| Clocks (Moon) | `echeances` row | each deadline's date and pack state | on open |
| Cash plate (Neptune, Earth) | `chiffres` | `tresorerie`, `date` | on open |
| Staging hall (Saturn) | `lots/<date>` row | counts kept and set aside, slots per zone, gate rate, cap | on open |
| Delivered shelf (Venus) | `livraisons/<client>/<date>` rows | seal, file names, date | on open |

The page writes two fields only, each with a `fil` line: `demandes.heure` (reprioritise)
and `equipe/<role>.pause`. Nothing else is ever written from the scene.

## Planets, storyboard by storyboard

The seven views map onto the departments of `STRUCTURE.md`; Planning (the chef's
calendar work) takes the Moon; Finance shares Neptune with Growth until an eighth view
exists, and its cash plate also hangs on Earth's tower.

### Earth, Aujourd'hui, Direction

Camera: 30 degrees, the sun just over the limb behind the base, long shadows toward the
viewer; the hub's robot is out of frame but its shadow could be. Light: warm sunrise key,
blue sky fill, practicals in the tower. Materials: the common palette with slate-blue
bands; grass and soil of the hub's Earth texture at base scale.

Stations: the tower (chef-orchestre) at the centre back, two storeys, a plate "PASSE
HH:MM" and the cash plate below it; the checkpoint (qualite), a low booth beside the main
outbound belt, with a hand stamp animation; the library (methode), a half-buried module to
the right with one reading lamp, open only on Sundays (its lamp is off the rest of the
week); six outbound belts leave the tower toward the six planets' launch pads at the edge
of the plate, each pad with a flat printed plate naming the planet.

Loops: chef working = turning between two consoles; qualite working = stamping a crate;
methode working = turning pages; idle and blocked and waiting as common.

Events: a pass starts, the tower's upper windows light (`etat = travaille`); a crate per
dispatched demande rides from the tower to its planet's pad and fades (a `fil` line `[chef]
-> [role]`); a crate returning to the checkpoint is a qualite handoff; a crate pushed onto
the red pallet is a `bloque`; the tower mast beacon is amber whenever any role waits on
Arslane.

Text one click away: the Aujourd'hui list as it is today.

### Jupiter, Boîte, Commercial inbound

Camera: 30 degrees, the storm bands filling the sky, the base on a rock shelf; the sun
low and pale through the haze. Light: cool key, ochre practicals. Materials: common palette
with ochre bands; the ground a dark basalt from the hub's moon-of-Jupiter family.

Stations: the receiving dock (boite), a long sorting bench with six chutes carrying flat
plates (RÉPONSE, CLIENT, FOURNISSEUR, PAIEMENT, OFFICIEL, BRUIT); a sky conveyor coming
down from the top of the frame with incoming crates; the writing desk (redaction), a
separate small module to the left with a desk lamp; the checkpoint booth (qualite) shared
in form with Earth's; the exit slot, a wall hatch with the amber shelf, plate "OUI".

Loops: boite working = pushing a crate into a chute; redaction working = writing by
hand on a plate; qualite as on Earth.

Events: a new thread is a crate on the sky conveyor; triage drops it in its chute; a stop
request flashes the dock's red lamp once and a crate leaves on the belt to Saturn's pad; a
reply needing text travels to the writing desk, then to the checkpoint, then rests at the
exit slot under the amber beacon until Arslane's "oui" in a session.

Counters: "fils non triés > 24 h" (red above zero); "arrêts traités dans l'heure";
"brouillons en attente de oui".

Text one click away: the Boîte view (threads and labels) unchanged.

### Saturn, Pipeline, Commercial outbound

Camera: 30 degrees, the rings as a thin bright line across the sky, the base on a pale
ice plain. Light: hard white key, warm practicals. Materials: common palette with ochre
bands; the ground the hub's Saturn moon ice at base scale.

Stations: the staging hall (prospection), an open hangar where the day's crates are lined
by launch pad; the gate, a frame at the hangar's mouth with one large lamp (green when the
last bounce rate is under the gate, red above); the warm-up silo, a tall tank with a
painted level gauge (the day's cap); seven launch pads along the edge, flat plates EST,
CENTRE, MONTAGNE, PACIFIQUE, ALASKA, HAWAÏ, AILLEURS, each with a mast light that is on
during its sending window; a side shelf for rows set aside, with their reasons on tags;
redaction's small writing module to the left as on Jupiter.

Loops: prospection working = checking crates against a clipboard; the gate lamp as a
two-frame loop; the pads' mast lights as two-frame loops.

Events: the latest `lots/<date>` row fills the hall with one crate per kept row at its
pad; set-aside rows appear on the shelf with their tag; the whole hall waits under the
amber beacon until the batch's demande turns `fait`; a bounce report above the gate turns
the lamp red and the belt carries the hall's crates to the shelf.

Counters: "lots envoyés après oui, semaine"; "taux de rebond du dernier lot"; "plafond du
jour".

Text one click away: the Pipeline view unchanged; the batch JSON's counts beside it.

### Moon, Semaine, Planning

Camera: 30 degrees, the Earth large and half-lit in the black sky, the base in a shallow
crater. Light: hard sun from the side, earthshine fill, warm practicals. Materials: common
palette; regolith from the hub's Moon texture.

Stations: the calendar wall (chef's planner arm), seven bays under a canopy, each with a
flat plate for the day, crates placed in the bays; the deadline desk (juridique-compta), a
module with three wall clocks under flat plates 5472, WYOMING, DOMAINE, each clock a disc
with a painted countdown sector; the observatory dome, decorative, its slit open toward
the Earth.

Loops: planner arm working = placing a crate in a bay; juridique-compta working = sorting
papers into a binder.

Events: the hourly pass places occurrence crates in their day's bay; a J-30, J-7 or J-1
reminder lights the matching clock; a reminder turning `a_toi` raises the amber beacon on
that clock; the Sunday review slides a crate onto the belt toward Earth's library.

Counters: "occurrences créées, semaine"; "jours avant la prochaine échéance" (red under
7); "dossiers prêts / dus".

Text one click away: the Semaine view unchanged.

### Mars, Contrôles, Infrastructure

Camera: 30 degrees, dust haze, the sun small and white; the base on a rust plain with a
ridge behind. Light: cool-white key, rust practicals. Materials: common palette with rust
bands; the hub's Mars texture at base scale.

Stations: five instrument masts in a loose arc (never evenly spaced), each with a flat
plate DOMAINE, SITE, SAUVEGARDES, SECRETS, LISTES and one lamp housing (green, amber,
red stills); the console module (controles) facing the masts; the radio dome (veille) on
the ridge with four dishes at different headings and heights, plates OFAC, UE, UK, ONU.

Loops: controles working = reading a strip chart; veille working = turning a dish by a
hand wheel; lamps as stills swapped by the page.

Events: each `controles/<date>` row repaints the five lamps at its time; a red lamp runs
the siren light once around the console and a red-band crate leaves for Earth's pad; a
list update seen by veille turns the matching dish and sends a plain crate to the console.

Counters: "contrôles rouges maintenant"; "âge de la dernière sauvegarde verte"; "jours
depuis la dernière mise à jour de liste vue".

Text one click away: the Contrôles view (the latest table) unchanged.

### Venus, Chantiers, Delivery

Camera: 30 degrees, the base on a platform above the cloud deck, the sun a bright smear
through the clouds. Light: diffuse warm key, moss-green practicals. Materials: common
palette with moss bands; the platform decking dominant, clouds below in depth of field.

Stations: the receiving bay with a flat plate COMMANDES; the workbench (livraison) with
two machines carrying plates SCREENING and AUDIT, each with a work lamp that is on while a
run lasts; the inspection gate (qualite) at the platform's exit; the shelf of delivered
folders, each with a small printed seal plate; a chute down to the cloud deck with a plate
FACTURE (handoff to encaissement).

Loops: livraison working = feeding a machine and reading its output plate; the machine
lamps as two-frame loops; qualite as elsewhere.

Events: an order crate arrives at the bay; the machine lamps run while `etat = travaille`;
the finished crate goes to the gate, then to the shelf with its seal plate, under the amber
beacon until Arslane's "oui" sends the folder; an invoice crate drops down the chute.

Counters: "livrables dus sous 7 jours"; "jours de la commande au livrable".

Text one click away: the Chantiers view unchanged; a folder's `note-envoi.md` from the
shelf.

### Neptune, Notes, Growth and Finance

Camera: 30 degrees, deep-blue sky with faint high cloud, the sun tiny and far; the base in
a sheltered valley of blue ice. Light: cold blue fill, strong warm practicals so the
interiors read as refuges. Materials: common palette with teal and oxblood bands; the ice
of the hub's Neptune family.

Stations: the reading room (veille) with a board of the week's notes as pinned flat plates;
the writing room (redaction) as on Jupiter; the counting house (encaissement) with a
cashier window, a cash plate "TRÉSORERIE" and its date plate, and a ledger wall of tags,
open invoices as tags whose colour deepens with age; the archive (methode) with a row of
binders, one per Sunday.

Loops: veille working = pinning a plate; redaction as elsewhere; encaissement working =
sliding a tag along the ledger.

Events: a matched payment turns a tag green; a failed payment or dispute flashes the window
red once and a red-band crate leaves for Earth; a finished draft travels to Jupiter's exit
slot; the Sunday review stacks the board's plates into one crate for Earth.

Counters: "factures ouvertes > 30 jours"; "trésorerie du <date>"; "notes portées à la
revue"; "brouillons retournés".

Text one click away: the Notes view unchanged; the cash figure is a number with its date.

## Blender assets to render

Cycles, 256 samples with denoising, ACES view transform, 2:1 pixel ratio for the isometric
read, PNG 16-bit with alpha for sprites, 8-bit for plates. Two sizes for every sprite (1x
and 2x). Every loop 12 frames at 8 frames per second unless stated. Station anchors are
exported from each scene as JSON (name, x, y, z-order) so the page never hard-codes a
position.

| Asset | Count | Size at 1x | Frames | Notes |
|---|---|---|---|---|
| Planet base plate (background with terrain, modules, belts, masts, sky) | 7 | 1920 by 1080 | 1 | one per planet, the sun and horizon continuing the hub's |
| Depth pass per base (for the page's parallax of 10 % at most) | 7 | 1920 by 1080 | 1 | 16-bit grey |
| Robot sprite sheet, working, per station task (typing, sorting, lifting, reading, stamping, pinning, wheel, clipboard, machine, binder, tag) | 11 | 160 by 240 per frame | 12 | one rig; department band tinted in the page from a mask channel |
| Robot idle | 1 | 160 by 240 | 24 | longer loop so two robots rarely sync |
| Robot blocked | 1 | 160 by 240 | 12 | slow blink of the red shoulder lamp |
| Robot waiting | 1 | 160 by 240 | 12 | amber lamp, upright |
| Robot paused (lamp off, hung plate) | 1 | 160 by 240 | 1 | |
| Crate plain, red band, amber band | 3 | 96 by 96 | 1 | stencil area left blank for the page's text plate |
| Red pallet | 1 | 128 by 80 | 1 | |
| Amber shelf (with beacon mast) | 1 | 160 by 200 | 12 | beacon pulse at 0.5 Hz |
| Belt pieces: straight, corner left, corner right, up-ramp, down-ramp, launch arc | 6 | 128 by 128 | 1 | crates move, belts do not |
| Station monitors (dark, lit) | 2 | 64 by 48 | 1 | |
| Lamps: green, amber, red, off | 4 | 32 by 32 | 1 | masts and gate |
| Gate frame with lamp housing | 1 | 320 by 240 | 1 | Saturn |
| Warm-up silo gauge levels | 5 | 160 by 320 | 1 | Saturn |
| Launch pad mast light on and off | 2 | 96 by 160 | 1 | Saturn |
| Deadline clock discs, five sector levels | 5 | 96 by 96 | 1 | Moon |
| Instrument mast with lamp housing | 1 | 96 by 260 | 1 | Mars, lamps composited |
| Radio dish at four headings | 4 | 128 by 128 | 1 | Mars |
| Machine lamps on and off | 2 | 64 by 64 | 1 | Venus |
| Seal plate (blank) | 1 | 64 by 40 | 1 | Venus shelf; the page prints the seal |
| Ledger tag in four ages | 4 | 48 by 24 | 1 | Neptune |
| Weather loops: Jupiter haze drift, Mars dust, Venus cloud deck, Neptune high cloud | 4 | 1920 by 1080 | 12 | optional, behind the base, off under reduced motion |
| Hover outline mask per robot and station sprite | from masks | same as sprite | 1 | generated from alpha, not rendered |

Budget: under 40 MB for all planets at 1x, under 120 MB at 2x, each planet loaded on
open only.

## Page logic

- One scene component per planet taking the anchor JSON and the rows of the data table;
  one robot component and one crate component shared by all.
- On open: fetch `equipe/*`, the planet's `demandes`, the last 50 `fil` lines, the
  planet's extra rows (controles, echeances, chiffres, lots, livraisons as the table
  says); place robots and crates; start loops at random frames.
- Every 60 seconds while open: refetch and animate the difference: a crate that changed
  station travels its belt path in 4 seconds; a changed state swaps the loop; a counter
  that changed ticks over 0.6 seconds; a new red lamp runs its siren light once.
- Escalations waiting on Arslane: text list above the scene on every planet, and the
  amber beacon on the robot's station.
- Card: slides from the right; `resume`, `derniere` as a relative time, the KPIs, the
  queue (titres of `demandes_en_cours` with their statut), the role's escalations; the
  three actions; "Liste" at the top right of the page at all times.
- Writes: `demandes.heure` and `equipe/<role>.pause` only, each with a `fil` line.
- Reduced motion: stills, no belt travel, steady amber plate for the beacon.
- Nothing on the page talks to mail, money or a file system; the dashboard's database is
  its only source and its only sink.

## Quality checklist, to tick before anything ships

Rendering
- [ ] Every surface has a roughness of 0.42 or more; no material is metallic above 0.2
      except the small monitor glass.
- [ ] One sun per planet, from the hub's sun direction; every other light has a visible
      source in frame.
- [ ] Two hull values present in every plate at a ratio near 70:30; nothing dimmed to make
      something else read.
- [ ] Depth of field with the focus plane across the stations; horizon and foreground
      soft; no vignette.
- [ ] No ring, trail, glitter, dust or sphere turning anywhere in the scene or the page.
- [ ] Every word in the scene is a flat printed plate; no extruded or beveled letters.

Composition
- [ ] Robots at different heights and depths, no two aligned, no two in the same frame of
      their loop at load.
- [ ] Each robot's working loop is the task of its station, visibly different from the
      next robot's.
- [ ] Stations unevenly spaced; belts take the believable path, not the shortest.
- [ ] The planet's horizon and sky are in frame on every base; the base reads as a place
      on that world, not a stage.

Data and honesty
- [ ] Every moving crate corresponds to a row that moved; nothing animates on a timer.
- [ ] Every counter value is a `kpi` key named in `STRUCTURE.md`; none is computed in the
      page.
- [ ] A robot's state is `equipe/<role>.etat`, written by the executor only.
- [ ] The amber beacon shows if and only if a demande of that role is `attend_oui`.
- [ ] The plain list opens in one click from every planet and shows the same rows.

Interaction and rules
- [ ] The three actions and nothing else; "Approuver" copies an id and opens nothing.
- [ ] The page writes `heure` and `pause` only, each with a `fil` line.
- [ ] Reduced motion leaves everything readable as stills and text.
- [ ] Every label, counter title and card line is French; no em dash anywhere on the page.
- [ ] No client value, no address, no amount tied to a named client appears in a scene
      without Arslane's choice.

Performance
- [ ] A planet opens under two seconds on the Mac on a warm cache; assets under 40 MB at 1x.
- [ ] Loops at 8 frames per second cost under 5 % CPU with all robots animated.
