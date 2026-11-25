/**
 * 化学クイズのCPU（ひとり用）。難しさとレベルで、正解する確率・答えるまでの時間・早押しの位置を決める。
 * 画面・タイマーに依存しない純粋な関数。いつ実行するかは呼び出し側(game.js)が決める。
 *
 *   const cpu = ChemCpu.create();
 *   const plan = cpu.plan(st, rng);   // 今のラウンドの形式(st.rmode)に合わせた計画
 *     choice: { delayMs, i }                 delayMs 後に、選択肢 i を選ぶ
 *     calc  : { delayMs, text }              delayMs 後に、数 text を答える
 *     buzz  : { pressIdx, answerMs, text }   問題文が pressIdx 単位まで出たら押し、answerMs 後に text で答える(押さない=null)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./calc.js") : root.ChemCalc);
  else root.ChemCpu = factory(root.ChemCalc);
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";

  /** 正解する確率(難しさ)。レベルが高い問題ほど下がる */
  const KNOW = {
    choice: { easy: 0.5, normal: 0.68, hard: 0.86 },
    calc: { easy: 0.35, normal: 0.55, hard: 0.78 },
    buzz: { easy: 0.3, normal: 0.5, hard: 0.76 }
  };
  const LV_ADJ = { 1: 0.12, 2: 0, 3: -0.18 };
  const DELAY = { choice: { easy: [8000, 20000], normal: [6000, 16000], hard: [4000, 12000] } };
  /** 計算は、制限時間の何割ごろに答えるか */
  const CALC_AT = { easy: [0.55, 0.95], normal: [0.4, 0.85], hard: [0.3, 0.7] };
  const PRESS = { easy: [0.65, 0.98], normal: [0.45, 0.9], hard: [0.3, 0.75] };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const between = (r, [a, b]) => a + r() * (b - a);

  function create() {
    function plan(st, rng = Math.random) {
      const d = st.difficulty, lv = st.grade === "exam" ? (st.q && st.q.ex >= 2 ? 3 : 2) : (st.q && st.q.lv) || 2;     // 大学入試は、CPUも少しまちがえやすい
      if (st.rmode === "choice") {
        const p = clamp(KNOW.choice[d] + (LV_ADJ[lv] || 0) * 0.5, 0.15, 0.97);
        let i = st.priv.a;
        if (rng() >= p) { const others = [0, 1, 2, 3].filter((x) => x !== st.priv.a); i = others[Math.floor(rng() * 3)]; }
        return { delayMs: Math.round(between(rng, DELAY.choice[d])), i };
      }
      if (st.rmode === "calc") {
        const p = clamp(KNOW.calc[d] + (LV_ADJ[lv] || 0), 0.1, 0.95), ans = st.priv.ans;
        let text = Calc.show(ans, st.priv.sig);
        if (rng() >= p) {                                                     // まちがえかた: 桁をまちがえる・半分/2倍・少しずれる
          const k = rng(), wrong = k < 0.3 ? ans * 10 : k < 0.5 ? ans / 10 : k < 0.7 ? ans * 2 : k < 0.85 ? ans / 2 : ans * (1 + (rng() < 0.5 ? -1 : 1) * (0.1 + rng() * 0.3));
          text = Calc.show(wrong === ans ? ans * 3 : wrong, st.priv.sig);
        }
        return { delayMs: Math.round(between(rng, CALC_AT[d]) * (st.endsAt - st.startedAt)), text };
      }
      // 早押し
      const knows = rng() < clamp(KNOW.buzz[d] + (LV_ADJ[lv] || 0), 0.1, 0.95);
      const len = Math.max(1, (st.q.at || []).length);
      const text = (st.priv && st.priv.yomi && st.priv.yomi[0]) || "";
      if (knows) return { pressIdx: Math.max(1, Math.floor(between(rng, PRESS[d]) * len)), answerMs: Math.round(between(rng, [1500, 4000])), text };
      if (rng() < (d === "hard" ? 0.08 : 0.22)) return { pressIdx: len, answerMs: Math.round(between(rng, [1500, 4000])), text: "わからない" };
      return { pressIdx: null, answerMs: 0, text: "" };
    }
    return { plan, KNOW, DELAY, PRESS, CALC_AT };
  }

  return { KNOW, DELAY, PRESS, create };
});
