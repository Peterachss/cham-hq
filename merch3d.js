/* Chạm HQ - the Merch tab's 3D view of the CHẠM handprint set.

   One hoodie and one T-shirt you can drag round, in each of the six
   colourways. Nothing here is a downloaded 3D model: the garment outline
   from merch.js is drawn flat with the print on it, then "inflated" like a
   cushion - each point is pushed out by how far it is from the edge - and
   the flat drawing is wrapped onto the front and back. three.js is fetched
   from a CDN the first time the section scrolls into view, the same way
   live.js fetches Firebase. */
(function () {
  "use strict";

  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";
  let threeP = null;
  const loadThree = () => threeP || (threeP = import(THREE_URL));

  const COL = {
    cream: ["Cream / off-white", "#efe9da"], white: ["White", "#f7f6f2"], navy: ["Navy", "#232e4a"],
    forest: ["Forest green", "#2f4b36"], pink: ["Pink", "#f0c4ce"], charcoal: ["Charcoal / black", "#29292c"],
    blue: ["Light blue", "#bad1ec"]
  };
  const DARK = new Set(["navy", "forest", "charcoal"]);
  const PIECES = [
    { kind: "hoodie", title: "Hoodie", colours: ["cream", "navy", "forest", "pink", "charcoal", "blue"] },
    { kind: "tee", title: "T-shirt", colours: ["white", "navy", "forest", "pink", "charcoal", "blue"] }
  ];

  // ---------- the print, drawn in the garment's 400 x 460 box ----------
  const PAINT = { green: "#79c25a", pink: "#f28db0", blue: "#56a5e2", yellow: "#f6c945", lilac: "#c3a8e6", mint: "#9ad6a4" };

  // A painted handprint: palm, four fingers and a thumb, pointing up before it is turned.
  function hand(x, y, rot, s, colour) {
    const fingers = [[-15, -16, -27, -50], [-5, -20, -9, -61], [6, -20, 8, -62], [15, -16, 25, -50]]
      .map(([x1, y1, x2, y2]) => `M${x1},${y1} L${x2},${y2}`).join(" ");
    return `<g transform="translate(${x},${y}) rotate(${rot}) scale(${s})" fill="${colour}" stroke="${colour}" filter="url(#paint)" opacity=".95">
        <ellipse cx="0" cy="0" rx="19" ry="22"/>
        <path d="${fingers}" fill="none" stroke-width="9" stroke-linecap="round"/>
        <path d="M-15,6 L-38,-8" fill="none" stroke-width="10" stroke-linecap="round"/>
      </g>`;
  }

  function bee(x, y, s) {
    return `<g transform="translate(${x},${y}) scale(${s})">
        <ellipse cx="-3" cy="-9" rx="6" ry="8" fill="#fff" stroke="#333" stroke-width="1" opacity=".9" transform="rotate(-25 -3 -9)"/>
        <ellipse cx="5" cy="-9" rx="6" ry="8" fill="#fff" stroke="#333" stroke-width="1" opacity=".9" transform="rotate(25 5 -9)"/>
        <ellipse cx="0" cy="0" rx="12" ry="8" fill="${PAINT.yellow}" stroke="#222" stroke-width="1.2"/>
        <path d="M-4,-7.5 L-4,7.5 M2,-8 L2,8" stroke="#222" stroke-width="3"/>
        <circle cx="9" cy="-1.5" r="1.3" fill="#222"/>
      </g>`;
  }

  function flower(x, y, s) {
    const petals = [0, 72, 144, 216, 288].map((a) => {
      const r = a * Math.PI / 180;
      return `<circle cx="${(Math.sin(r) * 6).toFixed(2)}" cy="${(-Math.cos(r) * 6).toFixed(2)}" r="5.2"/>`;
    }).join("");
    return `<g transform="translate(${x},${y}) scale(${s})"><g fill="${PAINT.pink}" stroke="#d9668e" stroke-width=".8">${petals}</g>
      <circle r="3.6" fill="${PAINT.yellow}"/></g>`;
  }

  function sun(x, y, s) {
    const rays = Array.from({ length: 10 }, (_, i) => {
      const r = i * Math.PI / 5;
      return `M${(Math.cos(r) * 10).toFixed(2)},${(Math.sin(r) * 10).toFixed(2)} L${(Math.cos(r) * 14).toFixed(2)},${(Math.sin(r) * 14).toFixed(2)}`;
    }).join(" ");
    return `<g transform="translate(${x},${y}) scale(${s})">
        <path d="${rays}" stroke="#f0a92a" stroke-width="2.2" stroke-linecap="round"/>
        <circle r="8.5" fill="${PAINT.yellow}" stroke="#f0a92a" stroke-width="1"/>
        <circle cx="-3" cy="-1.5" r="1" fill="#8a5300"/><circle cx="3" cy="-1.5" r="1" fill="#8a5300"/>
        <path d="M-3.2,2.4 Q0,5 3.2,2.4" fill="none" stroke="#8a5300" stroke-width="1"/>
      </g>`;
  }

  // The school badge on the chest: a little round crest.
  function badge(x, y, s) {
    return `<g transform="translate(${x},${y}) scale(${s})">
        <circle r="13" fill="#fff" stroke="#5f86b3" stroke-width="1.4"/>
        <path d="M-9,4 L-4,-3 L-1,1 L3,-5 L9,4 Z" fill="#5f86b3"/>
        <path d="M-9,7 L9,7" stroke="#5f86b3" stroke-width="1.2"/>
        <path d="M-7,-7 Q0,-11 7,-7" fill="none" stroke="#5f86b3" stroke-width="1"/>
      </g>`;
  }

  // Vietnam's flag, as a sleeve patch.
  function flag(x, y, rot, s) {
    const star = Array.from({ length: 10 }, (_, i) => {
      const r = (i * 36 - 90) * Math.PI / 180, d = i % 2 ? 2.4 : 6;
      return `${(Math.cos(r) * d).toFixed(2)},${(Math.sin(r) * d).toFixed(2)}`;
    }).join(" ");
    return `<g transform="translate(${x},${y}) rotate(${rot}) scale(${s})">
        <rect x="-13" y="-9" width="26" height="18" rx="1.5" fill="#da251d"/>
        <polygon points="${star}" fill="#ffdd00"/>
      </g>`;
  }

  // The clothesline of little outfits across the chest.
  function clothesline(x0, x1, y, sag, ink) {
    const L = window.ChamMerch.LITTLE;
    const hung = [["tee", PAINT.pink], ["shorts", PAINT.blue], ["onesie", PAINT.yellow], ["dress", PAINT.mint], ["onesie", PAINT.lilac], ["sock", PAINT.pink]];
    const mid = (x0 + x1) / 2;
    const at = (t) => {          // a point on the sagging line
      const x = x0 + (x1 - x0) * t;
      return [x, y + sag * 4 * t * (1 - t)];
    };
    const clothes = hung.map(([k, c], i) => {
      const t = (i + 0.5) / hung.length;
      const [x, yy] = at(t);
      const tilt = (t - 0.5) * 18;
      return `<g transform="translate(${x.toFixed(1)},${(yy - 1).toFixed(1)}) rotate(${tilt.toFixed(1)}) scale(.82)">
          <path d="${L[k]}" fill="${c}" stroke="${ink}" stroke-opacity=".45" stroke-width="1.1" stroke-linejoin="round"/>
          <path d="M-4,-3 L-4,3 M4,-3 L4,3" stroke="${ink}" stroke-opacity=".6" stroke-width="1.5" stroke-linecap="round"/>
        </g>`;
    }).join("");
    return `<path d="M${x0},${y} Q${mid},${y + sag * 2} ${x1},${y}" fill="none" stroke="${ink}" stroke-opacity=".6" stroke-width="1.1"/>${clothes}`;
  }

  // The back: CHAM over the four painted handprints, with the motto underneath.
  function backPrint(ink) {
    return `${hand(-36, -38, -22, 1, PAINT.green)}
      ${hand(30, -52, 14, 0.62, PAINT.yellow)}
      ${hand(-40, 40, 200, 0.82, PAINT.pink)}
      ${hand(44, 40, 24, 1, PAINT.blue)}
      ${bee(58, -78, 1)}
      <text x="0" y="14" text-anchor="middle" font-family="'Arial Black', 'Helvetica Neue', Arial, sans-serif" font-weight="900"
        font-size="42" letter-spacing="1" fill="${ink}" stroke="${ink === "#fff" ? "#1d1d1f" : "#fff"}" stroke-width="1.2" paint-order="stroke">CHAM</text>
      <g font-family="Arial, Helvetica, sans-serif" font-size="7" font-weight="700" letter-spacing="1.2" text-anchor="middle" fill="${ink}">
        <text x="0" y="112">CHANGING LIVES THROUGH</text><text x="0" y="122">COMPASSION</text>
      </g>`;
  }

  function printFor(kind, side, ink) {
    if (kind === "hoodie") {
      return side === "front"
        ? `${badge(146, 168, 1)}${flower(254, 166, 1.1)}${clothesline(122, 278, 214, 9, ink)}`
        : `<g transform="translate(200,250) scale(.9)">${backPrint(ink)}</g>`;
    }
    return side === "front"
      ? `${badge(138, 108, 1)}${sun(262, 108, 1.1)}${clothesline(116, 284, 152, 10, ink)}${flag(350, 122, 42, 1)}`
      : `<g transform="translate(200,206) scale(.95)">${backPrint(ink)}</g>${flag(50, 122, -42, 1)}`;
  }

  /* One side of the garment as a flat picture. The other side is laid
     underneath, mirrored, so the inside of the collar shows through the
     neck hole the way it does on a real shirt. */
  function sideSVG(kind, side, colour, px) {
    const g = window.ChamMerch.garment;
    const other = side === "front" ? "back" : "front";
    const ink = DARK.has(colour) ? "#fff" : "#1d1d1f";
    const h = Math.round(px * 460 / 400);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${h}" viewBox="0 0 400 460">
      <defs>
        <filter id="paint" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="4"/>
          <feDisplacementMap in="SourceGraphic" scale="4"/>
        </filter>
        <style>.shirt{fill:${COL[colour][1]}} .g [stroke]{stroke:rgba(0,0,0,.28)}</style>
      </defs>
      <g class="g">
        <g transform="translate(400,0) scale(-1,1)">${g(kind, other)}</g>
        ${g(kind, side)}
      </g>
      ${printFor(kind, side, ink)}
    </svg>`;
  }

  function rasterize(svg) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not draw the design")); };
      img.src = url;
    });
  }

  // ---------- the inflated garment ----------
  const STEP = 2;                        // grid spacing, in the 400 x 460 drawing's units
  const GW = 400 / STEP + 1, GH = 460 / STEP + 1;

  /* How far each grid point is pushed out: rounded at the edge like a
     stuffed cushion, flatter across the middle, plus a gentle curve across
     the chest so the front isn't a flat board. */
  function heights(front, back) {
    const fa = front.getContext("2d").getImageData(0, 0, front.width, front.height).data;
    const ba = back.getContext("2d").getImageData(0, 0, back.width, back.height).data;
    const W = front.width, H = front.height;
    const inside = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = Math.min(W - 1, Math.round(i / (GW - 1) * (W - 1)));
      const y = Math.min(H - 1, Math.round(j / (GH - 1) * (H - 1)));
      const a = fa[(y * W + x) * 4 + 3], b = ba[(y * W + (W - 1 - x)) * 4 + 3];
      inside[j * GW + i] = (a > 127 || b > 127) ? 1 : 0;
    }
    // chamfer distance to the nearest point outside the garment
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
    const R = 30, DEPTH = 22, CURVE = 12;
    let z = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      if (!inside[k]) continue;
      const t = Math.min(d[k] * STEP / R, 1);
      const across = (i * STEP - 200) / 210;
      z[k] = DEPTH * Math.sqrt(1 - (1 - t) * (1 - t)) + CURVE * t * Math.max(0, 1 - across * across);
    }
    // Smooth away the chamfer's facets. Letting it spread a few points past
    // the edge rounds the rim off, so the outline doesn't step along the grid.
    for (let pass = 0; pass < 5; pass++) {
      const nz = new Float32Array(z.length);
      for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
        const k = j * GW + i;
        nz[k] = (z[k] * 4 + z[k - 1] + z[k + 1] + z[k - GW] + z[k + GW]) / 8;
      }
      z = nz;
    }
    return { z, inside };
  }

  function buildGeometry(THREE, z, inside, facing) {
    const pos = new Float32Array(GW * GH * 3), uv = new Float32Array(GW * GH * 2);
    const S = 1 / 100;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      pos[k * 3] = (i * STEP - 200) * S;
      pos[k * 3 + 1] = (230 - j * STEP) * S;
      pos[k * 3 + 2] = z[k] * S * facing;
      uv[k * 2] = facing > 0 ? i / (GW - 1) : 1 - i / (GW - 1);
      uv[k * 2 + 1] = 1 - j / (GH - 1);
    }
    // keep only the cells on or next to the garment
    const near = (i, j) => {
      for (let b = Math.max(0, j - 3); b <= Math.min(GH - 1, j + 4); b++)
        for (let a = Math.max(0, i - 3); a <= Math.min(GW - 1, i + 4); a++) if (inside[b * GW + a]) return true;
      return false;
    };
    const idx = [];
    for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
      if (!near(i, j)) continue;
      const a = j * GW + i, b = a + GW, c = a + 1, d = b + 1;
      if (facing > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  const TEX = 1024;
  async function textures(kind, colour) {
    const [front, back] = await Promise.all([rasterize(sideSVG(kind, "front", colour, TEX)), rasterize(sideSVG(kind, "back", colour, TEX))]);
    return { front, back };
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

    const state = { colour: piece.colours[0], rotY: -0.45, rotX: 0.06, vel: 0, target: null, idleAt: 0, dragging: false };
    let api = null;                      // filled once three.js has loaded

    async function start() {
      const THREE = await loadThree();
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(0, 0.15, 11.5);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8b8, 1.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 6); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 1.0); rim.position.set(-4, 2, -6); scene.add(rim);

      const { front, back } = await textures(piece.kind, state.colour);
      const { z, inside } = heights(front, back);
      const tex = (canvas) => {
        const t = new THREE.CanvasTexture(canvas);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return t;
      };
      const mat = (canvas) => new THREE.MeshStandardMaterial({ map: tex(canvas), alphaTest: 0.5, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      const frontMesh = new THREE.Mesh(buildGeometry(THREE, z, inside, 1), mat(front));
      const backMesh = new THREE.Mesh(buildGeometry(THREE, z, inside, -1), mat(back));
      const model = new THREE.Group();
      model.add(frontMesh, backMesh);
      model.position.y = 0.05;
      scene.add(model);

      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.1), new THREE.MeshBasicMaterial({ map: shadowTexture(THREE), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -2.45;
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
          if (Math.abs(state.vel) < 0.0005 && now > state.idleAt) state.rotY += dt * 0.35;   // idle: turn slowly
          state.rotX += (0.06 - state.rotX) * Math.min(1, dt * 2);
        }
        model.rotation.set(state.rotX, state.rotY, 0);
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
      };
      // only draw while it's on screen
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !running) { running = true; last = 0; requestAnimationFrame(frame); }
        else if (!e.isIntersecting) running = false;
      }).observe(stage);

      api = {
        async recolour(colour) {
          const t = await textures(piece.kind, colour);
          if (state.colour !== colour) return;           // another colour was tapped meanwhile
          [[frontMesh, t.front], [backMesh, t.back]].forEach(([m, c]) => {
            const old = m.material.map;
            m.material.map = tex(c);
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

    // turn to show the front or the back, whichever way is shorter
    function face(back) {
      const want = back ? Math.PI : 0;
      const turns = Math.round((state.rotY - want) / (2 * Math.PI));
      state.target = want + turns * 2 * Math.PI;
      state.vel = 0;
    }

    function setColour(colour) {
      state.colour = colour;
      if (api) api.recolour(colour);
    }

    // start loading three.js only when the viewer is about to be seen
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

  /* Built once and kept: the Merch tab redraws often, and making a new 3D
     view each time would run the browser out of WebGL contexts. */
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

  window.ChamMerch3D = { section, sideSVG };
})();
