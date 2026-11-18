/**
 * ミニ漢字検定の保存(ベスト記録・復習リスト・前回の選択)。localStorage が使えなくても動く。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KankenStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PREFIX = "minigames.kanken.";
  const REVIEW_MAX = 200;

  function create(storage) {
    const read = (key, fallback) => {
      try { const v = storage && storage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    };
    const write = (key, value) => { try { storage && storage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {} };

    const best = {
      /** モード+レベルごとのベスト {score, correct} */
      get(mode, level) { return read("best", {})[mode + ":" + level] || { score: 0, correct: 0 }; },
      /** 新記録(スコアが高い)なら true */
      submit(mode, level, score, correct) {
        const all = read("best", {});
        const old = all[mode + ":" + level];
        if (!old || score > old.score) {
          all[mode + ":" + level] = { score, correct };
          write("best", all);
          return true;
        }
        return false;
      }
    };

    const review = {
      list() { return read("review", []); },
      /** 同じ語はまとめて、新しいものを先頭に */
      add(item) {
        const list = review.list().filter((e) => e.text !== item.text);
        list.unshift({ text: item.text, reading: item.reading, at: Date.now() });
        write("review", list.slice(0, REVIEW_MAX));
      },
      remove(text) { write("review", review.list().filter((e) => e.text !== text)); },
      clear() { write("review", []); }
    };

    const settings = {
      get() { return Object.assign({ mode: "exam", level: 1 }, read("settings", {})); },
      set(patch) { write("settings", Object.assign(settings.get(), patch)); }
    };

    return { best, review, settings };
  }

  return { create };
});
