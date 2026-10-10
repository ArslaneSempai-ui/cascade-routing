"""
The general view: the solar system from above (equipe/TYCOON.md, "The general view";
equipe/TYCOON-PAGE.md).

Opened by a click on the giant Crusetra in the hub. A flat, slightly tilted view of the
whole system: the Sun at the left third (its size and warmth are the quota, the page
swaps among the five Sun variants), the orbits as faint matte rings on a near-black
plane, each planet at its real texture but at a readable size, each base as a small lit
cluster on its planet's lit side whose glow the page scales by activity. The DEV station
is a small lit module on Earth's orbit, a quarter turn ahead. Cargo ships are the
demandes in transit: the page places one per `fil` handoff of the last hour on the
straight line between the two bodies; this script renders the ship as a sprite (a small
hull with a crate), four headings. Comets are events (PLANETES.md). The KPI bar and the
pinned escalations are the page's text, placed above and below the plate.

Renders: `rendu/general/base.png` (the plate), `rendu/general/nuit.png` (the night plate,
only the Sun and the bases' windows lit), `rendu/general/soleil/<niveau>.png` for the five
quota levels (the Sun alone on a transparent film), `rendu/general/cargo/<cap>.png` for
the four headings, `rendu/general/positions.json` with every body's screen position and
radius, the orbits as screen ellipses, and the Sun's box.

Run: blender -b -P equipe/blender/vue_generale.py -- [--apercu]
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base_commune as g  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

BASE = "general"

# bodies: name, orbit radius (scene units), angle (degrees, the page keeps these fixed),
# drawn radius, texture file stem, department, base colour when no texture
CORPS = [
    ("mercure", 9.0, 200, 0.55, "mercury", "Finance", (0.50, 0.48, 0.45, 1.0)),
    ("venus", 13.0, 320, 0.95, "venus_atmosphere", "Delivery", (0.85, 0.72, 0.45, 1.0)),
    ("terre", 17.5, 30, 1.0, "earth_daymap", "Direction", (0.20, 0.35, 0.60, 1.0)),
    ("lune", 17.5, 30, 0.28, "moon", "Planning", (0.45, 0.45, 0.43, 1.0)),        # placed beside the Earth below
    ("mars", 22.0, 110, 0.7, "mars", "Infrastructure", (0.55, 0.28, 0.16, 1.0)),
    ("jupiter", 29.0, 250, 2.6, "jupiter", "Clients", (0.70, 0.55, 0.40, 1.0)),
    ("saturne", 36.0, 350, 2.2, "saturn", "Commercial", (0.78, 0.70, 0.52, 1.0)),
    ("uranus", 42.0, 150, 1.5, "uranus", "Marketing", (0.70, 0.84, 0.86, 1.0)),
    ("neptune", 47.5, 60, 1.45, "neptune", "Growth", (0.15, 0.25, 0.55, 1.0)),
    ("pluton", 52.5, 285, 0.4, "pluto", "Compliance", (0.62, 0.52, 0.42, 1.0)),
]
STATION = ("station_dev", 17.5, 30 + 90, 0.35, None, "DEV", (0.70, 0.70, 0.68, 1.0))

g.preparer_scene(BASE)
# the camera high above, tilted 22 degrees from the vertical so the orbits read as ellipses
g.camera(cible=(6.0, 0.0, 0.0), distance=150, elevation=68, azimut=0, focale=50)
bpy.context.scene.camera.data.dof.use_dof = False
g.eclairage(soleil_azimut=0, soleil_elevation=90, soleil_force=0.6, ciel=(0.01, 0.01, 0.02), ciel_force=0.3)
bpy.data.objects["Soleil"].hide_render = True   # the Sun object below is the light

# the plane of the system: near black, matte, the orbits as thin rings laid on it
plan = g.sol("none", taille=260, couleur=(0.02, 0.02, 0.025, 1.0))
plan.name = "Plan"
for nom, r, *_ in CORPS:
    if nom == "lune":
        continue
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.05, location=(0, 0, 0.02), major_segments=256)
    o = bpy.context.active_object
    o.name = f"Orbite.{nom}"
    g._appliquer(o, g.materiau(f"Orbite.{nom}", (0.16, 0.16, 0.17, 1.0), 0.9))

# the Sun: an emissive sphere plus a point light; the five quota levels scale both
bpy.ops.mesh.primitive_uv_sphere_add(radius=3.6, location=(0, 0, 0), segments=64, ring_count=32)
soleil = bpy.context.active_object
soleil.name = "Soleil.corps"
mat_soleil = g.materiau("Soleil", (1.0, 0.85, 0.55, 1.0), 0.9, emission=(1.0, 0.80, 0.45, 1.0), force=6.0)
g._appliquer(soleil, mat_soleil)
lumiere = g.pratique("Soleil.lumiere", (0, 0, 0.5), couleur=(1.0, 0.88, 0.70), puissance=30000, rayon=3.0)
NIVEAUX = {"plein": (6.0, 1.0, (1.0, 0.80, 0.45, 1.0)), "trois_quarts": (4.5, 0.85, (1.0, 0.76, 0.40, 1.0)),
           "moitie": (3.0, 0.7, (1.0, 0.68, 0.32, 1.0)), "quart": (1.8, 0.55, (0.95, 0.55, 0.20, 1.0)),
           "vide": (0.8, 0.4, (0.80, 0.35, 0.10, 1.0))}


def texture_sur(mat, stem):
    if stem is None:
        return
    chemin = os.path.join(g.TEXTURES, f"2k_{stem}.jpg")
    if os.path.exists(chemin):
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(chemin)
        mat.node_tree.links.new(tex.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])


corps_objets = {}
for nom, r, a, rayon, stem, dept, couleur in CORPS + [STATION]:
    x, y = r * math.cos(math.radians(a)), r * math.sin(math.radians(a))
    if nom == "lune":
        x, y = x + 1.6, y - 1.2
    if nom == "station_dev":
        o = g.module("Corps.station_dev", (x, y, 0), dimensions=(0.9, 0.5, 0.4), clair=True)
    else:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=rayon, location=(x, y, rayon), segments=48, ring_count=24)
        o = bpy.context.active_object
        o.name = f"Corps.{nom}"
        m = g.materiau(f"Corps.{nom}", couleur, 0.85)
        texture_sur(m, stem)
        g._appliquer(o, m)
    o["departement"] = dept
    corps_objets[nom] = o
    # the base: a small lit cluster on the planet's lit side (toward the Sun), tinted by department
    vers_soleil = -Vector((x, y, 0)).normalized()
    bx, by = x + vers_soleil.x * rayon * 0.9, y + vers_soleil.y * rayon * 0.9
    teinte = g.BANDES.get(dept, g.HULL_CLAIR)
    base_l = g.lampe(f"Base.{nom}", (bx, by, rayon * 0.6 + 0.1), teinte, max(0.08, rayon * 0.12), 3.0)
    base_l["genre"] = "base"
# Saturn's rings: a flat disc with the ring texture when present
sat = corps_objets["saturne"]
bpy.ops.mesh.primitive_cylinder_add(radius=4.6, depth=0.02, location=sat.location)
anneaux = bpy.context.active_object
anneaux.name = "Anneaux.saturne"
anneaux.rotation_euler = (math.radians(12), 0, math.radians(20))
ma = g.materiau("Anneaux.saturne", (0.72, 0.66, 0.55, 1.0), 0.8)
chemin_anneau = os.path.join(g.TEXTURES, "2k_saturn_ring_alpha.png")
if os.path.exists(chemin_anneau):
    tex = ma.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(chemin_anneau)
    ma.node_tree.links.new(tex.outputs["Color"], ma.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    ma.node_tree.links.new(tex.outputs["Alpha"], ma.node_tree.nodes["Principled BSDF"].inputs["Alpha"])
g._appliquer(anneaux, ma)

# the cargo ship sprite: a small hull with a crate on its back, rendered alone at four headings
def cargo(cap: float):
    bpy.ops.object.empty_add(location=(0, 0, 60))   # far above the plane, never in the plate
    root = bpy.context.active_object
    root.name = "Cargo"
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=1.6, location=(0, 0, 60.3))
    coque = bpy.context.active_object
    coque.name = "Cargo.coque"
    coque.rotation_euler = (0, math.radians(90), 0)
    g._appliquer(coque, g.materiau("Cargo.coque", g.HULL_CLAIR, 0.55))
    coque.parent = root
    c = g.caisse("Cargo.caisse", (0, 0, 60.5), None, 0.45)
    c.parent = root
    l = g.lampe("Cargo.feu", (-0.85, 0, 60.4), g.AMBRE, 0.06, 2.0)
    l.parent = root
    root.rotation_euler = (0, 0, math.radians(cap))
    return root


def _rendre(chemin, animation=False):
    sc = bpy.context.scene
    sc.render.filepath = chemin
    bpy.ops.render.render(animation=animation, write_still=not animation)


sc = bpy.context.scene
sc.render.film_transparent = False
sc.render.image_settings.color_mode = "RGB"
_rendre(os.path.join(g.RACINE, BASE, "base.png"))

# positions: bodies as circles, the Sun's box, the orbits as sampled screen polylines
from bpy_extras.object_utils import world_to_camera_view as w2c  # noqa: E402
cam = sc.camera
W, H = g.RESOLUTION
def ecran(p):
    v = w2c(sc, cam, Vector(p))
    return {"x": round(v.x * W), "y": round((1 - v.y) * H)}
data = {"base": BASE, "resolution": g.RESOLUTION, "corps": [], "orbites": {}, "soleil": None}
for nom, o in corps_objets.items():
    c = o.matrix_world.translation
    r = o.dimensions.x / 2
    bord = ecran((c.x + r, c.y, c.z))
    centre = ecran(c)
    data["corps"].append({"nom": nom, "departement": o.get("departement"), **centre,
                          "rayon": abs(bord["x"] - centre["x"]), "base": ecran(bpy.data.objects[f"Base.{nom}"].matrix_world.translation)})
for nom, r, *_ in CORPS:
    if nom != "lune":
        data["orbites"][nom] = [ecran((r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), 0)) for a in range(0, 360, 10)]
centre_s = ecran((0, 0, 0)); bord_s = ecran((3.6, 0, 0))
data["soleil"] = {**centre_s, "rayon": abs(bord_s["x"] - centre_s["x"])}
os.makedirs(os.path.join(g.RACINE, BASE), exist_ok=True)
with open(os.path.join(g.RACINE, BASE, "positions.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

# night: the orbits fade, the planets' dark sides, only the Sun and the bases' lamps lit
g.nuit()
_rendre(os.path.join(g.RACINE, BASE, "nuit.png"))
for m in bpy.data.materials:
    e = g._emission(m)
    if e is not None and e.default_value > 0 and "fenetre" not in m.name:
        e.default_value /= 0.15
lumiere.data.energy = 30000

# the Sun alone at five levels, transparent film
autres = [o for o in sc.objects if o.type == "MESH" and o not in (soleil,)]
for o in autres:
    o.hide_render = True
sc.render.film_transparent = True
sc.render.image_settings.color_mode = "RGBA"
e = g._emission(mat_soleil)
for niveau, (force, echelle, couleur) in NIVEAUX.items():
    e.default_value = force
    mat_soleil.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = couleur
    soleil.scale = (echelle, echelle, echelle)
    lumiere.data.energy = 30000 * (force / 6.0)
    _rendre(os.path.join(g.RACINE, BASE, "soleil", f"{niveau}.png"))
soleil.scale = (1, 1, 1)
e.default_value = 6.0
soleil.hide_render = True

# the cargo ship at four headings, alone
for cap in (0, 90, 180, 270):
    root = cargo(cap)
    _rendre(os.path.join(g.RACINE, BASE, "cargo", f"{cap:03d}.png"))
    for c in list(root.children_recursive) + [root]:
        bpy.data.objects.remove(c, do_unlink=True)

with open(os.path.join(g.RACINE, BASE, "poids.json"), "w", encoding="utf-8") as f:
    json.dump({"base": BASE, "plates": 2, "soleil": len(NIVEAUX), "cargo": 4,
               "poids_estime_mo_1x": round((2 * 900 + 5 * 60 + 4 * 12) / 1024, 1)}, f, indent=2)
