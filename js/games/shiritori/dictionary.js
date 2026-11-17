/**
 * 辞書（data/words.js）の検索とCPUの語選び
 *
 *   const dict = ShiritoriDictionary.create(window.SHIRITORI_WORDS);
 *   dict.lookup("りんご", "apple")   → {english, reading, level, primary, cpu, curated} | null
 *   dict.suggest("りんご", "appel")  → "apple"（つづりが近い正解）| null
 *   dict.pickCpu({ requiredKana: "ご", used: new Set(), maxLevel: 2 })
 *
 * ブラウザでは ShiritoriDictionary.load() で data/words.js を読み込んでから使う。
 * （file:// でも動くよう fetch ではなく <script> で読む）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rules.js"));
  else root.ShiritoriDictionary = factory(root.ShiritoriRules);
})(typeof self !== "undefined" ? self : this, function (Rules) {
  "use strict";

  const root = typeof self !== "undefined" ? self : globalThis;
  const F_PRIMARY = 1, F_CPU = 2, F_CURATED = 4;

  /** 2語の編集距離。上限(max)を超えたら max+1 を返して打ち切る */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const v = Math.min(
          prev[j] + 1, cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function create(data) {
    const byPair = new Map();       // "reading|english" -> entry
    const byReading = new Map();    // reading -> [entry]
    const cpuByHead = { strict: new Map(), loose: new Map() }; // 濁点を区別する/しない
    const headCount = { strict: new Map(), loose: new Map() }; // CPU語が各文字から何語あるか

    for (const [reading, english, level, flags] of data.pairs) {
      const entry = {
        reading, english, level,
        primary: !!(flags & F_PRIMARY), cpu: !!(flags & F_CPU), curated: !!(flags & F_CURATED)
      };
      byPair.set(reading + "|" + english, entry);
      if (!byReading.has(reading)) byReading.set(reading, []);
      byReading.get(reading).push(entry);

      if (entry.cpu) {
        for (const mode of ["strict", "loose"]) {
          const head = Rules.getHeadKana(reading, { ignoreDakuten: mode === "loose" });
          if (!cpuByHead[mode].has(head)) cpuByHead[mode].set(head, []);
          cpuByHead[mode].get(head).push(entry);
        }
      }
    }
    for (const mode of ["strict", "loose"]) {
      cpuByHead[mode].forEach((list, head) => headCount[mode].set(head, list.length));
    }

    /** (読み, 英語) が辞書にあれば項目を返す。読みはカタカナでも可、英語は大文字小文字を無視 */
    function lookup(reading, english) {
      const r = Rules.normalizeReading(reading);
      const e = Rules.normalizeEnglish(english);
      return (r && e && byPair.get(r + "|" + e)) || null;
    }

    /** この読みに対応する英語（主要訳が先）。復習やヒント用 */
    function englishFor(reading) {
      const r = Rules.normalizeReading(reading);
      const list = (r && byReading.get(r)) || [];
      return list.slice().sort((a, b) => (b.primary - a.primary) || (a.level - b.level)).map((x) => x.english);
    }

    /** つづりミスの「もしかして」。読みに対応する英語のうち、入力に近い（距離1〜2）ものを返す */
    function suggest(reading, english) {
      const r = Rules.normalizeReading(reading);
      const e = Rules.normalizeEnglish(english);
      if (!r || !e) return null;
      const limit = e.length <= 4 ? 1 : 2;
      let best = null, bestD = limit + 1;
      for (const cand of byReading.get(r) || []) {
        const d = editDistance(e, cand.english, limit);
        if (d > 0 && d < bestD) { best = cand.english; bestD = d; }
      }
      return best;
    }

    /**
     * CPUの語選び。
     *  requiredKana : 始めるべき文字（null なら自由）
     *  used         : 使用済みの英語（Set）
     *  maxLevel     : この難易度以下の語だけ（1〜3）
     *  ignoreDakuten: 濁点を区別しない設定
     *  rng          : 乱数（テスト用に差し替え可）
     * 「ん」で終わる語は出さない。手選び語を優先し、次に相手が続けられる語を優先する。
     */
    function pickCpu(opts) {
      const o = opts || {};
      const mode = o.ignoreDakuten ? "loose" : "strict";
      const rng = o.rng || Math.random;
      const maxLevel = o.maxLevel || 3;
      const used = o.used || new Set();
      const ruleOpts = { ignoreDakuten: !!o.ignoreDakuten };

      let pool;
      if (o.requiredKana) {
        const head = Rules.getHeadKana(o.requiredKana, ruleOpts); // 小さい字・濁点の正規化
        pool = cpuByHead[mode].get(head) || [];
      } else {
        pool = [].concat(...cpuByHead[mode].values());
      }
      const ok = pool.filter((e) =>
        e.level <= maxLevel && !used.has(e.english) &&
        Rules.getTailKana(e.reading, ruleOpts) !== "ん");
      if (!ok.length) return null;

      // 続けられる語(次の文字から始まるCPU語がある)かつ、まだ使われていない語を優先
      const continuable = ok.filter((e) => {
        const t = Rules.getTailKana(e.reading, ruleOpts);
        return (headCount[mode].get(t) || 0) > 0;
      });
      const base = continuable.length ? continuable : ok;
      const curated = base.filter((e) => e.curated);
      const list = curated.length ? curated : base;
      const pick = list[Math.floor(rng() * list.length)];
      return { reading: pick.reading, english: pick.english, level: pick.level };
    }

    return { lookup, englishFor, suggest, pickCpu, size: byPair.size };
  }

  /** ブラウザ用: data/words.js を一度だけ読み込み、辞書を返す */
  let loading = null;
  function load(src) {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      if (root.SHIRITORI_WORDS) return resolve(create(root.SHIRITORI_WORDS));
      const s = document.createElement("script");
      s.src = src || "data/words.js";
      s.onload = () => resolve(create(root.SHIRITORI_WORDS));
      s.onerror = () => { loading = null; reject(new Error("辞書を読み込めませんでした")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  return { create, load, editDistance };
});
