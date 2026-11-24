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
 * 範囲 scope: "world" | "japan" | "both"。学年 grade: "junior"(小・中=レベル1〜2) | "high"(高校=レベル3) | "all"。
 * 難しさ difficulty ごとに、出やすいレベル(1小学〜3高校)が変わる。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./text.js") : root.GeoText);
  else root.GeoQuestions = factory(root.GeoText);
})(typeof self !== "undefined" ? self : this, function (Text) {
  "use strict";

  const MODES = ["buzz", "map", "choice"];
  const SCOPES = ["both", "world", "japan"];
  /**
   * 学年: junior=小学・中学(レベル1〜2) / high=高校(レベル3) / exam=高校(大学入試。ex が付いた問題だけ) / all=すべて
   * ex=1〜3(基礎・標準・発展)は大学入試向きの問題の印。xo=1 は「大学入試だけの問題」で、junior・high・all には出さない。
   */
  const GRADES = ["all", "junior", "high", "exam"];
  const inGrade = (q, grade) => grade === "exam" ? q.ex > 0 : q.xo ? false : grade === "junior" ? q.lv <= 2 : grade === "high" ? q.lv === 3 : true;
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
      const { difficulty = "normal", scope = "both", grade = "all", rng = Math.random, used = [], lastK = null } = o || {};
      const w = WEIGHT[difficulty] || WEIGHT.normal;
      const levelOf = (x) => (grade === "exam" ? x.ex : x.lv);                       // 大学入試は、基礎・標準・発展(ex)で難しさを分ける
      let pool = lists[mode].filter((q) => inScope(q, scope) && inGrade(q, grade) && !used.includes(q.id));
      if (!pool.length) pool = lists[mode].filter((q) => inScope(q, scope) && inGrade(q, grade));   // 出し尽くしたら、また最初から
      if (!pool.length) pool = lists[mode].filter((q) => inScope(q, scope) && inGrade(q, grade === "exam" ? "exam" : "all"));   // 学年に合う問題がなければ、範囲だけで選ぶ
      if (!pool.length) return null;
      const q = weighted(pool, (x) => (w[levelOf(x)] || 1) * (mode === "choice" && lastK && x.k === lastK ? 0.35 : 1), rng);
      return build(mode, q, rng);
    }

    function build(mode, q, rng) {
      if (mode === "buzz") {
        return { pub: { id: q.id, mode, cat: q.cat, lv: q.lv, ex: q.ex || 0, text: q.text, at: Text.schedule(q.text) }, priv: { ans: q.ans, yomi: q.yomi } };
      }
      if (mode === "map") {
        return { pub: { id: q.id, mode, map: q.map, ex: q.ex || 0, text: q.text }, priv: { target: q.target } };
      }
      const order = shuffle([0, 1, 2, 3], rng);                                        // 正解(0番目)の位置をばらけさせる
      return { pub: { id: q.id, mode, k: q.k, ex: q.ex || 0, q: q.q, m: q.m, c: order.map((i) => q.c[i]) }, priv: { a: order.indexOf(0) } };
    }

    return { MODES, SCOPES, GRADES, pick, build, isValidTarget, nameOf, lists, countryBy, prefBy };
  }

  return { MODES, SCOPES, GRADES, WEIGHT, create };
});
