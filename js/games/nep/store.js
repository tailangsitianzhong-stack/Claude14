/**
 * ミニネプリーグの保存(前回の選択・戦績)。localStorage が使えなくても動く。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NepStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PREFIX = "minigames.nep.";

  function create(storage) {
    const read = (key, fallback) => {
      try { const v = storage && storage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    };
    const write = (key, value) => { try { storage && storage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {} };

    const settings = {
      get() {
        const s = Object.assign({ difficulty: "normal", cpus: 2 }, read("settings", {}));
        if (!["easy", "normal", "hard"].includes(s.difficulty)) s.difficulty = "normal";
        s.cpus = Math.max(1, Math.min(3, Math.round(Number(s.cpus)) || 2));
        return s;
      },
      set(patch) { write("settings", Object.assign(settings.get(), patch)); }
    };

    /** ひとり用の戦績: 難しさごとの 遊んだ回数・勝った回数 */
    const stats = {
      get(difficulty) { return read("stats", {})[difficulty] || { played: 0, wins: 0 }; },
      add(difficulty, won) {
        const all = read("stats", {});
        const cur = all[difficulty] || { played: 0, wins: 0 };
        all[difficulty] = { played: cur.played + 1, wins: cur.wins + (won ? 1 : 0) };
        write("stats", all);
      }
    };

    return { settings, stats };
  }

  return { create };
});
