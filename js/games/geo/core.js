/**
 * 地理クイズの進行ロジック（画面・通信・タイマーに依存しない純粋な関数）
 * ひとり用(CPU対戦)も、友達対戦(サーバー)も、これを共通で使う。3つの形式を1つの仕組みで扱う。
 *
 *   const E = GeoCore.create(GeoQuestions.create(GEO_DATA));
 *   const st = E.newGame({ players:[{id,name}], mode:"choice|map|buzz|mix", difficulty, scope, grade:"all|junior|high|exam", rounds:10, now, rng });
 *     mix = ラウンドごとに3つの形式がまざる。今のラウンドの形式は st.rmode(単独の形式なら mode と同じ)
 *   E.tick(st, now, rng)                 // 時間が来たら次のラウンド開始 / 締め切り。起きたことを events で返す
 *   E.choose(st, pid, i, now)            // 資料選択: 選択肢 i を選ぶ
 *   E.lock(st, pid, id, now)             // 地図: 選んだ場所を「決定」する(取り消しは端末側。決定後は変えられない)
 *   E.press(st, pid, now)                // 早押し: ボタンを押す(問題文が止まる)
 *   E.answer(st, pid, text, now)         // 早押し: 答えを送る → {verdict:"correct|wrong|unsure"}。unsure は AI 判定が必要
 *   E.judged(st, pid, ok, now)           // AI の判定結果を伝える
 *   E.nextDeadline(st)                   // 次に tick が必要な時刻(アラーム用)
 *   E.view(st)                           // 他の人へ見せてよい形(答えは、ラウンドが終わるまで含めない)
 *
 * 流れ: 1ラウンド = 1問。phase は between(ラウンドの間・結果表示) / play / over。
 *   resource選択・地図: 全員が同時に答える。全員が答え終わるか制限時間で締め切り、一斉に開示して採点する
 *   早押し: 問題文が1文字ずつ流れる。押した人が答える(まちがい・時間切れは -5点、そのラウンドは解答権なし、文は再開)
 * 得点: 正解 10点 + 早さのボーナス(選択・地図は最大5点 / 早押しは早く押すほど最大10点)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./text.js") : root.GeoText);
  else root.GeoCore = factory(root.GeoText);
})(typeof self !== "undefined" ? self : this, function (Text) {
  "use strict";

  const START_MS = 2500;        // 開始の「よーい」
  const BETWEEN_MS = 5000;      // ラウンドの間(答え合わせの表示)
  const CHOICE_MS = { graph: 25000, table: 25000, type: 25000, photo: 20000, stat: 25000, indic: 30000, pop: 30000, cap: 15000, pref: 15000, basic: 15000, hyther: 25000, combo: 40000 };
  const MAP_MS = 35000;
  const ANSWER_MS = 12000;      // 早押しで、押してから答えるまで
  const EXAM_X = 1.3;           // 大学入試の学年は、読み取りや考える時間を長くする
  const AI_WAIT_MS = 12000;     // AI の判定を待つ上限(これを過ぎたら、まちがい扱い)
  const POINT = 10;
  const PENALTY = 5;
  const MODES = ["choice", "map", "buzz", "mix"];     // mix = ラウンドごとに、3つの形式がまざる
  const RMODES = ["choice", "map", "buzz"];
  const ROUNDS = [5, 10, 15, 30];
  const DIFFICULTIES = ["easy", "normal", "hard"];

  function create(Q) {
    const byId = (st, id) => st.players.find((p) => p.id === id);
    const publicAnswers = (st) => {                       // 締め切るまでは「答えた/決定した」ことだけ見せる(中身は隠す)
      const out = {};
      for (const [pid, a] of Object.entries(st.answers)) out[pid] = { done: true, at: a.at };
      return out;
    };

    function newGame({ players, mode = "choice", difficulty = "normal", scope = "both", grade = "all", rounds = 10, now, rng = Math.random }) {
      if (!MODES.includes(mode)) throw new Error("bad mode");
      if (players.length < 1 || players.length > 4) throw new Error("bad players");
      return {
        game: "geo", mode, rmode: mode === "mix" ? null : mode, bag: [], difficulty, scope, grade, rounds,
        players: players.map((p) => ({ id: p.id, name: p.name || "", cpu: !!p.cpu, avatar: p.avatar || "", score: 0, correct: 0 })),
        round: 0, phase: "between", nextAt: now + START_MS,
        q: null, priv: null, startedAt: 0, endsAt: 0,
        answers: {}, buzz: null, reveal: null,
        usedIds: [], lastK: null,
        startedAtGame: now, result: null
      };
    }

    /** ミックス: 3つの形式を1周ずつシャッフルして出す(同じ形式が続きすぎない) */
    function nextRoundMode(st, rng) {
      if (st.mode !== "mix") return st.mode;
      if (!st.bag.length) {
        let bag;
        do { bag = RMODES.slice().sort(() => rng() - 0.5); } while (bag[0] === st.rmode);   // 前の周の最後と同じ形式で始めない
        st.bag = bag;
      }
      return st.bag.shift();
    }

    function startRound(st, now, rng) {
      st.rmode = nextRoundMode(st, rng);
      const picked = Q.pick(st.rmode, { difficulty: st.difficulty, scope: st.scope, grade: st.grade, rng, used: st.usedIds, lastK: st.rmode === "choice" ? st.lastK : null });
      st.round += 1;
      st.q = picked.pub; st.priv = picked.priv;
      st.usedIds.push(picked.pub.id);
      st.lastK = picked.pub.k || null;
      st.answers = {}; st.reveal = null;
      st.phase = "play"; st.startedAt = now;
      st.buzz = null; st.endsAt = 0;
      if (st.rmode === "choice") st.endsAt = now + (st.grade === "exam" ? Math.max(25000, (CHOICE_MS[st.q.k] || 25000) * EXAM_X) : CHOICE_MS[st.q.k] || 25000);
      else if (st.rmode === "map") st.endsAt = now + MAP_MS * (st.grade === "exam" ? EXAM_X : 1);
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
      } else if (st.rmode === "map") {
        rv.target = st.priv.target;
        rv.name = Q.nameOf(st.q.map, st.priv.target);
        rv.picks = {};
        for (const [pid, a] of Object.entries(st.answers)) {
          rv.picks[pid] = a.id;
          if (a.id === st.priv.target) gains[pid] = POINT + bonus(st, a.at, 5);
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
    function allDone(st) { return st.players.every((p) => st.answers[p.id]); }

    function choose(st, pid, i, now) {
      if (st.phase !== "play" || st.rmode !== "choice") return { ok: false, reason: "not_playing", events: [] };
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (st.answers[pid]) return { ok: false, reason: "already", events: [] };
      if (now > st.endsAt) return { ok: false, reason: "timeout", events: [] };
      if (!Number.isInteger(i) || i < 0 || i > 3) return { ok: false, reason: "bad_answer", events: [] };
      st.answers[pid] = { i, at: now };
      const ev = [{ type: "answered", pid }];
      if (allDone(st)) ev.push(...endRound(st, now, "all"));
      return { ok: true, events: ev };
    }

    function lock(st, pid, id, now) {
      if (st.phase !== "play" || st.rmode !== "map") return { ok: false, reason: "not_playing", events: [] };
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (st.answers[pid]) return { ok: false, reason: "already", events: [] };
      if (now > st.endsAt) return { ok: false, reason: "timeout", events: [] };
      if (typeof id !== "string" || !Q.isValidTarget(st.q.map, id)) return { ok: false, reason: "bad_answer", events: [] };
      st.answers[pid] = { id, at: now };
      const ev = [{ type: "answered", pid }];
      if (allDone(st)) ev.push(...endRound(st, now, "all"));
      return { ok: true, events: ev };
    }

    /* ---------- 早押し ---------- */
    function press(st, pid, now) {
      if (st.phase !== "play" || st.rmode !== "buzz") return { ok: false, reason: "not_playing", events: [] };
      const b = st.buzz;
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (b.by) return { ok: false, reason: "taken", events: [] };
      if (b.lockedOut.includes(pid)) return { ok: false, reason: "locked_out", events: [] };
      const idx = Text.visible(st.q.at, buzzElapsed(st, now));
      Object.assign(b, { by: pid, at: now, idx, answerEndsAt: now + ANSWER_MS * (st.grade === "exam" ? EXAM_X : 1), judging: null });
      return { ok: true, events: [{ type: "press", pid, idx }] };
    }

    /** まちがい・時間切れ: -5点、そのラウンドは解答権なし。問題文はつづきから再開 */
    function wrong(st, pid, now, why) {
      const b = st.buzz;
      b.wrong[pid] = (b.wrong[pid] || 0) + PENALTY;
      b.lockedOut.push(pid);
      b.pauseMs += now - b.at;                    // 止まっていた分だけ、文の進みをずらす(つづきから流れる)
      b.by = null; b.judging = null;
      const ev = [{ type: "wrong", pid, why }];
      if (st.players.every((p) => b.lockedOut.includes(p.id))) ev.push(...endRound(st, now, "allwrong"));
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
      if (Text.matches(t, st.priv.yomi) || Text.matches(t, [st.priv.ans])) return { ok: true, verdict: "correct", events: correct(st, pid, now) };
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

    /* ---------- そのほか ---------- */
    function nextDeadline(st) {
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

    return { newGame, tick, choose, lock, press, answer, judged, nextDeadline, shift, view, byId };
  }

  return { START_MS, BETWEEN_MS, CHOICE_MS, MAP_MS, ANSWER_MS, AI_WAIT_MS, POINT, PENALTY, MODES, RMODES, ROUNDS, DIFFICULTIES, create };
});
