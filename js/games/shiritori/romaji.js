/**
 * ローマ字→かな変換（入力中の状態つき）と、「よみ」欄用の入力処理
 *
 *   state = { text: "か", pending: "k" }   text=確定したかな / pending=入力途中のローマ字
 *   feed(state, "a")          → { text: "かあ"... }   （k + a で「か」）
 *   applyReading(state, action, { maxLength })        … キーボードの action を適用
 *   flush(state)              … 決定前に、残った「n」を「ん」にする
 *
 * 規則: nn→ん(打った瞬間)、n+子音→ん、同じ子音の連続→っ(kitte)、tcha→っちゃ、
 *       sha/shi/tsu/chi/fu/ji 等のヘボン式と、si/ti/tu/hu/zi 等の訓令式の両方、
 *       xa/la→ぁ、xtu→っ、"-"→ー。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./input-logic.js"));
  else root.ShiritoriRomaji = factory(root.ShiritoriInput);
})(typeof self !== "undefined" ? self : this, function (Input) {
  "use strict";

  const TABLE = {};
  const V = "aiueo";
  const add = (romaji, kana) => { TABLE[romaji] = kana; };

  // 基本の行（あ か が さ ざ た だ な は ば ぱ ま ら）
  const ROWS = {
    "": "あいうえお", k: "かきくけこ", g: "がぎぐげご", s: "さしすせそ", z: "ざじずぜぞ",
    t: "たちつてと", d: "だぢづでど", n: "なにぬねの", h: "はひふへほ",
    b: "ばびぶべぼ", p: "ぱぴぷぺぽ", m: "まみむめも", r: "らりるれろ"
  };
  for (const c of Object.keys(ROWS)) [...ROWS[c]].forEach((k, i) => add(c + V[i], k));
  add("ya", "や"); add("yu", "ゆ"); add("yo", "よ");
  add("wa", "わ"); add("wo", "を"); add("wi", "うぃ"); add("we", "うぇ");

  // 拗音（きゃ しゃ ちゃ …）: 子音+ya/yu/yo
  const YOUON = { k: "き", g: "ぎ", s: "し", z: "じ", t: "ち", d: "ぢ", n: "に", h: "ひ", b: "び", p: "ぴ", m: "み", r: "り" };
  for (const c of Object.keys(YOUON)) {
    add(c + "ya", YOUON[c] + "ゃ"); add(c + "yu", YOUON[c] + "ゅ"); add(c + "yo", YOUON[c] + "ょ");
  }
  // ヘボン式・その他
  const extra = {
    shi: "し", sha: "しゃ", shu: "しゅ", she: "しぇ", sho: "しょ",
    chi: "ち", cha: "ちゃ", chu: "ちゅ", che: "ちぇ", cho: "ちょ",
    cya: "ちゃ", cyu: "ちゅ", cyo: "ちょ",
    tsu: "つ", tsa: "つぁ", tsi: "つぃ", tse: "つぇ", tso: "つぉ",
    ji: "じ", ja: "じゃ", ju: "じゅ", je: "じぇ", jo: "じょ",
    jya: "じゃ", jyu: "じゅ", jyo: "じょ",
    fu: "ふ", fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", fyu: "ふゅ",
    thi: "てぃ", thu: "てゅ", dhi: "でぃ", dhu: "でゅ",
    va: "ゔぁ", vi: "ゔぃ", vu: "ゔ", ve: "ゔぇ", vo: "ゔぉ",
    "-": "ー"
  };
  Object.keys(extra).forEach((k) => add(k, extra[k]));
  // 小さい字: xa/la … xya … xtu(っ)
  const SMALLS = { a: "ぁ", i: "ぃ", u: "ぅ", e: "ぇ", o: "ぉ", ya: "ゃ", yu: "ゅ", yo: "ょ", tu: "っ", tsu: "っ", wa: "ゎ" };
  for (const p of ["x", "l"]) for (const k of Object.keys(SMALLS)) add(p + k, SMALLS[k]);

  // 途中の入力として有効なもの（例: "k", "sh", "ts"）
  const PREFIXES = new Set();
  Object.keys(TABLE).forEach((k) => { for (let i = 1; i < k.length; i++) PREFIXES.add(k.slice(0, i)); });

  /** ローマ字1文字(a-z と -)を加える */
  function feed(state, ch, maxLength) {
    const max = maxLength || Infinity;
    let text = state.text;
    let pending = state.pending + ch;
    const put = (kana) => { if (text.length + kana.length <= max) text += kana; };

    // 「nn」で「ん」になった直後に母音・y が来たら、2つ目の n はその音の頭(な行)として使う。
    // 例: onna → お・ん・な、konnichiha → こ・ん・に・ち・は（パソコンのIMEと同じ打ち方）
    if (state.pending === "" && text.endsWith("ん") && (V.includes(ch) || ch === "y")) pending = "n" + ch;

    for (let guard = 0; pending && guard < 20; guard++) {
      if (TABLE[pending]) { put(TABLE[pending]); pending = ""; break; }
      if (PREFIXES.has(pending)) break;
      if (pending === "nn") { put("ん"); pending = ""; break; }     // nn は打った瞬間に「ん」
      if (pending[0] === "n") { put("ん"); pending = pending.slice(1); continue; }       // n+子音
      if (pending[0] === "t" && pending[1] === "c") { put("っ"); pending = pending.slice(1); continue; } // tcha
      if (pending.length >= 2 && pending[0] === pending[1] && /[a-z]/.test(pending[0]) && !V.includes(pending[0])) {
        put("っ"); pending = pending.slice(1); continue; // kk→っk
      }
      pending = pending.slice(1);                        // 打ち間違い: 先頭を捨てて続ける
    }
    return { text, pending };
  }

  /** 入力途中の n を「ん」にして確定する（語の最後の「n」） */
  function flush(state) {
    if (state.pending === "n" || state.pending === "nn") return { text: state.text + "ん", pending: "" };
    return { text: state.text, pending: "" };
  }

  /** 「よみ」欄へのキー操作。romaji は feed、削除は入力途中を先に消す */
  function applyReading(state, action, opts) {
    const max = (opts && opts.maxLength) || Infinity;
    if (action.type === "romaji") return feed(state, action.value, max);
    if (action.type === "backspace") {
      return state.pending
        ? { text: state.text, pending: state.pending.slice(0, -1) }
        : { text: state.text.slice(0, -1), pending: "" };
    }
    const f = flush(state);                              // かな直接入力・゛゜小は、入力途中を確定してから
    return { text: Input.applyAction(f.text, action, opts), pending: "" };
  }

  return { feed, flush, applyReading };
});
