#!/usr/bin/env node
/**
 * 雨温図の元データを NASA POWER(気候値API)から取得して tools/geo-source/climate.json に保存する(開発時だけ)。
 *   node tools/fetch-geo-climate.mjs
 * 各都市の月別の平均気温(T2M・℃)と降水量(PRECTOTCORR・mm/日 → mm/月)。約50km四方の格子の平均なので、
 * 気象台の観測値とは少しずれる。保存済みの climate.json があれば、その都市はスキップする。
 * データ元: NASA POWER (https://power.larc.nasa.gov/) — NASAのデータ(パブリックドメイン)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL("./geo-source/", import.meta.url).pathname;
const cities = readFileSync(dir + "cities.txt", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("|"));
const out = existsSync(dir + "climate.json") ? JSON.parse(readFileSync(dir + "climate.json", "utf8")) : {};
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [id, , , , lat, lon] of cities) {
  if (out[id]) continue;
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR&community=SB&longitude=${lon}&latitude=${lat}&format=JSON`;
  let ok = false;
  for (let k = 0; k < 4 && !ok; k++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const p = (await res.json()).properties.parameter;
      out[id] = {
        t: MONTHS.map((m) => Math.round(p.T2M[m] * 10) / 10),
        p: MONTHS.map((m, i) => Math.round(p.PRECTOTCORR[m] * DAYS[i]))
      };
      ok = true;
      console.log(id, "気温", out[id].t.join(","), "| 降水", out[id].p.join(","));
    } catch (e) { console.log(id, "再試行", e.message); await sleep(3000); }
  }
  writeFileSync(dir + "climate.json", JSON.stringify(out));
  await sleep(1200);
}
console.log("完了", Object.keys(out).length, "都市");
