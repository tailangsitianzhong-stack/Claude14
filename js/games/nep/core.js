/**
 * ミニネプリーグ(英語)の進行ロジック（画面・通信・タイマーに依存しない純粋な関数）
 * ひとり用(CPUと組む)も、友達対戦(サーバー)も、これを共通で使う。
 *
 *   const E = NepCore.create(NepTopics.create(NepWords.create(NEP_DATA), NEP_DATA));
 *   const st = E.newGame({ players:[{id:"a"},{id:"b"},{id:"c"},{id:"d"}], mode:"vs", difficulty:"normal", now, rng });
 *   E.tick(st, now, rng)                  // 時間が来たら次のラウンド開始 / 爆発。起きたことを events で返す
 *   E.answer(st, "a", "apple", now, rng)  // 持っている人の答え。{ ok, reason?, base?, events }
 *   E.hint(st, "a", now, rng)             // ヒント
 *   E.nextDeadline(st)                    // 次に tick が必要な時刻(アラーム用)
 *
 * チーム戦だけ(個人戦はない):
 *   vs   … 2対2。席の順(players の並び)が 赤→青→赤→青 と交互になる(偶数人。2人なら1対1)。爆弾は席の順にまわる
 *   coop … みんなで1チーム(2〜4人)。相手はいない。爆弾を8個解除したらクリア、ライフがなくなったら失敗
 * ルール:
 *   ・1ラウンド = 爆弾1つ + お題1つ。導火線は30秒で固定(答えても延びない)
 *   ・持っている人が答える→正解なら次の席の人へ爆弾が渡る(導火線は進んだまま)。まちがいは渡らない
 *   ・みんなで count が need に届けば解除(最後に答えた人に+20点。正解1つ+10点)。次の席の人から次のラウンド
 *   ・届かず導火線が切れたら爆発。**爆弾を持っていた人のチーム**のライフが1減る(vs: ♥4 / coop: ♥5)
 *   ・vs: 相手チームのライフが0になったら勝ち。ラウンドが上限(15)に達したら、ライフ→チームの得点の順で決める
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
  const TEAM_LIVES = { vs: 4, coop: 5 };
  const COOP_GOAL = 8;       // 協力: 解除する爆弾の数
  const MAX_ROUNDS = 15;     // 対戦: ラウンドの上限
  const POINT = 10;
  const BONUS = 20;
  const HINT_COST = 5;       // ヒント1回の点数(足りなければ0まで)
  /** 目標の数(人数 → 何個で解除) 。30秒で答えられる量を考えて決めている */
  const NEED = {
    easy: { 2: 3, 3: 4, 4: 5 },
    normal: { 2: 4, 3: 5, 4: 6 },
    hard: { 2: 5, 3: 6, 4: 8 }
  };
  const DIFFICULTIES = ["easy", "normal", "hard"];
  const MODES = ["vs", "coop"];
  const TEAM_KEYS = { vs: ["red", "blue"], coop: ["all"] };

  const needFor = (difficulty, playerCount) => {
    const t = NEED[difficulty] || NEED.normal;
    return t[Math.max(2, Math.min(4, playerCount))];
  };

  function create(T) {
    const byId = (st, id) => st.players.find((p) => p.id === id);
    const idxOf = (st, id) => st.players.findIndex((p) => p.id === id);
    /** 席の次の人(席の順にぐるぐるまわる。人は脱落しない) */
    /** 次の席の人。skip に入っている人(通信が切れた人・この問題の解答権がない人)は飛ばす。全員が飛ばされるなら、ただの次の席 */
    const nextSeat = (st, fromIdx, skip = []) => {
      const n = st.players.length;
      for (let k = 1; k <= n; k++) { const p = st.players[(fromIdx + k) % n]; if (!skip.includes(p.id)) return p; }
      return st.players[(fromIdx + 1) % n];
    };
    const teamOf = (st, pid) => st.teams[byId(st, pid).team];

    function newGame({ players, difficulty = "normal", mode = "vs", now, rng = Math.random }) {
      if (!MODES.includes(mode)) throw new Error("bad mode");
      if (players.length < 2 || players.length > 4) throw new Error("bad players");
      if (mode === "vs" && players.length % 2) throw new Error("vs needs an even number of players");
      const keys = TEAM_KEYS[mode];
      const st = {
        game: "nep",
        mode,
        difficulty,
        // 席の順に 赤・青・赤・青…(coop は全員同じチーム)
        players: players.map((p, i) => ({ id: p.id, name: p.name, cpu: !!p.cpu, avatar: p.avatar || "", team: i % keys.length, score: 0, correct: 0 })),
        teams: keys.map((key) => ({ key, lives: TEAM_LIVES[mode], maxLives: TEAM_LIVES[mode], score: 0 })),
        round: 0,
        maxRounds: MAX_ROUNDS,
        goal: mode === "coop" ? COOP_GOAL : 0,
        defused: 0,               // 解除した爆弾の数
        phase: "between",
        nextAt: now + START_MS,
        starterId: null,
        topic: null, count: 0, need: 0, used: [], last: null, prompt: null,
        holder: null, fuseEndsAt: 0, fuseMs: FUSE_MS,
        hint: null,               // 今の問題のヒント { pid, round, count, first, len, text }
        hintUsed: [],             // このラウンドでヒントを使った人
        outcome: null,            // 直前のラウンドの結果 { type:"defuse"|"explode", pid, team, ... }
        usedKeys: [], lastKind: null,
        away: [], sit: [], frozenAt: 0,   // away=いま通信が切れている人 / sit=この問題で、爆弾を受けとれない人(切れた・途中で戻った) / frozenAt=全員いないので時計を止めている
        startedAt: now, endedAt: 0, result: null
      };
      st.starterId = st.players[Math.floor(rng() * st.players.length)].id;
      return st;
    }

    function setPrompt(st) {
      st.prompt = T.prompt(st.topic, st.count, st.last);
    }

    function startRound(st, now, rng) {
      st.round += 1;
      const need = needFor(st.difficulty, st.players.length);
      const topic = T.pick({ difficulty: st.difficulty, need, rng, exclude: { kinds: st.lastKind ? [st.lastKind] : [], keys: st.usedKeys.slice(-24) } });
      st.topic = topic;
      st.need = topic.need;
      st.lastKind = topic.kind;
      st.usedKeys.push(topic.key);
      st.count = 0;
      st.used = [];
      st.last = null;
      st.sit = st.away.slice();                                       // 出題の時にいない人は、この問題では爆弾を受けとれない
      if (st.sit.includes(st.starterId)) st.starterId = nextSeat(st, idxOf(st, st.starterId), st.sit).id;
      st.holder = st.starterId;
      st.fuseEndsAt = now + FUSE_MS;
      st.phase = "play";
      st.outcome = null;
      st.hint = null;
      st.hintUsed = [];
      setPrompt(st);
      return [{ type: "round", round: st.round, topicKind: topic.kind, need: st.need, holder: st.holder }];
    }

    /** ゲーム終了。vs は勝ったチーム(同じなら引き分け=null)、coop はクリアしたか */
    function finish(st, now, reason) {
      st.phase = "over";
      st.endedAt = now;
      const teams = st.teams.map((t, i) => ({ team: i, key: t.key, lives: t.lives, score: t.score }));
      const players = st.players.map((p) => ({ id: p.id, team: p.team, score: p.score, correct: p.correct }));
      const result = { reason, mode: st.mode, round: st.round, teams, players };
      if (st.mode === "coop") {
        Object.assign(result, { cleared: reason === "coop_clear", defused: st.defused, goal: st.goal, winnerTeam: reason === "coop_clear" ? 0 : null });
      } else {
        const rank = teams.slice().sort((x, y) => (y.lives - x.lives) || (y.score - x.score));
        const tied = rank[0].lives === rank[1].lives && rank[0].score === rank[1].score;
        result.winnerTeam = tied ? null : rank[0].team;
        result.ranking = rank;
      }
      st.result = result;
      return { type: "over", mode: st.mode, reason, winnerTeam: result.winnerTeam, cleared: !!result.cleared };
    }

    function explode(st, now) {
      const h = byId(st, st.holder);
      const t = st.teams[h.team];
      t.lives = Math.max(0, t.lives - 1);
      // 学べるように、本当は何が答えだったか(例)をいっしょに見せる
      const examples = T.candidates(st.topic, st.count, st.last, st.used).slice(0, 4);
      st.outcome = { type: "explode", pid: h.id, team: h.team, lives: t.lives, out: t.lives <= 0, count: st.count, need: st.need, examples };
      const ev = [{ type: "explode", pid: h.id, team: h.team, lives: t.lives, out: t.lives <= 0 }];
      st.starterId = nextSeat(st, idxOf(st, h.id), st.away).id;
      st.phase = "between";
      st.nextAt = now + BETWEEN_MS;
      st.holder = null;
      if (t.lives <= 0) ev.push(finish(st, now, st.mode === "coop" ? "coop_fail" : "team_out"));
      else if (st.mode === "vs" && st.round >= st.maxRounds) ev.push(finish(st, now, "rounds"));
      return ev;
    }

    /** 時間が来ていれば進める。起きたことを返す */
    function tick(st, now, rng = Math.random) {
      if (st.frozenAt) return [];                         // 全員の通信が切れている間は、時計を止める
      if (st.phase === "between" && now >= st.nextAt) return startRound(st, now, rng);
      if (st.phase === "play" && now > st.fuseEndsAt + GRACE_MS) return explode(st, now);
      return [];
    }

    function answer(st, pid, text, now, rng = Math.random) {
      if (st.phase !== "play") return { ok: false, reason: "not_playing", events: [] };
      if (pid !== st.holder) return { ok: false, reason: "not_your_turn", events: [] };
      if (st.sit.includes(pid)) return { ok: false, reason: "sit_out", events: [] };
      if (now > st.fuseEndsAt + GRACE_MS) return { ok: false, reason: "timeout", events: tick(st, now, rng) };
      const j = T.judge(st.topic, st.count, st.last, st.used, text);
      if (!j.ok) {
        return { ok: false, reason: j.reason, base: j.base, word: j.word, events: [{ type: "reject", pid, reason: j.reason, base: j.base, word: j.word }] };
      }
      const p = byId(st, pid);
      const t = st.teams[p.team];
      st.hint = null;                       // ヒントは「今の問題」のもの
      st.used.push(j.word);
      st.last = j.word;
      st.count += 1;
      p.score += POINT; t.score += POINT;
      p.correct += 1;
      if (st.count >= st.need) {
        p.score += BONUS; t.score += BONUS;
        st.defused += 1;
        st.outcome = { type: "defuse", pid, team: p.team, count: st.count, need: st.need, bonus: BONUS };
        st.starterId = nextSeat(st, idxOf(st, pid), st.away).id;
        st.phase = "between";
        st.nextAt = now + BETWEEN_MS;
        st.holder = null;
        const ev = [{ type: "accept", pid, team: p.team, word: j.word, count: st.count, need: st.need }, { type: "defuse", pid, team: p.team, bonus: BONUS }];
        if (st.mode === "coop" && st.defused >= st.goal) ev.push(finish(st, now, "coop_clear"));
        else if (st.mode === "vs" && st.round >= st.maxRounds) ev.push(finish(st, now, "rounds"));
        return { ok: true, word: j.word, events: ev };
      }
      const nxt = nextSeat(st, idxOf(st, pid), st.sit);
      st.holder = nxt.id;
      setPrompt(st);
      return { ok: true, word: j.word, events: [{ type: "accept", pid, team: p.team, word: j.word, count: st.count, need: st.need, next: nxt.id }] };
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
      const t = st.teams[p.team];
      p.score = Math.max(0, p.score - HINT_COST);
      t.score = Math.max(0, t.score - HINT_COST);
      st.hintUsed.push(pid);
      const first = word[0].toUpperCase();
      st.hint = { pid, round: st.round, count: st.count, first, len: word.length, text: first + " _".repeat(word.length - 1) };
      return { ok: true, events: [{ type: "hint", pid, team: p.team, cost: HINT_COST, len: word.length }] };
    }

    /** 次に tick が必要な時刻(なければ 0)。部屋(サーバー)のアラームに使う */
    /**
     * 友達対戦: 通信が切れた人は待たない。爆弾を持っていたら、減点も爆発もなしで次の人へ渡す。
     * 戻ってきても、その問題では爆弾を受けとれない。全員が切れたら、時計を止める。
     */
    function leave(st, pid, now) {
      if (!byId(st, pid)) return [];
      if (!st.away.includes(pid)) st.away.push(pid);
      if (st.away.length >= st.players.length) { if (!st.frozenAt) st.frozenAt = now; return []; }
      if (st.phase !== "play") return [];
      if (!st.sit.includes(pid)) st.sit.push(pid);
      const ev = [{ type: "left", pid }];
      if (st.holder === pid) {
        const nxt = nextSeat(st, idxOf(st, pid), st.sit);
        st.holder = nxt.id;
        setPrompt(st);
        ev.push({ type: "pass", pid, next: nxt.id });
      }
      return ev;
    }

    /** 戻った。止めていた時計を進める。この問題では爆弾を受けとれない(次の問題から) */
    function back(st, pid, now) {
      const i = st.away.indexOf(pid);
      if (i < 0) return [];
      st.away.splice(i, 1);
      if (st.frozenAt) {
        shift(st, Math.max(0, now - st.frozenAt));
        st.frozenAt = 0;
        if (st.phase === "play") {                      // 全員が切れていた間は、問題は進んでいない。最初に戻った人から続ける
          st.sit = st.away.slice();
          if (st.sit.includes(st.holder)) st.holder = nextSeat(st, idxOf(st, st.holder), st.sit).id;
          setPrompt(st);
        }
      }
      return [{ type: "back", pid }];
    }

    function nextDeadline(st) {
      if (st.frozenAt) return 0;
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

    return { newGame, tick, answer, hint, leave, back, nextDeadline, shift, view, needFor, byId, teamOf };
  }

  return { FUSE_MS, GRACE_MS, BETWEEN_MS, START_MS, TEAM_LIVES, COOP_GOAL, MAX_ROUNDS, POINT, BONUS, HINT_COST, NEED, DIFFICULTIES, MODES, TEAM_KEYS, needFor, create };
});
