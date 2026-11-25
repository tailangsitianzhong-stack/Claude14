/**
 * 化学クイズの単元(教科書の順)と、まとめ選びのプリセット。画面・通信に依存しない(ブラウザ・Worker・テストで共通)。
 *
 *   ChemUnits.LIST            … [{id, name, group}] 教科書の順
 *   ChemUnits.PRESETS         … [{key, name, units:[id…]}]
 *   ChemUnits.range("u12","u15") → ["u12","u13","u14","u15"]   (はじめ〜おわり。順番はどちらからでもよい)
 *   ChemUnits.clean(list)     → 知らない単元を除いて、教科書の順にそろえる。空ならすべて
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChemUnits = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const G = { base: "化学基礎", theory: "理論化学", inorg: "無機化学", org: "有機化学", poly: "高分子化合物" };
  const LIST = [
    { id: "u01", name: "物質の構成と分離", group: G.base },
    { id: "u02", name: "原子の構造と周期表", group: G.base },
    { id: "u03", name: "化学結合と結晶", group: G.base },
    { id: "u04", name: "物質量と濃度", group: G.base },
    { id: "u05", name: "化学反応式と量的関係", group: G.base },
    { id: "u06", name: "酸と塩基・中和", group: G.base },
    { id: "u07", name: "酸化還元", group: G.base },
    { id: "u08", name: "気体", group: G.theory },
    { id: "u09", name: "熱化学", group: G.theory },
    { id: "u10", name: "溶液と希薄溶液", group: G.theory },
    { id: "u11", name: "結晶格子と状態変化", group: G.theory },
    { id: "u12", name: "電池", group: G.theory },
    { id: "u13", name: "電気分解", group: G.theory },
    { id: "u14", name: "反応速度", group: G.theory },
    { id: "u15", name: "化学平衡と電離平衡", group: G.theory },
    { id: "u16", name: "非金属元素", group: G.inorg },
    { id: "u17", name: "典型金属元素", group: G.inorg },
    { id: "u18", name: "遷移元素と金属イオン", group: G.inorg },
    { id: "u19", name: "無機化学工業", group: G.inorg },
    { id: "u20", name: "脂肪族化合物", group: G.org },
    { id: "u21", name: "芳香族化合物", group: G.org },
    { id: "u22", name: "構造決定・異性体", group: G.org },
    { id: "u23", name: "天然高分子（糖・アミノ酸・油脂）", group: G.poly },
    { id: "u24", name: "合成高分子", group: G.poly }
  ];
  const IDS = LIST.map((u) => u.id);
  const span = (a, b) => IDS.slice(IDS.indexOf(a), IDS.indexOf(b) + 1);

  const PRESETS = [
    { key: "all", name: "すべて", units: [] },
    { key: "base", name: "化学基礎", units: span("u01", "u07") },
    { key: "theory", name: "理論化学", units: span("u08", "u15") },
    { key: "inorg", name: "無機化学", units: span("u16", "u19") },
    { key: "org", name: "有機化学", units: span("u20", "u22") },
    { key: "poly", name: "高分子化合物", units: span("u23", "u24") },
    { key: "echem", name: "電池と電気分解", units: span("u12", "u13") },
    { key: "acidred", name: "酸塩基と酸化還元", units: span("u06", "u07") },
    { key: "orgpoly", name: "有機＋高分子", units: span("u20", "u24") }
  ];

  /** はじめ〜おわりの単元(順番はどちらからでもよい) */
  function range(a, b) {
    const i = IDS.indexOf(a), j = IDS.indexOf(b);
    if (i < 0 || j < 0) return [];
    return IDS.slice(Math.min(i, j), Math.max(i, j) + 1);
  }

  /** 知らない単元・重なりを除き、教科書の順にそろえる。空(または全部)なら [] = すべて */
  function clean(list) {
    const set = new Set(Array.isArray(list) ? list : []);
    const out = IDS.filter((id) => set.has(id));
    return out.length === IDS.length ? [] : out;
  }

  const nameOf = (id) => (LIST.find((u) => u.id === id) || {}).name || id;
  /** 画面に出す短い説明: 「すべての単元」「電池〜電気分解」「3単元」 */
  function label(units) {
    const u = clean(units);
    if (!u.length) return "すべての単元";
    const contiguous = IDS.indexOf(u[u.length - 1]) - IDS.indexOf(u[0]) === u.length - 1;
    if (u.length === 1) return nameOf(u[0]);
    return contiguous ? `${nameOf(u[0])}〜${nameOf(u[u.length - 1])}` : `${u.length}単元`;
  }

  return { LIST, GROUPS: G, PRESETS, IDS, range, clean, nameOf, label };
});
