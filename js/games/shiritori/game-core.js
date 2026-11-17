/**
 * 対CPU戦の進行ロジック（画面・タイマーに依存しない）
 *
 *   const game = ShiritoriGameCore.create({ dict, judge, difficulty: "normal", ignoreDakuten: false });
 *   await game.submit(reading, english, remainingSec)  // プレイヤーの手
 *   game.timeout()                                     // 時間切れ
 *   game.hint()                                        // ヒント(得点-5)
 *   game.cpuTurn()                                     // CPUの手（プレイヤーの手が通った後）
 *
 * 結果の kind:
 *   retry     入力の形式ミスや未知の語（ライフは減らない）
 *   miss      まちがい（ライフ-1）
 *   accepted  成功
 *   cpu / cpu_stuck  CPUの手 / CPUが出せなくなった(プレイヤーの勝ち)
 * ゲーム終了は state().result: win | lost_n | lost_lives
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rules.js"));
  else root.ShiritoriGameCore = factory(root.ShiritoriRules);
})(typeof self !== "undefined" ? self : this, function (Rules) {
  "use strict";

  const DIFFICULTIES = {
    easy:   { key: "easy",   label: "易{やさ}しい",   maxLevel: 1, lives: 5, seconds: 45, mult: 1 },
    normal: { key: "normal", label: "普通{ふつう}",     maxLevel: 2, lives: 3, seconds: 30, mult: 1.5 },
    hard:   { key: "hard",   label: "難{むずか}しい", maxLevel: 3, lives: 3, seconds: 20, mult: 2 }
  };
  const START_KANA = "り";   // 「しりとり」の「り」から始める
  const HINT_COST = 5;

  /** 1手の得点 = (基本10 + 文字数×2 + はやさボーナス0〜10 + れんぞくボーナス) × むずかしさ倍率 */
  function pointsFor(p) {
    const speed = Math.max(0, Math.min(10, Math.floor((p.remaining / p.seconds) * 10)));
    const streak = Math.min(p.streak, 5) * 2;
    return Math.round((10 + p.length * 2 + speed + streak) * p.mult);
  }

  function create(opts) {
    const dict = opts.dict, judge = opts.judge;
    const d = DIFFICULTIES[opts.difficulty] || DIFFICULTIES.normal;
    const ruleOpts = { ignoreDakuten: !!opts.ignoreDakuten };
    const rng = opts.rng || Math.random;

    const s = {
      phase: "player",          // player | cpu | over
      result: null,
      required: START_KANA,
      used: new Set(),
      history: [],              // {who, reading, english, points?}
      lives: d.lives,
      score: 0,
      streak: 0,
      words: 0,
      hints: 0,
      mistakes: []              // {reading, typed, correct, reason}
    };

    function finish(result) {
      s.phase = "over";
      s.result = result;
    }

    function miss(reason, info) {
      s.lives--;
      s.streak = 0;
      let correct = null;
      if ((reason === "spelling" || reason === "wrong_english") && info) {
        correct = info.suggestion || dict.englishFor(info.reading)[0] || null;
      }
      const review = correct
        ? { reading: info.reading, typed: info.english, correct, reason }
        : null;
      if (review) s.mistakes.push(review);
      if (s.lives <= 0) finish("lost_lives");
      return { kind: "miss", reason, correct, review, lives: s.lives, gameOver: s.phase === "over" };
    }

    async function submit(reading, english, remaining) {
      if (s.phase !== "player") return { kind: "ignored" };
      const r = await judge.judge(
        { reading, english, requiredKana: s.required, usedEnglish: s.used }, ruleOpts);

      if (r.ok) {
        s.streak++;
        s.words++;
        const points = pointsFor({
          length: r.english.length, remaining: Math.max(0, remaining), seconds: d.seconds,
          streak: s.streak, mult: d.mult
        });
        s.score += points;
        s.used.add(r.english);
        s.history.push({ who: "player", reading: r.reading, english: r.english, points });
        s.required = r.tail;
        if (r.endsWithN) finish("lost_n");
        else s.phase = "cpu";
        return { kind: "accepted", points, reading: r.reading, english: r.english, tail: r.tail,
                 source: r.source, endsWithN: r.endsWithN, gameOver: s.phase === "over" };
      }

      if (r.reason === "invalid_reading" || r.reason === "invalid_english" || r.reason === "unknown_word") {
        return { kind: "retry", reason: r.reason };
      }
      return Object.assign(miss(r.reason, r), { required: s.required });
    }

    function timeout() {
      if (s.phase !== "player") return { kind: "ignored" };
      return Object.assign(miss("timeout"), { required: s.required });
    }

    /** ヒント: つながる単語の例を1つ。読みと英語の頭文字・文字数を教える（得点-5） */
    function hint() {
      if (s.phase !== "player") return null;
      const w = dict.pickCpu({ requiredKana: s.required, used: s.used, maxLevel: d.maxLevel,
                               ignoreDakuten: ruleOpts.ignoreDakuten, rng });
      if (!w) return null;
      s.hints++;
      s.score = Math.max(0, s.score - HINT_COST);
      return { reading: w.reading, firstLetter: w.english[0], length: w.english.length, cost: HINT_COST };
    }

    function cpuTurn() {
      if (s.phase !== "cpu") return { kind: "ignored" };
      const w = dict.pickCpu({ requiredKana: s.required, used: s.used, maxLevel: d.maxLevel,
                               ignoreDakuten: ruleOpts.ignoreDakuten, rng });
      if (!w) {
        finish("win");
        return { kind: "cpu_stuck" };
      }
      const tail = Rules.getTailKana(w.reading, ruleOpts);
      s.used.add(w.english);
      s.history.push({ who: "cpu", reading: w.reading, english: w.english });
      s.required = tail;
      s.phase = "player";
      return { kind: "cpu", reading: w.reading, english: w.english, tail };
    }

    function state() {
      return Object.assign({}, s, { used: new Set(s.used), history: s.history.slice(), mistakes: s.mistakes.slice() });
    }

    return { submit, timeout, hint, cpuTurn, state, difficulty: d };
  }

  return { create, pointsFor, DIFFICULTIES, START_KANA, HINT_COST };
});
