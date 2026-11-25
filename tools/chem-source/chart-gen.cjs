/**
 * 資料選択の「グラフ・構造式」を、パラメータから作る(手で点を打たなくてよいように)。tools/build-chem.mjs が使う。
 *   Gen.make({gen:"titration", ...})  → { k:"chart", ... }        折れ線グラフ(js/games/chem/draw.js の chart に渡す形)
 *   Gen.make({gen:"mol", name:"ethanol"}) → { k:"mol", atoms, bonds } 構造式(骨格式)
 *   Gen.make({gen:"pt", hl:[...]}) → { k:"pt", ... }
 * グラフの値は、化学の式で計算するか、理科年表などにある代表的な値(g/100 g水 など)を使う。
 */
"use strict";

const GENS = {};
const r2 = (x) => Math.round(x * 100) / 100;

/* ---------- 滴定曲線(25℃・Kw=1.0×10^-14) ---------- */
GENS.titration = (s) => {
  const { kind, c = 0.10, V0 = 20, cb = 0.10, Ka = 2.8e-5, Kb = 1.8e-5, vmax = 40 } = s;
  const pH = (vb) => {                                       // vb mL 加えたときの pH
    const n0 = c * V0 / 1000, nb = cb * vb / 1000, Vt = (V0 + vb) / 1000;
    if (kind === "sa-sb" || kind === "sb-sa") {              // 強酸+強塩基 / 強塩基+強酸(0 を酸、加えるものを塩基とみなして対称)
      const ex = kind === "sa-sb" ? n0 - nb : nb - n0;
      const h = ex > 0 ? ex / Vt : -ex / Vt;
      let val = ex > 0 ? -Math.log10(Math.max(h, 1e-14)) : 14 + Math.log10(Math.max(h, 1e-14));
      if (Math.abs(ex) < 1e-9) val = 7;
      return kind === "sa-sb" ? val : 14 - val;
    }
    if (kind === "wa-sb") {                                  // 弱酸 HA + 強塩基
      if (nb < 1e-12) return -Math.log10(Math.sqrt(Ka * c));
      if (nb < n0 - 1e-9) return -Math.log10(Ka) + Math.log10(nb / (n0 - nb));
      if (Math.abs(nb - n0) < 1e-9) { const cs = n0 / Vt, oh = Math.sqrt(1e-14 / Ka * cs); return 14 + Math.log10(oh); }
      return 14 + Math.log10((nb - n0) / Vt);
    }
    if (kind === "wb-sa") {                                  // 弱塩基 B + 強酸(酸を加える): 0 を塩基、加えるものを酸とみなす
      if (nb < 1e-12) return 14 + Math.log10(Math.sqrt(Kb * c));
      if (nb < n0 - 1e-9) return 14 + Math.log10(Kb) + Math.log10((n0 - nb) / nb);
      if (Math.abs(nb - n0) < 1e-9) { const cs = n0 / Vt, h = Math.sqrt(1e-14 / Kb * cs); return -Math.log10(h); }
      return -Math.log10((nb - n0) / Vt);
    }
    throw new Error("titration kind");
  };
  const pts = []; for (let v = 0; v <= vmax + 1e-9; v += vmax / 80) pts.push([r2(v), r2(pH(v))]);
  const eq = c * V0 / cb;
  return { k: "chart", title: "滴定曲線", xlabel: "加えた溶液の体積 (mL)", ylabel: "pH", xmax: vmax, ymax: 14, ymin: 0, series: [{ pts }], marks: s.mark === false ? [] : [{ x: eq, y: r2(pH(eq)), text: s.marktext || "" }], note: s.note || "" };
};

/* ---------- 溶解度曲線: 理科年表などにある代表的な値(g/100 g 水) ---------- */
const SOL = {
  KNO3: { label: "KNO3", y: [13.3, 31.6, 63.9, 110, 169, 246] },
  NaCl: { label: "NaCl", y: [35.7, 35.9, 36.4, 37.1, 38.0, 39.2] },
  KCl: { label: "KCl", y: [27.6, 34.0, 40.0, 45.5, 51.1, 56.7] },
  NH4Cl: { label: "NH4Cl", y: [29.4, 37.2, 45.8, 55.2, 65.6, 77.3] },
  CuSO4: { label: "CuSO4", y: [14.3, 20.7, 28.5, 40.0, 55.0, 75.4] },
  KClO3: { label: "KClO3", y: [3.3, 7.4, 14.0, 24.5, 38.5, 57.0] }
};
GENS.solubility = (s) => {
  const T = [0, 20, 40, 60, 80, 100], names = s.subs || ["KNO3", "NaCl"];
  return { k: "chart", title: "溶解度曲線", xlabel: "温度 (℃)", ylabel: "溶解度 (g/100 g 水)", xmax: 100, ymax: s.ymax || 250, series: names.map((n, i) => ({ label: s.labels ? s.labels[i] : SOL[n].label, pts: SOL[n].y.map((y, j) => [T[j], y]), lab: [100, SOL[n].y[5]] })), marks: s.marks || [], note: s.note || "" };
};

/* ---------- 反応のエネルギー図 ---------- */
GENS.energy = (s) => {
  const { Ea = 60, dH = -40, cat = false } = s;                // 反応物のエネルギー 0、生成物 dH、山の高さ Ea
  const E0 = 60;
  const curve = (ea) => { const pts = []; for (let x = 0; x <= 100; x += 2.5) { const u = x / 100; const base = E0 + (E0 + dH - E0) * (u * u * (3 - 2 * u)); const bump = ea * Math.exp(-Math.pow((u - 0.45) / 0.17, 2)); pts.push([x, r2(base + bump)]); } return pts; };
  const series = [{ pts: curve(Ea), label: "" }];
  if (cat) series.push({ pts: curve(Ea * 0.55), label: "", dash: true });
  return { k: "chart", title: "反応のエネルギー", xlabel: "反応の進み方", ylabel: "エネルギー", xmax: 100, ymax: Math.max(E0, E0 + dH) + Ea + 20, ymin: 0, series, marks: [{ x: 0, y: E0, text: "反応物" }, { x: 100, y: E0 + dH, text: "生成物" }].concat(s.marks || []), note: s.note || "" };
};

/* ---------- 濃度の時間変化 ---------- */
GENS.conc = (s) => {
  const { kind = "decay", k = 0.1, c0 = 1.0, tmax = 40 } = s;
  const a = [], b = [];
  for (let t = 0; t <= tmax; t += tmax / 40) {
    if (kind === "decay") { a.push([r2(t), r2(c0 * Math.exp(-k * t))]); b.push([r2(t), r2(c0 * (1 - Math.exp(-k * t)))]); }
    else if (kind === "approach") { a.push([r2(t), r2(c0 * (0.4 + 0.6 * Math.exp(-k * t)))]); b.push([r2(t), r2(c0 * 0.6 * (1 - Math.exp(-k * t)))]); }
  }
  return { k: "chart", title: "濃度の変化", xlabel: "時間 (分)", ylabel: "濃度 (mol/L)", xmax: tmax, ymax: Math.ceil(c0 * 10) / 10, series: [{ label: s.la || "A", pts: a }, { label: s.lb || "B", pts: b }], marks: [], note: s.note || "" };
};

/* ---------- 気体の法則 ---------- */
GENS.gas = (s) => {
  const { kind } = s;
  if (kind === "boyle") { const pts = []; for (let v = 1; v <= 10; v += 0.25) pts.push([r2(v), r2(10 / v)]); return { k: "chart", title: "p と V", xlabel: "体積 V (L)", ylabel: "圧力 p (×10^5 Pa)", xmax: 10, ymax: 10, xmin: 0, series: [{ pts }], marks: [], note: s.note || "" }; }
  if (kind === "charles") { const pts = []; for (let t = -273; t <= 100; t += 23.3) pts.push([r2(t), r2(1 + t / 273)]); return { k: "chart", title: "V と t", xlabel: "温度 t (℃)", ylabel: "体積 V (L)", xmin: -300, xmax: 100, ymax: 1.5, ymin: 0, series: [{ pts: [[-273, 0], [100, r2(1 + 100 / 273)]] }], marks: [{ x: -273, y: 0, text: "" }], note: s.note || "" }; }
  if (kind === "real") {                                          // 圧縮因子 Z = pV/(nRT)
    const mk = (a, b) => { const pts = []; for (let p = 0; p <= 600; p += 25) pts.push([p, r2(1 - a * p / 1000 + b * p * p / 1e6)]); return pts; };
    return { k: "chart", title: "圧縮因子", xlabel: "圧力 p (×10^5 Pa)", ylabel: "pV/(nRT)", xmax: 600, ymax: 2, ymin: 0, series: [{ label: "理想気体", pts: [[0, 1], [600, 1]], dash: true }, { label: "N2", pts: mk(0.1, 1.2) }, { label: "CO2", pts: mk(1.1, 2.6) }, { label: "H2", pts: mk(-0.0, 1.8) }], marks: [], note: s.note || "" };
  }
  throw new Error("gas kind");
};

/* ---------- 状態図(模式図) ---------- */
GENS.phase = (s) => {
  if (s.sub === "water") return { k: "chart", title: "水の状態図(模式図)", xlabel: "温度", ylabel: "圧力", xmax: 100, ymax: 100, series: [{ pts: [[0, 10], [22, 22]], label: "" }, { pts: [[22, 22], [100, 90]] }, { pts: [[22, 22], [20, 100]] }], marks: [{ x: 22, y: 22, text: "三重点" }, { x: 100, y: 90, text: "臨界点" }], note: s.note || "固体と液体の境界線が、右下ではなく左上にかたむく" };
  if (s.sub === "co2") return { k: "chart", title: "二酸化炭素の状態図(模式図)", xlabel: "温度", ylabel: "圧力", xmax: 100, ymax: 100, series: [{ pts: [[0, 4], [30, 25]] }, { pts: [[30, 25], [100, 90]] }, { pts: [[30, 25], [40, 100]] }], marks: [{ x: 30, y: 25, text: "三重点" }, { x: 100, y: 90, text: "臨界点" }], note: s.note || "三重点の圧力が大気圧(1.0×10^5 Pa)より高い" };
  throw new Error("phase sub");
};

/* ---------- 冷却曲線 ---------- */
GENS.cooling = (s) => {
  const solvent = [[0, 20], [10, 10], [20, 0], [60, 0], [70, -10], [80, -20]], solution = [[0, 20], [10, 10], [20, -1.5], [60, -4], [70, -10], [80, -20]];
  return { k: "chart", title: "冷却曲線", xlabel: "時間", ylabel: "温度 (℃)", xmax: 80, ymin: -25, ymax: 25, series: [{ label: "純溶媒", pts: solvent, lab: [42, 0] }, { label: "溶液", pts: solution, lab: [42, -2.8], below: true }], marks: [], note: "" };
};

/* ---------- 周期表(第1イオン化エネルギー) ---------- */
GENS.ie = (s) => {
  const IE = [1312, 2372, 520, 900, 801, 1086, 1402, 1314, 1681, 2081, 496, 738, 578, 787, 1012, 1000, 1251, 1521, 419, 590];
  return { k: "chart", title: "第1イオン化エネルギー", xlabel: "原子番号", ylabel: "イオン化エネルギー (kJ/mol)", xmin: 0, xmax: 20, ymax: 2500, series: [{ pts: IE.map((v, i) => [i + 1, v]) }], marks: (s.marks || []).map((z) => ({ x: z, y: IE[z - 1], text: "" })), note: s.note || "" };
};

/* ---------- 構造式(骨格式)のライブラリ ---------- */
const S3 = 0.866;
const zig = (n) => Array.from({ length: n }, (_, i) => [i * S3, i % 2 ? 0.5 : 0]);                // ジグザグの炭素鎖の座標
function ring6(cx, cy, r = 1, start = 90) { return Array.from({ length: 6 }, (_, i) => { const a = (start - 60 * i) * Math.PI / 180; return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; }); }
const bz = [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]];                      // ベンゼン環の結合(交互に二重結合)
function benzene(subs) {                                                                           // 置換基: { 0: ["OH", ...] } ring の頂点 0(上) に付く原子
  const R = ring6(0, 0), atoms = R.map((p) => ["C", p[0], p[1]]), bonds = bz.map((b) => b.slice());
  for (const [i, spec] of Object.entries(subs || {})) {
    const idx = Number(i), p = R[idx], ang = [90, 30, -30, -90, -150, 150][idx] * Math.PI / 180, q = [p[0] + 1 * Math.cos(ang), p[1] - 1 * Math.sin(ang)];
    const list = Array.isArray(spec) ? spec : [spec];
    let prev = idx, base = q;
    list.forEach((g, j) => {
      const n = atoms.length;
      if (typeof g === "string") { atoms.push([/^[A-Z][a-z]?$/.test(g) && g !== "C" ? g : "C", base[0], base[1], g]); bonds.push([prev, n, 1]); prev = n; base = [base[0] + Math.cos(ang), base[1] - Math.sin(ang)]; }
      else { atoms.push(g.slice(0, 3).concat(g[3] ? [g[3]] : [])); bonds.push([prev, n, g[4] || 1]); }
    });
  }
  return { atoms, bonds, rings: [] };
}
const MOLS = {
  ethanol: () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["O", 2 * S3, 0, "OH"]], bonds: [[0, 1, 1], [1, 2, 1]] }),
  "acetic-acid": () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["O", S3, 1.5, "O"], ["O", 2 * S3, 0, "OH"]], bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1]] }),
  acetaldehyde: () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["O", 2 * S3, 0]], bonds: [[0, 1, 1], [1, 2, 2]] }),
  acetone: () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["C", 2 * S3, 0], ["O", S3, 1.5]], bonds: [[0, 1, 1], [1, 2, 1], [1, 3, 2]] }),
  "ethyl-acetate": () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["O", S3, 1.5], ["O", 2 * S3, 0], ["C", 3 * S3, 0.5], ["C", 4 * S3, 0]], bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [4, 5, 1]] }),
  ethylene: () => ({ atoms: [["C", 0, 0], ["C", 1, 0]], bonds: [[0, 1, 2]] }),
  acetylene: () => ({ atoms: [["C", 0, 0], ["C", 1.2, 0]], bonds: [[0, 1, 3]] }),
  propane: () => ({ atoms: zig(3).map((p) => ["C", p[0], p[1]]), bonds: [[0, 1, 1], [1, 2, 1]] }),
  butane: () => ({ atoms: zig(4).map((p) => ["C", p[0], p[1]]), bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1]] }),
  isobutane: () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["C", 2 * S3, 0], ["C", S3, 1.5]], bonds: [[0, 1, 1], [1, 2, 1], [1, 3, 1]] }),
  "1-propanol": () => ({ atoms: [...zig(3).map((p) => ["C", p[0], p[1]]), ["O", 3 * S3, 0.5, "OH"]], bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1]] }),
  "2-propanol": () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["C", 2 * S3, 0], ["O", S3, 1.5, "OH"]], bonds: [[0, 1, 1], [1, 2, 1], [1, 3, 1]] }),
  "diethyl-ether": () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["O", 2 * S3, 0], ["C", 3 * S3, 0.5], ["C", 4 * S3, 0]], bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1]] }),
  benzene: () => ({ atoms: ring6(0, 0).map((p) => ["C", p[0], p[1]]), bonds: bz.map((b) => b.slice()) }),
  toluene: () => benzene({ 0: [["C", 0, -1.9]] }),
  phenol: () => benzene({ 0: "OH" }),
  aniline: () => benzene({ 0: "NH2" }),
  nitrobenzene: () => benzene({ 0: "NO2" }),
  "benzoic-acid": () => { const m = benzene({ 0: [["C", 0, -1.9]] }); const n = m.atoms.length; m.atoms.push(["O", -0.866, -2.4, "O"], ["O", 0.866, -2.4, "OH"]); m.bonds.push([6, n, 2], [6, n + 1, 1]); return m; },
  "salicylic-acid": () => { const m = benzene({ 0: "OH" }); const R = ring6(0, 0); const c = m.atoms.length; m.atoms.push(["C", R[1][0] + 0.866, R[1][1] - 0.5], ["O", R[1][0] + 0.866, R[1][1] - 1.5, "O"], ["O", R[1][0] + 1.732, R[1][1], "OH"]); m.bonds.push([1, c, 1], [c, c + 1, 2], [c, c + 2, 1]); return m; },
  styrene: () => { const m = benzene({ 0: [["C", 0, -1.9]] }); m.atoms.push(["C", 0.866, -2.4]); m.bonds.push([6, 7, 2]); return m; },
  glycine: () => ({ atoms: [["N", 0, 0, "H2N"], ["C", S3, 0.5], ["C", 2 * S3, 0], ["O", 2 * S3, -1, "O"], ["O", 3 * S3, 0.5, "OH"]], bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 2], [2, 4, 1]] }),
  alanine: () => ({ atoms: [["N", 0, 0, "H2N"], ["C", S3, 0.5], ["C", 2 * S3, 0], ["O", 2 * S3, -1, "O"], ["O", 3 * S3, 0.5, "OH"], ["C", S3, 1.5]], bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 2], [2, 4, 1], [1, 5, 1]] }),
  methanol: () => ({ atoms: [["C", 0, 0], ["O", 1, 0, "OH"]], bonds: [[0, 1, 1]] }),
  "formic-acid": () => ({ atoms: [["C", 0, 0], ["O", 0, -1, "O"], ["O", 0.9, 0.5, "OH"]], bonds: [[0, 1, 2], [0, 2, 1]] }),
  cyclohexane: () => ({ atoms: ring6(0, 0).map((p) => ["C", p[0], p[1]]), bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1]] }),
  "vinyl-chloride": () => ({ atoms: [["C", 0, 0], ["C", S3, 0.5], ["Cl", 2 * S3, 0]], bonds: [[0, 1, 2], [1, 2, 1]] }),
  "terephthalic-acid": () => { const R = ring6(0, 0, 1, 0); const atoms = R.map((p) => ["C", p[0], p[1]]); atoms.push(["C", 2, 0], ["O", 2.6, -0.9, "O"], ["O", 2.6, 0.9, "OH"], ["C", -2, 0], ["O", -2.6, -0.9, "O"], ["O", -2.6, 0.9, "HO"]); return { atoms, bonds: [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1], [0, 6, 1], [6, 7, 2], [6, 8, 1], [3, 9, 1], [9, 10, 2], [9, 11, 1]], rings: [] }; }
};
GENS.mol = (s) => { const f = MOLS[s.name]; if (!f) throw new Error("知らない分子 " + s.name); const m = f(); return Object.assign({ k: "mol", note: s.note || "" }, m); };
GENS.pt = (s) => ({ k: "pt", hl: s.hl || [], tags: s.tags || {}, hideSymbols: !!s.hideSymbols });
function make(spec) { const g = GENS[spec.gen]; if (!g) throw new Error("知らないグラフ " + spec.gen); return g(spec); }
module.exports = { make, GENS, MOLS };
