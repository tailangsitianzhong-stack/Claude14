const test = require("node:test");
const assert = require("node:assert/strict");
const Ruby = require("../js/ruby.js");

test("漢字{よみ} を <ruby> にする。送りがなは外に出る", () => {
  assert.equal(Ruby.html("読{よ}み"), "<ruby>読<rt>よ</rt></ruby>み");
  assert.equal(Ruby.html("英語{えいご}で遊{あそ}ぼう！"), "<ruby>英語<rt>えいご</rt></ruby>で<ruby>遊<rt>あそ</rt></ruby>ぼう！");
  assert.equal(Ruby.html("2文字{もじ}以上{いじょう}"), "2<ruby>文字<rt>もじ</rt></ruby><ruby>以上<rt>いじょう</rt></ruby>");
});

test("ふりがなの無い文字はそのまま。HTMLは必ずエスケープされる", () => {
  assert.equal(Ruby.html("スタート！"), "スタート！");
  assert.equal(Ruby.html('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  // 利用者の入力(英字・かな)が混ざっても壊れない
  assert.equal(Ruby.html("正解{せいかい}は「apple」"), "<ruby>正解<rt>せいかい</rt></ruby>は「apple」");
  // 漢字の前に別の記号があっても、波かっこだけでは変換されない
  assert.equal(Ruby.html("a{b}"), "a{b}");
});
