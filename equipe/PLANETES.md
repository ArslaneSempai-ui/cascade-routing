# The planets as instruments

Each body of the hub keeps its real look: NASA-based textures, real light from one sun, real
scale, no glitter, no label painted on it. Its natural phenomena carry its department's
live state, subtly, so a glance at the sky says how the company is doing before a single
number is read. Everything is pre-rendered in Blender (Cycles) as layered variants or short
loops that the page switches or blends; the page never builds a body itself. The numbers
stay one click away on the planet's view; the phenomenon is a reading aid, never the only
place a state lives.

## Rules that hold for every body

- One sun, the real one, from one direction; a body's phenomenon changes its own surface
  or atmosphere, never the light of the scene.
- Thresholds come from the same fields the views show; a phenomenon never says more than
  its field. Where a field is missing or stale, the body shows its rest state and the
  page's tooltip says "donnée absente" with the date of the last one.
- Variants are rendered at the hub's resolution in two or three steps, cross-faded by the
  page over two seconds; loops are 24 frames at 8 frames per second unless stated; the
  page swaps a loop only when the field crosses a threshold, never on a timer.
- Reduced motion: every loop stops on its first frame; variants still switch; a comet
  becomes a still dot that appears and fades. Nothing is lost, nothing moves.
- Hover a body: its department name and the one French line of its state (the same line
  the `equipe` documents carry). Click: its view.

## Body by body

| Body | Department | Phenomenon | Field and thresholds | Render |
|---|---|---|---|---|
| Sun | Budget (quota) | The disc's brightness and the warmth of the light on the Earth's limb | `quota/<semaine>.part`: under 0.5 full white; 0.5 to 0.85 a slow warming; 0.85 to 0.95 visibly amber, the limb light redder; over 0.95 a dim orange disc. The mode word in the tooltip | Four variants of the sun disc and the limb glow, cross-faded; no corona animation |
| Earth | Direction | City lights on the night side brighten with the number of agents at work; the day side never changes | count of `equipe/*` with `etat = travaille`: 0 lights at the base level; 1 to 3 the main cities; 4 to 8 the coasts; 9 and more the whole night side | Three night-side emission variants composited over the real day-night terminator; the terminator follows the hub's sun |
| Earth's satellites | Direction | One tiny glint in low orbit per working agent, each on its own inclination, a count you can read | the same count, one sprite per agent, spaced by role so two never overlap | A 24-frame orbit loop per inclination (eight pre-rendered tracks); the page shows as many tracks as agents, never more than eleven on the Earth |
| Moon | Planning | The phase is the week's progress: new at Sunday 10:00, first quarter Tuesday evening, full by Saturday evening; the brightness of the lit part is the three goals' progress | phase from the clock, 28 steps; brightness from `objectifs` done of three: 0 a dim grey, 1 and 2 intermediate, 3 full albedo | 28 phase plates times 4 brightness levels, 112 stills, the right one shown; earthshine on the dark part constant |
| Mercury | Finance | The disc glows warmer with cash and dulls under the threshold | `chiffres.tresorerie`: over three months of runway the real sunlit grey; under three months a cooler, darker variant; under 1,000 USD or a stale figure (over 24 h) the darkest variant with a thin shadowed limb | Three surface variants (albedo and warmth), cross-faded; no glow halo |
| Venus | Delivery and Data | The cloud bands turn faster with the delivery workload; the engine's health is the cloud's clarity | workload = demandes `role: livraison` `en_cours` plus due within 7 days: 0 the slow real rotation; 1 to 2 one and a half times; 3 and more twice. Clarity: `donnees/qualite` within band crisp bands; a miss on the reference set a hazier, lower-contrast variant | Three cloud loops at three speeds, two contrast variants each: six loops of 24 frames; the body's limb never changes |
| Mars | Infrastructure | A dust storm rises when a control is red and clears when all is green; amber controls give a faint haze on the horizon | `controles/<date>` latest: all green the clear surface; any amber a thin haze band; any red a regional storm over the hemisphere facing the camera; a red older than 24 h a global storm | Four surface variants (clear, haze, regional storm, global storm) with a 24-frame drift loop for the storms, cross-faded over four seconds, never a flash |
| Jupiter | Commercial inbound and Clients | The Great Red Spot swells when urgent mail waits and shrinks back when it is handled | urgent = stop requests, disputes, unanswered client threads older than 24 h, support questions open past 48 h: 0 the real spot; 1 to 2 the spot a fifth larger and deeper red; 3 and more a third larger with a brighter rim | Three spot variants painted into the band texture at the spot's real longitude, rotating with the planet's real period in a 48-frame loop; the bands do not change |
| Saturn | Commercial outbound | The rings are the pipeline: density is prospects in play, a bright band is replies received, gaps are bounces | density from `equipe/prospection.kpi.prospects_en_jeu` in three steps; the bright band's width from replies this week (0, 1 to 5, over 5); gap count from the last batch's bounce rate (under 2 % none, under the 5 % gate one Cassini-like gap, over the gate two) | Ring plates in a 3 by 3 by 3 grid rendered once (27 stills), the body itself one real plate; the page picks the plate; the ring's shadow on the planet stays |
| Uranus | Marketing | The faint rings catch the light when a post goes out and fade over the day | `marketing/pieces/*` with `publieLe` within 24 h: none the rings barely visible; one the rings lit at the sun's angle; several a second lit arc | Three ring-light variants over the same pale disc; the tilt is the real 98 degrees; fade over a day by cross-fading at each pass |
| Neptune | The archive (the company memory, `FEATURES.md` 9) | The high cloud brightens for a day when a decision was filed, and the disc's blue deepens with the number of decisions in the archive | `decisions/*`: one filed in the last 24 h a bright cloud streak; none the plain disc; the count in three steps for the blue's depth (under 10, 10 to 50, over 50) | Two cloud variants and three blue depths over the real Voyager texture, cross-faded; the Great Dark Spot stays where it is |
| Pluto | Compliance | A thin red rim on the dark limb when a rule changed and nobody has read it; gone the moment it is marked read | `conformite/etat.lu`: true no rim; false a rim whose width grows with the oldest unread item's age (under 1 day thin, 1 to 3 days medium, over 3 days wide) | Three rim variants composited over the real New Horizons texture, far and small as it is; Charon beside it unchanged |
| DEV station | DEV | Lit modules per active project; the airlock lamp amber while a release waits for the "oui" | count of `dev/projets/*` with `etape` in `plan`, `en_cours`, `a_relire`: one module lit per project up to six; `attend_oui` on any project lights the airlock lamp | Station plate with six module emission masks switched by the page; the lamp a two-frame loop; solar wings track the real sun |
| Comets | Events | An incoming event arrives as a small realistic comet (a dust tail away from the sun) that reaches its planet and fades: a reply or a client mail to Jupiter, a payment to Mercury, a red control to Mars, a bounce report to Saturn, a list change to Pluto, a red suite to the station | each new `fil` line of kind event in the last pass, one comet each, at most three visible at once, the rest queued | One 48-frame comet loop rendered on a transparent plate along a straight path; the page rotates and scales the plate toward the target body; never a trail that lingers, the tail is part of the loop and fades with it |

## What the eye should read in one second

- The Sun bright and white: the week has room. Amber: Opus has become Sonnet. Orange: only
  urgent work runs.
- The Earth's night side busy: the team is working now. A dark night side at 10:00 on a
  weekday: look at the heartbeats.
- A fat red spot on Jupiter: a client or a stop request waits. A dust storm on Mars: a
  control is red. A red rim on Pluto: a rule changed and nobody read it. Mercury dull: cash
  under threshold or stale.
- Saturn's rings thin with gaps: the pipeline is short and the last batch bounced.
- The Moon full and bright on Saturday: the week's goals are done.

## Assets to render

The variants above: Sun 4 plates; Earth night 3 emission layers plus 8 satellite tracks of
24 frames; Moon 112 stills (small, the Moon is small in the hub); Mercury 3; Venus 6 loops;
Mars 4 variants, 2 of them with a 24-frame drift; Jupiter 3 spot variants over a 48-frame
rotation; Saturn 27 ring plates and 1 body plate; Uranus 3; Pluto 3 rims; the station plate
with 6 masks and a 2-frame lamp; 1 comet loop of 48 frames. All at the hub's resolution,
PNG with alpha where composited, and the real textures the hub already uses, so a variant
never introduces a new material or a new light.

## Data the page reads for the sky

`quota/<semaine>`; `equipe/*` (etat); `objectifs` of the week; `chiffres` (tresorerie,
date); `demandes` with `role: livraison`; `donnees/qualite` latest; `controles` latest;
the urgent counts from `boite` and `support` KPIs; `equipe/prospection.kpi`; the last
batch's gate rate; `marketing/pieces/*` with `publieLe`; `conformite/etat.lu` and the
oldest unread item; `dev/projets/*`; the last pass's `fil` events. Refresh every 60
seconds while the hub is open; a field missing leaves the body at rest with the tooltip
saying so.

## Amendments of 2026-10-10: milestones, forecasts and levels in the sky

**Milestone marks** (`FEATURES.md`, 3), one asset each, permanent once unlocked: the
Earth gains a small second moon in low orbit (first reply) and a city that lights on its
night side (first client); Mercury's cash tank in its base gains a gold band (first
1,000 USD); the DEV station gains a seventh module (first subtool shipped); Mars's radar
mast carries a steady green beacon (a month with every control green); Uranus's tall
tower a second lamp (first piece measured at J+7). Six small renders over the existing
plates; the hub's bodies change, not their orbits.

**Forecasts** (`FEATURES.md`, 7). Mercury's warmth above reads the runway rather than the
raw cash: over 6 months the sunlit grey, 3 to 6 months the cooler variant, under 3 months
the darkest; the same three variants as before, the field changes. Saturn's ring density
reads the pipeline's pace (clients per month projected) beside the count of prospects in
play: the thicker band is the pace. The thresholds are first values to correct from the
first month's figures, like every other threshold in this file.

**Agent levels** (`FEATURES.md`, 10). The level plate under a robot's name shows three
marks when success is at or over 0.9 and rework at or under 0.1 in the window, two marks
when success is at or over 0.75, one mark otherwise, none under 20 demandes. The cost is
printed on the card, never turned into a mark (a cheap robot is not a better one).

**Prospects as ships** (`FEATURES.md`, 11). The rings' three-step density stays for the
hub; in Saturn's base the rings carry one craft per prospect in five bands. Assets: the
cargo sprite of the general view at one heading, tinted by stage in the page.
