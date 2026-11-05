"""Chạm HQ - turns the smooth CAD garments from garments.py into fabric.

build123d gives clean, exact shapes. Real clothes are softer, so after the
CAD export each part's mesh is finished here:

  1. weld + refine   split long triangles (curving the new points onto the
                     surface) so every part has even, fine detail
  2. drape           displace the surface into soft folds: bunching rings at
                     the hoodie cuffs, drape near the hem, gentle noise, knit
                     ribs on the cuffs/hem/collar, grooves for the seams
  3. normals         smooth shading with crisp rims (auto-smooth at 50°)
  4. shadows         bake ambient occlusion (soft contact shadow in creases,
                     under the arms, inside the hood and sleeves) into the
                     vertex colours, ray-traced with embree
  5. pack            quantised glTF (KHR_mesh_quantization) to keep it small

Needs numpy and trimesh with embreex (pip install trimesh embreex).
Units in here are millimetres in the CAD frame (Z up, front = -Y).
"""

import json
import math
import struct

import numpy as np

# ------------------------------------------------------------------ glb io
CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    """Mesh name -> (positions mm, normals, triangle indices), plus the root node."""
    raw = open(path, "rb").read()
    jlen = struct.unpack("<I", raw[12:16])[0]
    j = json.loads(raw[20:20 + jlen])
    blen = struct.unpack("<I", raw[20 + jlen:24 + jlen])[0]
    bin_ = raw[28 + jlen:28 + jlen + blen]

    def acc(i):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        dt = np.dtype(CTYPE[a["componentType"]])
        n = NCOMP[a["type"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", dt.itemsize * n)
        arr = np.frombuffer(bin_, dtype=np.uint8, count=stride * a["count"], offset=off)
        return arr.reshape(a["count"], stride)[:, :dt.itemsize * n].copy().view(dt).reshape(a["count"], n)

    parts = {}
    for m in j["meshes"]:
        P, N, I, base = [], [], [], 0
        for p in m["primitives"]:
            pos = acc(p["attributes"]["POSITION"]).astype(np.float64) * 1000.0
            nrm = acc(p["attributes"]["NORMAL"]).astype(np.float64)
            idx = acc(p["indices"]).astype(np.int64).reshape(-1, 3)
            P.append(pos); N.append(nrm); I.append(idx + base)
            base += len(pos)
        parts[m["name"]] = (np.concatenate(P), np.concatenate(N), np.concatenate(I))
    root = j["nodes"][j["scenes"][0]["nodes"][0]]
    return parts, root


def write_glb(path, name, root_rotation, parts):
    """parts: list of (name, V mm, N, F, ao). Quantised, one node per part."""
    out = bytearray()
    views, accs, meshes, nodes = [], [], [], []

    def view(data, target, stride=None):
        while len(out) % 4:
            out.append(0)
        v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data), "target": target}
        if stride:
            v["byteStride"] = stride
        views.append(v)
        out.extend(data)
        return len(views) - 1

    children = []
    for pname, V, N, F, ao in parts:
        Vm = V / 1000.0
        lo, hi = Vm.min(0), Vm.max(0)
        t = (lo + hi) / 2
        s = float((hi - lo).max() / 2) * 1.0001
        q = np.round((Vm - t) / s * 32767).astype(np.int16)
        qp = np.zeros((len(V), 4), np.int16); qp[:, :3] = q
        qn = np.zeros((len(V), 4), np.int8); qn[:, :3] = np.round(N * 127).astype(np.int8)
        qc = np.zeros((len(V), 4), np.uint8); qc[:, :3] = np.round(np.clip(ao, 0, 1) * 255).astype(np.uint8)[:, None]; qc[:, 3] = 255
        pv = view(qp.tobytes(), 34962, 8)
        nv = view(qn.tobytes(), 34962, 4)
        cv = view(qc.tobytes(), 34962, 4)
        idx = F.astype(np.uint16 if len(V) < 65536 else np.uint32).ravel()
        iv = view(idx.tobytes(), 34963)
        qmin = q.min(0).astype(float) / 32767; qmax = q.max(0).astype(float) / 32767
        accs.append({"bufferView": pv, "componentType": 5122, "normalized": True, "count": len(V), "type": "VEC3",
                     "min": qmin.tolist(), "max": qmax.tolist()})
        accs.append({"bufferView": nv, "componentType": 5120, "normalized": True, "count": len(V), "type": "VEC3"})
        accs.append({"bufferView": cv, "componentType": 5121, "normalized": True, "count": len(V), "type": "VEC4"})
        accs.append({"bufferView": iv, "componentType": 5123 if len(V) < 65536 else 5125, "count": int(idx.size), "type": "SCALAR"})
        a0 = len(accs) - 4
        meshes.append({"name": pname, "primitives": [{"attributes": {"POSITION": a0, "NORMAL": a0 + 1, "COLOR_0": a0 + 2}, "indices": a0 + 3}]})
        nodes.append({"name": pname, "mesh": len(meshes) - 1, "translation": t.tolist(), "scale": [s, s, s]})
        children.append(len(nodes))  # index after the root is inserted at 0
    root = {"name": name, "children": children, "rotation": root_rotation}
    g = {"asset": {"version": "2.0", "generator": "build123d + models/garments.py + models/drape.py"},
         "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
         "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [root] + nodes, "meshes": meshes,
         "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(out)}]}
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out.extend(b"\0" * (-len(out) % 4))
    glb = struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(out))
    glb += struct.pack("<II", len(js), 0x4E4F534A) + js
    glb += struct.pack("<II", len(out), 0x004E4942) + bytes(out)
    open(path, "wb").write(glb)


# ------------------------------------------------------------------ mesh helpers
def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def weld(V, N, F, tol=0.02):
    key = np.round(V / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    F2 = inv[F]
    keep = (F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 2] != F2[:, 0])
    return V[first], unit(N[first]), F2[keep]


def refine(V, N, F, L, max_pass=12):
    """Split every edge longer than L (mm, or a function of position) at its
    midpoint, curving the midpoint onto the surface from the end normals
    (keeps silhouettes round)."""
    Lf = L if callable(L) else (lambda P: L)
    Vc, Nc = V, N
    for _ in range(max_pass):
        E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        Es = np.sort(E, axis=1)
        uniq, inv = np.unique(Es, axis=0, return_inverse=True)
        inv = inv.ravel()
        p0, p1 = Vc[uniq[:, 0]], Vc[uniq[:, 1]]
        n0, n1 = Nc[uniq[:, 0]], Nc[uniq[:, 1]]
        d = p1 - p0
        long_ = np.linalg.norm(d, axis=1) > Lf((p0 + p1) / 2)
        if not long_.any():
            break
        smooth = (n0 * n1).sum(1) > 0.6
        nm = unit(n0 + n1)
        bulge = (d * (n1 - n0)).sum(1) / 8.0
        mid = (p0 + p1) / 2 + np.where(smooth, bulge, 0)[:, None] * nm
        nm = np.where(smooth[:, None], nm, n0)
        new_id = -np.ones(len(uniq), np.int64)
        sel = np.nonzero(long_)[0]
        new_id[sel] = len(Vc) + np.arange(len(sel))
        Vc = np.concatenate([Vc, mid[sel]]); Nc = np.concatenate([Nc, nm[sel]])
        nf = len(F)
        m = new_id[inv].reshape(3, nf).T          # midpoint id per face edge (e01, e12, e20) or -1
        out = []
        cnt = (m >= 0).sum(1)
        out.append(F[cnt == 0])
        # rotate faces so the split pattern is canonical
        for c in (1, 2, 3):
            idx = np.nonzero(cnt == c)[0]
            if not len(idx):
                continue
            f = F[idx]; mm = m[idx]
            if c == 3:
                a, b, cc = f.T; ab, bc, ca = mm.T
                out += [np.stack([a, ab, ca], 1), np.stack([ab, b, bc], 1), np.stack([ca, bc, cc], 1), np.stack([ab, bc, ca], 1)]
                continue
            for r in range(3):
                fr = np.roll(f, -r, axis=1); mr = np.roll(mm, -r, axis=1)
                if c == 1:
                    ok = mr[:, 0] >= 0
                    a, b, cc = fr[ok].T; ab = mr[ok, 0]
                    out += [np.stack([a, ab, cc], 1), np.stack([ab, b, cc], 1)]
                else:
                    ok = (mr[:, 0] >= 0) & (mr[:, 1] >= 0)
                    a, b, cc = fr[ok].T; ab, bc = mr[ok, 0], mr[ok, 1]
                    out += [np.stack([ab, b, bc], 1), np.stack([a, ab, bc], 1), np.stack([a, bc, cc], 1)]
        F = np.concatenate(out)
    return Vc, Nc, F


def vertex_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    return unit(N), fn


def auto_smooth(V, F, angle=62.0):
    """Per-corner normals averaged over faces within `angle`, then split
    vertices only where the normals really differ (crisp rims, smooth fabric)."""
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fu = unit(fn)
    C = F.ravel(); cf = np.repeat(np.arange(len(F)), 3)
    order = np.argsort(C, kind="stable")
    deg = np.bincount(C, minlength=len(V))
    start = np.concatenate([[0], np.cumsum(deg)[:-1]])
    inc = cf[order]
    rep = deg[C]
    pc = np.repeat(np.arange(len(C)), rep)
    local = np.arange(rep.sum()) - np.repeat(np.cumsum(rep) - rep, rep)
    pg = inc[start[C[pc]] + local]
    ok = (fu[cf[pc]] * fu[pg]).sum(1) > math.cos(math.radians(angle))
    cn = np.zeros((len(C), 3))
    np.add.at(cn, pc[ok], fn[pg[ok]])
    cn = unit(cn)
    key = np.concatenate([C[:, None], np.round(cn * 64).astype(np.int64)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return V[C[first]], cn[first], inv.ravel().reshape(-1, 3)


# ------------------------------------------------------------------ noise
def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return ((h & 0xFFFF) / 32767.5) - 1.0


def vnoise(P, scale, seed=1):
    p = P / scale
    i = np.floor(p).astype(np.int64)
    f = p - i
    u = f * f * (3 - 2 * f)
    acc = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                acc = acc + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return acc


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ ambient occlusion
def bake_ao(parts, rays=40, reach=260.0, strength=1.05, floor=0.42):
    import trimesh
    Vall = np.concatenate([p["V"] for p in parts])
    offs = np.cumsum([0] + [len(p["V"]) for p in parts])
    Fall = np.concatenate([p["F"] + o for p, o in zip(parts, offs[:-1])])
    mesh = trimesh.Trimesh(Vall, Fall, process=False)
    rng = np.random.default_rng(7)
    for p in parts:
        V, N = p["V"], p["N"]
        n = len(V)
        # cosine-weighted hemisphere around each normal
        u1 = rng.random((n, rays)); u2 = rng.random((n, rays))
        r = np.sqrt(u1); th = 2 * np.pi * u2
        lx, ly, lz = r * np.cos(th), r * np.sin(th), np.sqrt(1 - u1)
        a = np.where(np.abs(N[:, :1]) < 0.9, np.array([[1.0, 0, 0]]), np.array([[0, 1.0, 0]]))
        t1 = unit(np.cross(N, a)); t2 = np.cross(N, t1)
        D = lx[..., None] * t1[:, None] + ly[..., None] * t2[:, None] + lz[..., None] * N[:, None]
        O = np.repeat(V + N * 0.6, rays, axis=0)
        D = D.reshape(-1, 3)
        loc, ri, _ = mesh.ray.intersects_location(O, D, multiple_hits=False)
        occ = np.zeros(len(O))
        dist = np.linalg.norm(loc - O[ri], axis=1)
        occ[ri] = np.clip(1 - dist / reach, 0, 1) ** 0.7
        o = occ.reshape(n, rays).mean(1)
        p["ao"] = np.clip(1 - strength * o, floor, 1)


# ------------------------------------------------------------------ the pipeline
def relax(d, F, n, passes=3):
    """Smooth a per-vertex displacement over the mesh (removes the jaggies an
    uneven triangle layout gives a sampled fold pattern)."""
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    E = np.concatenate([E, E[:, ::-1]])
    deg = np.bincount(E[:, 0], minlength=n).astype(float)
    for _ in range(passes):
        acc = np.bincount(E[:, 0], weights=d[E[:, 1]], minlength=n)
        d = 0.5 * d + 0.5 * acc / np.maximum(deg, 1)
    return d


def cull_hidden(parts, margin=1.0):
    """Drop triangles buried inside another part (sleeve roots inside the
    body, the top of the hem band under the body...): never seen, only cost."""
    import trimesh
    meshes = [trimesh.Trimesh(p["V"], p["F"], process=False) for p in parts]
    for i, p in enumerate(parts):
        inside = np.zeros(len(p["V"]), bool)
        for j, m in enumerate(meshes):
            if i == j or not m.is_watertight:
                continue
            probe = p["V"] + p["Nn"] * margin
            inside |= m.ray.contains_points(probe)
        keep = ~inside[p["F"]].all(1)
        p["F"] = p["F"][keep]


def finish(path, name, rules):
    """rules: part name -> dict(L=edge length mm or f(P), drape=f(V, N) -> mm)."""
    raw, root = read_glb(path)
    parts = []
    for pname, (V, N, F) in raw.items():
        r = rules.get(pname, {})
        V, N, F = weld(V, N, F)
        V, N, F = refine(V, N, F, r.get("L", 14.0))
        Nn, _ = vertex_normals(V, F)
        if "drape" in r:
            V = V + Nn * relax(r["drape"](V, Nn), F, len(V))[:, None]
            Nn, _ = vertex_normals(V, F)
        parts.append({"name": pname, "V": V, "F": F, "Nn": Nn})
    cull_hidden(parts)
    for p in parts:
        used = np.unique(p["F"])
        remap = -np.ones(len(p["V"]), np.int64); remap[used] = np.arange(len(used))
        Vs, Ns, Fs = auto_smooth(p["V"][used], remap[p["F"]])
        p.update(V=Vs, N=Ns, F=Fs)
    bake_ao(parts)
    write_glb(path, name, root.get("rotation", [-0.7071067811865476, 0, 0, 0.7071067811865476]),
              [(p["name"], p["V"], p["N"], p["F"], p["ao"]) for p in parts])
    tris = sum(len(p["F"]) for p in parts)
    return tris
