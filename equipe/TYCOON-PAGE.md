# The tycoon page: how the renders become a living place

Companion to `TYCOON.md` (what each base is) and `blender/` (what renders it). This file
says what the page does with the files the scripts write: `rendu/<base>/base.png`,
`rendu/<base>/nuit.png`, `rendu/<base>/<robot>/<action>/NNNN.png`,
`rendu/<base>/<robot>/attention/NNNN.png`, `rendu/<base>/duos/<kind>_<a>_<b>/NNNN.png`,
`rendu/<base>/positions.json`, `rendu/<base>/poids.json`, and `rendu/general/*`.
Nothing here is a 3D engine: the page is layers of images moved by CSS and a little
JavaScript, and the database is its only source and sink (`DASHBOARD.md`).

## Layers, bottom to top

1. **Plate.** `base.png` by day, `nuit.png` from 23:00 to 8:00 in Arslane's time zone
   (`FEATURES.md`, day and night), cross-faded over 3 seconds at the switch. The plate
   never moves except the 10 % pan when a card opens.
2. **State swaps on the plate.** Small image patches the scripts list under `extra`
   (lamps, gauges, plates, the Sunday window): each is a cut-out at its `positions.json`
   box, drawn over the plate with the colour or fill the data says. A lamp is a 32 by 32
   patch; a gauge is a clipped rectangle; a plate's text is live HTML positioned at the
   box, in the page font, never an image of text.
3. **Crates.** One sprite per demande, placed at its station's box or moving along a
   path from `positions.json["chemins"]` (a screen polyline; the crate eases along it in
   4 seconds). Stencil text as HTML over the sprite.
4. **Robots.** One `<div>` per robot anchored at `pied` (its feet), playing one loop at
   a time from its folder at 8 frames per second, with the `regard_camera` yaw known for
   hover. A robot's loops are drawn at the still's scale; the box in `positions.json`
   is its click zone.
5. **Duos.** The social loops: a single sprite covering both robots, played at the
   handoff point; while it plays, the two single robots are hidden.
6. **Text.** Header, KPI counters at their plate boxes, the "Liste" toggle, the
   escalations list, the card. HTML, page font, always above every image.

## Chaining the loops: the life of one robot

Every loop starts and ends on the rest pose, so any two chain without a seam. The page
runs one small state machine per robot, ticking at the end of each loop:

| State of `equipe/<role>` | Loop pool | Rule |
|---|---|---|
| `travaille` | `working` 70 %, then one of `idle_regard`, `idle_balance`, `idle_voisin` | never the same idle twice in a row |
| `libre` | `idle_regard`, `idle_balance`, `idle_voisin`, `idle_etire` (rarely), `range` when the base is quiet | `idle_etire` at most once per 2 minutes |
| `bloque` | `bloque` | until the state changes; the chief's duo may play once |
| `attend_oui` | `attend` | the beacon pulses meanwhile |
| `pause` | first frame of `idle_regard`, lamp off, "PAUSE" plate | no loop |
| night | `recharge` at the dock point | from 23:00; `reveil` once at 8:00 then the day pool |

Randomness: each robot starts at a random frame offset, draws its next loop from the
pool with the weights above, and waits a random 0 to 2 seconds between loops in
`libre`. Two robots are never allowed to begin the same loop in the same second (the
page staggers the second one by one loop).

Reactions interrupt the pool and return to it:

- a crate arriving at the station: `reagit_tourne` toward the path's last segment;
- a `fil` line of the last minute saying Arslane's "oui" on one of its demandes:
  `reagit_joie` once;
- a comet in the hub's sky (`PLANETES.md`): `reagit_tourne` for the robots whose base is
  the comet's department;
- a handoff `[a] -> [b]` inside the base: the duo `passation_a_b` if it was rendered,
  else `marche` for `a` along the path `a->b` then `reagit_tourne` for `b`;
- a robot entering `bloque` while the chief is in the base: the duo `chef_<chef>_<b>`
  once, then `bloque`.

Attention: on hover the page shows `attention/0001..0005` in 150 ms (head turning to the
viewer) and holds the last frame; on leave it plays them backward. On click: `clic`
once, held on its last frame while the card is open.

## Mood from data

- **Queue length** (`demandes_en_cours` of the role): above 3, the `working` loop plays
  at 10 frames per second and a small steam puff (a 6-frame sprite) rises every other
  loop; above 6, at 12 frames per second.
- **Quiet** (the base has no `a_faire` or `en_cours` for 30 minutes): the `range` loop
  enters the pool at 20 %.
- **Quota** (`quota.mode`): `economie` plays every loop at 6 frames per second and the
  plate's windows one stop dimmer; `arret` holds every robot on the first frame of
  `recharge` with the beacon off, whatever the hour.
- **Base-wide rhythm** is one multiplier per base (0.5 to 1.5) applied to every loop's
  frame rate; nothing else changes speed.

## Click zones and transitions

- **Hub to planet to base.** A click on a planet in the hub opens its base: the plate
  fades in over the sky in 400 ms while the sky's planet scales to the plate's frame.
- **Base to robot card.** A click inside a robot's box: `clic` plays, the scene drops
  one stop under a flat 20 % black overlay, the card slides in from the right in 250
  ms, the plate pans so the robot sits in the left two thirds.
- **Robot card back to base.** Escape, the close control, or a click on the overlay: the
  card slides out, the overlay lifts, the robot returns to its pool.
- **Station card.** A click on a station box opens the station's card (its counters,
  its crates, its last `fil` lines); same motion.
- **Base back to hub.** The breadcrumb or Escape at the base level.
- **General view.** A click on the giant Crusetra in the hub opens `rendu/general`:
  the plate, the Sun variant for `quota.mode`, each base's glow scaled by the number
  of robots in `travaille` on it (a radial gradient at `base` of each body, from 0 to
  1), cargo ships at the interpolated point of each `fil` handoff of the last hour
  between two bodies (heading from the four renders, the closest one), the KPI bar
  above (the five figures of `DASHBOARD.md`, each with its source), the escalations
  pinned below. A click on a body opens its base.
- **Plain list.** "Liste" at the top right on every level opens the same data as text,
  one click; the URL keeps `?vue=liste` so a reload stays in the list.

## Reduced motion and accessibility

- `prefers-reduced-motion`: every robot on the first frame of its current loop, no
  cross-fade, no belt travel (crates placed), the beacon as a steady amber plate, hover
  shows the last attention frame directly, the general view's ships placed and still.
- Every robot and station box is a button with its name and state as its label; the
  loops are decorative images (`aria-hidden`), the facts are in the text layer.
- Keyboard: Tab across the boxes in `positions.json` order, Enter opens, Escape backs
  out one level.

## Loading and weight

Measured from `blender/base_commune.py` (`ACTIONS`, `ATTENTION`) and each base script
(robots and duos), at 18 KB per PNG frame with alpha at 1x and about 6 KB as a WebP
sprite sheet:

| Base | Robots | Duos | Frames | PNG 1x | WebP sheets |
|---|---|---|---|---|---|
| terre | 4 | 2 | 1044 | 18.4 MB | 6.1 MB |
| mercure | 3 | 1 | 771 | 13.6 MB | 4.5 MB |
| jupiter | 4 | 2 | 1044 | 18.4 MB | 6.1 MB |
| saturne | 2 | 1 | 522 | 9.2 MB | 3.1 MB |
| mars | 2 | 1 | 522 | 9.2 MB | 3.1 MB |
| venus | 4 | 2 | 1044 | 18.4 MB | 6.1 MB |
| lune | 1 | 0 | 249 | 4.4 MB | 1.5 MB |
| uranus | 7 | 3 | 1815 | 31.9 MB | 10.6 MB |
| neptune | 1 | 0 | 249 | 4.4 MB | 1.5 MB |
| pluton | 3 | 1 | 771 | 13.6 MB | 4.5 MB |
| station_dev | 8 | 4 | 2088 | 36.7 MB | 12.2 MB |
| all | 39 | 17 | 10119 | 177.9 MB | 59.3 MB |

A robot carries 249 frames (fourteen loops of 244 frames and five attention frames); a
duo 24. The page loads one base at a time, and within a base the loops in this order:
the plate, `idle_regard` and `working` for every robot, the attention frames, then the
rest as idle bandwidth allows; a loop not yet loaded is replaced by `idle_regard`. The
first ship can carry the minimal set only (`idle_regard`, `working`, `bloque`,
`attend`, `clic`, attention: 93 frames per robot, 3627 frames in all, 63.8 MB as PNG
and 21.3 MB as WebP sheets) and gain the other loops base by base. The 2x set is for
the Mac screen only and is loaded on demand.

## What the page writes

`demandes.heure` (reprioritise) and `equipe/<role>.pause`, each with a `fil` line, as
`TYCOON.md` says; the day and night switch, the moods and the reactions write nothing.
A click is never a yes.
