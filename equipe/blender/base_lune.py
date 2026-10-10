"""
The Moon, Planning: the observatory with the giant calendar dial (equipe/TYCOON.md,
"Moon").

Hard black sky, the Earth low on the horizon as a real render, long shadows on grey dust.
A domed observatory (the dome a half sphere on a drum, its slit a dark plate) beside a
giant calendar dial laid flat on the regolith: a wide disc with seven sectors for the
week, a pointer mast at its centre whose shadow is the day's hand, the deadline clock
discs on short posts around the rim (one per deadline the `echeances` row carries, five
posts in the still, the page shows as many as there are). The planning table under the
dome holds the week's plates (the goals). The hub's robot stands here too in the
dashboard's sky; here the chef's planning self is `methode`'s Sunday counterpart: the
single robot is `chef-orchestre` at its planning table (the same agent, the Moon being
its calendar work).

Robots: chef-orchestre (planning table, clipboard).

Run: blender -b -P equipe/blender/base_lune.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "lune"
DEPT = "Planning"

g.preparer_scene(BASE)
g.camera(cible=(1.0, 0.0, 0.8), distance=44, elevation=32, azimut=35, focale=85)
g.eclairage(soleil_azimut=135, soleil_elevation=11, soleil_force=6.0, ciel=(0.02, 0.02, 0.03), ciel_force=0.2)
g.sol("moon", taille=160, couleur=(0.40, 0.40, 0.38, 1.0), echelle_texture=4)

# the Earth low on the horizon: a textured sphere far away, lit by the same sun
bpy.ops.mesh.primitive_uv_sphere_add(radius=14, location=(-70, 180, 18), segments=96, ring_count=48)
terre = bpy.context.active_object
terre.name = "Terre"
mt = g.materiau("Terre", (0.20, 0.35, 0.60, 1.0), 0.8)
chemin_terre = os.path.join(g.TEXTURES, "2k_earth_daymap.jpg")
if os.path.exists(chemin_terre):
    tex = mt.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(chemin_terre)
    mt.node_tree.links.new(tex.outputs["Color"], mt.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
g._appliquer(terre, mt)

# the observatory: a drum, a dome, the slit, a door, the planning table under an open side
drum = g.cylindre("Observatoire", (-8, 5, 0), rayon=4.5, hauteur=3.0, clair=True, sommets=64)
bpy.ops.mesh.primitive_uv_sphere_add(radius=4.6, location=(-8, 5, 3.0), segments=64, ring_count=32)
dome = bpy.context.active_object
dome.name = "Observatoire.dome"
g._appliquer(dome, g.materiau("Observatoire.dome", g.HULL_SOMBRE, 0.55))
bpy.ops.mesh.primitive_cube_add(location=(-8, 5, 5.5))
coupe = bpy.context.active_object       # cuts the sphere to a dome
coupe.scale = (6, 6, 2.5)
coupe.location.z = 0.5
mod = dome.modifiers.new("Coupe", "BOOLEAN")
mod.operation = "DIFFERENCE"
mod.object = coupe
coupe.hide_render = True
g.plaque("Observatoire.fente", (-8, 5, 6.2), 0, 0.5, 3.0, "")
bpy.context.active_object.rotation_euler = (math.radians(50), 0, 0)
g.fenetre("Observatoire.porte", (-8, 0.48, 1.3), 0, 1.4, 1.8)
g.plaque("Observatoire.plaque", (-8, 0.47, 3.3), 0, 2.2, 0.4, "SEMAINE")
table = g.banc("Table", (-8, -2.0, 0), 0, largeur=3.0, profondeur=1.2)
objectifs = [g.plaque(f"Objectif.{i}", (-9.2 + i * 1.2, -1.5, 1.25), 0, 1.0, 0.5, "") for i in range(3)]
for o in objectifs:
    o.rotation_euler = (math.radians(60), 0, 0)
g.pratique("Table.lampe", (-8, -2.2, 2.6), puissance=40)
g.moniteur("Table.ecran", (-6.3, -1.7, 1.4), 0)

# the giant calendar dial: a flat disc with seven sector lines, the pointer mast, the rim posts
cadran = g.cylindre("Cadran", (8, -1, 0), rayon=9.0, hauteur=0.18, clair=True, sommets=84)
for i in range(7):
    a = math.radians(90 + i * 360 / 7)
    bpy.ops.mesh.primitive_cube_add(location=(8 + 4.5 * math.cos(a), -1 + 4.5 * math.sin(a), 0.2))
    ligne = bpy.context.active_object
    ligne.name = f"Cadran.ligne.{i}"
    ligne.scale = (4.5, 0.05, 0.02)
    ligne.rotation_euler = (0, 0, a)
    g._appliquer(ligne, g.materiau(f"Cadran.ligne.{i}", g.HULL_SOMBRE, 0.7))
    g.plaque(f"Cadran.jour.{i}", (8 + 7.6 * math.cos(a + math.pi / 7), -1 + 7.6 * math.sin(a + math.pi / 7), 0.22), 0, 1.2, 0.4, "LMMJVSD"[i])
    bpy.context.active_object.rotation_euler = (0, 0, a + math.pi / 7 - math.pi / 2)
aiguille = g.mat("Cadran.aiguille", (8, -1, 0.18), hauteur=5.0, rayon=0.12)   # its shadow is the hand
horloges = []
for i in range(5):
    a = math.radians(200 + i * 28)
    x, y = 8 + 10.2 * math.cos(a), -1 + 10.2 * math.sin(a)
    g.mat(f"Echeance.{i}.pied", (x, y, 0), hauteur=1.4, rayon=0.05)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=0.06, location=(x, y, 1.6))
    h = bpy.context.active_object
    h.name = f"Echeance.{i}"
    h.rotation_euler = (math.radians(90), 0, a + math.pi / 2)
    h["genre"] = "horloge"
    g._appliquer(h, g.materiau(f"Echeance.{i}", g.PLAQUE, 0.6))
    horloges.append(h)
g.lampe("Cadran.lampe", (8, -1, 5.4), g.AMBRE, 0.12, 1.5)
g.balise("Cadran.balise", (18, -4, 0), hauteur=3.0)

# a short belt from the dial's rim to the pad: the week's demandes leaving for Earth
g.convoyeur("Tapis", [(8, -10.5, 0), (3, -14, 0), (-4, -15, 0)], hauteur=0.5)
g.cylindre("Pad", (-5.5, -15.5, 0), rayon=1.6, hauteur=0.25, clair=False)
g.plaque("Pad.plaque", (-5.5, -17.3, 0.6), 0, 1.6, 0.4, "TERRE")
g.caisse("Caisse.1", (5.2, -12.4, 0.58))
stations = [drum, table, *objectifs, cadran, aiguille, *horloges]

chef = g.robot("chef-orchestre", "chef-orchestre", DEPT, g.eparpiller((-8, -3.4, 0), 0.3), yaw=180)
robots = [chef]

taches = {"chef-orchestre": "clipboard"}
voisins = {"chef-orchestre": 55}
chemins = {
    "Table->Cadran": [(-8, -3.4, 0), (0, -5, 0), (8, -6, 0.2)],
    "Cadran->Pad": [(8, -6, 0.2), (3, -13, 0), (-4.5, -15.2, 0)],
}
extra = {"horloges": [h.name for h in horloges], "aiguille": "Cadran.aiguille", "terre": "Terre",
         "objectifs": [o.name for o in objectifs]}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins, duos=[], extra=extra)
