/**
 * 地理クイズ「早押し」の答えの確認(AI判定)の窓口。端末の辞書で決まらなかった答えだけ、中継 Worker の /geo/judge に聞く。
 *
 *   const judge = GeoJudge.create({ endpoint, storage });
 *   const ok = await judge.check({ question, answer, yomi, input });   // true=正解 / false=不正解 / null=確認できなかった
 *
 * 同じ(正解, 入力)の結果は、この端末にも覚えておく(AI に何度も聞かない)。「確認できなかった(null)」は覚えない。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./text.js") : root.GeoText);
  else root.GeoJudge = factory(root.GeoText);
})(typeof self !== "undefined" ? self : this, function (Text) {
  "use strict";

  const KEY = "minigames.geo.judgeCache.v1";
  const MAX_ENTRIES = 300;
  const TIMEOUT_MS = 10000;

  function create(o) {
    const endpoint = (o && o.endpoint) || "";
    const storage = (o && o.storage) || null;
    const doFetch = (o && o.fetch) || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    let mem = null;
    const load = () => { if (mem) return mem; try { mem = JSON.parse((storage && storage.getItem(KEY)) || "{}"); } catch (_) { mem = {}; } return mem; };
    const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(mem)); } catch (_) {} };

    async function check({ question, answer, yomi, input }) {
      if (!endpoint || !doFetch) return null;
      const key = Text.normalize(answer) + "|" + Text.normalize(input);
      const cache = load();
      if (key in cache) return cache[key];
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      try {
        const res = await doFetch(endpoint.replace(/\/+$/, "") + "/geo/judge", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, answer, yomi, input }), signal: ctrl ? ctrl.signal : undefined
        });
        if (!res.ok) return null;
        const r = await res.json();
        if (r.ok === true || r.ok === false) {
          const keys = Object.keys(cache);
          if (keys.length >= MAX_ENTRIES) delete cache[keys[0]];
          cache[key] = r.ok; save();
          return r.ok;
        }
        return null;
      } catch (_) { return null; }
      finally { if (timer) clearTimeout(timer); }
    }
    return { check };
  }

  return { create };
});
