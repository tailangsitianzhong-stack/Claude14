/**
 * ミニネプリーグ(英語)の「単語リスト」まわり（画面・通信に依存しない純粋な関数）
 *
 *   const W = NepWords.create(window.NEP_DATA);
 *   W.has("apple")          // 単語リストにある?
 *   W.rank("apple")         // 知名度の順位(1が最も有名。なければ 0)
 *   W.baseOf("dogs")        // "dog"  … 変化形なら原形、原形(または不明)なら null
 *   W.starting("a")         // "a" で始まる単語(知名度順の配列)
 *
 * ルール: 答えは「原形」。複数形・過去形・-ing形などは受け付けず、
 *         「原形で答えてね」とお知らせする(baseOf で見分ける)。
 * 生成ツール(tools/build-nep.mjs)・画面・Worker が同じ判定を使う。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NepWords = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SHAPE = /^[a-z]+$/;
  const MIN_LEN = 3; // 答えに使える最短の長さ

  /** 文字だけの1語に整える(前後の空白を除き小文字に)。使えない形なら "" */
  function normalize(s) {
    const t = String(s == null ? "" : s).trim().toLowerCase();
    return SHAPE.test(t) ? t : "";
  }

  /**
   * 変化形(複数形・三単現・過去形・-ing形)なら原形を返す。そうでなければ null。
   * has(語) は「その語が単語として存在するか」を答える関数。
   */
  function baseOf(w, has) {
    const n = w.length;
    if (n < 4) return null;
    // 子音+y → ies / ied
    if (n >= 5 && (w.endsWith("ies") || w.endsWith("ied")) && has(w.slice(0, -3) + "y")) return w.slice(0, -3) + "y";
    // -s / -es(複数形・三単現)
    if (/(?:s|x|z|ch|sh|o)es$/.test(w) && has(w.slice(0, -2))) return w.slice(0, -2);
    if (w.endsWith("s") && !/(?:ss|us|is)$/.test(w) && has(w.slice(0, -1))) return w.slice(0, -1);
    // -ing
    if (n >= 6 && w.endsWith("ing")) {
      const stem = w.slice(0, -3);
      if (has(stem)) return stem;
      if (has(stem + "e")) return stem + "e";
      if (/(.)\1$/.test(stem) && has(stem.slice(0, -1))) return stem.slice(0, -1); // running → run
    }
    // -ed
    if (n >= 5 && w.endsWith("ed")) {
      const stem = w.slice(0, -2);
      if (has(stem)) return stem;
      if (has(stem + "e")) return stem + "e"; // liked → like
      if (/(.)\1$/.test(stem) && has(stem.slice(0, -1))) return stem.slice(0, -1); // stopped → stop
    }
    return null;
  }

  /** NEP_DATA から検索用の索引をつくる */
  function create(data) {
    const list = data.vocab ? data.vocab.split(" ") : [];
    const rankOf = new Map();
    list.forEach((w, i) => rankOf.set(w, i + 1));
    const irregular = data.irregular || {};
    const byStart = {};
    const byEnd = {};
    const byLen = {};
    for (const w of list) {
      (byStart[w[0]] || (byStart[w[0]] = [])).push(w);
      (byEnd[w[w.length - 1]] || (byEnd[w[w.length - 1]] = [])).push(w);
      (byLen[w.length] || (byLen[w.length] = [])).push(w);
    }
    let anagrams = null;
    const has = (w) => rankOf.has(w);

    return {
      list,
      size: list.length,
      MIN_LEN,
      normalize,
      has,
      /** 単語リストの語、または不規則変化の形(gone など)として知っている語か */
      known: (w) => rankOf.has(w) || Object.prototype.hasOwnProperty.call(irregular, w),
      rank: (w) => rankOf.get(w) || 0,
      /** 変化形なら原形(irregular表 → 規則変化の順で判定)。原形・不明なら null */
      baseOf(w) {
        if (Object.prototype.hasOwnProperty.call(irregular, w)) return irregular[w];
        return baseOf(w, has);
      },
      starting: (c) => byStart[c] || [],
      ending: (c) => byEnd[c] || [],
      ofLength: (n) => byLen[n] || [],
      /** 並べ替え(アナグラム)の答えの候補: 同じ文字でできた単語 */
      anagramsOf(word) {
        if (!anagrams) {
          anagrams = new Map();
          for (const w of list) {
            const k = w.split("").sort().join("");
            const a = anagrams.get(k);
            if (a) a.push(w);
            else anagrams.set(k, [w]);
          }
        }
        return anagrams.get(word.split("").sort().join("")) || [];
      }
    };
  }

  return { SHAPE, MIN_LEN, normalize, baseOf, create };
});
