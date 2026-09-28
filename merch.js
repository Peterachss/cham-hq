/* Chạm HQ - the Merch tab's concept ideas, drawn as SVG (front and back)
   with their shirt colours. Every concept borrows a real print tradition
   and prints in one or two flat ink colours, like a screen print. Drawing
   only: which ideas show is decided by the /merch collection. */
(function () {
  "use strict";

  const INK_DARK = "#1d1d1f";
  const INK_LIGHT = "#f1ede4";
  const SIGN_RED = "#c8202b";
  const SIGN_YELLOW = "#f2c230";
  const VARSITY_GREEN = "#1f4d3a";
  const SHIRTS = {
    white: ["White", "#ffffff"], heather: ["Heather grey", "#c9cacc"], stone: ["Stone", "#ddd5c4"],
    sage: ["Sage", "#c5d6bd"], sky: ["Sky blue", "#cfe3f7"], black: ["Black", "#1d1d1f"],
    navy: ["Navy", "#26334d"], forest: ["Forest green", "#2d4637"]
  };
  const DARK_SHIRTS = new Set(["black", "navy", "forest"]);

  function bezier([p0, p1, p2, p3], t) {
    const u = 1 - t;
    return [0, 1].map(i => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
  }

  // ---------- garments (each drawn in a 400 x 460 box) ----------
  const OUT = `stroke="#2b2b2b" stroke-width="2.2" stroke-linejoin="round"`;
  const THIN = `fill="none" stroke="#2b2b2b" stroke-width="1.4"`;
  const SHADE = `fill="#000" opacity=".1"`;

  function tee(side) {
    const neck = side === "front" ? "C165,64 235,64 255,38" : "C170,50 230,50 255,38";
    const collar = side === "front"
      ? `<path class="shirt" ${OUT} d="M145,38 C168,48 232,48 255,38 C235,64 165,64 145,38 Z"/>
         <path ${SHADE} d="M145,38 C168,48 232,48 255,38 C235,64 165,64 145,38 Z"/>
         <path ${THIN} d="M150,42 C170,72 230,72 250,42"/>`
      : `<path ${THIN} d="M152,42 C172,56 228,56 248,42"/>`;
    return `<path class="shirt" ${OUT} d="M145,38 ${neck} L318,60 L395,128 L352,182 L308,152 L312,438 Q200,450 88,438 L92,152 L48,182 L5,128 L82,60 Z"/>
      ${collar}
      <path ${THIN} d="M387,122 L344,176 M13,122 L56,176 M91,425 Q200,437 309,425"/>`;
  }

  function hoodie(side) {
    const body = `<path class="shirt" ${OUT} d="M140,66 C105,70 80,82 70,108 L24,368 L66,380 L98,196 L98,392 L302,392 L302,196 L334,380 L376,368 L330,108 C320,82 295,70 260,66 Z"/>`;
    const trims = `<path class="shirt" ${OUT} d="M24,368 L20,408 L60,420 L66,380 Z M376,368 L380,408 L340,420 L334,380 Z"/>
      <rect class="shirt" ${OUT} x="98" y="392" width="204" height="38" rx="3"/>
      <path ${THIN} d="M72,112 Q92,150 98,196 M328,112 Q308,150 302,196"/>`;
    if (side === "front") {
      const lining = "M146,68 C150,30 250,30 254,68 C238,84 216,98 200,116 C184,98 162,84 146,68 Z";
      return `<path class="shirt" ${OUT} d="M140,66 C136,22 168,6 200,6 C232,6 264,22 260,66 Z"/>
        ${body}
        <path class="shirt" ${OUT} d="${lining}"/><path ${SHADE} d="${lining}"/>
        <path ${THIN} d="M140,320 L260,320 L282,390 L118,390 Z"/>
        <path fill="none" stroke="#2b2b2b" stroke-width="2" stroke-linecap="round" d="M186,104 L182,162 M214,104 L218,162"/>
        ${trims}`;
    }
    return `${body}${trims}
      <path class="shirt" ${OUT} d="M138,70 C128,22 168,4 200,4 C232,4 272,22 262,70 C252,112 226,126 200,126 C174,126 148,112 138,70 Z"/>
      <path ${THIN} d="M200,6 L200,124"/>`;
  }

  const GARMENTS = {
    tee: { draw: tee, back: "translate(200,245)", chest: "translate(252,118)", center: "translate(200,170)" },
    hoodie: { draw: hoodie, back: "translate(200,262) scale(0.8)", chest: "translate(250,160) scale(0.95)", center: "translate(200,240)" }
  };


  // ---------- design concepts ----------
  const LINE = `fill="none" class="inks" stroke-linecap="round" stroke-linejoin="round"`;

  // Care label: laundry symbols drawn like the real ISO ones.
  const CARE_ICONS = {
    wash: "M0,1 L3,13 L17,13 L20,1 M1,5 q2.25,-2.5 4.5,0 t4.5,0 t4.5,0 t4.5,0",
    dry: "M1,1 L19,1 L19,15 L1,15 Z M1,1 Q10,8 19,1",
    bleach: "M10,0 L20,15 L0,15 Z M4,3 L16,15 M16,3 L4,15",
    pass: "M16,8 A6,6 0 1 0 10,14 M10,14 L13,11 M10,14 L13,17"
  };

  function careRow(icon, label, y) {
    return `<path d="${CARE_ICONS[icon]}" ${LINE} stroke-width="1.4" transform="translate(-66,${y})"/>
      <text class="ink an" x="-38" y="${y + 12}" font-size="10" font-weight="600" letter-spacing=".6">${label}</text>`;
  }

  // Saigon wires: small outline clothes for the line between the balconies.
  const LITTLE = {
    tee: "M-9,0 L-3.5,0 Q0,3 3.5,0 L9,0 L14,5.5 L10,9 L8,7 L8,21 L-8,21 L-8,7 L-10,9 L-14,5.5 Z",
    shorts: "M-8,0 L8,0 L9.5,16 L2.5,16 L0,7 L-2.5,16 L-9.5,16 Z",
    onesie: "M-8,0 L-3.5,0 Q0,3.5 3.5,0 L8,0 L12.5,4.5 L9,8.5 L7,7 L7,17 Q7,20.5 3.5,20.5 L1,20.5 L0,18 L-1,20.5 L-3.5,20.5 Q-7,20.5 -7,17 L-7,7 L-9,8.5 L-12.5,4.5 Z",
    sock: "M-3,0 L3,0 L3,11 Q3,15 8,15 L9,19 L-1,19 Q-3,19 -3,15 Z",
    dress: "M-4.5,0 Q0,2.5 4.5,0 L6,6 L11.5,22 Q0,24 -11.5,22 L-6,6 Z"
  };

  function saigonWires() {
    const line = [[-58, -56], [-20, -30], [20, -24], [58, -38]];
    const hung = [["tee", 0.16, -4], ["shorts", 0.36, 3], ["onesie", 0.56, -2], ["sock", 0.72, 5], ["dress", 0.88, -3]];
    const cage = [90, 94, 98, 102].map(x => `M${x},-80 L${x},-66`).join(" ");
    const bars = (from, to, top, bottom) => Array.from({ length: Math.floor((to - from) / 6) + 1 }, (_, i) =>
      `M${from + i * 6},${top} L${from + i * 6},${bottom}`).join(" ");
    return `<g ${LINE} stroke-width="1.5">
        <path d="M-58,-135 L-58,8 M58,-135 L58,-12"/>
        <path d="M-104,-122 L-74,-122 L-74,-102 L-104,-102 Z M-100,-116 L-78,-116 M-100,-111 L-78,-111 M-100,-106 L-78,-106 M-100,-102 L-96,-96 M-78,-102 L-82,-96"/>
        <path d="M-116,-58 L-58,-58 M-116,-34 L-58,-34 ${bars(-110, -64, -58, -34)} M-118,-34 L-56,-34 L-56,-30 L-118,-30"/>
        <path d="M-105,-68 L-95,-68 L-97,-58 L-103,-58 Z M-100,-68 C-104,-78 -110,-80 -113,-77 M-100,-68 C-98,-80 -94,-84 -89,-84 M-100,-68 C-101,-76 -100,-82 -99,-87"/>
        <path d="M-110,-22 L-72,-22 L-72,8 L-110,8 Z M-91,-22 L-91,8 M-110,-15 L-72,-15 M-110,-8 L-72,-8 M-110,-1 L-72,-1"/>
        <path d="M70,-128 L106,-128 L106,-96 L70,-96 Z M88,-128 L88,-96 M70,-120 L106,-120 M70,-112 L106,-112 M70,-104 L106,-104"/>
        <path d="M96,-92 L96,-84 M86,-66 L86,-78 Q96,-92 106,-78 L106,-66 Z ${cage} M84,-66 L108,-66"/>
        <path d="M58,-40 L116,-40 M58,-16 L116,-16 ${bars(64, 110, -40, -16)} M56,-16 L118,-16 L118,-12 L56,-12"/>
        <path d="M-116,-128 C-60,-100 40,-104 116,-132 M-116,-120 C-50,-86 50,-92 116,-118 M-116,-110 C-40,-96 30,-70 116,-106 M-30,-99 C-28,-80 -12,-80 -12,-95"/>
        <path d="M${line[0]} C${line[1]} ${line[2]} ${line[3]}"/>
      </g>
      ${hung.map(([k, t, r]) => {
        const [x, y] = bezier(line, t);
        return `<g transform="translate(${x.toFixed(1)},${(y - 1).toFixed(1)}) rotate(${r})">
          <path d="${LITTLE[k]}" class="shirt inks" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M-4,-3 L-4,3 M4,-3 L4,3" ${LINE} stroke-width="1.6"/>
        </g>`;
      }).join("")}`;
  }

  const IDEAS = [
    {
      id: "carelabel", garment: "tee", title: "Care Label",
      desc: "Styled like the care tag inside a shirt, blown up across the back. It fits the clothesline idea: wash with friends, hang out to dry, and pass it on when it doesn’t fit anymore. One ink colour.",
      shirts: ["white", "heather", "stone", "black"],
      chest: `<rect x="-26" y="-11" width="52" height="22" rx="1.5" class="ink"/>
        <rect x="-23" y="-8" width="46" height="16" fill="none" style="stroke:var(--shirt)" stroke-width=".8" stroke-dasharray="2 1.6"/>
        <text class="shirt an" x="0" y="4.5" text-anchor="middle" font-size="13" font-weight="700" letter-spacing=".5">CHẠM</text>`,
      back: `<rect x="-84" y="-140" width="168" height="252" rx="3" ${LINE} stroke-width="2"/>
        <rect x="-78" y="-134" width="156" height="240" rx="2" ${LINE} stroke-width="1" stroke-dasharray="3 2.5"/>
        <text class="ink an" x="-66" y="-96" font-size="44" font-weight="700" letter-spacing="1">CHẠM</text>
        <text class="ink mono" x="-66" y="-80" font-size="7.5" letter-spacing="1">CARE INSTRUCTIONS</text>
        <path d="M-66,-72 L66,-72 M-66,-26 L66,-26 M-66,82 L66,82" ${LINE} stroke-width="1"/>
        <text class="ink an" x="-66" y="-52" font-size="17" font-weight="600">100% COMPASSION</text>
        <text class="ink an" x="-66" y="-36" font-size="12" font-weight="500">100% LÒNG TRẮC ẨN</text>
        ${careRow("wash", "WASH WITH FRIENDS", -12)}
        ${careRow("dry", "HANG OUT TO DRY", 12)}
        ${careRow("bleach", "DO NOT BLEACH", 36)}
        ${careRow("pass", "OUTGROWN? PASS IT ON", 60)}
        <text class="ink mono" x="-66" y="97" font-size="7.5" letter-spacing="1">MADE IN HỒ CHÍ MINH CITY</text>`
    },
    {
      id: "shopsign", garment: "tee", title: "Saigon Shop Sign",
      desc: "Borrowed from the hand-painted shop signs (biển hiệu) all over Saigon: heavy condensed red letters on a yellow board, with the motto in both Vietnamese and English. Two ink colours.",
      shirts: ["white", "stone", "black"],
      chest: `<rect x="-30" y="-13" width="60" height="26" fill="${SIGN_YELLOW}"/>
        <rect x="-27.5" y="-10.5" width="55" height="21" fill="none" stroke="${SIGN_RED}" stroke-width="1.5"/>
        <text class="anton" x="0" y="7" text-anchor="middle" font-size="19" fill="${SIGN_RED}" letter-spacing="1">CHẠM</text>`,
      back: `<rect x="-92" y="-124" width="184" height="164" fill="${SIGN_YELLOW}"/>
        <rect x="-86" y="-118" width="172" height="152" fill="none" stroke="${SIGN_RED}" stroke-width="3"/>
        ${[[-80, -112], [80, -112], [-80, 28], [80, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="${SIGN_RED}"/>`).join("")}
        <g fill="${SIGN_RED}" text-anchor="middle">
          <text class="barlow" x="0" y="-96" font-size="14" font-weight="700" letter-spacing="2.5">THAY ĐỔI CUỘC SỐNG</text>
          <text class="anton" x="0" y="-26" font-size="66" letter-spacing="2">CHẠM</text>
          <text class="barlow" x="0" y="6" font-size="14" font-weight="700" letter-spacing="2.5">BẰNG LÒNG TRẮC ẨN</text>
          <text class="barlow" x="0" y="26" font-size="9.5" font-weight="600" letter-spacing=".6">CHANGING LIVES THROUGH COMPASSION</text>
        </g>
        <path d="M-40,13 L40,13" stroke="${SIGN_RED}" stroke-width="1"/>`
    },
    {
      id: "wires", garment: "hoodie", title: "Saigon Wires",
      desc: "A one-colour line drawing of a Saigon alley: a kids’ clothesline strung between two balconies, under the tangle of electric wires, with a bird cage and a potted plant. The text sits small and left-aligned underneath.",
      shirts: ["sage", "stone", "heather", "navy"],
      chest: `<path d="M-36,-10 L-4,-10" ${LINE} stroke-width="1.3"/>
        <g transform="translate(-20,-9) scale(.95)"><path d="${LITTLE.onesie}" class="shirt inks" stroke-width="1.4" stroke-linejoin="round"/></g>
        <text class="ink bvp" x="2" y="4" font-size="15" font-weight="600">chạm</text>`,
      back: `${saigonWires()}
        <g class="ink bvp">
          <text x="-112" y="44" font-size="34" font-weight="700">chạm</text>
          <text x="-112" y="64" font-size="11.5">changing lives through compassion</text>
          <text x="-112" y="80" font-size="11" font-style="italic">thay đổi cuộc sống bằng lòng trắc ẩn</text>
        </g>
        <text class="ink mono" x="-112" y="102" font-size="8.5" letter-spacing="1.5">HỒ CHÍ MINH CITY</text>`
    },
    {
      id: "varsity", garment: "hoodie", title: "Varsity",
      desc: "A classic college-style arch across the front, the kind of hoodie a student club actually wears every day. The back just has the motto in small type under the hood.",
      shirts: ["heather", "stone", "navy", "forest"],
      ink: { heather: VARSITY_GREEN, stone: VARSITY_GREEN, navy: INK_LIGHT, forest: INK_LIGHT },
      frontAt: "center",
      chest: `<path id="varsity-arc" d="M-90,34 A160,160 0 0 1 90,34" fill="none"/>
        <text class="ink slab" font-size="40" letter-spacing="2.5"><textPath href="#varsity-arc" startOffset="50%" text-anchor="middle">CHẠM</textPath></text>
        <text class="ink barlow" x="0" y="44" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="3.5">HO CHI MINH CITY</text>
        <path d="M-88,40 L-74,40 M74,40 L88,40" ${LINE} stroke-width="1.6"/>`,
      back: `<g class="ink barlow" text-anchor="middle" font-weight="600">
          <text x="0" y="-112" font-size="12" letter-spacing="1.5">THAY ĐỔI CUỘC SỐNG BẰNG LÒNG TRẮC ẨN</text>
          <text x="0" y="-96" font-size="10" letter-spacing="1.5">CHANGING LIVES THROUGH COMPASSION</text>
        </g>`
    }
  ];

  // ---------- rendering ----------
  function shirtVars(idea, key) {
    const ink = (idea.ink && idea.ink[key]) || (DARK_SHIRTS.has(key) ? INK_LIGHT : INK_DARK);
    return `--shirt:${SHIRTS[key][1]};--dink:${ink}`;
  }

  let uid = 0;
  function mockupSVG(idea, shirtKey) {
    const g = GARMENTS[idea.garment];
    const n = ++uid;
    return `<svg class="mock" viewBox="0 0 820 480" role="img" aria-label="${idea.title}: ${idea.garment} front and back" style="${shirtVars(idea, shirtKey)}">
      <g transform="translate(5,8)">${g.draw("front")}<g transform="${g[idea.frontAt || "chest"]}">${idea.chest.replace(/varsity-arc/g, "varsity-arc-" + n)}</g></g>
      <g transform="translate(415,8)">${g.draw("back")}<g transform="${g.back}">${idea.back}</g></g>
      <text class="lbl" x="205" y="474" text-anchor="middle">FRONT</text>
      <text class="lbl" x="615" y="474" text-anchor="middle">BACK</text>
    </svg>`;
  }

  /* the fonts the drawings use, fetched the first time the Merch tab opens */
  const FONTS = "https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Anton&family=Archivo+Narrow:wght@500;600;700"
    + "&family=Barlow+Condensed:wght@600;700&family=Be+Vietnam+Pro:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@500&display=swap";
  function loadFonts() {
    if (document.getElementById("merch-fonts")) return;
    const l = document.createElement("link");
    l.id = "merch-fonts"; l.rel = "stylesheet"; l.href = FONTS;
    document.head.appendChild(l);
  }

  window.ChamMerch = { IDEAS, SHIRTS, mockupSVG, shirtVars, loadFonts };
})();
