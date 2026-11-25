/**
 * 二択クイズの保存(前回の設定・記録)。localStorage が使えなくても動く。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./core.js") : root.DuoCore);
  else root.DuoStore = factory(root.DuoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  const PREFIX = "minigames.duo.";

  function create(storage) {
    const read = (key, fallback) => {
      try { const v = storage && storage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    };
    const write = (key, value) => { try { storage && storage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {} };

    const settings = {
      get() {
        const s = Object.assign({ mode: "fixed", rounds: 10, difficulty: "normal", subjects: Core.SUBJECTS, scene: true }, read("settings", {}));
        const subs = Core.SUBJECTS.filter((x) => (s.subjects || []).includes(x));
        return {
          mode: Core.MODES.includes(s.mode) ? s.mode : "fixed",
          rounds: Core.ROUNDS.includes(s.rounds) ? s.rounds : 10,
          difficulty: Core.DIFFICULTIES.includes(s.difficulty) ? s.difficulty : "normal",
          subjects: subs.length ? subs : Core.SUBJECTS.slice(),
          scene: s.scene !== false
        };
      },
      set(patch) { write("settings", Object.assign(settings.get(), patch)); }
    };

    /** 記録の種類: fixed10 / fixed20 / fixed30 / survival。遊んだ回数・ベスト得点・ベストの連続正解(・サバイバルの最長問題数) */
    const keyOf = (mode, rounds) => (mode === "survival" ? "survival" : "fixed" + rounds);
    const stats = {
      get(mode, rounds) { return Object.assign({ played: 0, best: 0, streak: 0, rounds: 0 }, read("stats", {})[keyOf(mode, rounds)]); },
      add(mode, rounds, r) {
        const all = read("stats", {}), k = keyOf(mode, rounds);
        const c = Object.assign({ played: 0, best: 0, streak: 0, rounds: 0 }, all[k]);
        all[k] = { played: c.played + 1, best: Math.max(c.best, r.score), streak: Math.max(c.streak, r.bestStreak || 0), rounds: Math.max(c.rounds, r.rounds || 0) };
        write("stats", all);
        return { newBest: r.score > c.best && c.played > 0 };
      }
    };

    return { settings, stats };
  }

  return { create };
});
