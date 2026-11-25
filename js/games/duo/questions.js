/**
 * 二択クイズの出題。4つの科目(英語・化学・物理・地理)の問題を、すべて「正解1つ + まちがい1つ」の二択にそろえる。
 *
 *   const Q = DuoQuestions.create({ duo: DUO_DATA, chem: CHEM_DATA, geo: GEO_DATA });   // 持っていないデータは省いてよい
 *   Q.count(["en","chem"])                                 // その科目で出せる問題の数
 *   const { pub, priv } = Q.pick({ subjects, difficulty, rng, used:[id…], round, survival, lastSubj:[…] });
 *     pub  {id, s:"en|chem|phys|geo", text, c:[左, 右], ex, k?, m?}   端末に送る問題(図があるときは k, m)
 *     priv {a:0|1(正解の側), explain}                                  サーバーだけが持つ(答え合わせで初めて見せる)
 *
 * 問題のもと:
 *  ・英語・物理 … data/duo.js の items(手書き。{id, s, ex, q, c:[正解, まちがい], e:解説})と、地理の統計の比較(自動生成)
 *  ・化学 … data/chem.js の「資料選択」(大学入試の印 ex があるもの)。4択から、正解と、まちがい1つ(毎回ランダム)を選んで二択にする
 *  ・地理 … data/geo.js の「資料選択」のうち、図のない基本問題(大学入試の印 ex があるもの)を、同じように二択にする
 * すべて大学入試(共通テスト・二次)レベル。ex は 1=基礎 / 2=標準 / 3=発展。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DuoQuestions = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SUBJECTS = ["en", "chem", "phys", "geo"];
  /** 難しさごとの、基礎(1)・標準(2)・発展(3)の出やすさ */
  const WEIGHT = {
    easy: { 1: 5, 2: 2, 3: 0.5 },
    normal: { 1: 2, 2: 4, 3: 2 },
    hard: { 1: 0.5, 2: 2, 3: 5 }
  };
  /** 二択にしてはいけない選択肢(「どれでもない」など、ほかの選択肢に左右されるもの) */
  const BAD_OPTION = /いずれも|どれも|すべて|上の|どれでもない|ない$|わからない|判断できない/;
  const BAD_STEM = /次のうち、.*でないもの|ふくまれないもの|誤っているもの/;

  function create(data) {
    const duo = (data && data.duo) || null, chem = (data && data.chem) || null, geo = (data && data.geo) || null;
    const cache = {};

    /** 手書き・自動生成の二択(data/duo.js)。c[0] が正解 */
    function duoItems(s) {
      return ((duo && duo.items) || []).filter((x) => x.s === s && x.ex > 0).map((x) => ({ id: "d:" + x.id, s: x.s, ex: x.ex, text: x.q, right: x.c[0], wrongs: [x.c[1]], explain: x.e || "" }));
    }

    /** 4択を、二択の素材にする(正解 + まちがい候補すべて。出題のたびに、まちがいを1つ選ぶ) */
    function fromChoice(list, s, filter) {
      const out = [];
      for (const q of list || []) {
        if (!(q.ex > 0) || (filter && !filter(q))) continue;
        if (BAD_STEM.test(q.q)) continue;
        const right = q.c[q.a];
        const wrongs = q.c.filter((_, i) => i !== q.a && !BAD_OPTION.test(String(q.c[i])));
        if (BAD_OPTION.test(String(right)) || !wrongs.length) continue;
        const item = { id: s[0] + ":" + q.id, s, ex: q.ex, text: q.q, right, wrongs, explain: "" };
        if (s === "chem" && q.k && q.k !== "text") { item.k = q.k; item.m = q.m; }
        out.push(item);
      }
      return out;
    }

    function pool(s) {
      if (cache[s]) return cache[s];
      let list = [];
      if (s === "en" || s === "phys") list = duoItems(s);
      else if (s === "geo") list = duoItems("geo").concat(fromChoice(geo && geo.choice, "geo", (q) => q.k === "basic" && (!q.m || !Object.keys(q.m).length)));
      else if (s === "chem") list = fromChoice(chem && chem.choice, "chem");
      return (cache[s] = list);
    }

    const count = (subjects) => (subjects || SUBJECTS).reduce((n, s) => n + pool(s).length, 0);
    const available = (subjects) => (subjects || SUBJECTS).filter((s) => pool(s).length > 0);

    function weightedPick(items, weightOf, rng) {
      let total = 0;
      const ws = items.map((x) => { const w = Math.max(0, weightOf(x)); total += w; return w; });
      if (total <= 0) return items[Math.floor(rng() * items.length)];
      let r = rng() * total;
      for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
      return items[items.length - 1];
    }

    function pick({ subjects, difficulty = "normal", rng = Math.random, used = [], round = 1, survival = false, lastSubj = [] }) {
      const subs = available(subjects);
      if (!subs.length) throw new Error("no questions");
      const usedSet = new Set(used);
      // 科目を先に選ぶ(問題の多い科目だけにかたよらない)。同じ科目が3回続かないようにする
      const sw = (s) => {
        const left = pool(s).some((x) => !usedSet.has(x.id));
        if (!left) return 0.0001;
        const run = lastSubj.length >= 2 && lastSubj.every((l) => l === s);
        return run && subs.length > 1 ? 0.05 : 1;
      };
      const s = weightedPick(subs, sw, rng);
      let items = pool(s).filter((x) => !usedSet.has(x.id));
      if (!items.length) items = pool(s);            // 出しつくしたら、もう一度(同じ問題が出ることがある)
      const base = WEIGHT[difficulty] || WEIGHT.normal;
      const shift = survival ? Math.max(0, round - 1) : 0;      // サバイバルは、進むほど発展が出やすい
      const item = weightedPick(items, (x) => base[x.ex] * (x.ex === 3 ? 1 + shift / 8 : x.ex === 1 ? Math.max(0.15, 1 - shift / 15) : 1), rng);
      const wrong = item.wrongs[Math.floor(rng() * item.wrongs.length)];
      const a = rng() < 0.5 ? 0 : 1;                  // 正解が左か右か
      const c = a === 0 ? [item.right, wrong] : [wrong, item.right];
      const pub = { id: item.id, s: item.s, ex: item.ex, text: item.text, c };
      if (item.k) { pub.k = item.k; pub.m = item.m; }
      return { pub, priv: { a, explain: item.explain || "" } };
    }

    return { count, available, pool, pick };
  }

  return { SUBJECTS, WEIGHT, create };
});
