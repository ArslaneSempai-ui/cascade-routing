"""
Mars, Infrastructure: the fortified outpost (equipe/TYCOON.md, "Mars").

A walled compound on red regolith under a thin pink sky: the perimeter wall with its
corner shield emitters, the radar dish on its mast sweeping the horizon, the server bunker
half-buried at the back (its door lamp green when the backup is fresh), the instrument
masts along the inner wall, one lamp housing per check (domain, DNS, site, certificate,
backup, secrets, list freshness), and the vault: a small locked module whose plate the
page fills with the next expiring token (FEATURES.md, the vault on Mars). Dust rises
behind the wall when a control is red (the page's weather loop).

Robots: controles (instrument wall, dialing) and veille (the radio corner, watching the
list-freshness lamp).

Run: blender -b -P equipe/blender/base_mars.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "mars"
DEPT = "Infrastructure"

g.preparer_scene(BASE)
g.camera(cible=(0.0, 0.0, 1.2), distance=42, elevation=30, azimut=35, focale=85)
g.eclairage(soleil_azimut=130, soleil_elevation=15, soleil_force=3.4, ciel=(0.85, 0.62, 0.48), ciel_force=0.5)
g.sol("mars", taille=140, couleur=(0.48, 0.24, 0.14, 1.0), echelle_texture=5)

# the perimeter wall: four low bevelled walls with a gap at the front, a shield emitter at each corner
L, W, H = 26, 20, 2.2
g.module("Mur.nord", (0, W / 2, 0), dimensions=(L, 0.8, H), clair=False, biseau=0.15)
g.module("Mur.ouest", (-L / 2, 0, 0), dimensions=(0.8, W, H), clair=False, biseau=0.15)
g.module("Mur.est", (L / 2, 0, 0), dimensions=(0.8, W, H), clair=False, biseau=0.15)
g.module("Mur.sud.g", (-L / 2 + 5, -W / 2, 0), dimensions=(10, 0.8, H), clair=False, biseau=0.15)
g.module("Mur.sud.d", (L / 2 - 5, -W / 2, 0), dimensions=(10, 0.8, H), clair=False, biseau=0.15)
emetteurs = []
for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
    m = g.mat(f"Bouclier.{i}", (sx * L / 2, sy * W / 2, H), hauteur=1.8, rayon=0.1)
    emetteurs.append(g.lampe(f"Bouclier.{i}.lampe", (sx * L / 2, sy * W / 2, H + 2.0), (0.55, 0.75, 0.85, 1.0), 0.12, 1.2))
g.plaque("Porte.plaque", (0, -W / 2 - 0.42, 2.6), 0, 2.2, 0.4, "CONTROLES")
g.mat("Porte.g", (-3, -W / 2, 0), hauteur=3.0, rayon=0.12)
g.mat("Porte.d", (3, -W / 2, 0), hauteur=3.0, rayon=0.12)

# the server bunker: half-buried at the back, the door lamp (backup), a vent
bunker = g.module("Bunker", (-5, 6, 0), dimensions=(8, 5, 2.0), clair=True, biseau=0.25)
g.plaque("Bunker.porte", (-5, 3.48, 0.9), 0, 1.4, 1.6, "")
g.plaque("Bunker.plaque", (-5, 3.47, 2.3), 0, 2.0, 0.35, "SAUVEGARDE")
bunker_lampe = g.lampe("Bunker.lampe", (-3.9, 3.45, 1.9), g.VERT, 0.1, 2.0)
g.cylindre("Bunker.vent", (-8, 7, 2.0), rayon=0.35, hauteur=0.8, clair=False)
g.pratique("Bunker.pratique", (-5, 2.6, 2.4), puissance=30)

# the radar: a mast and a dish (a short cone) that the page shows at four headings
radar_mat = g.mat("Radar.mat", (6, 6, 0), hauteur=6.0, rayon=0.14)
bpy.ops.mesh.primitive_cone_add(radius1=1.6, radius2=0.3, depth=0.6, location=(6, 6, 6.4))
radar = bpy.context.active_object
radar.name = "Radar.antenne"
radar.rotation_euler = (math.radians(-60), 0, math.radians(35))
g._appliquer(radar, g.materiau("Radar.antenne", g.HULL_CLAIR, 0.55))
g.lampe("Radar.lampe", (6, 6, 6.9), g.ROUGE, 0.08, 1.0)

# the instrument wall: seven masts along the inner east wall, one lamp housing each
CONTROLES = ["DOMAINE", "DNS", "SITE", "CERTIFICAT", "SAUVEGARDE", "SECRETS", "LISTES"]
instruments = []
for i, nom in enumerate(CONTROLES):
    y = 6 - i * 2.0
    m = g.mat(f"Instrument.{nom}", (10.5, y, 0), hauteur=2.6 + (i % 2) * 0.4, rayon=0.08)
    g.lampe(f"Instrument.{nom}.lampe", (10.5, y, 2.8 + (i % 2) * 0.4), g.VERT, 0.1, 2.0)
    instruments.append(g.plaque(f"Instrument.{nom}.plaque", (10.0, y, 1.6), 90, 0.9, 0.25, nom))
pupitre = g.banc("Instruments.pupitre", (8, -1, 0), rotation_z=90, largeur=2.0)
g.moniteur("Instruments.ecran", (8.3, -1, 1.4), 90)
g.pratique("Instruments.lampe", (7.6, -1, 2.3), puissance=35)
# the dial board: four dials the robot turns (a dial is a short cylinder on a plate)
for i in range(4):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=0.08, location=(8.3, 0.2 - i * 0.4, 1.2))
    d = bpy.context.active_object
    d.name = f"Cadran.{i}"
    d.rotation_euler = (0, math.radians(90), 0)
    g._appliquer(d, g.materiau(f"Cadran.{i}", g.HULL_SOMBRE, 0.6))

# the vault: a small locked module by the bunker, the expiry plate the page fills
coffre = g.module("Coffre", (2, 6, 0), dimensions=(2.6, 2.6, 2.2), clair=False, biseau=0.12)
g.cylindre("Coffre.serrure", (2, 4.6, 0.9), rayon=0.4, hauteur=0.15, clair=True)
bpy.context.active_object.rotation_euler = (math.radians(90), 0, 0)
plaque_coffre = g.plaque("Coffre.plaque", (2, 4.67, 1.9), 0, 2.2, 0.35, "EXPIRE LE")
g.lampe("Coffre.lampe", (3.2, 4.65, 2.0), g.VERT, 0.08, 1.5)

# the radio corner: veille's seat under a small whip antenna, the list-freshness plate
radio = g.module("Radio", (-9, -5, 0), dimensions=(3, 3, 2.2), clair=True)
g.fenetre("Radio.fenetre", (-9, -6.52, 1.4), 0, 1.4, 0.6)
g.mat("Radio.antenne", (-10.2, -4.0, 2.2), hauteur=3.5, rayon=0.03)
plaque_radio = g.plaque("Radio.plaque", (-9, -6.53, 2.5), 0, 2.0, 0.35, "LISTES: J+N")
banc_radio = g.banc("Radio.banc", (-9, -7.6, 0), 0, largeur=1.6)
g.moniteur("Radio.ecran", (-9, -7.3, 1.4), 0)
g.pratique("Radio.lampe", (-9, -7.8, 2.2), puissance=25)

# the red pallet and the amber shelf by the gate
bpy.ops.mesh.primitive_cube_add(size=1, location=(-2, -7.5, 0.1))
palette = bpy.context.active_object
palette.name = "Palette"
palette.scale = (1.4, 1.0, 0.1)
g._appliquer(palette, g.materiau("Palette", g.ROUGE, 0.7))
g.etagere("Attente", (2.5, -7.5, 0), rotation_z=0, largeur=1.8, hauteur=1.4, niveaux=2)
g.balise("Attente.balise", (4.0, -7.2, 0), hauteur=3.0)
g.caisse("Caisse.1", (-2.1, -7.5, 0.2), g.ROUGE, 0.6)
stations = [bunker, radar_mat, *instruments, pupitre, coffre, plaque_coffre, radio, plaque_radio, banc_radio]

controles = g.robot("controles", "controles", DEPT, g.eparpiller((6.6, -1, 0), 0.3), yaw=270)
veille = g.robot("veille", "veille", DEPT, g.eparpiller((-9, -8.9, 0), 0.3), yaw=180)
robots = [controles, veille]

taches = {"controles": "dialing", "veille": "watching"}
voisins = {"controles": 60, "veille": -60}
chemins = {
    "controles->Bunker": [(6.6, -1, 0), (0, 1.5, 0), (-5, 2.4, 0)],
    "controles->Coffre": [(6.6, -1, 0), (3.5, 2.0, 0), (2, 3.8, 0)],
    "veille->controles": [(-9, -8.9, 0), (-2, -4, 0), (5.6, -1, 0)],
}
extra = {"instruments": [f"Instrument.{n}.lampe" for n in CONTROLES], "boucliers": [e.name for e in emetteurs],
         "radar": "Radar.antenne", "bunker_lampe": "Bunker.lampe", "coffre_plaque": "Coffre.plaque"}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("chef", veille, controles)], extra=extra)
