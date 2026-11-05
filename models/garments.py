"""Chạm HQ - the 3D hoodie and T-shirt for the Merch tab (merch3d.js).

Built with build123d (CAD, algebra mode) the way the mfranzon/render skill
does it, and exported as binary glTF (.glb). Re-run to rebuild both models:

    pip install build123d
    python models/garments.py            # writes models/hoodie.glb and models/tee.glb

Units are millimetres, size M. Z is up while modelling (export turns it into
glTF's Y-up), X runs across the chest, and the FRONT of each garment faces -Y.
Each garment is a smooth closed solid with the volume of a person inside it
(an "invisible mannequin" look), not a flat panel.

Researched size-M measurements (common size charts):
  Hoodie (oversized, drop shoulder)  half chest ~58 cm, body length ~74 cm
    from the high shoulder point, sleeve ~60 cm from the dropped shoulder
    seam, ribbed cuffs ~6 cm, ribbed hem band ~7 cm, hood ~33 cm tall.
  T-shirt (crew neck)  half chest ~53 cm, body length ~72 cm, shoulder ~46 cm,
    sleeve ~22 cm angled down ~30 degrees, crew rib ~2 cm.

The parts are kept as separate named meshes (body, sleeves, cuffs, hem band,
hood, pocket, collar) so the page can give the ribbed parts a rib texture.
"""

import math
import sys
from pathlib import Path

from build123d import (Compound, Edge, Location, Plane, Solid, Vector, Wire,
                       export_gltf)

try:  # the render skill's exporter, when run from inside the skill
    from viewer.render import render as skill_render
except Exception:  # plain build123d export otherwise
    skill_render = None

OUT = Path(__file__).resolve().parent
TOL = 0.002   # relative linear deflection: coarse enough for small files
ANG = 0.35    # angular deflection (radians)


# ---------------------------------------------------------------- helpers
def V(x, y, z):
    return Vector(float(x), float(y), float(z))


def norm(v):
    return v / v.length


def section(center, e1, e2, a, b, n=2.4, N=28, tilt=None):
    """Closed, smooth rounded cross-section (a superellipse) as a wire.

    a, b are the half-sizes along the in-plane axes e1, e2; n = 2 is an ellipse,
    larger n is boxier. tilt(p) can nudge each point (used for necklines)."""
    pts = []
    for i in range(N):
        t = 2 * math.pi * i / N
        c, s = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** (2 / n), c)
        y = b * math.copysign(abs(s) ** (2 / n), s)
        p = center + e1 * x + e2 * y
        if tilt:
            p = tilt(p)
        pts.append(p)
    return Wire([Edge.make_spline(pts, periodic=True)])


def ring(z, a, b, n=2.4, y=0.0, tilt=None):
    """Horizontal torso section at height z, centred at depth y."""
    return section(V(0, y, z), V(1, 0, 0), V(0, 1, 0), a, b, n, tilt=tilt)


def loft(wires):
    """Smooth loft through the sections (build123d's Solid.make_loft, with the
    surface kept to degree 3 and centripetal spacing: the default high-degree
    fit overshoots between unevenly spaced sections and bulges the hem)."""
    from OCP.Approx import Approx_ParametrizationType
    from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
    b = BRepOffsetAPI_ThruSections(True, False, 1e-6)
    b.SetMaxDegree(3)
    b.SetParType(Approx_ParametrizationType.Approx_Centripetal)
    b.CheckCompatibility(False)
    for w in wires:
        b.AddWire(w.wrapped)
    b.Build()
    return Solid(b.Shape())


def bezier(p0, p1, p2, t):
    return p0 * (1 - t) ** 2 + p1 * (2 * (1 - t) * t) + p2 * (t * t)


def bezier_d(p0, p1, p2, t):
    return (p1 - p0) * (2 * (1 - t)) + (p2 - p1) * (2 * t)


def tube(p0, p1, p2, stations, n=2.2):
    """Loft round sections along a quadratic Bezier centre line.

    stations: (t, a, b) with a measured in the arm's swing plane (XZ) and b
    front-to-back. Section planes are kept perpendicular to the centre line."""
    wires = []
    for t, a, b in stations:
        c = bezier(p0, p1, p2, t)
        d = norm(bezier_d(p0, p1, p2, t))
        e2 = V(0, 1, 0)
        e1 = norm(d.cross(e2))
        e2 = norm(e1.cross(d))
        wires.append(section(c, e1, e2, a, b, n))
    return loft(wires)


def mirror_x(shape):
    return shape.mirror_about_yz() if hasattr(shape, "mirror_about_yz") else shape.mirror()


def ellipsoid(cx, cy, cz, rx, ry, rz):
    """Smooth ellipsoid as a loft of horizontal ellipses (keeps it B-spline)."""
    wires = []
    K = 9
    for i in range(K):
        u = -1 + 2 * (i + 0.5) / K   # skip the poles
        u = math.copysign(abs(u) ** 0.85, u)
        r = math.sqrt(max(1e-4, 1 - u * u))
        wires.append(ring(cz + rz * u, rx * r, ry * r, n=2.0, y=cy))
    return loft(wires)


def flip_x(shape):
    from build123d import Plane, mirror
    return mirror(shape, about=Plane.YZ)


def export(name, parts):
    comp = Compound(children=[])
    kids = []
    for label, shp in parts:
        shp.label = label
        kids.append(shp)
    comp = Compound(children=kids)
    comp.label = name
    if skill_render is not None:
        skill_render(name, comp, linear_deflection=TOL, angular_deflection=ANG)
        src = Path(skill_render.__globals__["MODELS_DIR"]) / f"{name}.glb"
        (OUT / f"{name}.glb").write_bytes(src.read_bytes())
    else:
        export_gltf(comp, str(OUT / f"{name}.glb"), binary=True,
                    linear_deflection=TOL, angular_deflection=ANG)
    slim(OUT / f"{name}.glb")
    print(name, (OUT / f"{name}.glb").stat().st_size // 1024, "KB")


def slim(path):
    """Shrink the exported .glb: one primitive per part, positions + normals
    only (no CAD texture coordinates or materials), 16-bit indices where they fit."""
    import json
    import struct
    import numpy as np
    raw = path.read_bytes()
    jlen = struct.unpack("<I", raw[12:16])[0]
    j = json.loads(raw[20:20 + jlen])
    blen = struct.unpack("<I", raw[20 + jlen:24 + jlen])[0]
    bin_ = raw[28 + jlen:28 + jlen + blen]
    ctype = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}

    def read(i):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        dt = np.dtype(ctype[a["componentType"]])
        n = ncomp[a["type"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", dt.itemsize * n)
        arr = np.frombuffer(bin_, dtype=np.uint8, count=stride * a["count"], offset=off)
        arr = arr.reshape(a["count"], stride)[:, :dt.itemsize * n].copy().view(dt)
        return arr.reshape(a["count"], n)

    out = bytearray()
    views, accs, meshes = [], [], []

    def add(arr, target, kind, minmax=False):
        while len(out) % 4:
            out.append(0)
        views.append({"buffer": 0, "byteOffset": len(out), "byteLength": arr.nbytes, "target": target})
        out.extend(arr.tobytes())
        comp = {np.float32: 5126, np.uint16: 5123, np.uint32: 5125}[arr.dtype.type]
        acc = {"bufferView": len(views) - 1, "componentType": comp,
               "count": int(arr.shape[0]) if arr.ndim > 1 else int(arr.size), "type": kind}
        if minmax:
            acc["min"] = arr.min(axis=0).tolist()
            acc["max"] = arr.max(axis=0).tolist()
        accs.append(acc)
        return len(accs) - 1

    for m in j["meshes"]:
        P, N, I, base = [], [], [], 0
        for p in m["primitives"]:
            pos = read(p["attributes"]["POSITION"]).astype(np.float32)
            nrm = read(p["attributes"]["NORMAL"]).astype(np.float32)
            idx = read(p["indices"]).astype(np.uint32).ravel()
            P.append(pos); N.append(nrm); I.append(idx + base)
            base += len(pos)
        P = np.concatenate(P); N = np.concatenate(N); I = np.concatenate(I)
        I = I.astype(np.uint16 if base < 65536 else np.uint32)
        pa = add(P, 34962, "VEC3", True)
        na = add(N, 34962, "VEC3")
        ia = add(I, 34963, "SCALAR")
        meshes.append({"name": m.get("name"), "primitives": [
            {"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia}]})
    nodes = [{k: v for k, v in n.items() if k in ("name", "mesh", "children", "rotation",
                                                  "translation", "scale", "matrix")} for n in j["nodes"]]
    g = {"asset": {"version": "2.0", "generator": "build123d + models/garments.py"},
         "scene": 0, "scenes": j["scenes"], "nodes": nodes, "meshes": meshes,
         "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(out)}]}
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out.extend(b"\0" * (-len(out) % 4))
    glb = struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(out))
    glb += struct.pack("<II", len(js), 0x4E4F534A) + js
    glb += struct.pack("<II", len(out), 0x004E4942) + bytes(out)
    path.write_bytes(glb)


# ---------------------------------------------------------------- hoodie
def hoodie():
    H = 740.0  # high shoulder point above the hem

    # Ribbed hem band (~7 cm), gathered a little narrower than the body
    band = loft([ring(0, 248, 128, 2.6), ring(36, 252, 130, 2.6), ring(72, 254, 131, 2.6)])

    # Body: boxy oversized torso, blousing over the band, sloping shoulders
    body = loft([
        ring(58, 262, 136, 2.7),
        ring(110, 280, 144, 2.8),
        ring(260, 288, 148, 2.9),
        ring(430, 290, 150, 2.9),
        ring(560, 289, 148, 2.8),
        ring(635, 278, 140, 2.6),
        ring(685, 245, 126, 2.4),
        ring(720, 185, 106, 2.2),
        ring(H + 4, 108, 86, 2.0, y=8),
    ])

    # Kangaroo pocket: a slightly proud copy of the body, cut to a trapezoid
    # (narrow top, wide bottom, slanted hand openings)
    from build123d import Plane, Polyline, extrude, make_face, scale
    pocket_body = scale(body, by=(1.0, 1.055, 1.0))
    trap = make_face(Polyline((-200, 78), (200, 78), (150, 300), (-150, 300), close=True))
    prism = extrude(Plane.XZ * trap, amount=-400)   # from y=0 out past the front
    pocket = pocket_body & prism
    pocket = pocket & Solid.make_box(800, 400, 300, Plane.XY.offset(70).move(Location((-400, -400, 0))))

    # Sleeves: drop shoulder seam at the body's edge, hanging a little forward
    # and away from the body; ~60 cm from the shoulder seam to the cuff end.
    p0, p1, p2 = V(200, 0, 556), V(335, -6, 528), V(390, -34, 118)
    sleeve = tube(p0, p1, p2, [
        (0.00, 116, 92),
        (0.12, 110, 90),
        (0.30, 93, 84),
        (0.55, 82, 76),
        (0.80, 72, 68),
        (0.93, 64, 60),
        (1.00, 54, 52),
    ])
    # Ribbed cuff, ~6 cm, carrying on along the sleeve's line
    d = norm(bezier_d(p0, p1, p2, 1.0))
    e2 = V(0, 1, 0)
    e1 = norm(d.cross(e2))
    e2 = norm(e1.cross(d))
    c0 = p2 - d * 12
    cuff = loft([
        section(c0, e1, e2, 50, 48, 2.0),
        section(c0 + d * 30, e1, e2, 47, 45, 2.0),
        section(c0 + d * 66, e1, e2, 45, 43, 2.0),
    ])
    # A shallow opening at the end of the cuff
    hole = loft([
        section(c0 + d * 40, e1, e2, 34, 32, 2.0),
        section(c0 + d * 80, e1, e2, 36, 34, 2.0),
    ])
    cuff = cuff - hole

    # Hood: sits up behind the neck, opening facing forward and a little up
    outer = ellipsoid(0, 40, H + 22, 150, 158, 182)
    inner = ellipsoid(0, 16, H + 40, 129, 140, 163)
    face_dir = V(0, -math.cos(math.radians(35)), math.sin(math.radians(35)))   # forward and a little up
    opening = Plane(origin=V(0, -22, H + 10), x_dir=V(1, 0, 0), z_dir=face_dir)
    cut = Solid.make_box(1000, 1000, 600, opening.move(Location((-500, -500, 0))))
    # its lower part sinks into the shoulders and drapes onto the upper back
    hood = (outer - inner) - cut

    parts = [
        ("body", body + pocket),
        ("hood", hood),
        ("hem", band),
        ("sleeve_l", sleeve),
        ("sleeve_r", flip_x(sleeve)),
        ("cuff_l", cuff),
        ("cuff_r", flip_x(cuff)),
    ]
    export("hoodie", parts)


# ---------------------------------------------------------------- tee
def tee():
    H = 720.0
    NZ = 680.0  # neckline height at the middle; back of the neck ~H, front ~8 cm lower
    # The neckline is tilted: the back of the neck sits higher than the front.
    def neck_tilt(k, z0):
        return lambda p: V(p.X, p.Y, z0 + k * p.Y)

    body = loft([
        ring(0, 262, 128, 2.6),
        ring(160, 263, 130, 2.7),
        ring(360, 266, 134, 2.7),
        ring(500, 265, 133, 2.7),
        ring(600, 254, 128, 2.6),
        ring(655, 228, 118, 2.4),
        ring(678, 182, 104, 2.2, tilt=neck_tilt(0.12, 678)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 102, 86, 2.0, tilt=neck_tilt(0.42, NZ)),
    ])
    # Open hem: a shallow hollow up into the body so the bottom reads as fabric
    hem_hole = loft([ring(-5, 252, 118, 2.6), ring(60, 246, 112, 2.6), ring(120, 225, 100, 2.4)])
    body = body - hem_hole

    # Neck opening and the ribbed crew collar on its rim
    neck_hole = loft([
        section(V(0, 6, -90), V(1, 0, 0), V(0, 1, 0), 82, 68, 2.0, tilt=neck_tilt(0.42, NZ - 90)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 88, 73, 2.0, tilt=neck_tilt(0.42, NZ + 2)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 92, 77, 2.0, tilt=neck_tilt(0.42, NZ + 40)),
    ])
    body = body - neck_hole
    # collar: a ~2 cm rib band standing on the neckline rim
    def neck_ring(a, b, dz):
        return section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), a, b, 2.0,
                       tilt=neck_tilt(0.42, NZ + dz))
    collar = loft([neck_ring(104, 89, -8), neck_ring(106, 91, 3), neck_ring(103, 88, 12)])
    collar = collar - loft([neck_ring(86, 71, -30), neck_ring(87, 72, 0), neck_ring(89, 74, 30)])

    # Short sleeves, angled down ~30 degrees from the shoulder
    ang = math.radians(32)
    d = V(math.cos(ang), -0.10, -math.sin(ang))
    p0 = V(170, 0, 600)
    p2 = p0 + d * 300
    p1 = (p0 + p2) * 0.5
    sleeve = tube(p0, p1, p2, [
        (0.00, 118, 80),
        (0.25, 104, 72),
        (0.55, 90, 64),
        (0.85, 80, 58),
        (1.00, 76, 55),
    ], n=2.3)
    dd = norm(d)
    e2 = V(0, 1, 0)
    e1 = norm(dd.cross(e2))
    e2 = norm(e1.cross(dd))
    s_hole = loft([
        section(p2 - dd * 50, e1, e2, 58, 38, 2.3),
        section(p2 + dd * 20, e1, e2, 68, 46, 2.3),
    ])
    sleeve = sleeve - s_hole

    parts = [
        ("body", body),
        ("collar", collar),
        ("sleeve_l", sleeve),
        ("sleeve_r", flip_x(sleeve)),
    ]
    export("tee", parts)


if __name__ == "__main__":
    which = sys.argv[1:] or ["hoodie", "tee"]
    if "hoodie" in which:
        hoodie()
    if "tee" in which:
        tee()
