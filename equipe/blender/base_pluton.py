"""
Pluto, Compliance: the customs watchtower (equipe/TYCOON.md, "Pluto").

The far edge: a dim sun no bigger than a star, the sky almost black with the thin red
rim the page shows when a rule is unread, nitrogen ice in pale tan and the dark heart of
the plain. Three modules under a watchtower: veille-reglementaire's reading room (the
tower top, a glazed cabin that looks back toward the Sun, four publisher lamps OFAC, UN,
EU, UK), contrats' archive (a long low module with the seal press and the binders), and
donnees-perso's checkpoint on the batch belt: a gate every batch crosses before it leaves
for Saturn, with the stamp bench and the suppression-list shelf. Charon hangs huge and
still in the sky.

Robots: veille-reglementaire (cabin, watching), contrats (archive, stamping), donnees-perso
(checkpoint, scanning).

Run: blender -b -P equipe/blender/base_pluton.py -- [--apercu] [--robot <name>] [--sans-boucles]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402

BASE = "pluton"
DEPT = "Compliance"

g.preparer_scene(BASE)
g.camera(cible=(0.0, 0.0, 2.0), distance=44, elevation=30, azimut=35, focale=85)
g.eclairage(soleil_azimut=140, soleil_elevation=10, soleil_force=1.8, ciel=(0.04, 0.04, 0.06), ciel_force=0.3)
bpy.data.lights["Soleil"].angle = math.radians(0.1)
g.sol("pluto", taille=160, couleur=(0.62, 0.52, 0.42, 1.0), echelle_texture=3)
# Charon, large and grey, low in the sky
bpy.ops.mesh.primitive_uv_sphere_add(radius=22, location=(60, 200, 40), segments=64, ring_count=32)
charon = bpy.context.active_object
charon.name = "Charon"
g._appliquer(charon, g.materiau("Charon", (0.45, 0.43, 0.42, 1.0), 0.9))
# the red rim: a thin emissive arc at the horizon the page fades in when a rule is unread
bpy.ops.mesh.primitive_torus_add(major_radius=140, minor_radius=0.6, location=(0, 0, -2))
rim = bpy.context.active_object
rim.name = "Lisere"
g._appliquer(rim, g.materiau("Lisere", g.ROUGE, 0.6, emission=g.ROUGE, force=0.0))

# the watchtower: a drum base, a shaft, the glazed cabin on top, the four publisher lamps
g.cylindre("Tour.base", (-2, 5, 0), rayon=3.0, hauteur=2.0, clair=False, sommets=48)
g.cylindre("Tour.fut", (-2, 5, 2.0), rayon=1.4, hauteur=7.0, clair=True, sommets=48)
cabine = g.module("Tour.cabine", (-2, 5, 9.0), dimensions=(4.4, 4.4, 2.6), clair=False)
for i, a in enumerate((0, 90, 180, 270)):
    r = math.radians(a)
    g.fenetre(f"Tour.cabine.vitre.{i}", (-2 + 2.21 * math.sin(r), 5 - 2.21 * math.cos(r), 10.3), a, 3.6, 1.4)
g.module("Tour.toit", (-2, 5, 11.6), dimensions=(5.0, 5.0, 0.25), clair=True)
lampes = []
for i, nom in enumerate(("OFAC", "ONU", "UE", "UK")):
    x = -3.5 + i * 1.0
    g.mat(f"Tour.{nom}.mat", (x, 5, 11.85), hauteur=1.0 + (i % 2) * 0.4, rayon=0.03)
    lampes.append(g.lampe(f"Tour.{nom}.lampe", (x, 5, 12.95 + (i % 2) * 0.4), g.VERT, 0.08, 1.8))
g.plaque("Tour.plaque", (-2, 1.98, 1.4), 0, 2.4, 0.4, "VEILLE")
pupitre = g.banc("Tour.pupitre", (-2, 3.4, 9.0), 0, largeur=1.6, profondeur=0.6)
g.moniteur("Tour.ecran", (-2, 3.7, 10.0), 0)
g.pratique("Tour.lampe", (-2, 4.5, 11.2), puissance=35)

# the archive: a long low module, the seal press on a bench, binders, the contracts plate
archive = g.module("Archive", (8, 4, 0), dimensions=(9, 5, 2.6), clair=True)
g.fenetre("Archive.fenetre.0", (5.5, 1.48, 1.5), 0, 1.4, 0.6)
g.fenetre("Archive.fenetre.1", (10.5, 1.48, 1.5), 0, 1.4, 0.6)
g.plaque("Archive.plaque", (8, 1.47, 2.85), 0, 2.4, 0.4, "CONTRATS")
presse = g.banc("Archive.presse", (8, 0.0, 0), 0, largeur=1.8)
g.cylindre("Archive.presse.cylindre", (8.4, 0.0, 0.9), rayon=0.14, hauteur=0.6, clair=False)
g.etagere("Archive.classeurs", (12.9, 4, 0), rotation_z=90, largeur=4.0, hauteur=2.2, niveaux=4)
g.pratique("Archive.lampe", (8, -0.3, 2.2), puissance=35)
g.caisse("Archive.dossier", (7.4, -0.05, 0.92), None, 0.35)

# the checkpoint on the batch belt: the gate, the stamp bench, the suppression-list shelf, the pad to Saturn
g.convoyeur("Tapis", [(-14, -6, 0), (-6, -7.5, 0), (2, -8, 0), (10, -8, 0), (17, -11, 0)], hauteur=0.5)
g.mat("Porte.g", (2, -6.8, 0), hauteur=2.8, rayon=0.12)
g.mat("Porte.d", (2, -9.2, 0), hauteur=2.8, rayon=0.12)
bpy.ops.mesh.primitive_cube_add(location=(2, -8, 2.85))
linteau = bpy.context.active_object
linteau.name = "Porte.linteau"
linteau.scale = (0.12, 1.3, 0.12)
g._appliquer(linteau, g.materiau("Porte.linteau", g.HULL_SOMBRE, 0.6, metallic=0.2))
porte_lampe = g.lampe("Porte.lampe", (2, -8, 3.15), g.VERT, 0.14, 2.5)
plaque_porte = g.plaque("Porte.plaque", (2, -6.6, 3.4), 90, 1.6, 0.3, "DONNEES")
tampon = g.banc("Porte.banc", (2, -10.4, 0), 0, largeur=1.8)
g.pratique("Porte.lampe.b", (2, -10.6, 2.3), puissance=35)
g.etagere("Suppression", (-1.5, -10.8, 0), rotation_z=0, largeur=1.8, hauteur=1.4, niveaux=2)
g.plaque("Suppression.plaque", (-1.5, -11.02, 1.7), 0, 1.6, 0.3, "LISTE ROUGE")
bpy.ops.mesh.primitive_cube_add(size=1, location=(5.5, -10.6, 0.1))
palette = bpy.context.active_object
palette.name = "Palette"
palette.scale = (1.4, 1.0, 0.1)
g._appliquer(palette, g.materiau("Palette", g.ROUGE, 0.7))
g.cylindre("Pad", (18, -12, 0), rayon=1.6, hauteur=0.25, clair=False)
g.plaque("Pad.plaque", (18, -13.8, 0.6), 0, 1.6, 0.4, "SATURNE")
g.balise("Porte.balise", (-4, -9.5, 0), hauteur=3.0)
g.caisse("Caisse.1", (-9, -7.0, 0.58))
g.caisse("Caisse.2", (6, -8, 0.58), g.AMBRE)
stations = [cabine, pupitre, archive, presse, porte_lampe, plaque_porte, tampon]

veille_r = g.robot("veille-reglementaire", "veille-reglementaire", DEPT, g.eparpiller((-2, 2.4, 9.0), 0.25), yaw=180)
contrats = g.robot("contrats", "contrats", DEPT, g.eparpiller((8, -1.3, 0), 0.3), yaw=180)
donnees = g.robot("donnees-perso", "donnees-perso", DEPT, g.eparpiller((2, -11.7, 0), 0.3), yaw=180)
robots = [veille_r, contrats, donnees]

taches = {"veille-reglementaire": "watching", "contrats": "stamping", "donnees-perso": "scanning"}
voisins = {"veille-reglementaire": 45, "contrats": -50, "donnees-perso": 55}
chemins = {
    "contrats->donnees-perso": [(8, -1.3, 0), (5, -5, 0), (3, -11.7, 0)],
    "Tour->contrats": [(-2, 1.9, 0), (3, -0.5, 0), (7, -1.3, 0)],
    "Porte->Pad": [(2, -8, 0), (10, -8, 0), (17, -11, 0)],
}
extra = {"lampes_publieurs": [l.name for l in lampes], "lisere": "Lisere", "porte_lampe": "Porte.lampe", "charon": "Charon"}

g.rendre_base(BASE, robots, stations, taches, chemins=chemins, voisins=voisins,
              duos=[("passation", contrats, donnees)], extra=extra)
