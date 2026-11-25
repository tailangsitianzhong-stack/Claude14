/**
 * 化学クイズの保存(前回の設定・戦績)。localStorage が使えなくても動く。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./units.js") : root.ChemUnits);
  else root.ChemStore = factory(root.ChemUnits);
})(typeof self !== "undefined" ? self : this, function (Units) {
  "use strict";

  const PREFIX = "minigames.chem.";
  const MODES = ["choice", "calc", "buzz", "mix"], GRADES = ["high", "exam"], DIFFS = ["easy", "normal", "hard"], ROUNDS = [5, 10, 15, 30];

  function create(storage) {
    const read = (key, fallback) => {
      try { const v = storage && storage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    };
    const write = (key, value) => { try { storage && storage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {} };

    const settings = {
      get() {
        const s = Object.assign({ mode: "mix", grade: "high", difficulty: "normal", rounds: 10, cpus: 2, units: [] }, read("settings", {}));
        return {
          mode: MODES.includes(s.mode) ? s.mode : "mix",
          grade: GRADES.includes(s.grade) ? s.grade : "high",
          difficulty: DIFFS.includes(s.difficulty) ? s.difficulty : "normal",
          rounds: ROUNDS.includes(s.rounds) ? s.rounds : 10,
          cpus: Math.max(0, Math.min(3, Math.round(Number(s.cpus)))) || (Number(s.cpus) === 0 ? 0 : 2),
          units: Units.clean(s.units)
        };
      },
      set(patch) { write("settings", Object.assign(settings.get(), patch)); }
    };

    /** 形式ごとの戦績: 遊んだ回数・1位になった回数・ベスト得点 */
    const stats = {
      get(mode) { return read("stats", {})[mode] || { played: 0, wins: 0, best: 0 }; },
      add(mode, won, score) {
        const all = read("stats", {});
        const c = all[mode] || { played: 0, wins: 0, best: 0 };
        all[mode] = { played: c.played + 1, wins: c.wins + (won ? 1 : 0), best: Math.max(c.best, score) };
        write("stats", all);
      }
    };

    return { settings, stats };
  }

  return { create };
});
