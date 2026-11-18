/**
 * ミニネプリーグ(英語)のCPU（ひとり用）。考える時間・知っている語の広さ・まちがい方を決める。
 * 画面・タイマーに依存しない純粋な関数。いつ実行するかは呼び出し側(game.js)が決める。
 *
 *   const cpu = NepCpu.create(W, T);
 *   const plan = cpu.plan(st, rng);   // { delayMs, word }  delayMs 後に word を答える(まちがいの語のこともある)
 *
 * 強さ(難しさ):
 *   easy   … よく知られた語(上位6000語)だけ / 考える時間 2.5〜6秒 / 15%まちがえる
 *   normal … 上位15000語 / 2〜4.5秒 / 8%
 *   hard   … 30000語すべて / 1.2〜3.2秒 / 3%
 *   答えの一覧がある型(カテゴリ・熟語など)は、手で選んだ語なので広さの制限はかけない。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NepCpu = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LEVELS = {
    easy: { rank: 6000, delay: [2500, 6000], fail: 0.15 },
    normal: { rank: 15000, delay: [2000, 4500], fail: 0.08 },
    hard: { rank: 30000, delay: [1200, 3200], fail: 0.03 }
  };

  function create(W, T) {
    /** 答える語を選ぶ(なければ ""). 知名度の高い語ほど選ばれやすい */
    function choose(st, rng, lv) {
      const sp = T.spec(st.topic, st.count, st.last);
      let list = T.candidates(st.topic, st.count, st.last, st.used);
      if (!list.length) return "";
      if (sp.explicit) return list[Math.floor(rng() * list.length)];
      list = list.filter((w) => W.rank(w) <= lv.rank);
      if (!list.length) return "";
      return list[Math.floor(Math.pow(rng(), 1.7) * list.length)];
    }
    /** わざとまちがえる語(お題に合わない語。たまたま合っていたらそのまま正解になる) */
    function wrongWord(st, rng) {
      for (let i = 0; i < 12; i++) {
        const w = W.list[Math.floor(rng() * Math.min(W.list.length, 3000))];
        if (T.judge(st.topic, st.count, st.last, st.used, w).ok === false) return w;
      }
      return "zzz";
    }

    function plan(st, rng = Math.random) {
      const lv = LEVELS[st.difficulty] || LEVELS.normal;
      const w = choose(st, rng, lv);
      const failing = !w || rng() < lv.fail;
      const word = failing ? wrongWord(st, rng) : w;
      const delayMs = lv.delay[0] + rng() * (lv.delay[1] - lv.delay[0]) + word.length * 90;
      return { delayMs: Math.round(delayMs), word, valid: !failing };
    }

    return { plan, choose, LEVELS };
  }

  return { LEVELS, create };
});
