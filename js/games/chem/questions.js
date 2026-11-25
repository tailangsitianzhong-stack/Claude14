/**
 * 化学クイズの出題: 学年・単元・難しさで、問題を1つ選ぶ。画面・通信に依存しない(ブラウザ・Worker・テストで共通)。
 *
 *   const Q = ChemQuestions.create(CHEM_DATA);
 *   Q.pick("choice|calc|buzz", { difficulty, grade, units, rng, used, lastK }) → { pub, priv }
 *   Q.count(mode, { grade, units })  → その学年・単元で出せる問題の数(計算はテンプレートの数)
 *
 * 学年: high=高校(化学基礎・化学。lv=1〜3 を、難しさで出し分ける) / exam=高校(大学入試。ex=1〜3 の問題だけ。基礎・標準・発展)
 *   xo=1 は「大学入試だけの問題」で、高校には出さない。単元 units は ChemUnits のid(空=すべて)。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./text.js") : root.ChemText, typeof require === "function" ? require("./calc.js") : root.ChemCalc);
  else root.ChemQuestions = factory(root.ChemText, root.ChemCalc);
})(typeof self !== "undefined" ? self : this, function (Text, Calc) {
  "use strict";

  const MODES = ["buzz", "calc", "choice"];
  const GRADES = ["high", "exam"];
  const inGrade = (q, grade) => (grade === "exam" ? q.ex > 0 : !q.xo);
  const WEIGHT = {
    easy: { 1: 4, 2: 2, 3: 0.3 },
    normal: { 1: 2, 2: 3, 3: 2 },
    hard: { 1: 0.5, 2: 2, 3: 4 }
  };

  function create(data) {
    const lists = { buzz: data.buzz || [], choice: data.choice || [], calc: Calc.TEMPLATES };
    const inUnits = (q, units) => !units || !units.length || units.includes(q.u);
    const weighted = (items, weightOf, rng) => {
      const ws = items.map(weightOf);
      let r = rng() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
      return items[items.length - 1];
    };
    const shuffle = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    const poolOf = (mode, grade, units) => lists[mode].filter((q) => inGrade(q, grade) && inUnits(q, units));
    const count = (mode, o) => poolOf(mode, (o && o.grade) || "high", (o && o.units) || []).length;

    function pick(mode, o) {
      const { difficulty = "normal", grade = "high", units = [], rng = Math.random, used = [], lastK = null } = o || {};
      const w = WEIGHT[difficulty] || WEIGHT.normal;
      const levelOf = (x) => (grade === "exam" ? x.ex : x.lv);
      let pool = poolOf(mode, grade, units).filter((q) => !used.includes(q.id));
      if (!pool.length) pool = poolOf(mode, grade, units);                                // 出し尽くしたら、また最初から
      if (!pool.length) pool = lists[mode].filter((q) => inGrade(q, grade));              // 選んだ単元にこの形式がなければ、単元は問わない
      if (!pool.length) return null;
      const q = weighted(pool, (x) => (w[levelOf(x)] || 1) * (mode === "choice" && lastK && x.k === lastK ? 0.35 : 1), rng);
      return build(mode, q, rng);
    }

    function build(mode, q, rng) {
      if (mode === "calc") return Calc.build(q, rng);
      if (mode === "buzz") return { pub: { id: q.id, mode, u: q.u, lv: q.lv, ex: q.ex || 0, text: q.text, at: Text.schedule(q.text) }, priv: { ans: q.ans, yomi: q.yomi, forms: q.f || [] } };
      const order = shuffle([0, 1, 2, 3], rng);                                           // 正解(0番目)の位置をばらけさせる
      return { pub: { id: q.id, mode, u: q.u, k: q.k, lv: q.lv, ex: q.ex || 0, q: q.q, m: q.m || {}, c: order.map((i) => q.c[i]) }, priv: { a: order.indexOf(0) } };
    }

    return { MODES, GRADES, pick, build, count, poolOf, lists };
  }

  return { MODES, GRADES, WEIGHT, create };
});
