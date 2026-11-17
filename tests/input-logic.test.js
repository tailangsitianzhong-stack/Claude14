const test = require("node:test");
const assert = require("node:assert/strict");
const { applyAction } = require("../js/games/shiritori/input-logic.js");

const t = (text, type, value) => applyAction(text, { type, value });

test("文字追加・削除・最大文字数", () => {
  assert.equal(t("り", "char", "ん"), "りん");
  assert.equal(t("りん", "backspace"), "り");
  assert.equal(t("", "backspace"), "");
  assert.equal(applyAction("ab", { type: "char", value: "c" }, { maxLength: 2 }), "ab");
});

test("゛: 清音↔濁音（最後の1文字だけ）", () => {
  assert.equal(t("り", "dakuten"), "り");   // 濁音のない字はそのまま
  assert.equal(t("りんこ", "dakuten"), "りんご");
  assert.equal(t("りんご", "dakuten"), "りんこ");
  assert.equal(t("う", "dakuten"), "ゔ");
  assert.equal(t("あ", "dakuten"), "あ");
});

test("゜: は行だけ半濁音、ば→ぱも可", () => {
  assert.equal(t("は", "handakuten"), "ぱ");
  assert.equal(t("ぱ", "handakuten"), "は");
  assert.equal(t("ば", "handakuten"), "ぱ");
  assert.equal(t("ぱ", "dakuten"), "ば");
  assert.equal(t("か", "handakuten"), "か");
});

test("小: 小さい字↔大きい字", () => {
  assert.equal(t("きや", "small"), "きゃ");
  assert.equal(t("きゃ", "small"), "きや");
  assert.equal(t("さつ", "small"), "さっ");
  assert.equal(t("か", "small"), "か");
  assert.equal(t("", "small"), "");
});

test("未知のactionは何もしない", () => {
  assert.equal(t("あ", "noop"), "あ");
});
