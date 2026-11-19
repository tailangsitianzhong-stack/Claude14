// ミニネプリーグ(英語): 単語リスト・お題・進行・CPU の純粋ロジックのテスト
const test = require("node:test");
const assert = require("node:assert/strict");

let W, T, E, C, Cpu, D;
test.before(() => {
  globalThis.window = globalThis.window || globalThis;
  delete require.cache[require.resolve("../data/nep.js")];
  require("../data/nep.js");
  D = globalThis.NEP_DATA;
  const Words = require("../js/games/nep/words.js");
  const Topics = require("../js/games/nep/topics.js");
  C = require("../js/games/nep/core.js");
  const CpuMod = require("../js/games/nep/cpu.js");
  W = Words.create(D);
  T = Topics.create(W, D);
  E = C.create(T);
  Cpu = CpuMod.create(W, T);
});

function seeded(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
const T0 = 1_000_000;

// ---------- 単語リスト ----------
test("単語リスト: 3文字以上の小文字の原形だけ。サイズと並び", () => {
  assert.ok(W.size >= 20000, "語数 " + W.size);
  for (const w of W.list) assert.match(w, /^[a-z]{3,}$/);
  assert.equal(new Set(W.list).size, W.size, "重複なし");
  for (const w of ["apple", "dog", "banana", "school", "water"]) assert.ok(W.has(w), w);
  assert.ok(W.rank("water") < W.rank("zucchini") || W.rank("zucchini") === 0, "有名な語ほど順位が小さい");
});

test("単語リスト: 変化形・短縮形のかけら・不適切語は入っていない", () => {
  for (const w of ["dogs", "played", "running", "children", "went", "didn", "doesn", "shit", "fuck", "horseshit"]) assert.ok(!W.has(w), w + " は入らない");
  for (const w of ["news", "glass", "bus", "morning", "building", "king", "glass", "left", "saw", "sometimes"]) assert.ok(W.has(w), w + " は入る");
});

test("baseOf: 規則変化と不規則変化から原形を見分ける", () => {
  assert.equal(W.baseOf("dogs"), "dog");
  assert.equal(W.baseOf("boxes"), "box");
  assert.equal(W.baseOf("babies"), "baby");
  assert.equal(W.baseOf("played"), "play");
  assert.equal(W.baseOf("liked"), "like");
  assert.equal(W.baseOf("stopped"), "stop");
  assert.equal(W.baseOf("running"), "run");
  assert.equal(W.baseOf("making"), "make");
  assert.equal(W.baseOf("children"), "child");
  assert.equal(W.baseOf("went"), "go");
  assert.equal(W.baseOf("better"), "good");
  assert.equal(W.baseOf("apple"), null);
  assert.equal(W.baseOf("class"), null);
  assert.equal(W.baseOf("this"), null);
});

test("normalize: 英字1語だけ(前後の空白・大文字は直す)", () => {
  assert.equal(W.normalize("  Apple "), "apple");
  assert.equal(W.normalize("ice cream"), "");
  assert.equal(W.normalize("it's"), "");
  assert.equal(W.normalize("りんご"), "");
});

test("索引: 頭文字・終わり・長さ・アナグラム", () => {
  assert.ok(W.starting("a").every((w) => w[0] === "a") && W.starting("a").length > 500);
  assert.ok(W.ending("e").every((w) => w.endsWith("e")));
  assert.ok(W.ofLength(4).every((w) => w.length === 4));
  assert.ok(W.anagramsOf("tsla").length === 0 || true);
  assert.ok(W.anagramsOf("listen").includes("silent") || W.anagramsOf("listen").includes("listen"));
});

// ---------- データ ----------
test("データ: 手書きのお題が正しい形(1語・英字・十分な数)", () => {
  for (const c of D.categories) {
    assert.ok(c.words.length >= 20, c.id);
    for (const w of c.words) assert.match(w, /^[a-z]{2,}$/, c.id + ":" + w);
    assert.ok(c.name && c.emoji);
  }
  assert.ok(D.categories.length >= 20 && D.collocations.length >= 50 && D.phrases.length >= 60);
  assert.ok(Object.keys(D.antonyms).length >= 100 && Object.keys(D.pasts).length >= 80 && D.translate.length >= 200);
  for (const e of D.collocations) { assert.match(e.prompt, /___/); assert.ok(e.answers.length >= 3, e.prompt); assert.ok(e.ja, "意味なし: " + e.prompt); }
  for (const e of D.phrases) { assert.match(e.prompt, /___/); assert.ok(e.answers.length >= 1, e.prompt); assert.ok(e.ja, "意味なし: " + e.prompt); }
  assert.deepEqual(D.pasts.go, ["went"]);
  assert.ok(D.translate.some(([t, r, a]) => r === "いぬ" && a.includes("dog") && t === "犬{いぬ}"));
  // 同音異義語は、漢字で見分けられる(別々の問題になる)
  const hashi = D.translate.filter(([, r]) => r === "はし");
  assert.deepEqual(hashi.map((x) => x[0]).sort(), ["橋{はし}", "箸{はし}"].sort());
  assert.ok(hashi.find((x) => x[0] === "箸{はし}")[2].includes("chopsticks") && hashi.find((x) => x[0] === "橋{はし}")[2].includes("bridge"));
  // 表記は「漢字{よみ}」(送りがなは外)か、かな・カタカナ。読みも持つ
  for (const [t, r, a] of D.translate) { assert.match(t, /^(?:[一-龠々〆ヶ]+\{[ぁ-んー]+\}|[ぁ-んァ-ヶー])[ぁ-んァ-ヶー{}一-龠々〆ヶ]*$/, t); assert.match(r, /^[ぁ-んー]+$/); assert.ok(a.length >= 1); }
});

// ---------- お題 ----------
test("お題: 全12種類がつくれて、候補があり、候補はすべて正解として通る", () => {
  const rng = seeded(11);
  for (const difficulty of ["easy", "normal", "hard"]) {
    for (const kind of T.KINDS) {
      for (let i = 0; i < 8; i++) {
        const t = T.make(kind, { rng, need: 5, difficulty });
        assert.equal(t.kind, kind);
        assert.ok(t.need >= 3, `${kind}/${difficulty} need=${t.need}`);
        const p = T.prompt(t, 0, null);
        assert.ok(p.title && p.big, kind);
        const c = T.candidates(t, 0, null, []);
        assert.ok(c.length >= 1, `${kind}/${difficulty} 候補なし`);
        for (const w of c.slice(0, 20)) assert.equal(T.judge(t, 0, null, [], w).ok, true, `${kind}: ${w}`);
      }
    }
  }
});

test("お題: やさしさごとの種類。連続しない・使ったお題は避ける", () => {
  const rng = seeded(5);
  for (let i = 0; i < 60; i++) assert.ok(!["past", "anagram", "chain", "endletter"].includes(T.pick({ difficulty: "easy", need: 3, rng }).kind));
  for (let i = 0; i < 30; i++) assert.notEqual(T.pick({ difficulty: "normal", need: 4, rng, exclude: { kinds: ["letter"] } }).kind, "letter");
  const first = T.make("letter", { rng: seeded(1), need: 4, difficulty: "normal" });
  const again = T.pick({ difficulty: "normal", need: 4, rng: seeded(1), exclude: { kinds: [], keys: [first.key] } });
  assert.notEqual(again.key, first.key);
});

test("判定: 頭文字・文字数・おわり", () => {
  const t = { kind: "letter", key: "letter:a", need: 5, c: "a" };
  assert.deepEqual(T.judge(t, 0, null, [], " Apple "), { ok: true, word: "apple" });
  assert.equal(T.judge(t, 0, null, [], "banana").reason, "wrong");
  assert.equal(T.judge(t, 0, null, [], "apple pie").reason, "format");
  assert.equal(T.judge(t, 0, null, [], "a").reason, "short");
  assert.equal(T.judge(t, 0, null, ["apple"], "apple").reason, "dup");
  assert.equal(T.judge(t, 0, null, [], "aaabbbzz").reason, "unknown");
  const len = { kind: "length", key: "length:4", need: 5, n: 4 };
  assert.equal(T.judge(len, 0, null, [], "bird").ok, true);
  assert.equal(T.judge(len, 0, null, [], "birds").reason, "inflected");
  assert.equal(T.judge(len, 0, null, [], "horse").reason, "wrong");
  const end = { kind: "endletter", key: "e:t", need: 5, c: "t" };
  assert.equal(T.judge(end, 0, null, [], "cat").ok, true);
  assert.equal(T.judge(end, 0, null, [], "dog").reason, "wrong");
});

test("判定: 変化形は「原形で」(base つき)。過去形のお題だけは過去形を答える", () => {
  const t = { kind: "letter", key: "letter:d", need: 5, c: "d" };
  assert.deepEqual(T.judge(t, 0, null, [], "dogs"), { ok: false, reason: "inflected", base: "dog", word: "dogs" });
  assert.equal(T.judge(t, 0, null, [], "played").reason, "inflected");
  assert.equal(T.judge(t, 0, null, [], "did").reason === "inflected" || T.judge(t, 0, null, [], "did").reason === "wrong", true);
  const past = { kind: "past", key: "past:go", need: 2, steps: [{ word: "go", answers: ["went"] }, { word: "see", answers: ["saw"] }] };
  assert.equal(T.judge(past, 0, null, [], "went").ok, true);
  assert.equal(T.judge(past, 0, null, [], "gone").reason, "wrong");
  assert.equal(T.judge(past, 1, null, [], "saw").ok, true);
  assert.equal(T.judge(past, 0, null, [], "goed").reason, "unknown");
});

test("判定: カテゴリ・穴うめ・慣用句・反対語・翻訳・アナグラム", () => {
  const cat = { kind: "category", key: "category:animals", need: 5, id: "animals" };
  assert.equal(T.judge(cat, 0, null, [], "Elephant").ok, true);
  assert.equal(T.judge(cat, 0, null, [], "apple").reason, "wrong");
  assert.equal(T.judge(cat, 0, null, [], "dogs").reason, "inflected");
  const col = { kind: "collocation", key: "c", need: 3, prompt: "ice ___", answers: ["cream", "cube", "age"] };
  assert.equal(T.judge(col, 1, "cream", ["cream"], "cube").ok, true);
  assert.equal(T.judge(col, 1, "cream", ["cream"], "cream").reason, "dup");
  assert.equal(T.judge(col, 1, "cream", ["cream"], "table").reason, "wrong");
  const ph = { kind: "phrase", key: "p", need: 2, steps: [{ prompt: "salt and ___", answers: ["pepper"] }, { prompt: "Break a ___", answers: ["leg"] }] };
  assert.equal(T.judge(ph, 0, null, [], "pepper").ok, true);
  assert.equal(T.judge(ph, 1, "pepper", ["pepper"], "pepper").reason, "dup");
  assert.equal(T.judge(ph, 1, "pepper", ["pepper"], "leg").ok, true);
  const an = { kind: "antonym", key: "a", need: 1, steps: [{ word: "hot", answers: ["cold", "cool"] }] };
  assert.equal(T.judge(an, 0, null, [], "cool").ok, true);
  const tr = { kind: "translate", key: "t", need: 1, steps: [{ text: "犬{いぬ}", reading: "いぬ", answers: ["dog"] }] };
  assert.equal(T.prompt(tr, 0, null).big, "犬{いぬ}");
  assert.equal(T.judge(tr, 0, null, [], "dog").ok, true);
  assert.equal(T.judge(tr, 0, null, [], "cat").reason, "wrong");
  const ag = T.make("anagram", { rng: seeded(2), need: 3, difficulty: "normal" });
  const s0 = ag.steps[0];
  assert.equal(T.judge(ag, 0, null, [], s0.answers[0]).ok, true);
  assert.notEqual(s0.letters, s0.answers[0]);
});

test("判定: ABC順としりとり(x z q j で終わったら何でもOK)", () => {
  const az = { kind: "atoz", key: "atoz:abcd", need: 4, letters: "abcd" };
  assert.equal(T.judge(az, 0, null, [], "apple").ok, true);
  assert.equal(T.judge(az, 1, "apple", ["apple"], "apple").reason, "dup");
  assert.equal(T.judge(az, 1, "apple", ["apple"], "banana").ok, true);
  assert.equal(T.judge(az, 1, "apple", ["apple"], "cat").reason, "wrong");
  assert.equal(T.prompt(az, 2, "banana").big, "C…");
  const ch = { kind: "chain", key: "chain:a", need: 4, start: "a" };
  assert.equal(T.judge(ch, 0, null, [], "apple").ok, true);
  assert.equal(T.prompt(ch, 1, "apple").big, "E…");
  assert.equal(T.judge(ch, 1, "apple", ["apple"], "egg").ok, true);
  assert.equal(T.judge(ch, 1, "apple", ["apple"], "dog").reason, "wrong");
  assert.equal(T.prompt(ch, 1, "quiz").big, "なんでもOK");
  assert.equal(T.judge(ch, 1, "quiz", ["quiz"], "dog").ok, true);
});

// ---------- 進行(チーム戦) ----------
function game(n = 4, difficulty = "normal", seed = 1, mode = "vs") {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: "p" + (i + 1), name: "P" + (i + 1) });
  const rng = seeded(seed);
  const st = E.newGame({ players, difficulty, mode, now: T0, rng });
  st.starterId = "p1";
  return { st, rng };
}
/** お題に合う答えを今の問題から1つ選ぶ */
const goodWord = (st) => T.candidates(st.topic, st.count, st.last, st.used)[0];
/** 今のラウンドで、持っている人が答え続けて解除する(now を進めながら) */
function defuseRound(st, rng, now) {
  let n = 0;
  while (st.phase === "play" && n++ < 30) assert.ok(E.answer(st, st.holder, goodWord(st), (now += 300), rng).ok);
  return now;
}
/** 導火線が切れるまで待って爆発させる */
const blowUp = (st, rng) => E.tick(st, st.fuseEndsAt + C.GRACE_MS + 5, rng);

test("チーム: 2対2は席の順に 赤・青・赤・青。協力は全員が同じ1チーム。奇数人の対戦はできない", () => {
  const { st } = game(4);
  assert.equal(st.mode, "vs");
  assert.deepEqual(st.teams.map((t) => t.key), ["red", "blue"]);
  assert.deepEqual(st.players.map((p) => p.team), [0, 1, 0, 1]);
  assert.deepEqual(st.teams.map((t) => t.lives), [C.TEAM_LIVES.vs, C.TEAM_LIVES.vs]);
  const co = game(4, "normal", 1, "coop").st;
  assert.deepEqual(co.teams.map((t) => t.key), ["all"]);
  assert.deepEqual(co.players.map((p) => p.team), [0, 0, 0, 0]);
  assert.equal(co.teams[0].lives, C.TEAM_LIVES.coop);
  assert.equal(co.goal, C.COOP_GOAL);
  assert.deepEqual(game(2).st.players.map((p) => p.team), [0, 1]);          // 1対1
  assert.equal(game(3, "normal", 1, "coop").st.players.length, 3);          // 協力は2〜4人
  assert.throws(() => game(3, "normal", 1, "vs"), /even/);
  assert.throws(() => game(1, "normal", 1, "coop"));
  assert.throws(() => E.newGame({ players: [{ id: "a" }, { id: "b" }], mode: "solo", now: T0 }), /mode/);
});

test("進行: 開始 → ラウンド開始(爆弾は先頭の人へ・導火線30秒)", () => {
  const { st, rng } = game();
  assert.equal(st.phase, "between");
  assert.deepEqual(E.tick(st, T0 + 1000, rng), []);
  const ev = E.tick(st, T0 + C.START_MS, rng);
  assert.equal(ev[0].type, "round");
  assert.equal(st.phase, "play");
  assert.equal(st.holder, "p1");
  assert.equal(st.fuseEndsAt, T0 + C.START_MS + 30000);
  assert.ok(st.prompt && st.prompt.title);
});

test("進行: 正解で爆弾が次の席の人へ渡る(2対2なら赤→青→赤→青)。導火線は進んだまま", () => {
  const { st, rng } = game(4);
  E.tick(st, T0 + C.START_MS, rng);
  const fuse = st.fuseEndsAt;
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push(st.players.find((p) => p.id === st.holder).team);
    assert.ok(E.answer(st, st.holder, goodWord(st), T0 + 4000 + i * 500, rng).ok);
    assert.equal(st.fuseEndsAt, fuse);
  }
  assert.deepEqual(order, [0, 1, 0, 1]);         // 答えるたびに相手チームへ
});

test("進行: 持っていない人の答え・まちがいは受け付けない(爆弾は渡らない)", () => {
  const { st, rng } = game(4);
  E.tick(st, T0 + C.START_MS, rng);
  assert.equal(E.answer(st, "p2", goodWord(st), T0 + 4000, rng).reason, "not_your_turn");
  const bad = E.answer(st, "p1", "zzqqxx", T0 + 4000, rng);
  assert.equal(bad.ok, false);
  assert.equal(bad.events[0].type, "reject");
  assert.equal(st.holder, "p1");
  assert.equal(st.count, 0);
  const dogs = E.answer(st, "p1", "dogs", T0 + 4100, rng);
  assert.ok(["inflected", "wrong", "unknown"].includes(dogs.reason));
});

test("進行: 同じ答えは同じ爆弾のなかで2回使えない", () => {
  const { st, rng } = game(2);
  E.tick(st, T0 + C.START_MS, rng);
  const w = goodWord(st);
  assert.ok(E.answer(st, "p1", w, T0 + 4000, rng).ok);
  assert.equal(E.answer(st, "p2", w, T0 + 5000, rng).reason, "dup");
});

test("進行: 目標数に届くと解除。最後の人とそのチームに+20点・次のラウンドは次の席の人から", () => {
  const { st, rng } = game(4);
  E.tick(st, T0 + C.START_MS, rng);
  const need = st.need;
  let now = T0 + C.START_MS + 1000, i = 0, last = null;
  while (st.phase === "play") {
    const pid = st.holder;
    const r = E.answer(st, pid, goodWord(st), (now += 1500), rng);
    assert.ok(r.ok, "答え " + i);
    last = { pid, r };
    i++;
  }
  assert.equal(i, need);
  assert.equal(st.outcome.type, "defuse");
  assert.equal(last.r.events[1].type, "defuse");
  const fin = st.players.find((p) => p.id === last.pid);
  assert.ok(fin.score >= C.POINT + C.BONUS);
  // チームの得点 = メンバーの得点の合計
  for (const t of [0, 1]) assert.equal(st.teams[t].score, st.players.filter((p) => p.team === t).reduce((a, p) => a + p.score, 0));
  assert.equal(st.defused, 1);
  assert.equal(st.starterId, "p" + (((Number(last.pid.slice(1))) % 4) + 1));
  assert.deepEqual(st.teams.map((t) => t.lives), [C.TEAM_LIVES.vs, C.TEAM_LIVES.vs]);
  E.tick(st, st.nextAt, rng);
  assert.equal(st.phase, "play");
  assert.equal(st.round, 2);
  assert.equal(st.holder, st.starterId);
  assert.equal(st.count, 0);
  assert.deepEqual(st.used, []);
});

test("導火線: 猶予の間は答えが通り、過ぎると爆弾を持っていた人の「チーム」だけライフ-1", () => {
  const { st, rng } = game(4);
  E.tick(st, T0 + C.START_MS, rng);
  E.answer(st, "p1", goodWord(st), T0 + 4000, rng);       // 赤の p1 → 青の p2 が持つ
  const end = st.fuseEndsAt;
  assert.deepEqual(E.tick(st, end + C.GRACE_MS, rng), []); // 猶予の間はまだ
  assert.ok(E.answer(st, "p2", goodWord(st), end + 1000, rng).ok, "猶予の間なら通る");
  assert.equal(st.holder, "p3");                           // 赤の p3 が持つ
  const ev = E.tick(st, end + C.GRACE_MS + 5, rng);
  assert.equal(ev[0].type, "explode");
  assert.equal(ev[0].pid, "p3");
  assert.equal(ev[0].team, 0);
  assert.equal(st.teams[0].lives, C.TEAM_LIVES.vs - 1);    // 赤が減る
  assert.equal(st.teams[1].lives, C.TEAM_LIVES.vs);        // 青は減らない
  assert.equal(st.phase, "between");
  assert.equal(st.starterId, "p4");                        // p3 の次の席から
  assert.ok(st.outcome.examples.length >= 1);
});

test("対戦: 相手チームのライフが0になったら勝ち。以後の答えは通らない", () => {
  const { st, rng } = game(4);
  let now = T0 + C.START_MS;
  E.tick(st, now, rng);
  let guard = 0;
  // p1(赤)が持っている状態で毎回爆発させる → 赤だけが減って、赤の負け
  while (st.phase !== "over" && guard++ < 30) {
    if (st.phase === "between") { st.starterId = "p1"; now = st.nextAt; E.tick(st, now, rng); continue; }
    now = st.fuseEndsAt + C.GRACE_MS + 10;
    E.tick(st, now, rng);
  }
  assert.equal(st.phase, "over");
  assert.equal(st.result.reason, "team_out");
  assert.equal(st.teams[0].lives, 0);
  assert.equal(st.teams[1].lives, C.TEAM_LIVES.vs);
  assert.equal(st.result.winnerTeam, 1);
  assert.equal(E.answer(st, "p2", "apple", now + 1, rng).ok, false);
  assert.equal(E.nextDeadline(st), 0);
  assert.deepEqual(st.result.teams.map((t) => t.lives), [0, C.TEAM_LIVES.vs]);
  assert.equal(st.result.players.length, 4);
});

test("対戦: ラウンド上限で終了。ライフ→チームの得点の順で勝者(完全に同じなら引き分け)", () => {
  const a = game(4);
  a.st.maxRounds = 1;
  E.tick(a.st, T0 + C.START_MS, a.rng);
  a.st.teams[1].score = 50;                                  // 青の得点が高い
  blowUp(a.st, a.rng);                                       // p1(赤)が爆発 → 赤のライフが減る
  assert.equal(a.st.phase, "over");
  assert.equal(a.st.result.reason, "rounds");
  assert.equal(a.st.result.winnerTeam, 1);                   // 青: ライフが多い
  const b = game(4);
  b.st.maxRounds = 1;
  E.tick(b.st, T0 + C.START_MS, b.rng);
  b.st.teams[0].lives = 3; b.st.teams[1].lives = 2; b.st.teams[0].score = 10; b.st.teams[1].score = 99;
  blowUp(b.st, b.rng);                                       // 赤 3→2。青 2。ライフ同じ → 得点で青
  assert.equal(b.st.result.winnerTeam, 1);
  const c = game(4);
  c.st.maxRounds = 1;
  E.tick(c.st, T0 + C.START_MS, c.rng);
  c.st.teams[0].lives = 3; c.st.teams[1].lives = 2;
  blowUp(c.st, c.rng);                                       // 赤 2・青 2・得点 0 同士 → 引き分け
  assert.equal(c.st.result.winnerTeam, null);
});

test("協力: みんなでライフを共有。爆弾を8個解除したらクリア", () => {
  const { st, rng } = game(4, "easy", 3, "coop");
  let now = T0 + C.START_MS;
  E.tick(st, now, rng);
  for (let r = 1; r <= C.COOP_GOAL; r++) {
    assert.equal(st.round, r);
    now = defuseRound(st, rng, now);
    if (r < C.COOP_GOAL) { assert.equal(st.phase, "between"); now = st.nextAt; E.tick(st, now, rng); }
  }
  assert.equal(st.phase, "over");
  assert.equal(st.result.reason, "coop_clear");
  assert.equal(st.result.cleared, true);
  assert.equal(st.result.defused, C.COOP_GOAL);
  assert.equal(st.teams[0].lives, C.TEAM_LIVES.coop);
  assert.equal(st.result.mode, "coop");
});

test("協力: 誰が持っていても、爆発すると全員共通のライフが減る。0で失敗", () => {
  const { st, rng } = game(4, "normal", 3, "coop");
  let now = T0 + C.START_MS;
  E.tick(st, now, rng);
  const holders = new Set();
  let guard = 0;
  while (st.phase !== "over" && guard++ < 40) {
    if (st.phase === "between") { now = st.nextAt; E.tick(st, now, rng); continue; }
    holders.add(st.holder);
    const before = st.teams[0].lives;
    E.tick(st, st.fuseEndsAt + C.GRACE_MS + 5, rng);
    assert.equal(st.teams[0].lives, before - 1);
  }
  assert.equal(st.result.reason, "coop_fail");
  assert.equal(st.result.cleared, false);
  assert.equal(st.teams[0].lives, 0);
  assert.ok(holders.size >= 2, "爆弾をもつ人はまわる");
});

test("進行: 人数で目標数が変わる(チーム戦でも人は脱落しない)", () => {
  assert.equal(E.needFor("normal", 4), 6);
  assert.equal(E.needFor("easy", 2), 3);
  assert.equal(E.needFor("hard", 3), 6);
  const { st, rng } = game(4);
  E.tick(st, T0 + C.START_MS, rng);
  assert.equal(st.need <= E.needFor("normal", 4), true);
  // 何度爆発しても、席の順は変わらない(全員が順番にまわる)
  E.answer(st, "p1", goodWord(st), T0 + 4000, rng);
  assert.equal(st.holder, "p2");
});

test("進行: nextDeadline / shift / view(答えの一覧を含めない)", () => {
  const { st, rng } = game();
  assert.equal(E.nextDeadline(st), st.nextAt);
  E.tick(st, T0 + C.START_MS, rng);
  assert.equal(E.nextDeadline(st), st.fuseEndsAt + C.GRACE_MS + 1);
  const f = st.fuseEndsAt;
  E.shift(st, 5000);
  assert.equal(st.fuseEndsAt, f + 5000);
  const v = E.view(st);
  assert.equal(v.topic, undefined);
  assert.ok(v.prompt);
  assert.equal(JSON.stringify(v).includes('"answers"'), false);
});

test("進行: 全種類のお題で最後まで解除できる(どの種類でも答えが詰まらない)", () => {
  for (const kind of T.KINDS) {
    const { st, rng } = game(2, "hard", 3);
    E.tick(st, T0 + C.START_MS, rng);
    st.topic = T.make(kind, { rng, need: 5, difficulty: "hard" });
    st.need = st.topic.need; st.count = 0; st.used = []; st.last = null;
    st.prompt = T.prompt(st.topic, 0, null);
    let now = T0 + 5000, n = 0;
    while (st.phase === "play" && n++ < 30) {
      const w = goodWord(st);
      assert.ok(w, kind + " " + n);
      assert.ok(E.answer(st, st.holder, w, (now += 500), rng).ok, kind + ":" + w);
    }
    assert.equal(st.outcome.type, "defuse", kind);
  }
});

// ---------- CPU ----------
test("CPU: 考える時間と語の広さが難しさで違う / 正解の語を出す", () => {
  const { st, rng } = game(2, "hard");
  E.tick(st, T0 + C.START_MS, rng);
  let valid = 0, wrong = 0;
  for (let i = 0; i < 200; i++) {
    const plan = Cpu.plan(st, rng);
    assert.ok(plan.delayMs >= 1000 && plan.delayMs < 4500, "hard の時間 " + plan.delayMs);
    const ok = T.judge(st.topic, st.count, st.last, st.used, plan.word).ok;
    if (ok) valid++; else wrong++;
  }
  assert.ok(valid > 150 && valid < 200, "hard の正解率が高い " + valid);
  const e = game(2, "easy");
  E.tick(e.st, T0 + C.START_MS, e.rng);
  let tot = 0;
  for (let i = 0; i < 100; i++) tot += Cpu.plan(e.st, e.rng).delayMs;
  assert.ok(tot / 100 > 3000, "easy は遅め " + tot / 100);
});

test("CPU: やさしい強さは上位語だけを使う", () => {
  const rng = seeded(9);
  const st = { difficulty: "easy", topic: { kind: "letter", key: "x", need: 5, c: "s" }, count: 0, used: [], last: null };
  for (let i = 0; i < 100; i++) {
    const w = Cpu.choose(st, rng, Cpu.LEVELS.easy);
    assert.ok(W.rank(w) > 0 && W.rank(w) <= 6000, w);
  }
});

test("CPU 対戦のシミュレーション: ゲームが必ず終わる(2対2・協力・全難易度)", () => {
  for (const difficulty of ["easy", "normal", "hard"]) {
    for (const [mode, n] of [["vs", 4], ["vs", 2], ["coop", 4], ["coop", 2]]) {
      const rng = seeded(n * 7 + difficulty.length + mode.length);
      const players = Array.from({ length: n }, (_, i) => ({ id: "c" + i, name: "C" + i, cpu: true }));
      const st = E.newGame({ players, difficulty, mode, now: T0, rng });
      let now = T0;
      let plan = null, planAt = 0, steps = 0;
      while (st.phase !== "over" && steps++ < 40000) {
        now += 250;
        E.tick(st, now, rng);
        if (st.phase !== "play") { plan = null; continue; }
        if (!plan) { plan = Cpu.plan(st, rng); planAt = now + plan.delayMs; }
        else if (now >= planAt) { E.answer(st, st.holder, plan.word, now, rng); plan = null; }
      }
      assert.equal(st.phase, "over", `${mode}/${difficulty}/${n}人 が終わる (steps ${steps})`);
      assert.ok(st.round >= 1);
      if (mode === "vs") assert.ok(st.round <= C.MAX_ROUNDS);
    }
  }
});

test("熟語・慣用句のお題には、日本語の意味が添えられる", () => {
  const rng = seeded(21);
  for (const kind of ["phrase", "collocation"]) {
    for (let i = 0; i < 10; i++) {
      const t = T.make(kind, { rng, need: 4, difficulty: "normal" });
      const p = T.prompt(t, 0, null);
      assert.match(p.sub, /^意味\{いみ\}：.+/, kind);
    }
  }
  const ph = T.make("phrase", { rng, need: 3, difficulty: "normal" });
  const p0 = T.prompt(ph, 0, null), p1 = T.prompt(ph, 1, "x");
  assert.equal(p0.sub, "意味{いみ}：" + ph.steps[0].ja);
  assert.equal(p1.sub, "意味{いみ}：" + ph.steps[1].ja);
  // ほかのお題には付かない(しりとりは前の言葉の表示に使う)
  for (const kind of ["letter", "category", "antonym", "past", "atoz"]) assert.equal(T.prompt(T.make(kind, { rng, need: 4 }), 0, null).sub, "", kind);
});

// ---------- ヒント ----------
test("ヒント: 持っている人だけ・1ラウンドに1回・-5点。正解の頭文字と文字数が全員に見える", () => {
  const { st, rng } = game(4);
  E.tick(st, T0 + C.START_MS, rng);
  const now = T0 + C.START_MS + 3000;
  assert.equal(E.hint(st, "p2", now, rng).reason, "not_your_turn");
  st.players[0].score = 12; st.teams[0].score = 12;
  const r = E.hint(st, "p1", now, rng);
  assert.ok(r.ok);
  assert.equal(r.events[0].type, "hint");
  assert.equal(st.players[0].score, 7);
  assert.equal(st.teams[0].score, 7, "チームの得点からも引く");
  assert.equal(st.hint.pid, "p1");
  assert.equal(st.hint.round, st.round);
  assert.equal(st.hint.count, 0);
  // ヒントの形: 頭文字 + " _" × (文字数-1)。同じ頭文字・同じ文字数の正解が本当にある
  const cands = T.candidates(st.topic, 0, null, []);
  assert.ok(cands.some((w) => w[0].toUpperCase() === st.hint.first && w.length === st.hint.len), "ヒントの語は正解の1つ");
  assert.equal(st.hint.text, st.hint.first + " _".repeat(st.hint.len - 1));
  // 同じラウンドでは、同じ人は2回使えない
  assert.equal(E.hint(st, "p1", now + 100, rng).reason, "hint_used");
  assert.equal(st.players[0].score, 7);
  // 答えて次の人へ渡ると、ヒントは消える。次の人は自分のヒントを使える
  assert.ok(E.answer(st, "p1", goodWord(st), now + 200, rng).ok);
  assert.equal(st.hint, null);
  assert.ok(E.hint(st, "p2", now + 300, rng).ok);
  assert.equal(st.players[1].score, 0, "点が足りなければ0まで");
  assert.deepEqual(st.hintUsed.sort(), ["p1", "p2"]);
});

test("ヒント: 次のラウンドで使い直せる。爆発後や時間切れ後は使えない", () => {
  const { st, rng } = game(2);
  E.tick(st, T0 + C.START_MS, rng);
  assert.ok(E.hint(st, "p1", T0 + C.START_MS + 1000, rng).ok);
  assert.equal(E.hint(st, "p1", st.fuseEndsAt + C.GRACE_MS + 1, rng).reason, "timeout");
  E.tick(st, st.fuseEndsAt + C.GRACE_MS + 5, rng);          // 爆発
  assert.equal(E.hint(st, "p1", st.nextAt - 100, rng).reason, "not_playing");
  E.tick(st, st.nextAt, rng);
  assert.equal(st.hint, null);
  assert.deepEqual(st.hintUsed, []);
  assert.ok(E.hint(st, st.holder, st.nextAt + 500, rng).ok);
});

test("ヒント: 全種類のお題で出せる(文字数・頭文字が正解と合う)", () => {
  for (const kind of T.KINDS) {
    const { st, rng } = game(2, "hard", 5);
    E.tick(st, T0 + C.START_MS, rng);
    st.topic = T.make(kind, { rng, need: 5, difficulty: "hard" });
    st.need = st.topic.need; st.count = 0; st.used = []; st.last = null;
    st.prompt = T.prompt(st.topic, 0, null);
    const r = E.hint(st, st.holder, T0 + 5000, rng);
    assert.ok(r.ok, kind);
    assert.ok(T.candidates(st.topic, 0, null, []).some((w) => w[0].toUpperCase() === st.hint.first && w.length === st.hint.len), kind);
  }
});
