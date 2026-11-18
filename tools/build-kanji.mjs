#!/usr/bin/env node
/**
 * ミニ漢字検定の出題データを作るツール（開発時にだけ実行。生成物 data/kanji.js をゲームが読む）
 *
 *   node tools/build-kanji.mjs <jamdict.db> [--out data/kanji.js] [--stats]
 *
 * 入力: jamdict.db（PyPI の jamdict-data。JMdict と KANJIDIC2 が入っている）
 * 出力: 常用漢字 2,136字（小1〜高3）と、そこから作る熟語の問題データ
 *   kanji: [字, レベル1〜5, 学年, 音読み(ひらがな, カンマ区切り)]
 *   words: [熟語, 読み, レベル, 書き取りで空欄にする位置(-1=読みだけ), にせ漢字の候補(文字列)]
 *
 * 品質のための決まり
 *  ・読みが1通りに決まる語だけを使う（同じ表記で読みが複数ある語は除く）
 *  ・書き取り(4択)は「全部が音読みの熟語」だけ。読みを漢字ごとに分けられた語だけ使う
 *  ・にせ漢字は「同じ音読みの別の常用漢字」。それに置きかえた語が辞書に実在するなら、その字は使わない
 *
 * データ元: JMdict / KANJIDIC2 (c) EDRDG, CC BY-SA 4.0 https://www.edrdg.org/edrdg/licence.html
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : "data/kanji.js";
const showStats = args.includes("--stats");
if (!dbPath) { console.error("usage: node tools/build-kanji.mjs <jamdict.db> [--out file] [--stats]"); process.exit(1); }

const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql) => db.prepare(sql).all();
const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isKanji = (ch) => /[一-龠]/.test(ch);

/* ---------- 常用漢字とレベル ---------- */
const chars = new Map();   // 字 -> {grade, freq, strokes, radical, on:[ひらがな]}
for (const r of all("SELECT ID id, literal, grade, freq, stroke_count strokes FROM character WHERE grade IN ('1','2','3','4','5','6','8')")) {
  chars.set(r.literal, { id: r.id, grade: +r.grade, freq: r.freq == null ? null : +r.freq, strokes: +r.strokes || 0, radical: 0, on: [] });
}
const byId = new Map([...chars].map(([k, v]) => [v.id, k]));
for (const r of all("SELECT g.cid cid, r.value value FROM reading r JOIN rm_group g ON g.ID = r.gid WHERE r.r_type = 'ja_on'")) {
  const ch = byId.get(r.cid);
  if (ch) chars.get(ch).on.push(kata2hira(r.value));
}
for (const r of all("SELECT cid, value FROM radical WHERE rad_type = 'classical'")) {
  const ch = byId.get(r.cid);
  if (ch) chars.get(ch).radical = +r.value;
}
// レベル: 小1-2=1 / 小3-4=2 / 小5-6=3 / 中・高(学年8)は使われやすさ順に半分ずつ=4,5
const level = new Map();
const secondary = [...chars].filter(([, v]) => v.grade === 8)
  .sort((a, b) => (a[1].freq ?? 1e9) - (b[1].freq ?? 1e9));
for (const [ch, v] of chars) {
  if (v.grade <= 2) level.set(ch, 1);
  else if (v.grade <= 4) level.set(ch, 2);
  else if (v.grade <= 6) level.set(ch, 3);
}
secondary.forEach(([ch], i) => level.set(ch, i < secondary.length / 2 ? 4 : 5));

const onIndex = new Map(); // 音読み(ひらがな) -> [字]
for (const [ch, v] of chars) for (const o of new Set(v.on)) {
  if (!onIndex.has(o)) onIndex.set(o, []);
  onIndex.get(o).push(ch);
}

/* ---------- 辞書の語 ---------- */
const entryKanji = new Map();   // idseq -> [{id,text}]
const allForms = new Set();     // 辞書にある全ての漢字表記（にせ漢字の検査用）
for (const r of all("SELECT ID id, idseq, text FROM Kanji")) {
  allForms.add(r.text);
  if (!entryKanji.has(r.idseq)) entryKanji.set(r.idseq, []);
  entryKanji.get(r.idseq).push({ id: r.id, text: r.text });
}
const kanaOf = new Map();       // idseq -> [読み]
for (const r of all("SELECT idseq, text FROM Kana")) {
  if (!kanaOf.has(r.idseq)) kanaOf.set(r.idseq, []);
  kanaOf.get(r.idseq).push(kata2hira(r.text));
}
// 表記ごとの読み(全エントリ分)。2つ以上あれば「読みが1通りでない」ので使わない
const readingsOfForm = new Map();
for (const [idseq, forms] of entryKanji) for (const f of forms) {
  if (!readingsOfForm.has(f.text)) readingsOfForm.set(f.text, new Set());
  for (const k of kanaOf.get(idseq) || []) readingsOfForm.get(f.text).add(k);
}
const kjInfoTagged = new Set(); // 当て字・不規則・古い表記などの注意タグがある漢字表記のID
for (const r of all("SELECT kid FROM KJI")) kjInfoTagged.add(r.kid);
const kjPrio = new Map();       // 漢字表記のID -> タグ
for (const r of all("SELECT kid, text FROM KJP")) {
  if (!kjPrio.has(r.kid)) kjPrio.set(r.kid, new Set());
  kjPrio.get(r.kid).add(r.text);
}
const senseInfo = new Map();    // idseq -> {pos:Set, misc:Set}
for (const r of all("SELECT s.idseq idseq, p.text text FROM pos p JOIN Sense s ON s.ID = p.sid")) {
  if (!senseInfo.has(r.idseq)) senseInfo.set(r.idseq, { pos: new Set(), misc: new Set() });
  senseInfo.get(r.idseq).pos.add(r.text);
}
for (const r of all("SELECT s.idseq idseq, m.text text FROM misc m JOIN Sense s ON s.ID = m.sid")) {
  if (!senseInfo.has(r.idseq)) senseInfo.set(r.idseq, { pos: new Set(), misc: new Set() });
  senseInfo.get(r.idseq).misc.add(r.text);
}
const MISC_NG = new Set([
  "derogatory", "vulgar expression or word", "slang", "sensitive", "archaism", "obscure term", "obsolete term",
  "rare term", "Internet slang", "historical term", "dated term", "yojijukugo", "proverb", "idiomatic expression",
  "rude or X-rated term (not displayed in educational software)", "jocular, humorous term", "familiar language",
  "children's language", "female term or language", "male term or language"
]);
const POS_OK = (p) => /noun|verb|adjective|adverb/i.test(p) && !/expression|interjection|prefix|suffix|counter|pronoun|numeric/i.test(p);

const RANK_MAX = 30;

function prioRank(tags) {       // 小さいほど日常的
  if (!tags) return 99;
  let nf = 99;
  for (const t of tags) { const m = /^nf(\d+)$/.exec(t); if (m) nf = Math.min(nf, +m[1]); }
  if (tags.has("ichi1")) nf = Math.min(nf, 10);
  if (tags.has("news1") || tags.has("spec1")) nf = Math.min(nf, 20);
  if (tags.has("news2") || tags.has("ichi2") || tags.has("spec2")) nf = Math.min(nf, 40);
  return nf;
}

/* ---------- 音読みで読みを漢字ごとに分ける ---------- */
const DAKU = { か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご", さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど", は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ" };
const HANDAKU = { は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ" };
const ZU = { ぢ: "じ", づ: "ず" };
const norm = (s) => s.replace(/[ぢづ]/g, (c) => ZU[c]);   // 「ぢ/づ」は「じ/ず」と同じ扱い

/** 音読み base が、語の中で取りうる形 */
function variants(base) {
  const out = new Set([base]);
  const first = base[0], rest = base.slice(1);
  if (DAKU[first]) out.add(DAKU[first] + rest);
  if (HANDAKU[first]) out.add(HANDAKU[first] + rest);
  for (const v of [...out]) {                                // 促音: 学(がく)→がっ  日(にち)→にっ
    if (/[くつきち]$/.test(v) && v.length >= 2) out.add(v.slice(0, -1) + "っ");
  }
  return [...out];
}

/** 全部が音読みの熟語なら、各字が使った音読み(base)の配列を返す。分けられなければ null */
function alignOn(word, reading) {
  const cs = [...word];
  const target = norm(reading);
  function go(i, pos) {
    if (i === cs.length) return pos === target.length ? [] : null;
    const info = chars.get(cs[i]);
    if (!info) return null;
    for (const base of new Set(info.on)) {
      for (const v of variants(base)) {
        const nv = norm(v);
        if (target.startsWith(nv, pos)) {
          const rest = go(i + 1, pos + nv.length);
          if (rest) return [base, ...rest];
        }
      }
    }
    return null;
  }
  return go(0, 0);
}

/* ---------- 語の抽出 ---------- */
const picked = new Map(); // 表記 -> {reading, level, rank, segs}
for (const [idseq, forms] of entryKanji) {
  const info = senseInfo.get(idseq);
  if (!info || ![...info.pos].some(POS_OK)) continue;
  if ([...info.misc].some((m) => MISC_NG.has(m))) continue;
  const readings = kanaOf.get(idseq) || [];
  for (const f of forms) {
    const text = f.text;
    const rank = prioRank(kjPrio.get(f.id));
    if (rank > RANK_MAX) continue;                             // よく使う語だけ
    if (kjInfoTagged.has(f.id)) continue;                      // 当て字・古い表記などは使わない
    const ks = [...text].filter(isKanji);
    if (!ks.length || text.includes("々")) continue;
    if (![...text].every((c) => isKanji(c) || /[ぁ-ん]/.test(c))) continue;   // 漢字とひらがなだけ
    if (ks.some((k) => !chars.has(k))) continue;               // 常用漢字だけの語
    const rset = readingsOfForm.get(text);
    if (!rset || rset.size !== 1) continue;                    // 読みが1通りに決まる語だけ
    const reading = [...rset][0];
    if (!/^[ぁ-ゖー]+$/.test(reading)) continue;
    const lv = Math.max(...ks.map((k) => level.get(k)));
    const old = picked.get(text);
    if (!old || rank < old.rank) picked.set(text, { text, reading, level: lv, rank, ks });
  }
}

/** 書き取り用: 空欄にする字と、にせ漢字の候補を決める */
function blankInfo(w) {
  if ([...w.text].some((c) => !isKanji(c))) return null;       // 全部が漢字の熟語だけ
  const segs = alignOn(w.text, w.reading);
  if (!segs) return null;
  const cs = [...w.text];
  let best = null;
  cs.forEach((ch, i) => {
    const lv = level.get(ch);
    const sibs = (onIndex.get(segs[i]) || []).filter((s) => s !== ch);
    const good = sibs.filter((s) => {
      const t = cs.slice(); t[i] = s;
      return !allForms.has(t.join(""));                         // その字に置きかえた語が実在するなら使わない
    });
    // 並べ方: ①問題より難しい字は後ろ ②同じ部首 ③レベルが近い ④画数が近い（紛らわしい字ほど先）
    const me = chars.get(ch);
    const keyOf = (c) => {
      const o = chars.get(c);
      return [level.get(c) > lv ? 1 : 0, o.radical === me.radical ? 0 : 1, Math.abs(level.get(c) - lv), Math.abs(o.strokes - me.strokes)];
    };
    good.sort((a, b) => {
      const ka = keyOf(a), kb = keyOf(b);
      for (let n = 0; n < ka.length; n++) if (ka[n] !== kb[n]) return ka[n] - kb[n];
      return a < b ? -1 : 1;
    });
    if (good.length >= 3) {
      const score = (lv === w.level ? 1000 : 0) + good.filter((s) => level.get(s) <= lv).length;
      if (!best || score > best.score) best = { i, good: good.slice(0, 8), score };
    }
  });
  return best;
}

const words = [];
for (const w of picked.values()) {
  const b = blankInfo(w);
  words.push([w.text, w.reading, w.level, b ? b.i : -1, b ? b.good.join("") : "", w.rank]);
}
words.sort((a, b) => a[2] - b[2] || a[5] - b[5] || (a[0] < b[0] ? -1 : 1));

const kanji = [...chars].map(([ch, v]) => [ch, level.get(ch), v.grade, [...new Set(v.on)].join(",")])
  .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));

const body = {
  version: 1,
  source: "JMdict / KANJIDIC2 (c) EDRDG, CC BY-SA 4.0 https://www.edrdg.org/edrdg/licence.html",
  fields: { kanji: ["char", "level", "grade", "on"], words: ["text", "reading", "level", "blankIndex", "decoys", "rank"] },
  kanji,
  words: words.map((w) => w.slice(0, 5))
};
writeFileSync(outPath, "/* 自動生成: tools/build-kanji.mjs — 直接編集しないこと */\nwindow.KANKEN_DATA = " + JSON.stringify(body) + ";\n");
console.log(`wrote ${outPath}: ${kanji.length} kanji, ${words.length} words`);

if (showStats) {
  const lv = (arr, f) => [1, 2, 3, 4, 5].map((l) => arr.filter((x) => f(x) === l).length);
  console.log("漢字 Lv1-5:", lv(kanji, (k) => k[1]).join(" / "));
  console.log("語   Lv1-5:", lv(words, (w) => w[2]).join(" / "));
  console.log("書き取り可 Lv1-5:", lv(words.filter((w) => w[3] >= 0), (w) => w[2]).join(" / "));
  const cov = new Map();
  for (const w of words) for (const ch of w[0]) if (isKanji(ch)) cov.set(ch, (cov.get(ch) || 0) + 1);
  const none = kanji.filter((k) => !cov.has(k[0]));
  console.log("熟語が1つも無い漢字:", none.length, none.slice(0, 40).map((k) => k[0]).join(""));
}
