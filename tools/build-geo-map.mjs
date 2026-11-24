#!/usr/bin/env node
/**
 * 地理クイズの地図データ(data/geo-map.js)の生成ツール（開発時にだけ実行。ゲーム本体は生成物を読む）
 *
 *   node tools/build-geo-map.mjs --world-atlas <countries-50m.json> --countries <world-countries の countries.json> \
 *        --admin1 <ne_10m_admin_1_states_provinces.geojson> [--out data/geo-map.js]
 *
 * 入力: world-atlas の countries-50m.json (Natural Earth・パブリックドメイン / TopoJSON は ISC)
 *       world-countries の countries.json (ODbL。国のコード・面積・緯度経度)
 *       Natural Earth の admin-1 (日本の47都道府県。パブリックドメイン)
 * 出力: window.GEO_MAP = { world:{w,h,shapes:[[id,"パス"]],marks:[[id,x,y]],cent:{id:[x,y]}}, japan:{…} }
 *   id は 世界=cca3(独立国だけ。それ以外の地域は "") / 日本=JP-01〜JP-47
 *   パスは整数座標の相対パス("M x y l dx dy … z")。ブラウザ側は <path d> にそのまま入れるだけ
 *   marks: 小さくて地図上でタップしにくい国の「点」(面積が小さい国・形がない国)
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const atlasPath = valueOf("--world-atlas");
const countriesPath = valueOf("--countries");
const admin1Path = valueOf("--admin1");
const outPath = valueOf("--out") || "data/geo-map.js";
if (!atlasPath || !countriesPath || !admin1Path) {
  console.error("usage: node tools/build-geo-map.mjs --world-atlas <countries-50m.json> --countries <countries.json> --admin1 <admin1.geojson> [--out file]");
  process.exit(1);
}

/* ---------- TopoJSON を座標に戻す(topojson-client の feature と同じ処理) ---------- */
function decodeTopo(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
  const ring = (idxs) => {
    const pts = [];
    for (const i of idxs) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
    }
    return pts;
  };
  const poly = (g) => g.arcs.map(ring);                       // [外周, 穴…]
  return (geom) => (geom.type === "Polygon" ? [poly(geom)] : geom.type === "MultiPolygon" ? geom.arcs.map((p) => p.map(ring)) : []);
}

/* ---------- 日付変更線をまたぐ図形(ロシア・フィジーなど)を 180°/-180° で切り分ける ---------- */
/** 経度を連続させる(隣の点と180°以上ちがう時は360°足し引きする) */
function unwrap(ring) {
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  return out;
}
/** 経度 lim より小さい側(keepLess)だけ残す(Sutherland-Hodgman) */
function clipLon(ring, lim, keepLess) {
  const inside = (p) => (keepLess ? p[0] <= lim : p[0] >= lim);
  const cut = (a, b) => { const t = (lim - a[0]) / (b[0] - a[0]); return [lim, a[1] + (b[1] - a[1]) * t]; };
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (inside(a)) { out.push(a); if (!inside(b)) out.push(cut(a, b)); }
    else if (inside(b)) out.push(cut(a, b));
  }
  return out;
}
/** 1つの外周(と穴)を、-180〜180 に収まる複数のポリゴンにする */
function splitAntimeridian(rings) {
  const un = rings.map(unwrap);
  const [min, max] = un[0].reduce(([a, b], p) => [Math.min(a, p[0]), Math.max(b, p[0])], [Infinity, -Infinity]);
  if (min >= -180 && max <= 180) return [un];
  const shift = (r, d) => r.map(([x, y]) => [x + d, y]);
  const pieces = [];
  for (const [d, lo, hi] of [[0, -180, 180], [-360, -180, 180], [360, -180, 180]]) {
    const piece = un.map((r) => clipLon(clipLon(shift(r, d), hi, true), lo, false)).filter((r) => r.length >= 3);
    if (piece.length && piece[0].length >= 3 && (un[0] && piece === piece)) pieces.push(piece);
  }
  return pieces.filter((pc) => pc[0] && pc[0].length >= 3);
}

/* ---------- 投影 ---------- */
const RAD = Math.PI / 180;
/** Equal Earth(等積。世界地図用) */
function equalEarth([lon, lat]) {
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
  const th = Math.asin((Math.sqrt(3) / 2) * Math.sin(lat * RAD));
  const t2 = th * th, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lon * RAD * Math.cos(th)) / (3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, -y];
}
/** メルカトル(日本地図用) */
function mercator([lon, lat]) {
  return [lon * RAD, -Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))];
}

/* ---------- パスづくり ---------- */
const bboxOf = (rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
const area = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n]; a += x1 * y2 - x2 * y1; } return a / 2; };
const centroid = (r) => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = r.length; i < n; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n]; const f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
  return a ? [cx / (3 * a), cy / (3 * a)] : r[0];
};

/** 点を間引く(minDist 未満は捨てる)。整数座標にして、相対パス("M x y l dx dy …z")にする */
function toPath(polys, minDist) {
  let d = "";
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = [];
      for (const [x, y] of ring) {
        const px = Math.round(x), py = Math.round(y);
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(px - last[0], py - last[1]) >= minDist) pts.push([px, py]);
      }
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) continue;
      d += `M${pts[0][0]} ${pts[0][1]}l`;
      let prev = pts[0];
      d += pts.slice(1).map((p) => { const s = `${p[0] - prev[0]} ${p[1] - prev[1]}`; prev = p; return s; }).join(" ").replace(/ -/g, "-") + "z";
    }
  }
  return d;
}

/** 投影して、地図の枠に収まる座標(幅 W)にする */
function layout(items, project, W, pad = 8) {
  const proj = items.map((it) => ({ ...it, polys: it.polys.map((p) => p.map((r) => r.map(project))) }));
  const all = [];
  for (const it of proj) for (const p of it.polys) all.push(...p);
  const [x0, y0, x1, y1] = bboxOf(all);
  const k = (W - pad * 2) / (x1 - x0);
  const fit = ([x, y]) => [(x - x0) * k + pad, (y - y0) * k + pad];
  const H = Math.round((y1 - y0) * k + pad * 2);
  return { H, fit, items: proj.map((it) => ({ ...it, polys: it.polys.map((p) => p.map((r) => r.map(fit))) })) };
}

/* ---------- 世界 ---------- */
const countries = JSON.parse(readFileSync(countriesPath, "utf8"));
const byCcn3 = new Map(countries.filter((c) => c.independent).map((c) => [c.ccn3, c]));
const topo = JSON.parse(readFileSync(atlasPath, "utf8"));
const geomPolys = decodeTopo(topo);
const worldItems = [];
for (const g of topo.objects.countries.geometries) {
  if (String(g.id) === "010") continue;                          // 南極は出さない
  const c = byCcn3.get(String(g.id).padStart(3, "0"));
  worldItems.push({ id: c ? c.cca3 : "", name: (g.properties && g.properties.name) || "", polys: geomPolys(g).flatMap(splitAntimeridian) });
}
const WW = 2000;
const wl = layout(worldItems, equalEarth, WW);
const world = { w: WW, h: wl.H, shapes: [], marks: [], cent: {} };
const hasShape = new Set();
for (const it of wl.items) {
  const d = toPath(it.polys, 0.7);
  if (!d) continue;
  world.shapes.push([it.id, d]);
  if (it.id) {
    hasShape.add(it.id);
    const biggest = it.polys.map((p) => p[0]).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
    const c = centroid(biggest);
    world.cent[it.id] = [Math.round(c[0]), Math.round(c[1])];
  }
}
// 小さい国・形がない国は「点」で選べるようにする(位置は国の緯度経度)
const MARK_AREA = 12000;
for (const c of countries.filter((x) => x.independent)) {
  if (hasShape.has(c.cca3) && c.area >= MARK_AREA) continue;
  const [x, y] = wl.fit(equalEarth([c.latlng[1], c.latlng[0]]));
  world.marks.push([c.cca3, Math.round(x), Math.round(y)]);
  world.cent[c.cca3] = [Math.round(x), Math.round(y)];
}

/* ---------- 日本(都道府県) ---------- */
const admin1 = JSON.parse(readFileSync(admin1Path, "utf8"));
// 表示範囲(本州・北海道・四国・九州・沖縄・伊豆諸島まで)。小笠原など遠い島は地図が小さくなるので省く
const inJapanView = (poly) => { const [x, y] = centroid(poly[0]); return x >= 122 && x <= 146.5 && y >= 24 && y <= 46; };
const jpItems = admin1.features.filter((f) => f.properties.iso_a2 === "JP").map((f) => {
  const coords = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return { id: f.properties.iso_3166_2, polys: coords.filter(inJapanView) };
});
const JW = 1000;
const jl = layout(jpItems, mercator, JW);
const japan = { w: JW, h: jl.H, shapes: [], marks: [], cent: {} };
for (const it of jl.items) {
  japan.shapes.push([it.id, toPath(it.polys, 0.5)]);
  const biggest = it.polys.map((p) => p[0]).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
  const c = centroid(biggest);
  japan.cent[it.id] = [Math.round(c[0]), Math.round(c[1])];
}
japan.inset = null;

const body = `/* 自動生成: tools/build-geo-map.mjs — 直接編集しないこと。\n   出典: Natural Earth(パブリックドメイン)・world-atlas(ISC)・world-countries(ODbL) */\nwindow.GEO_MAP = ${JSON.stringify({ world, japan })};\n`;
writeFileSync(outPath, body);
console.log(`世界 ${world.shapes.length}図形(独立国 ${hasShape.size}/194)・点 ${world.marks.length}・${world.w}x${world.h} / 日本 ${japan.shapes.length}図形・${japan.w}x${japan.h}`);
console.log(`出力 ${outPath} (${(body.length / 1024).toFixed(0)} KB)`);
const missing = countries.filter((c) => c.independent && !hasShape.has(c.cca3)).map((c) => c.cca3);
console.log("形がなく点で補う独立国:", missing.join(" ") || "なし");
