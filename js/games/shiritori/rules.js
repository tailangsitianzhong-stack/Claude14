/**
 * しりとりのルール判定（純粋関数・DOM/通信なし）
 * ブラウザでは window.ShiritoriRules、Node では require() で使える。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShiritoriRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN_READING = 2;
  const ENGLISH_RE = /^[a-z]{2,30}$/;

  // 小さい字 → 大きい字
  const SMALL = {
    "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お",
    "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "っ": "つ", "ゎ": "わ"
  };

  // 母音ごとのかな（長音「ー」の解決用）
  const VOWEL_ROWS = {
    "あ": "あかがさざただなはばぱまやらわゃぁゎ",
    "い": "いきぎしじちぢにひびぴみりぃ",
    "う": "うくぐすずつづぬふぶぷむゆるゅぅゔっ",
    "え": "えけげせぜてでねへべぺめれぇ",
    "お": "おこごそぞとどのほぼぽもよろをょぉ"
  };
  const VOWEL_OF = {};
  Object.keys(VOWEL_ROWS).forEach((v) => {
    for (const c of VOWEL_ROWS[v]) VOWEL_OF[c] = v;
  });

  /** カタカナ→ひらがな。かな以外が混じる/短すぎる場合は null */
  function normalizeReading(input) {
    if (typeof input !== "string") return null;
    let s = input.trim().replace(/[ァ-ヶ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60)
    );
    s = s.replace(/ヴ/g, "ゔ");
    if (!/^[ぁ-ゖー]+$/.test(s)) return null;
    if (s[0] === "ー") return null;            // 先頭の長音は不可
    return s.length >= MIN_READING ? s : null;
  }

  /** 濁点・半濁点を外す（が→か、ぱ→は） */
  function stripDakuten(ch) {
    return ch.normalize("NFD")[0].normalize("NFC");
  }

  /** 英語: 小文字化して2〜30字の英字のみなら返す。不可なら null */
  function normalizeEnglish(input) {
    if (typeof input !== "string") return null;
    const s = input.trim().toLowerCase();
    return ENGLISH_RE.test(s) ? s : null;
  }

  /**
   * しりとりで使う「つなぎ用の1文字」へ正規化。
   * 小さい字→大きい字、濁点は ignoreDakuten で外す。
   */
  function toLinkKana(ch, ignoreDakuten) {
    let c = SMALL[ch] || ch;
    if (ignoreDakuten) c = stripDakuten(c);
    return c;
  }

  /** 語尾のつなぎ文字（「ー」は直前の母音、小さい字は大きい字）。ひらがな読みを渡す */
  function getTailKana(reading, opts) {
    const ignoreDakuten = !!(opts && opts.ignoreDakuten);
    let i = reading.length - 1;
    if (reading[i] === "ー") {
      while (i >= 0 && reading[i] === "ー") i--;
      if (i < 0) return null;
      const v = VOWEL_OF[reading[i]];
      return v || null;
    }
    return toLinkKana(reading[i], ignoreDakuten);
  }

  /** 語頭のつなぎ文字 */
  function getHeadKana(reading, opts) {
    return toLinkKana(reading[0], !!(opts && opts.ignoreDakuten));
  }

  /**
   * 1手のルール判定。
   * @param {object} p
   *   reading      プレイヤーが入力した読み（かな）
   *   english      プレイヤーが入力した英語
   *   requiredKana 次に始めるべき文字（最初の手は null=自由）
   *   usedEnglish  使用済みの英語（配列/Set）
   * @param {object} [opts] { ignoreDakuten }
   * @returns {{ok:boolean, reason?:string, reading?:string, english?:string,
   *            tail?:string, endsWithN?:boolean}}
   *   reason: invalid_reading | invalid_english | not_connected | duplicate
   *   endsWithN が true の手は成立するが、その人の負けになる。
   */
  function checkMove(p, opts) {
    const reading = normalizeReading(p.reading);
    if (!reading) return { ok: false, reason: "invalid_reading" };

    const english = normalizeEnglish(p.english);
    if (!english) return { ok: false, reason: "invalid_english" };

    if (p.requiredKana) {
      const need = toLinkKana(p.requiredKana, !!(opts && opts.ignoreDakuten));
      if (getHeadKana(reading, opts) !== need) {
        return { ok: false, reason: "not_connected" };
      }
    }

    const used = p.usedEnglish instanceof Set ? p.usedEnglish : new Set(p.usedEnglish || []);
    if (used.has(english)) return { ok: false, reason: "duplicate" };

    const tail = getTailKana(reading, opts);
    if (!tail) return { ok: false, reason: "invalid_reading" };

    return { ok: true, reading, english, tail, endsWithN: tail === "ん" };
  }

  return { normalizeReading, normalizeEnglish, getTailKana, getHeadKana, checkMove };
});
