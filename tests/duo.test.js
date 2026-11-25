// 二択クイズ: 進行・得点・サバイバル・離脱・出題(化学/地理の二択への変換)・問題データ
const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.window = globalThis;
require("../data/duo.js"); require("../data/chem.js"); require("../data/geo.js");
const Core = require("../js/games/duo/core.js");
const Qm = require("../js/games/duo/questions.js");
const Store = require("../js/games/duo/store.js");
const DATA = { duo: globalThis.DUO_DATA, chem: globalThis.CHEM_DATA, geo: globalThis.GEO_DATA };
const Q = Qm.create(DATA), E = Core.create(Q);

const seeded = (seed) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };
const T0 = 1_000_000;
function game(o = {}) {
  const st = E.newGame(Object.assign({ players: [{ id: "a", avatar: "🐶" }], now: T0, rng: seeded(3) }, o));
  E.tick(st, st.nextAt, seeded(5));            // 最初の問題を出す
  return st;
}
const right = (st) => st.priv.a, wrong = (st) => 1 - st.priv.a;

test("出題: すべて二択。正解の側は左右に散らばる。使った問題は出ない。図のある化学の問題も出る", () => {
  const rng = seeded(11), used = [], sides = [0, 0];
  const subs = new Set();
  for (let i = 0; i < 120; i++) {
    const { pub, priv } = Q.pick({ subjects: ["chem", "geo"], difficulty: "normal", rng, used });
    assert.equal(pub.c.length, 2); assert.notEqual(pub.c[0], pub.c[1]);
    assert.ok(priv.a === 0 || priv.a === 1);
    assert.ok(![...used].includes(pub.id)); used.push(pub.id); sides[priv.a]++; subs.add(pub.s);
    assert.ok(!/priv|explain/.test(JSON.stringify(pub)));
  }
  assert.ok(sides[0] > 30 && sides[1] > 30, "左右にかたよる " + sides);
  assert.deepEqual([...subs].sort(), ["chem", "geo"]);
  assert.ok(Q.pool("chem").some((x) => x.k), "化学の図の問題");
});

test("出題: 難しさで基礎・発展の出やすさが変わる。サバイバルは進むほど発展が出やすい", () => {
  const share = (diff, round, survival) => { let n3 = 0, tot = 400; const rng = seeded(7); for (let i = 0; i < tot; i++) if (Q.pick({ subjects: ["chem"], difficulty: diff, rng, used: [], round, survival }).pub.ex === 3) n3++; return n3 / tot; };
  assert.ok(share("hard", 1, false) > share("normal", 1, false) && share("normal", 1, false) > share("easy", 1, false));
  assert.ok(share("normal", 25, true) > share("normal", 1, true));
});

test("進行: 固定(10問)は、問題数が終わると結果が出る。得点は 10 + 早さ + 連続", () => {
  const st = game({ mode: "fixed", rounds: 10 });
  assert.equal(st.phase, "play"); assert.equal(st.round, 1);
  const t = st.startedAt;
  assert.equal(E.choose(st, "a", 2, t + 100).reason, "bad_answer");
  const r1 = E.choose(st, "a", right(st), t + 1000);
  assert.ok(r1.ok && st.phase === "between");              // ひとりなので、答えたらすぐ答え合わせ
  const g1 = st.reveal.gains.a; assert.ok(g1 >= 10 && g1 <= 20, "1問目 " + g1);
  assert.equal(st.reveal.a, st.priv.a);
  assert.equal(E.choose(st, "a", 0, t + 1100).reason, "not_playing");
  E.tick(st, st.nextAt, seeded(6));
  E.choose(st, "a", right(st), st.startedAt + 500);          // 2問連続 → +2
  assert.ok(st.reveal.gains.a >= 12, "連続ボーナス " + st.reveal.gains.a);
  assert.equal(st.players[0].streak, 2);
  E.tick(st, st.nextAt, seeded(7));
  E.choose(st, "a", wrong(st), st.startedAt + 500);
  assert.equal(st.reveal.gains.a, 0); assert.equal(st.players[0].streak, 0); assert.equal(st.players[0].bestStreak, 2);
  while (st.phase !== "over") { E.tick(st, st.nextAt, seeded(st.round)); if (st.phase === "play") E.choose(st, "a", right(st), st.startedAt + 300); }
  assert.equal(st.round, 10); assert.deepEqual(st.result.winners, ["a"]);
});

test("進行: 時間切れは0点で連続がとぎれる。決めた答えは変えられない。速いほど高い", () => {
  const st = game(); const t = st.startedAt;
  assert.ok(E.choose(st, "a", 0, t + 500).ok);
  assert.equal(E.choose(st, "a", 1, t + 600).reason, undefined === 1 ? "" : "not_playing");   // 答えたあとは締め切り済み
  const s2 = game({ players: [{ id: "a" }, { id: "b" }] });
  const t2 = s2.startedAt;
  E.choose(s2, "a", right(s2), t2 + 500);
  assert.equal(s2.phase, "play");                                   // bを待つ
  assert.equal(E.choose(s2, "a", 0, t2 + 600).reason, "already");
  assert.deepEqual(E.view(s2).answers.a && Object.keys(E.view(s2).answers.a), ["done", "at"]);   // 中身(どちらを選んだか)は見えない
  E.tick(s2, s2.endsAt, seeded(1));                                  // bは時間切れ
  assert.equal(s2.phase, "between"); assert.equal(s2.reveal.gains.b, 0); assert.equal(s2.reveal.picks.b, null);
  assert.ok(s2.reveal.gains.a > 0);
  // 早い人のほうが点が高い
  const s3 = game({ players: [{ id: "a" }, { id: "b" }] }), t3 = s3.startedAt;
  E.choose(s3, "a", right(s3), t3 + 500); E.choose(s3, "b", right(s3), t3 + 9000);
  assert.ok(s3.reveal.gains.a > s3.reveal.gains.b);
});

test("進行: サバイバルは、ミス3回で終わり、時間はだんだん短くなる。ライフのない人は答えられない", () => {
  const st = game({ mode: "survival", players: [{ id: "a" }] });
  assert.equal(st.rounds, 0); assert.equal(st.players[0].lives, 3);
  const base = Core.timeFor(st, st.q);
  for (let miss = 1; miss <= 3; miss++) {
    E.choose(st, "a", wrong(st), st.startedAt + 100);
    assert.equal(st.players[0].lives, 3 - miss);
    E.tick(st, st.nextAt, seeded(20 + miss));
    if (miss < 3) assert.equal(st.phase, "play");
  }
  assert.equal(st.phase, "over"); assert.equal(st.result.mode, "survival");
  // 時間は進むと短くなる(最短で6割)
  const fake = { mode: "survival", difficulty: "normal", round: 30 }, q = { text: "x", c: ["a", "b"] };
  assert.ok(Core.timeFor(fake, q) < Core.timeFor(Object.assign({}, fake, { round: 1 }), q));
  assert.ok(Core.timeFor(fake, q) >= Core.timeFor(Object.assign({}, fake, { round: 1 }), q) * 0.59);
  assert.ok(base > 0);
  // 2人: 片方がライフを失っても続き、残った人だけが答える
  const s2 = game({ mode: "survival", players: [{ id: "a" }, { id: "b" }] });
  for (let i = 0; i < 3; i++) {
    E.choose(s2, "a", wrong(s2), s2.startedAt + 100); E.choose(s2, "b", right(s2), s2.startedAt + 200);
    E.tick(s2, s2.nextAt, seeded(40 + i));
  }
  assert.equal(s2.players[0].lives, 0); assert.equal(s2.phase, "play");
  assert.equal(E.choose(s2, "a", 0, s2.startedAt + 100).reason, "sit_out");
  E.choose(s2, "b", right(s2), s2.startedAt + 100);
  assert.equal(s2.phase, "between");
});

test("進行: 友達対戦で通信が切れた人は待たない。戻ってもその問題は答えられない。全員切れたら時計を止める", () => {
  const st = game({ players: [{ id: "a" }, { id: "b" }, { id: "c" }] });
  const t = st.startedAt;
  E.choose(st, "a", right(st), t + 400); E.choose(st, "b", right(st), t + 500);
  assert.equal(st.phase, "play");
  const ev = E.leave(st, "c", t + 900);
  assert.equal(st.phase, "between"); assert.ok(ev.some((e) => e.type === "reveal"));
  E.back(st, "c", t + 2000);
  E.tick(st, st.nextAt, seeded(9));
  assert.ok(E.choose(st, "c", 0, st.startedAt + 100).ok);             // 次の問題からは答えられる
  // 全員切れた → 止まる
  const s2 = game({ players: [{ id: "a" }, { id: "b" }] });
  const end0 = s2.endsAt, t0 = s2.startedAt;
  E.leave(s2, "a", t0 + 100); E.leave(s2, "b", t0 + 200);
  assert.ok(s2.frozenAt); assert.equal(E.nextDeadline(s2), 0);
  assert.deepEqual(E.tick(s2, s2.endsAt + 99999, seeded(1)), []);
  E.back(s2, "a", t0 + 50_000);
  assert.ok(E.nextDeadline(s2) > end0 + 40_000);              // 止めていた分、のびた
});

test("進行: 結果の同点・ランキング、viewは答え(priv)を含めない", () => {
  const st = game({ players: [{ id: "a" }, { id: "b" }], rounds: 10 });
  const v = E.view(st);
  assert.ok(!("priv" in v)); assert.ok(!JSON.stringify(v).includes('"explain"'));
  while (st.phase !== "over") { E.tick(st, st.nextAt, seeded(st.round)); if (st.phase === "play") { E.choose(st, "a", right(st), st.startedAt + 200); E.choose(st, "b", wrong(st), st.startedAt + 300); } }
  assert.deepEqual(st.result.winners, ["a"]); assert.equal(st.result.ranking[0].id, "a");
});

test("記録: 設定と記録の保存", () => {
  const mem = {}; const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const s = Store.create(storage);
  assert.deepEqual(s.settings.get().subjects, Core.SUBJECTS);
  s.settings.set({ mode: "survival", subjects: ["en", "zzz"], rounds: 7 });
  const g = s.settings.get(); assert.equal(g.mode, "survival"); assert.deepEqual(g.subjects, ["en"]); assert.equal(g.rounds, 10);
  assert.equal(s.stats.add("fixed", 20, { score: 100, bestStreak: 5 }).newBest, false);
  assert.equal(s.stats.add("fixed", 20, { score: 150, bestStreak: 3 }).newBest, true);
  assert.deepEqual(s.stats.get("fixed", 20), { played: 2, best: 150, streak: 5, rounds: 0 });
  assert.equal(s.stats.get("fixed", 10).played, 0);
  assert.equal(Store.create(null).stats.get("survival").best, 0);          // localStorage が使えなくても動く
});

test("問題データ: 科目ごとの数・重複・形式。化学式の表示ができる", () => {
  const Fmt = require("../js/games/chem/fmt.js");
  const items = DATA.duo.items;
  assert.equal(new Set(items.map((x) => x.id)).size, items.length);
  const by = (s) => items.filter((x) => x.s === s);
  assert.ok(by("en").length >= 250, "英語 " + by("en").length);
  assert.ok(by("phys").length >= 300, "物理 " + by("phys").length);
  assert.ok(by("geo").length >= 150, "地理 " + by("geo").length);
  for (const x of items) {
    assert.ok([1, 2, 3].includes(x.ex), x.id);
    assert.equal(x.c.length, 2); assert.ok(x.c[0] && x.c[1] && x.c[0] !== x.c[1], x.id + " 正解とまちがい");
    assert.ok(!/\|/.test(x.q + x.c.join("") + (x.e || "")), x.id + " に | がある");
    const all = x.q + x.c.join("") + (x.e || "");
    assert.equal(all.split("[[").length, all.split("]]").length, x.id + " の [[ ]]");
    assert.ok(Fmt.html(x.q).length > 0);
  }
  for (const s of ["en", "phys", "geo"]) for (const ex of [1, 2, 3]) assert.ok(by(s).some((x) => x.ex === ex), `${s} の ex${ex}`);
  // 4科目すべて、出せる問題が十分にある。化学・地理の変換でも二択になる
  for (const s of Core.SUBJECTS) assert.ok(Q.count([s]) >= 150, `${s}: ${Q.count([s])}`);
  // 問題文が同じで正解の位置が偏らない(正解が先頭に書かれているのを、出題時に混ぜている)
  let left = 0; const rng = seeded(1);
  for (let i = 0; i < 400; i++) if (Q.pick({ subjects: ["en", "phys"], rng, used: [] }).priv.a === 0) left++;
  assert.ok(left > 150 && left < 250, "左: " + left);
});
