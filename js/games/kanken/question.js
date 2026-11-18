/**
 * ミニ漢字検定の「問題づくり」と「答え合わせ」（画面・時間に依存しない純粋な関数）
 *
 *   const bank = Question.createBank(window.KANKEN_DATA);
 *   const q = bank.next({ level: 3, rng, used: new Set() });
 *   Question.checkReading("けんてい", q)   // 読み問題
 *   Question.checkChoice(2, q)            // 書き取り(4択)
 *
 * 問題の形:
 *   { type:"read",  id, level, text:"検定", answer:"けんてい" }
 *   送りがな付きの語(教える)は、漢字の部分だけを答える:
 *   { type:"read",  id, level, text:"教える", kanji:"教", okuri:"える", answer:"おし", alt:"おしえる" }
 *     alt は、送りがなまで入力した場合も正解にするための読み
 *   { type:"write", id, level, text:"□定", reading:"けんてい", choices:["検","険","験","剣"], answerIndex:0, answer:"検" }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KankenQuestion = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LEVELS = [
    { level: 1, label: "Lv1", range: "小学1〜2年", short: "小1〜2", base: 10 },
    { level: 2, label: "Lv2", range: "小学3〜4年", short: "小3〜4", base: 20 },
    { level: 3, label: "Lv3", range: "小学5〜6年", short: "小5〜6", base: 30 },
    { level: 4, label: "Lv4", range: "中学〜高校(基本)", short: "中高{ちゅうこう}基本{きほん}", base: 50 },
    { level: 5, label: "Lv5", range: "中学〜高校(応用)", short: "中高{ちゅうこう}応用{おうよう}", base: 80 },
    // 漢検2級: 常用漢字だけの、難しい漢字を2字以上含む語・やや珍しい語
    { level: 6, label: "Lv6", range: "漢検2級(常用漢字・上級)", short: "漢検{かんけん}2級{きゅう}", base: 120 },
    // 漢検1級: 常用漢字以外の漢字(表外漢字 約4,200字)を含む語
    { level: 7, label: "Lv7", range: "漢検1級(表外漢字)", short: "漢検{かんけん}1級{きゅう}", base: 200 }
  ];
  const TYPE_MULT = { read: 1.5, write: 1 };     // 読み(入力)は当てずっぽうが効かないので高め
  const REVIEW_MIX = 0.3;                        // 選んだレベルより易しい字を混ぜる割合
  const MAX_LEVEL = 7;
  const DECOY_POOL = 6;                          // にせ漢字は、候補の先頭(紛らわしい順)からこの数の中で選ぶ

  const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  /** 「ぢ/づ」は「じ/ず」と同じ扱い、カタカナはひらがなに、空白は除く */
  function normReading(s) {
    return kata2hira(String(s || "")).replace(/[\s　]/g, "").replace(/ぢ/g, "じ").replace(/づ/g, "ず");
  }
  const sameReading = (a, b) => normReading(a) !== "" && normReading(a) === normReading(b);

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function createBank(data) {
    const readByLevel = {}, writeByLevel = {};
    for (let l = 1; l <= MAX_LEVEL; l++) { readByLevel[l] = []; writeByLevel[l] = []; }
    const kanjiLevel = new Map(data.kanji.map((k) => [k[0], k[1]]));
    for (const w of data.words) {
      const [text, reading, level, blank, decoys] = w;
      readByLevel[level].push(w);
      if (blank >= 0 && decoys.length >= 3) writeByLevel[level].push(w);
    }

    /** そのレベルの問題の数（形式別） */
    function size(level) { return { read: readByLevel[level].length, write: writeByLevel[level].length }; }

    function makeRead(w) {
      const [text, reading, level] = w;
      // 送りがな付きの語(教える): 漢字の部分(おし)だけを答える。語の終わりの仮名が送りがな
      const m = /^([一-龠]+)([ぁ-ゖ]+)$/.exec(text);
      if (m && reading.endsWith(m[2]) && reading.length > m[2].length) {
        return { type: "read", id: "r:" + text, level, text, kanji: m[1], okuri: m[2], answer: reading.slice(0, -m[2].length), alt: reading };
      }
      return { type: "read", id: "r:" + text, level, text, answer: reading };
    }
    function makeWrite(w, rng) {
      const [text, reading, level, blank, decoys] = w;
      const chars = [...text];
      const answer = chars[blank];
      const pool = [...decoys].slice(0, DECOY_POOL);
      const wrong = shuffle(pool, rng).slice(0, 3);
      const choices = shuffle([answer, ...wrong], rng);
      chars[blank] = "□";
      return { type: "write", id: "w:" + text, level, text: chars.join(""), full: text, reading, choices, answerIndex: choices.indexOf(answer), answer };
    }

    /**
     * 次の問題を1つ選ぶ。
     *  level: 選んだレベル / rng: 乱数 / used: 出題済みのid(Set) / type: "read"|"write"|undefined(ランダム)
     *  選んだレベルが中心で、約3割は易しいレベルの字から出す。
     */
    function next(opts) {
      const rng = opts.rng || Math.random;
      const used = opts.used || new Set();
      let want = opts.type || (rng() < 0.5 ? "read" : "write");

      for (let attempt = 0; attempt < 40; attempt++) {
        let lv = opts.level;
        if (lv > 1 && rng() < REVIEW_MIX) {
          // 易しいレベルを混ぜる。Lv1〜5 は Lv1 から、漢検2級・1級は1〜2つ下のレベルから(易しすぎる語を混ぜない)
          const lo = lv >= 6 ? lv - 2 : 1;
          lv = lo + Math.floor(rng() * (lv - lo));
        }
        const type = attempt > 20 ? (want === "read" ? "write" : "read") : want;   // 出し尽くしたら、もう一方の形式へ
        const list = (type === "read" ? readByLevel : writeByLevel)[lv];
        if (!list.length) continue;
        const w = list[Math.floor(rng() * list.length)];
        const id = (type === "read" ? "r:" : "w:") + w[0];
        if (used.has(id) && attempt < 39) continue;
        return type === "read" ? makeRead(w) : makeWrite(w, rng);
      }
      return null;
    }

    return { next, size, kanjiLevel };
  }

  /* ---------- 答え合わせ・得点 ---------- */
  /** 読み問題の答え合わせ。送りがな付きの語は、漢字の部分だけでも、送りがなまで入力しても正解 */
  const checkReading = (input, q) => q.type === "read" && (sameReading(input, q.answer) || (!!q.alt && sameReading(input, q.alt)));
  const checkChoice = (index, q) => q.type === "write" && index === q.answerIndex;

  /**
   * 1問の得点 = 基本点(レベル) × 形式の倍率 × (1 + はやさ(最大+50%) + 連続正解(1問につき+10%、最大+50%))
   *   elapsed/limit: 答えるまでの時間と、その形式の制限時間(秒)
   */
  function pointsFor(p) {
    const base = LEVELS[p.level - 1].base;
    const quick = Math.max(0, Math.min(1, 1 - p.elapsed / p.limit)) * 0.5;
    const streak = Math.min(Math.max(p.streak, 0), 5) * 0.1;
    return Math.round(base * TYPE_MULT[p.type] * (1 + quick + streak));
  }

  return { LEVELS, TYPE_MULT, createBank, checkReading, checkChoice, pointsFor, normReading, sameReading };
});
