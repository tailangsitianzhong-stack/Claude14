const test = require("node:test");
const assert = require("node:assert/strict");
const Rules = require("../js/games/shiritori/rules.js");
const Dict = require("../js/games/shiritori/dictionary.js");
const Judge = require("../js/games/shiritori/judge.js");

// 実データ(data/words.js)を読み込む
global.window = {};
require("../data/words.js");
const DATA = window.SHIRITORI_WORDS;
const dict = Dict.create(DATA);

/** 再現性のある乱数 */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("辞書データの整合性", () => {
  assert.ok(DATA.count > 30000);
  assert.equal(DATA.count, DATA.pairs.length);
  for (const [r, e, l, f] of DATA.pairs) {
    assert.equal(Rules.normalizeReading(r), r, `reading ${r}`);
    assert.match(e, /^[a-z]{2,20}$/);
    assert.ok(l >= 1 && l <= 3 && f >= 0 && f <= 7);
  }
});

test("定番の語が引ける（カタカナ・大文字も可）", () => {
  for (const [r, e] of [["りんご", "apple"], ["いぬ", "dog"], ["ねこ", "cat"], ["がっこう", "school"],
                        ["みず", "water"], ["じゅーす", "juice"], ["みかん", "orange"], ["えき", "station"]]) {
    assert.ok(dict.lookup(r, e), `${r}=${e}`);
  }
  assert.ok(dict.lookup("リンゴ", "APPLE"));
  assert.equal(dict.lookup("りんご", "apples"), null);
  assert.equal(dict.lookup("りんご", "dog"), null);
});

test("不適切語は入っていない", () => {
  const bad = new Set(["fuck", "shit", "bitch", "penis", "vagina", "sex", "porn", "rape"]);
  assert.equal(DATA.pairs.filter((p) => bad.has(p[1])).length, 0);
});

test("editDistance", () => {
  assert.equal(Dict.editDistance("apple", "apple", 2), 0);
  assert.equal(Dict.editDistance("appel", "apple", 2), 1);               // 隣り合う2文字の入れかえは1回
  assert.equal(Dict.editDistance("cta", "cat", 1), 1);
  assert.equal(Dict.editDistance("abcd", "badc", 2), 2);
  assert.equal(Dict.editDistance("aple", "apple", 2), 1);
  assert.equal(Dict.editDistance("abcdef", "xyz", 2), 3);
});

test("suggest: つづりミスは正解を、無関係なら null", () => {
  assert.equal(dict.suggest("りんご", "aple"), "apple");
  assert.equal(dict.suggest("りんご", "appel"), "apple");
  assert.equal(dict.suggest("りんご", "banana"), null);
  assert.equal(dict.suggest("りんご", "apple"), null); // 正解自体は「もしかして」不要
});

test("pickCpu: つながる・「ん」で終わらない・使用済みを避ける", () => {
  const rng = seeded(1);
  for (const head of ["ご", "し", "る", "ぬ", "ゆ", "ぞ"]) {
    for (let i = 0; i < 30; i++) {
      const used = new Set(["dog"]);
      const w = dict.pickCpu({ requiredKana: head, used, maxLevel: 3, rng });
      assert.ok(w, head);
      assert.equal(Rules.getHeadKana(w.reading), head);
      assert.notEqual(Rules.getTailKana(w.reading), "ん");
      assert.ok(!used.has(w.english));
    }
  }
});

test("pickCpu: レベル指定を守る", () => {
  const rng = seeded(2);
  for (let i = 0; i < 100; i++) {
    const w = dict.pickCpu({ requiredKana: null, maxLevel: 1, rng });
    assert.equal(w.level, 1);
  }
});

test("pickCpu: 濁点を区別しない設定では ご→こ からも選べる", () => {
  const rng = seeded(3);
  const heads = new Set();
  for (let i = 0; i < 80; i++) {
    const w = dict.pickCpu({ requiredKana: "ご", ignoreDakuten: true, rng });
    heads.add(Rules.getHeadKana(w.reading));
  }
  assert.ok(heads.has("こ") || heads.has("ご"));
});

test("CPU同士でしりとりが長く続き、全手がルール判定を通る", async () => {
  const judge = Judge.create({ dict });
  const rng = seeded(42);
  let total = 0;
  for (let game = 0; game < 20; game++) {
    const used = new Set();
    let required = null, turns = 0;
    for (;;) {
      const w = dict.pickCpu({ requiredKana: required, used, maxLevel: 2, rng });
      if (!w) break;
      const r = await judge.judge({ reading: w.reading, english: w.english, requiredKana: required, usedEnglish: used });
      assert.equal(r.ok, true, `${w.reading}=${w.english}`);
      assert.equal(r.endsWithN, false);
      used.add(w.english);
      required = r.tail;
      turns++;
    }
    assert.ok(turns >= 10, `game ${game}: ${turns} turns`);
    total += turns;
  }
  assert.ok(total / 20 >= 30, `average ${total / 20}`);
});

test("judge: 辞書あり/つづりミス/別の語/未知の語/ルール違反", async () => {
  const judge = Judge.create({ dict });
  const j = (reading, english, requiredKana = null, usedEnglish = []) =>
    judge.judge({ reading, english, requiredKana, usedEnglish });

  let r = await j("りんご", "apple");
  assert.deepEqual([r.ok, r.source, r.tail], [true, "dictionary", "ご"]);

  r = await j("りんご", "appel");
  assert.deepEqual([r.ok, r.reason, r.suggestion], [false, "spelling", "apple"]);

  r = await j("りんご", "banana");
  assert.deepEqual([r.ok, r.reason], [false, "wrong_english"]);

  r = await j("ぬいぐるみ", "plush");
  assert.equal(r.ok, false);
  assert.ok(["unknown_word", "wrong_english"].includes(r.reason));

  r = await j("ねこ", "cat", "ご");
  assert.deepEqual([r.ok, r.reason, r.source], [false, "not_connected", "rules"]);

  r = await j("いぬ", "dog", null, ["dog"]);
  assert.equal(r.reason, "duplicate");

  r = await j("みかん", "orange");
  assert.deepEqual([r.ok, r.endsWithN], [true, true]);
});

test("judge: 辞書にない語は remote に聞く（失敗したら辞書の結果）", async () => {
  const remoteYes = Judge.create({ dict, remote: async () => ({ ok: true }) });
  let r = await remoteYes.judge({ reading: "ぬいぐるみ", english: "plushie", usedEnglish: [] });
  assert.deepEqual([r.ok, r.source], [true, "remote"]);

  const remoteDown = Judge.create({ dict, remote: async () => { throw new Error("offline"); } });
  r = await remoteDown.judge({ reading: "ぬいぐるみ", english: "plushie", usedEnglish: [] });
  assert.equal(r.ok, false);
  assert.equal(r.source, "dictionary");
});

test("固有名詞(国・都市・月・曜日)が引ける: paris / India など。大文字小文字は問わない", () => {
  const pairs = [["ぱり", "paris"], ["いんど", "india"], ["ふらんす", "france"], ["あめりか", "america"], ["ろんどん", "london"],
    ["にほん", "japan"], ["ちゅうごく", "china"], ["とうきょう", "tokyo"], ["ろーま", "rome"], ["かなだ", "canada"],
    ["えじぷと", "egypt"], ["あじあ", "asia"], ["しがつ", "april"], ["にちようび", "sunday"], ["どいつ", "germany"]];
  for (const [r, e] of pairs) assert.ok(dict.lookup(r, e), `${r}=${e}`);
  assert.ok(dict.lookup("パリ", "Paris"));
  assert.ok(dict.lookup("インド", "INDIA"));
  assert.equal(dict.lookup("ぱり", "india"), null);                       // 読みと合わない組は不可
});

test("使われやすさの印が無い日本語でも、英語が有名な語は引ける。ふつうの子ども語・くだけた語も受け入れる", () => {
  for (const [r, e] of [["つーりすと", "tourist"], ["まま", "mama"], ["いぬ", "dog"], ["ほん", "book"]]) assert.ok(dict.lookup(r, e), `${r}=${e}`);
});

test("不適切な語は入っていない(固有名詞の取り込み後も)", () => {
  const bad = new Set(["fuck", "shit", "bitch", "penis", "vagina", "sex", "porn", "rape", "nazi", "hitler"]);
  assert.equal(DATA.pairs.filter((p) => bad.has(p[1])).length, 0);
});

test("CPUは固有名詞を勝手に出さない(手選びの地名・月・曜日だけ)。地名の手選びは出せる", () => {
  const person = new Set(["emma", "victoria", "mary", "john", "george", "peter", "anna", "maria"]);
  assert.equal(DATA.pairs.filter((p) => (p[3] & 2) && person.has(p[1])).length, 0);
  const rng = seeded(21);
  const seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const w = dict.pickCpu({ requiredKana: null, maxLevel: 3, rng });
    if (w) seen.add(w.english);
  }
  assert.ok(seen.has("japan") || seen.has("paris") || seen.has("sunday") || seen.has("france"), "手選びの地名・曜日が出る");
});

test("knowsEnglish: 辞書にある英単語か(実在する綴りかの目安)", () => {
  assert.equal(dict.knowsEnglish("apple"), true);
  assert.equal(dict.knowsEnglish("Paris"), true);
  assert.equal(dict.knowsEnglish("appel"), false);
  assert.equal(dict.knowsEnglish("x"), false);
});

test("judge: 打ち間違いは「つづりミス」、実在する別の英単語は Gemini に聞く(つづりミスと決めつけない)", async () => {
  const asked = [];
  const remote = async (p) => { asked.push(p.english); return { ok: true }; };
  const judge = Judge.create({ dict, remote });
  const j = (r, e) => judge.judge({ reading: r, english: e, usedEnglish: [] });

  let r = await j("ねこ", "cta");                                        // 辞書に無い綴り(打ち間違い。cat の入れかえ)
  assert.deepEqual([r.ok, r.reason, r.suggestion], [false, "spelling", "cat"]);
  assert.deepEqual(asked, []);

  r = await j("ねこ", "cap");                                            // cat に近いが、実在する別の英単語 → 判定に回す
  assert.deepEqual([r.ok, r.source], [true, "remote"]);
  assert.deepEqual(asked, ["cap"]);

  const offline = Judge.create({ dict, remote: async () => null });      // Geminiが使えない時は、つづりミスではなく「合っていない」
  r = await offline.judge({ reading: "ねこ", english: "cap", usedEnglish: [] });
  assert.deepEqual([r.ok, r.reason], [false, "wrong_english"]);
});
