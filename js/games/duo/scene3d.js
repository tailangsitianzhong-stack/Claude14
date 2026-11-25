/**
 * 二択クイズの3Dシーン(Three.js)。トロッコに乗って分かれ道へ進み、左右のパネルのどちらかへ突っこむ。
 *
 *   const sc = DuoScene.create({ canvas, players:[{id, avatar}], myId, now: () => serverNow });   // WebGL が使えなければ null
 *   sc.question({ s:"en", labels:[左, 右], startedAt, endsAt })   // 新しい問題(トロッコがスタート位置にもどる)
 *   sc.answered(pid, side)       // 答えた(自分のトロッコだけ、選んだ側へかたむく。他の人の選択は、答え合わせまで見せない)
 *   sc.reveal({ a, picks, ok })  // 答え合わせ: 正解の側のパネルを、正解の人のトロッコがつき破る。まちがい・時間切れは、かたい壁・仕切りにぶつかる
 *   sc.idle()                    // 開始前・終了後
 *   sc.resize() / sc.dispose()
 *
 * 省電力: 描画は、動きのある間(問題の間・答え合わせ)だけ。40fps まで。影なし・低ポリゴン・画素密度は 1.75 まで。
 * 3Dのパネルの文字は、見た目のため(読みやすい全文は、画面のボタンに出る)。
 */
(function (root) {
  "use strict";

  const THEME = {
    en: { sky: 0x8fb4ff, wall: "#2f6fe4", name: "ENGLISH" },
    chem: { sky: 0x8fe0b4, wall: "#12a76a", name: "CHEMISTRY" },
    phys: { sky: 0xffc48a, wall: "#e8782a", name: "PHYSICS" },
    geo: { sky: 0xf2dc7e, wall: "#c99a14", name: "GEOGRAPHY" }
  };
  const Z0 = 7, Z_WAIT = -4, Z_FORK = -14, Z_WALL = -33, BRANCH_X = 9.5;
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
    scene.fog = new THREE.Fog(THEME.en.sky, 30, 70);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(-6, 14, 8); scene.add(sun);

    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));

    /* ---------- 線路(広い床 + まくら木) ---------- */
    const world = new THREE.Group(); scene.add(world);
    const floor = box(13, 0.4, 28, 0x555a66); floor.position.set(0, -0.2, -4); world.add(floor);
    const sleepers = new THREE.Group(); world.add(sleepers);
    for (let z = 9; z > -14; z -= 1.6) { const s = box(12, 0.12, 0.5, 0x8a6a46); s.position.set(0, 0.04, z); sleepers.add(s); }
    const rail = (x, z0, z1) => { const r = box(0.18, 0.2, Math.abs(z1 - z0), 0xc9ced8); r.position.set(x, 0.18, (z0 + z1) / 2); return r; };
    for (const x of [-5.3, -2.1, 2.1, 5.3]) world.add(rail(x, 10, Z_FORK));
    const branches = [];
    for (const side of [-1, 1]) {
      const len = Math.hypot(BRANCH_X, Math.abs(Z_WALL - Z_FORK)) + 2, ang = Math.atan2(BRANCH_X, Math.abs(Z_WALL - Z_FORK));
      const g = new THREE.Group();
      g.position.set(side * BRANCH_X / 2, 0, (Z_FORK + Z_WALL) / 2);
      g.rotation.y = side * ang;
      const fl = box(13, 0.4, len, 0x555a66); fl.position.y = -0.21; g.add(fl);
      for (let i = -len / 2 + 1; i < len / 2; i += 1.6) { const s = box(12, 0.12, 0.5, 0x8a6a46); s.position.set(0, 0.03, i); g.add(s); }
      for (const x of [-5.3, -2.1, 2.1, 5.3]) { const r = box(0.18, 0.2, len, 0xc9ced8); r.position.set(x, 0.17, 0); g.add(r); }
      world.add(g); branches.push(g);
    }
    // 分かれ道の中央の柱(時間切れで、ここにぶつかる)
    const pillar = box(4.2, 3.6, 3.2, 0x3a3f4a); pillar.position.set(0, 1.8, Z_FORK - 4.5); world.add(pillar);
    const stripe = box(4.3, 0.9, 3.3, 0xf4c20d); stripe.position.set(0, 1.2, Z_FORK - 4.5); world.add(stripe);
    // 道ばたの柱(流れる景色)
    const posts = [];
    for (let z = 12; z > -36; z -= 5) for (const x of [-9.5, 9.5]) { const p = box(0.6, 3 + ((z * 7) & 3), 0.6, 0x6b7385); p.position.set(x * (z < Z_FORK ? 1.9 : 1), 1.5, z); world.add(p); posts.push(p); }

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
    for (const side of [-1, 1]) {
      const m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: null });
      const p = new THREE.Mesh(new THREE.BoxGeometry(13, 8.5, 1), m);
      p.position.set(side * BRANCH_X, 4.25, Z_WALL - 0.5);
      world.add(p);
      panels.push({ mesh: p, side, shards: [], broken: false });
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
    const trolleys = players.map((p, i) => {
      const g = new THREE.Group();
      const body = box(2, 0.9, 2.8, COLORS[i % 4]); body.position.y = 0.85; g.add(body);
      const rim = box(2.2, 0.18, 3, 0xffffff); rim.position.y = 1.35; g.add(rim);
      const wheels = [];
      for (const [x, z] of [[-1, -0.9], [1, -0.9], [-1, 0.9], [1, 0.9]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 12), mat(0x222222)); w.rotation.z = Math.PI / 2; w.position.set(x, 0.4, z); g.add(w); wheels.push(w);
      }
      const face = emojiSprite(p.avatar || "🙂"); face.position.set(0, 2.2, 0); g.add(face);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3ddc84 })); lamp.position.set(0, 3.5, 0); lamp.visible = false; g.add(lamp);
      const mark = emojiSprite(""); mark.position.set(0, 3.9, 0); mark.visible = false; g.add(mark);
      world.add(g);
      return { id: p.id, g, wheels, lamp, mark, face, x0: laneX[i], lean: 0, pick: null, state: "wait", t0: 0, side: 0, ok: false, vy: 0, vz: 0, spin: 0 };
    });
    const byId = new Map(trolleys.map((t) => [t.id, t]));
    const markTex = {};
    function setMark(t, ch) {
      if (!markTex[ch]) { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); g.font = "96px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 64, 72); markTex[ch] = new THREE.CanvasTexture(c); }
      t.mark.material.map = markTex[ch]; t.mark.material.needsUpdate = true; t.mark.visible = true;
    }

    /* ---------- 状態 ---------- */
    const S = { q: null, phase: "idle", revealAt: 0, rv: null, shake: 0, running: false, raf: 0, last: 0, idleAt: 0, camZ: Z_WAIT, confetti: [] };

    function pathAt(t, z) {                 // 選んだ側へ曲がる道すじ: z での x
      if (!t.side) return t.x0;
      const k = clamp((Z_FORK - z) / (Z_FORK - Z_WALL), 0, 1);
      return t.x0 + (t.side * BRANCH_X - t.x0) * ease(k) * (z < Z_FORK ? 1 : 0);
    }

    function question(q) {
      S.q = q; S.phase = "play"; S.rv = null; S.shake = 0;
      const th = THEME[q.s] || THEME.en;
      scene.background.setHex(th.sky); scene.fog.color.setHex(th.sky);
      panels.forEach((p, i) => {
        const text = pretty(q.labels[i]);
        if (p.mesh.material.map) p.mesh.material.map.dispose();
        p.mesh.material.map = panelTexture(text, th.wall); p.mesh.material.color.setHex(0xffffff); p.mesh.material.emissive && p.mesh.material.emissive.setHex(0x000000);
        p.mesh.material.needsUpdate = true; p.mesh.visible = true; p.broken = false;
        for (const s of p.shards) s.visible = false;
      });
      for (const t of trolleys) {
        t.state = "wait"; t.side = 0; t.pick = null; t.lean = 0; t.lamp.visible = false; t.mark.visible = false;
        t.g.rotation.set(0, 0, 0); t.g.position.set(t.x0, 0, Z0); t.vy = 0; t.vz = 0; t.spin = 0; t.face.visible = true;
      }
      for (const c of S.confetti) c.visible = false;
      S.camZ = Z0 + 2; S.lastTz = Z0; S.lastTx = 0;
      start();
    }

    function answered(pid, side) {
      const t = byId.get(pid); if (!t) return;
      t.lamp.visible = true;
      if (pid === opts.myId && (side === 0 || side === 1)) t.lean = side === 0 ? -1 : 1;
      start();
    }

    function reveal(rv) {
      S.phase = "reveal"; S.revealAt = now(); S.rv = rv;
      for (const t of trolleys) {
        const pk = rv.picks[t.id];
        t.side = pk === 0 ? -1 : pk === 1 ? 1 : 0;
        t.ok = !!rv.ok[t.id]; t.state = "run"; t.t0 = now(); t.lean = 0; t.lamp.visible = false;
        t.zStart = t.g.position.z; t.vy = 0; t.vz = 0; t.spin = 0;
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
      S.shake = 1;
    }

    function step(dt, tNow) {
      const rv = S.rv;
      // 流れる景色
      for (const t of trolleys) for (const w of t.wheels) w.rotation.x += dt * 8;
      if (S.phase === "play" && S.q) {
        const p = clamp((tNow - S.q.startedAt) / Math.max(1, S.q.endsAt - S.q.startedAt), 0, 1);
        const z = Z0 + (Z_WAIT - Z0) * (1 - (1 - p) * (1 - p));
        for (const t of trolleys) {
          t.g.position.z = z; t.g.position.y = Math.sin(tNow / 90 + t.x0) * 0.03;
          t.g.position.x += (t.x0 + t.lean * 0.9 - t.g.position.x) * clamp(dt * 8, 0, 1);
          t.g.rotation.z += (-t.lean * 0.12 - t.g.rotation.z) * clamp(dt * 8, 0, 1);
        }
      } else if (S.phase === "reveal" && rv) {
        const el = tNow - S.revealAt;
        for (const t of trolleys) {
          if (t.state === "run") {
            const k = clamp(el / 1500, 0, 1), zEnd = t.side ? Z_WALL + 1.8 : Z_FORK - 1.7;     // 壁・中央の柱の手前まで
            const z = t.zStart + (zEnd - t.zStart) * (k * k);
            t.g.position.z = z; t.g.position.x = pathAt(t, z); t.g.position.y = 0.02;
            t.g.rotation.y = -Math.atan2(pathAt(t, z - 0.5) - pathAt(t, z + 0.5), 1) * 0.9;
            if (k >= 1) {
              t.state = t.ok ? "win" : "crash"; t.t0 = tNow;
              const pn = panels[t.side === -1 ? 0 : 1];
              if (t.ok && t.side && !pn.broken) shatter(pn, t.side);
              if (t.ok) { setMark(t, "⭕"); S.shake = Math.max(S.shake, 0.7); }
              else { setMark(t, "💥"); t.vz = 9; t.vy = 7; t.spin = (t.x0 > 0 ? 1 : -1) * 5; S.shake = Math.max(S.shake, 1); }
            }
          } else if (t.state === "win") {
            const a = tNow - t.t0;
            t.g.position.z = Math.max(Z_WALL - 7, t.g.position.z - dt * 9 * Math.max(0, 1 - a / 900));
            t.g.position.y = Math.abs(Math.sin(a / 140)) * 0.45 * Math.max(0, 1 - a / 1200);
            t.mark.position.y = 3.9 + Math.sin(a / 160) * 0.25;
          } else if (t.state === "crash") {
            t.vy -= 22 * dt; t.g.position.y += t.vy * dt; t.g.position.z += t.vz * dt; t.vz *= 0.97;
            t.g.rotation.z += t.spin * dt; t.g.rotation.x += 2.4 * dt;
            if (t.g.position.y < -9) { t.g.position.y = -9; t.vy = 0; }
          }
        }
        // 正解の側を光らせる(答え合わせの終わりに)
        if (el > 1700) panels.forEach((p, i) => { if (p.mesh.visible && i === (rv.a === 0 ? 0 : 1)) p.mesh.material.emissive.setHex(0x1f8f3a); else if (p.mesh.visible) p.mesh.material.emissive.setHex(0x6a1010); });
        if (el > REVEAL_MS + 1200) S.idleAt = tNow;
      }
      // 破片
      for (const p of panels) for (const s of p.shards) if (s.visible) {
        const u = s.userData; u.t += dt; u.vy -= 20 * dt;
        s.position.x += u.vx * dt; s.position.y += u.vy * dt; s.position.z += u.vz * dt * Math.max(0.1, 1 - u.t);
        s.rotation.x += u.rx * dt * 3; s.rotation.y += u.ry * dt * 3;
        if (s.position.y < -2 || u.t > 2.4) s.visible = false;
      }
      // カメラ: トロッコを後ろから追う
      let zs = 0, xs = 0, cnt = 0;
      for (const t of trolleys) { if (t.state === "crash" && t.g.position.y < -1) continue; zs += t.g.position.z; xs += t.g.position.x; cnt++; }
      if (cnt) { S.lastTz = zs / cnt; S.lastTx = xs / cnt; }          // 全員が落ちたあとは、最後の位置をうつす(カメラが壁や柱の中に入らないように)
      const tz = S.lastTz != null ? S.lastTz : Z_WAIT, tx = S.lastTx || 0;
      S.camZ += ((tz + 11.5) - S.camZ) * clamp(dt * 4, 0, 1);
      const sh = S.shake > 0 ? (Math.random() - 0.5) * 0.5 * S.shake : 0; S.shake = Math.max(0, S.shake - dt * 1.8);
      camera.position.set(tx * 0.35 + sh, 5.2 + sh * 0.6, S.camZ);
      camera.lookAt(tx * 0.6, 1.6, S.camZ - 20);
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

    resize();
    // 開始前の1枚
    camera.position.set(0, 5.2, Z0 + 4.5); camera.lookAt(0, 1.6, Z0 - 16); renderer.render(scene, camera);
    return { question, answered, reveal, idle, resize, dispose, stop };
  }

  root.DuoScene = { create, pretty, THEME };
})(window);
