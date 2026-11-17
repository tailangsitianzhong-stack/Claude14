/**
 * 専用キーボードの入力ロジック（純粋関数）
 * action: {type:'char', value} | {type:'backspace'} | {type:'dakuten'}
 *         | {type:'handakuten'} | {type:'small'} | {type:'cycle'}
 *   cycle = フリックキーボードの「゛゜小」: か→が→か / は→ば→ぱ→は / つ→っ→づ→つ / や→ゃ→や
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

  /** 1つの字の「ゆれ」の並び（゛゜小で順に切り替える）。base の次に 小・濁・半濁 の順 */
  const CYCLES = [];
  [..."あいうえおやゆよつわかきくけこさしすせそたちてとはひふへほ"].forEach((base) => {
    const list = [base];
    if (SMALL_PAIRS[base]) list.push(SMALL_PAIRS[base]);
    [DAKUTEN, HANDAKUTEN].forEach((m) => {
      const c = (base + m).normalize("NFC");
      if (c.length === 1 && c !== base) list.push(c);
    });
    if (list.length > 1) CYCLES.push(list);
  });
  const CYCLE_OF = {};
  CYCLES.forEach((list) => list.forEach((ch) => { CYCLE_OF[ch] = list; }));
  // 並びは「つ→っ→づ」「う→ぅ→ゔ」のように、小さい字が濁点より先になる

  function cycleChar(ch) {
    const list = CYCLE_OF[ch];
    return list ? list[(list.indexOf(ch) + 1) % list.length] : ch;
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
      case "cycle":
        return last ? text.slice(0, -1) + cycleChar(last) : text;
      case "small":
        return last ? text.slice(0, -1) + toggleSmall(last) : text;
      default:
        return text;
    }
  }

  return { applyAction };
});
