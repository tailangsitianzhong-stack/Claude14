/**
 * 地理クイズの出題（画面・通信・時間に依存しない純粋な関数）
 *
 *   const Q = GeoQuestions.create(window.GEO_DATA);
 *   const { pub, priv } = Q.pick("choice", { difficulty:"normal", scope:"both", rng, used:["f-eiffel"], lastK:"photo" });
 *
 * pub  = 端末に見せてよい問題(答えは含めない) / priv = 答え(部屋ではサーバーだけが持つ)
 *   buzz  : pub {id,mode,cat,lv,text,at:[各文字が出る時刻]}  priv {ans,yomi:[…]}
 *   map   : pub {id,mode,map:"world|japan",text}             priv {target}
 *   choice: pub {id,mode,k,q,m,c:[4つ(順番はシャッフル済み)]}  priv {a:正解の位置}
 * 範囲 scope: "world" | "japan" | "both"。難しさ difficulty ごとに、出やすいレベル(1小学〜3高校)が変わる。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./text.js") : root.GeoText);
  else root.GeoQuestions = factory(root.GeoText);
})(typeof self !== "undefined" ? self : this, function (Text) {
  "use strict";

  const MODES = ["buzz", "map", "choice"];
  const SCOPES = ["both", "world", "japan"];
  /** 難しさごとの、レベル(1〜3)の出やすさ */
  const WEIGHT = {
    easy: { 1: 4, 2: 2, 3: 0.3 },
    normal: { 1: 2, 2: 3, 3: 2 },
    hard: { 1: 0.5, 2: 2, 3: 4 }
  };

  function create(data) {
    const countryBy = new Map(data.countries.map((c) => [c[0], c]));
    const prefBy = new Map(data.prefs.map((p) => [p[0], p]));
    const lists = { buzz: data.buzz, map: data.map, choice: data.choice };

    const inScope = (q, scope) => scope === "both" || !scope || q.sc === scope;
    const weighted = (items, weightOf, rng) => {
      const ws = items.map(weightOf);
      let r = rng() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
      return items[items.length - 1];
    };
    const shuffle = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    /** 地図で選べる場所(世界=独立国のコード / 日本=都道府県のコード)か */
    const isValidTarget = (map, id) => (map === "japan" ? prefBy.has(id) : countryBy.has(id));
    const nameOf = (map, id) => (map === "japan" ? (prefBy.get(id) || [])[1] : (countryBy.get(id) || [])[1]) || id;

    /** 問題を1つ選ぶ。used=もう出した問題のid / lastK=直前の資料選択の種類(続けて同じ種類になりにくくする) */
    function pick(mode, o) {
      const { difficulty = "normal", scope = "both", rng = Math.random, used = [], lastK = null } = o || {};
      const w = WEIGHT[difficulty] || WEIGHT.normal;
      let pool = lists[mode].filter((q) => inScope(q, scope) && !used.includes(q.id));
      if (!pool.length) pool = lists[mode].filter((q) => inScope(q, scope));          // 出し尽くしたら、また最初から
      if (!pool.length) return null;
      const q = weighted(pool, (x) => (w[x.lv] || 1) * (mode === "choice" && lastK && x.k === lastK ? 0.35 : 1), rng);
      return build(mode, q, rng);
    }

    function build(mode, q, rng) {
      if (mode === "buzz") {
        return { pub: { id: q.id, mode, cat: q.cat, lv: q.lv, text: q.text, at: Text.schedule(q.text) }, priv: { ans: q.ans, yomi: q.yomi } };
      }
      if (mode === "map") {
        return { pub: { id: q.id, mode, map: q.map, text: q.text }, priv: { target: q.target } };
      }
      const order = shuffle([0, 1, 2, 3], rng);                                        // 正解(0番目)の位置をばらけさせる
      return { pub: { id: q.id, mode, k: q.k, q: q.q, m: q.m, c: order.map((i) => q.c[i]) }, priv: { a: order.indexOf(0) } };
    }

    return { MODES, SCOPES, pick, build, isValidTarget, nameOf, lists, countryBy, prefBy };
  }

  return { MODES, SCOPES, WEIGHT, create };
});
