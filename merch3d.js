/* Chạm HQ - the Merch tab's 3D view of the CHẠM handprint set.

   One hoodie and one T-shirt you can drag round, in each of the six
   colourways from the handprint sheet. Every detail of the real shirts -
   the ISHCMC crest, the flower or smiling sun, the five baby outfits on the
   clothesline, the sleeve ribbons and Vietnam flag, and the painted
   handprints, bee and CHAM lettering on the back - is packed into
   merch3d.webp and wrapped onto a contour-snapped, sculpted 3D garment mesh.
   three.js is fetched from a CDN the first time the section scrolls into
   view, the same way live.js fetches Firebase. */
(function () {
  "use strict";

  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";
  const ATLAS_URL = "merch3d.webp?v=85";
  let threeP = null, atlasP = null;
  const loadThree = () => threeP || (threeP = import(THREE_URL));
  const loadAtlas = () => atlasP || (atlasP = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the 3D textures"));
    img.src = ATLAS_URL;
  }));

  const COL = {
    cream: ["Cream / off-white", "#efe9da", 0],
    white: ["White", "#f7f6f2", 0],
    navy: ["Navy", "#232e4a", 1],
    forest: ["Forest green", "#2f4b36", 2],
    pink: ["Pink", "#f0c4ce", 3],
    charcoal: ["Charcoal / black", "#29292c", 4],
    blue: ["Light blue", "#bad1ec", 5]
  };
  const PIECES = [
    { kind: "hoodie", title: "Hoodie", w: 400, h: 448, yFront: 0, yBack: 448, yMask: 0, colours: ["cream", "navy", "forest", "pink", "charcoal", "blue"] },
    { kind: "tee", title: "T-shirt", w: 400, h: 388, yFront: 896, yBack: 1284, yMask: 448, colours: ["white", "navy", "forest", "pink", "charcoal", "blue"] }
  ];

  function cropCanvas(img, x, y, w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
    return c;
  }

  // ---------- the sculpted, contour-snapped 3D garment ----------
  const STEP = 2;

  function buildPieceGeometry(THREE, maskCanvas, piece) {
    const W = piece.w, H = piece.h;
    const GW = Math.round(W / STEP) + 1, GH = Math.round(H / STEP) + 1;
    const mdata = maskCanvas.getContext("2d").getImageData(0, 0, W, H).data;

    // Sample the symmetric silhouette mask onto the grid, then smooth it so
    // the 0.5 iso-contour is a silky curve with no pixel stair-steps.
    let f = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = Math.min(W - 1, Math.round(i / (GW - 1) * (W - 1)));
      const y = Math.min(H - 1, Math.round(j / (GH - 1) * (H - 1)));
      f[j * GW + i] = mdata[(y * W + x) * 4] / 255;
    }
    for (let pass = 0; pass < 3; pass++) {
      const nf = new Float32Array(f.length);
      for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
        const k = j * GW + i;
        nf[k] = (f[k] * 4 + f[k - 1] + f[k + 1] + f[k - GW] + f[k + GW]) / 8;
      }
      f = nf;
    }

    const inside = new Uint8Array(GW * GH);
    for (let k = 0; k < f.length; k++) inside[k] = f[k] >= 0.5 ? 1 : 0;

    // Chamfer distance to the outside, for the rounded 3D cushion profile
    const BIG = 1e9, d = new Float32Array(GW * GH);
    for (let k = 0; k < d.length; k++) d[k] = inside[k] ? BIG : 0;
    const relax = (k, n, w) => { if (d[n] + w < d[k]) d[k] = d[n] + w; };
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      if (!d[k]) continue;
      if (i > 0) relax(k, k - 1, 1);
      if (j > 0) { relax(k, k - GW, 1); if (i > 0) relax(k, k - GW - 1, 1.414); if (i < GW - 1) relax(k, k - GW + 1, 1.414); }
    }
    for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) {
      const k = j * GW + i;
      if (!d[k]) continue;
      if (i < GW - 1) relax(k, k + 1, 1);
      if (j < GH - 1) { relax(k, k + GW, 1); if (i < GW - 1) relax(k, k + GW + 1, 1.414); if (i > 0) relax(k, k + GW - 1, 1.414); }
    }

    // Snap any vertex next to the silhouette directly onto the f = 0.5 curve
    // so the outer triangles follow a smooth outline instead of grid stairs.
    const gx = new Float32Array(GW * GH), gy = new Float32Array(GW * GH);
    const active = new Uint8Array(GW * GH), isRim = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      gx[k] = i * STEP;
      gy[k] = j * STEP;
      if (inside[k]) active[k] = 1;
    }
    for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      const hasIn = inside[k] || inside[k - 1] || inside[k + 1] || inside[k - GW] || inside[k + GW]
        || inside[k - GW - 1] || inside[k - GW + 1] || inside[k + GW - 1] || inside[k + GW + 1];
      const hasOut = !inside[k] || !inside[k - 1] || !inside[k + 1] || !inside[k - GW] || !inside[k + GW];
      if (!inside[k] && hasIn && hasOut) {
        active[k] = 1;
        isRim[k] = 1;
        const dfx = (f[k + 1] - f[k - 1]) * 0.5;
        const dfy = (f[k + GW] - f[k - GW]) * 0.5;
        const len2 = dfx * dfx + dfy * dfy;
        if (len2 > 1e-5) {
          const step = Math.max(-0.85, Math.min(0.85, (0.5 - f[k]) / len2));
          gx[k] += step * dfx * STEP;
          gy[k] += step * dfy * STEP;
        }
      } else if (inside[k] && hasOut) {
        const dfx = (f[k + 1] - f[k - 1]) * 0.5;
        const dfy = (f[k + GW] - f[k - GW]) * 0.5;
        const len2 = dfx * dfx + dfy * dfy;
        if (len2 > 1e-5 && f[k] < 0.68) {
          isRim[k] = 1;
          const step = Math.max(-0.65, Math.min(0.65, (0.5 - f[k]) / len2));
          gx[k] += step * dfx * STEP;
          gy[k] += step * dfy * STEP;
        }
      }
    }

    for (let pass = 0; pass < 6; pass++) {
      const nx = new Float32Array(gx), ny = new Float32Array(gy);
      for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
        const k = j * GW + i;
        if (!active[k] || isRim[k]) continue;
        if (!active[k - 1] || !active[k + 1] || !active[k - GW] || !active[k + GW]) continue;
        nx[k] = (gx[k] * 2 + gx[k - 1] + gx[k + 1] + gx[k - GW] + gx[k + GW]) / 6;
        ny[k] = (gy[k] * 2 + gy[k - 1] + gy[k + 1] + gy[k - GW] + gy[k + GW]) / 6;
      }
      gx.set(nx); gy.set(ny);
    }

    // Smooth the distance field before taking the cushion curve so steep
    // diagonal sleeve edges have no grid ripples in their surface normals.
    let sd = d;
    for (let pass = 0; pass < 10; pass++) {
      const nd = new Float32Array(sd.length);
      for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
        const k = j * GW + i;
        if (!active[k] || isRim[k]) continue;
        nd[k] = (sd[k] * 4 + sd[k - 1] + sd[k + 1] + sd[k - GW] + sd[k + GW]) / 8;
      }
      sd = nd;
    }

    // Base cushion depth + subtle 3D creases for sleeves, hood, collar and cuffs
    const R = 16, DEPTH = 6, CURVE = 10;   // a gentle drape, not a cushion: thin at the edges, a soft curve across the body
    let baseZ = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      if (!active[k] || isRim[k]) continue;
      const t = Math.min(sd[k] * STEP / R, 1);
      const ux = (gx[k] - W / 2) / (W / 2), uy = gy[k] / H;
      let z = DEPTH * Math.pow(t, 0.58) + CURVE * t * Math.max(0, 1 - ux * ux);

      if (piece.kind === "hoodie") {
        // Vertical 3D crease where the drop-shoulder sleeves meet the torso
        if (uy > 0.30 && uy < 0.90) {
          const seamX = 0.44 + (uy - 0.30) * 0.08;
          const ds = Math.abs(Math.abs(ux) - seamX);
          if (ds < 0.09) {
            const w = 0.5 * (1 + Math.cos(Math.PI * ds / 0.09));
            z *= 1 - 0.12 * w;
          }
        }
        // Subtle gather and step at the ribbed waistband
        if (uy > 0.84 && Math.abs(ux) < 0.48) {
          const band = Math.min(1, (uy - 0.84) / 0.04);
          z *= 1 - 0.14 * band;
        }
      } else {
        // T-shirt armhole seam crease
        if (uy > 0.12 && uy < 0.48) {
          const seamX = 0.44 + (uy - 0.12) * 0.22;
          const ds = Math.abs(Math.abs(ux) - seamX);
          if (ds < 0.08) {
            const w = 0.5 * (1 + Math.cos(Math.PI * ds / 0.08));
            z *= 1 - 0.08 * w;
          }
        }
      }
      baseZ[k] = z;
    }

    for (let pass = 0; pass < 10; pass++) {
      const nz = new Float32Array(baseZ.length);
      for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
        const k = j * GW + i;
        if (!active[k] || isRim[k]) continue;
        nz[k] = (baseZ[k] * 4 + baseZ[k - 1] + baseZ[k + 1] + baseZ[k - GW] + baseZ[k + GW]) / 8;
      }
      baseZ = nz;
    }

    function sideGeo(facing) {
      const pos = new Float32Array(GW * GH * 3), uv = new Float32Array(GW * GH * 2);
      const S = 1 / 96;
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        const k = j * GW + i;
        const ux = (gx[k] - W / 2) / (W / 2), uy = gy[k] / H;
        let z = baseZ[k];
        if (!isRim[k] && z > 0) {
          if (piece.kind === "hoodie") {
            if (facing > 0 && uy < 0.19) {
              // Front hood opening recesses inward; crossover flaps puff forward
              const cavityW = 0.28 * (1 - uy / 0.19);
              if (Math.abs(ux) < cavityW) {
                const cw = Math.cos(Math.PI * 0.5 * Math.abs(ux) / Math.max(0.01, cavityW));
                z *= 1 - 0.52 * cw;
              } else if (Math.abs(ux) < 0.44) {
                z *= 1.12;
              }
            } else if (facing < 0 && uy < 0.27 && Math.abs(ux) < 0.44) {
              // Back hood pouch bulges softly outward
              const hw = Math.cos(Math.PI * 0.5 * Math.min(1, Math.abs(ux) / 0.44)) * Math.sin(Math.PI * Math.min(1, uy / 0.27));
              z += 5.5 * hw;
            }
          } else if (facing > 0 && uy < 0.15 && Math.abs(ux) < 0.27) {
            // T-shirt front crew-neck opening recesses slightly
            const nr = Math.sqrt((ux / 0.26) * (ux / 0.26) + ((uy - 0.03) / 0.11) * ((uy - 0.03) / 0.11));
            if (nr < 1) z *= 0.55 + 0.45 * nr * nr;
          }
        }
        pos[k * 3] = (gx[k] - W / 2) * S;
        pos[k * 3 + 1] = (H / 2 - gy[k]) * S;
        pos[k * 3 + 2] = z * S * facing;
        const u = gx[k] / W, v = 1 - gy[k] / H;
        uv[k * 2] = facing > 0 ? u : 1 - u;
        uv[k * 2 + 1] = v;
      }

      const idx = [];
      for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
        const a = j * GW + i, b = a + GW, c = a + 1, d0 = b + 1;
        if (active[a] && active[b] && active[c] && !(isRim[a] && isRim[b] && isRim[c])) {
          if (facing > 0) idx.push(a, b, c); else idx.push(a, c, b);
        }
        if (active[b] && active[d0] && active[c] && !(isRim[b] && isRim[d0] && isRim[c])) {
          if (facing > 0) idx.push(b, d0, c); else idx.push(b, c, d0);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const nrm = geo.getAttribute("normal").array;
      for (let pass = 0; pass < 3; pass++) {
        const nn = new Float32Array(nrm.length);
        for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
          const k = j * GW + i;
          if (!active[k]) continue;
          const k3 = k * 3, l3 = (k - 1) * 3, r3 = (k + 1) * 3, u3 = (k - GW) * 3, d3 = (k + GW) * 3;
          let nx = nrm[k3] * 4 + nrm[l3] + nrm[r3] + nrm[u3] + nrm[d3];
          let ny = nrm[k3 + 1] * 4 + nrm[l3 + 1] + nrm[r3 + 1] + nrm[u3 + 1] + nrm[d3 + 1];
          let nz = nrm[k3 + 2] * 4 + nrm[l3 + 2] + nrm[r3 + 2] + nrm[u3 + 2] + nrm[d3 + 2];
          const len = Math.hypot(nx, ny, nz) || 1;
          nn[k3] = nx / len; nn[k3 + 1] = ny / len; nn[k3 + 2] = nz / len;
        }
        nrm.set(nn);
      }
      return geo;
    }

    return { frontGeo: sideGeo(1), backGeo: sideGeo(-1) };
  }

  function shadowTexture(THREE) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,.28)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  // ---------- one viewer ----------
  function viewer(piece) {
    const stage = document.createElement("div");
    stage.className = "m3d-stage";
    const msg = document.createElement("div");
    msg.className = "m3d-msg";
    msg.textContent = "Loading the 3D view…";
    const hint = document.createElement("span");
    hint.className = "m3d-hint";
    hint.textContent = "Drag to turn it";
    stage.append(msg, hint);

    const state = { colour: piece.colours[0], rotY: -0.38, rotX: 0.05, vel: 0, target: null, idleAt: 0, dragging: false };
    let api = null;

    async function start() {
      const [THREE, atlas] = await Promise.all([loadThree(), loadAtlas()]);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(0, 0.08, 11.2);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c5, 2.2));
      const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(3, 4, 7); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 0.85); rim.position.set(-4, 2, -6); scene.add(rim);

      const maskCanvas = cropCanvas(atlas, 6 * 400, piece.yMask, piece.w, piece.h);
      const { frontGeo, backGeo } = buildPieceGeometry(THREE, maskCanvas, piece);

      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const tileTex = (colour, isBack) => {
        const colIdx = COL[colour][2];
        const c = cropCanvas(atlas, colIdx * 400, isBack ? piece.yBack : piece.yFront, piece.w, piece.h);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = maxAniso;
        return t;
      };
      const mat = (colour, isBack) => new THREE.MeshStandardMaterial({
        map: tileTex(colour, isBack),
        roughness: 0.92,
        metalness: 0,
        side: THREE.FrontSide
      });

      const frontMesh = new THREE.Mesh(frontGeo, mat(state.colour, false));
      const backMesh = new THREE.Mesh(backGeo, mat(state.colour, true));
      const model = new THREE.Group();
      model.add(frontMesh, backMesh);
      model.position.y = 0.08;
      scene.add(model);

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(4.5, 1.05),
        new THREE.MeshBasicMaterial({ map: shadowTexture(THREE), transparent: true, depthWrite: false })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -2.42;
      scene.add(shadow);

      msg.remove();
      stage.prepend(renderer.domElement);

      const fit = () => {
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      new ResizeObserver(fit).observe(stage);
      fit();

      let running = false, last = 0;
      const frame = (now) => {
        if (!running) return;
        const dt = Math.min(0.05, (now - (last || now)) / 1000);
        last = now;
        if (state.target !== null) {
          const diff = state.target - state.rotY;
          state.rotY += diff * Math.min(1, dt * 7);
          if (Math.abs(diff) < 0.002) { state.rotY = state.target; state.target = null; state.idleAt = now + 4000; }
        } else if (!state.dragging) {
          state.rotY += state.vel;
          state.vel *= 0.92;
          if (Math.abs(state.vel) < 0.0005 && now > state.idleAt) state.rotY += dt * 0.35;
          state.rotX += (0.05 - state.rotX) * Math.min(1, dt * 2);
        }
        model.rotation.set(state.rotX, state.rotY, 0);
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
      };
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !running) { running = true; last = 0; requestAnimationFrame(frame); }
        else if (!e.isIntersecting) running = false;
      }).observe(stage);

      api = {
        recolour(colour) {
          [[frontMesh, false], [backMesh, true]].forEach(([m, isBack]) => {
            const old = m.material.map;
            m.material.map = tileTex(colour, isBack);
            m.material.needsUpdate = true;
            old.dispose();
          });
        }
      };
    }

    // dragging
    let px = 0, py = 0, lastDx = 0;
    stage.addEventListener("pointerdown", (e) => {
      state.dragging = true; state.target = null; px = e.clientX; py = e.clientY; lastDx = 0;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;
      state.rotY += dx * 0.012;
      if (e.pointerType === "mouse") state.rotX = Math.max(-0.5, Math.min(0.5, state.rotX + dy * 0.006));
      lastDx = dx;
    });
    const release = () => {
      if (!state.dragging) return;
      state.dragging = false;
      state.vel = lastDx * 0.012;
      state.idleAt = performance.now() + 4000;
    };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);

    function face(back) {
      const want = back ? Math.PI : 0;
      if (!api) { state.rotY = want - 0.38; state.target = null; return; }
      const turns = Math.round((state.rotY - want) / (2 * Math.PI));
      state.target = want + turns * 2 * Math.PI;
      state.vel = 0;
    }

    function setColour(colour) {
      state.colour = colour;
      if (api) api.recolour(colour);
    }

    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      start().catch(() => {
        msg.textContent = "The 3D view couldn’t load here. It needs an internet connection and a browser that can show 3D (WebGL).";
      });
    }, { rootMargin: "200px" });
    io.observe(stage);

    return { stage, face, setColour, state };
  }

  // ---------- the section on the Merch tab ----------
  function button(cls, text, attrs, onclick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = text;
    Object.entries(attrs || {}).forEach(([k, v]) => b.setAttribute(k, v));
    b.addEventListener("click", onclick);
    return b;
  }

  function card(piece) {
    const v = viewer(piece);
    const fig = document.createElement("figure");
    fig.className = "pcard mcard m3d";

    const head = document.createElement("div");
    head.className = "mhead";
    const name = document.createElement("b");
    name.textContent = piece.title;
    const colourName = document.createElement("span");
    colourName.className = "mkind";
    colourName.textContent = COL[piece.colours[0]][0];
    const sides = document.createElement("div");
    sides.className = "m3d-sides";
    const fb = button("chipbtn plain", "Front", { "aria-pressed": "true" }, () => pick(false));
    const bb = button("chipbtn plain", "Back", { "aria-pressed": "false" }, () => pick(true));
    function pick(back) {
      v.face(back);
      fb.setAttribute("aria-pressed", String(!back));
      bb.setAttribute("aria-pressed", String(back));
    }
    sides.append(fb, bb);
    head.append(name, colourName, sides);

    const sw = document.createElement("div");
    sw.className = "swatches";
    sw.setAttribute("role", "group");
    sw.setAttribute("aria-label", piece.title + " colour");
    piece.colours.forEach((c, i) => {
      const b = button("sw", "", { title: COL[c][0], "aria-label": COL[c][0], "aria-pressed": String(i === 0), style: "background:" + COL[c][1] }, () => {
        sw.querySelectorAll(".sw").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        colourName.textContent = COL[c][0];
        v.setColour(c);
      });
      sw.appendChild(b);
    });

    const foot = document.createElement("div");
    foot.className = "mfoot";
    foot.append(head, sw);
    fig.append(v.stage, foot);
    return fig;
  }

  let SECTION = null;
  function section() {
    if (SECTION) return SECTION;
    const wrap = document.createElement("div");
    wrap.className = "m3d-section";
    const h = document.createElement("h3");
    h.className = "grp";
    const hs = document.createElement("span");
    hs.textContent = "In 3D";
    h.appendChild(hs);
    const p = document.createElement("p");
    p.className = "merch-about";
    p.textContent = "The CHAM handprint set as 3D models. Drag one to turn it, tap Front or Back, and tap a colour to try the other colourways.";
    const wall = document.createElement("div");
    wall.className = "m3d-wall";
    PIECES.forEach((piece) => wall.appendChild(card(piece)));
    wrap.append(h, p, wall);
    SECTION = wrap;
    return wrap;
  }

  window.ChamMerch3D = { section };
})();
