"""
Venus, Delivery and Data: the floating refinery under the cloud deck (equipe/TYCOON.md,
"Venus").

Nothing stands on Venus: the plant hangs from a buoyant ring under the sulphur cloud
deck, in yellow-grey light coming from everywhere and nowhere. The refinery is the
vertical plant of the look-dev: a stacked column of process modules (intake, screening,
report) with the delivered shelf at its foot where sealed reports rest; behind it the
engine room: listes' intake with four hoppers (OFAC, UN, EU, UK), donnees-qualite's test
bench with the reference set under a lamp, benchmarks' timing wall with its plates. The
machine lamps on the column are the page's: green while a run passes, red on a fault.

Robots: livraison (the workbench at the column's foot, machine), listes (hoppers,
lifting), donnees-qualite (test bench, scanning), benchmarks (timing wall, pinning).

Run: blender -b -P equipe/blender/base_venus.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "venus"

g.preparer_scene(BASE)
g.camera(cible=(0.0, 0.0, 3.0), distance=46, elevation=28, azimut=35, focale=85)
# a diffuse yellow sky, the sun a wide soft disc barely stronger than the fill
g.eclairage(soleil_azimut=120, soleil_elevation=35, soleil_force=1.6, ciel=(0.90, 0.78, 0.50), ciel_force=1.1)
bpy.data.lights["Soleil"].angle = math.radians(12)
# the cloud sea below: the Venus texture as a plane far down, haze above it
sol = g.sol("venus_atmosphere", taille=240, couleur=(0.85, 0.72, 0.45, 1.0), echelle_texture=3)
sol.location.z = -16
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -6))
brume = bpy.context.active_object
brume.name = "Brume"
brume.scale = (120, 120, 10)
mb = bpy.data.materials.new("Brume")
mb.use_nodes = True
nt = mb.node_tree
nt.nodes.remove(nt.nodes["Principled BSDF"])
vol = nt.nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Density"].default_value = 0.02
vol.inputs["Color"].default_value = (0.92, 0.82, 0.55, 1.0)
nt.links.new(vol.outputs["Volume"], nt.nodes["Material Output"].inputs["Volume"])
brume.data.materials.append(mb)
# the cloud deck above: a dark lid out of focus, its underside lit by the plant's lamps
g.module("Plafond", (0, 0, 22), dimensions=(160, 160, 2), clair=False, biseau=0.0)

# the buoyant ring and the platform hanging from it
bpy.ops.mesh.primitive_torus_add(major_radius=16, minor_radius=1.6, location=(0, 2, 14))
anneau = bpy.context.active_object
anneau.name = "Anneau"
g._appliquer(anneau, g.materiau("Anneau", g.HULL_CLAIR, 0.55))
plate = g.module("Plateforme", (0, 0, -0.6), dimensions=(30, 20, 0.6), clair=False, biseau=0.15)
for i, (x, y) in enumerate(((-13, -8), (13, -8), (-13, 8), (13, 8))):
    g.mat(f"Cable.{i}", (x, y, 0), hauteur=13.5, rayon=0.05)

# the column: three stacked process modules, narrower as they rise, the machine lamps on each
col_a = g.module("Colonne.entree", (-3, 3, 0), dimensions=(7, 6, 3.4), clair=True)
col_b = g.module("Colonne.criblage", (-3, 3, 3.4), dimensions=(5.6, 4.8, 3.2), clair=False)
col_c = g.module("Colonne.rapport", (-3, 3, 6.6), dimensions=(4.4, 3.8, 3.0), clair=True)
g.cylindre("Colonne.cheminee", (-1.5, 4.5, 9.6), rayon=0.5, hauteur=3.0, clair=False)
lampes_machine = []
for i, (z, nom) in enumerate(((2.4, "ENTREE"), (5.8, "CRIBLAGE"), (9.0, "RAPPORT"))):
    yf = 3 - (6, 4.8, 3.8)[i] / 2 - 0.02
    g.plaque(f"Colonne.plaque.{i}", (-3, yf, z), 0, 2.0, 0.35, nom)
    lampes_machine.append(g.lampe(f"Colonne.lampe.{i}", (-1.2 + i * 0.0, yf, z + 0.5), g.VERT, 0.1, 2.0))
    g.fenetre(f"Colonne.fenetre.{i}", (-4.4, yf, z - 0.4), 0, 1.0, 0.5)
g.convoyeur("Tapis.colonne", [(-12, -6, 0), (-7, -1.5, 0), (-3, -0.6, 0)], hauteur=0.5)
etabli = g.banc("Etabli", (-3, -1.6, 0), 0, largeur=2.8, profondeur=1.0)
g.moniteur("Etabli.ecran", (-3.8, -1.3, 1.4), 0)
g.pratique("Etabli.lampe", (-3, -1.9, 2.5), puissance=45)
# the lever the robot pulls (machine task) and the delivered shelf with seal plates
g.mat("Etabli.levier", (-1.9, -1.4, 0.95), hauteur=0.6, rayon=0.03)
livre = g.etagere("Livre", (2.5, -1.0, 0), rotation_z=90, largeur=3.0, hauteur=2.0, niveaux=3)
sceaux = [g.plaque(f"Sceau.{i}", (2.26, -1.9 + i * 0.9, 0.9 + (i % 2) * 0.65), 90, 0.5, 0.3, "") for i in range(3)]
g.plaque("Livre.plaque", (2.26, -1.0, 2.35), 90, 1.6, 0.35, "LIVRE")

# the engine room behind the column: hoppers, the test bench, the timing wall
salle = g.module("Machines", (9, 4, 0), dimensions=(12, 8, 3.6), clair=False)
g.plaque("Machines.plaque", (9, -0.02, 3.9), 0, 2.4, 0.4, "MOTEUR")
g.fenetre("Machines.fenetre.0", (5.5, -0.02, 2.2), 0, 1.4, 0.7)
g.fenetre("Machines.fenetre.1", (12.5, -0.02, 2.2), 0, 1.4, 0.7)
tremies = []
for i, nom in enumerate(("OFAC", "ONU", "UE", "UK")):
    x = 4.5 + i * 1.6
    bpy.ops.mesh.primitive_cone_add(radius1=0.65, radius2=0.2, depth=1.2, location=(x, -1.2, 1.8))
    t = bpy.context.active_object
    t.name = f"Tremie.{nom}"
    t.rotation_euler = (math.radians(180), 0, 0)
    g._appliquer(t, g.materiau(f"Tremie.{nom}", g.HULL_CLAIR, 0.55))
    g.mat(f"Tremie.{nom}.pied", (x, -1.2, 0), hauteur=1.2, rayon=0.05)
    tremies.append(g.plaque(f"Tremie.{nom}.plaque", (x, -1.9, 0.6), 0, 0.9, 0.25, nom))
    g.lampe(f"Tremie.{nom}.lampe", (x + 0.4, -1.85, 2.5), g.VERT, 0.07, 1.5)
banc_test = g.banc("Test", (11.5, -2.4, 0), 0, largeur=2.4)
g.moniteur("Test.ecran", (12.3, -2.1, 1.4), 0)
g.caisse("Test.reference", (10.8, -2.3, 0.92), None, 0.4)
g.pratique("Test.lampe", (11.5, -2.6, 2.3), puissance=35)
chronos = [g.plaque(f"Chrono.{i}", (14.98, 2.5 - i * 1.1, 1.3 + (i % 2) * 0.6), 90, 0.9, 0.3, "") for i in range(4)]
g.plaque("Chrono.plaque", (14.98, 1.0, 2.6), 90, 1.6, 0.35, "TEMPS")
# the red pallet and the amber shelf by the belt
bpy.ops.mesh.primitive_cube_add(size=1, location=(-8, -3.5, 0.1))
palette = bpy.context.active_object
palette.name = "Palette"
palette.scale = (1.4, 1.0, 0.1)
g._appliquer(palette, g.materiau("Palette", g.ROUGE, 0.7))
g.balise("Attente.balise", (-10, 0, 0), hauteur=3.2)
g.caisse("Caisse.1", (-9.5, -4.0, 0.58))
stations = [col_a, col_b, col_c, etabli, *sceaux, salle, *tremies, banc_test, *chronos]

livraison = g.robot("livraison", "livraison", "Delivery", g.eparpiller((-3, -3.0, 0), 0.3), yaw=180)
listes = g.robot("listes", "listes", "Data", g.eparpiller((6.9, -3.2, 0), 0.3), yaw=180)
qualite_d = g.robot("donnees-qualite", "donnees-qualite", "Data", g.eparpiller((11.5, -3.8, 0), 0.3), yaw=180)
benchmarks = g.robot("benchmarks", "benchmarks", "Data", g.eparpiller((13.8, 1.0, 0), 0.3), yaw=270)
robots = [livraison, listes, qualite_d, benchmarks]

taches = {"livraison": "machine", "listes": "lifting", "donnees-qualite": "scanning", "benchmarks": "pinning"}
voisins = {"livraison": -50, "listes": -40, "donnees-qualite": 45, "benchmarks": 50}
chemins = {
    "listes->livraison": [(6.9, -3.2, 0), (2, -4.2, 0), (-2.2, -3.0, 0)],
    "livraison->Livre": [(-3, -3.0, 0), (0, -3.2, 0), (1.6, -1.6, 0)],
    "donnees-qualite->benchmarks": [(11.5, -3.8, 0), (13.5, -2.0, 0), (13.8, 0.2, 0)],
}
extra = {"lampes_machine": [l.name for l in lampes_machine], "sceaux": [s.name for s in sceaux],
         "chronos": [c.name for c in chronos], "brume": "Brume"}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", listes, livraison), ("passation", qualite_d, benchmarks)], extra=extra)
