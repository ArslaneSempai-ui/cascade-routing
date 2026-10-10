"""
Jupiter, Commercial inbound and Clients: the floating cloud city (equipe/TYCOON.md,
"Jupiter").

No ground: a wide deck held above the cloud deck by three gas floats, the planet's bands
far below as the textured plane, haze between. On the deck: the docking bays where mail
arrives (three bays with their doors and lamps, boite's sorting table in front of them),
the reception desk at the centre with its bell and the "ACCUEIL" plate, and the Clients
wing to the right: onboarding's checklist wall, compte's renewal calendar, support's answer
desk. The Great Red Spot is out of frame; the page tints the haze when urgent mail waits.

Robots: boite (sorting table, sorting), onboarding (checklist wall, clipboard), compte
(calendar, pinning), support (answer desk, talking).

Run: blender -b -P equipe/blender/base_jupiter.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "jupiter"

g.preparer_scene(BASE)
g.camera(cible=(1.0, 0.0, 1.0), distance=44, elevation=30, azimut=35, focale=85)
g.eclairage(soleil_azimut=110, soleil_elevation=18, soleil_force=3.2, ciel=(0.80, 0.68, 0.50), ciel_force=0.8)

# the cloud deck far below: the planet's texture as the ground plane, 14 units down
sol = g.sol("jupiter", taille=200, couleur=(0.70, 0.55, 0.40, 1.0), echelle_texture=3)
sol.location.z = -14
# haze: a thin volume between the city and the clouds (Principled Volume on a big box)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -7))
brume = bpy.context.active_object
brume.name = "Brume"
brume.scale = (100, 100, 6.5)
mb = bpy.data.materials.new("Brume")
mb.use_nodes = True
nt = mb.node_tree
nt.nodes.remove(nt.nodes["Principled BSDF"])
vol = nt.nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Density"].default_value = 0.012
vol.inputs["Color"].default_value = (0.85, 0.75, 0.60, 1.0)
nt.links.new(vol.outputs["Volume"], nt.nodes["Material Output"].inputs["Volume"])
brume.data.materials.append(mb)

# the city deck on three floats
deck = g.module("Deck", (0, 0, -0.6), dimensions=(34, 22, 0.6), clair=False, biseau=0.15)
for i, (x, y) in enumerate(((-10, 4), (9, 6), (0, -7))):
    f = g.cylindre(f"Flotteur.{i}", (x, y, -7.5), rayon=4.5, hauteur=6.5, clair=True, sommets=64)
    g.cylindre(f"Flotteur.{i}.col", (x, y, -1.2), rayon=1.2, hauteur=0.7, clair=False)
g.convoyeur("Deck.bord", [(-17, -11, -0.1), (17, -11, -0.1)], largeur=0.3, hauteur=0.0)  # the rail along the front edge

# the docking bays: three bays at the back, doors as dark plates, a lamp each
baies = []
for i, x in enumerate((-12, -7, -2)):
    b = g.module(f"Baie.{i}", (x, 7, 0), dimensions=(4.2, 5, 3.6), clair=True)
    g.plaque(f"Baie.{i}.porte", (x, 4.48, 1.6), 0, 3.0, 2.8, "")
    g.lampe(f"Baie.{i}.lampe", (x + 1.7, 4.45, 3.3), g.VERT if i != 1 else g.AMBRE, 0.1, 2.0)
    baies.append(b)
g.plaque("Baies.plaque", (-7, 4.5, 3.9), 0, 3.0, 0.4, "ARRIVEES")
tri = g.banc("Tri", (-7, 1.2, 0), 0, largeur=3.4, profondeur=1.0)
g.convoyeur("Tapis.tri", [(-13, 0.6, 0), (-7, 0.6, 0), (1, 0.6, 0), (6, -2, 0)], hauteur=0.5)
g.caisse("Caisse.1", (-11, 0.6, 0.58))
g.caisse("Caisse.2", (-3, 0.6, 0.58), g.ROUGE)
g.pratique("Tri.lampe", (-7, 0.4, 2.4), puissance=40)

# the reception desk: a curved front (a short wide cylinder slice stands in), a bell, the plate
accueil = g.cylindre("Accueil", (3, -3, 0), rayon=2.0, hauteur=1.1, clair=True, sommets=48)
plaque_accueil = g.plaque("Accueil.plaque", (3, -5.05, 1.6), 0, 1.8, 0.4, "ACCUEIL")
g.lampe("Accueil.cloche", (4.2, -4.6, 1.25), (0.80, 0.62, 0.20, 1.0), 0.12, 0.6)
g.pratique("Accueil.lampe", (3, -3, 3.0), puissance=45)
g.balise("Accueil.balise", (0.5, -3.5, 0), hauteur=3.4)

# the Clients wing: a long low module, the checklist wall, the calendar, the answer desk
aile = g.module("Clients", (12, 3, 0), dimensions=(10, 7, 3.2), clair=False)
g.fenetre("Clients.fenetre.0", (9.5, -0.52, 2.0), 0, 1.4, 0.7)
g.fenetre("Clients.fenetre.1", (14.5, -0.52, 2.0), 0, 1.4, 0.7)
g.plaque("Clients.plaque", (12, -0.53, 3.5), 0, 2.4, 0.4, "CLIENTS")
checklist = [g.plaque(f"Checklist.{i}", (8.4, -0.55, 1.0 + i * 0.3), 0, 1.2, 0.22, "") for i in range(4)]
calendrier = g.plaque("Calendrier", (12, -0.55, 1.3), 0, 2.0, 1.2, "RENOUVELLEMENTS")
reponses = g.banc("Reponses", (16, -2.2, 0), 0, largeur=1.8)
g.moniteur("Reponses.ecran", (16, -1.9, 1.4), 0)
g.pratique("Reponses.lampe", (16, -2.6, 2.3), puissance=30)
g.etagere("Dossiers", (16.9, 2.0, 0), rotation_z=90, largeur=2.0, hauteur=2.0, niveaux=3)
stations = [*baies, tri, accueil, plaque_accueil, aile, *checklist, calendrier, reponses]

boite = g.robot("boite", "boite", "Commercial", g.eparpiller((-7, -0.4, 0), 0.3), yaw=180)
onboarding = g.robot("onboarding", "onboarding", "Clients", g.eparpiller((8.4, -2.0, 0), 0.3), yaw=180)
compte = g.robot("compte", "compte", "Clients", g.eparpiller((12, -2.0, 0), 0.3), yaw=180)
support = g.robot("support", "support", "Clients", g.eparpiller((16, -3.6, 0), 0.3), yaw=180)
robots = [boite, onboarding, compte, support]

taches = {"boite": "sorting", "onboarding": "clipboard", "compte": "pinning", "support": "talking"}
voisins = {"boite": -50, "onboarding": -40, "compte": 40, "support": 45}
chemins = {
    "Baie.1->boite": [(-7, 4.4, 0), (-7, 2.2, 0), (-7, -0.4, 0)],
    "boite->Accueil": [(-7, -0.4, 0), (-2, -3.2, 0), (1.0, -4.6, 0)],
    "Accueil->support": [(3, -5.5, 0), (10, -5.0, 0), (15.2, -3.6, 0)],
    "onboarding->compte": [(8.4, -2.0, 0), (10.2, -2.6, 0), (11.2, -2.0, 0)],
}
extra = {"brume": "Brume", "baies_lampes": [f"Baie.{i}.lampe" for i in range(3)], "cloche": "Accueil.cloche"}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", boite, support), ("passation", onboarding, compte)], extra=extra)
