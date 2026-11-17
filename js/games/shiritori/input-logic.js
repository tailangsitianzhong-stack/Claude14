/**
 * 専用キーボードの入力ロジック（純粋関数）
 * action: {type:'char', value} | {type:'backspace'} | {type:'dakuten'}
 *         | {type:'handakuten'} | {type:'small'}
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShiritoriInput = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAKUTEN = "゙";
  const HANDAKUTEN = "゚";

  const SMALL_PAIRS = {
    "あ": "ぁ", "い": "ぃ", "う": "ぅ", "え": "ぇ", "お": "ぉ",
    "や": "ゃ", "ゆ": "ゅ", "よ": "ょ", "つ": "っ", "わ": "ゎ"
  };
  const SMALL_BACK = {};
  Object.keys(SMALL_PAIRS).forEach((k) => { SMALL_BACK[SMALL_PAIRS[k]] = k; });

  function decompose(ch) {
    const d = ch.normalize("NFD");
    return { base: d[0], mark: d.slice(1) };
  }

  /** ゛キー: 清音↔濁音（が↔か）。濁音にできない字はそのまま */
  function toggleMark(ch, mark) {
    const { base, mark: cur } = decompose(ch);
    if (cur === mark) return base;                       // すでに付いている → 外す
    const composed = (base + mark).normalize("NFC");
    return composed.length === 1 && composed !== base ? composed : ch;
  }

  function toggleSmall(ch) {
    return SMALL_PAIRS[ch] || SMALL_BACK[ch] || ch;
  }

  function applyAction(text, action, opts) {
    const max = (opts && opts.maxLength) || Infinity;
    const last = text.slice(-1);
    switch (action.type) {
      case "char":
        return text.length >= max ? text : text + action.value;
      case "backspace":
        return text.slice(0, -1);
      case "dakuten":
        return last ? text.slice(0, -1) + toggleMark(last, DAKUTEN) : text;
      case "handakuten":
        return last ? text.slice(0, -1) + toggleMark(last, HANDAKUTEN) : text;
      case "small":
        return last ? text.slice(0, -1) + toggleSmall(last) : text;
      default:
        return text;
    }
  }

  return { applyAction };
});
