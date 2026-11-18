#!/usr/bin/env node
/**
 * ミニネプリーグ(英語)用データの生成ツール（開発時にだけ実行。ゲーム本体は生成物 data/nep.js を読む）
 *
 *   node tools/build-nep.mjs --freq <subtlex index.json> [--profanity <en.txt>] [--jmdict <jamdict.db>] \
 *        [--size 30000] [--out data/nep.js] [--stats]
 *
 * 入力: 英単語の頻度表（npm の subtlex-word-frequencies の index.json）
 *       不適切語リスト（npm の @coffeeandfun/google-profanity-words の data/en.txt）
 *       手書きのお題 tools/nep-source/*.txt （カテゴリ・熟語・反対語・過去形など）
 *       data/words.js （しりとり用辞書。flag 4=子ども向けの語 を「日本語→英語」のお題に使う）
 * 出力: window.NEP_DATA = { vocab(知名度順の原形の単語), categories, collocations, phrases,
 *                           antonyms, pasts, irregular, translate[[表記(ルビ記法), 読み, 答え]] }
 *
 * 単語リストは「原形だけ」にする: 変化形(dogs・played・running)・短縮形のかけら(didn)・
 * 母音のない略語・不適切語・固有名詞(大文字で始まる語は頻度表の小文字側にほぼ出ない)を除く。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const W = require("../js/games/nep/words.js");

const args = process.argv.slice(2);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const freqPath = valueOf("--freq");
const profanityPath = valueOf("--profanity");
const SIZE = Number(valueOf("--size") || 30000);
const outPath = valueOf("--out") || "data/nep.js";
const showStats = args.includes("--stats");
const src = (name) => new URL(`./nep-source/${name}`, import.meta.url).pathname;
if (!freqPath) {
  console.error("usage: node tools/build-nep.mjs --freq <index.json> [--profanity <en.txt>] [--jmdict <jamdict.db>] [--size N] [--out file] [--stats]");
  process.exit(1);
}

const warn = [];
const lines = (name) => readFileSync(src(name), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const words = (s) => s.split(/\s+/).filter(Boolean);

// ---- 不適切語・手書きの除外/保持リスト ----
const bad = new Set();
if (profanityPath) {
  for (const line of readFileSync(profanityPath, "utf8").split(/\r?\n/)) {
    const w = line.trim().toLowerCase();
    if (/^[a-z]+$/.test(w)) bad.add(w);
  }
}
// 短縮形のかけら・あいづち・俗語など、答えにしたくない語
const STOP = new Set(words(`
  didn doesn couldn wouldn shouldn isn aren wasn weren hasn haven hadn mustn needn ain
  hmm huh yeah yep yup nope uhh ahh ohh ooh aah umm hmmm gonna wanna gotta kinda sorta lemme gimme dunno
  whoa woah wow hey hello hiya okay ok ugh yay yeah whatcha cuz coz thru tho dont cant wont
  www com http https html org info don mas cham quat goto isnt arent wasnt werent hasnt havent hadnt doesnt didnt couldnt wouldnt shouldnt
`));
// 合成語(horseshit など)も除くための部分一致リスト
const BAD_PARTS = ["shit", "fuck", "cunt", "nigg", "bitch", "whore", "slut", "bastard"];
const keep = new Set(lines("keep-words.txt").flatMap(words));
const irregular = {};
for (const l of lines("irregular-forms.txt")) {
  for (const pair of words(l)) {
    const [form, base] = pair.split(":");
    if (!/^[a-z]+$/.test(form) || !/^[a-z]+$/.test(base)) { warn.push(`irregular-forms: 形式が不正 ${pair}`); continue; }
    irregular[form] = base;
  }
}

// ---- 頻度表 → 単語リスト ----
const freq = JSON.parse(readFileSync(freqPath, "utf8"));
const everything = []; // 小文字だけの語(2文字以上)。原形判定の「語が存在するか」に使う
const seen = new Set();
for (const { word } of freq) {
  if (!/^[a-z]{2,}$/.test(word) || seen.has(word)) continue;
  seen.add(word);
  everything.push(word);
}
const exists = new Set(everything.slice(0, 70000));
// 判定用の語の存在表: 不適切語・かけらは「語ではない」扱いにして、変化形判定の根拠にしない
const has = (w) => exists.has(w) && !STOP.has(w);

const vocab = [];
const dropped = { inflected: 0, junk: 0, bad: 0, irregular: 0 };
for (const w of everything) {
  if (vocab.length >= SIZE) break;
  if (w.length < W.MIN_LEN) continue;
  if (bad.has(w) || BAD_PARTS.some((p) => w.includes(p))) { dropped.bad++; continue; }
  if (STOP.has(w) || !/[aeiouy]/.test(w) || /(.)\1\1/.test(w)) { dropped.junk++; continue; }
  if (Object.prototype.hasOwnProperty.call(irregular, w)) { dropped.irregular++; continue; }
  if (!keep.has(w) && W.baseOf(w, has)) { dropped.inflected++; continue; }
  vocab.push(w);
}
const vocabSet = new Set(vocab);

// ---- 手書きのお題 ----
const okWord = (w) => /^[a-z]{2,}$/.test(w);
function checkWords(where, ws) {
  const out = [];
  for (const w of ws) {
    const t = w.toLowerCase();
    if (!okWord(t)) { warn.push(`${where}: 使えない形の語 "${w}"`); continue; }
    if (bad.has(t)) { warn.push(`${where}: 不適切語 "${w}"`); continue; }
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

const categories = lines("categories.txt").map((l) => {
  const [id, name, emoji, rest] = l.split("|");
  const ws = checkWords(`categories/${id}`, words(rest || ""));
  if (ws.length < 20) warn.push(`categories/${id}: 語が少ない(${ws.length})`);
  return { id, name, emoji, words: ws };
});

const collocations = lines("collocations.txt").map((l) => {
  const [level, prompt, rest, ja] = l.split("|");
  const answers = checkWords(`collocations/${prompt}`, words(rest || ""));
  if (!/___/.test(prompt)) warn.push(`collocations: ___ がない "${prompt}"`);
  if (answers.length < 3) warn.push(`collocations/${prompt}: 答えが少ない(${answers.length})`);
  if (!ja) warn.push(`collocations/${prompt}: 日本語の意味がない`);
  return { level: Number(level), prompt, answers, ja: ja || "" };
});

const phrases = lines("phrases.txt").map((l) => {
  const [prompt, rest, ja] = l.split("|");
  if (!/___/.test(prompt)) warn.push(`phrases: ___ がない "${prompt}"`);
  if (!ja) warn.push(`phrases/${prompt}: 日本語の意味がない`);
  return { prompt, answers: checkWords(`phrases/${prompt}`, words(rest || "")), ja: ja || "" };
});

const pairMap = (name) => {
  const m = {};
  for (const l of lines(name)) {
    const [k, rest] = l.split("|");
    const key = k.trim().toLowerCase();
    if (!okWord(key)) { warn.push(`${name}: 使えない形の語 "${k}"`); continue; }
    m[key] = checkWords(`${name}/${key}`, words(rest || ""));
  }
  return m;
};
const antonyms = pairMap("antonyms.txt");
const pasts = pairMap("pasts.txt");

// ---- 日本語→英語のお題: しりとり辞書の「子ども向けの語(flag 4)」 ----
// 日本語は同音異義語が多い(はし=橋/箸)ので、JMdict から漢字の表記を引いて「橋{はし}」の形で出題する。
// 漢字が見つからない語(カタカナ語・辞書にない語)は、かな(カタカナ)のまま。
const dictCtx = { window: {} };
vm.runInNewContext(readFileSync(new URL("../data/words.js", import.meta.url), "utf8"), dictCtx);
const pairs = [];                               // [reading, english]
const seenPair = new Set();
for (const [reading, english, , flags] of dictCtx.window.SHIRITORI_WORDS.pairs) {
  if (!(flags & 4) || !okWord(english) || bad.has(english)) continue;
  if (!(vocabSet.has(english) || categories.some((c) => c.words.includes(english)))) continue;
  if (seenPair.has(reading + "|" + english)) continue;
  seenPair.add(reading + "|" + english);
  pairs.push([reading, english]);
}

const KANJI_RUN = /[一-龠々〆ヶ]+/;
const toHira = (t) => t.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const cleanGloss = (g) => { let prev; do { prev = g; g = g.replace(/\([^()]*\)/g, ""); } while (g !== prev); return g.trim().toLowerCase(); };

/** 「食べ物」「たべもの」→ "食{た}べ物{もの}" (送りがなを外に出す)。合わなければ null */
function rubify(text, reading) {
  const toks = text.match(/[一-龠々〆ヶ]+|[^一-龠々〆ヶ]+/g) || [];
  if (!toks.some((t) => KANJI_RUN.test(t))) return null;
  const pat = toks.map((t) => (KANJI_RUN.test(t) ? "(.+?)" : toHira(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  const m = new RegExp("^" + pat + "$").exec(reading);
  if (!m) return null;
  let i = 1;
  return toks.map((t) => (KANJI_RUN.test(t) ? `${t}{${m[i++]}}` : t)).join("");
}

// 手で決めた表記(辞書で見つからない語など)
const overrides = new Map(lines("kanji-overrides.txt").map((l) => l.split("|")).filter((a) => a.length === 2).map(([r, t]) => [r.trim(), t.trim()]));
const fromText = (text, reading) => {
  const r = rubify(text, reading);
  return r ? { key: "k:" + r, text: r, kanji: true } : { key: "a:" + text, text, kanji: false };
};

const jmPath = valueOf("--jmdict");
let display = (reading) => ({ key: "r:" + reading, text: reading, kanji: false });   // 辞書がなければ、かなのまま
let jmStats = null;
if (jmPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(jmPath, { readOnly: true });
  const byKana = new Map();                     // ひらがなの読み → [{idseq, kana}]
  for (const r of db.prepare("SELECT idseq, text FROM Kana").all()) {
    const h = toHira(r.text);
    if (!byKana.has(h)) byKana.set(h, []);
    byKana.get(h).push({ idseq: r.idseq, kana: r.text });
  }
  const glossQ = db.prepare("SELECT g.text FROM SenseGloss g JOIN Sense s ON s.ID = g.sid WHERE s.idseq = ? AND g.lang = 'eng'");
  const kanjiQ = db.prepare("SELECT ID, text FROM Kanji WHERE idseq = ? ORDER BY ID");
  const tagQ = db.prepare("SELECT 1 FROM KJI WHERE kid = ? LIMIT 1");
  const prioQ = db.prepare("SELECT 1 FROM KJP WHERE kid = ? LIMIT 1");
  // 「ふだんはかなで書く(uk)」印がついた意味(sense)の訳語。その訳語で出すときだけ、かなに戻す
  const ukGlossQ = db.prepare("SELECT g.text FROM SenseGloss g JOIN misc m ON m.sid = g.sid WHERE m.text = 'word usually written using kana alone' AND g.lang = 'eng' AND g.sid IN (SELECT ID FROM Sense WHERE idseq = ?)");
  jmStats = { kanji: 0, kana: 0, none: 0, manual: 0, kanaOnly: 0, failed: [] };
  const cache = new Map();
  display = (reading, english) => {
    const ck = reading + "|" + english;
    if (cache.has(ck)) return cache.get(ck);
    let best = null;
    for (const e of byKana.get(reading) || []) {
      if (!glossQ.all(e.idseq).some((g) => cleanGloss(g.text) === english)) continue;
      const ks = kanjiQ.all(e.idseq).filter((k) => !tagQ.get(k.ID) && /^[一-龠々〆ヶぁ-んァ-ヶー]+$/.test(k.text) && KANJI_RUN.test(k.text));
      const k = ks.slice().sort((x, y) => (prioQ.get(y.ID) ? 1 : 0) - (prioQ.get(x.ID) ? 1 : 0) || x.text.length - y.text.length)[0];
      const uk = ukGlossQ.all(e.idseq).some((g) => cleanGloss(g.text) === english);   // この訳語は「ふだんはかなで書く」
      const cand = k ? { rank: 0, len: k.text.length, text: k.text, uk, kana: e.kana } : { rank: 2, kana: e.kana };
      if (!best || cand.rank < best.rank || (cand.rank === best.rank && cand.len < best.len)) best = cand;
    }
    let out;
    if (overrides.has(reading)) {
      out = fromText(overrides.get(reading), reading); jmStats.manual++;
    } else if (best && best.text) {
      const r = rubify(best.text, reading);
      if (r) { out = { key: "k:" + r, text: r, kanji: true, uk: best.uk }; jmStats.kanji++; }
      else { jmStats.failed.push(best.text + "/" + reading); }
    } else if (best && best.kana) {
      out = { key: "a:" + best.kana, text: best.kana, kanji: false }; jmStats.kana++;
    }
    if (!out) { out = { key: "r:" + reading, text: reading, kanji: false }; jmStats.none++; }
    cache.set(ck, out);
    return out;
  };
}

// 同じ表記(漢字つき/カタカナ)の語は答えをまとめる。漢字が分からない語は、同じ読みでまとめる(従来どおり)
const groups = new Map();
for (const [reading, english] of pairs) {
  const d = display(reading, english);
  if (!groups.has(d.key)) groups.set(d.key, { text: d.text, reading, answers: [], uk: d.uk, key: d.key });
  groups.get(d.key).answers.push(english);
}
// 「ふだんはかなで書く語」(苺・烏賊など難しい漢字)は、同じ読みの別の語がなければ、かなのまま出す
const perReading = new Map();
for (const g of groups.values()) perReading.set(g.reading, (perReading.get(g.reading) || 0) + 1);
for (const g of [...groups.values()]) {
  if (g.uk && perReading.get(g.reading) === 1) {
    groups.delete(g.key);
    const k = "r:" + g.reading;
    groups.set(k, Object.assign(g, { text: g.reading, key: k }));
    if (jmStats) jmStats.kanaOnly++;
  }
}
const translate = [...groups.values()].map((g) => [g.text, g.reading, g.answers]);

// ---- 整合チェック ----
for (const c of categories) {
  const miss = c.words.filter((w) => !vocabSet.has(w));
  if (miss.length && showStats) console.log(`  [info] ${c.id}: 単語リスト外 ${miss.length}語 (${miss.slice(0, 6).join(",")}…)`);
}
const need = (list, where) => list.filter((e) => e.answers.length === 0).forEach((e) => warn.push(`${where}: 答えなし "${e.prompt}"`));
need(collocations, "collocations");
need(phrases, "phrases");
for (const [k, v] of Object.entries(antonyms)) if (!v.length) warn.push(`antonyms: 答えなし ${k}`);
for (const [k, v] of Object.entries(pasts)) if (!v.length) warn.push(`pasts: 答えなし ${k}`);

const data = {
  version: 1,
  source: "SUBTLEX-US word frequencies (https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus); 不適切語: @coffeeandfun/google-profanity-words",
  vocab: vocab.join(" "),
  categories, collocations, phrases, antonyms, pasts, irregular, translate
};
const body = `/* 自動生成: tools/build-nep.mjs — 直接編集しないこと */\nwindow.NEP_DATA = ${JSON.stringify(data)};\n`;
writeFileSync(outPath, body);

console.log(`vocab ${vocab.length}語 / カテゴリ ${categories.length} / 熟語穴うめ ${collocations.length} / 慣用句 ${phrases.length} / 反対語 ${Object.keys(antonyms).length} / 過去形 ${Object.keys(pasts).length} / 日→英 ${translate.length}`);
console.log(`除外: 変化形 ${dropped.inflected} / 不規則変化 ${dropped.irregular} / かけら・略語 ${dropped.junk} / 不適切語 ${dropped.bad}`);
console.log(`出力 ${outPath} (${(body.length / 1024).toFixed(0)} KB)`);
if (jmStats) {
  console.log(`日→英の表記: 漢字 ${jmStats.kanji} / カタカナ等 ${jmStats.kana} / 見つからず(読みのまま) ${jmStats.none} / 手書き表記 ${jmStats.manual} / かなに戻した(uk) ${jmStats.kanaOnly}` + (jmStats.failed.length ? ` / ふりがなの割り当て失敗 ${jmStats.failed.length}: ${jmStats.failed.slice(0, 8).join(" ")}` : ""));
}
if (warn.length) {
  console.log(`警告 ${warn.length}件:`);
  warn.slice(0, 60).forEach((w) => console.log("  - " + w));
}
if (showStats) {
  const per = {};
  for (const w of vocab) per[w[0]] = (per[w[0]] || 0) + 1;
  console.log("頭文字別:", Object.entries(per).map(([k, v]) => `${k}${v}`).join(" "));
  console.log("先頭60:", vocab.slice(0, 60).join(" "));
  console.log("6000番付近:", vocab.slice(5990, 6010).join(" "));
}
