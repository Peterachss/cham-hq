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

from build123d import (Compound, Edge, Location, Solid, Vector, Wire,
                       export_gltf)

try:  # the render skill's exporter, when run from inside the skill
    from viewer.render import render as skill_render
except Exception:  # plain build123d export otherwise
    skill_render = None

OUT = Path(__file__).resolve().parent
TOL = 0.0006  # relative linear deflection: coarse enough for small files
ANG = 0.28    # angular deflection (radians)


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
    return Solid.make_loft(wires, ruled=False)


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
    print(name, (OUT / f"{name}.glb").stat().st_size // 1024, "KB")


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
    p0, p1, p2 = V(215, 0, 590), V(345, -6, 560), V(390, -34, 118)
    sleeve = tube(p0, p1, p2, [
        (0.00, 140, 98),
        (0.12, 128, 92),
        (0.30, 96, 84),
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
    outer = ellipsoid(0, 34, H + 70, 128, 150, 205)
    inner = ellipsoid(0, 12, H + 92, 106, 128, 182)
    cut = Solid.make_box(600, 600, 600, Plane.XY).rotate(
        __import__("build123d").Axis.X, -24).move(Location((-300, -590, H - 90)))
    hood = (outer - inner) - cut
    # keep the hood off the front of the chest: only above the shoulders
    hood = hood & Solid.make_box(600, 600, 600, Plane.XY.offset(H - 70).move(Location((-300, -300, 0))))

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
        ring(690, 180, 104, 2.2, tilt=neck_tilt(0.10, 690)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 102, 86, 2.0, tilt=neck_tilt(0.42, 694)),
    ])
    # Open hem: a shallow hollow up into the body so the bottom reads as fabric
    hem_hole = loft([ring(-5, 252, 118, 2.6), ring(60, 246, 112, 2.6), ring(120, 225, 100, 2.4)])
    body = body - hem_hole

    # Neck opening and the ribbed crew collar on its rim
    nk = neck_tilt(0.42, 694)
    neck_hole = loft([
        section(V(0, 6, -90), V(1, 0, 0), V(0, 1, 0), 82, 68, 2.0, tilt=neck_tilt(0.42, 694 - 90)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 88, 73, 2.0, tilt=neck_tilt(0.42, 694 + 2)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 92, 77, 2.0, tilt=neck_tilt(0.42, 694 + 40)),
    ])
    body = body - neck_hole
    # collar: a rounded rib band swept round the neckline
    pts = []
    for i in range(40):
        t = 2 * math.pi * i / 40
        pts.append(nk(V(96 * math.cos(t), 6 + 81 * math.sin(t), 0)))
    path = Wire([Edge.make_spline(pts, periodic=True)])
    start = pts[0]
    tang = norm(path.tangent_at(0))
    radial = norm(V(start.X, start.Y - 6, 0))
    from build123d import Plane
    up = norm(tang.cross(radial))
    prof = section(start + up * 3, radial, up, 9, 13, 2.6, N=16)
    collar = Solid.sweep(prof, path, transition=__import__("build123d").Transition.ROUND)

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
