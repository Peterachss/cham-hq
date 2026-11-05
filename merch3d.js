/* Chạm HQ - the Merch tab's 3D view of the CHẠM handprint set.

   One hoodie and one T-shirt you can drag round, in each of the six
   colourways from the handprint sheet. The garments are real 3D models
   (models/hoodie.glb and models/tee.glb, built in CAD by
   models/garments.py) and every detail of the real shirts - the ISHCMC
   crest, the flower or smiling sun, the five baby outfits on the
   clothesline, the sleeve ribbons and Vietnam flag, and the painted
   handprints, bee and CHAM lettering on the back - is cut out of
   merch3d.webp and printed onto the front and back of the model.
   three.js is fetched from a CDN the first time the section scrolls into
   view, the same way live.js fetches Firebase. */
(function () {
  "use strict";

  const CDN = "https://cdn.jsdelivr.net/npm/three@0.170.0";
  const THREE_URL = CDN + "/+esm";
  const GLTF_URL = CDN + "/examples/jsm/loaders/GLTFLoader.js/+esm";
  const ROOM_URL = CDN + "/examples/jsm/environments/RoomEnvironment.js/+esm";
  const ATLAS_URL = "merch3d.webp?v=88";
  let threeP = null, atlasP = null;
  const loadThree = () => threeP || (threeP = Promise.all([import(THREE_URL), import(GLTF_URL), import(ROOM_URL)])
    .then(([THREE, G, R]) => ({ THREE, GLTFLoader: G.GLTFLoader, RoomEnvironment: R.RoomEnvironment })));
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

  /* Where each print sits. src is a box in a 400px-wide artwork tile
     [x, y, w, h]; the art is placed on the model (millimetres, x across,
     y up from the hem) so that tile point `at` lands on model point `to`,
     at `mm` millimetres per artwork pixel. The back is laid out as you see
     it from behind. Sleeve prints are placed on the sleeves themselves. */
  const PIECES = [
    {
      kind: "hoodie", title: "Hoodie", model: "models/hoodie.glb?v=88",
      yFront: 0, yBack: 448, tileH: 448,
      colours: ["cream", "navy", "forest", "pink", "charcoal", "blue"],
      ribs: { hem: 200, cuff_l: 36, cuff_r: 36 },
      front: [
        { mm: 2.2, at: [200, 246], to: [0, 360], src: [[108, 121, 55, 55], [234, 109, 61, 57], [99, 210, 202, 70]] }
      ],
      back: [
        { mm: 2.0, at: [200, 365], to: [0, 104], src: [[98, 112, 202, 236], [126, 350, 148, 30]] }
      ]
    },
    {
      kind: "tee", title: "T-shirt", model: "models/tee.glb?v=88",
      yFront: 896, yBack: 1284, tileH: 388,
      colours: ["white", "navy", "forest", "pink", "charcoal", "blue"],
      ribs: { collar: 90 },
      front: [
        { mm: 2.2, at: [200, 102], to: [0, 540], src: [[102, 74, 58, 56], [228, 70, 70, 69], [94, 164, 210, 66]] },
        // ribbons, wearer's right sleeve (the charcoal sheet has none drawn, so it borrows navy's)
        { mm: 1.7, at: [46, 109], to: [-322, 492], src: [[16, 76, 60, 66]], borrow: { 4: 1 } },
        { mm: 1.7, at: [360, 93], to: [322, 492], src: [[333, 64, 54, 58]] }      // Vietnam flag, wearer's left sleeve
      ],
      back: [
        { mm: 2.1, at: [200, 336], to: [0, 96], src: [[94, 62, 206, 232], [126, 318, 148, 34]] }
      ]
    }
  ];

  // The print layers cover this box of the model, in millimetres.
  const BOX = { x0: -520, y0: -60, w: 1040, h: 1140 };
  const PX_PER_MM = 1.1;

  /* One side's print layer: the artwork cut out of the tile, with the
     garment's own colour keyed out to transparent, on a canvas that maps
     straight onto the model's front (or back). */
  function printLayer(atlas, colIdx, tileY, groups) {
    const c = document.createElement("canvas");
    c.width = Math.round(BOX.w * PX_PER_MM);
    c.height = Math.round(BOX.h * PX_PER_MM);
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    groups.forEach((grp) => grp.src.forEach(([sx, sy, sw, sh]) => {
      const cut = document.createElement("canvas");
      cut.width = sw; cut.height = sh;
      const cg = cut.getContext("2d");
      const ci = grp.borrow && grp.borrow[colIdx] != null ? grp.borrow[colIdx] : colIdx;
      cg.drawImage(atlas, ci * 400 + sx, tileY + sy, sw, sh, 0, 0, sw, sh);
      const im = cg.getImageData(0, 0, sw, sh), d = im.data;
      // the garment colour = the usual colour round the edge of the box
      const rs = [], gs = [], bs = [];
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        if (x > 2 && y > 2 && x < sw - 3 && y < sh - 3) continue;
        const k = (y * sw + x) * 4;
        rs.push(d[k]); gs.push(d[k + 1]); bs.push(d[k + 2]);
      }
      const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
      const br = med(rs), bg = med(gs), bb = med(bs);
      const FE = 6;   // feather the box edges
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const k = (y * sw + x) * 4;
        const dist = Math.hypot(d[k] - br, d[k + 1] - bg, d[k + 2] - bb);
        let al = Math.max(0, Math.min(1, (dist - 13) / 26));
        al *= Math.min(1, (x + 0.5) / FE, (sw - x - 0.5) / FE, (y + 0.5) / FE, (sh - y - 0.5) / FE);
        d[k + 3] = Math.round(al * 255);
      }
      cg.putImageData(im, 0, 0);
      // tile pixel -> model millimetres -> layer pixel
      const mx = grp.to[0] + (sx - grp.at[0]) * grp.mm;
      const my = grp.to[1] - (sy - grp.at[1]) * grp.mm;   // top edge, measured up from the hem
      g.drawImage(cut, (mx - BOX.x0) * PX_PER_MM, (BOX.y0 + BOX.h - my) * PX_PER_MM,
        sw * grp.mm * PX_PER_MM, sh * grp.mm * PX_PER_MM);
    }));
    return c;
  }

  /* The garment material: plain fabric in the colourway's colour, with the
     front print layer projected onto front-facing surfaces and the back
     layer onto back-facing ones. The soft shadows in the creases are baked
     into the model (vertex colours); knit-ribbed parts (cuffs, hem band,
     collar) get fine vertical ribs in the shading. */
  function fabric(THREE, U, rib) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true, envMapIntensity: 0.3 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, {
        uRib: { value: rib ? rib.n : 0 }, uRibC: { value: rib ? rib.c : new THREE.Vector3() }
      });
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vPP;\nvarying vec3 vPN;\nvarying vec3 vRibT;\nuniform vec3 uRibC;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPP = position;\nvPN = normal;\n" +
          "vRibT = normalMatrix * normalize(vec3(-(position.z - uRibC.z), 0.0, position.x - uRibC.x) + 1e-5);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", [
          "#include <common>",
          "uniform sampler2D tFront; uniform sampler2D tBack; uniform vec4 uBox;",
          "uniform float uRib; uniform vec3 uRibC;",
          "varying vec3 vPP; varying vec3 vPN; varying vec3 vRibT;"
        ].join("\n"))
        .replace("#include <map_fragment>", [
          "#include <map_fragment>",
          "vec3 pn = normalize(vPN);",
          "vec2 uvF = (vPP.xy - uBox.xy) / uBox.zw;",
          "if (uvF.x > 0.0 && uvF.x < 1.0 && uvF.y > 0.0 && uvF.y < 1.0) {",
          "  float wf = smoothstep(0.06, 0.3, pn.z) * step(0.0, vPP.z);",
          "  float wb = smoothstep(0.06, 0.3, -pn.z) * step(vPP.z, 0.0);",
          "  vec4 pf = texture2D(tFront, uvF);",
          "  vec4 pb = texture2D(tBack, vec2(1.0 - uvF.x, uvF.y));",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, pf.rgb, pf.a * wf);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, pb.rgb, pb.a * wb);",
          "}",
          "float ribW = 0.0, ribS = 0.0;",
          "if (uRib > 0.0) {",
          "  float ra = atan(vPP.z - uRibC.z, vPP.x - uRibC.x) * uRib;",
          "  ribW = 1.0 - smoothstep(0.9, 2.2, fwidth(ra));",
          "  ribS = sin(ra);",
          "  diffuseColor.rgb *= 1.0 - 0.05 * ribW * (0.5 + 0.5 * cos(ra));",
          "}"
        ].join("\n"))
        .replace("#include <normal_fragment_maps>", [
          "#include <normal_fragment_maps>",
          "if (ribW > 0.0) normal = normalize(normal + normalize(vRibT) * 0.5 * ribW * ribS);"
        ].join("\n"));
    };
    return m;
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

    const state = { colour: piece.colours[0], rotY: -0.38, rotX: 0.13, vel: 0, target: null, idleAt: 0, dragging: false };
    let api = null;

    async function start() {
      const [{ THREE, GLTFLoader, RoomEnvironment }, atlas] = await Promise.all([loadThree(), loadAtlas()]);
      const gltf = await new GLTFLoader().loadAsync(piece.model);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      // light colours get a little less exposure, so their folds don't wash out
      const expose = (hex) => { const c = new THREE.Color(hex); renderer.toneMappingExposure = 0.95 - 0.3 * (0.3 * c.r + 0.6 * c.g + 0.1 * c.b); };
      expose(COL[state.colour][1]);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(0, 0.08, 11.2);
      // soft studio light: a room-sized environment plus a key, fill and rim light
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d0c2, 0.3));
      const key = new THREE.DirectionalLight(0xffffff, 1.45); key.position.set(3, 4, 7); scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-5, 1, 4); scene.add(fill);
      const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-4, 2, -6); scene.add(rim);

      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const layerTex = (colour, back) => {
        const t = new THREE.CanvasTexture(printLayer(atlas, COL[colour][2],
          back ? piece.yBack : piece.yFront, back ? piece.back : piece.front));
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = maxAniso;
        return t;
      };
      const U = {
        tFront: { value: layerTex(state.colour, false) },
        tBack: { value: layerTex(state.colour, true) },
        uBox: { value: new THREE.Vector4(BOX.x0, BOX.y0, BOX.w, BOX.h) }
      };

      // The CAD model is in metres with Z up, stored compressed; unpack it
      // into plain millimetres, Y up, front facing the camera.
      const model = new THREE.Group();
      const fabrics = [], cords = [];
      const box = new THREE.Box3();
      const unpack = (attr) => {
        const a = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) a[i * attr.itemSize + c] = attr.getComponent(i, c);
        return new THREE.BufferAttribute(a, attr.itemSize);
      };
      const cordColour = (hex) => new THREE.Color(hex).lerp(new THREE.Color("#d8d4cb"), 0.35);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        ["position", "normal"].forEach((n) => geo.setAttribute(n, unpack(geo.getAttribute(n))));
        geo.applyMatrix4(o.matrixWorld);
        geo.scale(1000, 1000, 1000);
        geo.computeBoundingBox();
        box.union(geo.boundingBox);
        let mat;
        if (o.name.startsWith("aglet")) {
          mat = new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.35, metalness: 0.85, vertexColors: true });
        } else {
          const ribN = piece.ribs[o.name];
          mat = fabric(THREE, U, ribN ? { n: ribN, c: geo.boundingBox.getCenter(new THREE.Vector3()) } : null);
          if (o.name.startsWith("cord")) { mat.color.copy(cordColour(COL[state.colour][1])); cords.push(mat); }
          else { mat.color.set(COL[state.colour][1]); fabrics.push(mat); }
        }
        model.add(new THREE.Mesh(geo, mat));
      });
      const size = box.getSize(new THREE.Vector3());
      const k = Math.min(4.35 / size.y, 4.15 / size.x);
      const holder = new THREE.Group();
      model.scale.setScalar(k);
      model.position.y = -(box.min.y + size.y / 2) * k;
      holder.add(model);
      holder.position.y = 0.06;
      scene.add(holder);

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(size.x * k * 1.05, size.z * k * 2.4),
        new THREE.MeshBasicMaterial({ map: shadowTexture(THREE), transparent: true, depthWrite: false })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = holder.position.y - size.y * k / 2 - 0.06;
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
          state.rotX += (0.13 - state.rotX) * Math.min(1, dt * 2);   // seen from a little above, like a product photo
        }
        holder.rotation.set(state.rotX, state.rotY, 0);
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
      };
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !running) { running = true; last = 0; requestAnimationFrame(frame); }
        else if (!e.isIntersecting) running = false;
      }).observe(stage);

      api = {
        recolour(colour) {
          expose(COL[colour][1]);
          fabrics.forEach((m) => m.color.set(COL[colour][1]));
          cords.forEach((m) => m.color.copy(cordColour(COL[colour][1])));
          [["tFront", false], ["tBack", true]].forEach(([u, back]) => {
            const old = U[u].value;
            U[u].value = layerTex(colour, back);
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
