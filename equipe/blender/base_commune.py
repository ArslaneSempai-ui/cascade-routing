"""
Common grammar of every tycoon base (equipe/TYCOON.md, equipe/TYCOON-PAGE.md), for
Blender 5 with Cycles.

Each base script imports this module, places its stations and robots, and calls
`rendre_base(...)`, which renders:
  - `rendu/<base>/base.png`: the still of the base without robots (the page's background);
  - `rendu/<base>/nuit.png`: the same still with the practicals off and the sky at night
    (the page shows it from 23:00 to 8:00, FEATURES.md, day and night);
  - `rendu/<base>/<robot>/<action>/0001..00NN.png`: one short loop per robot and action,
    on a transparent film with the ground as a shadow catcher, so the page layers the
    robot over the base at its anchor (frame counts in `ACTIONS` below);
  - `rendu/<base>/<robot>/attention/0001..0005.png`: five head-turn frames toward the
    viewer, for hover;
  - `rendu/<base>/positions.json`: the screen position and size of every robot and station
    in the still, for the page's click zones and labels, plus the walking paths;
  - `rendu/<base>/poids.json`: the frame count and the estimated weight of the base's loops.

Rules carried by the code, not by memory: matte materials (roughness never under 0.42, no
metal above 0.2 except the small monitor glass), one sun, one sky fill, practicals at
2700 K, a long lens at 30 degrees, robots scattered by a seeded jitter so no two stand in
a row, words only as flat plates (the page prints the text), real planet textures when the
file exists under images/textures/2k_<planet>.jpg (Solar System Scope).

The robots are alive (TYCOON.md, "Robots alive"): one robot per agent, the same Crusetra
family, told apart by one small matte accessory for the role (`ACCESSOIRES`), a name plate
at its feet, and the department's tint on the antenna ball. Life is a set of short
pre-rendered loops the page chains with randomness (`ACTIONS`): idle variants, the
station's working action, walking with a crate, reactions (turn, cheer, slump, sign),
and attention frames. The eye blink is an emission dip on the eye material, never a mesh
change. A base-wide `RYTHME` (0.5 to 1.5) slows or speeds every loop, read by the page
from the quota; the renders carry the speed in their frame count only.

The robot comes from Arslane's helper `robot3d.make_robot(scale, location, head_pitch,
head_yaw, arms)` (white glossy head, black visor, mint eyes and antenna ball, round body
with a C, pill arms with mint tips, faces -Y, head radius 1). The rig here needs: the
root object, a child whose name contains "head" (yaw and pitch), two children whose names
contain "arm" (swing), a material whose name contains "eye" (blink), a child whose name
contains "antenna" (tint). Anything missing is skipped, and the loop still renders on the
root alone. When the helper is missing (a test render elsewhere), a capsule with a head,
two arms, eyes and an antenna stands in so the script runs end to end.

Not run in the session that wrote it (no Blender there): the first run on the Mac is the
test. Start with `blender -b -P equipe/blender/base_terre.py -- --apercu` which renders at
quarter size with 32 samples and short loops.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

import bpy
from mathutils import Vector

try:
    from bpy_extras.object_utils import world_to_camera_view
except Exception:  # pragma: no cover
    world_to_camera_view = None

try:
    import robot3d  # Arslane's helper on the Mac
except Exception:  # pragma: no cover
    robot3d = None

# ---------------------------------------------------------------- parameters

APERCU = "--apercu" in sys.argv          # quarter size, 32 samples, loops cut to 6 frames
SEULEMENT = None                         # --robot <name>: render that robot's loops only
if "--robot" in sys.argv:
    SEULEMENT = sys.argv[sys.argv.index("--robot") + 1]
SANS_BOUCLES = "--sans-boucles" in sys.argv   # the two stills and the JSON only
RACINE = os.environ.get("TYCOON_RENDU", os.path.join(os.getcwd(), "rendu"))
TEXTURES = os.environ.get("TYCOON_TEXTURES", os.path.join(os.getcwd(), "images", "textures"))
RESOLUTION = (480, 270) if APERCU else (1920, 1080)
ECHANTILLONS = 32 if APERCU else 256
FPS = 8

# values of the two hull greys, decking, crates, bands per department (linear RGB)
HULL_CLAIR = (0.62, 0.60, 0.56, 1.0)
HULL_SOMBRE = (0.20, 0.19, 0.18, 1.0)
DECK = (0.05, 0.05, 0.05, 1.0)
CONTREPLAQUE = (0.52, 0.38, 0.22, 1.0)
PLAQUE = (0.12, 0.12, 0.11, 1.0)
BANDES = {
    "Direction": (0.22, 0.30, 0.42, 1.0), "Commercial": (0.70, 0.48, 0.12, 1.0),
    "Delivery": (0.26, 0.40, 0.22, 1.0), "Finance": (0.40, 0.10, 0.12, 1.0),
    "Infrastructure": (0.55, 0.26, 0.12, 1.0), "Marketing": (0.16, 0.42, 0.44, 1.0),
    "DEV": (0.22, 0.30, 0.42, 1.0), "Compliance": (0.36, 0.30, 0.18, 1.0),
    "Clients": (0.70, 0.48, 0.12, 1.0), "Planning": (0.30, 0.30, 0.34, 1.0),
    "Data": (0.26, 0.40, 0.22, 1.0), "Budget": (0.80, 0.62, 0.20, 1.0),
}
ROUGE = (0.80, 0.08, 0.05, 1.0)
AMBRE = (0.95, 0.55, 0.08, 1.0)
VERT = (0.12, 0.70, 0.25, 1.0)
MENTHE = (0.45, 0.85, 0.70, 1.0)

# the loops: name -> (frames at full size, what it is for). The page chains them
# (TYCOON-PAGE.md). Frames are cut to 6 in --apercu.
ACTIONS = {
    "idle_regard": (24, "looks around, one blink"),
    "idle_balance": (16, "weight shift with a body sway"),
    "idle_voisin": (20, "glances at the neighbour, back to front"),
    "idle_etire": (20, "a stretch: arms up, head back, down again"),
    "working": (16, "the station's task, see TACHES"),
    "marche": (24, "walks one body length carrying a crate, loops in place"),
    "reagit_tourne": (12, "turns toward an arriving crate or comet"),
    "reagit_joie": (16, "a small cheer on Arslane's yes: arms up twice"),
    "bloque": (24, "slumped under the red lamp, a slow blink"),
    "attend": (16, "holds the amber sign, upright, a slow breath"),
    "clic": (8, "looks up toward the viewer when clicked"),
    "range": (20, "tidies: picks a small thing, sets it down"),
    "recharge": (12, "docked at night: head down, antenna dim, a slow breath"),
    "reveil": (16, "wakes at 8:00: head up, antenna lights, one shake"),
}
ATTENTION = 5     # head-turn frames toward the viewer, for hover

# the task played in `working`, per station family
TACHES = {
    "typing": "hands over a keyboard, head nods between two screens",
    "reading": "head down, one page turn every half loop",
    "stamping": "right arm down on the crate, body dip",
    "clipboard": "left arm holds, right arm ticks",
    "lifting": "bends, lifts, turns a quarter",
    "sorting": "arms alternate left and right over a belt",
    "machine": "pulls a lever, watches a lamp",
    "welding": "crouched, arm forward, a flicker on the visor",
    "scanning": "sweeps an arm slowly across a surface",
    "dialing": "turns a dial with one arm, reads",
    "counting": "slides pieces from right to left on a window",
    "pinning": "reaches up to a wall, presses",
    "wheel": "both arms on a wheel, slow quarter turns",
    "watching": "still, head sweeps the horizon",
    "talking": "small head nods, one arm open then closed",
}

# the small matte accessory for each role (one per robot, parented to head or hand)
ACCESSOIRES = {
    "chef-orchestre": "clipboard", "qualite": "stamp", "methode": "notebook",
    "budget": "spyglass", "prospection": "megaphone", "boite": "satchel",
    "redaction": "pen", "livraison": "toolbelt", "controles": "headlamp",
    "veille": "binoculars", "tresorier": "ledger", "comptable": "visor_cap",
    "recouvrement": "bell", "onboarding": "headset", "compte": "keyring",
    "support": "headset", "veille-reglementaire": "magnifier", "contrats": "seal_ring",
    "donnees-perso": "magnifier", "listes": "funnel", "donnees-qualite": "gauge",
    "benchmarks": "stopwatch", "mkt-stratege": "whiteboard_pen", "mkt-redacteur": "pen",
    "mkt-seo": "antenna_dish", "mkt-designer-visuels": "camera", "mkt-analyste": "ruler",
    "mkt-veille": "binoculars", "mkt-partenariats": "badge", "dev-architecte": "tsquare",
    "dev-developpeur": "hard_hat", "dev-testeur": "gauge", "dev-relecteur": "magnifier",
    "dev-designer": "camera", "dev-documentaliste": "notebook", "dev-integrateur": "key",
    "dev-veille": "binoculars",
}

RYTHME = 1.0      # base-wide speed; the page sets it live, renders use 1.0

rng = random.Random(7)


def frames(action: str) -> int:
    n = ACTIONS[action][0]
    return min(6, n) if APERCU else n

# ---------------------------------------------------------------- scene

def preparer_scene(nom: str, transparent: bool = False) -> bpy.types.Scene:
    """A clean scene, Cycles, AgX, the resolution and samples of the mode."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = nom
    sc.render.engine = "CYCLES"
    sc.cycles.samples = ECHANTILLONS
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = RESOLUTION
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    sc.render.image_settings.color_depth = "16" if transparent else "8"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast"
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, 24
    return sc


def materiau(nom: str, couleur, roughness: float = 0.55, metallic: float = 0.0,
             emission=None, force: float = 0.0) -> bpy.types.Material:
    """A Principled material under the house rules: roughness floored at 0.42, no chrome."""
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = couleur
    bsdf.inputs["Roughness"].default_value = max(0.42, roughness)
    bsdf.inputs["Metallic"].default_value = min(0.2, metallic)
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = force
    return m


def _appliquer(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def _emission(mat):
    """The emission strength socket of a material, or None."""
    try:
        return mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
    except Exception:
        return None


def camera(cible=(0.0, 0.0, 0.0), distance: float = 42.0, elevation: float = 30.0,
           azimut: float = 35.0, focale: float = 85.0, mise_au_point: float | None = None):
    """The long lens at 30 degrees, looking at `cible`, tilt-shift depth of field."""
    e, a = math.radians(elevation), math.radians(azimut)
    pos = Vector(cible) + Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))) * distance
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = focale
    cam_data.sensor_width = 36
    cam_data.dof.use_dof = True
    cam_data.dof.focus_distance = mise_au_point or distance
    cam_data.dof.aperture_fstop = 2.8
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = pos
    direction = Vector(cible) - pos
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def eclairage(soleil_azimut: float = 120.0, soleil_elevation: float = 16.0, soleil_force: float = 4.0,
              ciel=(0.55, 0.65, 0.85), ciel_force: float = 0.6):
    """One sun, low, from the hub's direction; one sky fill of the planet's colour."""
    sun_data = bpy.data.lights.new("Soleil", "SUN")
    sun_data.energy = soleil_force
    sun_data.angle = math.radians(1.2)
    sun = bpy.data.objects.new("Soleil", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(90 - soleil_elevation), 0, math.radians(soleil_azimut))
    world = bpy.data.worlds.new("Monde")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*ciel, 1.0)
    bg.inputs["Strength"].default_value = ciel_force
    return sun


def nuit():
    """Night for the second still: the sun almost off, the sky dark blue, every practical
    at a tenth, every lamp dim. Called by `rendre_base` after the day still."""
    sc = bpy.context.scene
    for o in sc.objects:
        if o.type == "LIGHT":
            if o.data.type == "SUN":
                o.data.energy *= 0.03
                o.data.color = (0.6, 0.7, 1.0)
            else:
                o.data.energy *= 0.1
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.03, 0.04, 0.08, 1.0)
    bg.inputs["Strength"].default_value = 0.4
    for m in bpy.data.materials:
        e = _emission(m)
        if e is not None and e.default_value > 0 and "fenetre" not in m.name:
            e.default_value *= 0.15


def pratique(nom: str, location, couleur=(1.0, 0.72, 0.45), puissance: float = 60.0, rayon: float = 0.3):
    """A practical light at 2700 K, never stronger than the sun; a lamp has a visible source."""
    data = bpy.data.lights.new(nom, "POINT")
    data.energy = puissance
    data.color = couleur
    data.shadow_soft_size = rayon
    o = bpy.data.objects.new(nom, data)
    bpy.context.collection.objects.link(o)
    o.location = location
    return o


def sol(planete: str, taille: float = 120.0, couleur=(0.30, 0.28, 0.25, 1.0), echelle_texture: float = 6.0):
    """The ground: the planet's real texture when the file exists, a matte colour otherwise;
    a shadow catcher during the robot loops."""
    bpy.ops.mesh.primitive_plane_add(size=taille, location=(0, 0, 0))
    plan = bpy.context.active_object
    plan.name = "Sol"
    chemin = os.path.join(TEXTURES, f"2k_{planete}.jpg")
    m = materiau("Sol", couleur, roughness=0.9)
    if os.path.exists(chemin):
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(chemin)
        tex.projection = "FLAT"
        m.node_tree.links.new(tex.outputs["Color"], m.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
        mapping = m.node_tree.nodes.new("ShaderNodeMapping")
        coords = m.node_tree.nodes.new("ShaderNodeTexCoord")
        mapping.inputs["Scale"].default_value = (echelle_texture, echelle_texture, 1)
        m.node_tree.links.new(coords.outputs["Object"], mapping.inputs["Vector"])
        m.node_tree.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    _appliquer(plan, m)
    return plan

# ---------------------------------------------------------------- props

def module(nom: str, location, dimensions=(6.0, 4.0, 3.0), clair: bool = True, biseau: float = 0.08, rotation_z: float = 0.0):
    """A pressurised module: a bevelled box in one of the two hull greys."""
    bpy.ops.mesh.primitive_cube_add(location=(location[0], location[1], location[2] + dimensions[2] / 2))
    o = bpy.context.active_object
    o.name = nom
    o.scale = (dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2)
    o.rotation_euler = (0, 0, math.radians(rotation_z))
    mod = o.modifiers.new("Biseau", "BEVEL")
    mod.width = biseau
    mod.segments = 3
    _appliquer(o, materiau(f"{nom}.coque", HULL_CLAIR if clair else HULL_SOMBRE, 0.55))
    return o


def cylindre(nom: str, location, rayon: float = 2.0, hauteur: float = 3.0, clair: bool = True, sommets: int = 48):
    """A round module or a tank: a cylinder in a hull grey."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=sommets, radius=rayon, depth=hauteur,
                                        location=(location[0], location[1], location[2] + hauteur / 2))
    o = bpy.context.active_object
    o.name = nom
    _appliquer(o, materiau(f"{nom}.coque", HULL_CLAIR if clair else HULL_SOMBRE, 0.55))
    return o


def fenetre(nom: str, location, rotation_z: float = 0.0, largeur: float = 1.2, hauteur: float = 0.7, allumee: bool = True):
    """A window: a slightly emissive warm plane set into a module's face. Its material name
    carries 'fenetre' so `nuit()` keeps it lit (the base's windows are what glows at night)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    o = bpy.context.active_object
    o.name = nom
    o.scale = (largeur, hauteur, 1)
    o.rotation_euler = (math.radians(90), 0, math.radians(rotation_z))
    o["genre"] = "fenetre"
    _appliquer(o, materiau(f"{nom}.fenetre", (0.9, 0.75, 0.5, 1.0), 0.42,
                           emission=(1.0, 0.72, 0.45, 1.0), force=2.0 if allumee else 0.0))
    return o


def plaque(nom: str, location, rotation_z: float = 0.0, largeur: float = 1.6, hauteur: float = 0.5, texte: str = ""):
    """A flat printed plate; the page prints `texte` over it. Never extruded letters."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    o = bpy.context.active_object
    o.name = nom
    o.scale = (largeur, hauteur, 1)
    o.rotation_euler = (math.radians(90), 0, math.radians(rotation_z))
    o["texte"] = texte
    o["genre"] = "plaque"
    _appliquer(o, materiau(f"{nom}.plaque", PLAQUE, 0.7))
    return o


def caisse(nom: str, location, bande=None, taille: float = 0.8):
    """A crate: plywood, with a band for P1 (red) or attend_oui (amber)."""
    bpy.ops.mesh.primitive_cube_add(size=taille, location=(location[0], location[1], location[2] + taille / 2))
    o = bpy.context.active_object
    o.name = nom
    _appliquer(o, materiau(f"{nom}.bois", CONTREPLAQUE, 0.75))
    if bande is not None:
        bpy.ops.mesh.primitive_cube_add(size=taille * 1.02, location=o.location)
        b = bpy.context.active_object
        b.name = f"{nom}.bande"
        b.scale = (1, 1, 0.18)
        _appliquer(b, materiau(f"{nom}.bande", bande, 0.6))
        b.parent = o
        b.matrix_parent_inverse = o.matrix_world.inverted()
    return o


def convoyeur(nom: str, points, largeur: float = 1.0, hauteur: float = 0.5):
    """A belt along a polyline: dark canvas on a low frame, pale edge rails."""
    objs = []
    for i in range(len(points) - 1):
        a, b = Vector(points[i]), Vector(points[i + 1])
        d = b - a
        centre = (a + b) / 2
        bpy.ops.mesh.primitive_cube_add(location=(centre.x, centre.y, hauteur))
        seg = bpy.context.active_object
        seg.name = f"{nom}.{i}"
        seg.scale = (d.length / 2, largeur / 2, 0.08)
        seg.rotation_euler = (0, 0, math.atan2(d.y, d.x))
        _appliquer(seg, materiau(f"{nom}.{i}.toile", DECK, 0.85))
        for cote in (-1, 1):
            bpy.ops.mesh.primitive_cube_add(location=(centre.x, centre.y, hauteur + 0.06))
            rail = bpy.context.active_object
            rail.name = f"{nom}.{i}.rail{cote}"
            rail.scale = (d.length / 2, 0.04, 0.04)
            rail.rotation_euler = seg.rotation_euler
            rail.location += Vector((-math.sin(seg.rotation_euler.z), math.cos(seg.rotation_euler.z), 0)) * cote * (largeur / 2)
            _appliquer(rail, materiau(f"{nom}.{i}.rail{cote}", HULL_CLAIR, 0.5))
        objs.append(seg)
    return objs


def lampe(nom: str, location, couleur=VERT, rayon: float = 0.12, force: float = 3.0):
    """A small matte lamp housing with an emissive face: a practical the page can swap by state."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rayon, location=location)
    o = bpy.context.active_object
    o.name = nom
    o["genre"] = "lampe"
    _appliquer(o, materiau(f"{nom}.verre", couleur, 0.5, emission=couleur, force=force))
    return o


def mat(nom: str, location, hauteur: float = 4.0, rayon: float = 0.08):
    """A mast: for a beacon, an instrument, a dish."""
    bpy.ops.mesh.primitive_cylinder_add(radius=rayon, depth=hauteur, location=(location[0], location[1], location[2] + hauteur / 2))
    o = bpy.context.active_object
    o.name = nom
    _appliquer(o, materiau(f"{nom}.acier", HULL_SOMBRE, 0.6, metallic=0.2))
    return o


def balise(nom: str, location, hauteur: float = 3.5):
    """The amber beacon of a station: a mast with a lamp the page pulses when attend_oui."""
    m = mat(f"{nom}.mat", location, hauteur)
    l = lampe(f"{nom}.lampe", (location[0], location[1], location[2] + hauteur + 0.15), AMBRE, 0.16, 2.0)
    l.parent = m
    l.matrix_parent_inverse = m.matrix_world.inverted()
    return m


def moniteur(nom: str, location, rotation_z: float = 0.0, largeur: float = 0.7, hauteur: float = 0.45, allume: bool = True):
    """A station monitor: the only glass of the palette, roughness 0.42, a faint glow."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    o = bpy.context.active_object
    o.name = nom
    o.scale = (largeur, hauteur, 1)
    o.rotation_euler = (math.radians(80), 0, math.radians(rotation_z))
    _appliquer(o, materiau(f"{nom}.verre", (0.05, 0.08, 0.10, 1.0), 0.42, metallic=0.2,
                           emission=(0.55, 0.75, 0.85, 1.0), force=1.2 if allume else 0.0))
    return o


def banc(nom: str, location, rotation_z: float = 0.0, largeur: float = 1.8, profondeur: float = 0.8, hauteur: float = 0.9):
    """A workbench: a dark top on two light legs."""
    bpy.ops.mesh.primitive_cube_add(location=(location[0], location[1], location[2] + hauteur - 0.03))
    top = bpy.context.active_object
    top.name = nom
    top.scale = (largeur / 2, profondeur / 2, 0.03)
    top.rotation_euler = (0, 0, math.radians(rotation_z))
    _appliquer(top, materiau(f"{nom}.plateau", HULL_SOMBRE, 0.7))
    for s in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
        pied = bpy.context.active_object
        pied.name = f"{nom}.pied{s}"
        pied.scale = (0.04, profondeur / 2 - 0.05, (hauteur - 0.06) / 2)
        pied.parent = top
        pied.matrix_parent_inverse = top.matrix_world.inverted()
        pied.location = Vector(location) + Vector((s * (largeur / 2 - 0.1) * math.cos(math.radians(rotation_z)),
                                                    s * (largeur / 2 - 0.1) * math.sin(math.radians(rotation_z)),
                                                    (hauteur - 0.06) / 2))
        pied.rotation_euler = (0, 0, math.radians(rotation_z))
        _appliquer(pied, materiau(f"{nom}.pied{s}", HULL_CLAIR, 0.55))
    return top


def etagere(nom: str, location, rotation_z: float = 0.0, largeur: float = 2.4, hauteur: float = 2.2, niveaux: int = 4):
    """A shelf wall: light uprights, dark boards."""
    objs = []
    for i in range(niveaux):
        z = location[2] + 0.3 + i * (hauteur - 0.3) / max(1, niveaux - 1)
        bpy.ops.mesh.primitive_cube_add(location=(location[0], location[1], z))
        b = bpy.context.active_object
        b.name = f"{nom}.{i}"
        b.scale = (largeur / 2, 0.2, 0.02)
        b.rotation_euler = (0, 0, math.radians(rotation_z))
        _appliquer(b, materiau(f"{nom}.{i}", HULL_SOMBRE, 0.7))
        objs.append(b)
    return objs

# ---------------------------------------------------------------- robots

def eparpiller(centre, rayon: float = 1.2):
    """A seeded jitter around a station's anchor, so robots never stand in a row."""
    a = rng.uniform(0, 2 * math.pi)
    r = rayon * math.sqrt(rng.uniform(0.2, 1.0))
    return (centre[0] + r * math.cos(a), centre[1] + r * math.sin(a), centre[2])


def _enfant(o, mot: str, exclure=()):
    """The first descendant whose name contains `mot` (case-insensitive)."""
    pile = list(o.children)
    while pile:
        c = pile.pop(0)
        n = c.name.lower()
        if mot in n and c not in exclure:
            return c
        pile.extend(c.children)
    return None


def _materiau_contenant(o, mot: str):
    pile = [o] + list(o.children_recursive)
    for c in pile:
        if c.type != "MESH":
            continue
        for m in c.data.materials:
            if m is not None and mot in m.name.lower():
                return m
    return None


def _capsule(nom: str, location, echelle: float):
    """The stand-in robot when robot3d is absent: body, head, two arms, eyes, antenna."""
    bpy.ops.object.empty_add(location=location)
    root = bpy.context.active_object
    root.name = nom
    bpy.ops.mesh.primitive_uv_sphere_add(radius=echelle, location=(location[0], location[1], location[2] + echelle * 1.05))
    corps = bpy.context.active_object
    corps.name = f"{nom}.body"
    corps.scale = (1, 0.9, 1.1)
    _appliquer(corps, materiau(f"{nom}.corps", (0.85, 0.85, 0.83, 1.0), 0.45))
    corps.parent = root
    bpy.ops.mesh.primitive_uv_sphere_add(radius=echelle * 0.75, location=(location[0], location[1], location[2] + echelle * 2.6))
    tete = bpy.context.active_object
    tete.name = f"{nom}.head"
    _appliquer(tete, materiau(f"{nom}.tete", (0.92, 0.92, 0.90, 1.0), 0.42))
    tete.parent = root
    oeil_mat = materiau(f"{nom}.eye", MENTHE, 0.5, emission=MENTHE, force=2.0)
    for s in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=echelle * 0.1, location=(location[0] + s * echelle * 0.28, location[1] - echelle * 0.7, location[2] + echelle * 2.65))
        oe = bpy.context.active_object
        oe.name = f"{nom}.eye{s}"
        _appliquer(oe, oeil_mat)
        oe.parent = tete
        oe.matrix_parent_inverse = tete.matrix_world.inverted()
    for s, lab in ((-1, "arm_l"), (1, "arm_r")):
        bpy.ops.mesh.primitive_cylinder_add(radius=echelle * 0.12, depth=echelle * 1.1, location=(location[0] + s * echelle * 1.05, location[1], location[2] + echelle * 1.2))
        br = bpy.context.active_object
        br.name = f"{nom}.{lab}"
        _appliquer(br, materiau(f"{nom}.{lab}", (0.85, 0.85, 0.83, 1.0), 0.45))
        br.parent = root
    bpy.ops.mesh.primitive_uv_sphere_add(radius=echelle * 0.1, location=(location[0], location[1], location[2] + echelle * 3.55))
    ant = bpy.context.active_object
    ant.name = f"{nom}.antenna"
    _appliquer(ant, materiau(f"{nom}.antenne", MENTHE, 0.5, emission=MENTHE, force=1.5))
    ant.parent = tete
    ant.matrix_parent_inverse = tete.matrix_world.inverted()
    return root


def accessoire(robot_obj, genre: str, echelle: float):
    """The role's small matte prop: a flat or round primitive in the dark hull grey,
    parented to the head (hats, headsets, visors) or to the right arm (tools)."""
    tete = _enfant(robot_obj, "head")
    bras = _enfant(robot_obj, "arm_r") or _enfant(robot_obj, "arm")
    base = robot_obj.matrix_world.translation
    sur_tete = genre in ("headset", "hard_hat", "visor_cap", "headlamp", "antenna_dish", "badge")
    anchor = tete if (sur_tete and tete is not None) else (bras or robot_obj)
    z_tete = base.z + echelle * 3.0
    z_main = base.z + echelle * 0.8
    e = echelle
    if genre == "hard_hat":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=e * 0.82, location=(base.x, base.y, z_tete + e * 0.15))
        o = bpy.context.active_object
        o.scale = (1, 1, 0.55)
        couleur = (0.85, 0.65, 0.12, 1.0)
    elif genre in ("headset", "headlamp"):
        bpy.ops.mesh.primitive_torus_add(major_radius=e * 0.8, minor_radius=e * 0.06, location=(base.x, base.y, z_tete + e * 0.1))
        o = bpy.context.active_object
        o.rotation_euler = (0, math.radians(90), 0)
        couleur = HULL_SOMBRE
    elif genre == "visor_cap":
        bpy.ops.mesh.primitive_cylinder_add(radius=e * 0.9, depth=e * 0.05, location=(base.x, base.y - e * 0.3, z_tete + e * 0.2))
        o = bpy.context.active_object
        o.scale = (1, 1.2, 1)
        couleur = (0.18, 0.40, 0.25, 1.0)
    elif genre == "antenna_dish":
        bpy.ops.mesh.primitive_cone_add(radius1=e * 0.3, radius2=e * 0.05, depth=e * 0.2, location=(base.x + e * 0.6, base.y, z_tete + e * 0.5))
        o = bpy.context.active_object
        couleur = HULL_CLAIR
    elif genre == "badge":
        bpy.ops.mesh.primitive_cylinder_add(radius=e * 0.15, depth=e * 0.03, location=(base.x - e * 0.5, base.y - e * 0.9, base.z + e * 1.6))
        o = bpy.context.active_object
        o.rotation_euler = (math.radians(90), 0, 0)
        couleur = (0.80, 0.62, 0.20, 1.0)
    elif genre in ("clipboard", "notebook", "ledger", "whiteboard_pen", "tsquare", "ruler"):
        dims = {"clipboard": (0.5, 0.7, 0.03), "notebook": (0.4, 0.5, 0.06), "ledger": (0.55, 0.75, 0.1),
                "whiteboard_pen": (0.06, 0.06, 0.4), "tsquare": (0.8, 0.08, 0.03), "ruler": (0.7, 0.07, 0.02)}[genre]
        bpy.ops.mesh.primitive_cube_add(location=(base.x + e * 1.15, base.y - e * 0.35, z_main))
        o = bpy.context.active_object
        o.scale = (e * dims[0], e * dims[2], e * dims[1])
        couleur = CONTREPLAQUE if genre in ("clipboard", "notebook", "ledger") else HULL_SOMBRE
    elif genre in ("magnifier", "stopwatch", "gauge", "seal_ring", "keyring", "bell", "camera", "satchel", "key", "stamp", "pen", "megaphone", "binoculars", "spyglass", "funnel", "toolbelt"):
        if genre in ("magnifier", "seal_ring", "keyring"):
            bpy.ops.mesh.primitive_torus_add(major_radius=e * 0.22, minor_radius=e * 0.04, location=(base.x + e * 1.2, base.y - e * 0.4, z_main + e * 0.3))
        elif genre in ("stopwatch", "gauge", "bell"):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=e * 0.2, location=(base.x + e * 1.2, base.y - e * 0.4, z_main + e * 0.2))
        elif genre in ("camera", "satchel", "stamp"):
            bpy.ops.mesh.primitive_cube_add(location=(base.x + e * 1.2, base.y - e * 0.4, z_main + e * 0.2))
            bpy.context.active_object.scale = (e * 0.25, e * 0.18, e * 0.18)
        elif genre == "toolbelt":
            bpy.ops.mesh.primitive_torus_add(major_radius=e * 1.02, minor_radius=e * 0.07, location=(base.x, base.y, base.z + e * 0.9))
        elif genre == "funnel":
            bpy.ops.mesh.primitive_cone_add(radius1=e * 0.3, radius2=e * 0.06, depth=e * 0.4, location=(base.x + e * 1.2, base.y - e * 0.4, z_main + e * 0.3))
        else:  # pen, key, megaphone, binoculars, spyglass: a short cylinder in the hand
            bpy.ops.mesh.primitive_cylinder_add(radius=e * (0.12 if genre in ("megaphone", "spyglass") else 0.04), depth=e * 0.6,
                                                location=(base.x + e * 1.2, base.y - e * 0.5, z_main + e * 0.3))
            bpy.context.active_object.rotation_euler = (math.radians(90), 0, 0)
        o = bpy.context.active_object
        couleur = {"stamp": CONTREPLAQUE, "satchel": CONTREPLAQUE, "megaphone": (0.70, 0.48, 0.12, 1.0),
                   "bell": (0.80, 0.62, 0.20, 1.0), "key": (0.80, 0.62, 0.20, 1.0)}.get(genre, HULL_SOMBRE)
    else:
        return None
    o.name = f"{robot_obj.name}.accessoire"
    o["genre"] = "accessoire"
    o["accessoire"] = genre
    _appliquer(o, materiau(f"{robot_obj.name}.accessoire", couleur, 0.6))
    o.parent = anchor
    o.matrix_parent_inverse = anchor.matrix_world.inverted()
    return o


def robot(nom: str, role: str, departement: str, location, yaw: float = 0.0, echelle: float = 0.55, bras=(0.0, 0.0)):
    """One robot at its station: Arslane's helper when present, a capsule otherwise; the
    role's accessory, the name plate at its feet, the department's tint on the antenna ball
    and on the shoulder lamp."""
    if robot3d is not None:
        o = robot3d.make_robot(echelle, location, 0.0, math.radians(yaw), bras)
        if not isinstance(o, bpy.types.Object):
            o = bpy.context.active_object
    else:
        o = _capsule(nom, location, echelle)
    o.name = nom
    o.rotation_euler = (0, 0, math.radians(yaw))
    o["genre"] = "robot"
    o["role"] = role
    o["departement"] = departement
    o["echelle"] = echelle
    teinte = BANDES.get(departement, HULL_CLAIR)
    # the department's tint: the antenna ball (its own material so one robot's tint is its own)
    antenne = _enfant(o, "antenna")
    if antenne is not None and antenne.type == "MESH":
        _appliquer(antenne, materiau(f"{nom}.antenne", teinte, 0.5, emission=teinte, force=1.2))
    # the shoulder lamp the page swaps by state
    l = lampe(f"{nom}.epaule", (location[0] + 0.35 * echelle, location[1], location[2] + 2.1 * echelle), teinte, 0.07, 1.5)
    l.parent = o
    l.matrix_parent_inverse = o.matrix_world.inverted()
    # the name plate at the feet, printed by the page
    p = plaque(f"{nom}.nom", (location[0], location[1] - 1.3 * echelle, location[2] + 0.12), yaw, 1.0 * echelle, 0.22 * echelle, role)
    p.rotation_euler = (math.radians(70), 0, math.radians(yaw))
    p.parent = o
    p.matrix_parent_inverse = o.matrix_world.inverted()
    accessoire(o, ACCESSOIRES.get(role, "clipboard"), echelle)
    return o


class Rig:
    """The parts of a robot the actions move: root, head, two arms, eyes (material), antenna."""

    def __init__(self, o):
        self.root = o
        self.tete = _enfant(o, "head")
        self.bras_g = _enfant(o, "arm_l") or _enfant(o, "arm")
        self.bras_d = _enfant(o, "arm_r") or _enfant(o, "arm", exclure=(self.bras_g,) if self.bras_g else ())
        self.yeux = _materiau_contenant(o, "eye")
        self.antenne_mat = _materiau_contenant(o, "antenne")
        self.parts = [p for p in (o, self.tete, self.bras_g, self.bras_d) if p is not None]
        self.repos = {p.name: (p.location.copy(), p.rotation_euler.copy()) for p in self.parts}
        self.yeux_force = _emission(self.yeux).default_value if self.yeux and _emission(self.yeux) else None
        self.ant_force = _emission(self.antenne_mat).default_value if self.antenne_mat and _emission(self.antenne_mat) else None

    def reset(self):
        for p in self.parts:
            loc, rot = self.repos[p.name]
            p.location, p.rotation_euler = loc.copy(), rot.copy()
        p = self.root
        p.animation_data_clear()
        for q in self.parts:
            q.animation_data_clear()
        for m, f in ((self.yeux, self.yeux_force), (self.antenne_mat, self.ant_force)):
            if m is not None and f is not None:
                m.node_tree.animation_data_clear()
                _emission(m).default_value = f

    def pose(self, f: int, corps_dz: float = 0.0, corps_yaw: float = 0.0, corps_pitch: float = 0.0, corps_dx: float = 0.0,
             tete_yaw: float = 0.0, tete_pitch: float = 0.0, bras_g: float = 0.0, bras_d: float = 0.0,
             yeux: float = 1.0, antenne: float = 1.0):
        """One keyframe. Angles in degrees; `yeux` and `antenne` scale the emission."""
        loc0, rot0 = self.repos[self.root.name]
        yaw0 = rot0.z
        self.root.location = loc0 + Vector((corps_dx * math.cos(yaw0), corps_dx * math.sin(yaw0), corps_dz))
        self.root.rotation_euler = (rot0.x + math.radians(corps_pitch), rot0.y, yaw0 + math.radians(corps_yaw))
        self.root.keyframe_insert("location", frame=f)
        self.root.keyframe_insert("rotation_euler", frame=f)
        if self.tete is not None:
            l0, r0 = self.repos[self.tete.name]
            self.tete.rotation_euler = (r0.x + math.radians(tete_pitch), r0.y, r0.z + math.radians(tete_yaw))
            self.tete.keyframe_insert("rotation_euler", frame=f)
        for b, a in ((self.bras_g, bras_g), (self.bras_d, bras_d)):
            if b is not None:
                l0, r0 = self.repos[b.name]
                b.rotation_euler = (r0.x + math.radians(a), r0.y, r0.z)
                b.keyframe_insert("rotation_euler", frame=f)
        for m, f0, k in ((self.yeux, self.yeux_force, yeux), (self.antenne_mat, self.ant_force, antenne)):
            if m is not None and f0 is not None:
                s = _emission(m)
                s.default_value = f0 * k
                s.keyframe_insert("default_value", frame=f)


def _clignement(t: float, quand: float = 0.62, duree: float = 0.08) -> float:
    """Emission factor of the eyes: 1, dipping to 0.1 around `quand` for `duree` of the loop."""
    d = abs(t - quand)
    return 0.1 if d < duree / 2 else 1.0


def jouer(rig: Rig, action: str, tache: str = "typing", n: int | None = None, cible_yaw: float = 0.0):
    """Keyframes one loop of `action` on `rig`. Every loop starts and ends on the rest pose
    so the page can chain any two. `tache` names the working action; `cible_yaw` is the
    head's turn for `reagit_tourne` and `idle_voisin` (degrees, positive to the left)."""
    rig.reset()
    n = n or frames(action)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, n
    s2 = lambda t, k=1.0: math.sin(2 * math.pi * t * k)
    bump = lambda t, a, b: math.sin(math.pi * (t - a) / (b - a)) if a <= t <= b else 0.0
    for f in range(1, n + 1):
        t = (f - 1) / n
        p = dict(yeux=_clignement(t))
        if action == "idle_regard":
            p.update(corps_dz=0.012 * s2(t), tete_yaw=18 * bump(t, 0.15, 0.55) - 14 * bump(t, 0.6, 0.95), tete_pitch=-4 * bump(t, 0.2, 0.5))
        elif action == "idle_balance":
            p.update(corps_dz=0.01 * abs(s2(t)), corps_pitch=1.5 * s2(t), corps_dx=0.04 * s2(t), bras_g=4 * s2(t), bras_d=-4 * s2(t))
        elif action == "idle_voisin":
            p.update(tete_yaw=cible_yaw * bump(t, 0.1, 0.9), tete_pitch=-3 * bump(t, 0.3, 0.7), corps_yaw=cible_yaw * 0.25 * bump(t, 0.1, 0.9))
        elif action == "idle_etire":
            p.update(bras_g=-150 * bump(t, 0.1, 0.9), bras_d=-150 * bump(t, 0.1, 0.9), tete_pitch=-20 * bump(t, 0.2, 0.8), corps_dz=0.05 * bump(t, 0.2, 0.8))
        elif action == "working":
            if tache == "typing":
                p.update(bras_g=-45 + 8 * s2(t, 3), bras_d=-45 - 8 * s2(t, 3), tete_yaw=12 * s2(t), tete_pitch=10)
            elif tache == "reading":
                p.update(tete_pitch=22, bras_g=-60, bras_d=-60 + 25 * bump(t, 0.4, 0.6))
            elif tache == "stamping":
                p.update(bras_d=-90 + 50 * bump(t, 0.3, 0.6), corps_dz=-0.05 * bump(t, 0.35, 0.6), tete_pitch=15)
            elif tache == "clipboard":
                p.update(bras_g=-70, bras_d=-70 + 15 * s2(t, 2), tete_pitch=18, tete_yaw=6 * s2(t))
            elif tache == "lifting":
                p.update(corps_pitch=14 * bump(t, 0.0, 0.4), corps_dz=0.1 * bump(t, 0.4, 0.8), bras_g=-80 * bump(t, 0.3, 0.9), bras_d=-80 * bump(t, 0.3, 0.9), corps_yaw=70 * bump(t, 0.5, 1.0))
            elif tache == "sorting":
                p.update(bras_g=-70 * max(0.0, s2(t)), bras_d=-70 * max(0.0, -s2(t)), tete_yaw=25 * s2(t), corps_yaw=10 * s2(t))
            elif tache == "machine":
                p.update(bras_d=-100 + 40 * bump(t, 0.1, 0.4), tete_yaw=-20 * bump(t, 0.5, 0.95), tete_pitch=-6 * bump(t, 0.5, 0.95))
            elif tache == "welding":
                p.update(corps_dz=-0.18, corps_pitch=12, bras_d=-85, yeux=0.6 + 0.4 * (1 if (f % 3) else 0.2))
            elif tache == "scanning":
                p.update(bras_d=-80, corps_yaw=30 * math.sin(math.pi * t) - 15, tete_yaw=10 * math.sin(math.pi * t) - 5, tete_pitch=12)
            elif tache == "dialing":
                p.update(bras_d=-75, tete_pitch=14, corps_yaw=6 * s2(t))
            elif tache == "counting":
                p.update(bras_d=-70, bras_g=-50, corps_yaw=-14 + 28 * bump(t, 0.1, 0.9), tete_pitch=16)
            elif tache == "pinning":
                p.update(bras_d=-140 * bump(t, 0.1, 0.7), corps_dz=0.04 * bump(t, 0.2, 0.6), tete_pitch=-18 * bump(t, 0.1, 0.7))
            elif tache == "wheel":
                p.update(bras_g=-80 + 15 * s2(t), bras_d=-80 - 15 * s2(t), corps_yaw=6 * s2(t))
            elif tache == "watching":
                p.update(tete_yaw=35 * math.sin(math.pi * t) - 17, tete_pitch=-8)
            elif tache == "talking":
                p.update(tete_pitch=5 * s2(t, 3), bras_d=-40 * bump(t, 0.2, 0.7), tete_yaw=8 * s2(t))
            else:
                p.update(bras_g=-45, bras_d=-45, tete_pitch=10, tete_yaw=10 * s2(t))
        elif action == "marche":
            # one body length forward, looping in place: the page moves the sprite along the path
            p.update(corps_dz=0.04 * abs(s2(t, 2)), corps_pitch=3, bras_g=-60, bras_d=-60, corps_yaw=3 * s2(t, 2), tete_pitch=4)
        elif action == "reagit_tourne":
            p.update(tete_yaw=cible_yaw * bump(t, 0.0, 1.0) ** 0.5 if t < 0.5 else cible_yaw * bump(t, 0.0, 1.0), corps_yaw=cible_yaw * 0.4 * bump(t, 0.0, 1.0), tete_pitch=-5 * bump(t, 0.1, 0.9))
        elif action == "reagit_joie":
            up = -160 * (bump(t, 0.05, 0.45) + bump(t, 0.5, 0.95))
            p.update(bras_g=up, bras_d=up, corps_dz=0.12 * (bump(t, 0.1, 0.4) + bump(t, 0.55, 0.9)), tete_pitch=-12 * (bump(t, 0.05, 0.45) + bump(t, 0.5, 0.95)))
        elif action == "bloque":
            p.update(corps_pitch=10, tete_pitch=28, bras_g=8, bras_d=8, corps_dz=-0.03 + 0.01 * s2(t), yeux=0.35 if abs(t - 0.5) > 0.06 else 0.05, antenne=0.4)
        elif action == "attend":
            # the amber sign is the accessory raised: right arm up and still, a slow breath
            p.update(bras_d=-110, corps_dz=0.01 * s2(t), tete_pitch=-2, antenne=0.7 + 0.3 * abs(s2(t, 0.5)))
        elif action == "clic":
            k = min(1.0, t * 1.6)
            p.update(tete_pitch=-26 * k, tete_yaw=cible_yaw * k, corps_dz=0.03 * k, yeux=1.3)
        elif action == "range":
            p.update(corps_pitch=16 * bump(t, 0.05, 0.4), bras_d=-70 * bump(t, 0.05, 0.4) - 60 * bump(t, 0.45, 0.95), corps_yaw=-50 * bump(t, 0.4, 1.0), tete_pitch=14)
        elif action == "recharge":
            p.update(tete_pitch=32, corps_dz=-0.08 + 0.01 * s2(t), bras_g=10, bras_d=10, yeux=0.08, antenne=0.15 + 0.05 * s2(t))
        elif action == "reveil":
            k = bump(t, 0.0, 0.6) if t < 0.3 else 1.0
            p.update(tete_pitch=32 * (1 - min(1.0, t * 2.5)), corps_dz=-0.08 * (1 - min(1.0, t * 2.5)), tete_yaw=10 * s2(t, 3) * bump(t, 0.5, 0.95),
                     yeux=0.08 + 0.92 * min(1.0, t * 2.5), antenne=0.15 + 0.85 * min(1.0, t * 2.0))
        rig.pose(f, **p)


def attention(rig: Rig, vers_camera_yaw: float, chemin: str):
    """The hover frames: the head turning toward the viewer in `ATTENTION` steps, each a still."""
    rig.reset()
    for i in range(ATTENTION):
        k = i / max(1, ATTENTION - 1)
        rig.pose(1, tete_yaw=vers_camera_yaw * k, tete_pitch=-6 * k, yeux=1.0 + 0.2 * k)
        _rendre(os.path.join(chemin, f"{i + 1:04d}.png"))
    rig.reset()


def yaw_vers_camera(o) -> float:
    """The head yaw (degrees) that turns a robot's face (-Y) toward the camera, clamped to 70."""
    cam = bpy.context.scene.camera
    d = cam.matrix_world.translation - o.matrix_world.translation
    cible = math.degrees(math.atan2(d.y, d.x)) + 90.0
    courant = math.degrees(o.rotation_euler.z)
    delta = (cible - courant + 180) % 360 - 180
    return max(-70.0, min(70.0, delta))

# ---------------------------------------------------------------- social loops

def duo_passation(a, b, chemin: str, n: int | None = None):
    """Two robots meet: `a` walks the last body length toward `b` carrying a crate, `b` turns,
    both nod, `a` sets the crate down. Rendered together (the page plays it at the handoff
    point, TYCOON-PAGE.md). Both are hidden again afterwards by the caller."""
    n = n or frames("marche")
    ra, rb = Rig(a), Rig(b)
    d = b.matrix_world.translation - a.matrix_world.translation
    yaw_b_vers_a = (math.degrees(math.atan2(-d.y, -d.x)) + 90 - math.degrees(b.rotation_euler.z) + 180) % 360 - 180
    c = caisse(f"{a.name}.caisse", (0, 0, 0))
    c.parent = a
    c.location = (0, -1.0 * a.get("echelle", 0.55), 1.1 * a.get("echelle", 0.55))
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, n
    bump = lambda t, s, e: math.sin(math.pi * (t - s) / (e - s)) if s <= t <= e else 0.0
    for f in range(1, n + 1):
        t = (f - 1) / n
        avance = min(1.0, t / 0.5)
        ra.pose(f, corps_dx=-1.2 * avance * a.get("echelle", 0.55), corps_dz=0.03 * abs(math.sin(2 * math.pi * t * 2)) * (1 if t < 0.5 else 0),
                bras_g=-70 if t < 0.75 else -70 + 70 * bump(t, 0.75, 1.0), bras_d=-70 if t < 0.75 else -70 + 70 * bump(t, 0.75, 1.0),
                tete_pitch=8 * bump(t, 0.55, 0.75), yeux=_clignement(t, 0.3))
        rb.pose(f, tete_yaw=max(-70, min(70, yaw_b_vers_a)) * min(1.0, t / 0.3), tete_pitch=8 * bump(t, 0.55, 0.75), yeux=_clignement(t, 0.8))
        c.hide_render = t >= 0.9
        c.keyframe_insert("hide_render", frame=f)
    _rendre(os.path.join(chemin, ""), animation=True)
    ra.reset(); rb.reset()
    bpy.data.objects.remove(c, do_unlink=True)


def chef_vers_bloque(chef, bloque, chemin: str, n: int | None = None):
    """The chief of staff walks to a blocked robot, stops beside it, and both look at the
    red lamp; the blocked robot lifts its head a little. Rendered together."""
    n = n or frames("marche")
    rc, rb = Rig(chef), Rig(bloque)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, n
    bump = lambda t, s, e: math.sin(math.pi * (t - s) / (e - s)) if s <= t <= e else 0.0
    for f in range(1, n + 1):
        t = (f - 1) / n
        avance = min(1.0, t / 0.6)
        rc.pose(f, corps_dx=-1.4 * avance * chef.get("echelle", 0.55), corps_dz=0.03 * abs(math.sin(2 * math.pi * t * 2)) * (1 if t < 0.6 else 0),
                bras_g=-30 if t < 0.6 else -30 - 40 * bump(t, 0.6, 1.0), tete_pitch=10 * bump(t, 0.6, 1.0), yeux=_clignement(t, 0.4))
        rb.pose(f, corps_pitch=10 - 6 * bump(t, 0.6, 1.0), tete_pitch=28 - 20 * bump(t, 0.6, 1.0), yeux=0.35 + 0.5 * bump(t, 0.6, 1.0), antenne=0.4)
    _rendre(os.path.join(chemin, ""), animation=True)
    rc.reset(); rb.reset()

# ---------------------------------------------------------------- render

def _ecran(obj, sc, cam):
    """Screen position (pixels, origin top-left) and a rough box of an object and its children."""
    if world_to_camera_view is None:
        return None
    objs = [obj] + [c for c in obj.children_recursive if c.type == "MESH"]
    xs, ys = [], []
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            v = world_to_camera_view(sc, cam, o.matrix_world @ Vector(c))
            xs.append(v.x * RESOLUTION[0]); ys.append((1 - v.y) * RESOLUTION[1])
    if not xs:
        v = world_to_camera_view(sc, cam, obj.matrix_world.translation)
        xs, ys = [v.x * RESOLUTION[0]], [(1 - v.y) * RESOLUTION[1]]
    return {"x": round(min(xs)), "y": round(min(ys)), "w": round(max(xs) - min(xs)), "h": round(max(ys) - min(ys))}


def _point_ecran(p, sc, cam):
    v = world_to_camera_view(sc, cam, Vector(p))
    return {"x": round(v.x * RESOLUTION[0]), "y": round((1 - v.y) * RESOLUTION[1])}


def exporter_positions(base: str, robots, stations, chemins: dict | None = None, extra: dict | None = None):
    """positions.json: robots and stations as boxes, walking paths as screen polylines
    (`chemins`: name -> list of world points), anything else the base wants (`extra`)."""
    sc, cam = bpy.context.scene, bpy.context.scene.camera
    data = {"base": base, "resolution": RESOLUTION, "fps": FPS, "robots": [], "stations": [], "chemins": {}}
    for r in robots:
        box = _ecran(r, sc, cam) or {}
        data["robots"].append({"nom": r.name, "role": r.get("role"), "departement": r.get("departement"),
                               "accessoire": ACCESSOIRES.get(r.get("role"), "clipboard"),
                               "pied": _point_ecran(r.matrix_world.translation, sc, cam) if world_to_camera_view else None,
                               "regard_camera": round(yaw_vers_camera(r), 1), **box})
    for s in stations:
        data["stations"].append({"nom": s.name, "texte": s.get("texte", ""), "genre": s.get("genre", ""), **(_ecran(s, sc, cam) or {})})
    for nom, pts in (chemins or {}).items():
        data["chemins"][nom] = [_point_ecran(p, sc, cam) for p in pts] if world_to_camera_view else []
    if extra:
        data.update(extra)
    os.makedirs(os.path.join(RACINE, base), exist_ok=True)
    with open(os.path.join(RACINE, base, "positions.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def exporter_poids(base: str, robots, duos: int):
    """poids.json: frames per robot and an estimate of the weight at 1x (a robot frame is
    about 160 by 240 pixels, 18 KB in PNG with alpha on average; a duo frame about twice)."""
    par_robot = sum(f for f, _ in ACTIONS.values()) + ATTENTION
    total = par_robot * len(robots) + duos * ACTIONS["marche"][0]
    data = {"base": base, "robots": len(robots), "frames_par_robot": par_robot,
            "actions": {k: v[0] for k, v in ACTIONS.items()}, "attention": ATTENTION,
            "duos": duos, "frames_total": total, "poids_estime_mo_1x": round(total * 18 / 1024, 1),
            "poids_estime_mo_2x": round(total * 18 * 3.6 / 1024, 1)}
    with open(os.path.join(RACINE, base, "poids.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return data


def _rendre(chemin: str, animation: bool = False):
    sc = bpy.context.scene
    sc.render.filepath = chemin
    bpy.ops.render.render(animation=animation, write_still=not animation)


def _cacher(objs, cache: bool):
    for o in objs:
        o.hide_render = cache
        for c in o.children_recursive:
            c.hide_render = cache


def rendre_base(base: str, robots, stations, taches: dict[str, str], chemins: dict | None = None,
                voisins: dict | None = None, duos=(), extra: dict | None = None):
    """The day still without robots, the night still, the positions file, then each robot's
    loops alone over a shadow catcher, its attention frames, and the social loops.
    `taches` maps a robot name to its working task; `voisins` maps a robot name to the head
    yaw toward its neighbour; `duos` lists (kind, a, b) with kind "passation" or "chef"."""
    sc = bpy.context.scene
    sol_obj = bpy.data.objects.get("Sol")
    _cacher(robots, True)
    sc.render.film_transparent = False
    sc.render.image_settings.color_mode = "RGB"
    sc.frame_set(1)
    _rendre(os.path.join(RACINE, base, "base.png"))
    exporter_positions(base, robots, stations, chemins, extra)
    poids = exporter_poids(base, robots, len(duos))
    # night: a copy of the light state is not needed, the still is the last use of the scene lights
    forces = {o.name: o.data.energy for o in sc.objects if o.type == "LIGHT"}
    nuit()
    _rendre(os.path.join(RACINE, base, "nuit.png"))
    if SANS_BOUCLES:
        return poids
    # back to day for the loops
    for o in sc.objects:
        if o.type == "LIGHT" and o.name in forces:
            o.data.energy = forces[o.name]
            if o.data.type == "SUN":
                o.data.color = (1.0, 1.0, 1.0)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value *= 1.5
    for m in bpy.data.materials:
        e = _emission(m)
        if e is not None and e.default_value > 0 and "fenetre" not in m.name:
            e.default_value /= 0.15
    # robots alone: everything else hidden, the ground kept as a shadow catcher
    autres = [o for o in sc.objects if o.type in ("MESH", "CURVE") and o not in robots
              and not any(r in o.parent_recursive for r in robots) if hasattr(o, "parent_recursive")]
    if not autres:
        autres = [o for o in sc.objects if o.type in ("MESH", "CURVE") and o not in robots
                  and not any(c is o for r in robots for c in r.children_recursive)]
    for o in autres:
        o.hide_render = True
    if sol_obj is not None:
        sol_obj.hide_render = False
        sol_obj.is_shadow_catcher = True
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    for r in robots:
        if SEULEMENT and r.name != SEULEMENT:
            continue
        _cacher([r], False)
        rig = Rig(r)
        vers_cam = yaw_vers_camera(r)
        for action in ACTIONS:
            cible = (voisins or {}).get(r.name, 30.0) if action in ("idle_voisin", "reagit_tourne") else vers_cam
            jouer(rig, action, taches.get(r.name, "typing"), cible_yaw=cible)
            _rendre(os.path.join(RACINE, base, r.name, action, ""), animation=True)
        attention(rig, vers_cam, os.path.join(RACINE, base, r.name, "attention"))
        rig.reset()
        _cacher([r], True)
    for genre, a, b in duos:
        _cacher([a, b], False)
        chemin = os.path.join(RACINE, base, "duos", f"{genre}_{a.name}_{b.name}")
        if genre == "passation":
            duo_passation(a, b, chemin)
        else:
            chef_vers_bloque(a, b, chemin)
        _cacher([a, b], True)
    return poids
