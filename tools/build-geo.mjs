#!/usr/bin/env node
/**
 * 地理クイズのデータ(data/geo.js)の生成ツール（開発時にだけ実行。ゲーム本体は生成物を読む）
 *
 *   node tools/build-geo.mjs --countries <world-countries の countries.json> --admin1 <ne_10m_admin_1_states_provinces.geojson> [--out data/geo.js]
 *
 * 入力: tools/geo-source/*.txt (手書き: 国・都道府県・都市・写真・統計・早押し・地図の問題)
 *       tools/geo-source/climate.json (NASA POWER から取得した月別の気温・降水量。tools/fetch-geo-climate.mjs)
 *       tools/geo-source/photo-credits.json と assets/geo/*.webp (tools/fetch-geo-photos.mjs)
 *       tools/geo-source/wb.json (世界銀行の統計。tools/fetch-geo-wb.mjs)
 *       world-countries (ODbL: 隣国・面積) / Natural Earth admin-1 (都道府県の隣接)
 * 出力: window.GEO_DATA = { countries, prefs, climate, photos, buzz, map, choice }
 *   buzz  : 早押しの問題 {id,cat,lv,text,ans,yomi:[…]}   (手書き + 国・都道府県から自動)
 *   map   : 地図で選ぶ問題 {id,map:"world"|"japan",text,target,lv}
 *   choice: 資料選択(4択) {id,k:"graph|table|type|photo|stat",lv,q,m:{…},c:[4つ],a:正解の位置}
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const countriesPath = valueOf("--countries");
const admin1Path = valueOf("--admin1");
const outPath = valueOf("--out") || "data/geo.js";
if (!countriesPath || !admin1Path) { console.error("usage: node tools/build-geo.mjs --countries <countries.json> --admin1 <admin1.geojson> [--out file]"); process.exit(1); }

const root = new URL("../", import.meta.url).pathname;
const src = (n) => root + "tools/geo-source/" + n;
const lines = (n) => readFileSync(src(n), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
const warn = [];

/* 決まった乱数(毎回同じ出力になるように) */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (arr, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isKana = (s) => /^[ぁ-んー]+$/.test(s);

/* ---------- 国・都道府県 ---------- */
const wc = JSON.parse(readFileSync(countriesPath, "utf8")).filter((c) => c.independent);
const wcBy = new Map(wc.map((c) => [c.cca3, c]));
const countries = lines("countries.txt").map((l) => { const [id, ja, yomi, cont, cap, capYomi] = l.split("|"); return { id, ja, yomi, cont, cap, capYomi }; });
const cBy = new Map(countries.map((c) => [c.id, c]));
for (const c of countries) {
  if (!wcBy.has(c.id)) warn.push(`countries: 知らないコード ${c.id}`);
  for (const k of ["yomi", "capYomi"]) if (!isKana(c[k].replace(/\s/g, ""))) warn.push(`countries: ${c.id} の${k}がかなでない "${c[k]}"`);
}
for (const w of wc) if (!cBy.has(w.cca3)) warn.push(`countries: ${w.cca3} がない`);
const prefs = lines("prefs.txt").map((l) => { const [id, ja, yomi, cap, capYomi, region] = l.split("|"); return { id, ja, yomi, cap, capYomi, region }; });
const pBy = new Map(prefs.map((p) => [p.id, p]));
/* 知名度(出題のレベル): 1=かんたん 2=ふつう 3=むずかしい */
const fame = Object.fromEntries(lines("fame.txt").map((l) => { const [k, v] = l.split("|"); return [k, new Set(v.split(" "))]; }));
const lvC = (id) => (fame.country1.has(id) ? 1 : fame.country2.has(id) ? 2 : 3);
const lvP = (id) => (fame.pref1.has(id) ? 1 : fame.pref2.has(id) ? 2 : 3);

/* 都道府県の隣接(境界の頂点を2つ以上共有していれば隣) */
const admin1 = JSON.parse(readFileSync(admin1Path, "utf8"));
const vert = new Map();
for (const f of admin1.features.filter((x) => x.properties.iso_a2 === "JP")) {
  const set = new Set();
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) for (const r of p) for (const [x, y] of r) set.add(x.toFixed(3) + "," + y.toFixed(3));
  vert.set(f.properties.iso_3166_2, set);
}
const neighbors = new Map(prefs.map((p) => [p.id, []]));
for (const a of prefs) for (const b of prefs) {
  if (a.id >= b.id) continue;
  let n = 0;
  for (const v of vert.get(a.id)) if (vert.get(b.id).has(v) && ++n >= 2) break;
  if (n >= 2) { neighbors.get(a.id).push(b.id); neighbors.get(b.id).push(a.id); }
}
// 本州と九州・四国・北海道は橋・トンネルでつながっているが、「陸続き」の隣県には含めない(境界を共有していなければ隣ではない)

/* ---------- 気候(雨温図) ---------- */
const climRaw = JSON.parse(readFileSync(src("climate.json"), "utf8"));
const fix = new Map(lines("climate-fix.txt").map((l) => { const [id, off, ty] = l.split("|"); return [id, { off: Number(off), ty: ty === "-" ? "" : ty }]; }));
const climate = {};
const cityList = lines("cities.txt").map((l) => { const [id, ja, yomi, country, lat, lon, zone, lv] = l.split("|"); return { id, ja, yomi, country, lat: +lat, lon: +lon, zone: zone || "", lv: lv ? Number(lv) : 0 }; });
for (const c of cityList) {
  const raw = climRaw[c.id];
  if (!raw) { warn.push(`climate: ${c.id} のデータがない`); continue; }
  const f = fix.get(c.id) || { off: 0, ty: "" };
  climate[c.id] = {
    n: c.country === "JPN" || !cBy.has(c.country) ? c.ja : `${c.ja}（${cBy.get(c.country).ja}）`, ja: c.ja, y: c.yomi, c: c.country, z: c.zone, ty: f.ty, lv: c.lv,
    t: raw.t.map((x) => Math.round((x + f.off) * 10) / 10), p: raw.p
  };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sum = (a) => a.reduce((x, y) => x + y, 0);

/* ---------- 写真 ---------- */
const creditsFile = src("photo-credits.json");
const credits = existsSync(creditsFile) ? JSON.parse(readFileSync(creditsFile, "utf8")) : {};
const photoRows = lines("photos.txt").map((l) => { const [id, , answer, kind, hint] = l.split("|"); return { id, answer, kind, hint: hint || "" }; });
const photos = photoRows.filter((p) => credits[p.id] && existsSync(root + `assets/geo/${p.id}.webp`));
const skipFile = src("photo-skip.txt");
const skip = new Set(existsSync(skipFile) ? lines("photo-skip.txt").map((l) => l.split("|")[0]) : []);   // 目で見て内容が合わなかった写真
const photoUse = photos.filter((p) => !skip.has(p.id));
const EASY_PHOTOS = new Set("eiffel pisa colosseum bigben pyramids sphinx greatwall tajmahal liberty opera fuji himeji kinkaku todaiji tokyotower christ machu".split(" "));   // だれでも知っている名所

/* ---------- 早押し ---------- */
const hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const buzz = [];
for (const l of [...lines("buzz-hand.txt"), ...lines("buzz-high.txt")]) {
  const [id, cat, lv, text, ans, yomi] = l.split("|");
  const ys = yomi.split(",").map((s) => hira(s.trim()));
  for (const y of ys) if (!isKana(y)) warn.push(`buzz ${id}: 読みがかなでない "${y}"`);
  buzz.push({ id, cat, sc: cat, lv: Number(lv), text, ans, yomi: ys });
}
// 国の別名の読み
const ALIAS = { USA: ["あめりか", "べいこく"], GBR: ["えいこく", "ゆーけー"], ARE: ["ゆーえーいー"], KOR: ["だいかんみんこく"], PRK: ["ちょうせんみんしゅしゅぎじんみんきょうわこく"], CHN: ["ちゅうかじんみんきょうわこく"], RUS: ["ろしあ"], CZE: ["ちぇこきょうわこく"], MMR: ["びるま"], CIV: ["あいぼりーこーすと"], SWZ: ["すわじらんど"], MKD: ["まけどにあ"], TLS: ["とるれすて"], FSM: ["みくろねしあ"], KNA: ["せんときっつねーびす"], DMA: ["どみにか"] };
const AUTO_COUNTRIES = "RUS CAN USA CHN BRA AUS IND ARG KAZ DZA SAU MEX IDN LBY IRN MNG PER AGO MLI ZAF COL ETH BOL EGY TZA NGA VEN PAK TUR CHL ZMB MMR AFG SOM FRA ESP SWE THA IRQ PNG DEU FIN VNM MYS NOR POL ITA PHL NZL GBR ROU GRC BGD NPL ISL CUB KOR PRT CHE AUT NLD IRL LKA JOR UKR KEN MAR MDG KHM".split(" ");
const areaText = (km2) => (km2 >= 10000 ? `約${(km2 / 10000 >= 10 ? String(Math.round(km2 / 10000)) : (km2 / 10000).toFixed(1).replace(/\.0$/, ""))}万平方キロメートル` : `約${km2 >= 100 ? Math.round(km2 / 10) * 10 : Math.round(km2)}平方キロメートル`);
for (const c of countries) {
  if (c.id === "JPN") continue;
  const w = wcBy.get(c.id);
  const nb = (w.borders || []).map((b) => cBy.get(b) && cBy.get(b).ja).filter(Boolean);
  const border = nb.length === 0 ? "周りを海に囲まれた島国で、" : nb.length <= 4 ? `${nb.join("、")}と国境を接し、` : `${nb.length}か国と国境を接し、`;
  const text = `この国は、${c.cont}にあり、${border}面積は${areaText(w.area)}で、首都は${c.cap}です。この国はどこでしょう？`;
  buzz.push({ id: "c-" + c.id.toLowerCase(), cat: "world", sc: "world", lv: lvC(c.id), text, ans: c.ja, yomi: [hira(c.yomi), ...(ALIAS[c.id] || [])] });
}
const suffix = (ja) => ja.slice(-1);                                         // 都・道・府・県
const shortYomi = (p) => (p.id === "JP-01" ? [] : [p.yomi.replace(/(けん|ふ|と)$/, "")]);
for (const p of prefs) {
  const nb = neighbors.get(p.id).map((n) => pBy.get(n).ja);
  const border = nb.length === 0 ? "他の都道府県と陸でつながっておらず、" : nb.length <= 5 ? `${nb.join("、")}と接し、` : `${nb.slice(0, 4).join("、")}など${nb.length}の都府県と接し、`;
  const text = `この都道府県は、${p.region}地方にあり、${border}${suffix(p.ja)}庁所在地は${p.cap}です。この都道府県はどこでしょう？`;
  buzz.push({ id: "p-" + p.id.slice(3), cat: "japan", sc: "japan", lv: lvP(p.id), text, ans: p.ja, yomi: [p.yomi, ...shortYomi(p)] });
}
// 国の首都・都道府県の県庁所在地を答える(国名・県名がヒント)
for (const c of countries) {
  if (c.cap === c.ja || c.cap.includes(c.ja) || c.ja.includes(c.cap)) continue;
  buzz.push({ id: "cp-" + c.id.toLowerCase(), cat: "world", sc: "world", lv: lvC(c.id), text: c.id === "JPN" ? "日本の首都はどこでしょう？" : `${c.cont}にある${c.ja}の首都はどこでしょう？`, ans: c.cap, yomi: [c.capYomi] });
}
for (const p of prefs) {
  const city = p.cap.replace(/[市区]$/, "");
  const same = p.ja.startsWith(city);
  const base = p.capYomi.replace(/(し|く)$/, "");
  buzz.push({ id: "pk-" + p.id.slice(3), cat: "japan", sc: "japan", lv: same ? 1 : p.id === "JP-13" ? 3 : fame.pref1.has(p.id) ? 1 : 2, text: `${p.ja}の${suffix(p.ja)}庁所在地はどこでしょう？`, ans: p.cap, yomi: [p.capYomi, base] });
}
for (const b of buzz) if (b.yomi.some((y) => !isKana(y))) warn.push(`buzz ${b.id}: 読みがかなでない`);
if (new Set(buzz.map((b) => b.id)).size !== buzz.length) warn.push("buzz: id が重複");

/* ---------- 地図で選ぶ ---------- */
const map = [];
const r1 = rng(11);
for (const c of countries.filter((c) => c.cap !== c.ja && !c.cap.includes(c.ja) && !c.ja.includes(c.cap))) map.push({ id: "mc-" + c.id.toLowerCase(), map: "world", sc: "world", text: `首都が「${c.cap}」の国はどこでしょう？`, target: c.id, lv: lvC(c.id) });
for (const c of countries) map.push({ id: "mn-" + c.id.toLowerCase(), map: "world", sc: "world", text: `地図で「${c.ja}」を選ぼう！`, target: c.id, lv: lvC(c.id) });
for (const p of prefs) map.push({ id: "mnp-" + p.id.slice(3), map: "japan", sc: "japan", text: `地図で「${p.ja}」を選ぼう！`, target: p.id, lv: lvP(p.id) });
for (const l of lines("map-hand.txt")) {
  const a = l.split("|");
  if (a[0] === "world") {
    if (!cBy.has(a[2])) { warn.push(`map-hand: 知らない国 ${a[2]}`); continue; }
    map.push({ id: "mw-" + map.length, map: "world", sc: "world", text: `「${a[1]}」がある国はどこでしょう？`, target: a[2], lv: lvC(a[2]) });
  } else {
    if (!pBy.has(a[2])) { warn.push(`map-hand: 知らない県 ${a[2]}`); continue; }
    const t = a[3] === "sight" ? `「${a[1]}」がある都道府県はどこでしょう？` : a[3] === "food" ? `「${a[1]}」で有名な都道府県はどこでしょう？` : `「${a[1]}」の産地として有名な都道府県はどこでしょう？`;
    map.push({ id: "mj-" + map.length, map: "japan", sc: "japan", text: t, target: a[2], lv: Math.min(2, lvP(a[2])) });
  }
}
for (const p of prefs) {
  const city = p.cap.replace(/[市区]$/, "");
  if (p.id === "JP-13" || p.ja.startsWith(city)) continue;                   // 県名と同じ(青森市→青森県)は簡単すぎる
  map.push({ id: "mp-" + p.id.slice(3), map: "japan", sc: "japan", text: `${suffix(p.ja)}庁所在地が「${p.cap}」の都道府県はどこでしょう？`, target: p.id, lv: Math.min(2, lvP(p.id)) });
}
// 高校地理の手書き(答えが1つに決まるもの)
for (const l of lines("map-high.txt")) {
  const [kind, text, code] = l.split("|");
  if (kind === "world" ? !cBy.has(code) : !pBy.has(code)) { warn.push(`map-high: 知らないコード ${code}`); continue; }
  map.push({ id: `mh-${map.length}`, map: kind, sc: kind, text, target: code, lv: 3 });
}
// 面積・人口の順位(となりの順位と近いものは、順位があいまいなので出さない)
const wb = JSON.parse(readFileSync(src("wb.json"), "utf8"));
const rankQs = (label, list, valueOf, maxRank, mapKind, prefix) => {
  const sorted = list.map((id) => ({ id, v: valueOf(id) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  for (let r = 1; r <= maxRank && r < sorted.length; r++) {
    const near = (i) => sorted[i] && Math.abs(sorted[r - 1].v - sorted[i].v) / sorted[r - 1].v < 0.04;
    if (near(r - 2) || near(r)) continue;
    map.push({ id: `${prefix}-${r}`, map: mapKind, sc: mapKind, text: `${label}が世界で第${r}位の国はどこでしょう？`, target: sorted[r - 1].id, lv: 3 });
  }
};
rankQs("面積", countries.map((c) => c.id), (id) => wcBy.get(id).area, 10, "world", "mr-area");
rankQs("人口", countries.map((c) => c.id), (id) => (wb.pop[id] || {}).v || 0, 15, "world", "mr-pop");
const JP_RANKS = [
  ["面積が全国で第{r}位の都道府県はどこでしょう？", ["JP-01", "JP-03", "JP-07", "JP-20", "JP-15", "JP-05", "JP-21", "JP-02"], "ja"],
  ["人口が全国で第{r}位の都道府県はどこでしょう？", ["JP-13", "JP-14", "JP-27", "JP-23", "JP-11", "JP-12", "JP-28", "JP-01"], "jp"],
  ["人口が全国で少ない方から第{r}位の県はどこでしょう？", ["JP-31", "JP-32", "JP-39", "JP-36", "JP-18"], "jl"],
  ["面積が全国で小さい方から第{r}位の都道府県はどこでしょう？", ["JP-37", "JP-27", "JP-13", "JP-47", "JP-14"], "js"]
];
for (const [tpl, ids, key] of JP_RANKS) ids.forEach((id, i) => { if (!pBy.has(id)) warn.push("JP順位: " + id); else map.push({ id: `mr-${key}-${i + 1}`, map: "japan", sc: "japan", text: tpl.replace("{r}", String(i + 1)), target: id, lv: 3 }); });
if (new Set(map.map((m) => m.id)).size !== map.length) warn.push("map: id が重複");

/* ---------- 資料選択(4択) ---------- */
const choice = [];
const r2 = rng(23);
const annualT = (id) => mean(climate[id].t), annualP = (id) => sum(climate[id].p);
const far = (a, b) => Math.abs(annualT(a) - annualT(b)) >= 4 || Math.max(annualP(a), annualP(b)) / Math.max(1, Math.min(annualP(a), annualP(b))) >= 1.8;
const jpIds = cityList.filter((c) => c.country === "JPN").map((c) => c.id);
const worldIds = cityList.filter((c) => c.country !== "JPN").map((c) => c.id);
function pickDistract(id, pool) {
  let c = shuffle(pool.filter((x) => x !== id && far(id, x)), r2);
  // 同じ気候区分や近い気候は避ける(正解が2つにならないように)。足りなければ緩める
  const chosen = [];
  for (const x of c) { if (chosen.length < 3 && chosen.every((y) => far(x, y) || true)) chosen.push(x); }
  return chosen;
}
function cityQ(kind, id) {
  const jp = jpIds.includes(id);
  const pool = jp ? jpIds.filter((x) => climate[x].z !== climate[id].z || x === id) : worldIds;
  let ds = pickDistract(id, jp ? pool : worldIds);
  if (jp && ds.length < 3) ds = shuffle(jpIds.filter((x) => x !== id), r2).slice(0, 3);
  if (ds.length < 3) { warn.push(`choice: ${id} の選択肢が足りない`); return; }
  const cs = [id, ...ds];
  choice.push({
    id: `${kind[0]}-${id}`, k: kind, sc: jp ? "japan" : "world", lv: climate[id].lv || (jp ? 1 : 2),
    q: jp ? `この${kind === "graph" ? "雨温図" : "気温と降水量の表"}は、日本のある都市のものです。どこでしょう？` : `この${kind === "graph" ? "雨温図" : "気温と降水量の表"}に当てはまる都市はどこでしょう？`,
    m: { city: id }, c: cs.map((x) => climate[x].n), a: 0
  });
}
for (const id of Object.keys(climate)) { cityQ("graph", id); cityQ("table", id); }
const TYPES = [...new Set(Object.values(climate).map((c) => c.ty).filter(Boolean))];
const ALL_TYPES = ["熱帯雨林気候", "熱帯モンスーン気候", "サバナ気候", "砂漠気候", "ステップ気候", "地中海性気候", "温暖湿潤気候", "温暖冬季少雨気候", "西岸海洋性気候", "冷帯(亜寒帯)湿潤気候", "冷帯冬季少雨気候", "ツンドラ気候", "氷雪気候", "高山気候"];
for (const [id, c] of Object.entries(climate)) {
  if (!c.ty) continue;
  const wrong = shuffle(ALL_TYPES.filter((t) => t !== c.ty), r2).slice(0, 3);
  choice.push({ id: "y-" + id, k: "type", sc: jpIds.includes(id) ? "japan" : "world", lv: 3, q: `この雨温図が表す気候は、次のうちどれでしょう？`, m: { city: id, noName: true }, c: [c.ty, ...wrong], a: 0 });
}
const kindGroup = (k) => (k === "japan" ? "japan" : k);
for (const p of photoUse) {
  const same = photoUse.filter((x) => x.id !== p.id && x.kind === p.kind);
  const others = photoUse.filter((x) => x.id !== p.id && x.kind !== p.kind);
  const pool = shuffle(same, r2).concat(shuffle(others, r2)).slice(0, 3);
  if (pool.length < 3) { warn.push(`photo ${p.id}: 選択肢が足りない`); continue; }
  choice.push({ id: "f-" + p.id, k: "photo", sc: p.kind === "japan" ? "japan" : "world", lv: p.kind === "japan" || EASY_PHOTOS.has(p.id) ? 1 : 2, q: p.kind === "japan" ? "この写真の場所は、日本のどこでしょう？" : "この写真は、どこでしょう？", m: { file: p.id, hint: p.hint }, c: [p.answer, ...pool.map((x) => x.answer)], a: 0 });
}
for (const l of lines("stats.txt")) {
  const [id, kind, rows, ans, wrong, label] = l.split("|");
  const rs = rows.split(","), ws = wrong.split(",");
  if (rs.length !== 5 || ws.length < 3) { warn.push(`stats ${id}: 形式`); continue; }
  const cs = [ans, ...shuffle(ws, r2).slice(0, 3)];
  choice.push({ id: "s-" + id, k: "stat", sc: kind, lv: Number(id.slice(1)) <= 24 ? 2 : 3, q: `次の表は、${label || (kind === "japan" ? "都道府県" : "国")}の1位から5位までを並べたものです。何の表でしょう？`, m: { rows: rs }, c: cs, a: 0 });
}
// 国と首都・都道府県と県庁所在地の4択(国・県の知名度でレベルが変わる)
const sameCont = (id) => countries.filter((x) => x.cont === cBy.get(id).cont && x.id !== id);
const r4 = rng(51);
const okCap = (c) => c.cap !== c.ja && !c.cap.includes(c.ja) && !c.ja.includes(c.cap);
for (const c of countries.filter(okCap)) {
  const pool = sameCont(c.id).filter(okCap);
  const ds = shuffle(pool, r4).slice(0, 3);
  if (ds.length < 3) { warn.push(`cap ${c.id}: 選択肢が足りない`); continue; }
  choice.push({ id: "cc-" + c.id.toLowerCase(), k: "cap", sc: "world", lv: lvC(c.id) === 3 ? 3 : 1,   // 4択なので、「国→首都」はふつうの知名度でもかんたん
     q: `${c.ja}の首都は、次のうちどれでしょう？`, m: {}, c: [c.cap, ...ds.map((d) => d.cap)], a: 0 });
  choice.push({ id: "cn-" + c.id.toLowerCase(), k: "cap", sc: "world", lv: lvC(c.id), q: `首都が${c.cap}の国は、次のうちどれでしょう？`, m: {}, c: [c.ja, ...ds.map((d) => d.ja)], a: 0 });
}
for (const p of prefs) {
  const near = prefs.filter((x) => x.id !== p.id && x.region === p.region);
  const pool = near.length >= 3 ? near : prefs.filter((x) => x.id !== p.id);
  const ds = shuffle(pool, r4).slice(0, 3);
  const lv = p.ja.startsWith(p.cap.replace(/[市区]$/, "")) ? 1 : lvP(p.id) === 3 ? 3 : Math.min(2, lvP(p.id));
  choice.push({ id: "pc-" + p.id.slice(3), k: "pref", sc: "japan", lv, q: `${p.ja}の${suffix(p.ja)}庁所在地は、次のうちどれでしょう？`, m: {}, c: [p.cap, ...ds.map((d) => d.cap)], a: 0 });
  choice.push({ id: "pn-" + p.id.slice(3), k: "pref", sc: "japan", lv, q: `${suffix(p.ja)}庁所在地が${p.cap}の都道府県は、次のうちどれでしょう？`, m: {}, c: [p.ja, ...ds.map((d) => d.ja)], a: 0 });
}
// 基本の4択(手書き)
lines("choice-basic.txt").forEach((l, i) => {
  const [sc, lv, q, ans, wrong] = l.split("|");
  const c = [ans, ...wrong.split(",")];
  if (c.length !== 4 || new Set(c).size !== 4) { warn.push(`choice-basic ${i}: 選択肢`); return; }
  choice.push({ id: `b-${i + 1}`, k: "basic", sc, lv: Number(lv), q, m: {}, c, a: 0 });
});
// 写真の場所がある国・都道府県
for (const l of lines("photo-country.txt")) {
  const [pid, code] = l.split("|");
  const ph = photoUse.find((x) => x.id === pid);
  if (!ph) continue;
  const jp = code.startsWith("JP-");
  const ent = jp ? pBy.get(code) : cBy.get(code);
  if (!ent) { warn.push(`photo-country: ${code}`); continue; }
  const pool = jp ? prefs.filter((x) => x.id !== code && (x.region === pBy.get(code).region || true)) : sameCont(code);
  const ds = shuffle(pool.length >= 3 ? pool : countries.filter((x) => x.id !== code), r4).slice(0, 3);
  choice.push({ id: "fc-" + pid, k: "photo", sc: jp ? "japan" : "world", lv: jp ? 2 : EASY_PHOTOS.has(pid) ? 1 : Math.max(lvC(code), 2), q: jp ? "この写真の場所がある都道府県は、次のうちどれでしょう？" : "この写真の場所がある国は、次のうちどれでしょう？", m: { file: pid, hint: ph.hint }, c: [ent.ja, ...ds.map((d) => d.ja)], a: 0 });
}
// 表(気温と降水量)から気候区分
for (const [id, c] of Object.entries(climate)) {
  if (!c.ty) continue;
  const wrong = shuffle(ALL_TYPES.filter((t) => t !== c.ty), r4).slice(0, 3);
  choice.push({ id: "yt-" + id, k: "type", sc: jpIds.includes(id) ? "japan" : "world", lv: 3, q: "この気温と降水量の表が表す気候は、次のうちどれでしょう？", m: { city: id, noName: true, table: true }, c: [c.ty, ...wrong], a: 0 });
}
// 高校地理: 世界銀行の統計の表(人口構成・社会経済の指標)から、どの国かを当てる
const WB_COUNTRIES = countries.map((c) => c.id).filter((id) => ((wb.pop[id] || {}).v || 0) >= 2500000);
const val = (k, id) => (wb[k] && wb[k][id] ? wb[k][id].v : null);
const r3 = rng(37);
function wbQuestions(kind, need, ok, feat, far2, make) {
  const cand = WB_COUNTRIES.filter(ok);
  const targets = shuffle(cand, r3).slice(0, need);
  for (const id of targets) {
    const ds = shuffle(cand.filter((x) => x !== id && far2(feat(id), feat(x))), r3).slice(0, 3);
    if (ds.length < 3) { warn.push(`wb ${kind} ${id}: 選択肢が足りない`); continue; }
    choice.push({ id: `${kind}-${id.toLowerCase()}`, k: kind, sc: "world", lv: fame.country1.has(id) ? 2 : 3, m: make(id), c: [cBy.get(id).ja, ...ds.map((d) => cBy.get(d).ja)], a: 0,
      q: kind === "indic" ? "次の表は、ある国の近年の統計です。どの国のものでしょう？" : "次の人口構成（年少・生産年齢・老年人口の割合）は、どの国のものでしょう？" });
  }
}
const r1d = (x) => Math.round(x * 10) / 10;
wbQuestions("indic", 90,
  (id) => ["density", "urban", "gni", "life", "agri"].every((k) => val(k, id) != null),
  (id) => ({ d: Math.log10(val("density", id)), g: Math.log10(val("gni", id)), l: val("life", id), a: val("agri", id), u: val("urban", id) }),
  (a, b) => Math.abs(a.g - b.g) >= 0.3 && (Math.abs(a.l - b.l) >= 3 || Math.abs(a.d - b.d) >= 0.4 || Math.abs(a.a - b.a) >= 10),
  (id) => ({ rows: [["人口密度", Math.round(val("density", id)).toLocaleString("en-US") + " 人/km²"], ["都市人口率", Math.round(val("urban", id)) + " %"], ["1人あたり国民総所得", Math.round(val("gni", id) / 10) * 10 + " ドル"], ["平均寿命", Math.round(val("life", id)) + " 歳"], ["農業で働く人の割合", Math.round(val("agri", id)) + " %"]] }));
wbQuestions("pop", 70,
  (id) => ["age14", "age64", "age65", "birth"].every((k) => val(k, id) != null),
  (id) => ({ y: val("age14", id), o: val("age65", id), b: val("birth", id) }),
  (a, b) => Math.abs(a.o - b.o) >= 5 || Math.abs(a.y - b.y) >= 8,
  (id) => ({ y: r1d(val("age14", id)), w: r1d(val("age64", id)), o: r1d(val("age65", id)), b: r1d(val("birth", id)) }));
if (new Set(choice.map((c) => c.id)).size !== choice.length) warn.push("choice: id が重複");
for (const c of choice) if (new Set(c.c).size !== 4) warn.push(`choice ${c.id}: 選択肢が重複`);

/* ---------- 出力 ---------- */
const data = {
  version: 1,
  source: "Natural Earth(パブリックドメイン)・world-countries(ODbL)・NASA POWER・World Bank Open Data(CC BY 4.0)・Wikimedia Commons(写真ごとの出典は credits)",
  countries: countries.map((c) => [c.id, c.ja, c.yomi, c.cont, c.cap, c.capYomi]),
  prefs: prefs.map((p) => [p.id, p.ja, p.yomi, p.cap, p.capYomi, p.region]),
  climate,
  photos: photoUse.map((p) => ({ id: p.id, answer: p.answer, kind: p.kind, hint: p.hint, credit: credits[p.id] })),
  buzz, map, choice
};
const body = `/* 自動生成: tools/build-geo.mjs — 直接編集しないこと */\nwindow.GEO_DATA = ${JSON.stringify(data)};\n`;
writeFileSync(outPath, body);
const kinds = {};
for (const c of choice) kinds[c.k] = (kinds[c.k] || 0) + 1;
console.log(`早押し ${buzz.length} (手書き ${buzz.filter((b) => !/^(c|p)-/.test(b.id)).length}) / 地図 ${map.length} (世界 ${map.filter((m) => m.map === "world").length}・日本 ${map.filter((m) => m.map === "japan").length}) / 資料選択 ${choice.length} ${JSON.stringify(kinds)}`);
console.log(`都市 ${Object.keys(climate).length} / 写真 ${photoUse.length}/${photoRows.length} / 出力 ${outPath} (${(body.length / 1024).toFixed(0)} KB)`);
if (warn.length) { console.log(`警告 ${warn.length}件:`); warn.slice(0, 40).forEach((w) => console.log("  - " + w)); }
