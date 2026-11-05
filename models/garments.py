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
hood, cords, collar...). After the CAD export, drape.py turns each part into
fabric: even fine detail, soft folds, knit ribs, seam grooves and baked soft
shadows (needs: pip install trimesh embreex).
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
TOL = 0.008   # relative linear deflection (drape.py refines it afterwards)
ANG = 0.6     # angular deflection (radians)


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


def flip_x(shape):
    from build123d import Plane, mirror
    return mirror(shape, about=Plane.YZ)


def export(name, parts, rules):
    kids = []
    for label, shp in parts:
        shp.label = label
        kids.append(shp)
    comp = Compound(children=kids)
    comp.label = name
    out = OUT / f"{name}.glb"
    if skill_render is not None:
        skill_render(name, comp, linear_deflection=TOL, angular_deflection=ANG)
        src = Path(skill_render.__globals__["MODELS_DIR"]) / f"{name}.glb"
        out.write_bytes(src.read_bytes())
    else:
        export_gltf(comp, str(out), binary=True, linear_deflection=TOL, angular_deflection=ANG)
    sys.path.insert(0, str(OUT))
    import drape
    tris = drape.finish(out, name, rules)
    print(name, out.stat().st_size // 1024, "KB,", tris, "triangles")


# ---------------------------------------------------------------- drape rules
def _np():
    import numpy as np
    import drape
    return np, drape


def along(P, p0, p1, p2, K=64):
    """Nearest point on a Bezier centre line (mirrored to +x): t and arc length s."""
    np, _ = _np()
    Q = P.copy(); Q[:, 0] = np.abs(Q[:, 0])
    ts = np.linspace(0, 1, K)
    C = np.array([[*(bezier(p0, p1, p2, t))] for t in ts])
    seg = np.linalg.norm(np.diff(C, axis=0), axis=1)
    S = np.concatenate([[0], np.cumsum(seg)])
    d2 = ((Q[:, None, :] - C[None]) ** 2).sum(-1)
    k = d2.argmin(1)
    return ts[k], S[k]


def seam(P, width=2.4, depth=1.3, xmin=55):
    """A seam groove in the side/shoulder plane (y = 0)."""
    np, _ = _np()
    return -depth * np.exp(-(P[:, 1] / width) ** 2) * (np.abs(P[:, 0]) > xmin)


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

    from build123d import Polyline, extrude, make_face, scale
    front_half = Solid.make_box(900, 400, 1200, Plane.XY.move(Location((-450, -400, -100))))

    def on_front(poly, puff):
        """A panel lying on the front of the body (a slightly proud copy of
        the body cut to an outline)."""
        proud = scale(body, by=(1.0 + puff / 290, 1.0 + puff / 150, 1.0))
        prism = extrude(Plane.XZ * make_face(Polyline(*poly, close=True)), amount=400, both=True)
        return proud & prism & front_half

    # Open bottom: a hollow up through the hem band into the body
    bottom = loft([ring(-5, 236, 116, 2.6), ring(50, 232, 112, 2.6), ring(110, 214, 100, 2.4)])
    band = band - bottom

    # Kangaroo pocket (narrow top, wide bottom, slanted hand openings)
    pocket = on_front([(-200, 78), (200, 78), (150, 300), (-150, 300)], 7)
    # The hood's two front edges crossing over at the neck, in a V
    vee = on_front([(-150, H - 12), (0, H - 150), (150, H - 12), (98, H - 12), (0, H - 108), (-98, H - 12)], 6)

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
    hole = loft([
        section(c0 + d * 40, e1, e2, 34, 32, 2.0),
        section(c0 + d * 80, e1, e2, 36, 34, 2.0),
    ])
    cuff = cuff - hole

    # Hood: lying back on the shoulders, rising behind the neck to a soft
    # point and draping down the upper back; the opening faces up and forward.
    outer = loft([
        ring(H - 205, 34, 16, 2.0, y=164),
        ring(H - 150, 112, 42, 2.3, y=160),
        ring(H - 85, 165, 78, 2.5, y=132),
        ring(H - 25, 176, 108, 2.5, y=102),
        ring(H + 20, 166, 112, 2.4, y=96),
        ring(H + 46, 128, 98, 2.3, y=104),
        ring(H + 58, 62, 56, 2.1, y=116),
        ring(H + 62, 14, 14, 2.0, y=120),
    ])
    inner = loft([
        ring(H - 140, 74, 24, 2.0, y=150),
        ring(H - 72, 144, 60, 2.4, y=122),
        ring(H - 10, 156, 88, 2.4, y=96),
        ring(H + 22, 146, 92, 2.3, y=92),
        ring(H + 40, 104, 76, 2.1, y=102),
        ring(H + 49, 52, 40, 2.0, y=110),
    ])
    face_dir = V(0, -0.6, 0.8)
    opening = Plane(origin=V(0, 20, H + 4), x_dir=V(1, 0, 0), z_dir=face_dir)
    cut = Solid.make_box(1000, 1000, 600, opening.move(Location((-500, -500, 0))))
    hood = (outer - inner) - cut

    # Drawstrings with metal tips, hanging from the V down the chest
    cord_pts = [V(40, -142, H - 70), V(41, -151, H - 120), V(42, -157, H - 210), V(43, -158, H - 330)]
    path = Wire([Edge.make_spline(cord_pts)])
    t0 = norm(path.tangent_at(0))
    a0 = norm(t0.cross(V(1, 0, 0)))
    cord = Solid.sweep(section(cord_pts[0], a0, norm(t0.cross(a0)), 3.4, 3.4, 2.0, N=12), path)
    tip_d = norm(path.tangent_at(1))
    ta = norm(tip_d.cross(V(1, 0, 0)))
    tb = norm(tip_d.cross(ta))
    end = cord_pts[-1]
    aglet = loft([section(end - tip_d * 4, ta, tb, 4.4, 4.4, 2.0, N=12),
                  section(end + tip_d * 26, ta, tb, 4.2, 4.2, 2.0, N=12)])

    np, dr = _np()

    def body_drape(P, N):
        z, x = P[:, 2], P[:, 0]
        d = 2.8 * dr.vnoise(P, 140, 1) + 1.0 * dr.vnoise(P, 55, 2)
        d += 1.9 * dr.smoothstep(300, 90, z) * np.sin(2 * np.pi * x / 68 + 2.2 * dr.vnoise(P, 200, 3))
        # soft folds pulling from the underarms across the chest and back
        r = np.hypot(np.abs(x) - 290, z - 480)
        d += 1.6 * np.exp(-(r / 150) ** 2) * np.sin(r / 11 + 1.5 * dr.vnoise(P, 90, 11))
        d += 1.8 * dr.smoothstep(135, 75, z) * np.sin(2 * np.pi * x / 42 + 1.5 * dr.vnoise(P, 90, 9))
        return d + seam(P)

    def sleeve_drape(P, N):
        t, s = along(P, p0, p1, p2)
        d = 1.6 * dr.vnoise(P, 90, 4)
        # bunching where the sleeve gathers into the cuff: broken, slanted folds
        mask = 0.55 + 0.45 * dr.vnoise(P, 55, 12)
        slant = 0.45 * (P[:, 1] + 0.3 * P[:, 0])
        d += 2.2 * mask * dr.smoothstep(0.6, 0.97, t) * np.sin(2 * np.pi * (s + slant) / 36 + 2.4 * dr.vnoise(P, 70, 5))
        d += 1.8 * np.exp(-((t - 0.48) / 0.1) ** 2) * np.sin(2 * np.pi * s / 46 + 3 * dr.vnoise(P, 60, 6))
        return d

    def band_drape(P, N):
        return 0.7 * dr.vnoise(P, 120, 10)

    def sleeve_L(P):
        t, _ = along(P, p0, p1, p2)
        return np.where(t > 0.55, 9.5, 18.0)

    def hood_drape(P, N):
        return 1.8 * dr.vnoise(P, 100, 7) + 0.8 * dr.vnoise(P, 45, 8) - 1.2 * np.exp(-(P[:, 0] / 2.2) ** 2)

    rules = {
        "body": {"L": lambda P: np.where(P[:, 2] < 320, 13.0, 21.0), "drape": body_drape},
        "hood": {"L": 15, "drape": hood_drape},
        "hem": {"L": 18, "drape": band_drape},
        "sleeve_l": {"L": sleeve_L, "drape": sleeve_drape},
        "sleeve_r": {"L": sleeve_L, "drape": sleeve_drape},
        "cuff_l": {"L": 13}, "cuff_r": {"L": 13},
        "cord_l": {"L": 14}, "cord_r": {"L": 14}, "aglet_l": {"L": 14}, "aglet_r": {"L": 14},
    }
    parts = [
        ("body", body + pocket + vee - bottom),
        ("hood", hood),
        ("hem", band),
        ("sleeve_l", sleeve),
        ("sleeve_r", flip_x(sleeve)),
        ("cuff_l", cuff),
        ("cuff_r", flip_x(cuff)),
        ("cord_l", cord),
        ("cord_r", flip_x(cord)),
        ("aglet_l", aglet),
        ("aglet_r", flip_x(aglet)),
    ]
    export("hoodie", parts, rules)


# ---------------------------------------------------------------- tee
def tee():
    H = 720.0
    NZ = 698.0  # neckline height at the middle; back of the neck ~H, front ~8 cm lower

    # The neckline is tilted: the back of the neck sits higher than the front.
    def neck_tilt(k, z0):
        return lambda p: V(p.X, p.Y, z0 + k * p.Y)

    body = loft([
        ring(18, 262, 128, 2.6),
        ring(160, 263, 130, 2.7),
        ring(360, 266, 134, 2.7),
        ring(500, 265, 133, 2.7),
        ring(600, 254, 128, 2.6),
        ring(652, 232, 120, 2.4),
        ring(672, 200, 110, 2.3, tilt=neck_tilt(0.14, 672)),
        ring(688, 150, 97, 2.1, tilt=neck_tilt(0.26, 688)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 102, 86, 2.0, tilt=neck_tilt(0.30, NZ)),
    ])
    # Turned-up hem (~2.5 cm), standing a hair proud of the body
    hem = loft([ring(0, 263.5, 129.5, 2.6), ring(13, 263.6, 129.6, 2.6), ring(26, 263.5, 129.6, 2.6)])
    # Open hem: a shallow hollow up into the body so the bottom reads as fabric
    hem_hole = loft([ring(-5, 252, 118, 2.6), ring(60, 246, 112, 2.6), ring(120, 225, 100, 2.4)])
    body = body - hem_hole
    hem = hem - hem_hole

    # Neck opening and the ribbed crew collar on its rim
    # the neck opens into the hollow inside of the shirt
    neck_hole = loft([
        section(V(0, 4, -330), V(1, 0, 0), V(0, 1, 0), 150, 104, 2.4, tilt=neck_tilt(0.0, NZ - 330)),
        section(V(0, 4, -170), V(1, 0, 0), V(0, 1, 0), 150, 104, 2.4, tilt=neck_tilt(0.1, NZ - 170)),
        section(V(0, 6, -70), V(1, 0, 0), V(0, 1, 0), 116, 90, 2.2, tilt=neck_tilt(0.22, NZ - 70)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 88, 73, 2.0, tilt=neck_tilt(0.30, NZ + 2)),
        section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), 92, 77, 2.0, tilt=neck_tilt(0.30, NZ + 40)),
    ])
    body = body - neck_hole

    def neck_ring(a, b, dz):
        return section(V(0, 6, 0), V(1, 0, 0), V(0, 1, 0), a, b, 2.0,
                       tilt=neck_tilt(0.30, NZ + dz))
    collar = loft([neck_ring(114, 99, -12), neck_ring(108, 93, -1), neck_ring(101, 86, 6)])
    collar = collar - loft([neck_ring(86, 71, -30), neck_ring(87, 72, 0), neck_ring(89, 74, 30)])

    # Short sleeves hanging down and out at ~45 degrees from the shoulder
    ang = math.radians(45)
    d = V(math.cos(ang), -0.08, -math.sin(ang))
    dd = norm(d)
    p0 = V(160, 0, 610)
    p2 = p0 + d * 275
    p1 = (p0 + p2) * 0.5
    sleeve = tube(p0, p1, p2, [
        (0.00, 120, 82),
        (0.30, 102, 73),
        (0.60, 90, 65),
        (0.88, 81, 59),
        (1.00, 78, 57),
    ], n=2.3)
    e2 = V(0, 1, 0)
    e1 = norm(dd.cross(e2))
    e2 = norm(e1.cross(dd))
    # turned-up sleeve hem (~2.5 cm) and the open end
    s_hem = loft([section(p2 - dd * 26, e1, e2, 80, 58.6, 2.3),
                  section(p2 - dd * 13, e1, e2, 79.8, 58.6, 2.3),
                  section(p2, e1, e2, 79.6, 58.4, 2.3)])
    s_hole = loft([
        section(p2 - dd * 60, e1, e2, 64, 42, 2.3),
        section(p2 + dd * 20, e1, e2, 70, 49, 2.3),
    ])
    sleeve = sleeve - s_hole
    s_hem = s_hem - s_hole

    np, dr = _np()

    def body_drape(P, N):
        z, x = P[:, 2], P[:, 0]
        d = 1.5 * dr.vnoise(P, 150, 1) + 0.6 * dr.vnoise(P, 60, 2)
        d += 1.0 * dr.smoothstep(230, 40, z) * np.sin(2 * np.pi * x / 82 + 2 * dr.vnoise(P, 200, 3))
        # pull folds from the underarms towards the chest
        r = np.hypot(np.abs(x) - 250, z - 520)
        d += 1.2 * np.exp(-(r / 120) ** 2) * np.sin(r / 9 + dr.vnoise(P, 80, 11))
        return d + seam(P, 2.2, 1.1)

    def sleeve_drape(P, N):
        t, s = along(P, p0, p1, p2)
        d = 1.0 * dr.vnoise(P, 80, 4)
        d += 1.4 * np.exp(-((t - 0.2) / 0.12) ** 2) * np.sin(2 * np.pi * s / 40 + 2 * dr.vnoise(P, 60, 5))
        return d

    rules = {
        "body": {"L": 17, "drape": body_drape},
        "hem": {"L": 16},
        "collar": {"L": 7},
        "sleeve_l": {"L": 12, "drape": sleeve_drape},
        "sleeve_r": {"L": 12, "drape": sleeve_drape},
        "sleeve_hem_l": {"L": 10}, "sleeve_hem_r": {"L": 10},
    }
    parts = [
        ("body", body),
        ("hem", hem),
        ("collar", collar),
        ("sleeve_l", sleeve),
        ("sleeve_r", flip_x(sleeve)),
        ("sleeve_hem_l", s_hem),
        ("sleeve_hem_r", flip_x(s_hem)),
    ]
    export("tee", parts, rules)


if __name__ == "__main__":
    which = sys.argv[1:] or ["hoodie", "tee"]
    if "hoodie" in which:
        hoodie()
    if "tee" in which:
        tee()
