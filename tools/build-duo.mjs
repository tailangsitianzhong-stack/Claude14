/**
 * 二択クイズの問題データ(data/duo.js)を作る。直接編集しない。元は tools/duo-source/ と tools/geo-source/wb.json。
 *
 *   node tools/build-duo.mjs
 *
 * 元のファイル(tools/duo-source/):
 *   en-*.txt / phys-*.txt / geo-*.txt   id|大学入試(1=基礎 2=標準 3=発展)|問題文|正解|まちがい|解説(省略可)
 *     正解と、まちがい(1つ)を書く。左右はゲームが毎回ランダムに決める。化学式・数式は [[H2SO4]] [[v^2]] のように [[ ]] で囲む(下つき・上つきで表示される)
 * 自動で作るもの: 地理の統計の比較(世界銀行 World Bank Open Data・CC BY 4.0 の近年の値から、「人口が多いのは？」など)
 * 化学・地理の問題は、ゲームを始める時に data/chem.js・data/geo.js から二択に変換する(questions.js)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..") + "/";
const warn = [];

function lines(prefix) {
  const dir = root + "tools/duo-source/";
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".txt")).sort().flatMap((f) =>
    fs.readFileSync(dir + f, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => ({ f, l })));
}

const items = [];
const SUBJ = { en: "en", phys: "phys", geo: "geo" };
for (const prefix of Object.keys(SUBJ)) {
  for (const { f, l } of lines(prefix + "-")) {
    const [id, ex, q, right, wrong, explain] = l.split("|").map((s) => s.trim());
    const e = Number(ex);
    if (!id || ![1, 2, 3].includes(e) || !q || !right || !wrong) { warn.push(`${f} ${id}: 形式`); continue; }
    if (right === wrong) warn.push(`${f} ${id}: 正解とまちがいが同じ`);
    if (!/[？。）)」.?!"'’”A-Za-z~]$/.test(q)) warn.push(`${f} ${id}: 問題文の終わり`);
    if (/\[\[/.test(q + right + wrong) && (q + right + wrong).split("[[").length !== (q + right + wrong).split("]]").length) warn.push(`${f} ${id}: [[ ]] が対になっていない`);
    items.push({ id, s: prefix, ex: e, q, c: [right, wrong], ...(explain ? { e: explain } : {}) });
  }
}

/* ---------- 地理の統計の比較(世界銀行の値から) ---------- */
const wb = JSON.parse(fs.readFileSync(root + "tools/geo-source/wb.json", "utf8"));
const names = new Map(), fame = new Map();
for (const l of fs.readFileSync(root + "tools/geo-source/countries.txt", "utf8").split("\n")) {
  if (!l || l.startsWith("#")) continue;
  const [code, name] = l.split("|");
  names.set(code, name);
}
for (const l of fs.readFileSync(root + "tools/geo-source/fame.txt", "utf8").split("\n")) {
  const m = /^country([12])\|(.*)$/.exec(l);
  if (m) for (const c of m[2].trim().split(/\s+/)) fame.set(c, Number(m[1]));
}
const val = (ind, code) => (wb[ind] && wb[ind][code] ? wb[ind][code].v : null);
const area = (code) => { const p = val("pop", code), d = val("density", code); return p && d ? p / d : null; };
const fmtBig = (n) => (n >= 1e8 ? `約${(n / 1e8).toFixed(n >= 1e9 ? 1 : 2).replace(/\.?0+$/, "")}億` : n >= 1e4 ? `約${Math.round(n / 1e4).toLocaleString("en-US")}万` : `約${Math.round(n)}`);
const IND = [
  { key: "pop", q: "人口が多い", get: (c) => val("pop", c), fmt: (v) => fmtBig(v) + "人", min: 1.8, unit: "人口" },
  { key: "area", q: "面積が大きい", get: area, fmt: (v) => (v >= 1e4 ? `約${Math.round(v / 1e4).toLocaleString("en-US")}万` : `約${Math.round(v).toLocaleString("en-US")}`) + "km²", min: 2, unit: "面積" },
  { key: "density", q: "人口密度が高い", get: (c) => val("density", c), fmt: (v) => `約${Math.round(v).toLocaleString("en-US")}人/km²`, min: 2.5, unit: "人口密度" },
  { key: "urban", q: "都市人口率が高い", get: (c) => val("urban", c), fmt: (v) => `約${Math.round(v)}%`, min: 1.35, unit: "都市人口率" },
  { key: "gni", q: "1人あたり国民総所得が高い", get: (c) => val("gni", c), fmt: (v) => `約${Math.round(v).toLocaleString("en-US")}ドル`, min: 2.5, unit: "1人あたり国民総所得" },
  { key: "life", q: "平均寿命が長い", get: (c) => val("life", c), fmt: (v) => `約${Math.round(v)}歳`, min: 1.1, unit: "平均寿命" },
  { key: "agri", q: "農業で働く人の割合が高い", get: (c) => val("agri", c), fmt: (v) => `約${Math.round(v)}%`, min: 3, unit: "農業で働く人の割合" }
];
let seed = 20261125;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const known = [...names.keys()].filter((c) => fame.has(c));
const PER = 28;
for (const ind of IND) {
  const have = known.filter((c) => ind.get(c) != null && Number.isFinite(ind.get(c)) && !(ind.key === "agri" && ind.get(c) < 0.5));
  const made = new Set();
  let tries = 0, n = 0;
  while (n < PER && tries++ < 4000) {
    const a = have[Math.floor(rnd() * have.length)], b = have[Math.floor(rnd() * have.length)];
    if (a === b) continue;
    const va = ind.get(a), vb = ind.get(b);
    const hi = Math.max(va, vb), lo = Math.min(va, vb);
    if (lo <= 0 || hi / lo < ind.min) continue;
    const key = [a, b].sort().join("-");
    if (made.has(key)) continue;
    made.add(key); n++;
    const [win, lose] = va > vb ? [a, b] : [b, a];
    const f = (fame.get(a) === 1 && fame.get(b) === 1) ? 1 : (fame.get(a) === 3 || fame.get(b) === 3) ? 3 : 2;
    const ex = Math.min(3, f + (hi / lo < ind.min * 1.6 ? 1 : 0));
    items.push({
      id: `geo-${ind.key}-${win}-${lose}`, s: "geo", ex,
      q: `世界銀行などの近年の統計で、${ind.q}のは、次のうちどちらでしょう？`,
      c: [names.get(win), names.get(lose)],
      e: `${ind.unit}は、${names.get(win)}が${ind.fmt(ind.get(win))}、${names.get(lose)}が${ind.fmt(ind.get(lose))}です。`
    });
  }
}

/* ---------- 検査 ---------- */
if (new Set(items.map((x) => x.id)).size !== items.length) warn.push("id が重複");
const qs = new Map();
for (const x of items) { const k = x.q + "|" + x.c[0] + "|" + x.c[1]; if (qs.has(k)) warn.push(`${x.id}: ${qs.get(k)} と同じ問題`); qs.set(k, x.id); }

const data = { version: 1, source: "オリジナルの問題(二択クイズ)。地理の統計の比較は World Bank Open Data(CC BY 4.0)の近年の値", items };
const body = "/* 自動生成(tools/build-duo.mjs)。直接編集しない */\nwindow.DUO_DATA = " + JSON.stringify(data) + ";\n";
fs.writeFileSync(root + "data/duo.js", body);

const by = (s) => items.filter((x) => x.s === s);
const exs = (list) => [1, 2, 3].map((e) => list.filter((x) => x.ex === e).length).join(" / ");
console.log(`二択 ${items.length} 問 / 出力 data/duo.js (${(body.length / 1024).toFixed(0)} KB)`);
for (const s of ["en", "phys", "geo"]) console.log(`  ${s}: ${by(s).length} 問 (基礎/標準/発展 ${exs(by(s))})`);
if (warn.length) { console.log(`警告 ${warn.length}件:`); for (const w of warn.slice(0, 50)) console.log("  - " + w); }
