/**
 * 化学クイズの文字まわり（画面・通信に依存しない純粋な関数。ブラウザ・Worker・テストで共通）
 *
 *   ChemText.normalize("ナイル 川")            → "ないるかわ"   かな・カタカナ・空白・記号をそろえる
 *   ChemText.matches("ナイルがわ", ["ないるがわ","ないる"])  → true   読みの一覧のどれかと同じか(辞書判定)
 *   const at = ChemText.schedule("アフリカを、流れ。")   // 早押しで、各文字が現れる時刻(ms)の表
 *   ChemText.visible(at, 1500)                 → その時刻までに表示されている文字数
 *
 * 早押しの問題文は、1文字ずつ流れ、「、」「。」などの区切りで少し間があく。
 * 表示のタイミングは、端末と部屋(サーバー)が同じ表から計算するので、全員の画面で同じ位置で止まる。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./fmt.js") : root.ChemFmt);
  else root.ChemText = factory(typeof require === "function" ? require("./fmt.js") : root.ChemFmt);
})(typeof self !== "undefined" ? self : this, function (Fmt) {
  "use strict";

  const CHAR_MS = 115;          // 1文字ごとの間隔
  const LEAD_MS = 700;          // 出題してから最初の文字が出るまで
  const PAUSE = { "、": 420, "，": 420, ",": 420, "。": 650, "！": 500, "？": 0, "?": 0, "（": 0, "）": 160 };
  const GRACE_MS = 6000;        // 最後まで流れたあと、まだ押せる時間

  /** 答えの照合用に、かな・カタカナ・全角半角・空白・記号をそろえる */
  function normalize(s) {
    return String(s == null ? "" : s)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s・･·、，,。．.「」『』()（）\-－―]/g, "")
      .replace(/ゔ/g, "ぶ");
  }

  /**
   * 化学式の照合。大文字・小文字を区別する(CO と Co はちがう)。下つき文字・全角・空白・中点は、そろえて比べる。
   * 例: "H₂SO₄" も "h2so4" ではなく "H2SO4" なら一致。formulas = ["H2SO4"] のように、正解の式の一覧
   */
  function matchesFormula(input, formulas) {
    const n = Fmt.normalize(input);
    return !!n && (formulas || []).some((f) => Fmt.normalize(f) === n);
  }

  /** 読みの一覧のどれかと、そろえた形で同じなら true */
  function matches(input, yomiList) {
    const n = normalize(input);
    return !!n && yomiList.some((y) => normalize(y) === n);
  }

  /** 問題文を、1つずつ流れる単位に分ける。[[H2SO4]] のような化学式は、1つの単位(途中で切れない) */
  function units(text) {
    const out = [];
    for (const part of String(text).split(/(\[\[[^\]]*\]\])/)) {
      if (/^\[\[[^\]]*\]\]$/.test(part)) out.push(part);
      else out.push(...Array.from(part));
    }
    return out;
  }

  /** 各単位が現れる時刻(出題からのms)の表 */
  function schedule(text) {
    const at = [];
    let t = LEAD_MS;
    for (const ch of units(text)) {
      at.push(t);
      t += CHAR_MS + (PAUSE[ch] || 0);
    }
    return at;
  }

  /** elapsed(ms) までに表示されている文字数 */
  function visible(at, elapsed) {
    let lo = 0, hi = at.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] <= elapsed) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** 全部の文字が出るまでの時間(ms) */
  const totalMs = (at) => (at.length ? at[at.length - 1] + CHAR_MS : 0);

  return { CHAR_MS, LEAD_MS, GRACE_MS, normalize, matches, matchesFormula, units, schedule, visible, totalMs };
});
