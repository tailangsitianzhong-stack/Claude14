/**
 * 判定パイプライン: ① ルール判定 → ② 辞書照合 → ③ 外部判定(remote: Gemini中継Worker。任意)
 *
 *   const judge = ShiritoriJudge.create({ dict, remote });   // remote は省略可
 *   const r = await judge.judge({ reading, english, requiredKana, usedEnglish }, opts);
 *
 * 結果: { ok, reason?, reading, english, tail, endsWithN, source, suggestion? }
 *   reason: invalid_reading | invalid_english | not_connected | duplicate  (ルール)
 *           spelling      … 読みは辞書にあり、英語が辞書にない近いつづり違い＝打ち間違い（suggestion に正解）
 *           wrong_english … 読みは辞書にあるが、その英語は対応していない
 *           unknown_word  … 辞書に載っていない（remote があればそちらで再判定）
 *   source: rules | dictionary | remote
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rules.js"));
  else root.ShiritoriJudge = factory(root.ShiritoriRules);
})(typeof self !== "undefined" ? self : this, function (Rules) {
  "use strict";

  function create(deps) {
    const dict = deps.dict;
    const remote = deps.remote || null; // async ({reading, english}) => {ok:boolean, ...} | null

    /** hooks.onRemoteStart: Gemini などの外部確認を始める直前に呼ばれる(友達対戦で時間を止めるため) */
    async function judge(move, opts, hooks) {
      const rule = Rules.checkMove(move, opts);
      if (!rule.ok) return Object.assign({}, rule, { source: "rules" });

      const base = { reading: rule.reading, english: rule.english, tail: rule.tail, endsWithN: rule.endsWithN };

      const hit = dict.lookup(rule.reading, rule.english);
      if (hit) return Object.assign({ ok: true, source: "dictionary", entry: hit }, base);

      // 近いつづりが辞書にあって、入力が辞書にも無い綴り(=打ち間違い)なら、Geminiに聞かず「つづりミス」にする（無料枠の節約）。
      // 入力が実在する英単語(centre / center のような別の綴りや、別の意味の語)なら、つづりミスと決めつけず判定に回す
      const suggestion = dict.suggest(rule.reading, rule.english);
      const realWord = dict.knowsEnglish(rule.english);
      if (suggestion && !realWord) return Object.assign({ ok: false, reason: "spelling", suggestion, source: "dictionary" }, base);

      if (remote) {
        try {
          if (hooks && hooks.onRemoteStart) hooks.onRemoteStart();
          const r = await remote({ reading: rule.reading, english: rule.english });
          if (r && r.ok) return Object.assign({ ok: true, source: "remote" }, base);
          if (r && r.ok === false) {
            return Object.assign({ ok: false, reason: r.reason || "wrong_english", source: "remote",
                                   suggestion: r.suggestion || null }, base);
          }
        } catch (_) { /* 通信失敗は辞書の結果にフォールバック */ }
      }

      const known = dict.englishFor(rule.reading).length > 0;
      return Object.assign({ ok: false, reason: known || realWord ? "wrong_english" : "unknown_word",
                             suggestion: null, source: "dictionary" }, base);
    }

    return { judge };
  }

  return { create };
});
