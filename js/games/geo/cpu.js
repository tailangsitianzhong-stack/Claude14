/**
 * 地理クイズのCPU（ひとり用）。難しさとレベルで、正解する確率・答えるまでの時間・早押しの位置を決める。
 * 画面・タイマーに依存しない純粋な関数。いつ実行するかは呼び出し側(game.js)が決める。
 *
 *   const cpu = GeoCpu.create(data);
 *   const plan = cpu.plan(st, rng);   // 今のラウンドの形式(st.rmode)に合わせた計画
 *     choice: { delayMs, i }                 delayMs 後に、選択肢 i を選ぶ
 *     map   : { delayMs, id }                delayMs 後に、場所 id を決定する
 *     buzz  : { pressIdx, answerMs, text }   問題文が pressIdx 文字まで出たら押し、answerMs 後に text で答える(押さない=null)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GeoCpu = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** 正解する確率(難しさ)。レベルが高い問題ほど少し下がる */
  const KNOW = {
    choice: { easy: 0.5, normal: 0.7, hard: 0.88 },
    map: { easy: 0.4, normal: 0.6, hard: 0.82 },
    buzz: { easy: 0.35, normal: 0.55, hard: 0.8 }
  };
  const LV_ADJ = { 1: 0.1, 2: 0, 3: -0.15 };
  /** 答えるまでの時間(ms)の範囲 */
  const DELAY = {
    choice: { easy: [7000, 18000], normal: [5000, 14000], hard: [3500, 10000] },
    map: { easy: [10000, 28000], normal: [7000, 22000], hard: [5000, 16000] }
  };
  /** 早押しで、押す位置(文の何割まで出たとき) */
  const PRESS = { easy: [0.65, 0.98], normal: [0.45, 0.9], hard: [0.3, 0.75] };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const between = (r, [a, b]) => a + r() * (b - a);

  function create(data) {
    const countries = data.countries, prefs = data.prefs;
    const pickOther = (list, target, rng, sameOf) => {
      const t = list.find((x) => x[0] === target);
      const same = list.filter((x) => x[0] !== target && sameOf(x, t));
      const pool = same.length >= 2 ? same : list.filter((x) => x[0] !== target);
      return pool[Math.floor(rng() * pool.length)][0];
    };

    function plan(st, rng = Math.random) {
      const d = st.difficulty, lv = st.grade === "exam" ? (st.q && st.q.ex >= 2 ? 3 : 2) : (st.q && st.q.lv) || 2;   // 大学入試は、CPUも少しまちがえやすい
      if (st.rmode === "choice") {
        const p = clamp(KNOW.choice[d] + (st.q.k === "photo" ? 0.05 : 0) + (LV_ADJ[lv] || 0) * 0.5, 0.15, 0.97);
        const right = rng() < p;
        let i = st.priv.a;
        if (!right) { const others = [0, 1, 2, 3].filter((x) => x !== st.priv.a); i = others[Math.floor(rng() * 3)]; }
        return { delayMs: Math.round(between(rng, DELAY.choice[d])), i };
      }
      if (st.rmode === "map") {
        const p = clamp(KNOW.map[d] + (st.q.lv === 1 ? 0.05 : -0.05), 0.15, 0.97);
        const target = st.priv.target;
        let id = target;
        if (rng() >= p) {
          id = st.q.map === "japan"
            ? pickOther(prefs, target, rng, (x, t) => x[5] === t[5])           // 同じ地方のどこか
            : pickOther(countries, target, rng, (x, t) => x[3] === t[3]);      // 同じ大陸のどこか
        }
        return { delayMs: Math.round(between(rng, DELAY.map[d])), id };
      }
      // 早押し
      const knows = rng() < clamp(KNOW.buzz[d] + (LV_ADJ[lv] || 0), 0.1, 0.95);
      const len = Math.max(1, (st.q.at || []).length);
      if (knows) {
        return { pressIdx: Math.max(1, Math.floor(between(rng, PRESS[d]) * len)), answerMs: Math.round(between(rng, [1500, 4000])), text: st.priv.yomi[0] };
      }
      // 知らない: たまに、最後のほうで当てずっぽうで押す(まちがえる)
      if (rng() < (d === "hard" ? 0.08 : 0.22)) return { pressIdx: len, answerMs: Math.round(between(rng, [1500, 4000])), text: "わからない" };
      return { pressIdx: null, answerMs: 0, text: "" };
    }

    return { plan, KNOW, DELAY, PRESS };
  }

  return { KNOW, DELAY, PRESS, create };
});
