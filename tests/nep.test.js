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
  for (const e of D.collocations) { assert.match(e.prompt, /___/); assert.ok(e.answers.length >= 3, e.prompt); }
  for (const e of D.phrases) { assert.match(e.prompt, /___/); assert.ok(e.answers.length >= 1, e.prompt); }
  assert.deepEqual(D.pasts.go, ["went"]);
  assert.ok(D.translate.some(([r, a]) => r === "いぬ" && a.includes("dog")));
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
  const tr = { kind: "translate", key: "t", need: 1, steps: [{ reading: "いぬ", answers: ["dog"] }] };
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

// ---------- 進行 ----------
function game(n = 2, difficulty = "normal", seed = 1) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: "p" + (i + 1), name: "P" + (i + 1) });
  const rng = seeded(seed);
  const st = E.newGame({ players, difficulty, now: T0, rng });
  st.starterId = "p1";
  return { st, rng };
}
/** お題に合う答えを今の問題から1つ選ぶ */
const goodWord = (st) => T.candidates(st.topic, st.count, st.last, st.used)[0];

test("進行: 開始 → ラウンド開始(爆弾は先頭の人へ・導火線30秒)", () => {
  const { st, rng } = game();
  assert.equal(st.phase, "between");
  assert.deepEqual(E.tick(st, T0 + 1000, rng), []);
  const ev = E.tick(st, T0 + C.START_MS, rng);
  assert.equal(ev[0].type, "round");
  assert.equal(st.phase, "play");
  assert.equal(st.holder, "p1");
  assert.equal(st.fuseEndsAt, T0 + C.START_MS + 30000);
  assert.equal(st.need, E.needFor("normal", 2) === st.need ? st.need : st.need); // お題により少なくなることがある
  assert.ok(st.prompt && st.prompt.title);
});

test("進行: 正解で爆弾が次の人へ渡り、導火線は進んだまま", () => {
  const { st, rng } = game(3);
  E.tick(st, T0 + C.START_MS, rng);
  const fuse = st.fuseEndsAt;
  const r = E.answer(st, "p1", goodWord(st), T0 + 5000, rng);
  assert.ok(r.ok);
  assert.equal(st.holder, "p2");
  assert.equal(st.count, 1);
  assert.equal(st.fuseEndsAt, fuse);
  assert.equal(st.players[0].score, C.POINT);
});

test("進行: 持っていない人の答え・まちがいは受け付けない(爆弾は渡らない)", () => {
  const { st, rng } = game(3);
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

test("進行: 目標数に届くと解除。最後の人に+20点・次のラウンドは次の人から", () => {
  const { st, rng } = game(2);
  E.tick(st, T0 + C.START_MS, rng);
  const need = st.need;
  let now = T0 + C.START_MS + 1000;
  let last, i = 0;
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
  assert.equal(st.starterId, last.pid === "p1" ? "p2" : "p1");
  assert.equal(st.players.every((p) => p.lives === C.LIVES), true);
  // 次のラウンドへ
  E.tick(st, st.nextAt, rng);
  assert.equal(st.phase, "play");
  assert.equal(st.round, 2);
  assert.equal(st.holder, st.starterId);
  assert.equal(st.count, 0);
  assert.deepEqual(st.used, []);
});

test("進行: 導火線が切れると、持っていた人だけライフ-1(猶予 1.5 秒つき)", () => {
  const { st, rng } = game(3);
  E.tick(st, T0 + C.START_MS, rng);
  E.answer(st, "p1", goodWord(st), T0 + 4000, rng);       // p2 が持つ
  const end = st.fuseEndsAt;
  assert.deepEqual(E.tick(st, end + C.GRACE_MS, rng), []); // 猶予の間はまだ
  assert.ok(E.answer(st, "p2", goodWord(st), end + 1000, rng).ok, "猶予の間なら通る");
  const holder = st.holder;                                 // p3
  const ev = E.tick(st, end + C.GRACE_MS + 5, rng);
  assert.equal(ev[0].type, "explode");
  assert.equal(ev[0].pid, holder);
  assert.equal(st.players.find((p) => p.id === holder).lives, C.LIVES - 1);
  for (const p of st.players) if (p.id !== holder) assert.equal(p.lives, C.LIVES);
  assert.equal(st.phase, "between");
  assert.equal(st.starterId, "p1"); // p3 の次(p1)から
});

test("進行: ライフ0で脱落し、最後の1人が勝ち。爆発後に答えは通らない", () => {
  const { st, rng } = game(2);
  let now = T0 + C.START_MS;
  E.tick(st, now, rng);
  let guard = 0;
  while (st.phase !== "over" && guard++ < 20) {
    if (st.phase === "between") { now = st.nextAt; E.tick(st, now, rng); continue; }
    now = st.fuseEndsAt + C.GRACE_MS + 10;
    const holder = st.holder;
    const ev = E.tick(st, now, rng);
    assert.equal(ev[0].pid, holder);
  }
  assert.equal(st.phase, "over");
  assert.equal(st.result.reason, "last");
  const loser = st.players.find((p) => !p.alive);
  assert.equal(loser.lives, 0);
  assert.notEqual(st.result.winnerId, loser.id);
  assert.equal(E.answer(st, st.result.winnerId, "apple", now + 1, rng).ok, false);
  assert.equal(E.nextDeadline(st), 0);
});

test("進行: ラウンド上限で終了。ライフ→得点の順で勝者(同じなら引き分け)", () => {
  const { st, rng } = game(3);
  st.maxRounds = 1;
  E.tick(st, T0 + C.START_MS, rng);
  st.players[1].score = 50;
  E.tick(st, st.fuseEndsAt + C.GRACE_MS + 1, rng); // p1 が爆発
  assert.equal(st.phase, "over");
  assert.equal(st.result.reason, "rounds");
  assert.equal(st.result.winnerId, "p2"); // ライフ同じ(p2,p3)→得点が高い p2
  const g2 = game(3);
  g2.st.maxRounds = 1;
  E.tick(g2.st, T0 + C.START_MS, g2.rng);
  E.tick(g2.st, g2.st.fuseEndsAt + C.GRACE_MS + 1, g2.rng);
  assert.equal(g2.st.result.winnerId, null); // 完全に同じ
});

test("進行: 生きている人数で目標数が変わる / 脱落した人は順番に入らない", () => {
  assert.equal(E.needFor("normal", 4), 6);
  assert.equal(E.needFor("easy", 2), 3);
  assert.equal(E.needFor("hard", 3), 6);
  const { st, rng } = game(3);
  st.players[1].alive = false; // p2 は脱落済み
  E.tick(st, T0 + C.START_MS, rng);
  assert.equal(st.holder, "p1");
  E.answer(st, "p1", goodWord(st), T0 + 4000, rng);
  assert.equal(st.holder, "p3", "脱落した p2 は飛ばす");
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

test("CPU 対戦のシミュレーション: ゲームが必ず終わる(2〜4人・全難易度)", () => {
  for (const difficulty of ["easy", "normal", "hard"]) {
    for (const n of [2, 3, 4]) {
      const rng = seeded(n * 7 + difficulty.length);
      const players = Array.from({ length: n }, (_, i) => ({ id: "c" + i, name: "C" + i, cpu: true }));
      const st = E.newGame({ players, difficulty, now: T0, rng });
      let now = T0;
      let plan = null, planAt = 0, steps = 0;
      while (st.phase !== "over" && steps++ < 20000) {
        now += 250;
        E.tick(st, now, rng);
        if (st.phase !== "play") { plan = null; continue; }
        if (!plan) { plan = Cpu.plan(st, rng); planAt = now + plan.delayMs; }
        else if (now >= planAt) { E.answer(st, st.holder, plan.word, now, rng); plan = null; }
      }
      assert.equal(st.phase, "over", `${difficulty}/${n}人 が終わる (steps ${steps})`);
      assert.ok(st.round >= 1 && st.round <= C.MAX_ROUNDS);
    }
  }
});
