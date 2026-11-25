#!/usr/bin/env node
/**
 * 化学クイズの問題データ data/chem.js を、tools/chem-source/ の元データから作る(開発時だけ)。
 *   node tools/build-chem.mjs
 * 元データ(手書き。オリジナルの問題で、過去問の文章は使わない):
 *   buzz.txt    早押し   id|単元|レベル1〜3|大学入試(0=出さない/1〜3=基礎・標準・発展。「x2」のように x を付けると、大学入試だけの問題)|問題文|答えの表示|読み(,区切り)|化学式(,区切り・省略可)
 *   choice.txt  資料選択 id|単元|レベル|大学入試|問題|正解|まちがい1|まちがい2|まちがい3|資料(JSON・省略可)
 *   buzz-*.txt / choice-*.txt  は、まとめて読む(分けて書ける)
 * 計算の問題は、データではなくテンプレート(js/games/chem/calc.js)。ここでは、検査だけする。
 * 問題文・選択肢の化学式は [[H2SO4]] [[Cu^2+]] のように書く。資料(JSON)の例: {"k":"table","head":["物質","沸点(℃)"],"rows":[["水",100]]}
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url).pathname;
const dir = root + "tools/chem-source/";
const Units = require(root + "js/games/chem/units.js");
const Gen = require(root + "tools/chem-source/chart-gen.cjs");
const warn = [];
const files = (prefix) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".txt")).sort() : []);
const lines = (prefix) => files(prefix).flatMap((f) => readFileSync(dir + f, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => ({ f, l })));
const unitIds = new Set(Units.IDS);
const hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isReading = (s) => /^[ぁ-んーa-z0-9.]+$/.test(s);

/** 学年の印: "0"=高校だけ / "1〜3"=高校にも大学入試にも / "x1〜x3"=大学入試だけ */
function grade(lvText, exText) {
  const x = /^x([1-3])$/.exec(exText);
  if (x) return { lv: 3, ex: Number(x[1]), xo: 1 };
  const ex = Number(exText);
  return { lv: Number(lvText), ex: [0, 1, 2, 3].includes(ex) ? ex : -1 };
}

const buzz = [];
for (const { f, l } of lines("buzz")) {
  const [id, u, lv, ex, text, ans, yomi, forms] = l.split("|");
  const g = grade(lv, ex);
  if (!unitIds.has(u) || ![1, 2, 3].includes(g.lv) || g.ex < 0 || !text || !ans || !yomi) { warn.push(`${f} ${id}: 形式`); continue; }
  const ys = yomi.split(",").map((s) => hira(s.trim())).filter(Boolean);
  for (const y of ys) if (!isReading(y)) warn.push(`${f} ${id}: 読みがかなでない "${y}"`);
  if (!/[？。]$/.test(text)) warn.push(`${f} ${id}: 問題文が「？」か「。」で終わらない`);
  const q = { id, u, lv: g.lv, ...(g.ex ? { ex: g.ex } : {}), ...(g.xo ? { xo: 1 } : {}), text, ans, yomi: ys };
  const fs = (forms || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fs.length) q.f = fs;
  buzz.push(q);
}

const choice = [];
for (const { f, l } of lines("choice")) {
  const a = l.split("|");
  const [id, u, lv, ex, q, ans, w1, w2, w3] = a;
  const g = grade(lv, ex);
  const c = [ans, w1, w2, w3];
  if (!unitIds.has(u) || ![1, 2, 3].includes(g.lv) || g.ex < 0 || !q || c.some((x) => !x) || new Set(c).size !== 4) { warn.push(`${f} ${id}: 形式(選択肢が4つで重ならない)`); continue; }
  let m = {};
  if (a[9]) {
    try { m = JSON.parse(a.slice(9).join("|")); } catch (e) { warn.push(`${f} ${id}: 資料のJSON`); continue; }
    if (m.gen) { try { m = Gen.make(m); } catch (e) { warn.push(`${f} ${id}: 資料の生成 ${e.message}`); continue; } }
  }
  choice.push({ id, u, lv: g.lv, ...(g.ex ? { ex: g.ex } : {}), ...(g.xo ? { xo: 1 } : {}), k: m.k || "text", q, m, c, a: 0 });
}
for (const list of [buzz, choice]) if (new Set(list.map((x) => x.id)).size !== list.length) warn.push("id が重複");

const data = { version: 1, source: "オリジナルの問題(化学クイズ)", buzz, choice };
const body = `/* 自動生成: tools/build-chem.mjs — 直接編集しないこと */\nwindow.CHEM_DATA = ${JSON.stringify(data)};\n`;
writeFileSync(root + "data/chem.js", body);
const byUnit = (list) => Units.LIST.map((u) => `${u.id}:${list.filter((x) => x.u === u.id).length}`).join(" ");
console.log(`早押し ${buzz.length} / 資料選択 ${choice.length} / 出力 data/chem.js (${(body.length / 1024).toFixed(0)} KB)`);
console.log("早押し 単元別:", byUnit(buzz));
console.log("資料選択 単元別:", byUnit(choice));
if (warn.length) { console.log(`警告 ${warn.length}件:`); warn.slice(0, 40).forEach((w) => console.log("  - " + w)); process.exitCode = 1; }
