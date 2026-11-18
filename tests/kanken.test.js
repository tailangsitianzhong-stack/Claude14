const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../js/games/kanken/question.js");
const Core = require("../js/games/kanken/core.js");

global.window = {};
require("../data/kanji.js");
const DATA = window.KANKEN_DATA;
const bank = Q.createBank(DATA);

function seeded(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
const KANJI = new Set(DATA.kanji.map((k) => k[0]));

test("データ: 常用漢字2136字・5レベル・各レベルに出題できる", () => {
  assert.equal(DATA.kanji.length, 2136);
  assert.deepEqual([1, 2, 3, 4, 5].map((l) => DATA.kanji.filter((k) => k[1] === l).length), [240, 420, 366, 555, 555]);
  for (let l = 1; l <= 5; l++) {
    const sz = bank.size(l);
    assert.ok(sz.read > 500 && sz.write > 300, `Lv${l} ${JSON.stringify(sz)}`);
  }
  assert.ok(DATA.words.length > 10000);
});

test("読み問題: 熟語は漢字、答えはひらがなだけ。レベルは字のレベルの最大値", () => {
  for (const [text, reading, level] of DATA.words) {
    assert.match(reading, /^[ぁ-ゖー]+$/, text);
    const ks = [...text].filter((c) => KANJI.has(c));
    assert.ok(ks.length >= 1, text);
    assert.equal(level, Math.max(...ks.map((k) => bank.kanjiLevel.get(k))), text);
  }
});

test("書き取り問題: 4択は重複なし・正解を1つだけ含み、にせ漢字は常用漢字・語が実在しない字", () => {
  const rng = seeded(7);
  let made = 0;
  for (let l = 1; l <= 5; l++) {
    for (let i = 0; i < 400; i++) {
      const q = bank.next({ level: l, rng, type: "write" });
      assert.equal(q.type, "write");
      assert.equal(q.choices.length, 4);
      assert.equal(new Set(q.choices).size, 4, JSON.stringify(q));
      assert.equal(q.choices.filter((c) => c === q.answer).length, 1);
      assert.equal(q.choices[q.answerIndex], q.answer);
      assert.ok(q.choices.every((c) => KANJI.has(c)));
      assert.equal(q.text.split("□").length, 2);                               // 空欄は1か所
      assert.equal(q.full.replace(q.answer, "□"), q.text.replace(/□/, "□"));  // 空欄に答えを入れると元の語
      made++;
    }
  }
  assert.equal(made, 2000);
});

test("書き取り問題: 4択のどれを入れても、答え以外は辞書に載る別の語にならない(データ作りで保証)", () => {
  // 全語について、にせ漢字候補がすべて「その語の別の漢字」であること
  for (const [text, , , blank, decoys] of DATA.words) {
    if (blank < 0) continue;
    const ans = [...text][blank];
    assert.ok(decoys.length >= 3);
    assert.ok(![...decoys].includes(ans), text);
    assert.equal(new Set([...decoys]).size, [...decoys].length, text);
  }
});

test("出題: 選んだレベルが中心で、ときどき易しいレベルも混ざる。出題済みは避ける", () => {
  const rng = seeded(3);
  const used = new Set();
  const lv = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let i = 0; i < 1000; i++) {
    const q = bank.next({ level: 4, rng, used });
    used.add(q.id);
    lv[q.level]++;
  }
  assert.equal(lv[5], 0);                                 // 選んだレベルより難しい字は出ない
  assert.ok(lv[4] > 600, JSON.stringify(lv));             // 中心は選んだレベル
  assert.ok(lv[1] + lv[2] + lv[3] > 150, JSON.stringify(lv));
  assert.equal(used.size, 1000);                          // 重複なし
  const lv1 = new Set();
  for (let i = 0; i < 300; i++) assert.equal(bank.next({ level: 1, rng: seeded(i + 1) }).level, 1);   // Lv1 は Lv1 だけ
});

test("読みの答え合わせ: カタカナ・ぢづ・空白をゆるす", () => {
  const q = { type: "read", answer: "けんてい" };
  assert.equal(Q.checkReading("けんてい", q), true);
  assert.equal(Q.checkReading("ケンテイ", q), true);
  assert.equal(Q.checkReading(" けん てい ", q), true);
  assert.equal(Q.checkReading("けんで", q), false);
  assert.equal(Q.checkReading("", q), false);
  assert.equal(Q.checkReading("はなぢ", { type: "read", answer: "はなじ" }), true);
  assert.equal(Q.checkReading("こづつみ", { type: "read", answer: "こずつみ" }), true);
  assert.equal(Q.checkChoice(2, { type: "write", answerIndex: 2 }), true);
  assert.equal(Q.checkChoice(1, { type: "write", answerIndex: 2 }), false);
});

test("得点: レベル・形式・はやさ・連続で変わる", () => {
  const base = { level: 1, type: "write", elapsed: 12, limit: 12, streak: 0 };
  assert.equal(Q.pointsFor(base), 10);                                       // Lv1・4択・ギリギリ・連続なし
  assert.equal(Q.pointsFor({ ...base, elapsed: 0 }), 15);                    // 最速で+50%
  assert.equal(Q.pointsFor({ ...base, type: "read", limit: 30, elapsed: 30 }), 15);   // 読みは×1.5
  assert.equal(Q.pointsFor({ ...base, streak: 5 }), 15);                     // 連続5で+50%
  assert.equal(Q.pointsFor({ ...base, streak: 99 }), 15);                    // 連続は頭打ち
  assert.equal(Q.pointsFor({ ...base, elapsed: 0, streak: 5 }), 20);         // 最大: ×2
  assert.ok(Q.pointsFor({ ...base, level: 5 }) === 80);
  const pts = [1, 2, 3, 4, 5].map((level) => Q.pointsFor({ ...base, level }));
  assert.deepEqual(pts, [10, 20, 30, 50, 80]);
});

/* ---------- 進行ロジック ---------- */
const T0 = 1_000_000;
const game = (mode, level = 2, seed = 1) => Core.create({ bank, mode, level, rng: seeded(seed) });
/** いま出ている問題に、正解/不正解で答える */
function solve(g, now, ok) {
  const q = g.state().q;
  if (q.type === "read") return g.answer({ reading: ok ? q.answer : "ぬぬぬ" }, now);
  return g.answer({ choice: ok ? q.answerIndex : (q.answerIndex + 1) % 4 }, now);
}

test("タイムアタック: 60秒の間だけ答えられ、間違えても続く(ライフなし)。パスもできる", () => {
  const g = game("timeattack");
  assert.ok(g.start(T0));
  assert.equal(g.remainingMs(T0), 60_000);
  let now = T0;
  for (let i = 0; i < 5; i++) { now += 2000; const r = solve(g, now, true); assert.equal(r.correct, true); g.next(now); }
  now += 1000; const miss = solve(g, now, false); assert.equal(miss.correct, false); assert.equal(miss.over, false);
  g.next(now);
  now += 500; assert.equal(g.skip(now).skipped, true); g.next(now);
  const st = g.state();
  assert.deepEqual([st.correct, st.wrong, st.skipped, st.streak], [5, 1, 1, 0]);
  assert.ok(st.score > 0 && st.lives === null);
  // 時間切れ: 以降の答えは受け付けず、終了
  const late = solve(g, T0 + 60_001, true);
  assert.equal(late.ignored, true);
  assert.equal(g.state().phase, "over");
  assert.equal(g.summary().reason, "time");
});

test("タイムアタック: 時間が来たら次の問題は出ない(tick/next)", () => {
  const g = game("timeattack");
  g.start(T0);
  g.tick(T0 + 61_000);
  assert.equal(g.state().phase, "over");
  assert.equal(g.next(T0 + 61_000), false);
});

test("サバイバル: ライフ3。間違えるたびに-1、0で終了。時間切れは1回で終了", () => {
  const g = game("survival");
  g.start(T0);
  let now = T0 + 1000;
  solve(g, now, true); g.next(now);
  assert.equal(solve(g, now, false).lives, 2); g.next(now);
  assert.equal(solve(g, now, false).lives, 1); g.next(now);
  const last = solve(g, now, false);
  assert.equal(last.over, true);
  assert.equal(g.summary().reason, "lives");
  assert.equal(g.summary().correct, 1);

  const g2 = game("survival", 3, 9);
  g2.start(T0);
  solve(g2, T0 + 500, true); g2.next(T0 + 500);
  const q = g2.state().q;
  const t = g2.timeout(g2.state().deadline);
  assert.deepEqual([t.timeout, t.over], [true, true]);                         // 時間切れでゲーム終了
  assert.equal(g2.summary().reason, "timeout");
  assert.equal(g2.state().lives, 3);                                           // ライフは減っていない
  assert.equal(g2.summary().mistakes.length, 1);
});

test("1問の制限時間: 読み30秒・4択12秒。過ぎてから届いた答えは時間切れ", () => {
  let found = { read: false, write: false };
  for (let seed = 1; seed < 40 && !(found.read && found.write); seed++) {
    const g = game("exam", 2, seed);
    g.start(T0);
    const q = g.state().q;
    const limit = Core.LIMIT[q.type];
    assert.equal(g.remainingMs(T0), limit * 1000);
    found[q.type] = true;
    const r = q.type === "read" ? g.answer({ reading: q.answer }, T0 + limit * 1000 + 1000) : g.answer({ choice: q.answerIndex }, T0 + limit * 1000 + 1000);
    assert.equal(r.timeout, true);
    assert.equal(g.state().lives, 4);                                          // ミニ検定は時間切れもライフ-1
  }
  assert.deepEqual(found, { read: true, write: true });
});

test("ミニ検定: 最大60問。全問答えると終了。正解数とポイントが出る", () => {
  const g = game("exam", 3, 5);
  g.start(T0);
  let now = T0, n = 0;
  while (g.state().phase === "asking") {
    now += 3000; n++;
    solve(g, now, true);
    g.next(now);
  }
  assert.equal(n, 60);
  const sum = g.summary();
  assert.deepEqual([sum.reason, sum.correct, sum.answered, sum.asked], ["done", 60, 60, 60]);
  assert.ok(sum.score > 60 * 30);                                              // Lv3の基本30点×60問以上
  assert.equal(sum.bestStreak, 60);
});

test("ミニ検定: ライフ5。間違い5回で終了。連続正解は間違いで途切れる", () => {
  const g = game("exam", 1, 2);
  g.start(T0);
  let now = T0;
  for (let i = 0; i < 3; i++) { now += 1000; solve(g, now, true); g.next(now); }
  assert.equal(g.state().streak, 3);
  for (let i = 0; i < 5; i++) {
    now += 1000;
    const r = solve(g, now, false);
    if (i < 4) { assert.equal(r.over, false); g.next(now); }
    else assert.equal(r.over, true);
  }
  assert.equal(g.state().streak, 0);
  assert.equal(g.summary().reason, "lives");
  assert.equal(g.summary().mistakes.length, 5);
  assert.equal(g.summary().bestStreak, 3);
});

test("間違いの記録: 書き取りは元の語と読み、読みは答え。コピーを返す", () => {
  const g = game("timeattack", 2, 4);
  g.start(T0);
  const q = g.state().q;
  solve(g, T0 + 500, false);
  const m = g.summary().mistakes[0];
  assert.equal(m.type, q.type);
  assert.equal(m.answer, q.answer);
  if (q.type === "write") assert.equal(m.text, q.full);
  m.text = "x";
  assert.notEqual(g.summary().mistakes[0].text, "x");
});

test("不明なモードはエラー", () => {
  assert.throws(() => Core.create({ bank, mode: "nope", level: 1 }));
});

test("答えたあと(次の問題を出す前)は、1問の制限時間では時間切れにならない。二重に数えない", () => {
  const g = game("survival", 2, 3);
  g.start(T0);
  const r = solve(g, T0 + 1000, true);
  assert.equal(r.correct, true);
  assert.equal(g.state().phase, "between");
  assert.equal(g.tick(T0 + 99_000), null);                  // 答え済みの問題は時間切れにならない
  assert.equal(g.timeout(T0 + 99_000).ignored, true);
  assert.equal(g.state().timeouts, 0);
  assert.equal(g.answer({ reading: "x" }, T0 + 99_000).ignored, true);   // 同じ問題に二度答えられない
  assert.ok(g.next(T0 + 99_000));
  assert.equal(g.state().phase, "asking");
});

test("タイムアタック: 答えたあとの待ち状態でも、全体の時間が来たら終了する", () => {
  const g = game("timeattack");
  g.start(T0);
  solve(g, T0 + 59_000, true);
  g.tick(T0 + 60_500);
  assert.equal(g.state().phase, "over");
  assert.equal(g.summary().reason, "time");
});

const KStore = require("../js/games/kanken/store.js");
test("保存: ベストはモード×レベル別。復習は重複をまとめる。保存先が使えなくても動く", () => {
  const mem = {};
  const st = KStore.create({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } });
  assert.deepEqual(st.best.get("exam", 3), { score: 0, correct: 0 });
  assert.equal(st.best.submit("exam", 3, 100, 20), true);
  assert.equal(st.best.submit("exam", 3, 90, 25), false);
  assert.equal(st.best.submit("survival", 3, 10, 2), true);            // 別モードは別記録
  assert.deepEqual(st.best.get("exam", 3), { score: 100, correct: 20 });
  assert.equal(st.best.get("exam", 4).score, 0);

  st.review.add({ text: "検定", reading: "けんてい" });
  st.review.add({ text: "試験", reading: "しけん" });
  st.review.add({ text: "検定", reading: "けんてい" });
  assert.deepEqual(st.review.list().map((e) => e.text), ["検定", "試験"]);
  st.review.remove("検定");
  assert.equal(st.review.list().length, 1);
  st.review.clear();
  assert.equal(st.review.list().length, 0);

  assert.deepEqual(st.settings.get(), { mode: "exam", level: 1 });
  st.settings.set({ level: 4 });
  assert.equal(st.settings.get().level, 4);

  const none = KStore.create(null);
  none.review.add({ text: "検定", reading: "けんてい" });
  assert.deepEqual(none.review.list(), []);
  assert.equal(none.best.submit("exam", 1, 5, 1), true);
});
