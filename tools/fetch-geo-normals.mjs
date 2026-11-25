#!/usr/bin/env node
/**
 * 雨温図の元データを、各都市の「平年値」(気象庁・WMO・NOAAなどの観測にもとづく月別の平均気温・降水量)から取り込む(開発時だけ)。
 *   node tools/fetch-geo-normals.mjs [id …]      → tools/geo-source/normals.json
 * 英語版Wikipediaの各都市のページにある気候表(Weather box)の値を読む。NASAの格子データ(約50km四方)は、
 * 山や海岸をふくむ地点で降水量が実際の2倍ちかくずれることがあるため、観測の平年値があれば、そちらを優先する(build-geo.mjs)。
 * 気候表のデータ元(気象庁など)と、ページ名・表の見出しを normals.json に残す。Wikipediaに負担をかけないよう、3秒あけて取得する。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL("./geo-source/", import.meta.url).pathname;
const UA = "MiniGameHiroba-GeoQuiz/1.0 (educational static web game; climate normals)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 都市id → 英語版Wikipediaのページ名
const PAGE = {
  sapporo: "Sapporo", sendai: "Sendai", niigata: "Niigata, Niigata", kanazawa: "Kanazawa, Ishikawa", tokyo: "Tokyo", matsumoto: "Matsumoto, Nagano", nagoya: "Nagoya",
  osaka: "Osaka", takamatsu: "Takamatsu, Kagawa", kochi: "Kōchi, Kōchi", hiroshima: "Hiroshima", fukuoka: "Fukuoka", kagoshima: "Kagoshima", naha: "Naha",
  beijing: "Beijing", shanghai: "Shanghai", singapore: "Singapore", bangkok: "Bangkok", mumbai: "Mumbai", delhi: "Delhi", ulaanbaatar: "Ulaanbaatar", riyadh: "Riyadh",
  dubai: "Dubai", istanbul: "Istanbul", yakutsk: "Yakutsk", moscow: "Moscow", london: "London", paris: "Paris", rome: "Rome", athens: "Athens", madrid: "Madrid",
  berlin: "Berlin", reykjavik: "Reykjavík", cairo: "Cairo", nairobi: "Nairobi", lagos: "Lagos", capetown: "Cape Town", timbuktu: "Timbuktu", newyork: "New York City",
  losangeles: "Los Angeles", anchorage: "Anchorage, Alaska", mexicocity: "Mexico City", vancouver: "Vancouver", manaus: "Manaus", lima: "Lima", buenosaires: "Buenos Aires",
  lapaz: "La Paz", sydney: "Sydney", perth: "Perth", darwin: "Darwin, Northern Territory", alicesprings: "Alice Springs", hochiminh: "Ho Chi Minh City", kolkata: "Kolkata",
  yangon: "Yangon", hanoi: "Hanoi", johannesburg: "Johannesburg", quito: "Quito", bogota: "Bogotá", sanfrancisco: "San Francisco", seattle: "Seattle", neworleans: "New Orleans",
  saopaulo: "São Paulo", riodejaneiro: "Rio de Janeiro", irkutsk: "Irkutsk", verkhoyansk: "Verkhoyansk", helsinki: "Helsinki", edmonton: "Edmonton", tehran: "Tehran",
  baghdad: "Baghdad", karachi: "Karachi", longyearbyen: "Longyearbyen", mcmurdo: "McMurdo Station", auckland: "Auckland", lisbon: "Lisbon", kualalumpur: "Kuala Lumpur"
};
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const outPath = dir + "normals.json";
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const only = process.argv.slice(2);

/** Weather box の「|項目 = 値」を { 項目: 値 } にする(最初の表だけ。{{Weather box ...}} か、{{都市名 weatherbox}} などのテンプレート) */
function box(text) {
  const i = text.search(/\{\{\s*weather ?box/i);
  if (i < 0) return null;
  const f = {}; let depth = 0, j = i;
  for (; j < text.length; j++) { if (text.startsWith("{{", j)) { depth++; j++; } else if (text.startsWith("}}", j)) { depth--; j++; if (depth === 0) break; } }
  for (const line of text.slice(i, j).split("\n")) {
    const m = /^\|\s*([^=|]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) f[m[1]] = m[2];
  }
  return f;
}
const num = (s) => { if (s == null) return null; const v = parseFloat(String(s).replace(/−/g, "-").replace(/<!--.*?-->/g, "").replace(/<ref.*$/s, "").replace(/\{\{.*?\}\}/g, "").trim()); return Number.isFinite(v) ? v : null; };

async function raw(title, lang = "en") {
  for (let k = 0; k < 4; k++) {
    const res = await fetch(`https://${lang}.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`, { headers: { "User-Agent": UA } });
    await sleep(3000);
    if (res.ok) return res.text();
    if (res.status === 404) return "";
    await sleep(20000 * (k + 1));
  }
  return "";
}

/** 気候表から、12か月の平均気温と降水量を取り出す。そろっていなければ null */
function monthly(f) {
  if (!f) return null;
  const F2C = (v) => (v == null ? null : Math.round(((v - 32) * 5 / 9) * 10) / 10);
  const IN = (v) => (v == null ? null : v * 25.4);
  const t = M.map((m) => num(f[`${m} mean C`]) ?? F2C(num(f[`${m} mean F`])) ?? (num(f[`${m} high C`]) != null && num(f[`${m} low C`]) != null ? Math.round(((num(f[`${m} high C`]) + num(f[`${m} low C`])) / 2) * 10) / 10 : null));
  const p = M.map((m) => num(f[`${m} precipitation mm`]) ?? num(f[`${m} rain mm`]) ?? IN(num(f[`${m} precipitation inch`] ?? f[`${m} precipitation inches`])) ?? IN(num(f[`${m} rain inch`] ?? f[`${m} rain inches`])));
  return t.some((v) => v == null) || p.some((v) => v == null) ? null : { t, p: p.map((v) => Math.round(v)) };
}

const JA = { niigata: "新潟市", kanazawa: "金沢市", takamatsu: "高松市" };      // 英語版に表がない都市は、日本語版を使う
for (const [id, page] of Object.entries(PAGE)) {
  if (only.length ? !only.includes(id) : out[id]) continue;
  const text = await raw(page);
  const base = page.replace(/,.*$/, "");
  const tried = [];
  let f = box(text), r = monthly(f);
  const cands = [`Climate of ${base}`, ...[...text.matchAll(/\{\{\s*([^|{}\n]*weather ?box[^|{}\n]*)/gi)].map((m) => "Template:" + m[1].trim())];
  for (const n of cands) {
    if (r) break;
    const t = await raw(n); tried.push(n);
    f = box(t); r = monthly(f);
    if (!r && /^Template:/.test(n)) { const m = /\{\{\s*([^|{}\n]*weather ?box[^|{}\n]*)/i.exec(t); if (m) { f = box(await raw("Template:" + m[1].trim())); r = monthly(f); } }
  }
  if (!r && JA[id]) { f = box(await raw(JA[id], "ja")); r = monthly(f); }
  if (!r) { console.log(id, "気候表がそろわない", tried.join(",")); continue; }
  out[id] = { page: JA[id] && !monthly(box(text)) ? `ja:${JA[id]}` : page, location: String((f && f.location) || "").replace(/<[^>]*>/g, "").slice(0, 120), t: r.t, p: r.p };
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(id, "OK", out[id].location.slice(0, 70), "T", (r.t.reduce((a, b) => a + b, 0) / 12).toFixed(1), "P", r.p.reduce((a, b) => a + b, 0));
}
console.log("完了", Object.keys(out).length, "/", Object.keys(PAGE).length);
