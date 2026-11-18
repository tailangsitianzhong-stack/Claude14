/**
 * ミニネプリーグ(英語)の進行ロジック（画面・通信・タイマーに依存しない純粋な関数）
 * ひとり用(CPUと対戦)も、友達対戦(サーバー)も、これを共通で使う。
 *
 *   const E = NepCore.create(NepTopics.create(NepWords.create(NEP_DATA), NEP_DATA));
 *   const st = E.newGame({ players:[{id:"p1",name:"あなた"},{id:"c1",name:"CPU",cpu:true}], difficulty:"normal", now, rng });
 *   E.tick(st, now, rng)                  // 時間が来たら次のラウンド開始 / 爆発。起きたことを events で返す
 *   E.answer(st, "p1", "apple", now, rng) // 持っている人の答え。{ ok, reason?, base?, events }
 *   E.nextDeadline(st)                    // 次に tick が必要な時刻(アラーム用)
 *
 * ルール:
 *   ・1ラウンド = 爆弾1つ + お題1つ。導火線は30秒で固定(答えても延びない)
 *   ・持っている人が答える→正解なら次の人へ爆弾が渡る(導火線は進んだまま)。まちがいは渡らない
 *   ・みんなで count が need に届けば解除(最後に答えた人に+20点。正解1つ+10点)。次の人から次のラウンド
 *   ・届かず導火線が切れたら爆発。爆弾を持っていた人だけライフ-1(はじめ3)。0で脱落
 *   ・最後の1人が勝ち。ラウンドが上限(15)に達したら、ライフ→得点の順で決める
 *   ・導火線が切れた直後 GRACE_MS の間は、通信の遅れを考えて答えを受け付ける
 *   ・ヒント: 持っている人が使える(1ラウンドに1人1回・-5点)。正解の1つの頭文字と文字数を全員に見せる
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NepCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FUSE_MS = 30000;
  const GRACE_MS = 1500;
  const BETWEEN_MS = 2800;   // 解除/爆発のあと、次のラウンドまで
  const START_MS = 2200;     // ゲーム開始のよーい
  const LIVES = 3;
  const MAX_ROUNDS = 15;
  const POINT = 10;
  const BONUS = 20;
  const HINT_COST = 5;       // ヒント1回の点数(足りなければ0まで)
  /** 目標の数(生きている人数 → 何個で解除) 。30秒で答えられる量を考えて決めている */
  const NEED = {
    easy: { 2: 3, 3: 4, 4: 5 },
    normal: { 2: 4, 3: 5, 4: 6 },
    hard: { 2: 5, 3: 6, 4: 8 }
  };
  const DIFFICULTIES = ["easy", "normal", "hard"];

  const needFor = (difficulty, aliveCount) => {
    const t = NEED[difficulty] || NEED.normal;
    return t[Math.max(2, Math.min(4, aliveCount))];
  };

  function create(T) {
    const alive = (st) => st.players.filter((p) => p.alive);
    const byId = (st, id) => st.players.find((p) => p.id === id);
    /** seat の次の「生きている人」(自分は除く。自分だけなら自分) */
    function nextAlive(st, fromIdx) {
      const n = st.players.length;
      for (let k = 1; k <= n; k++) {
        const p = st.players[(fromIdx + k) % n];
        if (p.alive) return p;
      }
      return st.players[fromIdx];
    }
    const idxOf = (st, id) => st.players.findIndex((p) => p.id === id);

    function newGame({ players, difficulty = "normal", now, rng = Math.random }) {
      const st = {
        game: "nep",
        difficulty,
        players: players.map((p) => ({ id: p.id, name: p.name, cpu: !!p.cpu, avatar: p.avatar || "", lives: LIVES, score: 0, alive: true, correct: 0 })),
        round: 0,
        maxRounds: MAX_ROUNDS,
        phase: "between",
        nextAt: now + START_MS,
        starterId: null,
        topic: null, count: 0, need: 0, used: [], last: null, prompt: null,
        holder: null, fuseEndsAt: 0, fuseMs: FUSE_MS,
        hint: null,               // 今の問題のヒント { pid, round, count, first, len, text }
        hintUsed: [],             // このラウンドでヒントを使った人
        outcome: null,            // 直前のラウンドの結果 { type:"defuse"|"explode", pid, ... }
        usedKeys: [], lastKind: null,
        startedAt: now, endedAt: 0, result: null
      };
      st.starterId = st.players[Math.floor(rng() * st.players.length)].id;
      return st;
    }

    function setPrompt(st) {
      st.prompt = T.prompt(st.topic, st.count, st.last);
    }

    function startRound(st, now, rng) {
      const a = alive(st);
      st.round += 1;
      const need = needFor(st.difficulty, a.length);
      const topic = T.pick({ difficulty: st.difficulty, need, rng, exclude: { kinds: st.lastKind ? [st.lastKind] : [], keys: st.usedKeys.slice(-24) } });
      st.topic = topic;
      st.need = topic.need;
      st.lastKind = topic.kind;
      st.usedKeys.push(topic.key);
      st.count = 0;
      st.used = [];
      st.last = null;
      st.holder = (byId(st, st.starterId) && byId(st, st.starterId).alive ? byId(st, st.starterId) : a[0]).id;
      st.fuseEndsAt = now + FUSE_MS;
      st.phase = "play";
      st.outcome = null;
      st.hint = null;
      st.hintUsed = [];
      setPrompt(st);
      return [{ type: "round", round: st.round, topicKind: topic.kind, need: st.need, holder: st.holder }];
    }

    function finish(st, now, reason) {
      st.phase = "over";
      st.endedAt = now;
      const ranking = st.players.slice().sort((x, y) => (y.alive - x.alive) || (y.lives - x.lives) || (y.score - x.score));
      const top = ranking[0];
      const tied = ranking[1] && ranking[1].alive === top.alive && ranking[1].lives === top.lives && ranking[1].score === top.score;
      st.result = { reason, winnerId: tied ? null : top.id, ranking: ranking.map((p) => ({ id: p.id, lives: p.lives, score: p.score, correct: p.correct })) };
      return { type: "over", winnerId: st.result.winnerId, reason };
    }

    function explode(st, now) {
      const h = byId(st, st.holder);
      h.lives -= 1;
      if (h.lives <= 0) h.alive = false;
      // 学べるように、本当は何が答えだったか(例)をいっしょに見せる
      const examples = T.candidates(st.topic, st.count, st.last, st.used).slice(0, 4);
      st.outcome = { type: "explode", pid: h.id, lives: h.lives, out: !h.alive, count: st.count, need: st.need, examples };
      const ev = [{ type: "explode", pid: h.id, lives: h.lives, out: !h.alive }];
      st.starterId = nextAlive(st, idxOf(st, h.id)).id;
      st.phase = "between";
      st.nextAt = now + BETWEEN_MS;
      st.holder = null;
      if (alive(st).length <= 1) ev.push(finish(st, now, "last"));
      else if (st.round >= st.maxRounds) ev.push(finish(st, now, "rounds"));
      return ev;
    }

    /** 時間が来ていれば進める。起きたことを返す */
    function tick(st, now, rng = Math.random) {
      if (st.phase === "between" && now >= st.nextAt) return startRound(st, now, rng);
      if (st.phase === "play" && now > st.fuseEndsAt + GRACE_MS) return explode(st, now);
      return [];
    }

    function answer(st, pid, text, now, rng = Math.random) {
      if (st.phase !== "play") return { ok: false, reason: "not_playing", events: [] };
      if (pid !== st.holder) return { ok: false, reason: "not_your_turn", events: [] };
      if (now > st.fuseEndsAt + GRACE_MS) return { ok: false, reason: "timeout", events: tick(st, now, rng) };
      const j = T.judge(st.topic, st.count, st.last, st.used, text);
      if (!j.ok) {
        return { ok: false, reason: j.reason, base: j.base, word: j.word, events: [{ type: "reject", pid, reason: j.reason, base: j.base, word: j.word }] };
      }
      const p = byId(st, pid);
      st.hint = null;                       // ヒントは「今の問題」のもの
      st.used.push(j.word);
      st.last = j.word;
      st.count += 1;
      p.score += POINT;
      p.correct += 1;
      if (st.count >= st.need) {
        p.score += BONUS;
        st.outcome = { type: "defuse", pid, count: st.count, need: st.need };
        st.starterId = nextAlive(st, idxOf(st, pid)).id;
        st.phase = "between";
        st.nextAt = now + BETWEEN_MS;
        st.holder = null;
        const ev = [{ type: "accept", pid, word: j.word, count: st.count, need: st.need }, { type: "defuse", pid, bonus: BONUS }];
        if (st.round >= st.maxRounds) ev.push(finish(st, now, "rounds"));
        return { ok: true, word: j.word, events: ev };
      }
      const nxt = nextAlive(st, idxOf(st, pid));
      st.holder = nxt.id;
      setPrompt(st);
      return { ok: true, word: j.word, events: [{ type: "accept", pid, word: j.word, count: st.count, need: st.need, next: nxt.id }] };
    }

    /** ヒント: 今の問題の正解を1つ選び、頭文字と文字数を見せる。持っている人だけ・1ラウンドに1人1回・-5点 */
    function hint(st, pid, now, rng = Math.random) {
      if (st.phase !== "play") return { ok: false, reason: "not_playing", events: [] };
      if (pid !== st.holder) return { ok: false, reason: "not_your_turn", events: [] };
      if (now > st.fuseEndsAt + GRACE_MS) return { ok: false, reason: "timeout", events: [] };
      if (st.hintUsed.includes(pid)) return { ok: false, reason: "hint_used", events: [] };
      const list = T.candidates(st.topic, st.count, st.last, st.used);
      if (!list.length) return { ok: false, reason: "no_hint", events: [] };
      // 知られている語(知名度の高い順の上位)から選ぶ。手作りの一覧は全部から
      const word = list[Math.floor(rng() * Math.min(list.length, 40))];
      const p = byId(st, pid);
      p.score = Math.max(0, p.score - HINT_COST);
      st.hintUsed.push(pid);
      const first = word[0].toUpperCase();
      st.hint = { pid, round: st.round, count: st.count, first, len: word.length, text: first + " _".repeat(word.length - 1) };
      return { ok: true, events: [{ type: "hint", pid, cost: HINT_COST, len: word.length }] };
    }

    /** 次に tick が必要な時刻(なければ 0)。部屋(サーバー)のアラームに使う */
    function nextDeadline(st) {
      if (st.phase === "play") return st.fuseEndsAt + GRACE_MS + 1;
      if (st.phase === "between") return st.nextAt;
      return 0;
    }

    /** 時計を ms だけ後ろにずらす(ひとり用で、画面を離れている間の時間を止めるため) */
    function shift(st, ms) {
      if (st.phase === "play") st.fuseEndsAt += ms;
      else if (st.phase === "between") st.nextAt += ms;
    }

    /** 他の人へ見せてよい形(お題の答えの一覧 topic は含めない) */
    function view(st) {
      const { topic, usedKeys, ...rest } = st; // eslint-disable-line no-unused-vars
      return rest;
    }

    return { newGame, tick, answer, hint, nextDeadline, shift, view, needFor, alive, byId };
  }

  return { FUSE_MS, GRACE_MS, BETWEEN_MS, START_MS, LIVES, MAX_ROUNDS, POINT, BONUS, HINT_COST, NEED, DIFFICULTIES, needFor, create };
});
