// 化学クイズ: 単元・化学式の表示・答えの照合・計算テンプレート・進行・出題・部屋
const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.window = globalThis;
require("../data/chem.js");
const D = globalThis.CHEM_DATA;
const Units = require("../js/games/chem/units.js");
const Fmt = require("../js/games/chem/fmt.js");
const Text = require("../js/games/chem/text.js");
const Calc = require("../js/games/chem/calc.js");
const Qm = require("../js/games/chem/questions.js");
const Core = require("../js/games/chem/core.js");
const Q = Qm.create(D), E = Core.create(Q);

function seeded(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }

test("単元: 24単元が教科書の順。範囲・まとめ・ラベル。知らない単元は除かれ、全部えらぶと「すべて」", () => {
  assert.equal(Units.LIST.length, 24);
  assert.deepEqual(Units.IDS, Units.LIST.map((u) => u.id));
  assert.deepEqual(Units.range("u15", "u12"), ["u12", "u13", "u14", "u15"]);          // おわりから はじめでもよい
  assert.deepEqual(Units.clean(["u13", "zzz", "u12", "u12"]), ["u12", "u13"]);
  assert.deepEqual(Units.clean(Units.IDS), []);
  assert.equal(Units.label([]), "すべての単元");
  assert.equal(Units.label(["u12", "u13"]), "電池〜電気分解");
  assert.equal(Units.label(["u01", "u05"]), "2単元");
  for (const p of Units.PRESETS) for (const id of p.units) assert.ok(Units.IDS.includes(id), p.key);
  assert.deepEqual(Units.PRESETS.find((p) => p.key === "echem").units, ["u12", "u13"]);
});

test("化学式の表示: 下つき・上つき・指数。HTMLは安全。入力の式は大文字小文字を保つ", () => {
  assert.equal(Fmt.html("[[H2SO4]]"), '<span class="chem-f">H<sub>2</sub>SO<sub>4</sub></span>');
  assert.equal(Fmt.html("[[Cu^2+]]"), '<span class="chem-f">Cu<sup>2+</sup></span>');
  assert.equal(Fmt.html("[[SO4^2-]]"), '<span class="chem-f">SO<sub>4</sub><sup>2−</sup></span>');
  assert.equal(Fmt.html("[[Ca(OH)2]]"), '<span class="chem-f">Ca(OH)<sub>2</sub></span>');
  assert.equal(Fmt.html("6.0×10^23"), "6.0×10<sup>23</sup>");
  assert.equal(Fmt.html("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
  assert.equal(Fmt.plain("[[H2O]]は水"), "H2Oは水");
  assert.equal(Fmt.normalize("H₂SO₄ "), "H2SO4");
  assert.equal(Fmt.normalize("Ｈ２Ｏ"), "H2O");
});

test("答えの照合: 用語は読み(かな・カタカナ・全角)。化学式は大文字小文字を区別。式の中の添え字は、そろえて比べる", () => {
  assert.ok(Text.matches("りゅうさん", ["りゅうさん"]) && Text.matches("リュウサン", ["りゅうさん"]));
  assert.ok(Text.matchesFormula("H2SO4", ["H2SO4"]) && Text.matchesFormula("H₂SO₄", ["H2SO4"]) && Text.matchesFormula("Ｈ２ＳＯ４", ["H2SO4"]));
  assert.equal(Text.matchesFormula("h2so4", ["H2SO4"]), false);
  assert.equal(Text.matchesFormula("Co", ["CO"]), false);                       // コバルトと一酸化炭素
  assert.equal(Text.matchesFormula("CO", ["Co"]), false);
  assert.equal(Text.units("a[[H2O]]、b").length, 4);                            // 化学式は1つの単位
  const at = Text.schedule("ab[[H2O]]、c"); assert.equal(at.length, 5);
});

test("計算テンプレート: 何度つくっても、正解の数と途中式があり、正解を入力すれば正解になる。入力の読みとり", () => {
  const rng = seeded(11);
  const ids = Calc.TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of Calc.TEMPLATES) {
    assert.ok(Units.IDS.includes(t.u) && [1, 2, 3].includes(t.lv) && [0, 1, 2, 3].includes(t.ex) && t.time >= 30, t.id);
    for (let i = 0; i < 120; i++) {
      const q = Calc.build(t, rng);
      assert.ok(Number.isFinite(q.priv.ans), t.id);
      assert.ok(q.pub.text.length > 10 && !/\bNaN\b|undefined|Infinity/.test(q.pub.text + q.priv.steps.join("")), t.id + q.pub.text);
      assert.ok(q.priv.steps.length >= 1);
      assert.ok(Calc.check(Calc.show(q.priv.ans, q.priv.sig), q.priv), `${t.id}: ${q.priv.ans}`);
      assert.equal(Calc.check("xyz", q.priv), false);
    }
  }
  assert.equal(Calc.parse("1.5"), 1.5); assert.equal(Calc.parse("−0.3"), -0.3); assert.equal(Calc.parse("6.0×10^23"), 6e23);
  assert.equal(Calc.parse("1.2e3"), 1200); assert.equal(Calc.parse("3/4"), 0.75); assert.equal(Calc.parse("1.0x10^-3"), 0.001);
  assert.equal(Calc.parse(""), null); assert.equal(Calc.parse("abc"), null); assert.equal(Calc.parse("1.2.3"), null);
  assert.equal(Calc.mass("H2SO4"), 98); assert.equal(Calc.mass("Ca(OH)2"), 74); assert.equal(Calc.mass("CuSO4·5H2O"), 250); assert.equal(Calc.mass("C6H12O6"), 180);
});

test("計算の採点: 許容誤差(相対・絶対)と、有効数字で丸めた値", () => {
  const p = { ans: 2.6, sig: 2, tol: { rel: 0.02 } };
  assert.ok(Calc.check("2.6", p) && Calc.check("2.60", p) && Calc.check("2.62", p));
  assert.equal(Calc.check("2.7", p), false);
  const ph = { ans: 2.7, sig: 2, tol: { abs: 0.06 } };
  assert.ok(Calc.check("2.7", ph) && Calc.check("2.66", ph) && Calc.check("2.75", ph));
  assert.equal(Calc.check("3.0", ph), false);
  const big = { ans: 6.0e23, sig: 2, tol: { rel: 0.02 } };
  assert.ok(Calc.check("6.0×10^23", big) && Calc.check("6e23", big)); assert.equal(Calc.check("6.0×10^22", big), false);
});

test("出題: 学年と単元で絞れる。大学入試は ex の問題だけ。出し尽くしても止まらない。選択肢の正解の位置は priv.a", () => {
  const rng = seeded(3);
  for (const mode of ["calc", "buzz", "choice"]) {
    for (const grade of ["high", "exam"]) {
      const n = Q.count(mode, { grade });
      for (let i = 0; i < 30 && n; i++) {
        const r = Q.pick(mode, { grade, rng });
        const src = (mode === "calc" ? Calc.TEMPLATES : Q.lists[mode]).find((x) => x.id === r.pub.id);
        if (grade === "exam") assert.ok(src.ex > 0, r.pub.id); else assert.ok(!src.xo, r.pub.id);
      }
    }
  }
  const r = Q.pick("calc", { units: ["u13"], rng });
  assert.equal(r.pub.u, "u13");
  const c = Q.pick("choice", { rng });
  if (c) assert.equal(c.pub.c[c.priv.a], Q.lists.choice.find((x) => x.id === c.pub.id).c[0]);
  assert.ok(Q.pick("calc", { units: ["u13"], rng, used: Calc.TEMPLATES.filter((t) => t.u === "u13").map((t) => t.id) }));
});

function play(mode, grade, units) {
  const rng = seeded(8);
  const st = E.newGame({ players: [{ id: "a" }, { id: "b" }], mode, grade, units, rounds: 5, now: 0, rng });
  let now = 0, guard = 0;
  while (st.phase !== "over" && guard++ < 600) {
    now += 1000; E.tick(st, now, rng);
    if (st.phase !== "play") continue;
    if (st.rmode === "choice") { E.choose(st, "a", st.priv.a, now); E.choose(st, "b", (st.priv.a + 1) % 4, now); }
    else if (st.rmode === "calc") { assert.equal(E.calc(st, "a", "abc", now).reason, "bad_answer"); E.calc(st, "a", String(st.priv.ans), now); E.calc(st, "b", "-999", now); }
    else { E.press(st, "a", now + 2000); E.answer(st, "a", st.priv.yomi[0], now + 2500); }
  }
  return st;
}
test("進行: 4つの形式(資料選択・計算・早押し・ミックス)×2学年が最後まで進む。計算は正解10点＋早さ、答え合わせに途中式", () => {
  for (const mode of ["choice", "calc", "buzz", "mix"]) for (const grade of ["high", "exam"]) {
    const st = play(mode, grade, []);
    assert.equal(st.phase, "over", mode + grade);
    assert.ok(st.result.winners.length >= 1);
  }
  const rng = seeded(4);
  const st = E.newGame({ players: [{ id: "a" }, { id: "b" }], mode: "calc", grade: "high", units: [], rounds: 5, now: 0, rng });
  E.tick(st, 2500, rng);
  assert.equal(st.rmode, "calc");
  const t0 = 2500;
  assert.ok(E.calc(st, "a", Calc.show(st.priv.ans, st.priv.sig), t0 + 1000).ok);
  assert.equal(E.calc(st, "a", "1", t0 + 1100).reason, "already");
  assert.ok(E.calc(st, "b", "12345", t0 + 2000).ok);
  assert.equal(st.phase, "between");
  assert.ok(st.reveal.steps.length >= 1 && st.reveal.picks.a.ok === true && st.reveal.picks.b.ok === false);
  assert.ok(st.reveal.gains.a >= 10 && st.reveal.gains.a <= 20 && st.reveal.gains.b === 0);
  assert.equal(E.view(st).priv, undefined);
});

test("進行: 選んだ単元に出せる形式だけがミックスに出る。単元の問題がない形式を選んでも、止まらない", () => {
  const st = E.newGame({ players: [{ id: "a" }, { id: "b" }], mode: "mix", grade: "high", units: ["u13"], rounds: 10, now: 0, rng: seeded(2) });
  for (const m of st.forms) assert.ok(Q.count(m, { grade: "high", units: ["u13"] }) > 0);
  assert.ok(st.forms.includes("calc"));
  const st2 = play("buzz", "high", ["u13"]);                    // 早押しの問題がない単元でも、出せる形式にかわって進む
  assert.equal(st2.phase, "over");
});

test("進行: 通信が切れた人は待たない(地理クイズと同じ)。計算も、残りが全員答えたらすぐ答え合わせ", () => {
  const rng = seeded(6);
  const st = E.newGame({ players: [{ id: "a" }, { id: "b" }, { id: "c" }], mode: "calc", grade: "high", units: [], rounds: 5, now: 0, rng });
  E.tick(st, 2500, rng);
  E.leave(st, "c", 3000);
  E.calc(st, "a", "1", 4000); E.calc(st, "b", "2", 4100);
  assert.equal(st.phase, "between");
  E.back(st, "c", 5000);
  E.tick(st, 99999, rng);
  assert.equal(E.calc(st, "c", "1", 100000).ok, true);        // 次の問題からは答えられる
});

test("計算の検算: 問題文の数字だけを取り出して、別の式で計算しなおした答えと、テンプレートの正解が一致する(代表的な問題)", () => {
  const num = (s) => Number(String(s).replace(/,/g, ""));
  const rng = seeded(77);
  const get = (id) => Calc.TEMPLATES.find((t) => t.id === id);
  const near = (a, b, rel = 1e-3) => Math.abs(a - b) <= Math.abs(b) * rel + 1e-9;
  for (let i = 0; i < 60; i++) {
    let q = Calc.build(get("heat-capacity"), rng), m = /水 (\d+) g .* ([\d.]+) ℃/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[1]) * 4.2 * num(m[2]) / 1000), "heat-capacity");
    q = Calc.build(get("rate-average"), rng); m = /([\d]+) 秒間に ([\d.]+) mol\/L から ([\d.]+) mol\/L/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, (num(m[2]) - num(m[3])) / num(m[1])), "rate-average");
    q = Calc.build(get("ideal-gas-pressure"), rng); m = /([\d.]+) mol の理想気体を、([\d.]+) L の容器に入れて (\d+) K/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[1]) * 8.3 * num(m[3]) / num(m[2])), "ideal-gas");
    q = Calc.build(get("boyle-charles"), rng); m = /圧力 ([\d.]+)×10\^5 Pa、温度 (\d+) K で体積 ([\d.]+) L の気体を、圧力 ([\d.]+)×10\^5 Pa、温度 (\d+) K/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[3]) * num(m[1]) * num(m[5]) / (num(m[4]) * num(m[2]))), "boyle-charles");
    q = Calc.build(get("half-life"), rng); m = /半減期が (\d+) 分.*最初 ([\d.]+) mol\/L であった。(\d+) 分後/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[2]) * 0.5 ** (num(m[3]) / num(m[1]))), "half-life");
    q = Calc.build(get("faraday-mass"), rng); m = /([\d.]+) A の電流で (\d+) 秒間.*原子量 (\w+)=(\d+)/.exec(q.pub.text);
    const nE = { Cu: 2, Ag: 1, Ni: 2 }[m[3]];
    assert.ok(near(q.priv.ans, num(m[1]) * num(m[2]) / 9.65e4 / nE * num(m[4])), "faraday");
    q = Calc.build(get("dilution"), rng); m = /([\d.]+) mol\/L の水溶液 (\d+) mL に水を加えて、([\d.]+) mol\/L/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[1]) * num(m[2]) / num(m[3]) - num(m[2])), "dilution");
    q = Calc.build(get("neutralization-volume"), rng); m = /([\d.]+) mol\/L の(.+?)（\[\[(\w+)\]\]）(\d+) mL を中和するのに、([\d.]+) mol\/L の(.+?)（\[\[([\w()]+)\]\]）/.exec(q.pub.text);
    const val = { HCl: 1, H2SO4: 2, CH3COOH: 1, HNO3: 1, NaOH: 1, "Ba(OH)2": 2, KOH: 1 };
    assert.ok(near(q.priv.ans, val[m[3]] * num(m[1]) * num(m[4]) / (val[m[7]] * num(m[5]))), "neutralization");
    q = Calc.build(get("ph-strong-base"), rng); m = /([\d.]+) mol\/L の.*?（\[\[(\S+?)\]\]）水溶液/.exec(q.pub.text);
    const k = { NaOH: 1, "Ca(OH)2": 2, KOH: 1 }[m[2]];
    assert.ok(Math.abs(q.priv.ans - (14 + Math.log10(num(m[1]) * k))) < 0.01, "ph-strong-base");
    q = Calc.build(get("solubility-crystals"), rng); m = /高温で (\d+) g\/100 g 水、低温で (\d+) g\/100 g 水.*飽和水溶液 (\d+) g/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[3]) * (num(m[1]) - num(m[2])) / (100 + num(m[1]))), "solubility");
    q = Calc.build(get("osmotic-pressure"), rng); m = /([\d.]+) mol\/L の非電解質水溶液の、(\d+) K/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[1]) * 8.3 * num(m[2])), "osmotic");
    q = Calc.build(get("lattice-density"), rng); m = /一辺は ([\d.]+)×10\^−8 cm.*原子の数は (\d+)、原子量は (\d+)/.exec(q.pub.text);
    assert.ok(near(q.priv.ans, num(m[2]) * num(m[3]) / (6.0e23 * (num(m[1]) * 1e-8) ** 3)), "lattice");
    q = Calc.build(get("freezing-point"), rng); m = /水 (\d+) g に (\S+?)（\[\[(\S+?)\]\]、式量 ([\d.]+)）([\d.]+) g/.exec(q.pub.text);
    const iF = { C6H12O6: 1, C12H22O11: 1, NaCl: 2, CaCl2: 3 }[m[3]];
    assert.ok(near(q.priv.ans, 1.85 * (num(m[5]) / num(m[4])) / (num(m[1]) / 1000) * iF, 0.02), "freezing");
  }
});
