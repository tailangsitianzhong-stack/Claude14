/**
 * 地理クイズ「地図で選ぶ」の表示: 世界地図(国)・日本地図(都道府県)を、拡大縮小・移動しながらタップして選ぶ。
 * タップすると「〇〇でOK？ [決定][キャンセル]」が出て、決定すると変えられない。時間が来たら(全員が決定したら)、
 * 全員の選択を一斉に地図の上に開示して答え合わせをする。(GeoBoard から呼ばれる。root.GeoViews.map)
 *
 * 操作: ドラッグ=移動 / ピンチ・＋－ボタン・ホイール=拡大縮小 / 地域ボタン=その地域にズーム
 * 地図データ(window.GEO_MAP)は tools/build-geo-map.mjs が作る。パスは viewBox の座標で、viewBox を動かして拡大縮小する。
 * 省電力: 動くのは操作している間だけ(アニメーションなし)。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_ZOOM = 24;
  const REGIONS = ["アジア", "ヨーロッパ", "アフリカ", "北アメリカ", "南アメリカ", "オセアニア"];

  function create(ctx) {
    const { stage, myId, data, avatarOf } = ctx;
    const M = root.GEO_MAP;
    const u = { qid: "", mapKey: "", svg: null, box: null, cx: 0, cy: 0, zoom: 1, baseW: 1, bw: 1, bh: 1, sel: null, locked: false, ptrs: new Map(), pinch: 0, moved: 0, down: null, v: null };
    const names = new Map(data.countries.map((c) => [c[0], c[1]]));
    for (const p of data.prefs) names.set(p[0], p[1]);
    const contOf = new Map(data.countries.map((c) => [c[0], c[3]]));

    /* ---------- 表示範囲(viewBox)の計算 ---------- */
    const map = () => M[u.mapKey];
    function metrics() {
      const r = u.box.getBoundingClientRect();
      u.bw = Math.max(1, r.width); u.bh = Math.max(1, r.height);
      const m = map(), ratio = u.bw / u.bh;
      u.baseW = Math.max(m.w, m.h * ratio);                   // 倍率1で、地図ぜんぶが入る幅
    }
    function clamp() {
      const m = map(), ratio = u.bw / u.bh;
      const visW = u.baseW / u.zoom, visH = visW / ratio;
      u.cx = Math.max(-visW * 0.1, Math.min(u.cx, m.w + visW * 0.1));
      u.cy = Math.max(-visH * 0.1, Math.min(u.cy, m.h + visH * 0.1));
    }
    function apply() {
      const m = map(), ratio = u.bw / u.bh;
      u.zoom = Math.max(1, Math.min(MAX_ZOOM, u.zoom));
      clamp();
      const visW = u.baseW / u.zoom, visH = visW / ratio;
      u.svg.setAttribute("viewBox", `${(u.cx - visW / 2).toFixed(1)} ${(u.cy - visH / 2).toFixed(1)} ${visW.toFixed(1)} ${visH.toFixed(1)}`);
      const unit = visW / u.bw;                                // 1pxあたりの地図の長さ
      u.svg.querySelectorAll(".mk").forEach((c) => { c.setAttribute("r", (4.5 * unit).toFixed(2)); c.setAttribute("stroke-width", (1.2 * unit).toFixed(2)); });
      u.svg.querySelectorAll(".mh").forEach((c) => c.setAttribute("r", (13 * unit).toFixed(2)));        // タップできる範囲は大きめ
      u.svg.querySelectorAll(".pin").forEach((t) => t.setAttribute("font-size", (17 * unit).toFixed(2)));
      u.svg.style.setProperty("--unit", unit.toFixed(3));
      return m;
    }
    function fitBox(x0, y0, x1, y1) {
      const ratio = u.bw / u.bh;
      const visW = Math.max((x1 - x0) * 1.25, (y1 - y0) * 1.25 * ratio, u.baseW / MAX_ZOOM);
      u.zoom = u.baseW / visW; u.cx = (x0 + x1) / 2; u.cy = (y0 + y1) / 2;
      apply();
    }
    const zoomAt = (factor, px, py) => {                       // 画面上の点(px,py)を中心にして拡大縮小
      const ratio = u.bw / u.bh, visW = u.baseW / u.zoom, visH = visW / ratio;
      const mx = u.cx - visW / 2 + (px / u.bw) * visW, my = u.cy - visH / 2 + (py / u.bh) * visH;
      u.zoom = Math.max(1, Math.min(MAX_ZOOM, u.zoom * factor));
      const nW = u.baseW / u.zoom, nH = nW / ratio;
      u.cx = mx - (px / u.bw) * nW + nW / 2; u.cy = my - (py / u.bh) * nH + nH / 2;
      apply();
    };
    function regionBox(cont) {
      const pts = Object.entries(map().cent).filter(([id]) => contOf.get(id) === cont).map(([, p]) => p);
      if (!pts.length) return null;
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    }

    /* ---------- 地図の組み立て ---------- */
    function build(v) {
      u.mapKey = v.q.map;
      const m = map();
      stage.innerHTML = `
        <div class="geo-q">${Ruby.html(esc(v.q.text))}</div>
        <div class="geo-mapbox ${v.q.map}" id="geo-mapbox">
          <svg class="geo-svg" xmlns="${NS}" preserveAspectRatio="xMidYMid meet" aria-label="地図">
            <rect class="sea" x="-5000" y="-5000" width="10000" height="10000"/>
            <g class="shapes">${m.shapes.map(([id, d]) => `<path d="${d}" data-id="${esc(id)}" class="sh${id ? " ok" : ""}" fill-rule="evenodd"/>`).join("")}</g>
            <g class="marks">${(m.marks || []).map(([id, x, y]) => `<circle class="mk" data-id="${esc(id)}" cx="${x}" cy="${y}" r="3"/><circle class="mh" data-id="${esc(id)}" cx="${x}" cy="${y}" r="9"/>`).join("")}</g>
            <g class="pins"></g>
          </svg>
          <div class="geo-zoom"><button type="button" data-z="in" aria-label="拡大">＋</button><button type="button" data-z="out" aria-label="縮小">－</button><button type="button" data-z="all" aria-label="全体">⌂</button></div>
          <div class="geo-pop" id="geo-pop" hidden></div>
        </div>
        ${v.q.map === "world" ? `<div class="geo-regions">${REGIONS.map((r) => `<button type="button" class="geo-region" data-r="${r}">${r}</button>`).join("")}</div>` : ""}
        <p class="note geo-maphelp">${Ruby.html("ドラッグで移動{いどう}・ピンチで拡大{かくだい}。小{ちい}さな国{くに}は●をタップ")}</p>`;
      Ruby.apply(stage);
      u.box = stage.querySelector("#geo-mapbox"); u.svg = u.box.querySelector("svg");
      metrics(); u.zoom = 1; u.cx = m.w / 2; u.cy = m.h / 2; apply();
      bind();
      u.sel = null; u.locked = false; u.qid = v.q.id;
    }

    /* ---------- 操作 ---------- */
    function idAt(x, y) {
      const el = document.elementFromPoint(x, y);
      const t = el && el.closest && el.closest("[data-id]");
      return t ? t.getAttribute("data-id") : null;
    }
    function pick(id) {
      const pop = stage.querySelector("#geo-pop");
      if (u.locked || !u.v || u.v.phase !== "play") return;
      if (!id || !names.has(id)) { ctx.say && ctx.say("そこは選{えら}べないよ", ""); return; }
      u.sel = id;
      u.svg.querySelectorAll(".sel").forEach((e) => e.classList.remove("sel"));
      u.svg.querySelectorAll(`[data-id="${id}"]`).forEach((e) => e.classList.add("sel"));
      pop.innerHTML = `<span class="nm">${esc(names.get(id))}</span><span>でOK？</span><button type="button" class="btn btn-small btn-primary" data-a="ok">決定</button><button type="button" class="btn btn-small" data-a="no">キャンセル</button>`;
      pop.hidden = false;
      root.Sfx.play("tap");
    }
    function clearSel() {
      u.sel = null;
      u.svg.querySelectorAll(".sel").forEach((e) => e.classList.remove("sel"));
      stage.querySelector("#geo-pop").hidden = true;
    }
    function bind() {
      const box = u.box, svg = u.svg;
      svg.style.touchAction = "none";
      svg.addEventListener("pointerdown", (e) => {
        svg.setPointerCapture(e.pointerId);
        u.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (u.ptrs.size === 1) { u.moved = 0; u.down = { x: e.clientX, y: e.clientY, t: Date.now() }; }
        else { u.pinch = dist(); u.moved = 99; }
      });
      svg.addEventListener("pointermove", (e) => {
        const p = u.ptrs.get(e.pointerId); if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (u.ptrs.size === 1) {
          u.moved += Math.abs(dx) + Math.abs(dy);
          if (u.moved > 8) { const unit = (u.baseW / u.zoom) / u.bw; u.cx -= dx * unit; u.cy -= dy * unit; apply(); }
        } else if (u.ptrs.size === 2) {
          const d = dist(), mid = midpoint(), r = box.getBoundingClientRect();
          if (u.pinch) zoomAt(d / u.pinch, mid.x - r.left, mid.y - r.top);
          u.pinch = d;
        }
      });
      const up = (e) => {
        const had = u.ptrs.delete(e.pointerId);
        if (had && u.ptrs.size === 0 && u.moved <= 8 && u.down && Date.now() - u.down.t < 700) pick(idAt(e.clientX, e.clientY));
        if (u.ptrs.size < 2) u.pinch = 0;
      };
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointercancel", (e) => { u.ptrs.delete(e.pointerId); u.pinch = 0; });
      svg.addEventListener("wheel", (e) => { e.preventDefault(); const r = box.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.3 : 1 / 1.3, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      box.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.z;
        if (k === "all") { u.zoom = 1; u.cx = map().w / 2; u.cy = map().h / 2; apply(); } else zoomAt(k === "in" ? 1.6 : 1 / 1.6, u.bw / 2, u.bh / 2);
      }));
      stage.querySelectorAll(".geo-region").forEach((b) => b.addEventListener("click", () => { const r = regionBox(b.dataset.r); if (r) fitBox(...r); }));
      stage.querySelector("#geo-pop").addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "no") { clearSel(); return; }
        if (!u.sel || u.locked || !u.v || u.v.phase !== "play") return;
        u.locked = true;
        stage.querySelector("#geo-pop").innerHTML = `<span class="nm">${esc(names.get(u.sel))}</span><span>に決定！</span>`;
        u.svg.querySelectorAll(`[data-id="${u.sel}"]`).forEach((x) => x.classList.add("locked"));
        if (ctx.actions.lock) ctx.actions.lock(u.sel);
      });
    }
    const pts = () => [...u.ptrs.values()];
    const dist = () => { const [a, b] = pts(); return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
    const midpoint = () => { const [a, b] = pts(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

    /* ---------- 状態の反映 ---------- */
    function update(v) {
      u.v = v;
      if (!v.q) { stage.innerHTML = `<div class="geo-wait">${Ruby.html("よーい…")}</div>`; u.qid = ""; return; }
      if (u.qid !== v.q.id) { if (!M) { stage.innerHTML = "地図データがありません"; return; } build(v); }
      if (!u.locked && v.answers && v.answers[myId] && v.phase === "play") {   // 再接続などで、すでに決定済み
        u.locked = true; stage.querySelector("#geo-pop").hidden = true;
      }
      if (v.phase === "between" && v.reveal && !u.revealed) showReveal(v);
      if (v.phase === "play") u.revealed = false;
    }

    /** 答え合わせ: 正解の場所を光らせ、全員の選択をアバターの目印で出す */
    function showReveal(v) {
      u.revealed = true;
      const rv = v.reveal, m = map();
      clearSel();
      stage.querySelector("#geo-pop").hidden = true;
      u.svg.querySelectorAll(".locked").forEach((e) => e.classList.remove("locked"));
      u.svg.querySelectorAll(`[data-id="${rv.target}"]`).forEach((e) => e.classList.add("target"));
      const pins = u.svg.querySelector(".pins");
      pins.innerHTML = "";
      const used = {};
      for (const [pid, id] of Object.entries(rv.picks)) {
        const c = m.cent[id]; if (!c) continue;
        const n = used[id] = (used[id] || 0) + 1;
        const t = document.createElementNS(NS, "text");
        t.setAttribute("class", "pin"); t.setAttribute("x", c[0] + (n - 1) * 14); t.setAttribute("y", c[1]); t.setAttribute("text-anchor", "middle");
        t.textContent = avatarOf(pid);
        pins.appendChild(t);
      }
      const star = document.createElementNS(NS, "text");
      const tc = m.cent[rv.target];
      if (tc) { star.setAttribute("class", "pin"); star.setAttribute("x", tc[0]); star.setAttribute("y", tc[1] - 20); star.setAttribute("text-anchor", "middle"); star.textContent = "⭐"; pins.appendChild(star); }
      // 正解の場所にズーム(世界地図は広めに)
      if (tc) { const w = v.q.map === "japan" ? 160 : 260; fitBox(tc[0] - w / 2, tc[1] - w / 3, tc[0] + w / 2, tc[1] + w / 3); } else apply();
    }

    function revealHtml(v) {
      const rv = v.reveal;
      const picks = v.players.map((p) => {
        const id = rv.picks[p.id];
        return `<span class="geo-pickline">${esc(avatarOf(p.id))} ${id ? `${esc(names.get(id) || id)} ${id === rv.target ? "⭕" : "❌"}` : "（未決定）"}</span>`;
      }).join(" ");
      return `正解{せいかい}は <b>${esc(rv.name)}</b><br><small>${picks}</small>`;
    }

    function unbusy() {
      if (u.locked && !(u.v && u.v.answers && u.v.answers[myId]) && u.v && u.v.phase === "play") {
        u.locked = false;
        u.svg.querySelectorAll(".locked").forEach((e) => e.classList.remove("locked"));
        clearSel();
      }
    }

    const timer = (v, now) => (v.endsAt ? { rem: Math.max(0, v.endsAt - now), total: v.endsAt - v.startedAt } : null);
    return { update, revealHtml, timer, unbusy };
  }

  root.GeoViews = root.GeoViews || {};
  root.GeoViews.map = { create };
})(window);
