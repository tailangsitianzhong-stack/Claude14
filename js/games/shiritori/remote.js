/**
 * Gemini 中継 Worker への問い合わせ（辞書にない語のときだけ呼ばれる）
 *
 *   const remote = ShiritoriRemote.create({ endpoint, storage });
 *   await remote({ reading, english }) → {ok:true} | {ok:false, reason, suggestion} | null
 *   null = 判定できなかった(通信失敗・上限・未設定)。呼び出し側は辞書の結果に戻す。
 *
 * 結果はこの端末にも保存し、同じ組を二度は聞かない（無料枠の節約）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShiritoriRemote = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY = "minigames.shiritori.remoteCache";
  const MAX_ENTRIES = 300;
  const TIMEOUT_MS = 6000;

  function create(opts) {
    const endpoint = (opts.endpoint || "").replace(/\/+$/, "");
    if (!endpoint) return null;
    const doFetch = opts.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const storage = opts.storage || null;
    if (!doFetch) return null;

    const memory = new Map();
    try {
      const saved = storage && JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) saved.forEach(([k, v]) => memory.set(k, v));
    } catch (_) { /* 保存データが壊れていても動く */ }

    function persist() {
      try {
        if (!storage) return;
        const entries = [...memory].slice(-MAX_ENTRIES);
        storage.setItem(STORAGE_KEY, JSON.stringify(entries));
      } catch (_) {}
    }

    return async function remote(p) {
      const key = p.reading + "|" + p.english;
      if (memory.has(key)) return memory.get(key);

      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      try {
        const res = await doFetch(endpoint + "/judge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reading: p.reading, english: p.english }),
          signal: ctrl ? ctrl.signal : undefined
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.ok === true) {
          memory.set(key, { ok: true });
        } else if (data.ok === false) {
          memory.set(key, { ok: false, reason: data.reason || "wrong_english", suggestion: data.suggestion || null });
        } else {
          return null;                         // ok:null → 判定できなかった。保存しない
        }
        persist();
        return memory.get(key);
      } catch (_) {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
  }

  return { create };
});
