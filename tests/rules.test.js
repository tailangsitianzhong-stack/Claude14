const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/games/shiritori/rules.js");

test("カタカナはひらがなに直る / かな以外は不可", () => {
  assert.equal(R.normalizeReading("リンゴ"), "りんご");
  assert.equal(R.normalizeReading("コーヒー"), "こーひー");
  assert.equal(R.normalizeReading("apple"), null);
  assert.equal(R.normalizeReading("り"), null);       // 短すぎる
  assert.equal(R.normalizeReading("ーあ"), null);     // 先頭の長音
  assert.equal(R.normalizeReading(""), null);
});

test("英語: 小文字化・英字のみ2〜30字", () => {
  assert.equal(R.normalizeEnglish(" Apple "), "apple");
  assert.equal(R.normalizeEnglish("ice cream"), null);
  assert.equal(R.normalizeEnglish("a"), null);
  assert.equal(R.normalizeEnglish("e-mail"), null);
  assert.equal(R.normalizeEnglish("りんご"), null);
});

test("語尾: 小さい字・長音・濁点", () => {
  assert.equal(R.getTailKana("りんご"), "ご");
  assert.equal(R.getTailKana("りんご", { ignoreDakuten: true }), "こ");
  assert.equal(R.getTailKana("きしゃ"), "や");        // しゃ → や
  assert.equal(R.getTailKana("きっちょ"), "よ");
  assert.equal(R.getTailKana("こーひー"), "い");       // ひー → い
  assert.equal(R.getTailKana("じゅーす"), "す");
  assert.equal(R.getTailKana("すてーき"), "き");
  assert.equal(R.getTailKana("てぃー"), "い");         // ぃ → い
  assert.equal(R.getTailKana("ばなな"), "な");
});

test("語頭: 濁点を無視する設定", () => {
  assert.equal(R.getHeadKana("ごりら"), "ご");
  assert.equal(R.getHeadKana("ごりら", { ignoreDakuten: true }), "こ");
});

test("1手の判定: 正常", () => {
  const r = R.checkMove({ reading: "りんご", english: "Apple", requiredKana: null, usedEnglish: [] });
  assert.equal(r.ok, true);
  assert.equal(r.english, "apple");
  assert.equal(r.tail, "ご");
  assert.equal(r.endsWithN, false);
});

test("1手の判定: つながっていない", () => {
  const r = R.checkMove({ reading: "ねこ", english: "cat", requiredKana: "ご", usedEnglish: [] });
  assert.deepEqual(r, { ok: false, reason: "not_connected" });
});

test("1手の判定: 濁点ちがいは設定次第", () => {
  const p = { reading: "こあら", english: "koala", requiredKana: "ご", usedEnglish: [] };
  assert.equal(R.checkMove(p).ok, false);
  assert.equal(R.checkMove(p, { ignoreDakuten: true }).ok, true);
});

test("1手の判定: 重複は英語スペルで判定（読みが同じでも別語ならOK）", () => {
  const used = new Set(["bridge"]);
  assert.equal(R.checkMove({ reading: "はし", english: "bridge", usedEnglish: used }).reason, "duplicate");
  assert.equal(R.checkMove({ reading: "はし", english: "BRIDGE", usedEnglish: used }).reason, "duplicate");
  assert.equal(R.checkMove({ reading: "はし", english: "chopsticks", usedEnglish: used }).ok, true);
});

test("1手の判定: 「ん」で終わる手は成立するが負け", () => {
  const r = R.checkMove({ reading: "みかん", english: "orange", usedEnglish: [] });
  assert.equal(r.ok, true);
  assert.equal(r.endsWithN, true);
});

test("1手の判定: 形式エラー", () => {
  assert.equal(R.checkMove({ reading: "りんご", english: "ap ple", usedEnglish: [] }).reason, "invalid_english");
  assert.equal(R.checkMove({ reading: "apple", english: "apple", usedEnglish: [] }).reason, "invalid_reading");
});

test("長音で終わる語は母音でつながる", () => {
  const a = R.checkMove({ reading: "こーひー", english: "coffee", usedEnglish: [] });
  assert.equal(a.tail, "い");
  const b = R.checkMove({ reading: "いるか", english: "dolphin", requiredKana: a.tail, usedEnglish: ["coffee"] });
  assert.equal(b.ok, true);
});
