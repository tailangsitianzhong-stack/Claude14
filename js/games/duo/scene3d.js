/**
 * 二択クイズの3Dシーン(Three.js)。トロッコに乗って、長い線路を加速しながら走り、分かれ道で左右のパネルのどちらかへ突っこむ。
 *
 *   const sc = DuoScene.create({ canvas, players:[{id, avatar}], myId, now: () => serverNow });   // WebGL が使えなければ null
 *   sc.question({ s:"en", labels:[左, 右], startedAt, endsAt })   // 新しい問題(トロッコが遠いスタート位置から、加速しながら走りだす)
 *   sc.answered(pid, side)       // 答えた(自分のトロッコだけ、選んだ側へかたむく。他の人の選択は、答え合わせまで見せない)
 *   sc.reveal({ a, picks, ok })  // 答え合わせ: ブーストで分かれ道へ。正解の側のパネルをつき破る。まちがい・時間切れは、かたい壁・柱にぶつかる
 *   sc.idle() / sc.resize() / sc.dispose()
 *
 * 疾走感のしくみ: 線路は長く(数百m)、トロッコの速さは制限時間にそって上がる(終盤ほど速い)。
 *   速さに応じて 視野角が広がる・流線(スピードライン)・火花・画面のゆれ・道ばたのアーチやネオンが飛びさる。
 * 周囲: 科目ごとのテーマ(英語=本棚と文字ブロック / 化学=フラスコとネオン管 / 物理=惑星と星 / 地理=山と木と雲)、
 *   線路ぞいのアーチ・ネオン・ゲート、分かれ道の看板・ゲート・ハザードの柱、ゴールのアーチ。
 * 省電力: 描画は動きのある間だけ。40fps まで。影なし。同じ形はインスタンス(1回の描画)でまとめる。画素密度は 1.75 まで。
 * 3Dのパネルの文字は見た目のため(読みやすい全文は、画面のボタンに出る)。
 */
(function (root) {
  "use strict";

  const THEME = {
    en: { sky: 0x2d58c8, ground: 0x1c2f6b, wall: "#2f6fe4", accent: 0x7fd0ff, accent2: 0xffe27a, name: "ENGLISH" },
    chem: { sky: 0x0f8a63, ground: 0x0a4a37, wall: "#12a76a", accent: 0x7dffc4, accent2: 0xff8bd8, name: "CHEMISTRY" },
    phys: { sky: 0x4b2a8f, ground: 0x24124f, wall: "#e8782a", accent: 0xffb36b, accent2: 0x8fd3ff, name: "PHYSICS" },
    geo: { sky: 0x3b8fd1, ground: 0x2d6a3a, wall: "#c99a14", accent: 0xfff29a, accent2: 0xff9b5e, name: "GEOGRAPHY" }
  };
  const Z0 = 7, Z_FORK = -14, Z_DIV = -28, Z_WALL = -33, BRANCH_X = 9.5, RUNWAY = 470;     // 分かれ道(Z_FORK)から Z_DIV まででカーブし、壁(Z_WALL)まで直進
  const AVG_SPEED = 25, GAP_END = 14, MAX_GAP = 400;          // 平均の速さ(m/s)、制限時間ぎりぎりでの分かれ道までの距離
  const REVEAL_MS = 2300;
  const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻" };
  const SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };

  /** 3Dのパネル用に、[[H2SO4]] や [[Cu^2+]] を、ふつうの文字(添え字つき)にする */
  function pretty(t) {
    return String(t).replace(/\[\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\]/g, (_, f) =>
      f.replace(/\^([0-9+\-−]+)/g, (m, s) => s.split("").map((c) => SUP[c] || c).join("")).replace(/([A-Za-z)\]])([0-9]+)/g, (m, a, d) => a + d.split("").map((c) => SUB[c]).join("")));
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (t) => t * t * (3 - 2 * t);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);   // 景色は、毎回同じ配置(乱数の固定)

  function wrapLines(ctx, text, maxW) {
    const lines = [];
    let cur = "";
    for (const ch of Array.from(text)) {
      const test = cur + ch;
      if (ctx.measureText(test).width > maxW && cur) {
        const sp = cur.lastIndexOf(" ");
        if (ch !== " " && sp > 0 && /[A-Za-z]/.test(ch)) { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; }
        else { lines.push(cur); cur = ch === " " ? "" : ch; }
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function create(opts) {
    const THREE = root.THREE;
    if (!THREE) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: (root.devicePixelRatio || 1) < 2, alpha: false, powerPreference: "low-power" });
    } catch (_) { return null; }
    if (!renderer || !renderer.getContext()) return null;
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.75));

    const players = opts.players;
    const now = opts.now || (() => Date.now());
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(THEME.en.sky);
    scene.fog = new THREE.Fog(THEME.en.sky, 28, 170);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 220);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(-6, 14, 8); scene.add(sun);

    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
    const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    const dummy = new THREE.Object3D();
    /** 同じ形を、1回の描画でたくさん出す。items: [{x,y,z,sx,sy,sz,rx,ry,rz,c}] */
    function inst(geo, material, items) {
      const m = new THREE.InstancedMesh(geo, material, items.length);
      const col = new THREE.Color();
      items.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0); dummy.scale.set(it.sx || 1, it.sy || 1, it.sz || 1); dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        if (it.c != null) m.setColorAt(i, col.set(it.c));
      });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.frustumCulled = false;
      return m;
    }
    const world = new THREE.Group(); scene.add(world);
    const themed = [];          // 科目で色が変わるもの { material, key:"accent"|"accent2" }
    const tinted = (key, c) => { const m = basic(c); themed.push({ material: m, key }); return m; };

    /* ---------- 地面・線路 ---------- */
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, RUNWAY + 200), mat(THEME.en.ground)); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.7, (RUNWAY - 120) / 2 + 20); world.add(ground);
    const floorZ = (RUNWAY + 14) / 2 - 14;
    const floor = box(13, 0.4, RUNWAY + 14, 0x4a4f5c); floor.position.set(0, -0.2, floorZ + 0); world.add(floor);
    // 床の中央の点線とまくら木(インスタンス)
    const sleepers = [], dashes = [];
    for (let z = RUNWAY; z > Z_FORK; z -= 1.7) sleepers.push({ x: 0, y: 0.04, z });
    for (let z = RUNWAY; z > Z_FORK; z -= 4) dashes.push({ x: 0, y: 0.05, z });
    world.add(inst(new THREE.BoxGeometry(12, 0.12, 0.5), mat(0x8a6a46), sleepers));
    world.add(inst(new THREE.BoxGeometry(0.25, 0.04, 1.6), basic(0xffffff), dashes));
    for (const x of [-5.3, -2.1, 2.1, 5.3]) { const r = box(0.18, 0.2, RUNWAY + 14, 0xdfe4ee); r.position.set(x, 0.18, floorZ); world.add(r); }
    // 線路ぞいのネオン(テーマ色)
    for (const x of [-6.7, 6.7]) { const n = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, RUNWAY + 14), tinted("accent", 0xffffff)); n.position.set(x, 0.1, floorZ); world.add(n); }

    /* ---------- 道ばた: アーチ・ランプ ---------- */
    const archPillars = [], archBeams = [], lamps = [];
    for (let z = RUNWAY - 8; z > Z_FORK + 22; z -= 18) {
      for (const x of [-9.5, 9.5]) archPillars.push({ x, y: 3.6, z, sy: 1 });
      archBeams.push({ x: 0, y: 7.3, z });
      for (const x of [-9.5, 9.5]) lamps.push({ x: x * 0.96, y: 7.9, z, sx: 1, sy: 1, sz: 1 });
    }
    world.add(inst(new THREE.BoxGeometry(0.7, 7.2, 0.7), tinted("accent", 0xffffff), archPillars));
    world.add(inst(new THREE.BoxGeometry(20, 0.5, 0.7), tinted("accent2", 0xffffff), archBeams));
    world.add(inst(new THREE.SphereGeometry(0.55, 8, 6), basic(0xffffff), lamps));
    // 道ばたの低い柱(近くを飛びさる)
    const posts = [];
    for (let z = RUNWAY - 3; z > Z_FORK + 14; z -= 6) for (const x of [-7.6, 7.6]) posts.push({ x, y: 0.9, z, sy: 1 + (rnd() * 0.8), c: rnd() < 0.5 ? 0x7d879c : 0x5f6a82 });
    world.add(inst(new THREE.BoxGeometry(0.5, 1.8, 0.5), mat(0xffffff), posts));
    // 距離のゲート(100mごとに、でっかいアーチが飛びさる)
    for (let z = RUNWAY - 30; z > Z_FORK + 60; z -= 100) {
      const gt = new THREE.Group();
      for (const x of [-8.5, 8.5]) { const p = box(1, 11, 1, 0xf4f4f4); p.position.set(x, 5.5, 0); gt.add(p); }
      const sb = new THREE.Mesh(new THREE.BoxGeometry(18, 1.6, 1), tinted("accent2", 0xffffff)); sb.position.set(0, 11, 0); gt.add(sb);
      gt.position.z = z; world.add(gt);
    }

    /* ---------- 科目ごとの景色 ---------- */
    const props = {};
    function side(minX, maxX) { return (rnd() < 0.5 ? -1 : 1) * (minX + rnd() * (maxX - minX)); }
    function scatter(n, f) { const out = []; for (let i = 0; i < n; i++) { const z = RUNWAY - 4 - (RUNWAY + Z_FORK - 40) * (i / n) - rnd() * 6; out.push(f(z, i)); } return out; }
    function themeProps(key) {
      const g = new THREE.Group(); g.visible = false; world.add(g);
      if (key === "en") {                                    // 本棚と、ういている文字ブロック
        const pal = [0xe5484d, 0xf5a524, 0x30a46c, 0x3e63dd, 0xb04fd8, 0xffffff];
        g.add(inst(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), scatter(150, (z) => ({ x: side(15, 36), y: 3 + rnd() * 5, z, sx: 2 + rnd() * 2, sy: 6 + rnd() * 8, sz: 1.4, c: pal[Math.floor(rnd() * pal.length)] }))));
        g.add(inst(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), scatter(110, (z) => ({ x: side(11, 30), y: 6 + rnd() * 12, z, sx: 1.6, sy: 1.6, sz: 1.6, rx: rnd() * 3, ry: rnd() * 3, c: rnd() < 0.5 ? 0xffe27a : 0xffffff }))));
      } else if (key === "chem") {                           // フラスコ・ネオン管・分子の球
        g.add(inst(new THREE.CylinderGeometry(0.5, 1.7, 3.6, 8), mat(0xbff5df), scatter(110, (z) => ({ x: side(14, 34), y: 1.8 + rnd() * 1.5, z, sx: 1 + rnd(), sy: 1 + rnd(), sz: 1 + rnd(), c: rnd() < 0.5 ? 0x9ef0c8 : 0xb6e8ff }))));
        g.add(inst(new THREE.CylinderGeometry(0.28, 0.28, 12, 6), tinted("accent", 0xffffff), scatter(120, (z) => ({ x: side(13, 32), y: 6, z, sy: 0.7 + rnd() * 1.1 }))));
        g.add(inst(new THREE.SphereGeometry(1.3, 10, 8), mat(0xffffff), scatter(120, (z) => ({ x: side(12, 34), y: 5 + rnd() * 13, z, sx: 0.6 + rnd(), sy: 0.6 + rnd(), sz: 0.6 + rnd(), c: [0xff8bd8, 0xffffff, 0x8fd3ff][Math.floor(rnd() * 3)] }))));
      } else if (key === "phys") {                           // 惑星・輪・星
        const pal = [0xff9b5e, 0x8fd3ff, 0xf5d36e, 0xd68cff, 0xffffff];
        g.add(inst(new THREE.SphereGeometry(1, 14, 10), mat(0xffffff), scatter(70, (z) => { const r = 2 + rnd() * 5; return { x: side(16 + r, 44), y: 4 + rnd() * 18, z, sx: r, sy: r, sz: r, c: pal[Math.floor(rnd() * pal.length)] }; })));
        g.add(inst(new THREE.TorusGeometry(1, 0.05, 6, 28), tinted("accent2", 0xffffff), scatter(60, (z) => { const r = 3 + rnd() * 4; return { x: side(16 + r, 42), y: 5 + rnd() * 16, z, sx: r, sy: r, sz: r, rx: 1.1 + rnd() * 0.5, ry: rnd() * 2 }; })));
        g.add(inst(new THREE.BoxGeometry(0.35, 0.35, 0.35), basic(0xffffff), scatter(260, (z) => ({ x: (rnd() - 0.5) * 80, y: 3 + rnd() * 30, z }))));
      } else {                                               // 地理: 山・木・雲
        g.add(inst(new THREE.ConeGeometry(1, 1, 6), mat(0xffffff), scatter(90, (z) => { const r = 5 + rnd() * 9; return { x: side(18 + r * 0.5, 50), y: r * 0.7, z, sx: r, sy: r * 1.5, sz: r, c: rnd() < 0.4 ? 0xeaf2f8 : rnd() < 0.5 ? 0x6f8f6a : 0x8a7a64 }; })));
        g.add(inst(new THREE.ConeGeometry(1, 1, 7), mat(0xffffff), scatter(160, (z) => ({ x: side(11, 28), y: 2.4, z, sx: 1.7, sy: 4.4, sz: 1.7, c: 0x2f9e55 }))));
        g.add(inst(new THREE.SphereGeometry(1, 8, 6), mat(0xffffff), scatter(110, (z) => ({ x: side(10, 46), y: 14 + rnd() * 10, z, sx: 4 + rnd() * 4, sy: 1.6 + rnd(), sz: 3 + rnd() * 3, c: 0xffffff }))));
      }
      return g;
    }
    for (const k of ["en", "chem", "phys", "geo"]) props[k] = themeProps(k);

    /* ---------- 分かれ道: 枝・柱・看板・ゴールのアーチ ---------- */
    const divLen = Math.hypot(BRANCH_X, Z_FORK - Z_DIV), divAng = Math.atan2(BRANCH_X, Z_FORK - Z_DIV);
    for (const sd of [-1, 1]) {
      // 分かれる区間(斜め)と、壁までの直進区間
      const g = new THREE.Group();
      g.position.set(sd * BRANCH_X / 2, 0, (Z_FORK + Z_DIV) / 2);
      g.rotation.y = sd * divAng;
      const fl = box(13, 0.4, divLen + 2, 0x4a4f5c); fl.position.y = -0.21; g.add(fl);
      const sl = [];
      for (let i = -divLen / 2 + 1; i < divLen / 2; i += 1.7) sl.push({ x: 0, y: 0.03, z: i });
      g.add(inst(new THREE.BoxGeometry(12, 0.12, 0.5), mat(0x8a6a46), sl));
      for (const x of [-5.3, -2.1, 2.1, 5.3]) { const r = box(0.18, 0.2, divLen + 2, 0xdfe4ee); r.position.set(x, 0.17, 0); g.add(r); }
      world.add(g);
      const sg = new THREE.Group(); sg.position.set(sd * BRANCH_X, 0, (Z_DIV + Z_WALL) / 2 - 0.5); world.add(sg);
      const sf = box(13, 0.4, Math.abs(Z_WALL - Z_DIV) + 3, 0x4a4f5c); sf.position.y = -0.21; sg.add(sf);
      for (const x of [-5.3, -2.1, 2.1, 5.3]) { const r = box(0.18, 0.2, Math.abs(Z_WALL - Z_DIV) + 3, 0xdfe4ee); r.position.set(x, 0.17, 0); sg.add(r); }
      // 壁のうしろの、ゴールの床とアーチ
      const goal = box(14, 0.4, 40, 0x3a3f4a); goal.position.set(sd * BRANCH_X, -0.2, Z_WALL - 21); world.add(goal);
      for (const x of [-6.5, 6.5]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), tinted("accent2", 0xffffff)); p.position.set(sd * BRANCH_X + x, 4.5, Z_WALL - 22); world.add(p); }
      const gb = new THREE.Mesh(new THREE.BoxGeometry(14.8, 1.1, 0.9), tinted("accent2", 0xffffff)); gb.position.set(sd * BRANCH_X, 9.3, Z_WALL - 22); world.add(gb);
    }
    // 中央の柱(時間切れでぶつかる): ハザードのしま模様
    const pillar = box(4.2, 3.6, 3.2, 0x2c303a); pillar.position.set(0, 1.8, Z_FORK - 7); world.add(pillar);
    const hz = [];
    for (let i = -3; i <= 3; i++) hz.push({ x: i * 0.55, y: 1.0, z: Z_FORK - 5.38, sx: 1, sy: 1, sz: 1, rz: 0.6 });
    world.add(inst(new THREE.BoxGeometry(0.28, 2.4, 0.06), basic(0xf4c20d), hz));
    const wedgeTop = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.4, 3.4), tinted("accent2", 0xffffff)); wedgeTop.position.set(0, 3.7, Z_FORK - 7); world.add(wedgeTop);
    // 分かれ道の手前の看板(ガントリー): 左右の矢印
    function signTexture(txt, color) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g = c.getContext("2d");
      g.fillStyle = color; g.fillRect(0, 0, 256, 128); g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(0, 0, 256, 18); g.fillStyle = "#fff"; g.font = "bold 84px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, 128, 70);
      return new THREE.CanvasTexture(c);
    }
    const gantry = new THREE.Group();
    for (const x of [-17, 17]) { const p = box(1, 12, 1, 0x30343f); p.position.set(x, 6, 0); gantry.add(p); }
    const gbm = box(35, 1.2, 1.2, 0x30343f); gbm.position.set(0, 12, 0); gantry.add(gbm);
    for (const [x, t] of [[-8, "◀ A"], [8, "B ▶"]]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: signTexture(t, "#222a3a") })); s.position.set(x, 9, 0.7); gantry.add(s); }
    gantry.position.z = Z_FORK + 34; world.add(gantry);

    /* ---------- パネル(選択肢) ---------- */
    function panelTexture(text, color) {
      const c = document.createElement("canvas"); c.width = 512; c.height = 384;
      const g = c.getContext("2d");
      g.fillStyle = color; g.fillRect(0, 0, 512, 384);
      g.fillStyle = "rgba(255,255,255,0.12)"; for (let i = 0; i < 6; i++) g.fillRect(0, i * 64, 512, 32);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
      let size = 112, lines;
      do { g.font = `bold ${size}px "Hiragino Sans","Noto Sans JP",sans-serif`; lines = wrapLines(g, text, 450); size -= 8; } while (lines.length * (size + 14) > 350 && size > 24);
      const lh = size + 20, y0 = 192 - (lines.length - 1) * lh / 2;
      g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 6;
      lines.forEach((l, i) => g.fillText(l, 256, y0 + i * lh));
      const t = new THREE.CanvasTexture(c); t.anisotropy = 2;
      return t;
    }
    const panels = [];
    for (const sd of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(13, 8.5, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, map: null }));
      p.position.set(sd * BRANCH_X, 4.25, Z_WALL - 0.5);
      world.add(p);
      // わく(ネオン)と、上の大きな A / B
      const fr = new THREE.Group();
      for (const [w, h, x, y] of [[14.4, 0.5, 0, 8.75], [14.4, 0.5, 0, -0.25], [0.5, 9.5, -6.95, 4.25], [0.5, 9.5, 6.95, 4.25]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.9), tinted("accent", 0xffffff)); b.position.set(x, y, 0); fr.add(b); }
      fr.position.set(sd * BRANCH_X, 0, Z_WALL - 0.3); world.add(fr);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: signTexture(sd < 0 ? "A" : "B", "#ffffff00"), transparent: true })); lab.position.set(sd * BRANCH_X, 11.2, Z_WALL + 0.1); world.add(lab);
      panels.push({ mesh: p, frame: fr, side: sd, shards: [], broken: false });
    }
    const shardGeo = new THREE.BoxGeometry(1, 1, 0.4);

    /* ---------- トロッコ ---------- */
    function emojiSprite(ch) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const g = c.getContext("2d"); g.font = "96px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 64, 72);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
      s.scale.set(2, 2, 1); s.renderOrder = 5; return s;
    }
    const COLORS = [0xe5484d, 0x3e63dd, 0x30a46c, 0xf5a524];
    const n = players.length;
    const laneX = n === 1 ? [0] : n === 2 ? [-1.5, 1.5] : n === 3 ? [-3, 0, 3] : [-4.2, -1.4, 1.4, 4.2];
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.25, 12), beamMat = new THREE.MeshBasicMaterial({ color: 0xfff4b0, transparent: true, opacity: 0.22, depthWrite: false });
    const trolleys = players.map((p, i) => {
      const g = new THREE.Group();
      const body = box(2, 0.9, 2.8, COLORS[i % 4]); body.position.y = 0.85; g.add(body);
      const nose = box(1.6, 0.7, 0.9, COLORS[i % 4]); nose.position.set(0, 0.8, -1.7); nose.rotation.x = -0.2; g.add(nose);
      const rim = box(2.2, 0.18, 3, 0xffffff); rim.position.y = 1.35; g.add(rim);
      const wheels = [];
      for (const [x, z] of [[-1, -0.9], [1, -0.9], [-1, 0.9], [1, 0.9]]) {
        const w = new THREE.Mesh(wheelGeo, mat(0x222222)); w.rotation.z = Math.PI / 2; w.position.set(x, 0.4, z); g.add(w); wheels.push(w);
      }
      const lightL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), basic(0xfff4b0)); lightL.position.set(-0.55, 0.95, -2.15); g.add(lightL);
      const lightR = lightL.clone(); lightR.position.x = 0.55; g.add(lightR);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 9, 12, 1, true), beamMat); beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0.95, -6.6); g.add(beam);
      const face = emojiSprite(p.avatar || "🙂"); face.position.set(0, 2.2, 0); g.add(face);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), basic(0x3ddc84)); lamp.position.set(0, 3.5, 0); lamp.visible = false; g.add(lamp);
      const mark = emojiSprite(""); mark.position.set(0, 3.9, 0); mark.visible = false; g.add(mark);
      g.scale.setScalar(1.25);
      world.add(g);
      return { id: p.id, g, wheels, lamp, mark, face, beam, x0: laneX[i], lean: 0, state: "wait", t0: 0, side: 0, ok: false, vy: 0, vz: 0, spin: 0, zStart: 0, dur: 1500, sparkT: 0 };
    });
    const byId = new Map(trolleys.map((t) => [t.id, t]));
    const markTex = {};
    function setMark(t, ch) {
      if (!markTex[ch]) { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); g.font = "96px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 64, 72); markTex[ch] = new THREE.CanvasTexture(c); }
      t.mark.material.map = markTex[ch]; t.mark.material.needsUpdate = true; t.mark.visible = true;
    }

    /* ---------- 流線(スピードライン)・火花・紙ふぶき ---------- */
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const streaks = [];
    for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1), streakMat); m.userData.r = rnd(); scene.add(m); streaks.push(m); }
    const sparkGeo = new THREE.BoxGeometry(0.16, 0.16, 0.5), sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd34d });
    const sparks = [];
    for (let i = 0; i < 36; i++) { const m = new THREE.Mesh(sparkGeo, sparkMat); m.visible = false; m.userData = { t: 9, vx: 0, vy: 0, vz: 0 }; world.add(m); sparks.push(m); }
    const confGeo = new THREE.BoxGeometry(0.3, 0.3, 0.05), confetti = [];
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(confGeo, new THREE.MeshBasicMaterial({ color: [0xff5d73, 0xffd34d, 0x4ade80, 0x60a5fa, 0xc084fc][i % 5], side: THREE.DoubleSide })); m.visible = false; m.userData = { t: 9 }; world.add(m); confetti.push(m); }
    let sparkIdx = 0;
    function spark(x, y, z, vz) { const m = sparks[sparkIdx++ % sparks.length]; m.visible = true; m.position.set(x, y, z); m.userData = { t: 0, vx: (rnd() - 0.5) * 5, vy: 2 + rnd() * 3, vz: vz + 6 + rnd() * 8 }; }
    function burst(x, y, z) { confetti.forEach((m, i) => { m.visible = true; m.position.set(x, y, z); m.userData = { t: 0, vx: (rnd() - 0.5) * 14, vy: 6 + rnd() * 10, vz: -rnd() * 8 + 2, rx: rnd() * 8, ry: rnd() * 8 }; }); }

    /* ---------- 状態 ---------- */
    const S = { q: null, phase: "idle", revealAt: 0, rv: null, shake: 0, running: false, raf: 0, last: 0, idleAt: 0, camZ: Z0 + 12, lastTz: Z0, lastTx: 0, v: 0, prevCamZ: 0, fov: 58, theme: "en", gap0: 0, T: 1, V0: 0, V1: 0 };

    function pathAt(t, z) {                 // 選んだ側へ曲がる道すじ: z での x
      if (!t.side) return t.x0;
      const k = clamp((Z_FORK - z) / (Z_FORK - Z_DIV), 0, 1);
      return t.x0 + (t.side * BRANCH_X - t.x0) * ease(k);
    }

    function setTheme(key) {
      const th = THEME[key] || THEME.en;
      S.theme = key in THEME ? key : "en";
      scene.background.setHex(th.sky); scene.fog.color.setHex(th.sky);
      ground.material.color.setHex(th.ground);
      for (const k of Object.keys(props)) props[k].visible = k === S.theme;
      for (const t of themed) t.material.color.setHex(th[t.key]);
    }

    /** 問題の制限時間にそって、速さが上がる。distance(τ) = 分かれ道までの距離。終了時刻のとき GAP_END */
    function gapAt(tau) {
      const T = S.T, d = T * (S.V0 * tau + (S.V1 - S.V0) * tau * tau / 2);
      return Math.max(GAP_END - 8, S.gap0 - d);
    }

    function question(q) {
      S.q = q; S.phase = "play"; S.rv = null; S.shake = 0;
      setTheme(q.s);
      const th = THEME[S.theme];
      const T = Math.max(3, (q.endsAt - q.startedAt) / 1000);
      const avg = Math.min(AVG_SPEED, (MAX_GAP - GAP_END) / T);
      S.T = T; S.V0 = avg * 0.55; S.V1 = avg * 1.45; S.gap0 = GAP_END + T * (S.V0 + (S.V1 - S.V0) / 2);
      panels.forEach((p, i) => {
        const text = pretty(q.labels[i]);
        if (p.mesh.material.map) p.mesh.material.map.dispose();
        p.mesh.material.map = panelTexture(text, th.wall); p.mesh.material.color.setHex(0xffffff); p.mesh.material.emissive.setHex(0x000000);
        p.mesh.material.needsUpdate = true; p.mesh.visible = true; p.frame.visible = true; p.broken = false;
        for (const s of p.shards) s.visible = false;
      });
      for (const t of trolleys) {
        t.state = "wait"; t.side = 0; t.lean = 0; t.lamp.visible = false; t.mark.visible = false;
        t.g.rotation.set(0, 0, 0); t.g.position.set(t.x0, 0, Z_FORK + S.gap0); t.vy = 0; t.vz = 0; t.spin = 0; t.face.visible = true;
      }
      for (const c of confetti) c.visible = false;
      S.camZ = Z_FORK + S.gap0 + 12; S.prevCamZ = S.camZ; S.lastTz = Z_FORK + S.gap0; S.lastTx = 0; S.v = 0;
      start();
    }

    function answered(pid, side) {
      const t = byId.get(pid); if (!t) return;
      t.lamp.visible = true;
      if (pid === opts.myId && (side === 0 || side === 1)) t.lean = side === 0 ? -1 : 1;
      start();
    }

    function reveal(rv) {
      S.phase = "reveal"; S.revealAt = now(); S.rv = rv; S.snapped = false;
      for (const t of trolleys) {
        const pk = rv.picks[t.id];
        t.side = pk === 0 ? -1 : pk === 1 ? 1 : 0;
        t.ok = !!rv.ok[t.id]; t.state = "run"; t.t0 = now(); t.lean = 0; t.lamp.visible = false;
        t.zStart = Math.min(t.g.position.z, Z_FORK + 150);                   // 遠くからは、霧にかくれた所までテレポート(見えない)
        const jump = t.g.position.z - t.zStart;
        if (jump > 0 && !S.snapped) { S.snapped = true; S.camZ -= jump; S.prevCamZ -= jump; }
        t.g.position.z = t.zStart;
        const zEnd = t.side ? Z_WALL + 2.3 : Z_FORK - 3.5;
        t.dur = clamp((t.zStart - zEnd) / 85, 1.1, 2.1) * 1000;               // ブースト: 遠いほど速く
        t.vy = 0; t.vz = 0; t.spin = 0;
      }
      start();
    }

    function idle() { S.phase = "idle"; for (const t of trolleys) { t.state = "wait"; t.lamp.visible = false; } start(); }

    function shatter(p, from) {
      p.broken = true; p.mesh.visible = false;
      const mt = p.mesh.material;
      while (p.shards.length < 28) { const s = new THREE.Mesh(shardGeo, new THREE.MeshLambertMaterial({ color: 0xffffff })); s.userData = {}; world.add(s); p.shards.push(s); }
      p.shards.forEach((s, i) => {
        s.material.color.copy(mt.color).multiplyScalar(0.9 + (i % 3) * 0.1); s.material.map = i % 4 === 0 ? mt.map : null; s.material.needsUpdate = true;
        s.visible = true;
        s.scale.set(1.4 + (i % 3) * 0.6, 1.2 + (i % 4) * 0.5, 1);
        s.position.set(p.mesh.position.x + ((i % 7) - 3) * 1.8, 1.2 + Math.floor(i / 7) * 2, Z_WALL - 0.5);
        s.userData = { vx: ((i % 7) - 3) * 0.9 + (from || 0) * 0.5, vy: 6 + (i % 5) * 1.5, vz: -9 - (i % 4) * 3, rx: (i % 3) - 1, ry: (i % 5) - 2, t: 0 };
      });
      burst(p.mesh.position.x, 4, Z_WALL + 1);
      S.shake = 1;
    }

    function step(dt, tNow) {
      const rv = S.rv;
      for (const t of trolleys) for (const w of t.wheels) w.rotation.x += dt * (6 + S.v * 0.5);
      if (S.phase === "play" && S.q) {
        const tau = clamp((tNow - S.q.startedAt) / Math.max(1, S.q.endsAt - S.q.startedAt), 0, 1);
        const z = Z_FORK + gapAt(tau);
        for (const t of trolleys) {
          t.g.position.z = z; t.g.position.y = Math.sin(tNow / 60 + t.x0) * 0.04 * (0.4 + S.v / 40);
          t.g.position.x += (t.x0 + t.lean * 0.9 - t.g.position.x) * clamp(dt * 8, 0, 1);
          t.g.rotation.z += (-t.lean * 0.12 + Math.sin(tNow / 130 + t.x0) * 0.02 - t.g.rotation.z) * clamp(dt * 8, 0, 1);
          if (S.v > 14) { t.sparkT -= dt; if (t.sparkT <= 0) { t.sparkT = 0.05; spark(t.g.position.x + (rnd() < 0.5 ? -1 : 1), 0.25, z + 1.4, 0); } }
        }
      } else if (S.phase === "reveal" && rv) {
        const el = tNow - S.revealAt;
        for (const t of trolleys) {
          if (t.state === "run") {
            const k = clamp((tNow - t.t0) / t.dur, 0, 1), zEnd = t.side ? Z_WALL + 2.3 : Z_FORK - 3.5;     // 壁・中央の柱の手前まで
            const z = t.zStart + (zEnd - t.zStart) * (0.3 * k + 0.7 * k * k);
            t.g.position.z = z; t.g.position.x = pathAt(t, z); t.g.position.y = 0.02;
            t.g.rotation.y = -Math.atan2(pathAt(t, z - 0.5) - pathAt(t, z + 0.5), 1) * 0.9;
            t.sparkT -= dt; if (t.sparkT <= 0) { t.sparkT = 0.03; spark(t.g.position.x + (rnd() < 0.5 ? -1 : 1), 0.25, z + 1.4, 0); }
            if (k >= 1) {
              t.state = t.ok ? "win" : "crash"; t.t0 = tNow;
              const pn = panels[t.side === -1 ? 0 : 1];
              if (t.ok && t.side && !pn.broken) shatter(pn, t.side);
              if (t.ok) { setMark(t, "⭕"); S.shake = Math.max(S.shake, 0.7); }
              else { setMark(t, "💥"); t.vz = 9; t.vy = 7; t.spin = (t.x0 > 0 ? 1 : -1) * 5; S.shake = Math.max(S.shake, 1); for (let i = 0; i < 10; i++) spark(t.g.position.x, 1, t.g.position.z - 1.5, -5); }
            }
          } else if (t.state === "win") {
            const a = tNow - t.t0;
            t.g.position.z = Math.max(Z_WALL - 22, t.g.position.z - dt * 16 * Math.max(0.15, 1 - a / 1400));
            t.g.position.y = Math.abs(Math.sin(a / 140)) * 0.45 * Math.max(0, 1 - a / 1200);
            t.mark.position.y = 3.9 + Math.sin(a / 160) * 0.25;
          } else if (t.state === "crash") {
            t.vy -= 22 * dt; t.g.position.y += t.vy * dt; t.g.position.z += t.vz * dt; t.vz *= 0.97;
            t.g.rotation.z += t.spin * dt; t.g.rotation.x += 2.4 * dt;
            if (t.g.position.y < -9) { t.g.position.y = -9; t.vy = 0; }
          }
        }
        if (el > 1700) panels.forEach((p, i) => { if (p.mesh.visible && i === (rv.a === 0 ? 0 : 1)) p.mesh.material.emissive.setHex(0x1f8f3a); else if (p.mesh.visible) p.mesh.material.emissive.setHex(0x6a1010); });
        if (el > REVEAL_MS + 1200) S.idleAt = tNow;
      }
      // 破片・火花・紙ふぶき
      for (const p of panels) for (const s of p.shards) if (s.visible) {
        const u = s.userData; u.t += dt; u.vy -= 20 * dt;
        s.position.x += u.vx * dt; s.position.y += u.vy * dt; s.position.z += u.vz * dt * Math.max(0.1, 1 - u.t);
        s.rotation.x += u.rx * dt * 3; s.rotation.y += u.ry * dt * 3;
        if (s.position.y < -2 || u.t > 2.4) s.visible = false;
      }
      for (const m of sparks) if (m.visible) { const u = m.userData; u.t += dt; u.vy -= 16 * dt; m.position.x += u.vx * dt; m.position.y = Math.max(0.1, m.position.y + u.vy * dt); m.position.z += u.vz * dt; if (u.t > 0.5) m.visible = false; }
      for (const m of confetti) if (m.visible) { const u = m.userData; u.t += dt; u.vy -= 14 * dt; m.position.x += u.vx * dt; m.position.y += u.vy * dt; m.position.z += u.vz * dt; m.rotation.x += u.rx * dt; m.rotation.y += u.ry * dt; if (u.t > 2.2 || m.position.y < -1) m.visible = false; }

      // カメラ: トロッコを後ろから追う。速いほど遠く・視野が広い
      let zs = 0, xs = 0, cnt = 0;
      for (const t of trolleys) { if (t.state === "crash" && t.g.position.y < -1) continue; zs += t.g.position.z; xs += t.g.position.x; cnt++; }
      if (cnt) { S.lastTz = zs / cnt; S.lastTx = xs / cnt; }
      const back = 8.8 + clamp(S.v / 60, 0, 1) * 3.2;
      S.camZ += ((S.lastTz + back) - S.camZ) * clamp(dt * 9, 0, 1);
      const vNow = Math.abs(S.camZ - S.prevCamZ) / Math.max(dt, 0.001); S.prevCamZ = S.camZ;
      S.v += (vNow - S.v) * clamp(dt * 6, 0, 1);
      const vf = clamp(S.v / 80, 0, 1);
      S.fov += ((56 + vf * 30) - S.fov) * clamp(dt * 5, 0, 1);
      if (Math.abs(camera.fov - S.fov) > 0.05) { camera.fov = S.fov; camera.updateProjectionMatrix(); }
      const sh = (S.shake > 0 ? (Math.random() - 0.5) * 0.5 * S.shake : 0) + (Math.random() - 0.5) * 0.06 * vf;
      S.shake = Math.max(0, S.shake - dt * 1.8);
      camera.position.set(S.lastTx * 0.35 + sh, 4.3 - vf * 0.5 + sh * 0.6, S.camZ);
      camera.lookAt(S.lastTx * 0.6, 1.6, S.camZ - 20);
      // 流線: カメラのまわりに置いて、うしろへ飛びさったら前へ戻す。速いほど長く・濃く
      streakMat.opacity = clamp((S.v - 10) / 38, 0, 0.9);
      const len = 1 + S.v * 0.16;
      for (const m of streaks) {
        const u = m.userData;
        if (m.position.z > camera.position.z + 6 || !u.init) { u.init = 1; m.position.set((rnd() - 0.5) * 34, 0.3 + rnd() * 9, camera.position.z - 18 - rnd() * 60); }
        m.scale.z = len;
      }
    }

    function frame(ts) {
      S.raf = 0;
      if (!S.running) return;
      const dt = Math.min(0.05, (ts - (S.last || ts)) / 1000);
      if (ts - S.last >= 24) {                     // 40fps まで
        S.last = ts;
        const tNow = now();
        step(dt || 0.025, tNow);
        renderer.render(scene, camera);
        if (S.phase === "idle" || (S.phase === "reveal" && S.idleAt && tNow - S.idleAt > 2500)) { S.running = false; return; }
      }
      S.raf = root.requestAnimationFrame(frame);
    }
    function start() { S.idleAt = 0; if (!S.running) { S.running = true; S.last = 0; } if (!S.raf) S.raf = root.requestAnimationFrame(frame); }
    function stop() { S.running = false; if (S.raf) root.cancelAnimationFrame(S.raf); S.raf = 0; }

    function resize() {
      const c = opts.canvas, w = c.clientWidth || 320, h = c.clientHeight || 220;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
    function dispose() {
      stop();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      renderer.dispose();
    }

    setTheme("en");
    resize();
    // 開始前の1枚
    for (const t of trolleys) t.g.position.set(t.x0, 0, Z0);
    camera.position.set(0, 5.0, Z0 + 10.5); camera.lookAt(0, 1.7, Z0 - 20); renderer.render(scene, camera);
    return { question, answered, reveal, idle, resize, dispose, stop };
  }

  root.DuoScene = { create, pretty, THEME };
})(window);
