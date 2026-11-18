#!/usr/bin/env node
/**
 * しりとり用辞書の生成ツール（開発時にだけ実行。ゲーム本体は生成物 data/words.js を読む）
 *
 *   node tools/build-dict.mjs <jamdict.db> --freq <subtlex index.json> \
 *        [--profanity <en.txt>] [--curated tools/curated-words.txt] [--out data/words.js] [--stats]
 *
 * 入力: JMdict を SQLite にしたもの（PyPI の jamdict-data 内の jamdict.db）
 *       英単語の頻度表（npm の subtlex-word-frequencies の index.json）
 *       不適切語リスト（npm の @coffeeandfun/google-profanity-words の data/en.txt）
 * 出力: [読み(ひらがな), 英語(小文字1語), レベル(1〜3), フラグ] の配列
 *   フラグ: 1=主要訳(第1義の先頭2訳) / 2=CPUが出してよい語（日常語・知名度の高い英語）
 *           4=手で選んだ「子どもになじみのある語」(tools/curated-words.txt。CPUが最優先で使う)
 *   プレイヤーの回答はどのペアでも受け付ける。CPUは 4 → 2 の順に選ぶ。
 *
 * データ元: JMdict (c) Electronic Dictionary Research and Development Group,
 *   CC BY-SA 4.0 (https://www.edrdg.org/edrdg/licence.html)
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Rules = require("../js/games/shiritori/rules.js");

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const outPath = valueOf("--out") || "data/words.js";
const freqPath = valueOf("--freq");
const profanityPath = valueOf("--profanity");
const curatedPath = valueOf("--curated") || new URL("./curated-words.txt", import.meta.url).pathname;
const showStats = args.includes("--stats");
function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
if (!dbPath || !freqPath) {
  console.error("usage: node tools/build-dict.mjs <jamdict.db> --freq <index.json> [--profanity <en.txt>] [--out file] [--stats]");
  process.exit(1);
}

/* ---------- 取り込み条件 ---------- */
const POS_OK = new Set([
  "noun (common) (futsuumeishi)",
  "nouns which may take the genitive case particle 'no'"
]);
// 辞書に入れない語: 不適切な語・古すぎる/めずらしい語・名詞として答えにくい語
const MISC_NG = new Set([
  "derogatory", "vulgar expression or word", "slang", "sensitive", "archaism",
  "obscure term", "obsolete term", "rare term", "Internet slang", "yojijukugo",
  "onomatopoeic or mimetic word", "proverb", "idiomatic expression",
  "rude or X-rated term (not displayed in educational software)"
  // 次は除外しない(プレイヤーが答えとして言う、ふつうの日本語): 略語・丁寧語・謙譲語・くだけた語・古めの語・子ども語・男女の言い方・歴史用語
  //   (でんわ=phone, おちゃ=tea, ママ=mama, おやじ=dad など)。CPUは手選びの語しか使わないので、答えの受け入れは広くしてよい
]);
const KANA_NG = new Set([
  "out-dated or obsolete kana usage", "word containing irregular kana usage",
  "gikun (meaning as reading) or jukujikun (special kanji reading)"
]);
const MAX_SENSES = 3;
// 使われやすさの印(優先度タグ)が無い日本語の語は、英語がとても有名な語だけ入れる(それ以外はGeminiが判定する)
const UNTAGGED_RANK = 3000;
// 固有名詞(Paris, India, April…)は、辞書に載っていても大文字で始まるため以前は弾かれていた。
// 印が無い固有名詞(あまり有名でない地名など)は、英語の頻度がある程度高いものだけ入れる
const PROPER_UNTAGGED_RANK = 25000;
// 英語側の念のためのNGワード（JMdictの注意タグで落ちなかった場合の保険）
const BAD_WORDS = new Set([
  "fuck", "shit", "bitch", "bastard", "slut", "whore", "dick", "cock", "pussy",
  "cunt", "nigger", "retard", "rape", "porn", "sex", "penis", "vagina", "anus",
  "semen", "orgasm", "masturbation", "prostitute", "genitals", "breast", "nipple",
  // 固有名詞を入れるようになったので、子ども向けのゲームにふさわしくない語を追加で除く
  "nazi", "nazis", "hitler", "swastika", "kkk"
]);

if (profanityPath) {
  for (const line of readFileSync(profanityPath, "utf8").split(/\r?\n/)) {
    const w = line.trim().toLowerCase();
    if (/^[a-z]+$/.test(w)) BAD_WORDS.add(w);
  }
}

/* 英単語の頻度順位（大文字小文字をまとめて数える）。表にない綴りは「実在しない」とみなして除外 */
const RANK_LIMIT = 70000;
const englishRank = (() => {
  const counts = new Map();
  for (const { word, count } of JSON.parse(readFileSync(freqPath, "utf8"))) {
    const w = word.toLowerCase();
    if (/^[a-z]+$/.test(w)) counts.set(w, (counts.get(w) || 0) + count);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  return new Map(sorted.slice(0, RANK_LIMIT).map(([w], i) => [w, i + 1]));
})();

/** 訳語から「(…)」の補足を取り除く: "apple (fruit)" → "apple" */
function cleanGloss(g) {
  let prev;
  do { prev = g; g = g.replace(/\([^()]*\)/g, ""); } while (g !== prev);
  return g.trim();
}

/* ---------- 読み込み ---------- */
const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql) => db.prepare(sql).all();

const senses = new Map(); // idseq -> [{id, pos:[], misc:[], glosses:[], stagr:[]}]
for (const r of all("SELECT ID id, idseq FROM Sense ORDER BY ID")) {
  if (!senses.has(r.idseq)) senses.set(r.idseq, []);
  senses.get(r.idseq).push({ id: r.id, pos: [], misc: [], glosses: [], stagr: [] });
}
const senseById = new Map();
for (const list of senses.values()) for (const s of list) senseById.set(s.id, s);
const attach = (table, key) => {
  for (const r of all(`SELECT sid, text FROM ${table}`)) {
    const s = senseById.get(r.sid);
    if (s) s[key].push(r.text);
  }
};
attach("pos", "pos"); attach("misc", "misc"); attach("stagr", "stagr");
for (const r of all("SELECT sid, text FROM SenseGloss WHERE lang='eng' ORDER BY rowid")) {
  const s = senseById.get(r.sid);
  if (s) s.glosses.push(r.text);
}

const kanaOf = new Map(); // idseq -> [{id, text, ng}]
const kanaById = new Map();
for (const r of all("SELECT ID id, idseq, text FROM Kana ORDER BY ID")) {
  const k = { id: r.id, text: r.text, ng: false };
  if (!kanaOf.has(r.idseq)) kanaOf.set(r.idseq, []);
  kanaOf.get(r.idseq).push(k);
  kanaById.set(r.id, k);
}
for (const r of all("SELECT kid, text FROM KNI")) {
  const k = kanaById.get(r.kid);
  if (k && KANA_NG.has(r.text)) k.ng = true;
}

const prio = new Map(); // idseq -> Set(tags)
const addPrio = (idseq, tag) => {
  if (!prio.has(idseq)) prio.set(idseq, new Set());
  prio.get(idseq).add(tag);
};
for (const r of all("SELECT k.idseq idseq, p.text text FROM KNP p JOIN Kana k ON k.ID = p.kid")) addPrio(r.idseq, r.text);
for (const r of all("SELECT k.idseq idseq, p.text text FROM KJP p JOIN Kanji k ON k.ID = p.kid")) addPrio(r.idseq, r.text);

/* ---------- 難易度 ---------- */
function freqTier(tags) {
  if (!tags) return 3;
  let nf = 99;
  for (const t of tags) {
    const m = /^nf(\d+)$/.exec(t);
    if (m) nf = Math.min(nf, +m[1]);
  }
  if (tags.has("ichi1") || nf <= 10) return 0;          // 日常語
  if (tags.has("news1") || tags.has("gai1") || tags.has("spec1") || nf <= 24) return 1;
  return 2;
}
/** 難易度は「英語の知名度」が主役。長いつづり・まれな日本語は1段階むずかしくする */
/** CPUが出す語: 主要訳 かつ 英語が有名(上位1万語) かつ 日本語も日常語 */
function cpuOk(tags, english, primary) {
  if (!primary || !tags) return false;
  const rank = englishRank.get(english);
  const everyday = tags.has("ichi1") || tags.has("gai1") || freqTier(tags) === 0;
  return rank <= 10000 && everyday;
}

function levelOf(tags, english) {
  const rank = englishRank.get(english);
  let level = rank <= 3000 ? 1 : rank <= 10000 ? 2 : 3;
  if (english.length >= 9) level++;
  if (freqTier(tags) === 2) level++;
  return Math.min(level, 3);
}

/* ---------- 抽出 ---------- */
const best = new Map(); // "reading|english" -> [reading, english, level, primary]
let carriedPos = null;
for (const [idseq, list] of senses) {
  const tags = prio.get(idseq);
  const untagged = freqTier(tags) === 3;
  const kanas = (kanaOf.get(idseq) || []).filter((k) => !k.ng);
  if (!kanas.length) continue;

  carriedPos = null;
  list.slice(0, MAX_SENSES).forEach((s, si) => {
    const pos = s.pos.length ? s.pos : carriedPos || [];
    if (s.pos.length) carriedPos = s.pos;
    if (!pos.some((p) => POS_OK.has(p))) return;
    if (s.misc.some((m) => MISC_NG.has(m))) return;

    const readings = kanas.filter((k) => !s.stagr.length || s.stagr.includes(k.text));
    s.glosses.forEach((raw, gi) => {
      const word = cleanGloss(raw);
      if (!/^[A-Za-z]{2,20}$/.test(word)) return;
      const g = word.toLowerCase();                        // ゲームの英語は小文字で受け付ける(Paris → paris)
      const proper = /^[A-Z]/.test(word);                  // 固有名詞(地名・月・曜日・言語名など)
      if (BAD_WORDS.has(g) || !englishRank.has(g)) return;
      if (untagged && englishRank.get(g) > (proper ? PROPER_UNTAGGED_RANK : UNTAGGED_RANK)) return;
      for (const k of readings) {
        const reading = Rules.normalizeReading(k.text);
        if (!reading) continue;
        const key = reading + "|" + g;
        const primary = si === 0 && gi <= 1 ? 1 : 0;   // 第1義の先頭2訳だけCPUが使う
        // CPUが出すのは、固有名詞ではない日常語だけ(固有名詞は手選びリストで選んだものだけ)
        const flags = primary | (!proper && cpuOk(tags, g, primary) ? 2 : 0);
        const rec = [reading, g, untagged ? 3 : levelOf(tags, g), flags];
        const old = best.get(key);
        if (!old || rec[3] > old[3] || (rec[3] === old[3] && rec[2] < old[2])) best.set(key, rec);
      }
    });
  });
}

/* 手選びリスト: 辞書に同じペアがあれば印を付け、なければ（複数語の訳しかない語など）直接追加する */
let curatedHit = 0;
const curatedAdded = [];
for (const line of readFileSync(curatedPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const [r, e] = t.split(/\s+/);
  const reading = Rules.normalizeReading(r);
  if (!reading || !englishRank.has(e) || BAD_WORDS.has(e)) {
    console.warn(`  skip (invalid): ${t}`);
    continue;
  }
  const rec = best.get(reading + "|" + e);
  if (rec) { rec[3] |= 1 | 2 | 4; curatedHit++; }
  else {
    const rank = englishRank.get(e);
    best.set(reading + "|" + e, [reading, e, rank <= 3000 ? 1 : rank <= 10000 ? 2 : 3, 1 | 2 | 4]);
    curatedAdded.push(t);
  }
}
console.log(`curated: ${curatedHit} matched JMdict, ${curatedAdded.length} added directly`);
if (curatedAdded.length) console.log("  added directly (not a single-word gloss in JMdict):", curatedAdded.join(" / "));

const pairs = [...best.values()].sort((a, b) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1);

/* ---------- 出力 ---------- */
const body = {
  version: 1,
  source: "JMdict (c) EDRDG, CC BY-SA 4.0 https://www.edrdg.org/edrdg/licence.html",
  fields: ["reading", "english", "level", "flags"],
  count: pairs.length,
  pairs
};
writeFileSync(
  outPath,
  "/* 自動生成: tools/build-dict.mjs — 直接編集しないこと */\n" +
    "window.SHIRITORI_WORDS = " + JSON.stringify(body) + ";\n"
);
console.log(`wrote ${outPath}: ${pairs.length} pairs`);

if (showStats) {
  const lv = [0, 0, 0, 0];
  let primary = 0, cpu = 0, curated = 0;
  const cpuHead = new Map(), cpuTail = new Map();
  for (const [r, , l, f] of pairs) {
    lv[l]++;
    if (f & 1) primary++;
    if (f & 4) curated++;
    if (f & 2) {
      cpu++;
      const h = Rules.getHeadKana(r), t = Rules.getTailKana(r);
      cpuHead.set(h, (cpuHead.get(h) || 0) + 1);
      cpuTail.set(t, (cpuTail.get(t) || 0) + 1);
    }
  }
  console.log("level1/2/3:", lv[1], lv[2], lv[3], " primary:", primary, " cpu:", cpu, " curated:", curated);
  // CPUが「次の語」を出せるか: 語尾の文字ごとに、その文字から始まるCPU語の数
  const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(" ");
  console.log("cpu head:", fmt(cpuHead));
  const thin = [...cpuTail.keys()].filter((t) => t !== "ん" && (cpuHead.get(t) || 0) < 5);
  console.log("CPU語の語尾で、次を出せる語が5未満の文字:", thin.map((t) => `${t}(${cpuHead.get(t) || 0})`).join(" ") || "なし");
}
