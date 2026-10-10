"""
Earth, Direction: the command centre on a coastline (equipe/TYCOON.md, "Earth").

A two-storey tower at the centre back on a low headland, the sea on the right under a
long sunrise, the checkpoint booth beside the main outbound belt, the library half-buried
to the left with its one reading lamp, six outbound belts fanning toward six launch pads
at the plate's edge, each pad with a flat plate naming its planet. The budget robot stands
alone on the tower roof reading the sky (the Sun has no base).

Robots: chef-orchestre (tower console, typing), qualite (checkpoint, stamping), methode
(library, reading; its lamp is lit on Sundays only, the page swaps the still's lamp layer),
budget (roof, watching).

Run: blender -b -P equipe/blender/base_terre.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402

BASE = "terre"
DEPT = "Direction"

g.preparer_scene(BASE)
g.camera(cible=(0.0, 1.0, 1.5), distance=46, elevation=30, azimut=35, focale=85)
g.eclairage(soleil_azimut=115, soleil_elevation=14, soleil_force=4.0, ciel=(0.55, 0.65, 0.85), ciel_force=0.6)

# ground: the Earth texture at base scale, and the sea as a matte dark plane on the right
g.sol("earth", taille=140, couleur=(0.22, 0.30, 0.16, 1.0), echelle_texture=5)
import bpy  # noqa: E402
bpy.ops.mesh.primitive_plane_add(size=140, location=(52, 0, 0.02))
mer = bpy.context.active_object
mer.name = "Mer"
g._appliquer(mer, g.materiau("Mer", (0.04, 0.10, 0.16, 1.0), roughness=0.42))
# the headland: a low wide slab so the tower stands above the shore
g.module("Falaise", (0, 4, 0), dimensions=(30, 18, 0.9), clair=False, biseau=0.3)

# the tower: two storeys, a roof deck, the mast with the beacon
tour_bas = g.module("Tour.bas", (0, 7, 0.9), dimensions=(7, 6, 3.2), clair=True)
tour_haut = g.module("Tour.haut", (0, 7, 4.1), dimensions=(6, 5, 3.0), clair=False)
toit = g.module("Tour.toit", (0, 7, 7.1), dimensions=(6.4, 5.4, 0.2), clair=True)
for i, x in enumerate((-1.8, 0.0, 1.8)):
    g.fenetre(f"Tour.fenetre.{i}", (x, 4.45, 5.8), 0, 1.0, 0.6)         # upper windows light when the pass runs
g.fenetre("Tour.porte", (0, 3.98, 1.9), 0, 1.2, 1.6, allumee=False)
g.balise("Tour.balise", (2.6, 8.8, 7.3), hauteur=3.2)
plaque_passe = g.plaque("Tour.plaque.passe", (-1.6, 3.96, 3.4), 0, 2.2, 0.5, "PASSE HH:MM")
plaque_cash = g.plaque("Tour.plaque.tresorerie", (-1.6, 3.96, 2.7), 0, 2.2, 0.5, "TRESORERIE")
# the console on the ground floor, in front of the tower: two monitors and a bench
console = g.banc("Console", (0, 2.2, 0.9), rotation_z=0, largeur=2.6)
g.moniteur("Console.ecran.g", (-0.7, 2.5, 1.9), 0)
g.moniteur("Console.ecran.d", (0.7, 2.5, 1.9), 0)
g.pratique("Console.lampe", (0, 1.8, 2.6), puissance=40)

# the checkpoint: a low booth beside the main belt, with the stamp bench and the red pallet
booth = g.module("Checkpoint", (9, -1, 0.9), dimensions=(3.2, 2.6, 2.2), clair=False)
g.fenetre("Checkpoint.fenetre", (9, -2.31, 2.1), 0, 1.4, 0.7)
tampon = g.banc("Checkpoint.banc", (9, -3.6, 0.9), 0, largeur=1.8)
g.plaque("Checkpoint.plaque", (9, -2.32, 2.9), 0, 1.8, 0.4, "CONTROLE")
g.pratique("Checkpoint.lampe", (9, -3.4, 2.4), puissance=35)
bpy.ops.mesh.primitive_cube_add(size=1, location=(12, -3.5, 1.0))
palette = bpy.context.active_object
palette.name = "Checkpoint.palette"
palette.scale = (1.4, 1.0, 0.1)
g._appliquer(palette, g.materiau("Checkpoint.palette", g.ROUGE, 0.7))
g.caisse("Checkpoint.caisse", (9.3, -4.3, 0.9))
# the amber shelf of the checkpoint (attend_oui crates rest here)
g.etagere("Checkpoint.etagere", (6.6, -1.0, 0.9), rotation_z=90, largeur=2.0, hauteur=1.6, niveaux=2)

# the library: half-buried, one reading lamp, a low plate
biblio = g.module("Bibliotheque", (-11, 2, 0.9), dimensions=(5, 4, 1.6), clair=True, biseau=0.2)
g.fenetre("Bibliotheque.fenetre", (-11, -0.01, 1.9), 0, 2.0, 0.5, allumee=False)   # Sunday only; the page lights it
g.plaque("Bibliotheque.plaque", (-11, -0.02, 2.65), 0, 1.6, 0.35, "METHODE")
g.banc("Bibliotheque.pupitre", (-11, -1.6, 0.9), 0, largeur=1.4, profondeur=0.6)
lampe_lecture = g.pratique("Bibliotheque.lampe", (-10.4, -1.7, 2.2), puissance=25, rayon=0.15)
lampe_lecture.name = "Bibliotheque.lampe.dimanche"

# six outbound belts from the tower's door to six pads at the plate's edge
PLANETES = [("JUPITER", (-16, -14)), ("SATURNE", (-8, -17)), ("LUNE", (0, -18)),
            ("MARS", (8, -17)), ("VENUS", (16, -14)), ("URANUS", (22, -9))]
stations = [plaque_passe, plaque_cash, booth, biblio, tour_bas]
for nom, (px, py) in PLANETES:
    chemin = [(0, 1.0, 0.9), (px * 0.35, py * 0.35 + 0.5, 0.9), (px * 0.75, py * 0.75, 0.9), (px, py, 0.9)]
    if nom == "MARS":   # the main belt passes the checkpoint
        chemin = [(0, 1.0, 0.9), (9, -4.6, 0.9), (px, py, 0.9)]
    g.convoyeur(f"Tapis.{nom}", chemin, largeur=0.9, hauteur=1.0)
    g.cylindre(f"Pad.{nom}", (px, py, 0.9), rayon=1.6, hauteur=0.25, clair=False)
    stations.append(g.plaque(f"Pad.{nom}.plaque", (px, py - 1.7, 1.5), 0, 1.6, 0.4, nom))
    g.lampe(f"Pad.{nom}.lampe", (px + 1.3, py - 1.3, 1.45), g.VERT, 0.1, 2.0)

# a few crates on the belts (demandes in transit in the still)
g.caisse("Caisse.1", (-5.5, -5.2, 1.08))
g.caisse("Caisse.2", (3.1, -1.5, 1.08), g.AMBRE)
g.caisse("Caisse.3", (0.2, -11.5, 1.08), g.ROUGE)

# robots, each at its station, scattered by the seeded jitter
chef = g.robot("chef-orchestre", "chef-orchestre", DEPT, g.eparpiller((0, 0.6, 0.9), 0.4), yaw=180)
qualite = g.robot("qualite", "qualite", DEPT, g.eparpiller((9, -4.9, 0.9), 0.3), yaw=180)
methode = g.robot("methode", "methode", DEPT, g.eparpiller((-11, -2.8, 0.9), 0.3), yaw=180)
budget = g.robot("budget", "budget", "Budget", (1.4, 6.2, 7.3), yaw=200, echelle=0.5)
robots = [chef, qualite, methode, budget]

taches = {"chef-orchestre": "typing", "qualite": "stamping", "methode": "reading", "budget": "watching"}
voisins = {"chef-orchestre": -45, "qualite": 50, "methode": -40, "budget": 30}    # head yaw toward the neighbour
chemins = {
    "chef-orchestre->qualite": [(0, 0.6, 0.9), (4.5, -2.2, 0.9), (8.2, -4.9, 0.9)],
    "chef-orchestre->methode": [(0, 0.6, 0.9), (-5.5, -1.2, 0.9), (-10.2, -2.8, 0.9)],
    "qualite->Pad.MARS": [(9, -4.9, 0.9), (8.5, -12, 0.9), (8, -16, 0.9)],
}
extra = {"nuit_fenetres": ["Tour.fenetre.0", "Tour.fenetre.1", "Tour.fenetre.2"],
         "dimanche": ["Bibliotheque.fenetre", "Bibliotheque.lampe.dimanche"],
         "pads": [p[0] for p in PLANETES]}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", chef, qualite), ("chef", chef, methode)], extra=extra)
