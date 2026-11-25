/**
 * 化学クイズの図(SVG文字列)を作る。画面・通信に依存しない(ブラウザ・テストで共通)。色は CSS(.chem-svg)で決める。
 *
 *   ChemDraw.chart({ xlabel, ylabel, xmax, ymax, series:[{label, pts:[[x,y]…], dash}], marks:[{x,y,text}] })  … 折れ線グラフ
 *   ChemDraw.mol({ atoms:[["C",x,y,"ラベル?"]…], bonds:[[i,j,次数(1/2/3/1.5)]…], rings:[[cx,cy,r]] })      … 構造式(骨格式)
 *   ChemDraw.periodic({ hl:["Na","K"], tags:{"Na":"A"} })                                                  … 周期表(強調・記号)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./elements.js") : root.ChemElements, typeof require === "function" ? require("./fmt.js") : root.ChemFmt);
  else root.ChemDraw = factory(root.ChemElements, root.ChemFmt);
})(typeof self !== "undefined" ? self : this, function (Elements, Fmt) {
  "use strict";

  const f1 = (x) => (Math.round(x * 10) / 10).toString();
  const esc = Fmt.esc;

  /** きれいな目盛りの間隔 */
  function niceStep(range, n) {
    const raw = range / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  const ticks = (a, b, n) => { const st = niceStep(b - a, n), out = []; for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9; v += st) out.push(Math.round(v / st) * st); return out; };
  const tnum = (v) => (Math.abs(v) >= 1e4 ? v.toExponential(0) : String(Math.round(v * 1000) / 1000));

  function chart(m) {
    const W = 360, H = 250, L = 46, R = 14, T = 16, B = 40, pw = W - L - R, ph = H - T - B;
    const xmin = m.xmin != null ? m.xmin : 0, xmax = m.xmax, ymin = m.ymin != null ? m.ymin : 0, ymax = m.ymax;
    const X = (x) => L + ((x - xmin) / (xmax - xmin)) * pw, Y = (y) => T + ph - ((y - ymin) / (ymax - ymin)) * ph;
    let s = `<svg class="chem-svg chem-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.title || "グラフ")}">`;
    for (const t of ticks(ymin, ymax, 5)) s += `<line class="grid" x1="${L}" y1="${f1(Y(t))}" x2="${W - R}" y2="${f1(Y(t))}"/><text class="axis" x="${L - 5}" y="${f1(Y(t) + 3)}" text-anchor="end">${tnum(t)}</text>`;
    for (const t of ticks(xmin, xmax, 6)) s += `<line class="grid" x1="${f1(X(t))}" y1="${T}" x2="${f1(X(t))}" y2="${T + ph}"/><text class="axis" x="${f1(X(t))}" y="${T + ph + 13}" text-anchor="middle">${tnum(t)}</text>`;
    s += `<rect class="frame" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`;
    if (m.xlabel) s += `<text class="axis lab" x="${L + pw / 2}" y="${H - 5}" text-anchor="middle">${esc(m.xlabel)}</text>`;
    if (m.ylabel) s += `<text class="axis lab" transform="translate(11 ${T + ph / 2}) rotate(-90)" text-anchor="middle">${esc(m.ylabel)}</text>`;
    (m.series || []).forEach((se, i) => {
      s += `<polyline class="line s${i}${se.dash ? " dash" : ""}" points="${se.pts.map(([x, y]) => f1(X(x)) + "," + f1(Y(y))).join(" ")}"/>`;
      if (se.label && se.pts.length) { const [lx, ly] = se.lab || se.pts[se.pts.length - 1]; s += `<text class="slab s${i}" x="${f1(X(lx) - 4)}" y="${f1(Y(ly) + (se.below ? 13 : -6))}" text-anchor="end">${esc(se.label)}</text>`; }
    });
    for (const k of m.marks || []) s += `<circle class="mark" cx="${f1(X(k.x))}" cy="${f1(Y(k.y))}" r="3.5"/>${k.text ? (k.x > xmin + (xmax - xmin) * 0.72 ? `<text class="mtxt" x="${f1(X(k.x) - 6)}" y="${f1(Y(k.y) - 7)}" text-anchor="end">${esc(k.text)}</text>` : `<text class="mtxt" x="${f1(X(k.x) + 6)}" y="${f1(Y(k.y) - 6)}">${esc(k.text)}</text>`) : ""}`;
    return s + "</svg>";
  }

  const LABELED = /^[^C]/;                                      // C以外の原子は、記号を書く(C は骨格の頂点)
  function mol(m) {
    const atoms = m.atoms, W = 340, H = 220, pad = 26;
    const xs = atoms.map((a) => a[1]), ys = atoms.map((a) => a[2]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const sc = Math.min((W - 2 * pad) / Math.max(1e-6, maxx - minx || 1), (H - 2 * pad) / Math.max(1e-6, maxy - miny || 1), 46);
    const ox = (W - (maxx - minx) * sc) / 2 - minx * sc, oy = (H - (maxy - miny) * sc) / 2 - miny * sc;
    const P = atoms.map((a) => [a[1] * sc + ox, a[2] * sc + oy]);
    const lab = (i) => atoms[i][3] !== undefined ? atoms[i][3] : (LABELED.test(atoms[i][0]) || m.showC ? atoms[i][0] : "");
    let s = `<svg class="chem-svg chem-mol" viewBox="0 0 ${W} ${H}" role="img" aria-label="構造式">`;
    for (const [cx, cy, r] of m.rings || []) s += `<circle class="ring" cx="${f1(cx * sc + ox)}" cy="${f1(cy * sc + oy)}" r="${f1(r * sc)}"/>`;
    for (const [i, j, ord = 1] of m.bonds) {
      let [x1, y1] = P[i], [x2, y2] = P[j];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
      const cut = (idx) => (lab(idx) ? 9 : 0);
      x1 += ux * cut(i); y1 += uy * cut(i); x2 -= ux * cut(j); y2 -= uy * cut(j);
      const line = (o, cls = "") => `<line class="bond${cls}" x1="${f1(x1 + nx * o)}" y1="${f1(y1 + ny * o)}" x2="${f1(x2 + nx * o)}" y2="${f1(y2 + ny * o)}"/>`;
      if (ord === 2) s += line(-2.2) + line(2.2);
      else if (ord === 3) s += line(-3.4) + line(0) + line(3.4);
      else if (ord === 1.5) s += line(0) + line(3.6, " dash");
      else s += line(0);
    }
    const svgLabel = (t) => esc(t).replace(/(\d+)/g, '<tspan dy="3" font-size="9">$1</tspan><tspan dy="-3"></tspan>');   // 下つきの数字(NH2 の 2 など)
    atoms.forEach((a, i) => { const t = lab(i); if (t) s += `<text class="atom" x="${f1(P[i][0])}" y="${f1(P[i][1] + 4.5)}" text-anchor="middle">${svgLabel(t)}</text>`; });
    return s + "</svg>";
  }

  function periodic(m) {
    const hl = new Set(m.hl || []), tags = m.tags || {}, cw = 19, ch = 19, L = 14, T = 14, W = L + 18 * cw + 4, H = T + 6 * ch + 6;
    let s = `<svg class="chem-svg chem-pt" viewBox="0 0 ${W} ${H}" role="img" aria-label="周期表">`;
    for (let g = 1; g <= 18; g++) s += `<text class="axis" x="${L + (g - 1) * cw + cw / 2}" y="${T - 4}" text-anchor="middle">${g}</text>`;
    for (let p = 1; p <= 6; p++) s += `<text class="axis" x="${L - 4}" y="${T + (p - 1) * ch + ch / 2 + 3}" text-anchor="end">${p}</text>`;
    for (const [, sym, , g, p] of Elements.LIST) {
      const x = L + (g - 1) * cw, y = T + (p - 1) * ch, on = hl.has(sym) || tags[sym] != null;
      s += `<rect class="cell${on ? " on" : ""}" x="${x}" y="${y}" width="${cw - 1}" height="${ch - 1}" rx="2"/>`;
      s += `<text class="sym${on ? " on" : ""}" x="${x + (cw - 1) / 2}" y="${y + ch / 2 + 2.5}" text-anchor="middle">${esc(tags[sym] != null ? tags[sym] : m.hideSymbols && !on ? "" : sym)}</text>`;
    }
    return s + "</svg>";
  }

  return { chart, mol, periodic };
});
