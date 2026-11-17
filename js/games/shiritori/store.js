/**
 * 保存まわり（ふくしゅうリスト・ベストスコア・設定）。
 * storage は localStorage 互換（getItem/setItem）。使えない環境でも落ちない。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShiritoriStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PREFIX = "minigames.shiritori.";
  const REVIEW_MAX = 200;

  function create(storage) {
    function read(key, fallback) {
      try {
        const v = storage && storage.getItem(PREFIX + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }
    }
    function write(key, value) {
      try { storage && storage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {}
    }

    const review = {
      list() { return read("review", []); },
      /** 同じ(読み,正解)は1件にまとめ、新しいものを先頭に */
      add(entry) {
        const key = entry.reading + "|" + entry.correct;
        const list = review.list().filter((e) => e.reading + "|" + e.correct !== key);
        list.unshift({ reading: entry.reading, correct: entry.correct, typed: entry.typed, at: Date.now() });
        write("review", list.slice(0, REVIEW_MAX));
      },
      remove(reading, correct) {
        write("review", review.list().filter((e) => !(e.reading === reading && e.correct === correct)));
      },
      clear() { write("review", []); }
    };

    const best = {
      get(difficulty) { return read("best", {})[difficulty] || 0; },
      /** 新記録なら true */
      submit(difficulty, score) {
        const all = read("best", {});
        if (score > (all[difficulty] || 0)) {
          all[difficulty] = score;
          write("best", all);
          return true;
        }
        return false;
      }
    };

    const settings = {
      get() { return Object.assign({ difficulty: "normal", ignoreDakuten: false }, read("settings", {})); },
      set(patch) { write("settings", Object.assign(settings.get(), patch)); }
    };

    return { review, best, settings };
  }

  return { create };
});
