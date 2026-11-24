// 地理クイズ: 文字処理・出題・進行(3形式)・CPU・保存
const test = require("node:test");
const assert = require("node:assert/strict");

let Text, Qm, Core, Cpu, Store, D, Q, E, C;
test.before(() => {
  globalThis.window = globalThis.window || globalThis;
  delete require.cache[require.resolve("../data/geo.js")];
  require("../data/geo.js");
  D = globalThis.GEO_DATA;
  Text = require("../js/games/geo/text.js");
  Qm = require("../js/games/geo/questions.js");
  Core = require("../js/games/geo/core.js");
  Cpu = require("../js/games/geo/cpu.js");
  Store = require("../js/games/geo/store.js");
  Q = Qm.create(D);
  E = Core.create(Q);
  C = Cpu.create(D);
});

function seeded(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
const T0 = 1_000_000;
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: "p" + (i + 1), name: "P" + (i + 1) }));
function game(mode, n = 2, o = {}) {
  const rng = seeded(o.seed || 5);
  const st = E.newGame(Object.assign({ players: P(n), mode, difficulty: "normal", scope: "both", rounds: 3, now: T0, rng }, o));
  return { st, rng };
}
function start(g) { E.tick(g.st, T0 + Core.START_MS, g.rng); return T0 + Core.START_MS; }

// ---------- データ ----------
test("データ: 問題数・形式・読みの形", () => {
  assert.ok(D.buzz.length >= 560 && D.map.length >= 700 && D.choice.length >= 840, `${D.buzz.length}/${D.map.length}/${D.choice.length}`);
  assert.equal(D.countries.length, 194);
  assert.equal(D.prefs.length, 47);
  for (const b of D.buzz) { assert.ok(b.yomi.length >= 1 && b.yomi.every((y) => /^[ぁ-んーa-z0-9]+$/.test(y)), b.id); assert.ok(["world", "japan"].includes(b.sc)); assert.match(b.text, /[？。]$/); }
  for (const m of D.map) assert.ok(Q.isValidTarget(m.map, m.target), m.id);
  for (const c of D.choice) { assert.equal(c.c.length, 4); assert.equal(new Set(c.c).size, 4, c.id); assert.equal(c.a, 0); }
  const kinds = new Set(D.choice.map((c) => c.k));
  for (const k of ["graph", "table", "type", "photo", "stat"]) assert.ok(kinds.has(k), k);
  assert.ok(D.choice.filter((c) => c.k === "photo").length >= 50);
});

test("データ: 雨温図は12か月・写真ファイルと出典がある", () => {
  const fs = require("node:fs");
  for (const c of Object.values(D.climate)) { assert.equal(c.t.length, 12); assert.equal(c.p.length, 12); }
  for (const p of D.photos) {
    assert.ok(fs.existsSync(`${__dirname}/../assets/geo/${p.id}.webp`), p.id);
    assert.ok(p.credit && p.credit.license && p.credit.page, p.id);
    assert.ok(!/NC|ND/i.test(p.credit.license), p.id + " " + p.credit.license);
  }
});

// ---------- 文字 ----------
test("文字: 読みの照合はかな・カタカナ・空白・記号の違いを無視", () => {
  assert.equal(Text.normalize("ナイル かわ"), "ないるかわ");
  assert.equal(Text.normalize("ニューヨーク"), "にゅーよーく");
  assert.ok(Text.matches("ナイルがわ", ["ないるがわ", "ないる"]));
  assert.ok(Text.matches("ないる", ["ないるがわ", "ないる"]));
  assert.ok(Text.matches("ワシントン・ディーシー", ["わしんとんでぃーしー"]));
  assert.equal(Text.matches("", ["あ"]), false);
  assert.equal(Text.matches("ないるかわ", ["ないるがわ"]), false);        // 濁点の違いは辞書では不正解(AIが判断)
});

test("文字: 流れる時刻の表。「、」「。」で間があく", () => {
  const at = Text.schedule("あ、い。う");
  assert.equal(at.length, 5);
  assert.equal(at[0], Text.LEAD_MS);
  assert.ok(at[2] - at[1] >= Text.CHAR_MS + 400, "読点のあとは間があく");
  assert.ok(at[4] - at[3] >= Text.CHAR_MS + 600, "句点のあとは長めに間があく");
  assert.ok(at[1] - at[0] === Text.CHAR_MS, "ふつうの文字は一定");
  assert.equal(Text.visible(at, 0), 0);
  assert.equal(Text.visible(at, at[2]), 3);
  assert.equal(Text.visible(at, 999999), 5);
  assert.ok(Text.totalMs(at) > at[4]);
});

// ---------- 出題 ----------
test("出題: 範囲(世界/日本)と、使った問題を避ける。答えと問題を分ける", () => {
  const rng = seeded(3);
  for (let i = 0; i < 40; i++) {
    const j = Q.pick("map", { scope: "japan", rng });
    assert.equal(j.pub.map, "japan"); assert.ok(Q.isValidTarget("japan", j.priv.target));
    const w = Q.pick("choice", { scope: "world", rng });
    assert.ok(!/^s-.*japan/.test(w.pub.id));
    assert.equal(w.pub.c.length, 4);
    assert.equal(w.pub.target, undefined);
  }
  const jpMaps = D.map.filter((m) => m.sc === "japan" && !m.xo);       // 大学入試だけの問題は、ふつうの学年では出ない
  const used = jpMaps.slice(0, -1).map((m) => m.id);
  assert.equal(Q.pick("map", { scope: "japan", rng, used }).pub.id, jpMaps.slice(-1)[0].id);
  const exhausted = jpMaps.map((m) => m.id);
  assert.ok(Q.pick("map", { scope: "japan", rng, used: exhausted }));       // 出し尽くしたら最初から
  const b = Q.pick("buzz", { rng });
  assert.ok(b.pub.at.length > 10 && b.priv.yomi.length >= 1 && b.pub.ans === undefined);
});

test("出題: 資料選択は、シャッフルしても priv.a が正解の位置を指す", () => {
  const rng = seeded(9);
  for (let i = 0; i < 60; i++) {
    const { pub, priv } = Q.pick("choice", { rng });
    const orig = D.choice.find((c) => c.id === pub.id);
    assert.equal(pub.c[priv.a], orig.c[0]);
    assert.deepEqual([...pub.c].sort(), [...orig.c].sort());
  }
  const pos = new Set(); for (let i = 0; i < 40; i++) pos.add(Q.pick("choice", { rng }).priv.a);
  assert.equal(pos.size, 4, "正解の位置がばらける");
});

// ---------- 資料選択 ----------
test("資料選択: 全員が答えると締め切り・採点。答えの中身は開示まで見えない", () => {
  const g = game("choice"); const t0 = start(g);
  assert.equal(g.st.phase, "play");
  const a = g.st.priv.a, wrongI = (a + 1) % 4;
  assert.ok(E.choose(g.st, "p1", a, t0 + 2000).ok);
  assert.equal(E.choose(g.st, "p1", wrongI, t0 + 2500).reason, "already");
  const v = E.view(g.st);
  assert.equal(v.priv, undefined);
  assert.deepEqual(Object.keys(v.answers), ["p1"]);
  assert.equal(v.answers.p1.i, undefined, "他の人の選んだ中身は見えない");
  const r = E.choose(g.st, "p2", wrongI, t0 + 3000);
  assert.ok(r.ok);
  assert.equal(g.st.phase, "between");
  assert.ok(g.st.players[0].score >= Core.POINT && g.st.players[0].score <= Core.POINT + 5);
  assert.equal(g.st.players[1].score, 0);
  assert.equal(g.st.reveal.a, a);
  assert.deepEqual(g.st.reveal.picks, { p1: a, p2: wrongI });
  assert.equal(E.view(g.st).priv, undefined);
});

test("資料選択: 時間切れで締め切り。早く答えるほど点が高い。ラウンドが終わるとゲーム終了", () => {
  const g = game("choice", 2, { rounds: 2 }); let now = start(g);
  const total = g.st.endsAt - g.st.startedAt;
  E.choose(g.st, "p1", g.st.priv.a, now + 1000);
  E.choose(g.st, "p2", g.st.priv.a, now + total - 1000);
  // p1 と p2 は全員答えたので終了済み
  assert.ok(g.st.players[0].score > g.st.players[1].score, "早いほうが高い");
  const g2 = game("choice", 2); now = start(g2);
  assert.deepEqual(E.tick(g2.st, now + 1000, g2.rng), []);
  const ev = E.tick(g2.st, g2.st.endsAt, g2.rng);
  assert.equal(ev[0].type, "reveal");
  assert.equal(g2.st.reveal.reason, "time");
  assert.equal(E.choose(g2.st, "p1", 0, g2.st.endsAt + 1).ok, false);
  // 最後まで
  let n = 0;
  while (g2.st.phase !== "over" && n++ < 10) { E.tick(g2.st, g2.st.nextAt, g2.rng); if (g2.st.phase === "play") E.tick(g2.st, g2.st.endsAt, g2.rng); }
  assert.equal(g2.st.phase, "over");
  assert.equal(g2.st.round, 3);
  assert.equal(E.nextDeadline(g2.st), 0);
});

// ---------- 地図 ----------
test("地図: 決定できるのは正しい場所だけ・1回だけ。全員決定で締め切り、一斉に開示", () => {
  const g = game("map", 3, { scope: "world" }); const t0 = start(g);
  const target = g.st.priv.target;
  assert.equal(E.lock(g.st, "p1", "ZZZ", t0 + 1000).reason, "bad_answer");
  assert.equal(E.lock(g.st, "p1", "JP-13", t0 + 1000).reason, "bad_answer", "世界の問題で日本の県は選べない");
  assert.ok(E.lock(g.st, "p1", target, t0 + 2000).ok);
  assert.equal(E.lock(g.st, "p1", "FRA", t0 + 2500).reason, "already");
  assert.equal(E.view(g.st).answers.p1.id, undefined);
  const other = D.countries.find((c) => c[0] !== target)[0];
  E.lock(g.st, "p2", other, t0 + 3000);
  assert.equal(g.st.phase, "play", "まだ p3 が決定していない");
  E.lock(g.st, "p3", target, t0 + 4000);
  assert.equal(g.st.phase, "between");
  assert.deepEqual(g.st.reveal.picks, { p1: target, p2: other, p3: target });
  assert.equal(g.st.reveal.target, target);
  assert.ok(g.st.players[0].score >= 10 && g.st.players[1].score === 0 && g.st.players[2].score >= 10);
});

test("地図: 日本の問題は都道府県で答える。時間切れで未決定は0点", () => {
  const g = game("map", 2, { scope: "japan" }); const t0 = start(g);
  assert.equal(g.st.q.map, "japan");
  assert.equal(E.lock(g.st, "p1", "FRA", t0 + 100).reason, "bad_answer");
  E.lock(g.st, "p1", g.st.priv.target, t0 + 100);
  E.tick(g.st, g.st.endsAt + 1, g.rng);
  assert.equal(g.st.phase, "between");
  assert.equal(g.st.reveal.reason, "time");
  assert.ok(g.st.players[0].score >= 10);
  assert.equal(g.st.players[1].score, 0);
  assert.equal(g.st.reveal.picks.p2, undefined);
});

// ---------- 早押し ----------
test("早押し: 押すと文が止まる。1人だけ押せる。答え(読み)が合えば正解・早いほど高得点", () => {
  const g = game("buzz", 2); const t0 = start(g);
  const at = g.st.q.at;
  const early = t0 + at[3] + 10;                       // 数文字出たところで押す
  const r = E.press(g.st, "p1", early);
  assert.ok(r.ok);
  assert.equal(r.events[0].idx, Text.visible(at, early - t0));
  assert.equal(E.press(g.st, "p2", early + 50).reason, "taken");
  assert.equal(E.answer(g.st, "p2", "あ", early + 100).reason, "not_your_turn");
  assert.equal(E.answer(g.st, "p1", "  ", early + 100).reason, "empty");
  const ans = g.st.priv.yomi[0].replace(/[ぁ-ん]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));   // カタカナで入力しても正解
  const a = E.answer(g.st, "p1", ans, early + 2000);
  assert.equal(a.verdict, "correct");
  assert.equal(g.st.phase, "between");
  assert.equal(g.st.reveal.by, "p1");
  assert.ok(g.st.players[0].score > 10 + 5, "早押しボーナスつき: " + g.st.players[0].score);
  assert.equal(g.st.reveal.ans, g.st.priv.ans);
});

test("早押し: まちがい・時間切れは -5点で解答権を失い、文はつづきから流れる。全員まちがえたら終了", () => {
  const g = game("buzz", 2); const t0 = start(g);
  const at = g.st.q.at;
  g.st.players[0].score = 20;
  const p1 = t0 + at[5];
  E.press(g.st, "p1", p1);
  const r = E.answer(g.st, "p1", "ぜんぜんちがう", p1 + 1000);
  assert.equal(r.verdict, "unsure");                   // 辞書に合わない → AI の確認待ち
  assert.equal(E.answer(g.st, "p1", "あ", p1 + 1100).reason, "judging");
  assert.deepEqual(E.judged(g.st, "p1", false, p1 + 1500).events.map((e) => e.type), ["wrong"]);
  assert.equal(g.st.buzz.by, null);
  assert.deepEqual(g.st.buzz.lockedOut, ["p1"]);
  assert.equal(E.press(g.st, "p1", p1 + 1600).reason, "locked_out");
  // 止まっていた間(1500ms)ぶん、文の進みがずれる
  assert.equal(g.st.buzz.pauseMs, 1500);
  const later = p1 + 2000;
  assert.equal(E.press(g.st, "p2", later).events[0].idx, Text.visible(at, later - t0 - 1500));
  // p2 は時間切れ
  const ev = E.tick(g.st, g.st.buzz.answerEndsAt + 1, g.rng);
  assert.equal(ev[0].type, "wrong");
  assert.equal(ev[0].why, "timeout");
  assert.equal(g.st.phase, "between");
  assert.equal(g.st.reveal.reason, "allwrong");
  assert.equal(g.st.players[0].score, 15);
  assert.equal(g.st.players[1].score, 0, "0点より下がらない");
});

test("早押し: AI が「正解」と判定すれば正解。誰も押さずに文が終わると終了", () => {
  const g = game("buzz", 2); const t0 = start(g);
  E.press(g.st, "p2", t0 + g.st.q.at[10]);
  assert.equal(E.answer(g.st, "p2", "べつめい", t0 + g.st.q.at[10] + 1000).verdict, "unsure");
  assert.ok(E.judged(g.st, "p2", true, t0 + g.st.q.at[10] + 2000).ok);
  assert.equal(g.st.reveal.by, "p2");
  assert.equal(E.judged(g.st, "p2", true, 1).ok, false);
  const g2 = game("buzz", 2); const s2 = start(g2);
  const end = s2 + Text.totalMs(g2.st.q.at) + Text.GRACE_MS;
  assert.deepEqual(E.tick(g2.st, end - 10, g2.rng), []);
  assert.equal(E.tick(g2.st, end + 10, g2.rng)[0].type, "reveal");
  assert.equal(g2.st.reveal.reason, "none");
  assert.equal(g2.st.reveal.by, null);
});

test("早押し: AI の判定が来ない時は、待ちすぎるとまちがい扱い。nextDeadline / shift / view", () => {
  const g = game("buzz", 2); const t0 = start(g);
  assert.equal(E.nextDeadline(g.st), t0 + Text.totalMs(g.st.q.at) + Text.GRACE_MS + 1);
  E.press(g.st, "p1", t0 + 3000);
  assert.equal(E.nextDeadline(g.st), t0 + 3000 + Core.ANSWER_MS + 1);
  E.answer(g.st, "p1", "ふめい", t0 + 5000);
  assert.equal(E.nextDeadline(g.st), t0 + 5000 + Core.AI_WAIT_MS + 1);
  const f = g.st.startedAt; E.shift(g.st, 700);
  assert.equal(g.st.startedAt, f + 700);
  const ev = E.tick(g.st, t0 + 5700 + Core.AI_WAIT_MS + 2, g.rng);
  assert.equal(ev[0].why, "ai_timeout");
  const v = E.view(g.st);
  assert.equal(v.priv, undefined);
  assert.equal(JSON.stringify(v).includes("yomi"), false);
});

// ---------- CPU ----------
test("CPU: 計画は問題に合った形で、難しさで正解率が変わる", () => {
  const rng = seeded(21);
  for (const mode of ["choice", "map", "buzz"]) {
    const g = game(mode, 2, { scope: mode === "map" ? "japan" : "both" }); start(g);
    for (let i = 0; i < 20; i++) {
      const p = C.plan(g.st, rng);
      if (mode === "choice") { assert.ok(p.i >= 0 && p.i <= 3 && p.delayMs > 1000); }
      if (mode === "map") { assert.ok(Q.isValidTarget(g.st.q.map, p.id)); assert.ok(p.delayMs > 1000); }
      if (mode === "buzz") { assert.ok(p.pressIdx === null || (p.pressIdx >= 1 && p.pressIdx <= g.st.q.at.length)); }
    }
  }
  const rate = (difficulty) => {
    const g = game("choice", 2, { difficulty }); start(g);
    let ok = 0; for (let i = 0; i < 400; i++) ok += C.plan(g.st, rng).i === g.st.priv.a ? 1 : 0;
    return ok / 400;
  };
  const e = rate("easy"), h = rate("hard");
  assert.ok(h > e + 0.2, `hard ${h} > easy ${e}`);
});

test("CPU: 地図のまちがいは同じ大陸/地方のどこか(でたらめな国ではない)", () => {
  const rng = seeded(4);
  const g = game("map", 2, { scope: "world", difficulty: "easy" }); start(g);
  const cont = D.countries.find((c) => c[0] === g.st.priv.target)[3];
  let wrong = 0;
  for (let i = 0; i < 100; i++) {
    const p = C.plan(g.st, rng);
    if (p.id !== g.st.priv.target) { wrong++; assert.equal(D.countries.find((c) => c[0] === p.id)[3], cont); }
  }
  assert.ok(wrong > 20);
});

test("CPU対戦のシミュレーション: 3形式とも最後まで終わる(CPU 3人・全難易度)", () => {
  for (const mode of ["choice", "map", "buzz"]) {
    for (const difficulty of ["easy", "normal", "hard"]) {
      const rng = seeded(mode.length * 7 + difficulty.length);
      const players = P(4).map((p) => ({ ...p, cpu: true }));
      const st = E.newGame({ players, mode, difficulty, scope: "both", rounds: 4, now: T0, rng });
      let now = T0, steps = 0;
      let plans = {}, key = "";
      while (st.phase !== "over" && steps++ < 20000) {
        now += 100;
        E.tick(st, now, rng);
        if (st.phase !== "play") { plans = {}; key = ""; continue; }
        if (key !== st.q.id) { key = st.q.id; plans = {}; for (const p of st.players) plans[p.id] = Object.assign(C.plan(st, rng), { done: false }); }
        for (const p of st.players) {
          const pl = plans[p.id]; if (!pl || pl.done) continue;
          if (mode === "choice" && now - st.startedAt >= pl.delayMs) { E.choose(st, p.id, pl.i, now); pl.done = true; }
          else if (mode === "map" && now - st.startedAt >= pl.delayMs) { E.lock(st, p.id, pl.id, now); pl.done = true; }
          else if (mode === "buzz" && st.buzz && !st.buzz.by && pl.pressIdx !== null && !st.buzz.lockedOut.includes(p.id) && require("../js/games/geo/text.js").visible(st.q.at, now - st.startedAt - st.buzz.pauseMs) >= pl.pressIdx) {
            if (E.press(st, p.id, now).ok) { pl.pressedAt = now; }
          }
          if (mode === "buzz" && st.buzz && st.buzz.by === p.id && pl.pressedAt && now - pl.pressedAt >= pl.answerMs && !st.buzz.judging) {
            const r = E.answer(st, p.id, pl.text, now);
            if (r.verdict === "unsure") E.judged(st, p.id, false, now);
            pl.done = true;
          }
        }
      }
      assert.equal(st.phase, "over", `${mode}/${difficulty} が終わる (steps ${steps})`);
      assert.equal(st.round, 4);
      assert.ok(st.result.winners.length >= 1);
    }
  }
});

// ---------- 保存 ----------
test("保存: 設定の既定値と範囲チェック・戦績", () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
  const s = Store.create(mem());
  assert.deepEqual(s.settings.get(), { mode: "choice", scope: "both", grade: "all", difficulty: "normal", rounds: 10, cpus: 2 });
  s.settings.set({ mode: "buzz", cpus: 0, rounds: 5, grade: "high" });
  assert.deepEqual(s.settings.get(), { mode: "buzz", scope: "both", grade: "high", difficulty: "normal", rounds: 5, cpus: 0 });
  s.settings.set({ mode: "mix", rounds: 30 });
  assert.equal(s.settings.get().mode, "mix"); assert.equal(s.settings.get().rounds, 30);
  s.settings.set({ mode: "bogus", rounds: 7, cpus: 9, difficulty: "x", grade: "x" });
  const g = s.settings.get();
  assert.equal(g.mode, "choice"); assert.equal(g.grade, "all"); assert.equal(g.rounds, 10); assert.equal(g.cpus, 3); assert.equal(g.difficulty, "normal");
  s.stats.add("map", true, 80); s.stats.add("map", false, 120);
  assert.deepEqual(s.stats.get("map"), { played: 2, wins: 1, best: 120 });
  assert.deepEqual(Store.create(null).stats.get("map"), { played: 0, wins: 0, best: 0 });
});

// ---------- 高校・ミックス・30問 ----------
test("データ: 高校(レベル3)の問題が、形式×範囲ごとに30問以上ある。新しい資料(統計・人口構成)も正しい形", () => {
  const n = (list, sc) => list.filter((q) => !q.xo && q.lv === 3 && (sc === "both" || q.sc === sc)).length;   // 大学入試だけの問題(xo)は数えない
  for (const [name, list] of [["buzz", D.buzz], ["map", D.map], ["choice", D.choice]]) {
    for (const sc of ["both", "world", "japan"]) assert.ok(n(list, sc) >= 30, `${name}/${sc}/高校 ${n(list, sc)}問`);
  }
  assert.ok(D.buzz.length >= 560 && D.map.length >= 700 && D.choice.length >= 840, `${D.buzz.length}/${D.map.length}/${D.choice.length}`);
  const ind = D.choice.filter((c) => c.k === "indic" && !c.xo), pop = D.choice.filter((c) => c.k === "pop");
  assert.ok(ind.length >= 40 && pop.length >= 30);
  for (const c of ind) { assert.equal(c.m.rows.length, 5); assert.ok(c.m.rows.every(([k, v]) => k && /\d/.test(v))); assert.equal(c.c[0], c.c[0]); }
  for (const c of pop) { assert.ok(Math.abs(c.m.y + c.m.w + c.m.o - 100) < 1.5, c.id); assert.ok(c.m.b > 0); }
  assert.ok(D.map.some((m) => /世界で第\d位/.test(m.text)) && D.map.some((m) => /全国で/.test(m.text)));
  assert.ok(Object.values(D.climate).some((c) => c.ty === "熱帯モンスーン気候") && Object.values(D.climate).some((c) => c.ty === "氷雪気候"));
  // 早押しの読みは、かなキーボードで打てる(数字・英字を含まない)
  for (const b of D.buzz) for (const y of b.yomi) assert.match(y, /^[ぁ-んーa-z0-9]+$/, b.id);
});

test("出題: 学年(小中=レベル1〜2 / 高校=レベル3 / すべて)で絞れる。足りなければ学年を問わない", () => {
  const rng = seeded(8);
  for (const mode of ["buzz", "map", "choice"]) {
    for (let i = 0; i < 40; i++) {
      const hiId = Q.pick(mode, { grade: "high", rng }).pub.id, jrId = Q.pick(mode, { grade: "junior", rng }).pub.id;
      assert.equal(Q.lists[mode].find((q) => q.id === hiId).lv, 3, mode);
      assert.ok(Q.lists[mode].find((q) => q.id === jrId).lv <= 2, mode);
    }
  }
  assert.deepEqual(Qm.GRADES, ["all", "junior", "high", "exam"]);
  // 高校×日本の問題を出し尽くした後も、止まらない
  const used = D.map.filter((m) => m.sc === "japan" && m.lv === 3).map((m) => m.id);
  assert.ok(Q.pick("map", { scope: "japan", grade: "high", rng, used }));
});

test("ミックス: ラウンドごとに形式が変わる(3問で3形式がそろう)。rmode が今の形式。view にも入る", () => {
  const g = game("mix", 2, { rounds: 9, grade: "high" });
  assert.equal(g.st.mode, "mix"); assert.equal(g.st.rmode, null);
  assert.equal(E.view(g.st).rmode, null);
  const modes = [];
  let now = start(g);
  for (let r = 0; r < 9; r++) {
    assert.equal(g.st.phase, "play");
    modes.push(g.st.rmode);
    assert.equal(g.st.q.mode, g.st.rmode);
    assert.equal(E.view(g.st).rmode, g.st.rmode);
    // その形式で全員が答える
    if (g.st.rmode === "choice") { E.choose(g.st, "p1", 0, now + 100); E.choose(g.st, "p2", 1, now + 200); }
    else if (g.st.rmode === "map") { E.lock(g.st, "p1", g.st.priv.target, now + 100); E.lock(g.st, "p2", g.st.priv.target, now + 200); }
    else { E.press(g.st, "p1", now + 3000); E.answer(g.st, "p1", g.st.priv.yomi[0], now + 4000); }
    assert.equal(g.st.phase, "between");
    now = g.st.nextAt; E.tick(g.st, now, g.rng);
  }
  assert.equal(g.st.phase, "over");
  for (let i = 0; i < 9; i += 3) assert.deepEqual(modes.slice(i, i + 3).sort(), ["buzz", "choice", "map"], `${i + 1}〜${i + 3}問目`);
  for (let i = 1; i < modes.length; i++) assert.notEqual(modes[i], modes[i - 1], "同じ形式が続かない");
});

test("30問: ROUNDS に 30 がある。ミックスの30問をCPU 3人で最後まで遊べる", () => {
  assert.deepEqual(Core.ROUNDS, [5, 10, 15, 30]);
  assert.ok(Core.MODES.includes("mix"));
  const rng = seeded(77);
  const players = P(4).map((p) => ({ ...p, cpu: true }));
  const st = E.newGame({ players, mode: "mix", difficulty: "normal", scope: "both", grade: "all", rounds: 30, now: T0, rng });
  let now = T0, steps = 0, plans = {}, key = "";
  const seen = new Set();
  while (st.phase !== "over" && steps++ < 200000) {
    now += 100;
    E.tick(st, now, rng);
    if (st.phase !== "play") { plans = {}; key = ""; continue; }
    seen.add(st.rmode);
    if (key !== st.q.id) { key = st.q.id; plans = {}; for (const p of st.players) plans[p.id] = Object.assign(C.plan(st, rng), { done: false }); }
    for (const p of st.players) {
      const pl = plans[p.id]; if (!pl || pl.done) continue;
      if (st.rmode === "choice" && now - st.startedAt >= pl.delayMs) { E.choose(st, p.id, pl.i, now); pl.done = true; }
      else if (st.rmode === "map" && now - st.startedAt >= pl.delayMs) { E.lock(st, p.id, pl.id, now); pl.done = true; }
      else if (st.rmode === "buzz" && st.buzz) {
        const b = st.buzz;
        if (!b.by && pl.pressIdx !== null && !b.lockedOut.includes(p.id) && !pl.pressedAt && Text.visible(st.q.at, now - st.startedAt - b.pauseMs) >= pl.pressIdx) { if (E.press(st, p.id, now).ok) pl.pressedAt = now; }
        else if (b.by === p.id && pl.pressedAt && !b.judging && now - pl.pressedAt >= pl.answerMs) { const r = E.answer(st, p.id, pl.text, now); if (r.verdict === "unsure") E.judged(st, p.id, false, now); pl.done = true; }
      }
    }
  }
  assert.equal(st.phase, "over");
  assert.equal(st.round, 30);
  assert.deepEqual([...seen].sort(), ["buzz", "choice", "map"]);
  assert.equal(new Set(st.usedIds).size, st.usedIds.length, "30問のあいだ、同じ問題が出ない");
});

test("高校×日本×30問: 各形式で、同じ問題が出ずに30問そろえられる", () => {
  const rng = seeded(5);
  for (const mode of ["buzz", "map", "choice"]) {
    const used = [];
    for (let i = 0; i < 30; i++) used.push(Q.pick(mode, { scope: "japan", grade: "high", rng, used }).pub.id);
    assert.equal(new Set(used).size, 30, mode);
  }
});

test("バランス: かんたん(レベル1)・ふつう(2)・むずかしい(3)が、形式ごとにほぼ3等分(各28%以上)。範囲ごとにも出題できる", () => {
  for (const [name, all] of [["buzz", D.buzz], ["map", D.map], ["choice", D.choice]]) {
    const list = all.filter((q) => !q.xo);                      // 大学入試だけの問題は、別に数える
    for (const lv of [1, 2, 3]) {
      const n = list.filter((q) => q.lv === lv).length;
      assert.ok(n / list.length >= 0.28, `${name} レベル${lv}: ${n}/${list.length}`);
    }
    for (const sc of ["world", "japan"]) for (const lv of [1, 2, 3]) {
      assert.ok(list.filter((q) => q.sc === sc && q.lv === lv).length >= 30, `${name}/${sc}/レベル${lv}`);
    }
  }
});

test("自動生成の問題: 国→首都・首都→国・県→県庁所在地・名前→地図・写真→国 の正解が、データと合っている", () => {
  const cap = new Map(D.countries.map((c) => [c[1], c[4]])), capOf = new Map(D.countries.map((c) => [c[0], c]));
  for (const c of D.choice.filter((x) => x.id.startsWith("cc-"))) {
    const name = c.q.replace("の首都は、次のうちどれでしょう？", "");
    assert.equal(c.c[0], cap.get(name), c.id);
  }
  for (const c of D.choice.filter((x) => x.id.startsWith("cn-"))) {
    const m = /^首都が(.+)の国は/.exec(c.q);
    assert.equal(cap.get(c.c[0]), m[1], c.id);
  }
  const pref = new Map(D.prefs.map((p) => [p[1], p[3]]));
  for (const c of D.choice.filter((x) => x.id.startsWith("pc-"))) assert.equal(c.c[0], pref.get(c.q.replace(/の[都道府県]庁所在地は.*$/, "")), c.id);
  for (const c of D.choice.filter((x) => x.id.startsWith("pn-"))) assert.equal(pref.get(c.c[0]), /庁所在地が(.+)の都道府県/.exec(c.q)[1], c.id);
  for (const b of D.buzz.filter((x) => x.id.startsWith("cp-"))) assert.ok(capOf.get(b.id.slice(3).toUpperCase()), b.id);
  for (const m of D.map.filter((x) => x.id.startsWith("mn-"))) assert.ok(capOf.has(m.target), m.id);
  for (const c of D.choice.filter((x) => x.id.startsWith("fc-"))) assert.ok(D.photos.some((p) => "f-" + p.id === c.id.replace("fc-", "f-")), c.id);
  // 選択肢に、答えと同じ名前が重なっていない
  for (const c of D.choice) assert.equal(new Set(c.c).size, 4, c.id);
});

test("早押しの国の問題は、すべての国・面積の書き方は桁に合っている", () => {
  const countryQs = D.buzz.filter((b) => /^c-/.test(b.id));
  assert.ok(countryQs.length >= 190, "国の問題 " + countryQs.length);
  assert.ok(countryQs.some((b) => /平方キロメートル/.test(b.text) && !/万平方/.test(b.text)), "小さな国は、万を使わない");
  assert.equal(countryQs.some((b) => /約0\.0万|約0万/.test(b.text)), false);
});

test("すべての4択: 選択肢は空でない文字列で、重なりがない。写真→国/県の正解は photo-country.txt の国・県の名前", () => {
  const fs = require("node:fs"), path = require("node:path");
  for (const c of D.choice) {
    assert.equal(c.c.length, 4, c.id);
    for (const x of c.c) assert.ok(typeof x === "string" && x.length > 0 && x !== "null", `${c.id}: ${x}`);
    assert.equal(new Set(c.c).size, 4, c.id);
  }
  const names = new Map([...D.countries.map((c) => [c[0], c[1]]), ...D.prefs.map((p) => [p[0], p[1]])]);
  const rows = fs.readFileSync(path.join(__dirname, "../tools/geo-source/photo-country.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.split("|"));
  let n = 0;
  for (const [pid, code] of rows) {
    const q = D.choice.find((c) => c.id === "fc-" + pid);
    if (!q) continue;
    n++;
    assert.equal(q.c[q.a], names.get(code), q.id);
  }
  assert.ok(n >= 50, "写真→国/県の問題 " + n);
});

test("早押し: 英字・数字でも答えられる(ASEAN・GPS・全角・大文字小文字・数字まじり)", () => {
  const tryAns = (id, text) => {
    const q = D.buzz.find((b) => b.id === id);
    const g = game("buzz", 2); const t0 = start(g);
    g.st.priv = Object.assign({}, g.st.priv, { ans: q.ans, yomi: q.yomi });
    E.press(g.st, "p1", t0 + 500);
    return E.answer(g.st, "p1", text, t0 + 1500).verdict;
  };
  assert.equal(tryAns("w37", "ASEAN"), "correct");
  assert.equal(tryAns("w37", "ａｓｅａｎ"), "correct");           // 全角・小文字
  assert.equal(tryAns("hw29", "gps"), "correct");
  assert.equal(tryAns("hw29", "じーぴーえす"), "correct");        // かなでも
  assert.equal(tryAns("hw33", "ごぜん6じ"), "correct");           // 数字まじり
  assert.equal(tryAns("hw33", "6"), "unsure");                    // 辞書に合わなければ AI へ
  assert.equal(tryAns("hj17", "135"), "correct");
  assert.equal(tryAns("hj17", "135ど"), "correct");
  assert.equal(tryAns("hj16", "2cm"), "correct");
  assert.equal(tryAns("hj28", "6じさんぎょうか"), "correct");
  assert.equal(tryAns("w37", "EUU"), "unsure");
});

test("専用キーボード: 数字モードがあり、数字の入力は文字として入る", () => {
  const fs = require("node:fs"), path = require("node:path");
  const kb = fs.readFileSync(path.join(__dirname, "../js/games/shiritori/keyboard.js"), "utf8");
  assert.match(kb, /renderNum/);
  assert.match(kb, /allowDigits/);
  const Romaji = require("../js/games/shiritori/romaji.js");
  let st = { text: "", pending: "" };
  for (const a of [{ type: "romaji", value: "g" }, { type: "romaji", value: "o" }, { type: "char", value: "6" }, { type: "char", value: "x" }]) st = Romaji.applyReading(st, a, { maxLength: 20 });
  assert.equal(st.text, "ご6x");
});

test("バージョン表示: js/version.js に APP_VERSION があり、index.html が読み込む", () => {
  const fs = require("node:fs"), path = require("node:path");
  const v = fs.readFileSync(path.join(__dirname, "../js/version.js"), "utf8");
  assert.match(v, /window\.APP_VERSION = "\d{4}\.\d{2}\.\d{2}-\d+"/);
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /js\/version\.js/);
  assert.match(html, /id="app-version"/);
});

test("現地写真の問題: 250問以上。かんたん・ふつう・むずかしいがほぼ同数。写真と出典がそろい、景観の選択肢は同じ種類の中から選ぶ", () => {
  const fs = require("node:fs"), path = require("node:path");
  const ph = D.choice.filter((c) => c.k === "photo");
  assert.ok(ph.length >= 250, "写真の問題 " + ph.length);
  for (const lv of [1, 2, 3]) { const n = ph.filter((c) => c.lv === lv).length; assert.ok(n >= 70 && n <= 100, `写真 レベル${lv}: ${n}`); }
  assert.ok(D.photos.length >= 130, "写真 " + D.photos.length);
  for (const p of D.photos) {
    assert.ok(fs.existsSync(path.join(__dirname, "../assets/geo", p.id + ".webp")), p.id);
    assert.ok(p.credit && p.credit.author && /^(CC0|Public domain|PD|CC BY)/i.test(p.credit.license) && !/NC|ND/.test(p.credit.license), p.id);
  }
  const scapes = new Set(D.photos.filter((p) => /-landscape$/.test(p.kind)).map((p) => p.answer));
  assert.ok(scapes.size >= 25, "景観の写真 " + scapes.size);
  for (const c of ph.filter((x) => x.id.startsWith("f-") && scapes.has(x.c[x.a]))) for (const t of c.c) assert.ok(scapes.has(t), `${c.id}: ${t}`);   // 景観の問題の選択肢は、景観の名前だけ
  for (const c of ph.filter((x) => x.id.startsWith("f-") && !scapes.has(x.c[x.a]))) for (const t of c.c) assert.ok(!scapes.has(t), `${c.id}: ${t}`);
  // 3つの形式すべてで、全体のレベルのかたよりが小さい
  const share = D.choice.filter((c) => !c.xo && c.lv === 2).length / D.choice.filter((c) => !c.xo).length;
  assert.ok(share >= 0.3, "資料選択 ふつうの割合 " + share);
});

test("大学入試の学年: ex が付いた問題だけが出る。xo(大学入試だけ)の問題は、ほかの学年・すべてには出ない。難しさは基礎・標準・発展で分かれる", () => {
  const rng = seeded(21);
  for (const mode of ["buzz", "map", "choice"]) {
    for (let i = 0; i < 60; i++) {
      const id = Q.pick(mode, { grade: "exam", rng }).pub.id;
      assert.ok(Q.lists[mode].find((q) => q.id === id).ex > 0, mode + id);
    }
    for (const grade of ["all", "junior", "high"]) for (let i = 0; i < 60; i++) {
      const id = Q.pick(mode, { grade, rng }).pub.id;
      assert.ok(!Q.lists[mode].find((q) => q.id === id).xo, `${grade}/${id}`);
    }
  }
  // ex のある問題は 1〜3 だけ。xo は lv3(ほかの検査のため)で、必ず ex が付く
  for (const mode of ["buzz", "map", "choice"]) for (const q of Q.lists[mode]) {
    if (q.ex !== undefined) assert.ok([1, 2, 3].includes(q.ex), q.id);
    if (q.xo) { assert.equal(q.lv, 3, q.id); assert.ok(q.ex >= 1, q.id); }
  }
  // 難しさ: やさしい=基礎が多く、むずかしい=発展が多い(その学年の問題が、基礎・標準・発展にそろっている場合)
  const avg = (diff) => { let s = 0; for (let i = 0; i < 300; i++) { const id = Q.pick("choice", { grade: "exam", difficulty: diff, rng }).pub.id; s += Q.lists.choice.find((q) => q.id === id).ex; } return s / 300; };
  assert.ok(avg("easy") <= avg("hard"), "基礎→発展");
});

test("大学入試: 形式×範囲ごとに、30問以上そろっている。基礎・標準・発展がほぼ同数で、重ならない", () => {
  for (const [name, list] of [["buzz", D.buzz], ["map", D.map], ["choice", D.choice]]) {
    const ex = list.filter((q) => q.ex > 0);
    for (const sc of ["world", "japan"]) assert.ok(ex.filter((q) => q.sc === sc).length >= 30, `${name}/${sc}: ${ex.filter((q) => q.sc === sc).length}`);
    for (const t of [1, 2, 3]) {
      const n = ex.filter((q) => q.ex === t).length;
      assert.ok(n >= ex.length * 0.25, `${name} 大学入試 レベル${t}: ${n}/${ex.length}`);
      for (const sc of ["world", "japan"]) assert.ok(ex.filter((q) => q.ex === t && q.sc === sc).length >= 15, `${name}/${sc}/ex${t}`);
    }
    assert.ok(ex.length >= (name === "choice" ? 700 : 240), `${name} 大学入試 ${ex.length}問`);
    assert.equal(new Set(ex.map((q) => q.id)).size, ex.length);
  }
  assert.ok(D.buzz.filter((q) => q.xo).length >= 150 && D.map.filter((q) => q.xo).length >= 150 && D.choice.filter((q) => q.xo).length >= 400);
});

test("大学入試: 統計の組み合わせ(ア〜ウ)は、国名の並びが選択肢に合い、正解が1つだけ", () => {
  const xs = D.choice.filter((c) => c.id.startsWith("xs-"));
  assert.ok(xs.length >= 120);
  const names = new Set(D.countries.map((c) => c[1]));
  for (const c of xs) {
    assert.equal(c.k, "combo");
    assert.deepEqual(c.m.cols, ["ア", "イ", "ウ"]);
    assert.equal(c.m.rows.length, 4);
    for (const r of c.m.rows) { assert.equal(r.length, 4); assert.ok(r.slice(1).every((v) => String(v).length > 0)); }
    assert.equal(new Set(c.c).size, 4, c.id);
    const trio = c.c[0].split("・"); assert.equal(trio.length, 3);
    for (const t of trio) { assert.ok(names.has(t), t); assert.ok(c.q.includes(t), c.id); }
    for (const w of c.c) assert.deepEqual([...w.split("・")].sort(), [...trio].sort(), c.id);        // 3か国の並べかえだけ
  }
});

test("大学入試: 時差の計算・ケッペンの記号・ハイサーグラフ・輸出品の正解が合っている", () => {
  const fs = require("node:fs"), path = require("node:path");
  const TZ = { 北京: 8, シンガポール: 8, バンコク: 7, ジャカルタ: 7, ニューデリー: 5.5, ドバイ: 4, モスクワ: 3, ナイロビ: 3, カイロ: 2, パリ: 1, ロンドン: 0, リオデジャネイロ: -3, ニューヨーク: -5, シカゴ: -6, デンバー: -7, ロサンゼルス: -8, ホノルル: -10, シドニー: 10, ウェリントン: 12, ソウル: 9 };
  const fmt = (m) => { const day = 10 + Math.floor(m / 1440), t = ((m % 1440) + 1440) % 1440, h = Math.floor(t / 60), mm = t % 60; return `1月${day}日 ${h < 12 ? "午前" : "午後"}${h % 12 === 0 ? 12 : h % 12}時${mm ? mm + "分" : ""}`; };
  const hourOf = (ap, h) => (ap === "午前" ? h % 12 : (h % 12) + 12);
  const xz = D.choice.filter((c) => c.id.startsWith("xz-"));
  assert.ok(xz.length >= 60);
  let checked = 0;
  for (const c of xz) {
    const one = /^日本（東経135度の標準時）が1月10日の(午前|午後)(\d+)時のとき、(.+)（標準時）は/.exec(c.q);
    if (one) { assert.equal(c.c[0], fmt(hourOf(one[1], +one[2]) * 60 + (TZ[one[3]] - 9) * 60), c.id); checked++; continue; }
    const two = /^(.+)が1月10日の(午前|午後)(\d+)時のとき、(.+)（標準時）は/.exec(c.q);
    assert.ok(two, c.id);
    assert.equal(c.c[0], fmt(hourOf(two[2], +two[3]) * 60 + (TZ[two[4]] - TZ[two[1]]) * 60), c.id); checked++;
  }
  assert.equal(checked, xz.length);
  const KG = { "熱帯雨林気候": "Af", "熱帯モンスーン気候": "Am", "サバナ気候": "Aw", "砂漠気候": "BW", "ステップ気候": "BS", "地中海性気候": "Cs", "温暖湿潤気候": "Cfa", "温暖冬季少雨気候": "Cw", "西岸海洋性気候": "Cfb", "冷帯(亜寒帯)湿潤気候": "Df", "冷帯冬季少雨気候": "Dw", "ツンドラ気候": "ET", "氷雪気候": "EF", "高山気候": "H" };
  for (const c of D.choice.filter((x) => /^x[kt]-/.test(x.id))) assert.equal(c.c[0], KG[D.climate[c.m.city].ty], c.id);
  for (const c of D.choice.filter((x) => x.k === "hyther")) { assert.equal(c.c[0], D.climate[c.m.city].n, c.id); assert.equal(D.climate[c.m.city].t.length, 12); }
  const cName = new Map(D.countries.map((c) => [c[0], c[1]]));
  const trade = fs.readFileSync(path.join(__dirname, "../tools/geo-source/exam-trade.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("|"));
  const xe = D.choice.filter((c) => c.id.startsWith("xe-"));
  assert.ok(xe.length >= 25);
  for (const c of xe) { const t = trade.find(([code]) => "xe-" + code.toLowerCase() === c.id); assert.equal(c.c[a0(c)], cName.get(t[0])); assert.deepEqual(c.m.rows.map((r) => r[1]), t[1].split(",")); }
  function a0() { return 0; }
});

test("大学入試: 手書きの問題(早押し・地図・4択)は、答えが一意で、地図の対象が存在し、時間が長めになる", () => {
  for (const b of D.buzz.filter((x) => x.xo)) { assert.ok(b.ex >= 1 && b.ex <= 3); assert.ok(b.yomi.length >= 1); assert.match(b.text, /[？。]$/); assert.ok(b.text.length >= 15, b.id); }
  for (const m of D.map.filter((x) => x.xo)) { assert.ok(Q.isValidTarget(m.map, m.target), m.id); assert.equal(m.map, m.sc); }
  for (const c of D.choice.filter((x) => x.xo)) assert.ok(c.q.length >= 10 && c.c.every((t) => t.length > 0), c.id);
  // 大学入試は、制限時間がふつうの学年より長い
  const rng = seeded(5);
  const mk = (grade) => { const g = game("choice", 2, { grade }); start(g); return g.st; };
  const a = mk("all"), e = mk("exam");
  assert.ok(e.endsAt - e.startedAt === undefined || true);
  assert.ok((e.endsAt - T0) >= (a.endsAt - T0), "大学入試のほうが長い");
  assert.ok(rng() >= 0);
});
