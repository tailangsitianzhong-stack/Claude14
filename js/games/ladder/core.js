/**
 * 英単語トランスミッションの進行ロジック(画面・通信・タイマーに依存しない純粋な関数)。ひとり用も友達対戦(サーバー)も共通。
 *
 * ルール: スタートの単語から、1文字ずつ(同じ位置の文字を1つだけ)変えて、ゴールの単語まで、意味のある英単語でつなぐ。
 *   例: ROCK → JOCK → JOKE。最大4人が順番に1語ずつ出す協力ゲーム。
 *  ・辞書(dict.js)にある単語は、その場で認めて意味を出す。辞書にない単語は、AI に確認する(確認中は時間が止まる)
 *  ・単語として認められない(AI が不可)とチームのギア(ライフ)が1つ減る。0 でおしまい。時間切れ(友達対戦)・「1手戻す」も 1つ減る
 *  ・使った単語・1文字以外が変わる語・文字数の合わない語は、ギアを減らさずに断る(やり直せる)
 *  ・ヒント(チームで3回): ゴールまでの文字のちがい・最短の手数 → 次に変える位置 → その位置の文字
 *  ・星: 辞書上の最短の手数(par)以内でクリアなら★3、+2手以内なら★2、それ以上は★1
 *
 *   const E = LadderCore.create(LadderDict.create(LADDER_DATA));
 *   const st = E.newGame({ players:[{id,avatar}], puzzle:{start,goal,par,level}, turnSec:null, now });
 *   E.propose(st, pid, "jock", now)   → { ok, verdict:"accepted|unsure|rejected", reason, events, judge? }   unsure のときは、AI に聞いて E.judged(st, ok, info, now)
 *   E.tick / E.hint / E.undo / E.leave / E.back / E.nextDeadline / E.view / E.shift
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LadderCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LIVES = 3, HINTS = 3, MAX_STEPS = 40, AI_WAIT_MS = 12000;
  const TURN_SEC = { 1: 60, 2: 50, 3: 45 };
  const LEVELS = [1, 2, 3];

  /** 変わった位置の一覧(同じ長さのとき)。長さがちがえば null */
  function diffs(a, b) {
    if (a.length !== b.length) return null;
    const out = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
    return out;
  }

  function pickPuzzle(data, level, rng = Math.random, used = []) {
    const all = ((data && data.puzzles) || []).filter((p) => p[3] === level);
    const fresh = all.filter((p) => !used.includes(p[0] + ">" + p[1]));
    const list = fresh.length ? fresh : all;
    if (!list.length) return null;
    const p = list[Math.floor(rng() * list.length)];
    return { start: p[0], goal: p[1], par: p[2], level: p[3], id: p[0] + ">" + p[1] };
  }

  function create(Dict) {
    const byId = (st, id) => st.players.find((p) => p.id === id);
    const meaningOf = (w) => { const e = Dict.lookup(w); return e ? { pos: e.pos, ja: e.ja, more: e.more, form: e.form, src: "dict" } : null; };

    function newGame({ players, puzzle, turnSec = null, lives = LIVES, hints = HINTS, now }) {
      if (!puzzle || !puzzle.start || !puzzle.goal) throw new Error("bad puzzle");
      if (players.length < 1 || players.length > 4) throw new Error("bad players");
      const meanings = {};
      for (const w of [puzzle.start, puzzle.goal]) meanings[w] = meaningOf(w) || { pos: "", ja: "", more: [], form: "", src: "dict" };
      return {
        game: "ladder", start: puzzle.start, goal: puzzle.goal, par: puzzle.par || 0, level: puzzle.level || 1, len: puzzle.start.length, puzzleId: puzzle.id || "",
        players: players.map((p) => ({ id: p.id, name: p.name || "", avatar: p.avatar || "", cpu: !!p.cpu, moves: 0, miss: 0 })),
        chain: [puzzle.start], meanings, turn: 0, turnSec, turnEndsAt: turnSec ? now + turnSec * 1000 : 0,
        lives, maxLives: lives, hints, hintLevel: 0, phase: "play", judging: null, last: null,
        away: [], frozenAt: 0, startedAt: now, result: null
      };
    }

    const current = (st) => st.players[st.turn];
    const connected = (st, i) => !st.away.includes(st.players[i].id);

    /** 手番を、つぎの(通信が切れていない)人へ */
    function passTurn(st, now) {
      const n = st.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (st.turn + k) % n;
        if (connected(st, i)) { st.turn = i; break; }
      }
      st.turnEndsAt = st.turnSec ? now + st.turnSec * 1000 : 0;
    }

    function finish(st, win, now, why) {
      st.phase = "over"; st.judging = null;
      const steps = st.chain.length - 1;
      const stars = !win ? 0 : steps <= st.par ? 3 : steps <= st.par + 2 ? 2 : 1;
      st.result = { win, why: why || (win ? "goal" : "gear"), steps, par: st.par, stars, lives: st.lives, chain: st.chain.slice(), contributions: st.players.map((p) => ({ id: p.id, moves: p.moves, miss: p.miss })) };
      st.endedAt = now;
      return { type: "over", win, stars };
    }

    /** 規則だけの確認(辞書や AI は使わない)。ギアは減らさない */
    function validate(st, raw) {
      const word = String(raw == null ? "" : raw).trim().toLowerCase();
      if (!/^[a-z]+$/.test(word) || word.length !== st.len) return { ok: false, reason: "format", word };
      const prev = st.chain[st.chain.length - 1];
      if (word === prev) return { ok: false, reason: "same", word };
      if (st.chain.includes(word)) return { ok: false, reason: "used", word };
      const d = diffs(prev, word);
      if (!d || d.length !== 1) return { ok: false, reason: "diff", word };
      return { ok: true, word, index: d[0] };
    }

    function accept(st, pid, word, meaning, now) {
      st.chain.push(word); st.meanings[word] = meaning;
      const p = byId(st, pid); if (p) p.moves += 1;
      st.hintLevel = 0; st.last = { word, pid, ok: true };
      const ev = [{ type: "word", word, pid, meaning, step: st.chain.length - 1 }];
      if (word === st.goal) ev.push(finish(st, true, now));
      else if (st.chain.length - 1 >= MAX_STEPS) ev.push(finish(st, false, now, "steps"));
      else passTurn(st, now);
      return ev;
    }

    function miss(st, pid, reason, now, word) {
      st.lives -= 1;
      const p = byId(st, pid); if (p) p.miss += 1;
      st.last = { word: word || "", pid, ok: false, reason };
      const ev = [{ type: "miss", pid, reason, word: word || "", lives: st.lives }];
      if (st.lives <= 0) ev.push(finish(st, false, now, "gear")); else passTurn(st, now);
      return ev;
    }

    function propose(st, pid, raw, now) {
      if (st.phase !== "play") return { ok: false, reason: "not_playing", events: [] };
      if (st.judging) return { ok: false, reason: "judging", events: [] };
      if (!byId(st, pid)) return { ok: false, reason: "no_player", events: [] };
      if (st.players.length > 1 && current(st).id !== pid) return { ok: false, reason: "not_your_turn", events: [] };
      if (st.turnEndsAt && now > st.turnEndsAt) return { ok: false, reason: "timeout", events: [] };
      const v = validate(st, raw);
      if (!v.ok) return { ok: false, verdict: "rejected", reason: v.reason, word: v.word, events: [] };
      const m = meaningOf(v.word);
      if (m) {
        const e = Dict.lookup(v.word); if (e && e.form) m.form = e.form;
        return { ok: true, verdict: "accepted", word: v.word, events: accept(st, pid, v.word, m, now) };
      }
      st.judging = { pid, word: v.word, since: now };
      return { ok: true, verdict: "unsure", word: v.word, events: [{ type: "judging", pid, word: v.word }], judge: { word: v.word, prev: st.chain[st.chain.length - 1], goal: st.goal } };
    }

    /** AI の判定結果。info = { pos, ja }。ok=null は「確認できなかった」(ギアは減らさず、やり直せる) */
    function judged(st, ok, info, now) {
      const j = st.judging;
      if (!j || st.phase !== "play") return { ok: false, reason: "not_judging", events: [] };
      st.judging = null;
      if (st.turnEndsAt) st.turnEndsAt += Math.max(0, now - j.since);          // 確認していた間は、手番の時間を止める
      if (ok === true) {
        const meaning = { pos: (info && info.pos) || "", ja: (info && info.ja) || "", more: [], form: (info && info.form) || "", src: "ai" };
        return { ok: true, verdict: "accepted", word: j.word, events: accept(st, j.pid, j.word, meaning, now) };
      }
      if (ok === false) return { ok: true, verdict: "rejected", reason: "notword", word: j.word, events: miss(st, j.pid, "notword", now, j.word) };
      return { ok: true, verdict: "unavailable", word: j.word, events: [{ type: "ai_unavailable", pid: j.pid, word: j.word }] };
    }

    function tick(st, now) {
      if (st.frozenAt || st.phase !== "play") return [];
      if (st.judging) return now > st.judging.since + AI_WAIT_MS ? judged(st, null, null, now).events : [];
      if (st.turnEndsAt && now >= st.turnEndsAt) return miss(st, current(st).id, "time", now);
      return [];
    }

    /** ヒント(チームで回数制限つき): 1回目 ゴールまでのちがい・最短の手数 / 2回目 次に変える位置 / 3回目 その位置の文字 */
    function hint(st, pid, now) {
      if (st.phase !== "play") return { ok: false, reason: "not_playing", events: [] };
      if (st.judging) return { ok: false, reason: "judging", events: [] };
      if (st.hints <= 0) return { ok: false, reason: "no_hints", events: [] };
      const last = st.chain[st.chain.length - 1];
      const way = Dict.path(last, st.goal, new Set(st.chain));
      const d = diffs(last, st.goal);
      const level = Math.min(st.hintLevel, 2);
      let h;
      if (level === 0 || !way) h = { kind: "distance", diff: d ? d.length : 0, steps: way ? way.length - 1 : null };
      else {
        const next = way[1], at = diffs(last, next)[0];
        h = level === 1 ? { kind: "position", index: at } : { kind: "letter", index: at, letter: next[at] };
      }
      st.hints -= 1; st.hintLevel += 1;
      return { ok: true, hint: h, events: [{ type: "hint", pid, hint: h, hints: st.hints }] };
    }

    /** 1手戻す(ギアが1つ減る)。スタートの単語は消せない */
    function undo(st, pid, now) {
      if (st.phase !== "play") return { ok: false, reason: "not_playing", events: [] };
      if (st.judging) return { ok: false, reason: "judging", events: [] };
      if (st.chain.length <= 1) return { ok: false, reason: "nothing", events: [] };
      const w = st.chain.pop(); delete st.meanings[w];
      st.hintLevel = 0; st.lives -= 1;
      const ev = [{ type: "undo", pid, word: w, lives: st.lives }];
      if (st.lives <= 0) ev.push(finish(st, false, now, "gear")); else st.turnEndsAt = st.turnSec ? now + st.turnSec * 1000 : 0;
      return { ok: true, events: ev };
    }

    /* ---------- 友達対戦: 通信が切れた / 戻った(切れた人は待たない) ---------- */
    function leave(st, pid, now) {
      if (!byId(st, pid)) return [];
      if (!st.away.includes(pid)) st.away.push(pid);
      if (st.away.length >= st.players.length) { if (!st.frozenAt) st.frozenAt = now; return []; }
      const ev = [{ type: "left", pid }];
      if (st.phase === "play" && current(st).id === pid) {
        if (st.judging && st.judging.pid === pid) st.judging.pid = pid;            // 確認はそのまま続ける(結果は反映される)
        else passTurn(st, now);
      }
      return ev;
    }
    function back(st, pid, now) {
      const i = st.away.indexOf(pid);
      if (i < 0) return [];
      st.away.splice(i, 1);
      if (st.frozenAt) { shift(st, Math.max(0, now - st.frozenAt)); st.frozenAt = 0; const cur = current(st); if (cur && st.away.includes(cur.id)) passTurn(st, now); }
      return [{ type: "back", pid }];
    }

    function nextDeadline(st) {
      if (st.frozenAt || st.phase !== "play") return 0;
      if (st.judging) return st.judging.since + AI_WAIT_MS + 1;
      return st.turnEndsAt || 0;
    }
    function shift(st, ms) { if (st.turnEndsAt) st.turnEndsAt += ms; if (st.judging) st.judging.since += ms; }

    function view(st) { return JSON.parse(JSON.stringify(st)); }

    return { newGame, validate, propose, judged, tick, hint, undo, leave, back, nextDeadline, shift, view, current, byId };
  }

  return { LIVES, HINTS, MAX_STEPS, AI_WAIT_MS, TURN_SEC, LEVELS, diffs, pickPuzzle, create };
});
