/**
 * 二択クイズの進行ロジック(画面・通信・タイマーに依存しない純粋な関数)。
 * ひとり用も、友達対戦(サーバー)も、これを共通で使う。
 *
 *   const E = DuoCore.create(DuoQuestions.create({ duo, chem, geo }));
 *   const st = E.newGame({ players:[{id,name,avatar}], mode:"fixed|survival", rounds:10|20|30, difficulty, subjects:["en","chem","phys","geo"], now, rng });
 *   E.tick(st, now, rng)               // 時間が来たら次の問題 / 締め切り。起きたことを events で返す
 *   E.choose(st, pid, i, now)          // 二択のどちらか(0=左 / 1=右)を選ぶ
 *   E.leave(st, pid, now) / E.back(st, pid, now)   // 友達対戦で、通信が切れた / 戻った(切れた人は待たない)
 *   E.nextDeadline(st) / E.view(st) / E.shift(st, ms)
 *
 * ルール:
 *  ・全員が同時に答える。全員が答え終わるか、制限時間が来たら締め切り、一斉に答え合わせ(正解の側のパネルをトロッコが突き破る)
 *  ・正解 10点 + 早さのボーナス(最大10点) + 連続正解のボーナス(2回目から +2点ずつ、最大 +10点)
 *  ・まちがい・時間切れは 0点で、連続正解がとぎれる。サバイバルでは、ライフが1つ減る(3つでおしまい)
 *  ・固定(10・20・30問)は、問題数が終わったらおしまい。サバイバルは、全員のライフがなくなるまで続き、だんだん時間が短く・むずかしくなる
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DuoCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const START_MS = 2500;          // 開始の「よーい」
  const BETWEEN_MS = 5200;        // 答え合わせ(トロッコの演出と解説)の時間
  const POINT = 10;
  const SPEED_MAX = 10;
  const STREAK_STEP = 2, STREAK_MAX = 10;
  const LIVES = 3;
  const ROUNDS = [10, 20, 30];
  const MODES = ["fixed", "survival"];
  const DIFFICULTIES = ["easy", "normal", "hard"];
  const SUBJECTS = ["en", "chem", "phys", "geo"];
  const BASE_SEC = { easy: 16, normal: 12, hard: 9 };
  const SURVIVAL_CAP = 300;       // サバイバルで出す問題数の上限(問題を出しつくす前に終わらせる)

  /** 問題の長さに応じた制限時間(ms)。長い英文などは、読む時間を足す */
  function timeFor(st, q) {
    const len = String(q.text || "").length + (q.c || []).reduce((n, t) => n + String(t).length, 0);
    let sec = BASE_SEC[st.difficulty] + Math.min(8, Math.floor(Math.max(0, len - 40) / 30));
    if (q.m) sec += 6;                                   // 図や表がある問題
    if (st.mode === "survival") sec *= Math.max(0.6, 1 - 0.02 * (st.round - 1));   // だんだん短く(最短で6割)
    return Math.round(sec * 1000);
  }

  function create(Q) {
    const byId = (st, id) => st.players.find((p) => p.id === id);
    const alive = (st, p) => st.mode !== "survival" || p.lives > 0;

    function newGame({ players, mode = "fixed", rounds = 10, difficulty = "normal", subjects = SUBJECTS, now, rng = Math.random }) {
      if (!MODES.includes(mode)) throw new Error("bad mode");
      if (players.length < 1 || players.length > 4) throw new Error("bad players");
      const subs = SUBJECTS.filter((s) => (subjects || []).includes(s));
      return {
        game: "duo", mode, rounds: mode === "survival" ? 0 : (ROUNDS.includes(rounds) ? rounds : 10), difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : "normal",
        subjects: subs.length ? subs : SUBJECTS.slice(),
        players: players.map((p) => ({ id: p.id, name: p.name || "", avatar: p.avatar || "", cpu: !!p.cpu, score: 0, correct: 0, streak: 0, bestStreak: 0, lives: mode === "survival" ? LIVES : 0 })),
        round: 0, phase: "between", nextAt: now + START_MS,
        q: null, priv: null, startedAt: 0, endsAt: 0,
        answers: {}, reveal: null,
        away: [], sit: [], frozenAt: 0,      // away=いま通信が切れている人 / sit=この問題の解答権がない人 / frozenAt=全員いないので止めている
        usedIds: [], lastSubj: [], startedAtGame: now, result: null
      };
    }

    function startRound(st, now, rng) {
      const picked = Q.pick({ subjects: st.subjects, difficulty: st.difficulty, rng, used: st.usedIds, round: st.round + 1, survival: st.mode === "survival", lastSubj: st.lastSubj });
      st.round += 1;
      st.q = picked.pub; st.priv = picked.priv;
      st.usedIds.push(picked.pub.id);
      st.lastSubj = st.lastSubj.concat(picked.pub.s).slice(-2);
      st.answers = {}; st.reveal = null;
      st.sit = st.away.slice().concat(st.players.filter((p) => !alive(st, p) && !st.away.includes(p.id)).map((p) => p.id));   // 切れた人・ライフのない人は答えられない
      st.phase = "play"; st.startedAt = now;
      st.endsAt = now + timeFor(st, picked.pub);
      return [{ type: "round", round: st.round }];
    }

    function finish(st, now) {
      st.phase = "over";
      const rank = st.players.slice().sort((a, b) => b.score - a.score || b.correct - a.correct);
      const top = rank[0];
      const winners = rank.filter((p) => p.score === top.score && p.correct === top.correct).map((p) => p.id);
      st.result = { winners, ranking: rank.map((p) => ({ id: p.id, score: p.score, correct: p.correct, bestStreak: p.bestStreak, lives: p.lives })), rounds: st.round, mode: st.mode };
      st.endedAt = now;
      return { type: "over", winners };
    }

    /** 早く答えるほど高い: 残り時間の割合 × SPEED_MAX */
    const speedBonus = (st, at) => Math.max(0, Math.floor(SPEED_MAX * (st.endsAt - at) / Math.max(1, st.endsAt - st.startedAt)));

    /** 締め切り: 採点して、答え合わせ(reveal)をつくる */
    function endRound(st, now, reason) {
      const gains = {}, picks = {}, ok = {};
      for (const p of st.players) {
        gains[p.id] = 0;
        const a = st.answers[p.id];
        picks[p.id] = a ? a.i : null;
        const right = !!a && a.i === st.priv.a;
        ok[p.id] = right;
        if (right) {
          p.streak += 1; p.correct += 1; p.bestStreak = Math.max(p.bestStreak, p.streak);
          gains[p.id] = POINT + speedBonus(st, a.at) + Math.min(STREAK_MAX, (p.streak - 1) * STREAK_STEP);
          p.score += gains[p.id];
        } else if (!st.sit.includes(p.id) || a) {
          p.streak = 0;
          if (st.mode === "survival" && p.lives > 0 && alive(st, p)) p.lives -= 1;
        }
      }
      st.reveal = { reason, a: st.priv.a, picks, ok, gains, explain: st.priv.explain || "", round: st.round, lives: Object.fromEntries(st.players.map((p) => [p.id, p.lives])) };
      st.phase = "between";
      st.nextAt = now + BETWEEN_MS;
      return [{ type: "reveal", reason, gains }];
    }

    const noneAlive = (st) => st.mode === "survival" && st.players.every((p) => p.lives <= 0);
    const isLast = (st) => (st.mode === "fixed" ? st.round >= st.rounds : noneAlive(st) || st.round >= SURVIVAL_CAP);

    /** 解答権のある人が全員答えたか(権利のある人がいなければ false) */
    const active = (st) => st.players.filter((p) => !st.sit.includes(p.id));
    const allDone = (st) => { const a = active(st); return a.length > 0 && a.every((p) => st.answers[p.id]); };

    function tick(st, now, rng = Math.random) {
      if (st.frozenAt) return [];                    // 全員の通信が切れている間は、時計を止める
      if (st.phase === "between") {
        if (now < st.nextAt) return [];
        return !st.round ? startRound(st, now, rng) : isLast(st) ? [finish(st, now)] : startRound(st, now, rng);
      }
      if (st.phase !== "play") return [];
      return now >= st.endsAt ? endRound(st, now, "time") : [];
    }

    function choose(st, pid, i, now) {
      if (st.phase !== "play") return { ok: false, reason: "not_playing", events: [] };
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (st.sit.includes(pid)) return { ok: false, reason: "sit_out", events: [] };
      if (st.answers[pid]) return { ok: false, reason: "already", events: [] };
      if (now > st.endsAt) return { ok: false, reason: "timeout", events: [] };
      if (i !== 0 && i !== 1) return { ok: false, reason: "bad_answer", events: [] };
      st.answers[pid] = { i, at: now };
      const ev = [{ type: "answered", pid }];
      if (allDone(st)) ev.push(...endRound(st, now, "all"));
      return { ok: true, events: ev };
    }

    /** 次の問題へすぐ進む(ひとり用の「つぎへ」。答え合わせの途中だけ) */
    function skip(st, now) {
      if (st.phase !== "between" || !st.round) return false;
      st.nextAt = Math.min(st.nextAt, now);
      return true;
    }

    /* ---------- 友達対戦: 通信が切れた / 戻った ---------- */
    function leave(st, pid, now) {
      if (!byId(st, pid)) return [];
      if (!st.away.includes(pid)) st.away.push(pid);
      if (st.away.length >= st.players.length) { if (!st.frozenAt) st.frozenAt = now; if (st.phase === "play" && !st.sit.includes(pid)) st.sit.push(pid); return []; }
      if (st.phase !== "play") return [];
      if (!st.sit.includes(pid)) st.sit.push(pid);
      const ev = [{ type: "left", pid }];
      if (allDone(st)) ev.push(...endRound(st, now, "all"));
      return ev;
    }

    function back(st, pid, now) {
      const i = st.away.indexOf(pid);
      if (i < 0) return [];
      st.away.splice(i, 1);
      if (st.frozenAt) {
        shift(st, Math.max(0, now - st.frozenAt));
        st.frozenAt = 0;
        if (st.phase === "play") st.sit = st.away.slice();
      }
      return [{ type: "back", pid }];
    }

    function nextDeadline(st) {
      if (st.frozenAt) return 0;
      if (st.phase === "between") return st.nextAt;
      if (st.phase !== "play") return 0;
      return st.endsAt;
    }

    function shift(st, ms) {
      if (st.phase === "between") st.nextAt += ms;
      else if (st.phase === "play") {
        st.startedAt += ms; st.endsAt += ms;
        for (const a of Object.values(st.answers)) a.at += ms;
      }
    }

    /** 他の人へ見せてよい形。ラウンドの途中は、他の人の答えの中身と、答え(priv)を含めない */
    function view(st) {
      const { priv, usedIds, answers, ...rest } = st; // eslint-disable-line no-unused-vars
      const pub = {};
      if (st.phase === "play") for (const [pid, a] of Object.entries(answers)) pub[pid] = { done: true, at: a.at };
      return Object.assign(rest, { answers: pub });
    }

    return { newGame, tick, choose, skip, leave, back, nextDeadline, shift, view, byId };
  }

  return { START_MS, BETWEEN_MS, POINT, SPEED_MAX, STREAK_STEP, STREAK_MAX, LIVES, ROUNDS, MODES, DIFFICULTIES, SUBJECTS, BASE_SEC, SURVIVAL_CAP, timeFor, create };
});
