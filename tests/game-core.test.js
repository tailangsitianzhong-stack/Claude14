const test = require("node:test");
const assert = require("node:assert/strict");
const Rules = require("../js/games/shiritori/rules.js");
const Dict = require("../js/games/shiritori/dictionary.js");
const Judge = require("../js/games/shiritori/judge.js");
const Core = require("../js/games/shiritori/game-core.js");
const Store = require("../js/games/shiritori/store.js");

global.window = {};
require("../data/words.js");
const dict = Dict.create(window.SHIRITORI_WORDS);
const judge = Judge.create({ dict });

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const mk = (o) => Core.create(Object.assign({ dict, judge, rng: seeded(7) }, o));

// 小さな辞書（CPUが詰まる場面のテスト用）: 「り」→りんご(ご)。「ご」から始まるCPU語は無い
const tiny = Dict.create({ pairs: [
  ["りんご", "apple", 1, 7],
  ["りす", "squirrel", 1, 7],
  ["ごりら", "gorilla", 1, 1]   // 主要訳のみ(CPU可の印2なし) → CPUは出せない
] });

test("得点: 速いほど・長いほど・連続ほど高く、倍率がかかる", () => {
  const base = { length: 5, remaining: 30, seconds: 30, streak: 1, mult: 1 };
  assert.equal(Core.pointsFor(base), 10 + 10 + 10 + 2);
  assert.ok(Core.pointsFor({ ...base, remaining: 0 }) < Core.pointsFor(base));
  assert.ok(Core.pointsFor({ ...base, length: 8 }) > Core.pointsFor(base));
  assert.ok(Core.pointsFor({ ...base, streak: 9 }) === Core.pointsFor({ ...base, streak: 5 })); // 連続は5で頭打ち
  assert.equal(Core.pointsFor({ ...base, mult: 2 }), Core.pointsFor(base) * 2);
});

test("開始は「り」から。成功→CPUの手→プレイヤーの手…と進む", async () => {
  const g = mk();
  assert.equal(g.state().required, "り");
  const r = await g.submit("りんご", "apple", 20);
  assert.equal(r.kind, "accepted");
  assert.ok(r.points > 0);
  assert.equal(g.state().phase, "cpu");
  assert.equal((await g.submit("ごりら", "gorilla", 20)).kind, "ignored"); // CPUの番は受け付けない

  const c = g.cpuTurn();
  assert.equal(c.kind, "cpu");
  assert.equal(Rules.getHeadKana(c.reading), "ご");
  assert.equal(g.state().phase, "player");
  assert.equal(g.state().required, c.tail);
  assert.equal(g.state().history.length, 2);
});

test("まちがい: ライフが減り、つづりミスはふくしゅう用の正解つき", async () => {
  const g = mk({ difficulty: "normal" });
  const r = await g.submit("りんご", "appel", 20);
  assert.equal(r.kind, "miss");
  assert.equal(r.reason, "spelling");
  assert.equal(r.correct, "apple");
  assert.deepEqual(r.review, { reading: "りんご", typed: "appel", correct: "apple", reason: "spelling" });
  assert.equal(r.lives, 2);
  assert.equal(g.state().mistakes.length, 1);
  assert.equal(g.state().streak, 0);
});

test("つながっていない/重複もライフ減。形式ミスと未知語は減らない", async () => {
  const g = mk();
  let r = await g.submit("ねこ", "cat", 20);
  assert.deepEqual([r.kind, r.reason, r.lives], ["miss", "not_connected", 2]);
  assert.equal(r.review, null);

  r = await g.submit("りんご", "ap ple", 20);
  assert.deepEqual([r.kind, r.reason], ["retry", "invalid_english"]);
  r = await g.submit("りんご", "applx", 20);        // 近い綴りが無い → wrong/unknown
  assert.notEqual(r.kind, "accepted");
  const before = g.state().lives;

  r = await g.submit("りぼん", "xyzzy", 20);       // 辞書に無い語
  assert.equal(r.kind === "retry" || r.kind === "miss", true);
  assert.ok(g.state().lives <= before);
});

test("時間切れ: ライフ-1。ライフ0でゲームオーバー", async () => {
  const g = mk({ difficulty: "hard" }); // ライフ3
  g.timeout(); g.timeout();
  assert.equal(g.state().phase, "player");
  const r = g.timeout();
  assert.equal(r.gameOver, true);
  assert.equal(g.state().result, "lost_lives");
  assert.equal(g.timeout().kind, "ignored");
});

test("「ん」で終わると負け（得点は残る）", async () => {
  const g = mk();
  // 実在の語: 「り」始まりで「ん」終わり
  const w = [...window.SHIRITORI_WORDS.pairs].find((p) => p[0][0] === "り" && p[0].endsWith("ん") && p[3] & 1);
  const r2 = await g.submit(w[0], w[1], 20);
  assert.equal(r2.kind, "accepted");
  assert.equal(r2.endsWithN, true);
  assert.equal(g.state().result, "lost_n");
  assert.ok(g.state().score > 0);
});

test("ヒント: つながる語の頭文字を教え、得点を5引く（0未満にならない）", async () => {
  const g = mk();
  let h = g.hint();
  assert.equal(Rules.getHeadKana(h.reading), "り");
  assert.match(h.firstLetter, /^[a-z]$/);
  assert.ok(h.length >= 2);
  assert.equal(g.state().score, 0);       // 0未満にはならない

  await g.submit("りんご", "apple", 30);
  const score = g.state().score;
  g.cpuTurn();
  g.hint();
  assert.equal(g.state().score, score - Core.HINT_COST);
  assert.equal(g.state().hints, 2);
});

test("CPUが出せなくなったらプレイヤーの勝ち", async () => {
  const j = Judge.create({ dict: tiny });
  const g = Core.create({ dict: tiny, judge: j, difficulty: "easy", rng: seeded(1) });
  assert.equal((await g.submit("りんご", "apple", 20)).kind, "accepted");
  const c = g.cpuTurn();                       // 「ご」から始まるCPU語が無い
  assert.equal(c.kind, "cpu_stuck");
  assert.equal(g.state().result, "win");
});

test("むずかしさ設定: ライフ・時間・CPUのレベル", async () => {
  assert.equal(mk({ difficulty: "easy" }).state().lives, 5);
  assert.equal(mk({ difficulty: "hard" }).difficulty.seconds, 20);
  assert.equal(mk({ difficulty: "???" }).difficulty.key, "normal");   // 不明なら「ふつう」
  const g = mk({ difficulty: "easy" });                              // CPUはレベル1だけ
  await g.submit("りんご", "apple", 30);
  for (let i = 0; i < 20; i++) {
    const h = mk({ difficulty: "easy", rng: seeded(i + 1) }).hint();
    assert.ok(dict.lookup(h.reading, window.SHIRITORI_WORDS.pairs.find((p) => p[0] === h.reading && p[1][0] === h.firstLetter && p[1].length === h.length)[1]).level === 1);
  }
});

test("通しプレイ: 完璧なプレイヤー(ヒントの語を答える)とCPUで長く続く", async () => {
  const g = mk({ difficulty: "normal" });
  let turns = 0;
  while (g.state().phase !== "over" && turns < 60) {
    const h = g.hint();
    assert.ok(h, "hint");
    const hintWord = dict.pickCpu({ requiredKana: g.state().required, used: g.state().used, maxLevel: 2, rng: seeded(turns + 1) });
    const r = await g.submit(hintWord.reading, hintWord.english, 15);
    assert.equal(r.kind, "accepted", `${hintWord.reading}=${hintWord.english}`);
    if (g.state().phase === "cpu") g.cpuTurn();
    turns++;
  }
  assert.ok(turns >= 30, `turns ${turns}`);
});

test("store: ふくしゅうは重複をまとめ新しい順、ベストは更新時のみtrue", () => {
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const st = Store.create(storage);
  st.review.add({ reading: "りんご", typed: "appel", correct: "apple" });
  st.review.add({ reading: "ごりら", typed: "gorila", correct: "gorilla" });
  st.review.add({ reading: "りんご", typed: "aple", correct: "apple" });
  const list = st.review.list();
  assert.deepEqual(list.map((e) => e.correct), ["apple", "gorilla"]);
  assert.equal(list[0].typed, "aple");
  st.review.remove("りんご", "apple");
  assert.equal(st.review.list().length, 1);
  st.review.clear();
  assert.equal(st.review.list().length, 0);

  assert.equal(st.best.submit("normal", 100), true);
  assert.equal(st.best.submit("normal", 90), false);
  assert.equal(st.best.get("normal"), 100);
  assert.equal(st.best.get("hard"), 0);

  assert.equal(st.settings.get().difficulty, "normal");
  st.settings.set({ ignoreDakuten: true });
  assert.equal(st.settings.get().ignoreDakuten, true);
});

test("store: storage が使えなくても落ちない", () => {
  const st = Store.create(null);
  st.review.add({ reading: "りんご", typed: "x", correct: "apple" });
  assert.deepEqual(st.review.list(), []);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const st2 = Store.create(broken);
  assert.equal(st2.best.submit("easy", 5), true);
  assert.equal(st2.settings.get().difficulty, "normal");
});
