/**
 * 英単語トランスミッションの辞書(data/ladder.js の words)。画面にも、サーバー(部屋)にも、テストにも共通で使う。
 *
 *   const D = LadderDict.create(LADDER_DATA);
 *   D.lookup("rock")   → { pos:"名詞", ja:"岩（いわ）", more:["揺る（ゆる）"], rank:588, form:"" }   辞書にあれば
 *   D.lookup("rocks")  → { …, form:"複数形・三単現" }                                                辞書の語の規則変化(-s -es -ed -d)も、同じ文字数なら認める
 *   D.lookup("jock")   → null                                                                         辞書にない語 → AI に確認する
 *   D.path("rock","joke", avoid)  → ["rock", …, "joke"]   辞書の単語だけで、いちばん短いつなぎかた(なければ null)
 *   D.neighbors("rock")           → 1文字だけちがう辞書の単語
 *
 * 意味は JMdict(日本語→英語の辞書)を逆に引いたものなので、日本語の訳語は「代表的な意味」の目安です。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LadderDict = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SUFFIX = [["es", 2, "複数形・三単現"], ["s", 1, "複数形・三単現"], ["ed", 2, "過去形・過去分詞"], ["d", 1, "過去形・過去分詞"]];

  function create(data) {
    const words = new Map();
    for (const [w, rank, ms] of (data && data.words) || []) {
      const list = ms.split("|").map((m) => { const i = m.indexOf(":"); return { pos: m.slice(0, i), ja: m.slice(i + 1) }; });
      words.set(w, { rank, list });
    }
    const buckets = new Map();
    for (const w of words.keys()) for (let i = 0; i < w.length; i++) { const k = w.length + w.slice(0, i) + "_" + w.slice(i + 1); (buckets.get(k) || buckets.set(k, []).get(k)).push(w); }

    const entry = (w, form) => { const e = words.get(w); return { pos: e.list[0].pos, ja: e.list[0].ja, more: e.list.slice(1).map((m) => m.ja), rank: e.rank, form: form || "" }; };

    /** 辞書にある単語か。規則変化は、もとの語が辞書にあれば認める(3文字以上のもとの語) */
    function lookup(word) {
      const w = String(word || "").toLowerCase();
      if (!/^[a-z]{3,5}$/.test(w)) return null;
      if (words.has(w)) return entry(w);
      for (const [suf, cut, label] of SUFFIX) {
        if (w.length > suf.length + 2 && w.endsWith(suf)) {
          const stem = w.slice(0, -cut);
          if (stem.length >= 3 && words.has(stem) && !(suf === "s" && w.endsWith("ss"))) { const e = entry(stem, label); e.ja = e.ja; e.stem = stem; return e; }
        }
      }
      return null;
    }
    const has = (w) => words.has(w);

    function neighbors(word) {
      const out = new Set();
      for (let i = 0; i < word.length; i++) for (const x of buckets.get(word.length + word.slice(0, i) + "_" + word.slice(i + 1)) || []) if (x !== word) out.add(x);
      return [...out];
    }

    /** 辞書の単語だけで、from から to までの、いちばん短いつなぎかた。avoid(使用ずみの語)は通らない */
    function path(from, to, avoid) {
      if (from === to) return [from];
      const skip = avoid instanceof Set ? avoid : new Set(avoid || []);
      const prev = new Map([[from, null]]), queue = [from];
      for (let i = 0; i < queue.length; i++) {
        const cur = queue[i];
        for (const x of neighbors(cur)) {
          if (prev.has(x) || (skip.has(x) && x !== to)) continue;
          prev.set(x, cur);
          if (x === to) { const out = [x]; let c = cur; while (c) { out.push(c); c = prev.get(c); } return out.reverse(); }
          queue.push(x);
        }
      }
      return null;
    }

    return { lookup, has, neighbors, path, size: words.size };
  }

  return { create };
});
