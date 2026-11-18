/**
 * ミニ漢字検定の進行ロジック（画面・タイマーに依存しない。時刻は呼び出し側が渡す）
 *
 * 3つのモード
 *  timeattack … 全体の制限時間(60秒)で何問解けるか。ライフなし。間違えても続く(0点・連続が切れる)
 *  survival   … 1問ごとに制限時間。1問でも時間切れになるか、ライフ(3)が0になったら終了。最大何問解けるか
 *  exam       … 最大60問。1問ごとに制限時間とライフ(5)。時間切れもライフ-1。何問正解で何ポイントか
 *
 *   const g = KankenCore.create({ bank, mode, level, rng });
 *   g.start(now);                    // 最初の問題を出す
 *   g.answer({ reading }|{ choice }, now)  → { correct, points, expected, over }
 *   g.timeout(now) / g.skip(now) / g.tick(now) / g.next(now)
 *   g.state() / g.summary()
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./question.js"));
  else root.KankenCore = factory(root.KankenQuestion);
})(typeof self !== "undefined" ? self : this, function (Q) {
  "use strict";

  /** 1問の制限時間(秒)。読みは入力に時間がかかるので長め */
  const LIMIT = { read: 30, write: 12 };

  const MODES = {
    timeattack: { key: "timeattack", label: "タイムアタック", totalSeconds: 60, lives: null, perQuestion: false, endOnTimeout: false, maxQuestions: null },
    survival:   { key: "survival",   label: "サバイバル",     totalSeconds: null, lives: 3, perQuestion: true, endOnTimeout: true,  maxQuestions: null },
    exam:       { key: "exam",       label: "ミニ検定",       totalSeconds: null, lives: 5, perQuestion: true, endOnTimeout: false, maxQuestions: 60 }
  };

  function create(opts) {
    const bank = opts.bank;
    const m = MODES[opts.mode];
    const rng = opts.rng || Math.random;
    const level = opts.level;
    if (!m) throw new Error("unknown mode: " + opts.mode);

    const s = {
      mode: m.key, level, phase: "idle",      // idle | asking | between(答えたあと・次の問題の前) | over
      q: null, askedAt: 0, deadline: null, endsAt: null,
      asked: 0,                                // 出した問題の数
      answered: 0,                             // 答えた(時間切れ・パスも含む)問題の数
      correct: 0, wrong: 0, timeouts: 0, skipped: 0,
      score: 0, streak: 0, bestStreak: 0,
      lives: m.lives,
      mistakes: [],                            // {type,text,full,answer,given}
      used: new Set(),
      reason: null                             // time | lives | timeout | done
    };

    function finish(reason) { s.phase = "over"; s.reason = reason; s.q = null; s.deadline = null; }

    /** 次の問題を出す。終わりなら false */
    function next(now) {
      if (s.phase === "over") return false;
      if (m.maxQuestions && s.asked >= m.maxQuestions) { finish("done"); return false; }
      if (m.totalSeconds && now >= s.endsAt) { finish("time"); return false; }
      const q = bank.next({ level, rng, used: s.used });
      if (!q) { finish("done"); return false; }
      s.used.add(q.id);
      s.q = q; s.asked++; s.phase = "asking"; s.askedAt = now;
      s.deadline = m.perQuestion ? now + LIMIT[q.type] * 1000 : null;
      return true;
    }

    function start(now) {
      if (m.totalSeconds) s.endsAt = now + m.totalSeconds * 1000;
      return next(now);
    }

    const expected = (q) => (q.type === "read" ? q.answer : q.answer);

    function recordMiss(given) {
      const q = s.q;
      s.wrong++; s.streak = 0;
      s.mistakes.push({ type: q.type, text: q.type === "write" ? q.full : q.text, shown: q.text, reading: q.type === "write" ? q.reading : q.answer, answer: q.answer, given: given || null });
    }

    /** 答える。{reading:"…"} か {choice:0〜3} */
    function answer(resp, now) {
      if (s.phase !== "asking") return { ignored: true };
      if (m.totalSeconds && now >= s.endsAt) { finish("time"); return { ignored: true, over: true }; }
      if (s.deadline && now > s.deadline + 300) return timeout(now);      // 時間をすぎてから届いた答えは時間切れ(少しだけ通信/操作のおまけ)

      const q = s.q;
      const correct = q.type === "read" ? Q.checkReading(resp.reading, q) : Q.checkChoice(resp.choice, q);
      const elapsed = (now - s.askedAt) / 1000;
      let points = 0;
      s.answered++;
      if (correct) {
        s.correct++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
        points = Q.pointsFor({ level: q.level, type: q.type, elapsed, limit: LIMIT[q.type], streak: s.streak });
        s.score += points;
      } else {
        recordMiss(q.type === "read" ? String(resp.reading || "") : q.choices[resp.choice]);
        if (s.lives !== null) { s.lives--; if (s.lives <= 0) finish("lives"); }
      }
      if (s.phase === "asking") { s.phase = "between"; s.deadline = null; }
      return { correct, points, expected: expected(q), question: q, over: s.phase === "over", lives: s.lives };
    }

    /** 1問の制限時間切れ(survival/exam) */
    function timeout(now) {
      if (s.phase !== "asking") return { ignored: true };
      const q = s.q;
      s.answered++; s.timeouts++;
      recordMiss(null);
      if (m.endOnTimeout) finish("timeout");
      else if (s.lives !== null) { s.lives--; if (s.lives <= 0) finish("lives"); }
      if (s.phase === "asking") { s.phase = "between"; s.deadline = null; }
      return { correct: false, timeout: true, points: 0, expected: expected(q), question: q, over: s.phase === "over", lives: s.lives };
    }

    /** パス(タイムアタックだけ)。0点・連続が切れて次へ */
    function skip(now) {
      if (s.phase !== "asking" || !m.totalSeconds) return { ignored: true };
      s.skipped++; s.answered++; s.streak = 0;
      s.phase = "between";
      return { skipped: true, question: s.q };
    }

    /** タイムアタックの全体時間の確認。終わっていれば終了にする */
    function tick(now) {
      if (s.phase !== "over" && s.phase !== "idle" && m.totalSeconds && now >= s.endsAt) finish("time");
      if (s.phase === "asking" && s.deadline && now > s.deadline + 300) return timeout(now);
      return null;
    }

    /** 残り時間(ms)。タイムアタックは全体、それ以外は1問ぶん */
    function remainingMs(now) {
      if (s.phase !== "asking") return 0;
      return Math.max(0, (m.totalSeconds ? s.endsAt : s.deadline) - now);
    }

    function summary() {
      return {
        mode: s.mode, level, reason: s.reason, score: s.score, correct: s.correct, wrong: s.wrong,
        timeouts: s.timeouts, skipped: s.skipped, answered: s.answered, asked: s.asked,
        bestStreak: s.bestStreak, lives: s.lives, maxQuestions: m.maxQuestions,
        accuracy: s.answered ? s.correct / s.answered : 0, mistakes: s.mistakes.map((x) => Object.assign({}, x))
      };
    }

    function state() { return Object.assign({}, s, { used: new Set(s.used), mistakes: s.mistakes.map((x) => Object.assign({}, x)) }); }

    return { start, next, answer, timeout, skip, tick, remainingMs, summary, state, config: m };
  }

  return { create, MODES, LIMIT };
});
