/**
 * 英単語トランスミッションの保存(前回の設定・記録)。localStorage が使えなくても動く。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LadderStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PREFIX = "minigames.ladder.";
  const LEVELS = [1, 2, 3];

  function create(storage) {
    const read = (key, fallback) => { try { const v = storage && storage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
    const write = (key, value) => { try { storage && storage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {} };

    const settings = {
      get() {
        const s = Object.assign({ level: 1, timed: false, used: [] }, read("settings", {}));
        return { level: LEVELS.includes(s.level) ? s.level : 1, timed: !!s.timed, used: Array.isArray(s.used) ? s.used.filter((x) => typeof x === "string").slice(-60) : [] };
      },
      set(patch) { write("settings", Object.assign(settings.get(), patch)); },
      /** 出したパズルを覚える(続けて同じ問題が出ないように) */
      markUsed(id) { const s = settings.get(); settings.set({ used: s.used.concat(id).slice(-60) }); }
    };

    /** 難しさごとの記録: 遊んだ回数・クリア数・ベストの星・最小の手数 */
    const stats = {
      get(level) { return Object.assign({ played: 0, cleared: 0, stars: 0, bestSteps: 0 }, read("stats", {})[level]); },
      add(level, r) {
        const all = read("stats", {});
        const c = Object.assign({ played: 0, cleared: 0, stars: 0, bestSteps: 0 }, all[level]);
        all[level] = { played: c.played + 1, cleared: c.cleared + (r.win ? 1 : 0), stars: Math.max(c.stars, r.stars || 0), bestSteps: r.win ? (c.bestSteps ? Math.min(c.bestSteps, r.steps) : r.steps) : c.bestSteps };
        write("stats", all);
      }
    };
    return { settings, stats };
  }
  return { create };
});
