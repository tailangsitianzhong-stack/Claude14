#!/usr/bin/env node
/**
 * 英単語トランスミッション(ワードラダー)用のデータ data/ladder.js を作る。直接編集しない。
 *
 *   node tools/build-ladder.mjs <jamdict.db> [--out data/ladder.js] [--stats]
 *
 * 入力: JMdict を SQLite にしたもの(PyPI の jamdict-data 内の jamdict.db。tools/build-dict.mjs と同じ)
 *       英単語の頻度順位・不適切語の除外は、すでにある data/nep.js(SUBTLEX-US 由来の語彙表。不適切語を除いてある)を使う
 * 出力: words  … [単語, 頻度順位, "品詞:意味|品詞:意味"](3〜5文字の英単語。意味は日本語。「岩（いわ）」のように漢字と読みを並べる)
 *       puzzles … [スタート, ゴール, 最短の手数, 難しさ(1〜3)]  すべて、辞書の単語だけで必ず解ける組
 *
 * 辞書にない単語(固有名詞・活用形・めずらしい語など)も、ゲームの中では AI が確認して認める。ここでは「確実に解ける問題」と
 * 「意味をすぐ出せる単語」だけを用意する。
 *
 * データ元: JMdict (c) Electronic Dictionary Research and Development Group, CC BY-SA 4.0
 *   (https://www.edrdg.org/edrdg/licence.html)  英単語の頻度: SUBTLEX-US
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..") + "/";
const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const outPath = (args.includes("--out") ? args[args.indexOf("--out") + 1] : root + "data/ladder.js");
if (!dbPath) { console.error("usage: node tools/build-ladder.mjs <jamdict.db> [--out file] [--stats]"); process.exit(1); }

/* ---------- 英語の頻度順位(data/nep.js の vocab。頻度の高い順) ---------- */
globalThis.window = globalThis;
await import(root + "data/nep.js");
const vocab = globalThis.NEP_DATA.vocab.split(" ");
const rankOf = new Map(vocab.map((w, i) => [w, i + 1]));

/* ---------- 取り込み条件 ---------- */
const MISC_NG = new Set([
  "derogatory", "vulgar expression or word", "slang", "sensitive", "archaism", "obscure term", "obsolete term", "rare term",
  "Internet slang", "yojijukugo", "onomatopoeic or mimetic word", "proverb", "idiomatic expression",
  "rude or X-rated term (not displayed in educational software)", "colloquialism", "dated term", "abbreviation", "male term or language", "female term or language"
]);
const KANA_NG = new Set(["out-dated or obsolete kana usage", "word containing irregular kana usage", "gikun (meaning as reading) or jukujikun (special kanji reading)"]);
const BAD_WORDS = new Set(["fuck", "shit", "bitch", "bastard", "slut", "whore", "dick", "cock", "pussy", "cunt", "nigger", "retard", "rape", "porn", "sex", "sexy", "penis", "vagina", "anus", "semen", "orgasm", "tits", "boob", "boobs", "nazi", "kkk", "damn", "hell", "piss", "crap", "fag", "gay", "kill", "dead", "die", "drug", "drugs", "nude", "naked", "slave", "bomb", "suicide"]);
// 意味がずれやすい語(機能語・代名詞・助動詞など)は辞書に入れない。ゲームの中では AI が判定して意味をつける
const FUNCTION_WORDS = new Set(`for and the that this with from but not can she her his him one now here will out just some then too any two sir doing going even over down very more much only also than such each both once ever else when what which who whom how why where them they their there these those were been being would could should might must shall may your mine ours hers does did done got gets let lets was are has had its our you yes yet nor off per via was ago own same said says nobody anybody everybody somebody nothing anything everything something`.split(/\s+/));
const RANK_MAX = 60000;            // 頻度順位の上限(これより珍しい単語は辞書に入れない)
const POS_JA = [
  [/^noun/, "名詞"], [/^pronoun/, "代名詞"], [/verb/, "動詞"], [/^adjective|^adjectival nouns/, "形容詞"], [/^adverb/, "副詞"],
  [/^preposition|^particle/, "前置詞"], [/^conjunction/, "接続詞"], [/^interjection/, "感嘆詞"], [/^auxiliary/, "助動詞"], [/^counter/, "助数詞"]
];
const posJa = (poss) => { for (const p of poss) for (const [re, ja] of POS_JA) if (re.test(p)) return ja; return ""; };

/** 訳語を、辞書の見出しにする: "to joke" → "joke", "rock (music)" → "rock"。大文字で始まる語(固有名詞)は除く */
function headword(raw) {
  let g = raw, prev;
  do { prev = g; g = g.replace(/\([^()]*\)/g, ""); } while (g !== prev);
  g = g.trim();
  if (/^[A-Z]/.test(g)) return null;
  g = g.replace(/^(to|a|an|the)\s+/, "");
  return /^[a-z]{3,5}$/.test(g) ? g : null;
}

/* ---------- JMdict の読み込み ---------- */
const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql) => db.prepare(sql).all();
const senses = new Map(), senseById = new Map();
for (const r of all("SELECT ID id, idseq FROM Sense ORDER BY ID")) {
  if (!senses.has(r.idseq)) senses.set(r.idseq, []);
  const s = { id: r.id, pos: [], misc: [], glosses: [], stagr: [], stagk: [] };
  senses.get(r.idseq).push(s); senseById.set(r.id, s);
}
for (const [table, key] of [["pos", "pos"], ["misc", "misc"], ["stagr", "stagr"], ["stagk", "stagk"]]) for (const r of all(`SELECT sid, text FROM ${table}`)) { const s = senseById.get(r.sid); if (s) s[key].push(r.text); }
for (const r of all("SELECT sid, text FROM SenseGloss WHERE lang='eng' ORDER BY rowid")) { const s = senseById.get(r.sid); if (s) s.glosses.push(r.text); }
const kanaOf = new Map(), kanaById = new Map(), kanjiOf = new Map(), kanjiById = new Map();
for (const r of all("SELECT ID id, idseq, text FROM Kana ORDER BY ID")) { const k = { text: r.text, ng: false }; (kanaOf.get(r.idseq) || kanaOf.set(r.idseq, []).get(r.idseq)).push(k); kanaById.set(r.id, k); }
for (const r of all("SELECT kid, text FROM KNI")) { const k = kanaById.get(r.kid); if (k && KANA_NG.has(r.text)) k.ng = true; }
for (const r of all("SELECT ID id, idseq, text FROM Kanji ORDER BY ID")) { const k = { text: r.text, ng: false }; (kanjiOf.get(r.idseq) || kanjiOf.set(r.idseq, []).get(r.idseq)).push(k); kanjiById.set(r.id, k); }
for (const r of all("SELECT kid, text FROM KJI")) { const k = kanjiById.get(r.kid); if (k && /iK|ik|oK|rK|sK/.test(r.text)) k.ng = true; }     // 異形・古い字などは使わない
const prio = new Map();
const addPrio = (idseq, tag) => { (prio.get(idseq) || prio.set(idseq, new Set()).get(idseq)).add(tag); };
for (const r of all("SELECT k.idseq idseq, p.text text FROM KNP p JOIN Kana k ON k.ID = p.kid")) addPrio(r.idseq, r.text);
for (const r of all("SELECT k.idseq idseq, p.text text FROM KJP p JOIN Kanji k ON k.ID = p.kid")) addPrio(r.idseq, r.text);
const tier = (tags) => {                                   // 0=日常語 / 1=よく使う / 2=ふつう / 3=印なし
  if (!tags) return 3;
  let nf = 99; for (const t of tags) { const m = /^nf(\d+)$/.exec(t); if (m) nf = Math.min(nf, +m[1]); }
  if (tags.has("ichi1") || nf <= 10) return 0;
  if (tags.has("news1") || tags.has("gai1") || tags.has("spec1") || nf <= 24) return 1;
  return tags.size ? 2 : 3;
};

/* ---------- 単語ごとの意味を集める ---------- */
const cand = new Map();     // 単語 -> [{pos, ja, score}]
for (const [idseq, list] of senses) {
  const tags = prio.get(idseq), t = tier(tags);
  const kanas = (kanaOf.get(idseq) || []).filter((k) => !k.ng);
  const kanjis = (kanjiOf.get(idseq) || []).filter((k) => !k.ng);
  if (!kanas.length) continue;
  let carry = null;
  list.slice(0, 4).forEach((s, si) => {
    const poss = s.pos.length ? s.pos : carry || [];
    if (s.pos.length) carry = s.pos;
    if (s.misc.some((m) => MISC_NG.has(m))) return;
    const pos = posJa(poss);
    s.glosses.slice(0, 4).forEach((raw, gi) => {
      const g = headword(raw);
      if (!g || BAD_WORDS.has(g) || FUNCTION_WORDS.has(g) || !rankOf.has(g) || rankOf.get(g) > RANK_MAX) return;
      const kana = (s.stagr.length ? kanas.filter((k) => s.stagr.includes(k.text)) : kanas)[0] || kanas[0];
      const kanji = (s.stagk.length ? kanjis.filter((k) => s.stagk.includes(k.text)) : kanjis)[0];
      const ja = kanji && kanji.text !== kana.text ? `${kanji.text}（${kana.text}）` : kana.text;
      const katakana = /^[ァ-ヶー・]+$/.test(ja.replace(/（.*$/, ""));
      if (katakana && t > 1) return;                                                         // カタカナだけの意味は、一般的な外来語のときだけ
      if (!pos || !["名詞", "動詞", "形容詞", "副詞"].includes(pos)) return;                          // 内容語だけ(代名詞・前置詞などは、AI が意味をつける)
      if (t === 3 || (t === 2 && !(si === 0 && gi === 0))) return;                           // 日常語の印がある語義だけ(めずらしい語義・印なしは、意味がずれやすい)
      const score = si * 4 + gi + t * 2.5 + ja.length * 0.25 + (katakana ? 3 : 0);       // 小さいほど代表的な意味(最初の語義・日常語・短い語・日本語の語を優先)
      (cand.get(g) || cand.set(g, []).get(g)).push({ pos, ja, score });
    });
  });
}
const words = new Map();    // 単語 -> {rank, meanings:[[pos, ja]]}
for (const [g, list] of cand) {
  list.sort((a, b) => a.score - b.score);
  const seen = new Set(), ms = [];
  for (const c of list) { if (seen.has(c.ja) || c.ja.length > 18) continue; seen.add(c.ja); ms.push([c.pos, c.ja]); if (ms.length >= 2) break; }
  if (ms.length) words.set(g, { rank: rankOf.get(g), meanings: ms });
}

/* ---------- 1文字違いのつながり(グラフ) ---------- */
const byLen = { 3: [], 4: [], 5: [] };
for (const w of words.keys()) byLen[w.length].push(w);
const neighborsOf = new Map();
for (const n of [3, 4, 5]) {
  const buckets = new Map();
  for (const w of byLen[n]) for (let i = 0; i < n; i++) { const k = w.slice(0, i) + "_" + w.slice(i + 1); (buckets.get(k) || buckets.set(k, []).get(k)).push(w); }
  for (const w of byLen[n]) {
    const set = new Set();
    for (let i = 0; i < n; i++) for (const x of buckets.get(w.slice(0, i) + "_" + w.slice(i + 1))) if (x !== w) set.add(x);
    neighborsOf.set(w, [...set]);
  }
}
const stuck = [...words.keys()].filter((w) => !neighborsOf.get(w).length);
for (const w of stuck) words.delete(w);                     // どこにもつながらない単語は、パズルに使えない(AI判定では認められる)

/* ---------- パズルを作る(幅優先探索で、最短の手数を求める) ---------- */
function bfs(from) {
  const dist = new Map([[from, 0]]), q = [from];
  for (let i = 0; i < q.length; i++) for (const x of neighborsOf.get(q[i]) || []) if (words.has(x) && !dist.has(x)) { dist.set(x, dist.get(q[i]) + 1); q.push(x); }
  return dist;
}
let seed = 20261126;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const SPEC = [
  { level: 1, len: 3, dmin: 2, dmax: 3, rank: 4000, count: 110 },
  { level: 2, len: 4, dmin: 3, dmax: 5, rank: 6000, count: 150 },
  { level: 3, len: 5, dmin: 4, dmax: 7, rank: 9000, count: 150 },
  { level: 3, len: 4, dmin: 6, dmax: 9, rank: 12000, count: 40 }
];
const puzzles = [], used = new Set();
for (const sp of SPEC) {
  const pool = byLen[sp.len].filter((w) => words.has(w) && words.get(w).rank <= sp.rank && neighborsOf.get(w).length >= 2);
  let made = 0, guard = 0;
  while (made < sp.count && guard++ < 6000 && pool.length) {
    const a = pool[Math.floor(rnd() * pool.length)];
    const dist = bfs(a);
    const goals = pool.filter((b) => { const d = dist.get(b); return d >= sp.dmin && d <= sp.dmax && !used.has(a + b) && !used.has(b + a); });
    if (!goals.length) continue;
    const b = goals[Math.floor(rnd() * goals.length)];
    used.add(a + b);
    puzzles.push([a, b, dist.get(b), sp.level]); made++;
  }
}

/* ---------- 出力 ---------- */
const wordList = [...words].sort((a, b) => a[1].rank - b[1].rank).map(([w, v]) => [w, v.rank, v.meanings.map((m) => `${m[0]}:${m[1]}`).join("|")]);
const data = { version: 1, source: "JMdict (c) EDRDG, CC BY-SA 4.0 https://www.edrdg.org/edrdg/licence.html / SUBTLEX-US", words: wordList, puzzles };
const body = "/* 自動生成(tools/build-ladder.mjs)。直接編集しない */\nwindow.LADDER_DATA = " + JSON.stringify(data) + ";\n";
writeFileSync(outPath, body);
const cnt = (n) => wordList.filter((w) => w[0].length === n).length;
console.log(`単語 ${wordList.length} (3文字 ${cnt(3)} / 4文字 ${cnt(4)} / 5文字 ${cnt(5)}) ・ パズル ${puzzles.length} ・ 出力 ${outPath} (${(body.length / 1024).toFixed(0)} KB)`);
for (const lv of [1, 2, 3]) console.log(`  難しさ${lv}: ${puzzles.filter((p) => p[3] === lv).length}問 (手数 ${[...new Set(puzzles.filter((p) => p[3] === lv).map((p) => p[2]))].sort().join(",")})`);
if (args.includes("--stats")) {
  for (const w of ["rock", "joke", "lock", "sock", "jock", "cat", "dog", "love", "line"]) console.log(w, words.has(w) ? JSON.stringify(words.get(w)) : "なし");
}
