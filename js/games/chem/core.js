/**
 * 化学クイズの進行ロジック（画面・通信・タイマーに依存しない純粋な関数。地理クイズの core.js と同じ作り）
 * ひとり用(CPU対戦)も、友達対戦(サーバー)も、これを共通で使う。3つの形式(資料選択・計算・早押し)を1つの仕組みで扱う。
 *
 *   const E = ChemCore.create(ChemQuestions.create(CHEM_DATA));
 *   const st = E.newGame({ players:[{id,name}], mode:"choice|calc|buzz|mix", difficulty, grade:"high|exam", units:[単元id…](空=すべて), rounds:10, now, rng });
 *     mix = ラウンドごとに、出せる形式がまざる。今のラウンドの形式は st.rmode(単独の形式なら mode と同じ)
 *   E.tick(st, now, rng)                 // 時間が来たら次のラウンド開始 / 締め切り。起きたことを events で返す
 *   E.choose(st, pid, i, now)            // 資料選択: 選択肢 i を選ぶ
 *   E.calc(st, pid, text, now)           // 計算: 数を答える(読めない入力は受けつけず、やり直せる)
 *   E.press(st, pid, now)                // 早押し: ボタンを押す(問題文が止まる)
 *   E.answer(st, pid, text, now)         // 早押し: 答え(用語・化学式)を送る → {verdict:"correct|unsure"}。unsure は AI 判定が必要
 *   E.judged(st, pid, ok, now)           // AI の判定結果を伝える
 *   E.leave(st, pid, now) / E.back(st, pid, now)   // 友達対戦で、通信が切れた / 戻った(切れた人は待たない。戻ってもその問題は解答権なし)
 *   E.nextDeadline(st) / E.view(st) / E.shift(st, ms)
 *
 * 流れ・得点は地理クイズと同じ。計算は、正解 10点 + 早さのボーナス(最大10点)。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./text.js") : root.ChemText, typeof require === "function" ? require("./calc.js") : root.ChemCalc, typeof require === "function" ? require("./units.js") : root.ChemUnits);
  else root.ChemCore = factory(root.ChemText, root.ChemCalc, root.ChemUnits);
})(typeof self !== "undefined" ? self : this, function (Text, Calc, Units) {
  "use strict";

  const START_MS = 2500;        // 開始の「よーい」
  const BETWEEN_MS = 5000;      // ラウンドの間(答え合わせの表示)
  const CHOICE_MS = { text: 25000, table: 30000, chart: 35000, mol: 30000, pt: 30000, svg: 35000 };   // 資料の種類ごとの制限時間
  const ANSWER_MS = 12000;      // 早押しで、押してから答えるまで
  const EXAM_X = 1.3;           // 大学入試の学年は、読み取りや考える時間を長くする
  const AI_WAIT_MS = 12000;     // AI の判定を待つ上限(これを過ぎたら、まちがい扱い)
  const POINT = 10;
  const PENALTY = 5;
  const MODES = ["choice", "calc", "buzz", "mix"];     // mix = ラウンドごとに、出せる形式がまざる
  const RMODES = ["choice", "calc", "buzz"];
  const ROUNDS = [5, 10, 15, 30];
  const DIFFICULTIES = ["easy", "normal", "hard"];

  function create(Q) {
    const byId = (st, id) => st.players.find((p) => p.id === id);
    const publicAnswers = (st) => {                       // 締め切るまでは「答えた/決定した」ことだけ見せる(中身は隠す)
      const out = {};
      for (const [pid, a] of Object.entries(st.answers)) out[pid] = { done: true, at: a.at };
      return out;
    };

    function newGame({ players, mode = "choice", difficulty = "normal", grade = "high", units = [], rounds = 10, now, rng = Math.random }) {
      if (!MODES.includes(mode)) throw new Error("bad mode");
      if (players.length < 1 || players.length > 4) throw new Error("bad players");
      return {
        game: "chem", mode, rmode: mode === "mix" ? null : mode, bag: [], difficulty, grade: grade === "exam" ? "exam" : "high", units: Units.clean(units), rounds,
        forms: RMODES.filter((m) => Q.count(m, { grade: grade === "exam" ? "exam" : "high", units: Units.clean(units) }) > 0),   // 選んだ単元・学年で出せる形式
        players: players.map((p) => ({ id: p.id, name: p.name || "", cpu: !!p.cpu, avatar: p.avatar || "", score: 0, correct: 0 })),
        round: 0, phase: "between", nextAt: now + START_MS,
        q: null, priv: null, startedAt: 0, endsAt: 0,
        answers: {}, buzz: null, reveal: null,
        away: [], sit: [], frozenAt: 0,      // away=いま通信が切れている人 / sit=この問題の解答権がない人(切れた・途中で戻った) / frozenAt=全員いないので止めている
        usedIds: [], lastK: null,
        startedAtGame: now, result: null
      };
    }

    /** ミックス: 3つの形式を1周ずつシャッフルして出す(同じ形式が続きすぎない) */
    function nextRoundMode(st, rng) {
      const forms = st.forms && st.forms.length ? st.forms : RMODES;
      if (st.mode !== "mix") return forms.includes(st.mode) ? st.mode : forms[0];       // 選んだ単元にその形式の問題がなければ、出せる形式に
      if (!st.bag.length) {
        let bag;
        let guard = 0;
        do { bag = forms.slice().sort(() => rng() - 0.5); } while (forms.length > 1 && bag[0] === st.rmode && guard++ < 20);   // 前の周の最後と同じ形式で始めない
        st.bag = bag;
      }
      return st.bag.shift();
    }

    function startRound(st, now, rng) {
      st.rmode = nextRoundMode(st, rng);
      const picked = Q.pick(st.rmode, { difficulty: st.difficulty, grade: st.grade, units: st.units, rng, used: st.usedIds, lastK: st.rmode === "choice" ? st.lastK : null });
      st.round += 1;
      st.q = picked.pub; st.priv = picked.priv;
      st.usedIds.push(picked.pub.id);
      st.lastK = picked.pub.k || null;
      st.answers = {}; st.reveal = null;
      st.sit = st.away.slice();                     // 出題の時にいない人は、この問題は答えられない
      st.phase = "play"; st.startedAt = now;
      st.buzz = null; st.endsAt = 0;
      if (st.rmode === "choice") st.endsAt = now + (st.grade === "exam" ? Math.max(25000, (CHOICE_MS[st.q.k] || 25000) * EXAM_X) : CHOICE_MS[st.q.k] || 25000);
      else if (st.rmode === "calc") st.endsAt = now + (st.q.time || 90) * 1000 * (st.grade === "exam" ? EXAM_X : 1);
      else st.buzz = { by: null, lockedOut: [], pauseMs: 0, at: 0, idx: 0, answerEndsAt: 0, judging: null, wrong: {} };
      return [{ type: "round", round: st.round, mode: st.rmode }];
    }

    function finish(st, now) {
      st.phase = "over";
      const rank = st.players.slice().sort((a, b) => b.score - a.score || b.correct - a.correct);
      const top = rank[0];
      const winners = rank.filter((p) => p.score === top.score && p.correct === top.correct).map((p) => p.id);
      st.result = { winners, ranking: rank.map((p) => ({ id: p.id, score: p.score, correct: p.correct })), rounds: st.round };
      st.endedAt = now;
      return { type: "over", winners };
    }

    /** ラウンドの締め切り: 採点して、答え合わせの表示(reveal)をつくる */
    function endRound(st, now, reason, extra) {
      const gains = {};
      for (const p of st.players) gains[p.id] = 0;
      const rv = { reason, gains, round: st.round };
      if (st.rmode === "choice") {
        rv.a = st.priv.a;
        rv.picks = {};
        for (const [pid, a] of Object.entries(st.answers)) {
          rv.picks[pid] = a.i;
          if (a.i === st.priv.a) gains[pid] = POINT + bonus(st, a.at, 5);
        }
      } else if (st.rmode === "calc") {
        rv.ans = st.priv.ansText;
        rv.steps = st.priv.steps;
        rv.picks = {};
        for (const [pid, a] of Object.entries(st.answers)) {
          rv.picks[pid] = { text: a.text, ok: a.ok };
          if (a.ok) gains[pid] = POINT + bonus(st, a.at, 10);
        }
      } else {
        rv.ans = st.priv.ans;
        rv.by = (extra && extra.by) || null;
        if (extra && extra.by) gains[extra.by] = extra.gain;
        rv.wrong = Object.assign({}, st.buzz && st.buzz.wrong);
        for (const [pid, n] of Object.entries(rv.wrong)) gains[pid] = (gains[pid] || 0) - n;
      }
      for (const p of st.players) {
        const g = gains[p.id] || 0;
        const before = p.score;
        p.score = Math.max(0, p.score + g);
        gains[p.id] = p.score - before;          // 0点より下がらない(実際に変わった分)
        if (g > 0) p.correct += 1;
      }
      st.reveal = rv;
      st.phase = "between";
      st.nextAt = now + BETWEEN_MS;
      st.buzz = st.buzz ? Object.assign(st.buzz, { by: null, judging: null }) : null;
      return [{ type: "reveal", reason, gains }];
    }
    /** 早く答えるほど高い(選択・地図): 残り時間の割合 × max 点 */
    const bonus = (st, at, max) => Math.max(0, Math.floor(max * (st.endsAt - at) / Math.max(1, st.endsAt - st.startedAt)));

    /* ---------- 時間による進行 ---------- */
    function buzzElapsed(st, now) { return now - st.startedAt - st.buzz.pauseMs; }

    function tick(st, now, rng = Math.random) {
      if (st.frozenAt) return [];                    // 全員の通信が切れている間は、時計を止める
      if (st.phase === "between") {
        if (now < st.nextAt) return [];
        return st.round >= st.rounds ? [finish(st, now)] : startRound(st, now, rng);
      }
      if (st.phase !== "play") return [];
      if (st.rmode !== "buzz") return now >= st.endsAt ? endRound(st, now, "time") : [];
      const b = st.buzz;
      if (b.by) {
        if (b.judging) return now > b.judging.since + AI_WAIT_MS ? wrong(st, b.by, now, "ai_timeout") : [];
        return now > b.answerEndsAt ? wrong(st, b.by, now, "timeout") : [];
      }
      if (buzzElapsed(st, now) >= Text.totalMs(st.q.at) + Text.GRACE_MS) return endRound(st, now, "none");
      return [];
    }

    /* ---------- 資料選択・地図 ---------- */
    /** 解答権のある人(切れた人・途中で戻った人はふくまない)が全員答えたか。権利のある人がいなければ false */
    const active = (st) => st.players.filter((p) => !st.sit.includes(p.id));
    function allDone(st) { const a = active(st); return a.length > 0 && a.every((p) => st.answers[p.id]); }
    const sitOut = (st, pid) => st.sit.includes(pid);

    function choose(st, pid, i, now) {
      if (st.phase !== "play" || st.rmode !== "choice") return { ok: false, reason: "not_playing", events: [] };
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (sitOut(st, pid)) return { ok: false, reason: "sit_out", events: [] };
      if (st.answers[pid]) return { ok: false, reason: "already", events: [] };
      if (now > st.endsAt) return { ok: false, reason: "timeout", events: [] };
      if (!Number.isInteger(i) || i < 0 || i > 3) return { ok: false, reason: "bad_answer", events: [] };
      st.answers[pid] = { i, at: now };
      const ev = [{ type: "answered", pid }];
      if (allDone(st)) ev.push(...endRound(st, now, "all"));
      return { ok: true, events: ev };
    }

    /** 計算: 数を答える。読めない入力は受けつけない(やり直せる)。決定後は変えられない */
    function calc(st, pid, text, now) {
      if (st.phase !== "play" || st.rmode !== "calc") return { ok: false, reason: "not_playing", events: [] };
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (sitOut(st, pid)) return { ok: false, reason: "sit_out", events: [] };
      if (st.answers[pid]) return { ok: false, reason: "already", events: [] };
      if (now > st.endsAt) return { ok: false, reason: "timeout", events: [] };
      const t = String(text == null ? "" : text);
      if (t.length > 24 || Calc.parse(t) == null) return { ok: false, reason: "bad_answer", events: [] };
      st.answers[pid] = { text: t, ok: Calc.check(t, st.priv), at: now };
      const ev = [{ type: "answered", pid }];
      if (allDone(st)) ev.push(...endRound(st, now, "all"));
      return { ok: true, events: ev };
    }

    /* ---------- 早押し ---------- */
    function press(st, pid, now) {
      if (st.phase !== "play" || st.rmode !== "buzz") return { ok: false, reason: "not_playing", events: [] };
      const b = st.buzz;
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (sitOut(st, pid)) return { ok: false, reason: "sit_out", events: [] };
      if (b.by) return { ok: false, reason: "taken", events: [] };
      if (b.lockedOut.includes(pid)) return { ok: false, reason: "locked_out", events: [] };
      const idx = Text.visible(st.q.at, buzzElapsed(st, now));
      Object.assign(b, { by: pid, at: now, idx, answerEndsAt: now + ANSWER_MS * (st.grade === "exam" ? EXAM_X : 1), judging: null });
      return { ok: true, events: [{ type: "press", pid, idx }] };
    }

    /** 早押しで、まだ解答権がある人(切れていない・まちがえていない)がいないか。全員がいないときは別(止めている) */
    const noneLeft = (st) => active(st).length > 0 && active(st).every((p) => st.buzz.lockedOut.includes(p.id));

    /** まちがい・時間切れ: -5点、そのラウンドは解答権なし。問題文はつづきから再開 */
    function wrong(st, pid, now, why) {
      const b = st.buzz;
      b.wrong[pid] = (b.wrong[pid] || 0) + PENALTY;
      b.lockedOut.push(pid);
      b.pauseMs += now - b.at;                    // 止まっていた分だけ、文の進みをずらす(つづきから流れる)
      b.by = null; b.judging = null;
      const ev = [{ type: "wrong", pid, why }];
      if (noneLeft(st)) ev.push(...endRound(st, now, "allwrong"));
      return ev;
    }

    function correct(st, pid, now) {
      const b = st.buzz;
      const len = Math.max(1, st.q.at.length);
      const gain = POINT + Math.max(0, Math.round(10 * (1 - b.idx / len)));
      return [{ type: "correct", pid, gain }, ...endRound(st, now, "correct", { by: pid, gain })];
    }

    function answer(st, pid, text, now) {
      if (st.phase !== "play" || st.rmode !== "buzz") return { ok: false, reason: "not_playing", events: [] };
      const b = st.buzz;
      if (b.by !== pid) return { ok: false, reason: "not_your_turn", events: [] };
      if (b.judging) return { ok: false, reason: "judging", events: [] };
      if (now > b.answerEndsAt) return { ok: false, reason: "timeout", events: tick(st, now) };
      const t = String(text == null ? "" : text);
      if (!Text.normalize(t)) return { ok: false, reason: "empty", events: [] };
      if (t.length > 40) return { ok: false, reason: "too_long", events: [] };
      if (Text.matches(t, st.priv.yomi) || Text.matchesFormula(t, st.priv.forms) || Text.matches(t, [st.priv.ans])) return { ok: true, verdict: "correct", events: correct(st, pid, now) };
      // 辞書(読みの一覧)に合わない。別名・表記ゆれの可能性があるので、AI の確認が必要
      b.judging = { text: t, since: now };
      return { ok: true, verdict: "unsure", text: t, events: [{ type: "judging", pid }] };
    }

    /** AI の判定結果。ok=true なら正解 */
    function judged(st, pid, ok, now) {
      if (st.phase !== "play" || st.rmode !== "buzz") return { ok: false, reason: "not_playing", events: [] };
      const b = st.buzz;
      if (b.by !== pid || !b.judging) return { ok: false, reason: "not_judging", events: [] };
      return { ok: true, events: ok ? correct(st, pid, now) : wrong(st, pid, now, "wrong") };
    }

    /* ---------- 友達対戦: 通信が切れた / 戻った ---------- */
    /**
     * 通信が切れた人は待たない。いまの問題の解答権はなくなる(戻ってきても、その問題は答えられない)。
     * 押した人が切れたら、減点なしで解答権だけなくして、問題文はつづきから流れる。全員が切れたら、時計を止める。
     */
    function leave(st, pid, now) {
      if (!byId(st, pid)) return [];
      if (!st.away.includes(pid)) st.away.push(pid);
      if (st.away.length >= st.players.length) { if (!st.frozenAt) st.frozenAt = now; if (st.phase === "play" && !st.sit.includes(pid)) st.sit.push(pid); return []; }
      if (st.phase !== "play") return [];
      if (!st.sit.includes(pid)) st.sit.push(pid);
      const ev = [{ type: "left", pid }];
      if (st.rmode !== "buzz") { if (allDone(st)) ev.push(...endRound(st, now, "all")); return ev; }
      const b = st.buzz;
      if (b.by === pid) {                              // 答えている途中で切れた: 解答権だけなくす(減点なし)
        b.lockedOut.push(pid);
        b.pauseMs += now - b.at;
        b.by = null; b.judging = null;
      }
      if (noneLeft(st)) ev.push(...endRound(st, now, "allwrong"));
      return ev;
    }

    /** 戻った。止めていた時計を進めて、その間の時間は問題に数えない。この問題の解答権は、切れた人には戻らない */
    function back(st, pid, now) {
      const i = st.away.indexOf(pid);
      if (i < 0) return [];
      st.away.splice(i, 1);
      if (st.frozenAt) {
        shift(st, Math.max(0, now - st.frozenAt));
        st.frozenAt = 0;
        if (st.phase === "play") st.sit = st.away.slice();       // 全員が切れていた間は、問題は進んでいない。最初に戻った人から続ける
      }
      return [{ type: "back", pid }];
    }

    /* ---------- そのほか ---------- */
    function nextDeadline(st) {
      if (st.frozenAt) return 0;
      if (st.phase === "between") return st.nextAt;
      if (st.phase !== "play") return 0;
      if (st.rmode !== "buzz") return st.endsAt;
      const b = st.buzz;
      if (b.by) return b.judging ? b.judging.since + AI_WAIT_MS + 1 : b.answerEndsAt + 1;
      return st.startedAt + b.pauseMs + Text.totalMs(st.q.at) + Text.GRACE_MS + 1;
    }

    /** 時計を ms だけ後ろにずらす(ひとり用で、画面を離れている間の時間を止める) */
    function shift(st, ms) {
      if (st.phase === "between") st.nextAt += ms;
      else if (st.phase === "play") {
        st.startedAt += ms;
        if (st.endsAt) st.endsAt += ms;
        for (const a of Object.values(st.answers)) a.at += ms;
        if (st.buzz) { if (st.buzz.at) st.buzz.at += ms; if (st.buzz.answerEndsAt) st.buzz.answerEndsAt += ms; if (st.buzz.judging) st.buzz.judging.since += ms; }
      }
    }

    /** 他の人へ見せてよい形。ラウンドの途中は、他の人の答えの中身と、答え(priv)を含めない */
    function view(st) {
      const { priv, usedIds, answers, ...rest } = st; // eslint-disable-line no-unused-vars
      return Object.assign(rest, { answers: st.phase === "play" ? publicAnswers(st) : {} });
    }

    return { newGame, tick, choose, calc, press, answer, judged, leave, back, nextDeadline, shift, view, byId };
  }

  return { START_MS, BETWEEN_MS, CHOICE_MS, ANSWER_MS, AI_WAIT_MS, POINT, PENALTY, MODES, RMODES, ROUNDS, DIFFICULTIES, create };
});
