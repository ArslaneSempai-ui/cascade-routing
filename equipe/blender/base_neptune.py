"""
Neptune, the archive: the library under the ice (equipe/TYCOON.md, "Neptune"; the
company memory, FEATURES.md).

Deep blue light. The entrance is the only thing above the ice: a low dark porch with a
lamp and a stair cut into a wide opening, through which the camera sees the vault below:
a long hall of shelves lit by reading lamps, the ledger tags in four ages on the shelf
ends, the decisions wall (one plate per decision, the page prints the why and the source
file), the clients' and prospects' registers as two long shelves, and the reading table
where Crusetra answers "why did we choose this price?" with the source. The Notes list of
the hub lives here. The high cloud drifts above (the page's weather loop).

Robots: none permanently; the archive is served by every robot that comes to file a
decision. The still renders one visiting robot, `methode`, at the reading table (Sunday),
whose loops exist so a visitor can be shown; the page shows it only when a `fil` line of
the last hour names a decision filed.

Run: blender -b -P equipe/blender/base_neptune.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "neptune"

g.preparer_scene(BASE)
g.camera(cible=(0.0, 0.0, -3.0), distance=44, elevation=38, azimut=35, focale=85)
g.eclairage(soleil_azimut=120, soleil_elevation=20, soleil_force=1.4, ciel=(0.20, 0.35, 0.70), ciel_force=0.8)
sol = g.sol("neptune", taille=200, couleur=(0.12, 0.22, 0.45, 1.0), echelle_texture=2)
sol.location.z = -12   # the ice sheet is a thick slab; the ground plane is the deep below it

# the ice: a wide slab with a rectangular opening over the vault (boolean cut), faintly translucent
bpy.ops.mesh.primitive_cube_add(location=(0, 0, -0.75))
glace = bpy.context.active_object
glace.name = "Glace"
glace.scale = (70, 70, 0.75)
mg = g.materiau("Glace", (0.55, 0.72, 0.88, 1.0), 0.45)
mg.node_tree.nodes["Principled BSDF"].inputs["Transmission Weight"].default_value = 0.35
g._appliquer(glace, mg)
bpy.ops.mesh.primitive_cube_add(location=(1, -2, -0.75))
trou = bpy.context.active_object
trou.scale = (16, 10, 1.2)
trou.hide_render = True
cut = glace.modifiers.new("Ouverture", "BOOLEAN")
cut.operation = "DIFFERENCE"
cut.object = trou

# the vault below: floor, walls, long shelves, the reading lamps
g.module("Voute.sol", (1, -2, -9.3), dimensions=(34, 22, 0.3), clair=False)
g.module("Voute.fond", (1, 9.2, -9), dimensions=(34, 0.6, 7.5), clair=False)
g.module("Voute.gauche", (-16.2, -2, -9), dimensions=(0.6, 22, 7.5), clair=False)
g.module("Voute.droite", (18.2, -2, -9), dimensions=(0.6, 22, 7.5), clair=False)
rayons = []
for i in range(5):
    y = 6 - i * 3.2
    rayons += g.etagere(f"Rayon.{i}", (-6, y, -9), rotation_z=0, largeur=14, hauteur=4.5, niveaux=5)
    for s in (-1, 1):
        g.module(f"Rayon.{i}.montant{s}", (-6 + s * 7, y, -9), dimensions=(0.2, 0.5, 4.6), clair=True)
    g.pratique(f"Rayon.{i}.lampe", (-6, y - 0.8, -4.2), puissance=70, rayon=0.4)
    g.pratique(f"Rayon.{i}.lampe.b", (-11, y - 0.8, -4.2), puissance=50, rayon=0.4)
# ledger tags in four ages on the shelf ends (the page tints them by age)
etiquettes = [g.plaque(f"Etiquette.{i}", (1.12, 6 - i * 3.2, -6.5), 90, 0.3, 0.2, "") for i in range(4)]
# the decisions wall: a grid of small plates on the back wall
decisions = [g.plaque(f"Decision.{i}", (6 + (i % 6) * 1.4, 8.88, -4.0 - (i // 6) * 0.9), 0, 1.1, 0.6, "") for i in range(18)]
g.plaque("Decisions.plaque", (9.5, 8.88, -2.8), 0, 3.0, 0.4, "DECISIONS")
g.pratique("Decisions.lampe", (9.5, 7.2, -3.4), puissance=80, rayon=0.5)
# the two registers: clients and prospects, long shelves on the right wall
clients = g.etagere("Registre.clients", (14, 2, -9), rotation_z=90, largeur=8, hauteur=3.0, niveaux=4)
prospects = g.etagere("Registre.prospects", (14, -7, -9), rotation_z=90, largeur=8, hauteur=3.0, niveaux=4)
g.plaque("Registre.clients.plaque", (17.85, 2, -5.6), 90, 2.0, 0.35, "CLIENTS")
g.plaque("Registre.prospects.plaque", (17.85, -7, -5.6), 90, 2.0, 0.35, "PROSPECTS")
g.pratique("Registres.lampe", (15, -2.5, -4.5), puissance=70, rayon=0.4)
# the reading table under the opening, the one spot of warm light
table = g.banc("Table", (4, -4, -9.15), 0, largeur=3.2, profondeur=1.4)
g.pratique("Table.lampe", (4, -4, -6.5), puissance=90, rayon=0.3)
g.moniteur("Table.ecran", (5.0, -3.7, -8.2), 0)
g.plaque("Table.plaque", (4, -5.2, -8.4), 0, 1.6, 0.35, "SOURCE")
bpy.context.active_object.rotation_euler = (math.radians(60), 0, 0)
g.caisse("Table.dossier", (3.0, -4.0, -8.3), None, 0.4)

# the porch on the ice: a low dark module over the stair, a lamp, the plate; the stair down
porche = g.module("Porche", (-12, -12, 0), dimensions=(4, 4, 2.4), clair=False)
g.fenetre("Porche.porte", (-12, -14.02, 1.1), 0, 1.4, 1.6)
g.plaque("Porche.plaque", (-12, -14.03, 2.7), 0, 2.0, 0.4, "ARCHIVES")
g.lampe("Porche.lampe", (-10.5, -14.0, 2.3), (1.0, 0.72, 0.45, 1.0), 0.12, 2.0)
for k in range(12):
    g.module(f"Marche.{k}", (-12 + k * 0.9, -9.5, -0.75 * k), dimensions=(0.9, 2.4, 0.75), clair=True, biseau=0.02)
g.balise("Porche.balise", (-14.5, -14.5, 0), hauteur=3.0)
stations = [porche, table, *decisions[:6], clients[0], prospects[0], *etiquettes]

methode = g.robot("methode", "methode", "Direction", g.eparpiller((4, -5.6, -9.15), 0.3), yaw=180)
robots = [methode]

taches = {"methode": "reading"}
voisins = {"methode": 50}
chemins = {
    "Porche->Table": [(-12, -12, 0), (-2, -9.5, -8.2), (3, -5.6, -9.15)],
    "Table->Decisions": [(4, -5.6, -9.15), (7, 2, -9.15), (9.5, 7.6, -9.15)],
}
extra = {"decisions": [d.name for d in decisions], "etiquettes": [e.name for e in etiquettes],
         "registres": ["Registre.clients", "Registre.prospects"], "ouverture": {"x": 1, "y": -2, "w": 32, "h": 20}}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins, duos=[], extra=extra)
