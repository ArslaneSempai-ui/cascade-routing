"""
Uranus, Marketing: the studio and the broadcast towers (equipe/MARKETING.md, "In the
tycoon view").

Pale cyan haze, a flat ice plain, the planet's thin rings as a faint tilted line across
the sky (Uranus rolls on its side). A low studio module with a glass front onto the ice,
and beside it two lattice broadcast towers: the tall one with a red lamp that is on only
while a piece is `publie` less than a day old, the short one carrying the dish of the
site (SEO). Stations: the plan wall (mkt-stratege) with three goal plates; the writing
room (mkt-redacteur) with the voice guide pinned; the easels behind the glass
(mkt-designer-visuels), three per look-dev; the site bench (mkt-seo); the measuring desk
(mkt-analyste) with its wall of small cards; the reading corner (mkt-veille); the
partners' board (mkt-partenariats). The belt runs idee to brief to writing to the tower's
amber shelf (the yes) and up the mast when published.

Robots: mkt-stratege (plan wall, pinning), mkt-redacteur (typing), mkt-designer-visuels
(easels, scanning), mkt-seo (site bench, typing), mkt-analyste (measuring desk, reading),
mkt-veille (reading corner, watching), mkt-partenariats (board, pinning).

Run: blender -b -P equipe/blender/base_uranus.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "uranus"
DEPT = "Marketing"

g.preparer_scene(BASE)
g.camera(cible=(1.0, 0.0, 1.5), distance=48, elevation=30, azimut=35, focale=85)
g.eclairage(soleil_azimut=115, soleil_elevation=13, soleil_force=2.6, ciel=(0.62, 0.82, 0.86), ciel_force=0.9)
g.sol("uranus", taille=160, couleur=(0.70, 0.84, 0.86, 1.0), echelle_texture=2)
# the rings as a thin tilted band high in the sky
bpy.ops.mesh.primitive_plane_add(size=1, location=(40, 120, 60))
anneau = bpy.context.active_object
anneau.name = "Anneaux"
anneau.scale = (220, 2.5, 1)
anneau.rotation_euler = (math.radians(80), math.radians(8), 0)
g._appliquer(anneau, g.materiau("Anneaux", (0.85, 0.90, 0.92, 1.0), 0.9))

# the studio: a long low module, a glass front onto the ice (one wide window), the plate
studio = g.module("Studio", (-4, 4, 0), dimensions=(18, 8, 3.4), clair=True)
g.fenetre("Studio.vitrine", (-4, -0.02, 1.6), 0, 14, 2.4)
g.plaque("Studio.plaque", (-4, -0.03, 3.6), 0, 2.6, 0.4, "STUDIO")
# inside, seen through the glass: the easels (three), the writing room's desk, the plan wall plates
chevalets = []
for i in range(3):
    x = -9.5 + i * 1.6
    c = g.mat(f"Chevalet.{i}", (x, 1.4, 0), hauteur=1.8, rayon=0.04)
    p = g.plaque(f"Chevalet.{i}.toile", (x, 1.2, 1.4), 0, 1.0, 0.75, "")
    p.rotation_euler = (math.radians(75), 0, 0)
    chevalets.append(p)
g.pratique("Chevalets.lampe", (-7.9, 1.0, 2.8), puissance=35)
ecriture = g.banc("Ecriture", (-3, 1.2, 0), 0, largeur=2.0)
g.moniteur("Ecriture.ecran", (-3, 1.5, 1.4), 0)
g.plaque("Ecriture.voix", (-3, 7.95, 2.2), 0, 1.4, 0.9, "VOIX")
g.pratique("Ecriture.lampe", (-3, 0.9, 2.5), puissance=35)
plan = [g.plaque(f"Plan.{i}", (1.5 + i * 1.3, 7.95, 2.0), 0, 1.1, 0.5, "") for i in range(3)]
g.plaque("Plan.plaque", (2.8, 7.95, 2.7), 0, 2.0, 0.35, "PLAN")
g.pratique("Plan.lampe", (2.8, 6.5, 2.9), puissance=30)

# outside, the measuring desk with its wall of cards, the partners' board, the reading corner
mesure = g.banc("Mesure", (8, -3, 0), 0, largeur=2.2)
g.moniteur("Mesure.ecran", (8, -2.7, 1.4), 0)
mur_cartes = g.module("Mesure.mur", (8, -1.2, 0), dimensions=(4.0, 0.3, 2.6), clair=False)
cartes = [g.plaque(f"Carte.{i}", (6.6 + (i % 5) * 0.7, -1.36, 1.0 + (i // 5) * 0.55), 0, 0.5, 0.35, "") for i in range(10)]
g.pratique("Mesure.lampe", (8, -3.3, 2.4), puissance=35)
board = g.module("Partenaires", (14, 2, 0), dimensions=(0.3, 4.0, 2.6), clair=False)
epingles = [g.plaque(f"Partenaire.{i}", (13.83, 0.6 + (i % 3) * 1.2, 1.0 + (i // 3) * 0.8), 90, 0.9, 0.5, "") for i in range(6)]
g.plaque("Partenaires.plaque", (13.83, 2, 2.9), 90, 2.0, 0.35, "PARTENAIRES")
coin = g.module("Lecture", (-14, -4, 0), dimensions=(3, 3, 2.2), clair=False)
g.fenetre("Lecture.fenetre", (-14, -5.52, 1.4), 0, 1.4, 0.6)
g.plaque("Lecture.plaque", (-14, -5.53, 2.5), 0, 1.8, 0.35, "VEILLE")
g.pratique("Lecture.lampe", (-14, -6.5, 2.2), puissance=25)
# the site bench under the short tower's dish
site = g.banc("Site", (3, -7, 0), 0, largeur=2.0)
g.moniteur("Site.ecran", (3, -6.7, 1.4), 0)
g.etagere("Site.pile", (4.6, -7.4, 0), rotation_z=90, largeur=1.0, hauteur=1.2, niveaux=3)
g.pratique("Site.lampe", (3, -7.3, 2.3), puissance=30)

# the two towers: lattices as four thin masts with cross plates; the red lamp; the dish
def tour(nom, centre, hauteur, demi=0.9):
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        g.mat(f"{nom}.pied.{i}", (centre[0] + sx * demi, centre[1] + sy * demi, 0), hauteur=hauteur, rayon=0.06)
    for k in range(int(hauteur // 2.5)):
        z = 1.2 + k * 2.5
        for i, a in enumerate((0, 90, 180, 270)):
            r = math.radians(a)
            g.plaque(f"{nom}.croix.{k}.{i}", (centre[0] + demi * math.cos(r), centre[1] + demi * math.sin(r), z), a + 90, demi * 2, 0.08, "")
    bpy.ops.mesh.primitive_cube_add(location=(centre[0], centre[1], hauteur + 0.1))
    tete = bpy.context.active_object
    tete.name = f"{nom}.tete"
    tete.scale = (demi + 0.1, demi + 0.1, 0.1)
    g._appliquer(tete, g.materiau(f"{nom}.tete", g.HULL_SOMBRE, 0.6))
    return tete

tour_haute = tour("Tour.emission", (11, 7, 0), 14.0)
lampe_rouge = g.lampe("Tour.emission.lampe", (11, 7, 14.5), g.ROUGE, 0.16, 0.0)   # on while a piece is publie < 1 day
tour_basse = tour("Tour.site", (6, -10, 0), 6.0, 0.6)
bpy.ops.mesh.primitive_cone_add(radius1=1.2, radius2=0.2, depth=0.5, location=(6, -10, 6.6))
dish = bpy.context.active_object
dish.name = "Tour.site.parabole"
dish.rotation_euler = (math.radians(-55), 0, math.radians(20))
g._appliquer(dish, g.materiau("Tour.site.parabole", g.HULL_CLAIR, 0.55))
# the amber shelf at the tall tower's base and the belt from the studio to it, then up the mast (a vertical rail)
g.etagere("Attente", (11, 4.2, 0), rotation_z=0, largeur=2.0, hauteur=1.6, niveaux=2)
g.balise("Attente.balise", (12.6, 4.4, 0), hauteur=3.2)
g.caisse("Caisse.attente", (11, 4.0, 0.7), g.AMBRE, 0.6)
g.convoyeur("Tapis", [(-9.5, -0.5, 0), (-3, -0.5, 0), (2.8, -0.5, 0), (8, 1.0, 0), (11, 3.5, 0)], hauteur=0.5)
g.convoyeur("Tapis.mesure", [(11, 3.5, 0), (10, -1.0, 0), (9.2, -3.0, 0)], largeur=0.6, hauteur=0.4)
g.mat("Tour.emission.rail", (10.0, 6.0, 0), hauteur=13.5, rayon=0.05)
g.caisse("Caisse.1", (-6, -0.5, 0.58))
g.caisse("Caisse.2", (5, 0.2, 0.58))
stations = [studio, *chevalets, ecriture, *plan, mesure, *cartes, board, *epingles, coin, site, tour_haute, tour_basse]

stratege = g.robot("mkt-stratege", "mkt-stratege", DEPT, g.eparpiller((2.8, 5.6, 0), 0.3), yaw=0)
redacteur = g.robot("mkt-redacteur", "mkt-redacteur", DEPT, g.eparpiller((-3, 0.0, 0), 0.3), yaw=180)
designer = g.robot("mkt-designer-visuels", "mkt-designer-visuels", DEPT, g.eparpiller((-7.9, -0.2, 0), 0.3), yaw=180)
seo = g.robot("mkt-seo", "mkt-seo", DEPT, g.eparpiller((3, -8.3, 0), 0.3), yaw=180)
analyste = g.robot("mkt-analyste", "mkt-analyste", DEPT, g.eparpiller((8, -4.3, 0), 0.3), yaw=180)
veille = g.robot("mkt-veille", "mkt-veille", DEPT, g.eparpiller((-14, -7.6, 0), 0.3), yaw=180)
partenariats = g.robot("mkt-partenariats", "mkt-partenariats", DEPT, g.eparpiller((12.6, 2, 0), 0.3), yaw=90)
robots = [stratege, redacteur, designer, seo, analyste, veille, partenariats]

taches = {"mkt-stratege": "pinning", "mkt-redacteur": "typing", "mkt-designer-visuels": "scanning", "mkt-seo": "typing",
          "mkt-analyste": "reading", "mkt-veille": "watching", "mkt-partenariats": "pinning"}
voisins = {"mkt-stratege": 40, "mkt-redacteur": 45, "mkt-designer-visuels": -45, "mkt-seo": 40,
           "mkt-analyste": -35, "mkt-veille": -60, "mkt-partenariats": 50}
chemins = {
    "mkt-stratege->mkt-redacteur": [(2.8, 5.6, 0), (0, 3.0, 0), (-2.2, 0.0, 0)],
    "mkt-redacteur->Attente": [(-3, 0.0, 0), (4, -1.2, 0), (10, 3.2, 0)],
    "mkt-analyste->mkt-stratege": [(8, -4.3, 0), (6, 1.0, 0), (3.6, 5.6, 0)],
    "mkt-veille->mkt-stratege": [(-14, -7.6, 0), (-6, -3.0, 0), (2.0, 5.6, 0)],
}
extra = {"lampe_publie": "Tour.emission.lampe", "cartes": [c.name for c in cartes], "plan": [p.name for p in plan],
         "chevalets": [c.name for c in chevalets], "epingles": [e.name for e in epingles]}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", stratege, redacteur), ("passation", redacteur, analyste), ("chef", stratege, seo)], extra=extra)
