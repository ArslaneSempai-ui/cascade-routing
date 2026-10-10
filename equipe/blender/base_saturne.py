"""
Saturn, Commercial outbound: the ring harvesting stations and the launch rail
(equipe/TYCOON.md, "Saturn").

The base sits on a large ring moonlet, the rings running across the whole frame as a flat
textured band at the horizon and Saturn's limb huge behind. Three harvesting stations
along the ring edge pull prospects in (list intake hoppers), the staging hall sorts them
(the gate frame with its lamp housing: the bounce gate), the warm-up silo shows the cap
(10, 20, 40, 80) as a flat gauge, and the launch rail sends batches out: a long straight
rail to a launch arc at the right edge, the pad mast light on while a wave is out. The
amber shelf by the gate holds the batch waiting for Arslane's yes.

Robots: prospection (staging hall, sorting) and redaction (the writing booth by the rail,
typing). The page places a small craft per prospect on the rings from the wave journals
(FEATURES.md, prospects as ships); the still carries no craft.

Run: blender -b -P equipe/blender/base_saturne.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "saturne"
DEPT = "Commercial"

g.preparer_scene(BASE)
g.camera(cible=(2.0, 0.0, 1.2), distance=46, elevation=30, azimut=35, focale=85)
g.eclairage(soleil_azimut=125, soleil_elevation=12, soleil_force=3.0, ciel=(0.80, 0.72, 0.55), ciel_force=0.5)
g.sol("saturn_moon", taille=140, couleur=(0.42, 0.40, 0.36, 1.0), echelle_texture=5)   # a grey ice moonlet when no texture

# the rings: a very wide flat band beyond the horizon, the ring texture when it exists
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 90, -3))
anneaux = bpy.context.active_object
anneaux.name = "Anneaux"
anneaux.scale = (260, 40, 1)
ma = g.materiau("Anneaux", (0.72, 0.66, 0.55, 1.0), 0.8)
chemin_anneau = os.path.join(g.TEXTURES, "2k_saturn_ring_alpha.png")
if os.path.exists(chemin_anneau):
    tex = ma.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(chemin_anneau)
    bsdf = ma.node_tree.nodes["Principled BSDF"]
    ma.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    ma.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
g._appliquer(anneaux, ma)
# Saturn's limb: a huge sphere far behind, textured when the file exists
bpy.ops.mesh.primitive_uv_sphere_add(radius=120, location=(-60, 260, -40), segments=96, ring_count=48)
saturne = bpy.context.active_object
saturne.name = "Saturne"
ms = g.materiau("Saturne", (0.78, 0.70, 0.52, 1.0), 0.9)
chemin_sat = os.path.join(g.TEXTURES, "2k_saturn.jpg")
if os.path.exists(chemin_sat):
    tex = ms.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(chemin_sat)
    ms.node_tree.links.new(tex.outputs["Color"], ms.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
g._appliquer(saturne, ms)

# three harvesting stations along the ring edge (the back of the plate): hoppers with intake arms
recoltes = []
for i, x in enumerate((-14, -6, 2)):
    s = g.module(f"Recolte.{i}", (x, 11, 0), dimensions=(4, 4, 2.6), clair=i % 2 == 0)
    bpy.ops.mesh.primitive_cone_add(radius1=1.6, radius2=0.5, depth=2.0, location=(x, 11, 3.6))
    tremie = bpy.context.active_object
    tremie.name = f"Recolte.{i}.tremie"
    g._appliquer(tremie, g.materiau(f"Recolte.{i}.tremie", g.HULL_SOMBRE, 0.6))
    bras = g.mat(f"Recolte.{i}.bras", (x, 13.5, 0), hauteur=6.0, rayon=0.12)
    bras.rotation_euler = (math.radians(-35), 0, 0)
    g.lampe(f"Recolte.{i}.lampe", (x + 1.6, 8.95, 2.3), g.VERT, 0.1, 1.8)
    recoltes.append(s)
g.plaque("Recoltes.plaque", (-6, 8.95, 3.0), 0, 2.6, 0.4, "LISTES")
g.convoyeur("Tapis.recolte", [(-14, 8.6, 0), (2, 8.6, 0), (6, 5, 0), (6, 1.5, 0)], hauteur=0.5)

# the staging hall: an open frame hall, the gate with its lamp housing, the sorting table, the silo gauge
hall = g.module("Hall", (6, -2, 0), dimensions=(9, 7, 3.4), clair=False)
g.plaque("Hall.plaque", (6, -5.52, 3.7), 0, 2.6, 0.4, "PREPARATION")
g.fenetre("Hall.fenetre.0", (3.5, -5.52, 2.0), 0, 1.6, 0.8)
g.fenetre("Hall.fenetre.1", (8.5, -5.52, 2.0), 0, 1.6, 0.8)
table = g.banc("Hall.table", (6, -7.0, 0), 0, largeur=3.2, profondeur=1.0)
g.pratique("Hall.lampe", (6, -7.2, 2.6), puissance=45)
# the gate: two posts and a lintel with the lamp housing (the bounce gate at 5 %)
g.mat("Porte.gauche", (10.8, -6.5, 0), hauteur=2.8, rayon=0.14)
g.mat("Porte.droite", (10.8, -9.0, 0), hauteur=2.8, rayon=0.14)
bpy.ops.mesh.primitive_cube_add(location=(10.8, -7.75, 2.85))
linteau = bpy.context.active_object
linteau.name = "Porte.linteau"
linteau.scale = (0.14, 1.4, 0.12)
g._appliquer(linteau, g.materiau("Porte.linteau", g.HULL_SOMBRE, 0.6, metallic=0.2))
porte_lampe = g.lampe("Porte.lampe", (10.8, -7.75, 3.15), g.VERT, 0.14, 2.5)
plaque_porte = g.plaque("Porte.plaque", (10.8, -6.3, 3.4), 90, 1.2, 0.3, "REBONDS")
# the warm-up silo: a tall cylinder with a flat gauge plate (10, 20, 40, 80)
silo = g.cylindre("Silo", (0.5, -4, 0), rayon=1.4, hauteur=5.0, clair=True, sommets=48)
jauge = g.plaque("Silo.jauge", (0.5, -5.42, 2.5), 0, 0.4, 3.6, "CHAUFFE")
# the amber shelf by the gate: the batch waiting for the yes
g.etagere("Attente", (13.5, -4.0, 0), rotation_z=90, largeur=2.0, hauteur=1.6, niveaux=2)
g.balise("Attente.balise", (13.5, -2.5, 0), hauteur=3.2)
g.caisse("Caisse.attente", (13.5, -4.2, 0.7), g.AMBRE, 0.6)

# the launch rail: a long straight rail from the gate to the arc at the right edge, the pad mast
g.convoyeur("Rail", [(11.5, -7.75, 0), (19, -7.75, 0), (23, -6.5, 0.5), (25.5, -4.0, 1.6)], largeur=0.8, hauteur=0.6)
bpy.ops.mesh.primitive_torus_add(major_radius=3.2, minor_radius=0.14, location=(25.5, -4.0, 1.6))
arc = bpy.context.active_object
arc.name = "Rail.arc"
arc.rotation_euler = (math.radians(90), 0, math.radians(-30))
g._appliquer(arc, g.materiau("Rail.arc", g.HULL_CLAIR, 0.55))
mast = g.mat("Rail.mat", (27.5, -2.0, 0), hauteur=5.0, rayon=0.1)
mast_lampe = g.lampe("Rail.mat.lampe", (27.5, -2.0, 5.2), g.ROUGE, 0.14, 0.0)   # on while a wave is out; the page lights it
g.caisse("Caisse.rail.1", (15, -7.75, 0.68))
g.caisse("Caisse.rail.2", (19.5, -7.6, 0.72))

# the writing booth by the rail: redaction's desk and its monitor
cabine = g.module("Cabine", (18, -2.5, 0), dimensions=(3.2, 2.8, 2.4), clair=True)
g.fenetre("Cabine.fenetre", (18, -3.92, 1.5), 0, 1.6, 0.7)
g.plaque("Cabine.plaque", (18, -3.93, 2.6), 0, 1.6, 0.35, "REDACTION")
pupitre = g.banc("Cabine.pupitre", (18, -5.1, 0), 0, largeur=1.6)
g.moniteur("Cabine.ecran", (18, -4.8, 1.4), 0)
g.pratique("Cabine.lampe", (18, -5.3, 2.2), puissance=30)
stations = [*recoltes, hall, table, porte_lampe, plaque_porte, silo, jauge, cabine, pupitre, mast]

prospection = g.robot("prospection", "prospection", DEPT, g.eparpiller((6, -8.4, 0), 0.3), yaw=180)
redaction = g.robot("redaction", "redaction", DEPT, g.eparpiller((18, -6.4, 0), 0.3), yaw=180)
robots = [prospection, redaction]

taches = {"prospection": "sorting", "redaction": "typing"}
voisins = {"prospection": -55, "redaction": 55}
chemins = {
    "Recolte->prospection": [(6, 1.5, 0), (6, -1.0, 0), (5.2, -8.4, 0)],
    "prospection->Porte": [(6, -8.4, 0), (8.5, -8.0, 0), (10.8, -7.75, 0)],
    "prospection->redaction": [(6, -8.4, 0), (12, -9.5, 0), (17.2, -6.4, 0)],
    "Porte->Rail.arc": [(10.8, -7.75, 0), (19, -7.75, 0), (25.5, -4.0, 1.6)],
}
extra = {"porte_lampe": "Porte.lampe", "jauge": "Silo.jauge", "mat_lampe": "Rail.mat.lampe",
         "anneaux": "Anneaux", "attente": "Caisse.attente"}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", prospection, redaction)], extra=extra)
