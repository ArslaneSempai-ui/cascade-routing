"""
The DEV station: the shipyard bay in orbit (equipe/DEV.md, "The tycoon version").

Indoors this once: a long bay under a glazed roof with the Earth turning slowly below
(a real textured sphere seen through the glass floor strip and the roof), hull panels in
the two warm greys with the slate-blue DEV band. Along the bay: the drafting table
(dev-architecte) with the plan pinned as plates; the two work bays (dev-developpeur,
dev-testeur) side by side, each a bench with a monitor, a flat plate GREEN or RED above
the testeur's bench; the review desk (dev-relecteur) on a mezzanine looking down; the
design studio (dev-designer) behind glass with three easels; the documentation alcove
(dev-documentaliste) with binders; the airlock (dev-integrateur) at the end with its
plate "OUI" and the amber beacon; the radio corner (dev-veille). Subtools are built as
ships: a hull cradle in the middle of the bay holds the project in progress, the page
sets how many panels are on it from the slices done.

Robots: the eight dev-* agents.

Run: blender -b -P equipe/blender/base_station_dev.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "station_dev"
DEPT = "DEV"

g.preparer_scene(BASE)
g.camera(cible=(2.0, 0.0, 2.0), distance=48, elevation=30, azimut=35, focale=85)
# the sun through the glazed roof, a cool fill from the Earth below
g.eclairage(soleil_azimut=120, soleil_elevation=40, soleil_force=3.0, ciel=(0.30, 0.45, 0.70), ciel_force=0.5)
sol = g.sol("earth_daymap", taille=400, couleur=(0.20, 0.35, 0.60, 1.0), echelle_texture=1)
sol.location.z = -60   # a stand-in for the Earth below when the sphere is out of frame
bpy.ops.mesh.primitive_uv_sphere_add(radius=120, location=(10, -40, -150), segments=96, ring_count=48)
terre = bpy.context.active_object
terre.name = "Terre"
mt = g.materiau("Terre", (0.20, 0.35, 0.60, 1.0), 0.8)
chemin_terre = os.path.join(g.TEXTURES, "2k_earth_daymap.jpg")
if os.path.exists(chemin_terre):
    tex = mt.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(chemin_terre)
    mt.node_tree.links.new(tex.outputs["Color"], mt.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
g._appliquer(terre, mt)

# the bay: a floor with a glass strip, two long walls, columns, the glazed roof as thin frames
g.module("Baie.sol", (2, 0, -0.5), dimensions=(44, 20, 0.5), clair=False)
g.moniteur("Baie.sol.vitre", (2, -6, 0.01), 0, 40, 2.0, allume=False)
bpy.context.active_object.rotation_euler = (0, 0, 0)
g.module("Baie.fond", (2, 10.3, 0), dimensions=(44, 0.6, 9), clair=True)
g.module("Baie.gauche", (-20.3, 0, 0), dimensions=(0.6, 20, 9), clair=False)
for i in range(6):
    x = -17 + i * 7.6
    g.cylindre(f"Colonne.{i}", (x, -9.5, 0), rayon=0.3, hauteur=9, clair=True)
    g.module(f"Poutre.{i}", (x, 0, 8.9), dimensions=(0.3, 20, 0.3), clair=False)
bande = g.module("Baie.bande", (2, 10.0, 6.0), dimensions=(44, 0.05, 0.5), clair=True)
g._appliquer(bande, g.materiau("Baie.bande", g.BANDES["DEV"], 0.6))

# the hull cradle in the middle: the subtool under construction as a ship on two cradles
for s in (-1, 1):
    g.module(f"Berceau.{s}", (2 + s * 4, -3, 0), dimensions=(1.0, 4.5, 1.2), clair=False)
coque = g.cylindre("Coque", (2, -3, 1.2), rayon=1.8, hauteur=10, clair=True, sommets=48)
coque.rotation_euler = (0, math.radians(90), 0)
coque.location.z = 2.8
panneaux = []
for i in range(6):
    p = g.plaque(f"Coque.panneau.{i}", (-2.5 + i * 1.8, -4.9, 2.8), 0, 1.6, 1.4, "")
    p["genre"] = "panneau"
    panneaux.append(p)
g.plaque("Coque.plaque", (2, -5.0, 4.6), 0, 2.4, 0.4, "PROJET")
g.pratique("Coque.lampe", (2, -5.5, 5.5), puissance=60, rayon=0.5)

# the stations along the back wall, left to right
table_plan = g.banc("Plan", (-16, 6, 0), 0, largeur=2.6, profondeur=1.2)
plan = [g.plaque(f"Plan.{i}", (-17.5 + i * 1.3, 9.98, 2.2 + (i % 2) * 0.6, ), 0, 1.0, 0.5, "") for i in range(4)]
g.plaque("Plan.plaque", (-16, 9.98, 3.6), 0, 2.0, 0.35, "PLAN")
g.pratique("Plan.lampe", (-16, 5.6, 2.6), puissance=35)
dev_banc = g.banc("Dev", (-9, 6, 0), 0, largeur=2.2)
g.moniteur("Dev.ecran", (-9, 6.3, 1.4), 0)
g.pratique("Dev.lampe", (-9, 5.6, 2.4), puissance=35)
test_banc = g.banc("Test", (-5.5, 6, 0), 0, largeur=2.2)
g.moniteur("Test.ecran", (-5.5, 6.3, 1.4), 0)
suite = g.plaque("Test.suite", (-5.5, 9.98, 3.2), 0, 1.6, 0.6, "SUITE")   # the page prints GREEN or RED
suite_lampe = g.lampe("Test.suite.lampe", (-4.4, 9.95, 3.6), g.VERT, 0.12, 2.0)
g.pratique("Test.lampe", (-5.5, 5.6, 2.4), puissance=35)
# the mezzanine with the review desk
g.module("Mezzanine", (1, 7.5, 3.6), dimensions=(7, 5, 0.3), clair=True)
g.module("Mezzanine.garde", (1, 5.1, 3.9), dimensions=(7, 0.1, 1.0), clair=False)
g.mat("Mezzanine.pied.0", (-2.4, 5.2, 0), hauteur=3.6, rayon=0.1)
g.mat("Mezzanine.pied.1", (4.4, 5.2, 0), hauteur=3.6, rayon=0.1)
relecture = g.banc("Relecture", (1, 7.0, 3.9), 0, largeur=2.0)
g.moniteur("Relecture.ecran", (1, 7.3, 5.3), 0)
g.pratique("Relecture.lampe", (1, 6.6, 6.2), puissance=35)
# the design studio behind glass, three easels
studio = g.module("Studio", (9, 7, 0), dimensions=(6, 6, 3.4), clair=False)
g.fenetre("Studio.vitrine", (9, 3.98, 1.6), 0, 5.0, 2.4)
g.plaque("Studio.plaque", (9, 3.97, 3.6), 0, 1.8, 0.35, "STUDIO")
chevalets = []
for i in range(3):
    x = 7.4 + i * 1.6
    g.mat(f"Chevalet.{i}", (x, 5.6, 0), hauteur=1.8, rayon=0.04)
    p = g.plaque(f"Chevalet.{i}.toile", (x, 5.4, 1.4), 0, 1.0, 0.75, "")
    p.rotation_euler = (math.radians(75), 0, 0)
    chevalets.append(p)
g.pratique("Studio.lampe", (9, 5.0, 2.8), puissance=35)
# the documentation alcove
alcove = g.module("Documentation", (15, 7, 0), dimensions=(4, 6, 3.0), clair=True)
g.etagere("Documentation.classeurs", (15, 9.5, 0), rotation_z=0, largeur=3.2, hauteur=2.4, niveaux=4)
g.plaque("Documentation.plaque", (15, 3.98, 3.2), 0, 2.4, 0.35, "DOCUMENTATION")
doc_banc = g.banc("Documentation.banc", (15, 5.0, 0), 0, largeur=1.8)
g.pratique("Documentation.lampe", (15, 4.6, 2.3), puissance=30)
# the airlock at the end of the bay
sas = g.module("Sas", (22, 0, 0), dimensions=(3, 8, 6), clair=False)
g.plaque("Sas.porte", (20.48, 0, 2.2), 90, 3.0, 4.0, "")
plaque_oui = g.plaque("Sas.plaque", (20.47, 0, 4.8), 90, 2.0, 0.5, "OUI")
g.balise("Sas.balise", (20.2, 5.0, 0), hauteur=4.0)
g.etagere("Sas.attente", (19.0, -5.0, 0), rotation_z=90, largeur=2.0, hauteur=1.6, niveaux=2)
g.caisse("Caisse.attente", (19.0, -5.2, 0.7), g.AMBRE, 0.6)
g.lampe("Sas.lampe", (20.45, 3.2, 5.2), g.VERT, 0.12, 2.0)
# the radio corner by the airlock
radio = g.banc("Radio", (17, -7.5, 0), 0, largeur=1.6)
g.moniteur("Radio.ecran", (17, -7.2, 1.4), 0)
g.mat("Radio.antenne", (18, -8.2, 0.9), hauteur=2.5, rayon=0.03)
g.pratique("Radio.lampe", (17, -7.9, 2.2), puissance=25)
# the board belt: the length of the bay, past every station, to the airlock
g.convoyeur("Tapis", [(-16, 3.5, 0), (-9, 3.5, 0), (-5.5, 3.5, 0), (1, 3.5, 0), (9, 2.5, 0), (15, 2.5, 0), (20, 0.5, 0)], hauteur=0.5)
g.caisse("Caisse.1", (-12, 3.5, 0.58))
g.caisse("Caisse.2", (-3, 3.5, 0.58), g.ROUGE)
g.caisse("Caisse.3", (12, 2.5, 0.58))
bpy.ops.mesh.primitive_cube_add(size=1, location=(-3, 1.2, 0.1))
palette = bpy.context.active_object
palette.name = "Palette"
palette.scale = (1.4, 1.0, 0.1)
g._appliquer(palette, g.materiau("Palette", g.ROUGE, 0.7))
stations = [table_plan, *plan, dev_banc, test_banc, suite, relecture, studio, *chevalets, alcove, doc_banc, sas, plaque_oui, radio, coque, *panneaux]

architecte = g.robot("dev-architecte", "dev-architecte", DEPT, g.eparpiller((-16, 4.7, 0), 0.3), yaw=0)
developpeur = g.robot("dev-developpeur", "dev-developpeur", DEPT, g.eparpiller((-9, 4.8, 0), 0.3), yaw=0)
testeur = g.robot("dev-testeur", "dev-testeur", DEPT, g.eparpiller((-5.5, 4.8, 0), 0.3), yaw=0)
relecteur = g.robot("dev-relecteur", "dev-relecteur", DEPT, g.eparpiller((1, 5.8, 3.9), 0.25), yaw=0)
designer = g.robot("dev-designer", "dev-designer", DEPT, g.eparpiller((9, 6.6, 0), 0.3), yaw=180)
documentaliste = g.robot("dev-documentaliste", "dev-documentaliste", DEPT, g.eparpiller((15, 6.2, 0), 0.3), yaw=0)
integrateur = g.robot("dev-integrateur", "dev-integrateur", DEPT, g.eparpiller((18.6, 0, 0), 0.3), yaw=90)
veille = g.robot("dev-veille", "dev-veille", DEPT, g.eparpiller((17, -8.8, 0), 0.3), yaw=180)
robots = [architecte, developpeur, testeur, relecteur, designer, documentaliste, integrateur, veille]

taches = {"dev-architecte": "clipboard", "dev-developpeur": "typing", "dev-testeur": "typing", "dev-relecteur": "reading",
          "dev-designer": "scanning", "dev-documentaliste": "reading", "dev-integrateur": "machine", "dev-veille": "watching"}
voisins = {"dev-architecte": -45, "dev-developpeur": -40, "dev-testeur": 40, "dev-relecteur": -30,
           "dev-designer": 45, "dev-documentaliste": 50, "dev-integrateur": -60, "dev-veille": -50}
chemins = {
    "dev-architecte->dev-developpeur": [(-16, 4.7, 0), (-12.5, 4.2, 0), (-10, 4.8, 0)],
    "dev-developpeur->dev-testeur": [(-9, 4.8, 0), (-7.2, 4.4, 0), (-6.3, 4.8, 0)],
    "dev-testeur->dev-relecteur": [(-5.5, 4.8, 0), (-2.4, 4.0, 0), (-2.4, 5.5, 3.9), (0, 5.8, 3.9)],
    "dev-relecteur->dev-integrateur": [(1, 5.8, 3.9), (4.4, 5.5, 3.9), (4.4, 2.0, 0), (17.8, 0, 0)],
    "dev-developpeur->Coque": [(-9, 4.8, 0), (-4, 0, 0), (0, -5.6, 0)],
    "dev-integrateur->Sas": [(18.6, 0, 0), (19.6, 0, 0), (20.4, 0, 0)],
}
extra = {"panneaux": [p.name for p in panneaux], "suite_lampe": "Test.suite.lampe", "plan": [p.name for p in plan],
         "chevalets": [c.name for c in chevalets], "terre": "Terre"}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", developpeur, testeur), ("passation", testeur, relecteur), ("chef", architecte, developpeur),
                    ("passation", relecteur, integrateur)], extra=extra)
