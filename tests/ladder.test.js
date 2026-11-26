// 英単語トランスミッション: 辞書・進行・パズルデータ
const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.window = globalThis;
require("../data/ladder.js");
const Dict = require("../js/games/ladder/dict.js").create(globalThis.LADDER_DATA);
const Core = require("../js/games/ladder/core.js");
const E = Core.create(Dict);
const T0 = 1_000_000;
const seeded = (seed) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };

const game = (o = {}) => E.newGame(Object.assign({ players: [{ id: "a" }], puzzle: { start: "rock", goal: "joke", par: 7, level: 2 }, now: T0 }, o));

test("辞書: 意味・規則変化・1文字ちがい・最短のつなぎかた", () => {
  const rock = Dict.lookup("rock");
  assert.equal(rock.pos, "名詞"); assert.match(rock.ja, /岩/); assert.ok(rock.rank > 0);
  assert.equal(Dict.lookup("rocks").form, "複数形・三単現"); assert.equal(Dict.lookup("rocks").stem, "rock");
  assert.deepEqual(Dict.lookup("jock"), { pos: "", ja: "", more: [], rank: 0, form: "", pending: true });   // ふつうの英単語の一覧にある語: その場で認める(意味はあとから)
  assert.equal(Dict.lookup("nike"), null);                               // どれにもない語(固有名詞など)は AI が確認する
  assert.match(Dict.lookup("done").ja, /終えた/); assert.equal(Dict.lookup("done").form, "do の過去分詞");     // 手書きの意味
  assert.equal(Dict.lookup("went").pos, "動詞");
  assert.equal(Dict.lookup("zzzz"), null); assert.equal(Dict.lookup("ab"), null); assert.equal(Dict.lookup("Rock").ja, rock.ja);
  assert.ok(Dict.neighbors("rock").includes("lock"));
  assert.ok(Dict.neighbors("rock").every((w) => w.length === 4 && [...w].filter((c, i) => c !== "rock"[i]).length === 1));
  const way = Dict.path("rock", "joke");
  assert.equal(way[0], "rock"); assert.equal(way[way.length - 1], "joke");
  for (let i = 1; i < way.length; i++) assert.deepEqual(Core.diffs(way[i - 1], way[i]).length, 1);
  const other = Dict.path("rock", "joke", new Set(way.slice(1, -1)));       // 使った語を通らないつなぎかた(あれば別の道)
  if (other) assert.ok(!other.slice(1, -1).some((w) => way.includes(w)));
});

test("パズルデータ: すべて、辞書の単語だけで、記録どおりの最短の手数で解ける", () => {
  const P = globalThis.LADDER_DATA.puzzles;
  assert.ok(P.length >= 400, "パズル " + P.length);
  for (const lv of [1, 2, 3]) assert.ok(P.filter((p) => p[3] === lv).length >= 100, "難しさ " + lv);
  const rnd = seeded(3);
  for (let i = 0; i < 120; i++) {
    const [a, b, par, lv] = P[Math.floor(rnd() * P.length)];
    assert.equal(a.length, b.length); assert.ok(Dict.has(a) && Dict.has(b));
    const way = Dict.path(a, b);
    assert.equal(way.length - 1, par, `${a}>${b}`);
    for (const w of way) assert.ok(Dict.lookup(w).ja, w + " の意味");
  }
  assert.ok(Dict.size >= 1500);
  for (const [w, , ms] of globalThis.LADDER_DATA.words.slice(0, 300)) assert.ok(/^[a-z]{3,5}$/.test(w) && ms.length > 2, w);
});

test("進行: 辞書の単語を順につないでゴールするとクリア。意味が記録される。星は最短の手数で決まる", () => {
  const st = E.newGame({ players: [{ id: "a" }, { id: "b" }], puzzle: { start: "rock", goal: "pack", par: 2, level: 1 }, now: T0 });
  assert.equal(E.current(st).id, "a");
  assert.equal(E.propose(st, "b", "rack", T0 + 1).reason, "not_your_turn");
  const r = E.propose(st, "a", "rack", T0 + 2);
  assert.equal(r.verdict, "accepted"); assert.ok(st.meanings.rack.ja);
  assert.equal(E.current(st).id, "b");
  const r2 = E.propose(st, "b", "pack", T0 + 3);
  assert.equal(r2.verdict, "accepted"); assert.equal(st.phase, "over");
  assert.ok(st.result.win); assert.equal(st.result.steps, 2); assert.equal(st.result.stars, 3);
  assert.deepEqual(st.result.chain, ["rock", "rack", "pack"]);
  assert.equal(st.result.contributions.find((c) => c.id === "a").moves, 1);
  // 遠まわりなら星が減る
  const s2 = game({ puzzle: { start: "rock", goal: "lock", par: 1, level: 1 } });
  for (const w of ["rack", "pack", "pick", "lick", "lock"]) E.propose(s2, "a", w, T0 + 5);
  assert.ok(s2.result.win); assert.equal(s2.result.stars, 1);
});

test("進行: 規則に合わない語は、ギアを減らさずに断る(使った語・2文字以上ちがう・文字数・同じ語)", () => {
  const st = game();
  for (const [w, reason] of [["rock", "same"], ["lick", "diff"], ["rocks", "format"], ["ro", "format"], ["ro1k", "format"], ["jokk", "diff"]]) { const r = E.propose(st, "a", w, T0 + 1); assert.equal(r.verdict, "rejected", w); assert.equal(r.reason, reason, w); }
  assert.equal(st.lives, 3);
  E.propose(st, "a", "rack", T0 + 2);
  assert.equal(E.propose(st, "a", "rock", T0 + 3).reason, "used");           // 使った語にはもどれない
  assert.equal(E.propose(st, "a", "RACK", T0 + 3).reason, "same");             // 大文字小文字は同じ
  assert.equal(st.lives, 3); assert.equal(st.chain.length, 2);
});

test("AI判定: 辞書にない語は確認中になり時間が止まる。認められればつながり、不可ならギアが減る。確認できなければやり直し", () => {
  const st = game({ players: [{ id: "a" }, { id: "b" }], turnSec: 30, puzzle: { start: "like", goal: "bike", par: 1, level: 1 } });
  const r = E.propose(st, "a", "nike", T0 + 1000);                          // like → nike (固有名詞: どの一覧にもない)
  assert.equal(r.verdict, "unsure"); assert.deepEqual(r.judge, { word: "nike", prev: "like", goal: "bike" });
  assert.equal(E.propose(st, "b", "lime", T0 + 1100).reason, "judging");      // 確認中は、ほかの操作ができない
  assert.equal(E.nextDeadline(st), T0 + 1000 + Core.AI_WAIT_MS + 1);
  const endsBefore = st.turnEndsAt;
  const ok = E.judged(st, true, { pos: "名詞", ja: "運動選手（うんどうせんしゅ）" }, T0 + 3000);
  assert.equal(ok.verdict, "accepted"); assert.equal(st.meanings.nike.src, "ai"); assert.equal(st.meanings.nike.ja, "運動選手（うんどうせんしゅ）");
  assert.ok(st.turnEndsAt > endsBefore - 1);
  assert.equal(st.judging, null);
  // 不可 → ギアが1つ減り、手番が移る
  const s2 = game({ players: [{ id: "a" }, { id: "b" }] });
  E.propose(s2, "a", "rork", T0 + 1);
  const ng = E.judged(s2, false, null, T0 + 2);
  assert.equal(ng.verdict, "rejected"); assert.equal(s2.lives, 2); assert.equal(E.current(s2).id, "b"); assert.equal(s2.chain.length, 1);
  // 確認できなかった → ギアは減らさず、同じ人がやり直す
  const s3 = game();
  E.propose(s3, "a", "rork", T0 + 1);
  assert.equal(E.judged(s3, null, null, T0 + 2).verdict, "unavailable"); assert.equal(s3.lives, 3); assert.equal(s3.judging, null);
  // 待ちすぎたら、確認できなかった扱い
  const s4 = game(); E.propose(s4, "a", "rork", T0);
  assert.ok(E.tick(s4, T0 + Core.AI_WAIT_MS + 5).some((e) => e.type === "ai_unavailable")); assert.equal(s4.lives, 3);
});

test("進行: ギアが0でおしまい。時間切れ・1手戻すもギアを使う。ヒントはチームで3回", () => {
  const st = game({ players: [{ id: "a" }, { id: "b" }], turnSec: 20 });
  E.tick(st, T0 + 21000);                                                     // a が時間切れ
  assert.equal(st.lives, 2); assert.equal(E.current(st).id, "b"); assert.equal(st.turnEndsAt, T0 + 21000 + 20000);
  E.propose(st, "b", "rack", T0 + 22000);
  assert.equal(E.undo(st, "b", T0 + 23000).ok, true); assert.equal(st.lives, 1); assert.equal(st.chain.length, 1);
  assert.equal(E.undo(st, "b", T0 + 24000).reason, "nothing");               // スタートは消せない
  E.tick(st, T0 + 60000);
  assert.equal(st.phase, "over"); assert.equal(st.result.win, false); assert.equal(st.result.why, "gear"); assert.equal(st.result.stars, 0);
  // ヒント
  const h = game({ puzzle: { start: "rock", goal: "lock", par: 1, level: 1 } });
  const h1 = E.hint(h, "a", T0), h2 = E.hint(h, "a", T0), h3 = E.hint(h, "a", T0);
  assert.equal(h1.hint.kind, "distance"); assert.equal(h1.hint.diff, 1); assert.equal(h1.hint.steps, 1);
  assert.equal(h2.hint.kind, "position"); assert.equal(h2.hint.index, 0);
  assert.equal(h3.hint.kind, "letter"); assert.equal(h3.hint.letter, "l");
  assert.equal(E.hint(h, "a", T0).reason, "no_hints"); assert.equal(h.hints, 0);
});

test("進行: 通信が切れた人は手番を飛ばす。全員が切れたら時計を止める。戻ったら止めた分をのばす", () => {
  const st = game({ players: [{ id: "a" }, { id: "b" }, { id: "c" }], turnSec: 30 });
  E.leave(st, "a", T0 + 5000);
  assert.equal(E.current(st).id, "b"); assert.equal(st.lives, 3);
  E.propose(st, "b", "rack", T0 + 6000);
  assert.equal(E.current(st).id, "c");                                         // a(通信なし)は飛ばす
  E.propose(st, "c", "rank", T0 + 7000);
  assert.equal(E.current(st).id, "b");
  E.leave(st, "b", T0 + 8000); E.leave(st, "c", T0 + 9000);
  assert.ok(st.frozenAt); assert.equal(E.nextDeadline(st), 0); assert.deepEqual(E.tick(st, T0 + 999999), []);
  const end0 = st.turnEndsAt;
  E.back(st, "b", T0 + 109000);
  assert.ok(st.turnEndsAt >= end0 + 99000);
  assert.equal(E.current(st).id, "b");
});

test("パズルの選び方", () => {
  const rng = seeded(5), used = [];
  for (let i = 0; i < 30; i++) { const p = Core.pickPuzzle(globalThis.LADDER_DATA, 2, rng, used); assert.equal(p.level, 2); assert.ok(!used.includes(p.id)); used.push(p.id); }
  assert.equal(Core.pickPuzzle(globalThis.LADDER_DATA, 9), null);
});

test("AIを待たない: ふつうの英単語は、その場で認める。意味がなければ、あとから AI がつける(進行は止まらない)", () => {
  const st = E.newGame({ players: [{ id: "a" }, { id: "b" }], puzzle: { start: "rock", goal: "lock", par: 1, level: 2 }, now: T0 });
  const r = E.propose(st, "a", "jock", T0 + 1);                             // rock → jock: 辞書にはないが、ふつうの英単語
  assert.equal(r.verdict, "accepted"); assert.equal(r.needMeaning, true);
  assert.equal(st.judging, null); assert.equal(E.current(st).id, "b");        // すぐ次の人の番(確認で待たない)
  assert.equal(st.meanings.jock.pending, true);
  const m = E.setMeaning(st, "jock", { pos: "名詞", ja: "運動選手（うんどうせんしゅ）" }, T0 + 500);
  assert.ok(m.ok); assert.equal(st.meanings.jock.ja, "運動選手（うんどうせんしゅ）"); assert.equal(st.meanings.jock.pending, false); assert.equal(st.meanings.jock.src, "ai");
  assert.equal(E.setMeaning(st, "jock", null, T0 + 600).ok, false);          // 意味待ちでなければ無視
  const r2 = E.propose(st, "b", "lock", T0 + 700);                           // jock → lock (辞書)
  assert.equal(r2.needMeaning, false); assert.equal(st.phase, "over"); assert.deepEqual(st.result.chain, ["rock", "jock", "lock"]); assert.equal(st.result.stars, 2);
  // 意味が見つからなかったとき
  const s2 = E.newGame({ players: [{ id: "a" }], puzzle: { start: "rock", goal: "lock", par: 1, level: 2 }, now: T0 });
  E.propose(s2, "a", "jock", T0); assert.equal(s2.meanings.jock.pending, true);
  E.setMeaning(s2, "jock", null, T0 + 1); assert.equal(s2.meanings.jock.none, true); assert.equal(s2.meanings.jock.pending, false);
  // 手書きの意味の語(done)は、AIも意味待ちも要らない
  const s3 = E.newGame({ players: [{ id: "a" }], puzzle: { start: "dine", goal: "gone", par: 2, level: 1 }, now: T0 });
  const r3 = E.propose(s3, "a", "done", T0); assert.equal(r3.verdict, "accepted"); assert.equal(r3.needMeaning, false); assert.match(s3.meanings.done.ja, /終えた/);
});

test("ヒント: よく使う単語の道を優先し、めずらしい語まで使うと短い場合は、その手数も教える", () => {
  const st = E.newGame({ players: [{ id: "a" }], puzzle: { start: "rock", goal: "joke", par: 7, level: 2 }, now: T0 });
  const h = E.hint(st, "a", T0).hint;
  assert.equal(h.kind, "distance"); assert.equal(h.steps, 7); assert.ok(h.wideSteps < h.steps);
  assert.ok(Dict.path("rock", "joke", null, { broad: true }).length - 1 < Dict.path("rock", "joke").length - 1);
});
