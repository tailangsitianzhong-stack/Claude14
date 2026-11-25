/**
 * 地理クイズ「資料選択」の表示: 雨温図・気温と降水量の表・写真・統計の表を見て、4択で答える。
 * (GeoBoard から呼ばれる。root.GeoViews.choice)
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LETTERS = ["A", "B", "C", "D"];

  /** 雨温図(棒=降水量・折れ線=気温)を SVG で描く */
  function climateGraph(c) {
    const W = 340, H = 220, L = 38, R = 38, T = 22, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const tMin = Math.min(...c.t), tMax = Math.max(...c.t);
    const tLo = Math.min(0, Math.floor(tMin / 10) * 10), tHi = Math.max(tLo + 20, Math.ceil(tMax / 10) * 10);
    const n = (tHi - tLo) / 10;                                          // 左の目盛りの間隔の数
    const pStep = Math.max(50, Math.ceil(Math.max(...c.p) / n / 50) * 50);
    const pHi = pStep * n;
    const yT = (t) => T + ph - ((t - tLo) / (tHi - tLo)) * ph;
    const yP = (p) => T + ph - (p / pHi) * ph;
    const x = (i) => L + ((i + 0.5) * pw) / 12;
    let s = `<svg class="geo-climate" viewBox="0 0 ${W} ${H}" role="img" aria-label="雨温図">`;
    for (let k = 0; k <= n; k++) {
      const y = T + ph - (k / n) * ph;
      s += `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" class="grid"/>`;
      s += `<text x="${L - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="axis t">${tLo + k * 10}</text>`;
      s += `<text x="${W - R + 4}" y="${(y + 3).toFixed(1)}" text-anchor="start" class="axis p">${k * pStep}</text>`;
    }
    s += `<text x="${L - 4}" y="${T - 8}" text-anchor="end" class="axis t unit">℃</text><text x="${W - R + 4}" y="${T - 8}" class="axis p unit">mm</text>`;
    c.p.forEach((p, i) => { s += `<rect x="${(x(i) - pw / 12 * 0.32).toFixed(1)}" y="${yP(p).toFixed(1)}" width="${(pw / 12 * 0.64).toFixed(1)}" height="${(T + ph - yP(p)).toFixed(1)}" class="bar"/>`; });
    s += `<polyline points="${c.t.map((t, i) => `${x(i).toFixed(1)},${yT(t).toFixed(1)}`).join(" ")}" class="line"/>`;
    c.t.forEach((t, i) => { s += `<circle cx="${x(i).toFixed(1)}" cy="${yT(t).toFixed(1)}" r="2.6" class="dot"/>`; });
    for (let i = 0; i < 12; i++) s += `<text x="${x(i).toFixed(1)}" y="${H - B + 14}" text-anchor="middle" class="axis m">${i + 1}</text>`;
    s += `<text x="${(L + pw / 2)}" y="${H - 2}" text-anchor="middle" class="axis m">月</text>`;
    return s + "</svg>";
  }

  /** 気温と降水量の表(1〜6月・7〜12月の2段) */
  function climateTable(c) {
    const half = (from) => `<table class="geo-table"><thead><tr><th></th>${[0, 1, 2, 3, 4, 5].map((i) => `<th>${from + i + 1}月</th>`).join("")}</tr></thead><tbody>
      <tr><th>気温(℃)</th>${[0, 1, 2, 3, 4, 5].map((i) => `<td>${c.t[from + i].toFixed(1)}</td>`).join("")}</tr>
      <tr><th>降水量(mm)</th>${[0, 1, 2, 3, 4, 5].map((i) => `<td>${c.p[from + i]}</td>`).join("")}</tr></tbody></table>`;
    return half(0) + half(6);
  }

  /** ハイサーグラフ(横軸=月降水量・縦軸=月平均気温。点は1月〜12月を順につないだもの) */
  function hythergraph(c) {
    const W = 340, H = 240, L = 40, R = 14, T = 20, B = 36;
    const pw = W - L - R, ph = H - T - B;
    const tLo = Math.min(0, Math.floor(Math.min(...c.t) / 10) * 10), tHi = Math.max(tLo + 20, Math.ceil(Math.max(...c.t) / 10) * 10);
    const pStep = Math.max(50, Math.ceil(Math.max(...c.p) / 5 / 50) * 50), pHi = pStep * 5;
    const X = (p) => L + (p / pHi) * pw, Y = (t) => T + ph - ((t - tLo) / (tHi - tLo)) * ph;
    let s = `<svg class="geo-climate" viewBox="0 0 ${W} ${H}" role="img" aria-label="ハイサーグラフ">`;
    for (let t = tLo; t <= tHi; t += 10) s += `<line x1="${L}" y1="${Y(t).toFixed(1)}" x2="${W - R}" y2="${Y(t).toFixed(1)}" class="grid"/><text x="${L - 4}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end" class="axis t">${t}</text>`;
    for (let k = 0; k <= 5; k++) s += `<line x1="${X(k * pStep).toFixed(1)}" y1="${T}" x2="${X(k * pStep).toFixed(1)}" y2="${T + ph}" class="grid"/><text x="${X(k * pStep).toFixed(1)}" y="${T + ph + 13}" text-anchor="middle" class="axis p">${k * pStep}</text>`;
    s += `<text x="${L - 4}" y="${T - 7}" text-anchor="end" class="axis t unit">℃</text><text x="${W - R}" y="${H - 3}" text-anchor="end" class="axis p unit">降水量 mm</text>`;
    const pts = c.t.map((t, i) => [X(c.p[i]), Y(t)]);
    s += `<polyline points="${pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ")}" class="line"/>`;
    pts.forEach((q, i) => { s += `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="2.8" class="dot"/><text x="${(q[0] + 5).toFixed(1)}" y="${(q[1] - 4).toFixed(1)}" class="axis m">${i + 1}</text>`; });
    return s + "</svg>";
  }

  /** 統計の組み合わせ(ア〜ウの列の表) */
  function comboTable(m) {
    return `<table class="geo-table geo-combo"><thead><tr><th></th>${m.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${m.rows.map((r) => `<tr><th>${esc(r[0])}</th>${r.slice(1).map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  function create(ctx) {
    const { stage, myId, data, avatarOf } = ctx;
    const u = { qid: "", selected: -1, locked: false };

    function material(q) {
      const m = q.m;
      if (q.k === "cap" || q.k === "pref" || q.k === "basic") return "";
      if (q.k === "hyther") return hythergraph(data.climate[m.city]);
      if (q.k === "combo") return comboTable(m);
      if (q.k === "type" && m.table) return climateTable(data.climate[m.city]);
      if (q.k === "graph" || q.k === "type") return climateGraph(data.climate[m.city]);
      if (q.k === "table") return climateTable(data.climate[m.city]);
      if (q.k === "photo") {
        const ph = data.photos.find((p) => p.id === m.file);
        const cr = ph && ph.credit;
        return `<figure class="geo-figure"><img class="geo-photo" src="assets/geo/${esc(m.file)}.webp" alt="写真" decoding="async">
          <figcaption>写真: ${esc(cr ? cr.author : "")}（${esc(cr ? cr.license : "")}）</figcaption></figure>`;
      }
      if (q.k === "indic") return `<table class="geo-table geo-ind"><tbody>${m.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
      if (q.k === "pop") {
        const seg = (cls, label, v) => `<span class="seg ${cls}" style="width:${Math.max(v, 1)}%"></span>`;
        const row = (cls, label, v) => `<tr><th><i class="sw ${cls}"></i>${label}</th><td>${v} %</td></tr>`;
        return `<div class="geo-popbar" role="img" aria-label="人口構成">${seg("y", "年少", m.y)}${seg("w", "生産年齢", m.w)}${seg("o", "老年", m.o)}</div>
          <table class="geo-table geo-ind"><tbody>${row("y", "年少人口（0〜14歳）", m.y)}${row("w", "生産年齢人口（15〜64歳）", m.w)}${row("o", "老年人口（65歳以上）", m.o)}
          <tr><th>出生率（人口1000人あたり）</th><td>${m.b} 人</td></tr></tbody></table>`;
      }
      return `<table class="geo-table geo-rank"><tbody>${m.rows.map((r, i) => `<tr><th>${i + 1}位{い}</th><td>${esc(r)}</td></tr>`).join("")}</tbody></table>`;
    }

    function build(v) {
      const q = v.q;
      stage.innerHTML = `
        <div class="geo-q">${Ruby.html(esc(q.q))}</div>
        <div class="geo-material">${material(q)}</div>
        <div class="geo-choices" id="geo-choices">
          ${q.c.map((t, i) => `<button type="button" class="geo-choice" data-i="${i}"><span class="no">${LETTERS[i]}</span><span class="tx">${esc(t)}</span><span class="who"></span></button>`).join("")}
        </div>`;
      Ruby.apply(stage);
      stage.querySelectorAll(".geo-choice").forEach((b) => b.addEventListener("click", () => {
        if (u.locked || v.phase !== "play") return;
        u.selected = +b.dataset.i; u.locked = true;
        b.classList.add("is-picked");
        stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = true; });
        if (ctx.actions.choose) ctx.actions.choose(u.selected);
      }));
      u.qid = q.id; u.selected = -1; u.locked = false;
    }

    function update(v, events, newRound) {
      u.v = v;
      if (!v.q) { stage.innerHTML = `<div class="geo-wait">${Ruby.html("よーい…")}</div>`; u.qid = ""; return; }
      if (u.qid !== v.q.id) build(v);
      // 自分がすでに答えている(再接続など)。通信が切れて戻った人は、この問題は答えられない
      if (!u.locked && v.answers && v.answers[myId]) { u.locked = true; stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = true; }); }
      if (v.phase === "play" && Array.isArray(v.sit) && v.sit.includes(myId)) { u.locked = true; stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = true; }); }
      if (v.phase === "between" && v.reveal) {
        const rv = v.reveal;
        stage.querySelectorAll(".geo-choice").forEach((b) => {
          const i = +b.dataset.i;
          b.disabled = true;
          b.classList.toggle("is-correct", i === rv.a);
          b.classList.toggle("is-wrong", i !== rv.a && Object.values(rv.picks).includes(i));
          b.querySelector(".who").textContent = Object.entries(rv.picks).filter(([, pi]) => pi === i).map(([pid]) => avatarOf(pid)).join(" ");
        });
      }
    }

    function revealHtml(v) {
      const q = v.q, rv = v.reveal;
      let h = `正解{せいかい}は <b>${esc(q.c[rv.a])}</b>`;
      if (q.k === "hyther") {
        const c = data.climate[q.m.city];
        h = `正解{せいかい}は <b>${esc(q.c[rv.a])}</b><br><small>${esc(c.ty || "")}。年平均気温 ${mean(c.t).toFixed(1)}℃・年降水量 ${c.p.reduce((a, b) => a + b, 0)}mm</small>`;
      } else if (q.k === "graph" || q.k === "table" || q.k === "type") {
        const c = data.climate[q.m.city];
        h = `正解{せいかい}は <b>${esc(q.k === "type" ? q.c[rv.a] : q.c[rv.a])}</b>` + (q.k === "type" ? `<br><small>${esc(c.n)}の雨温図</small>` : "") +
          `<br><small>年平均気温 ${mean(c.t).toFixed(1)}℃・年降水量 ${c.p.reduce((a, b) => a + b, 0)}mm</small>`;
      } else if (q.k === "photo") {
        const ph = data.photos.find((p) => p.id === q.m.file);
        if (ph && ph.hint) h += `<br><small>${esc(ph.hint)}</small>`;
      }
      return h;
    }

    /** 送れなかった/断られたとき: まだ答えが届いていなければ、選び直せるようにする */
    function unbusy() {
      if (u.locked && !(u.v && u.v.answers && u.v.answers[myId]) && u.v && u.v.phase === "play" && !(Array.isArray(u.v.sit) && u.v.sit.includes(myId))) {
        u.locked = false;
        stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = false; x.classList.remove("is-picked"); });
      }
    }

    const timer = (v, now) => (v.endsAt ? { rem: Math.max(0, v.endsAt - now), total: v.endsAt - v.startedAt } : null);
    return { update, revealHtml, timer, unbusy };
  }

  root.GeoViews = root.GeoViews || {};
  root.GeoViews.choice = { create };
})(window);
