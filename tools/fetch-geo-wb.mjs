#!/usr/bin/env node
/**
 * 高校地理の「統計の表」問題の元データを、世界銀行(World Bank Open Data)から取得して tools/geo-source/wb.json に保存する(開発時だけ)。
 *   node tools/fetch-geo-wb.mjs
 * 国ごとの、いちばん新しい値(mrnev)。保存済みの指標はスキップする。
 * データ元: World Bank Open Data (https://data.worldbank.org/) — CC BY 4.0
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const path = new URL("./geo-source/wb.json", import.meta.url).pathname;
const out = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const INDICATORS = {
  pop: "SP.POP.TOTL",          // 人口
  age14: "SP.POP.0014.TO.ZS",  // 年少人口の割合(%)
  age64: "SP.POP.1564.TO.ZS",  // 生産年齢人口の割合(%)
  age65: "SP.POP.65UP.TO.ZS",  // 老年人口の割合(%)
  density: "EN.POP.DNST",      // 人口密度(人/km²)
  urban: "SP.URB.TOTL.IN.ZS",  // 都市人口率(%)
  gni: "NY.GNP.PCAP.CD",       // 1人あたり国民総所得(ドル)
  life: "SP.DYN.LE00.IN",      // 平均寿命(歳)
  birth: "SP.DYN.CBRT.IN",     // 出生率(人口1000人あたり)
  agri: "SL.AGR.EMPL.ZS"       // 農業就業者の割合(%)
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [key, code] of Object.entries(INDICATORS)) {
  if (out[key] && Object.keys(out[key]).length > 100) continue;
  const url = `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=400&mrnev=1`;
  let ok = false;
  for (let k = 0; k < 4 && !ok; k++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const [, rows] = await res.json();
      out[key] = {};
      for (const r of rows || []) if (r.value != null && r.countryiso3code) out[key][r.countryiso3code] = { v: r.value, y: Number(r.date) };
      console.log(key, code, Object.keys(out[key]).length, "か国");
      ok = true;
    } catch (e) { console.log(key, "再試行", e.message); await sleep(3000); }
  }
  writeFileSync(path, JSON.stringify(out));
  await sleep(800);
}
console.log("完了", Object.keys(out).join(","));
