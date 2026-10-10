"""
Mercury, Finance: the counting house in a crater's shade (equipe/TYCOON.md, "Mercury").

The sun hard and low over the crater's rim; the base in the one cool wedge of shade. A
vault module dug into the inner wall, with a round cash tank beside it whose fill line the
page reads from `chiffres.tresorerie` (a flat gauge plate on its side); the cash window
where tresorier counts, with the figure plate and its date plate; the ledger wall where
comptable works under the deadline clocks; recouvrement's desk with the tone ladder as
three plates (30, 45, 60 days) and a bell. One belt brings invoices in from the pad; one
takes reminders out.

Robots: tresorier (cash window, counting), comptable (ledger wall, reading), recouvrement
(desk, typing).

Run: blender -b -P equipe/blender/base_mercure.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "mercure"
DEPT = "Finance"

g.preparer_scene(BASE)
g.camera(cible=(0.0, 0.0, 1.2), distance=40, elevation=30, azimut=35, focale=85)
# a hard, white, very low sun; almost no sky fill (no atmosphere), a faint warm bounce
g.eclairage(soleil_azimut=140, soleil_elevation=9, soleil_force=7.0, ciel=(0.25, 0.22, 0.20), ciel_force=0.25)
g.sol("mercury", taille=140, couleur=(0.36, 0.34, 0.32, 1.0), echelle_texture=4)

# the crater rim: a broken ring of dark slabs behind the base, casting the shade
for i, a in enumerate(range(100, 260, 20)):
    r = 22 + (i % 3) * 1.5
    x, y = r * math.cos(math.radians(a)), r * math.sin(math.radians(a))
    g.module(f"Rim.{i}", (x, y, 0), dimensions=(7 + (i % 2) * 2, 4, 5 + (i % 3) * 1.2), clair=False, biseau=0.5, rotation_z=a + 90)

# the vault, dug into the wall: a dark module with a round door plate and the cash tank
vault = g.module("Coffre", (-4, 9, 0), dimensions=(8, 6, 4), clair=False)
g.cylindre("Coffre.porte", (-4, 5.9, 0.6), rayon=1.3, hauteur=0.25, clair=True)
bpy.context.active_object.rotation_euler = (math.radians(90), 0, 0)
cuve = g.cylindre("Cuve", (5, 9, 0), rayon=2.4, hauteur=4.2, clair=True)
jauge = g.plaque("Cuve.jauge", (5, 6.55, 2.1), 0, 0.5, 3.2, "TRESORERIE")   # the page fills it to the cash level
g.lampe("Cuve.lampe", (6.8, 6.6, 4.0), g.VERT, 0.1, 1.5)

# the cash window: a counter with a glass slot, the figure plate and the date plate
guichet = g.module("Guichet", (-4, 1, 0), dimensions=(4.4, 1.2, 1.1), clair=True)
g.moniteur("Guichet.vitre", (-4, 0.35, 1.7), 0, 2.0, 1.0, allume=False)
plaque_chiffre = g.plaque("Guichet.plaque.chiffre", (-4, 0.38, 2.7), 0, 2.4, 0.5, "SOLDE")
plaque_date = g.plaque("Guichet.plaque.date", (-4, 0.38, 2.2), 0, 2.4, 0.3, "AU JJ/MM")
g.pratique("Guichet.lampe", (-4, -0.5, 2.4), puissance=35)
for i in range(5):  # counted pieces: small matte discs on the counter
    bpy.ops.mesh.primitive_cylinder_add(radius=0.12, depth=0.04, location=(-5.2 + i * 0.5, 0.9, 1.13))
    g._appliquer(bpy.context.active_object, g.materiau(f"Piece.{i}", (0.80, 0.62, 0.20, 1.0), 0.55))

# the ledger wall: shelves of binders, three deadline clock discs above
g.etagere("Registres", (4, 2.2, 0), rotation_z=0, largeur=4.0, hauteur=2.4, niveaux=4)
for i in range(3):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=0.05, location=(2.8 + i * 1.2, 2.45, 3.1))
    h = bpy.context.active_object
    h.name = f"Horloge.{i}"
    h.rotation_euler = (math.radians(90), 0, 0)
    h["genre"] = "horloge"
    g._appliquer(h, g.materiau(f"Horloge.{i}", g.PLAQUE, 0.6))
pupitre = g.banc("Registres.pupitre", (4, 0.4, 0), 0, largeur=1.8)
g.pratique("Registres.lampe", (4, 0.0, 2.3), puissance=30)

# recouvrement's desk: the tone ladder as three plates, a bell, the outbound belt
bureau = g.banc("Relances", (11, -1, 0), 0, largeur=2.0)
g.moniteur("Relances.ecran", (11, -0.7, 1.4), 0)
echelle = [g.plaque(f"Relances.plaque.{j}", (9.6 + i * 1.4, 1.0, 1.9), 0, 1.1, 0.35, f"J+{j}") for i, j in enumerate((30, 45, 60))]
g.lampe("Relances.cloche", (12.2, -0.8, 1.2), (0.80, 0.62, 0.20, 1.0), 0.14, 0.6)
g.balise("Relances.balise", (13.5, 1.5, 0), hauteur=3.0)
g.pratique("Relances.lampe", (11, -1.6, 2.2), puissance=30)

# belts: invoices in from the pad on the left, reminders out to the pad on the right
g.cylindre("Pad.entree", (-16, -9, 0), rayon=1.6, hauteur=0.25, clair=False)
g.cylindre("Pad.sortie", (17, -10, 0), rayon=1.6, hauteur=0.25, clair=False)
g.convoyeur("Tapis.entree", [(-16, -9, 0), (-9, -5, 0), (-4, -2.2, 0)], hauteur=0.5)
g.convoyeur("Tapis.sortie", [(11, -3.2, 0), (14, -7, 0), (17, -10, 0)], hauteur=0.5)
g.caisse("Caisse.1", (-9.5, -5.3, 0.58))
g.caisse("Caisse.2", (13.5, -6.4, 0.58), g.AMBRE)
stations = [guichet, plaque_chiffre, plaque_date, cuve, jauge, pupitre, bureau, *echelle, vault]

tresorier = g.robot("tresorier", "tresorier", DEPT, g.eparpiller((-4, -1.2, 0), 0.3), yaw=180)
comptable = g.robot("comptable", "comptable", DEPT, g.eparpiller((4, -0.9, 0), 0.3), yaw=180)
recouvrement = g.robot("recouvrement", "recouvrement", DEPT, g.eparpiller((11, -2.4, 0), 0.3), yaw=180)
robots = [tresorier, comptable, recouvrement]

taches = {"tresorier": "counting", "comptable": "reading", "recouvrement": "typing"}
voisins = {"tresorier": 45, "comptable": -40, "recouvrement": -45}
chemins = {
    "tresorier->comptable": [(-4, -1.2, 0), (0, -1.6, 0), (3.2, -0.9, 0)],
    "comptable->recouvrement": [(4, -0.9, 0), (7.5, -2.0, 0), (10.2, -2.4, 0)],
    "Pad.entree->tresorier": [(-16, -9, 0), (-9, -5, 0), (-4.8, -1.2, 0)],
}
extra = {"jauge": "Cuve.jauge", "horloges": ["Horloge.0", "Horloge.1", "Horloge.2"], "cloche": "Relances.cloche"}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", tresorier, comptable)], extra=extra)
