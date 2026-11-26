/**
 * 英単語トランスミッションの単語の確認(AI判定)の窓口。辞書にない単語だけ、中継 Worker の /ladder/judge に聞く。
 *
 *   const judge = LadderJudge.create({ endpoint, storage });
 *   const r = await judge.check("jock");   // { ok:true, pos, ja, form } / { ok:false } / null(確認できなかった)
 *
 * 同じ単語の結果は、この端末にも覚えておく(AI に何度も聞かない)。「確認できなかった(null)」は覚えない。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LadderJudge = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEY = "minigames.ladder.judgeCache.v1";
  const MAX_ENTRIES = 400;
  const TIMEOUT_MS = 10000;

  function create(o) {
    const endpoint = (o && o.endpoint) || "";
    const storage = (o && o.storage) || null;
    const doFetch = (o && o.fetch) || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    let mem = null;
    const load = () => { if (mem) return mem; try { mem = JSON.parse((storage && storage.getItem(KEY)) || "{}"); } catch (_) { mem = {}; } return mem; };
    const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(mem)); } catch (_) {} };

    async function check(word) {
      const w = String(word || "").toLowerCase();
      if (!endpoint || !doFetch || !/^[a-z]{3,5}$/.test(w)) return null;
      const cache = load();
      if (w in cache) return cache[w];
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      try {
        const res = await doFetch(endpoint.replace(/\/+$/, "") + "/ladder/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ word: w }), signal: ctrl ? ctrl.signal : undefined });
        if (!res.ok) return null;
        const r = await res.json();
        let out = null;
        if (r.ok === true && typeof r.ja === "string" && r.ja) out = { ok: true, pos: r.pos || "", ja: r.ja, form: r.form || "" };
        else if (r.ok === false) out = { ok: false };
        if (out) { const keys = Object.keys(cache); if (keys.length >= MAX_ENTRIES) delete cache[keys[0]]; cache[w] = out; save(); }
        return out;
      } catch (_) { return null; }
      finally { if (timer) clearTimeout(timer); }
    }
    return { check };
  }
  return { create };
});
