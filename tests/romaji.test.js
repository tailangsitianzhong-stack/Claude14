const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/games/shiritori/romaji.js");
const I = require("../js/games/shiritori/input-logic.js");

/** ローマ字を1文字ずつ打って、確定後のかなを返す */
function type(str, { flush = true, max } = {}) {
  let st = { text: "", pending: "" };
  for (const ch of str) st = R.feed(st, ch, max);
  return flush ? R.flush(st).text : st;
}

test("基本: 母音・各行・濁音・半濁音", () => {
  const cases = {
    a: "あ", ka: "か", ki: "き", ku: "く", se: "せ", to: "と", na: "な", hi: "ひ", mu: "む", ro: "ろ",
    ga: "が", ze: "ぜ", da: "だ", bo: "ぼ", pa: "ぱ", wa: "わ", wo: "を", ya: "や", yu: "ゆ", yo: "よ",
    ringo: "りんご", banana: "ばなな", sakura: "さくら", gorira: "ごりら", inu: "いぬ", neko: "ねこ"
  };
  for (const [k, v] of Object.entries(cases)) assert.equal(type(k), v, k);
});

test("ヘボン式と訓令式の両方 / 拗音", () => {
  const cases = {
    shi: "し", si: "し", chi: "ち", ti: "ち", tsu: "つ", tu: "つ", fu: "ふ", hu: "ふ", ji: "じ", zi: "じ",
    sha: "しゃ", sya: "しゃ", shu: "しゅ", sho: "しょ", cha: "ちゃ", tya: "ちゃ", ja: "じゃ", jo: "じょ", zya: "じゃ",
    kya: "きゃ", kyu: "きゅ", kyo: "きょ", nya: "にゃ", hya: "ひゃ", ryo: "りょ", gyu: "ぎゅ", bya: "びゃ", pyo: "ぴょ", mya: "みゃ",
    kyouto: "きょうと", ryokou: "りょこう", gakkou: "がっこう", juusu: "じゅうす"
  };
  for (const [k, v] of Object.entries(cases)) assert.equal(type(k), v, k);
});

test("外来音: ふぁ ゔぁ てぃ でぃ うぃ", () => {
  assert.equal(type("fa"), "ふぁ");
  assert.equal(type("fi"), "ふぃ");
  assert.equal(type("va"), "ゔぁ");
  assert.equal(type("thi"), "てぃ");
  assert.equal(type("dhi"), "でぃ");
  assert.equal(type("wi"), "うぃ");
  assert.equal(type("thissyu"), "てぃっしゅ");             // ティッシュ
});

test("っ: 同じ子音の連続 / tcha / xtu", () => {
  assert.equal(type("kitte"), "きって");
  assert.equal(type("zasshi"), "ざっし");
  assert.equal(type("matcha"), "まっちゃ");
  assert.equal(type("kappa"), "かっぱ");
  assert.equal(type("xtu"), "っ");
  assert.equal(type("ltu"), "っ");
  assert.equal(type("rukkusakku"), "るっくさっく");        // リュックサック風
});

test("小さい字: xa / la / xya", () => {
  assert.equal(type("xa"), "ぁ");
  assert.equal(type("li"), "ぃ");
  assert.equal(type("xyu"), "ゅ");
  assert.equal(type("kixyo"), "きょ");
});

test("ん: nn / n+子音 / 語末のn / 「onna」", () => {
  assert.equal(type("nn"), "ん");
  assert.equal(type("kan"), "かん");                        // 語末は確定時に ん
  assert.equal(type("kanpai"), "かんぱい");
  assert.equal(type("kannkou"), "かんこう");                // nn + 子音 → ん
  assert.equal(type("konnichiha"), "こんにちは");           // nn + i → ん + に
  assert.equal(type("onna"), "おんな");                     // nn + a → ん + な
  assert.equal(type("kinnyuu"), "きんにゅう");
  assert.equal(type("sennsei"), "せんせい");
  assert.equal(type("mikan"), "みかん");
  assert.equal(type("ninnjin"), "にんじん");
});

test("長音 - と 打ち間違いの扱い", () => {
  assert.equal(type("ko-hi-"), "こーひー");
  assert.equal(type("ju-su"), "じゅーす");
  assert.equal(type("xk"), "");                            // 無効な組は捨てて続ける
  assert.equal(type("qka"), "か");
  assert.equal(type("kkka"), "っっか");
});

test("入力途中の表示と、最大文字数", () => {
  let st = R.feed({ text: "", pending: "" }, "k");
  assert.deepEqual(st, { text: "", pending: "k" });
  st = R.feed(st, "y");
  assert.deepEqual(st, { text: "", pending: "ky" });
  st = R.feed(st, "o");
  assert.deepEqual(st, { text: "きょ", pending: "" });
  // 最大文字数を超えるかなは追加されない
  assert.equal(type("aiueo", { max: 3 }), "あいう");
});

test("applyReading: 削除は入力途中を先に消す / 他の入力は確定してから", () => {
  const A = (st, action, opts) => R.applyReading(st, action, opts);
  let st = { text: "か", pending: "sh" };
  st = A(st, { type: "backspace" });
  assert.deepEqual(st, { text: "か", pending: "s" });
  st = A(st, { type: "backspace" });
  st = A(st, { type: "backspace" });
  assert.deepEqual(st, { text: "", pending: "" });

  // 入力途中の n がある時に、かなキーを押すと「ん」が確定してから続く
  st = A({ text: "か", pending: "n" }, { type: "char", value: "な" });
  assert.deepEqual(st, { text: "かんな", pending: "" });
  // ゛キーは確定後の最後の字に効く
  st = A({ text: "", pending: "" }, { type: "romaji", value: "k" });
  st = A(st, { type: "romaji", value: "o" });
  st = A(st, { type: "dakuten" });
  assert.equal(st.text, "ご");
});

test("flush: n と nn だけ「ん」になる", () => {
  assert.equal(R.flush({ text: "か", pending: "n" }).text, "かん");
  assert.equal(R.flush({ text: "か", pending: "nn" }).text, "かん");
  assert.equal(R.flush({ text: "か", pending: "k" }).text, "か");
});

test("cycle(フリックの゛゜小): ゆれの順に切り替わる", () => {
  const c = (t) => I.applyAction(t, { type: "cycle" });
  assert.deepEqual(["か", c("か"), c(c("か"))], ["か", "が", "か"]);
  assert.deepEqual(["は", c("は"), c(c("は")), c(c(c("は")))], ["は", "ば", "ぱ", "は"]);
  assert.deepEqual(["つ", c("つ"), c(c("つ")), c(c(c("つ")))], ["つ", "っ", "づ", "つ"]);
  assert.deepEqual(["や", c("や"), c(c("や"))], ["や", "ゃ", "や"]);
  assert.deepEqual(["う", c("う"), c(c("う"))], ["う", "ぅ", "ゔ"]);
  assert.equal(c("ん"), "ん");
  assert.equal(c(""), "");
  assert.equal(I.applyAction("きや", { type: "cycle" }), "きゃ");   // 最後の1字だけ
});
