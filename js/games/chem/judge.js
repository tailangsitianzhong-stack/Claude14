/**
 * 化学クイズ「早押し」の答えの確認(AI判定)の窓口。端末の辞書で決まらなかった答えだけ、中継 Worker の /chem/judge に聞く。
 *
 *   const judge = ChemJudge.create({ endpoint, storage });
 *   const ok = await judge.check({ question, answer, yomi, forms, input });   // true=正解 / false=不正解 / null=確認できなかった
 *
 * 同じ(正解, 入力)の結果は、この端末にも覚えておく(AI に何度も聞かない)。「確認できなかった(null)」は覚えない。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof require === "function" ? require("./text.js") : root.ChemText);
  else root.ChemJudge = factory(root.ChemText);
})(typeof self !== "undefined" ? self : this, function (Text) {
  "use strict";

  const KEY = "minigames.chem.judgeCache.v1";
  const MAX_ENTRIES = 300;
  const TIMEOUT_MS = 10000;

  function create(o) {
    const endpoint = (o && o.endpoint) || "";
    const storage = (o && o.storage) || null;
    const doFetch = (o && o.fetch) || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    let mem = null;
    const load = () => { if (mem) return mem; try { mem = JSON.parse((storage && storage.getItem(KEY)) || "{}"); } catch (_) { mem = {}; } return mem; };
    const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(mem)); } catch (_) {} };

    async function check({ question, answer, yomi, forms, input }) {
      if (!endpoint || !doFetch) return null;
      const key = answer + "|" + input;           // 化学式は大文字小文字が大事なので、そのまま使う
      const cache = load();
      if (key in cache) return cache[key];
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      try {
        const res = await doFetch(endpoint.replace(/\/+$/, "") + "/chem/judge", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, answer, yomi, forms: forms || [], input }), signal: ctrl ? ctrl.signal : undefined
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
