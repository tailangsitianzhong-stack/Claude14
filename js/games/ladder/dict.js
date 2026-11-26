/**
 * 英単語トランスミッションの辞書(data/ladder.js の words)。画面にも、サーバー(部屋)にも、テストにも共通で使う。
 *
 *   const D = LadderDict.create(LADDER_DATA);
 *   D.lookup("rock")   → { pos:"名詞", ja:"岩（いわ）", more:["揺る（ゆる）"], rank:588, form:"" }   辞書にあれば
 *   D.lookup("rocks")  → { …, form:"複数形・三単現" }                                                辞書の語の規則変化(-s -es -ed -d)も、同じ文字数なら認める
 *   D.lookup("done")   → { pos:"動詞", ja:"し終えた（しおえた）", form:"do の過去分詞" }                    手で書いた意味(機能語・不規則動詞)
 *   D.lookup("jock")   → { pos:"", ja:"", pending:true }          ふつうの英単語の一覧にある語。その場で認める(意味は、あとから AI がつける)
 *   D.lookup("nike")   → null                                     どれにもない語(固有名詞など) → AI に確認する
 *   D.path("rock","joke", avoid)  → ["rock", …, "joke"]   辞書(意味つきの単語)だけで、いちばん短いつなぎかた(なければ null)。{broad:true} で、ふつうの英単語すべてを使う
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
    const words = new Map(), extra = new Map();
    for (const [w, rank, ms] of (data && data.words) || []) {
      const list = ms.split("|").map((m) => { const i = m.indexOf(":"); return { pos: m.slice(0, i), ja: m.slice(i + 1) }; });
      words.set(w, { rank, list, form: "" });
    }
    for (const [w, m, form] of (data && data.extra) || []) { const i = m.indexOf(":"); extra.set(w, { rank: 0, list: [{ pos: m.slice(0, i), ja: m.slice(i + 1) }], form: form || "" }); }
    const valid = new Set(((data && data.valid) || "").split(" ").filter(Boolean));
    const meaningOf = (w) => words.get(w) || extra.get(w) || null;

    const entry = (e, form) => ({ pos: e.list[0].pos, ja: e.list[0].ja, more: e.list.slice(1).map((m) => m.ja), rank: e.rank, form: form || e.form || "" });

    /** 認められる単語か。意味つき辞書 → 手書きの意味 → その規則変化 → ふつうの英単語の一覧(意味はあとから)。どれにもなければ null */
    function lookup(word) {
      const w = String(word || "").toLowerCase();
      if (!/^[a-z]{3,5}$/.test(w)) return null;
      const e = meaningOf(w);
      if (e) return entry(e);
      for (const [suf, cut, label] of SUFFIX) {
        if (w.length > suf.length + 2 && w.endsWith(suf)) {
          const stem = w.slice(0, -cut), se = stem.length >= 3 ? meaningOf(stem) : null;
          if (se && !(suf === "s" && w.endsWith("ss"))) { const r = entry(se, label); r.stem = stem; return r; }
        }
      }
      if (valid.has(w)) return { pos: "", ja: "", more: [], rank: 0, form: "", pending: true };
      return null;
    }
    const has = (w) => words.has(w);

    /* 1文字だけちがう単語のつながり。意味つきの辞書だけ(パズル・ふつうのヒント)と、ふつうの英単語すべて(広いヒント)の2つ */
    const mk = (list) => { const b = new Map(); for (const w of list) for (let i = 0; i < w.length; i++) { const k = w.length + w.slice(0, i) + "_" + w.slice(i + 1); (b.get(k) || b.set(k, []).get(k)).push(w); } return b; };
    const buckets = mk(words.keys());
    let wide = null;
    const wideBuckets = () => wide || (wide = mk([...words.keys(), ...extra.keys(), ...valid]));
    const near = (b, word) => { const out = new Set(); for (let i = 0; i < word.length; i++) for (const x of b.get(word.length + word.slice(0, i) + "_" + word.slice(i + 1)) || []) if (x !== word) out.add(x); return [...out]; };
    const neighbors = (word) => near(buckets, word);

    /** from から to までの、いちばん短いつなぎかた。avoid(使用ずみの語)は通らない。opts.broad=true なら、ふつうの英単語すべてを使う */
    function path(from, to, avoid, opts) {
      if (from === to) return [from];
      const skip = avoid instanceof Set ? avoid : new Set(avoid || []);
      const b = opts && opts.broad ? wideBuckets() : buckets;
      const prev = new Map([[from, null]]), queue = [from];
      for (let i = 0; i < queue.length; i++) {
        const cur = queue[i];
        for (const x of near(b, cur)) {
          if (prev.has(x) || (skip.has(x) && x !== to)) continue;
          prev.set(x, cur);
          if (x === to) { const out = [x]; let c = cur; while (c) { out.push(c); c = prev.get(c); } return out.reverse(); }
          queue.push(x);
        }
      }
      return null;
    }

    return { lookup, has, neighbors, path, size: words.size, validSize: valid.size, extraSize: extra.size };
  }

  return { create };
});
