/**
 * ミニネプリーグの保存(前回のモード・難しさ・戦績)。localStorage が使えなくても動く。
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

    const MODES = ["vs", "coop"];
    const settings = {
      get() {
        const s = Object.assign({ difficulty: "normal", mode: "vs" }, read("settings", {}));
        if (!["easy", "normal", "hard"].includes(s.difficulty)) s.difficulty = "normal";
        if (!MODES.includes(s.mode)) s.mode = "vs";
        return { difficulty: s.difficulty, mode: s.mode };
      },
      set(patch) { write("settings", Object.assign(settings.get(), patch)); }
    };

    /** ひとり用の戦績: モード+難しさごとの 遊んだ回数・勝った(クリアした)回数 */
    const stats = {
      get(mode, difficulty) { return read("stats2", {})[mode + ":" + difficulty] || { played: 0, wins: 0 }; },
      add(mode, difficulty, won) {
        const all = read("stats2", {});
        const k = mode + ":" + difficulty;
        const cur = all[k] || { played: 0, wins: 0 };
        all[k] = { played: cur.played + 1, wins: cur.wins + (won ? 1 : 0) };
        write("stats2", all);
      }
    };

    return { settings, stats };
  }

  return { create };
});
