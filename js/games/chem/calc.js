/**
 * 化学クイズ「計算」: 問題のテンプレートと、答えの採点。画面・通信に依存しない(ブラウザ・Worker・テストで共通)。
 * テンプレートは、乱数で数字を変えて毎回あたらしい問題をつくる。正解はプログラムで計算し、途中式(steps)つきで返す。
 *
 *   const C = ChemCalc;
 *   C.TEMPLATES                           … [{id, u(単元), lv(1〜3), ex(0=大学入試に出さない/1〜3=基礎・標準・発展), xo(大学入試だけ), time(秒), gen(rng)}]
 *   const q = C.build(C.TEMPLATES[0], rng) … { pub:{id,mode:"calc",u,lv,ex,text,unit,sig,time}, priv:{ans,unit,tol,steps,ansText} }
 *   C.check("1.5×10^3", q.priv)           … 答えが合っているか(有効数字の指定と、途中の丸めを考えた許容つき)
 *   C.parse("1.2e3") → 1200               … 入力した数のよみとり(分数・×10^・e表記に対応。読めなければ null)
 *
 * 問題文・途中式の化学式は [[H2SO4]] のように書く(表示は ChemFmt)。原子量は、問題文に書いて、それを使う。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChemCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 小さな道具 ---------- */
  const int = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const pickN = (rng, arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  /** 有効数字 n 桁に丸めた数 */
  const sig = (x, n) => (x === 0 ? 0 : Number(x.toPrecision(n)));
  /** 見た目のための数(余分な 0 を取る。小さい/大きい数は ×10^ で) */
  function nf(x, d) {
    if (d != null) return Number(x).toFixed(d);
    if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) { const e = Math.floor(Math.log10(Math.abs(x))), m = sig(x / 10 ** e, 3); return `${m}×10^${e}`.replace("^-", "^−"); }
    return String(sig(x, 6));
  }
  /** 答えの表示(有効数字 n 桁) */
  function show(x, n) {
    if (x === 0) return "0";
    const e = Math.floor(Math.log10(Math.abs(x)));
    if (e >= 5 || e <= -4) { const m = (x / 10 ** e).toFixed(Math.max(0, n - 1)); return `${m}×10^${e}`.replace("^-", "^−"); }
    const d = Math.max(0, n - 1 - e);
    return Number(x).toFixed(Math.min(d, 8));
  }

  /* ---------- 原子量・式量 ---------- */
  const AM = { H: 1.0, He: 4.0, Li: 7.0, C: 12, N: 14, O: 16, F: 19, Ne: 20, Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32, Cl: 35.5, K: 39, Ca: 40, Mn: 55, Fe: 56, Cu: 64, Zn: 65, Br: 80, Ag: 108, I: 127, Ba: 137, Pb: 207 };
  /** 化学式(下つきは数字で書く。括弧・水和物「・nH2O」に対応)から式量を求める */
  function mass(f) {
    const parts = String(f).split(/[·・.]/);
    let total = 0;
    for (const part of parts) {
      const m0 = /^(\d+)(.*)$/.exec(part);
      const k = m0 ? Number(m0[1]) : 1, body = m0 ? m0[2] : part;
      let pos = 0;
      const parse = () => {
        let sum = 0;
        while (pos < body.length && body[pos] !== ")") {
          if (body[pos] === "(") { pos++; const inner = parse(); pos++; const n = num(); sum += inner * n; }
          else { const m = /^[A-Z][a-z]?/.exec(body.slice(pos)); if (!m || AM[m[0]] == null) throw new Error("bad formula " + f); pos += m[0].length; sum += AM[m[0]] * num(); }
        }
        return sum;
      };
      const num = () => { const m = /^\d+/.exec(body.slice(pos)); if (!m) return 1; pos += m[0].length; return Number(m[0]); };
      total += k * parse();
    }
    return total;
  }

  /* ---------- テンプレート ---------- */
  const TEMPLATES = [];
  /** T(id, 単元, レベル, 大学入試の段階(0=出さない), 制限時間(秒), 作る関数, {xo}) */
  function T(id, u, lv, ex, time, gen, o) { TEMPLATES.push({ id, u, lv, ex, time, xo: !!(o && o.xo), gen }); }

  const AMNOTE = (...els) => "原子量: " + els.map((e) => `${e}=${AM[e]}`).join("、");
  const R_GAS = 8.3, F_CONST = 9.65e4, NA = 6.0e23;

  /* ===== u04 物質量と濃度 ===== */
  const SUBST = [["H2O", "水", ["H", "O"]], ["CO2", "二酸化炭素", ["C", "O"]], ["NaCl", "塩化ナトリウム", ["Na", "Cl"]], ["CaCO3", "炭酸カルシウム", ["Ca", "C", "O"]], ["NH3", "アンモニア", ["N", "H"]], ["H2SO4", "硫酸", ["H", "S", "O"]], ["NaOH", "水酸化ナトリウム", ["Na", "O", "H"]], ["C6H12O6", "グルコース", ["C", "H", "O"]], ["CH4", "メタン", ["C", "H"]], ["CuSO4", "硫酸銅(II)", ["Cu", "S", "O"]], ["Mg(OH)2", "水酸化マグネシウム", ["Mg", "O", "H"]], ["Al2O3", "酸化アルミニウム", ["Al", "O"]], ["C2H5OH", "エタノール", ["C", "H", "O"]], ["KNO3", "硝酸カリウム", ["K", "N", "O"]]];
  T("mol-from-mass", "u04", 1, 0, 50, (rng) => {
    const [f, , els] = pick(rng, SUBST), M = mass(f), n = pick(rng, [0.25, 0.5, 1.5, 2, 2.5, 4, 0.20, 0.10]);
    const g = sig(n * M, 4);
    return { text: `[[${f}]] ${nf(g)} g は何 mol か。（${AMNOTE(...els)}）`, ans: n, unit: "mol", sig: 2, steps: [`式量: [[${f}]] = ${nf(M)}、モル質量 ${nf(M)} g/mol`, `${nf(g)} ÷ ${nf(M)} = ${nf(n)} mol`] };
  });
  T("mass-from-mol", "u04", 1, 0, 50, (rng) => {
    const [f, , els] = pick(rng, SUBST), M = mass(f), n = pick(rng, [0.50, 1.5, 2.0, 0.25, 3.0, 0.10, 5.0]);
    return { text: `[[${f}]] ${nf(n, 2)} mol の質量は何 g か。（${AMNOTE(...els)}）`, ans: n * M, unit: "g", sig: 3, steps: [`モル質量: [[${f}]] = ${nf(M)} g/mol`, `${nf(n)} × ${nf(M)} = ${nf(n * M)} g`] };
  });
  T("number-of-molecules", "u04", 1, 0, 55, (rng) => {
    const [f] = pick(rng, SUBST.slice(0, 5)), n = pick(rng, [0.50, 2.0, 0.10, 1.5, 3.0]);
    return { text: `[[${f}]] ${nf(n, 2)} mol には、何個の分子がふくまれるか。アボガドロ定数は 6.0×10^23/mol とする。（答えは 6.0×10^23 のように入力）`, ans: n * NA, unit: "個", sig: 2, steps: [`${nf(n)} × 6.0×10^23 = ${show(n * NA, 2)} 個`] };
  });
  T("gas-volume-stp", "u04", 1, 0, 55, (rng) => {
    const [f, , els] = pick(rng, [["CO2", "", ["C", "O"]], ["O2", "", ["O"]], ["NH3", "", ["N", "H"]], ["CH4", "", ["C", "H"]], ["H2", "", ["H"]]]), M = mass(f), n = pick(rng, [0.50, 2.0, 0.25, 1.5, 0.10]);
    const g = sig(n * M, 4);
    return { text: `標準状態（0℃、1.013×10^5 Pa）の [[${f}]] ${nf(g)} g の体積は何 L か。モル体積は 22.4 L/mol。（${AMNOTE(...els)}）`, ans: n * 22.4, unit: "L", sig: 3, steps: [`物質量: ${nf(g)} ÷ ${nf(M)} = ${nf(n)} mol`, `体積: ${nf(n)} × 22.4 = ${nf(n * 22.4)} L`] };
  });
  T("molarity", "u04", 1, 1, 60, (rng) => {
    const [f, , els] = pick(rng, [["NaOH", "", ["Na", "O", "H"]], ["NaCl", "", ["Na", "Cl"]], ["KNO3", "", ["K", "N", "O"]], ["CuSO4", "", ["Cu", "S", "O"]], ["Na2CO3", "", ["Na", "C", "O"]]]), M = mass(f);
    const n = pick(rng, [0.050, 0.10, 0.20, 0.25, 0.50]), V = pick(rng, [250, 500, 200, 100, 1000]);
    const g = sig(n * M, 4), C = n * 1000 / V;
    return { text: `[[${f}]] ${nf(g)} g を水に溶かして ${V} mL にした。この水溶液のモル濃度は何 mol/L か。（${AMNOTE(...els)}）`, ans: C, unit: "mol/L", sig: 2, steps: [`物質量: ${nf(g)} ÷ ${nf(M)} = ${nf(n)} mol`, `${V} mL = ${nf(V / 1000)} L なので、${nf(n)} ÷ ${nf(V / 1000)} = ${nf(C)} mol/L`] };
  });
  T("dilution", "u04", 1, 1, 60, (rng) => {
    const C1 = pick(rng, [1.0, 2.0, 0.50, 5.0]), V1 = pick(rng, [10, 20, 25, 50]), k = pick(rng, [2, 4, 5, 10]);
    const C2 = C1 / k, V2 = V1 * k;
    return { text: `${nf(C1, 1)} mol/L の水溶液 ${V1} mL に水を加えて、${nf(C2)} mol/L に薄めたい。加える水は何 mL か。（体積は変わらないものとする）`, ans: V2 - V1, unit: "mL", sig: 2, steps: [`薄めても溶質の物質量は変わらない: ${nf(C1)} × ${V1} = ${nf(C2)} × V`, `V = ${V2} mL（全体の体積）`, `加える水: ${V2} − ${V1} = ${V2 - V1} mL`] };
  });
  T("mass-percent-molarity", "u04", 3, 2, 90, (rng) => {
    const [f, , els, w, d] = pick(rng, [["H2SO4", "", ["H", "S", "O"], 98, 1.84], ["HCl", "", ["H", "Cl"], 36.5, 1.18], ["NaOH", "", ["Na", "O", "H"], 40, 1.43], ["HNO3", "", ["H", "N", "O"], 63, 1.38]].map(([a, b, c, M, dd]) => [a, b, c, pick(rng, a === "HCl" ? [36, 37, 35] : a === "H2SO4" ? [96, 98, 90] : a === "NaOH" ? [30, 40, 25] : [60, 63, 65]), dd]));
    const M = mass(f), C = 10 * d * w / M;
    return { text: `質量パーセント濃度 ${w} %、密度 ${d} g/cm³ の [[${f}]] 水溶液のモル濃度は何 mol/L か。（${AMNOTE(...els)}）`, ans: C, unit: "mol/L", sig: 3, steps: [`1 L（=1000 cm³）の質量: 1000 × ${d} = ${nf(1000 * d)} g`, `溶質の質量: ${nf(1000 * d)} × ${w}/100 = ${nf(10 * d * w)} g`, `物質量: ${nf(10 * d * w)} ÷ ${nf(M)} = ${nf(C)} mol → ${nf(C)} mol/L`] };
  });

  /* ===== u05 化学反応式と量的関係 ===== */
  const RXN = [
    { eq: "2H2 + O2 → 2H2O", a: ["H2", 2], b: ["H2O", 2], els: ["H", "O"], gas: ["H2"] },
    { eq: "CaCO3 → CaO + CO2", a: ["CaCO3", 1], b: ["CO2", 1], els: ["Ca", "C", "O"], gas: ["CO2"] },
    { eq: "CH4 + 2O2 → CO2 + 2H2O", a: ["CH4", 1], b: ["CO2", 1], els: ["C", "H", "O"], gas: ["CH4", "CO2"] },
    { eq: "C3H8 + 5O2 → 3CO2 + 4H2O", a: ["C3H8", 1], b: ["CO2", 3], els: ["C", "H", "O"], gas: ["C3H8", "CO2"] },
    { eq: "2Mg + O2 → 2MgO", a: ["Mg", 2], b: ["MgO", 2], els: ["Mg", "O"], gas: [] },
    { eq: "Zn + 2HCl → ZnCl2 + H2", a: ["Zn", 1], b: ["H2", 1], els: ["Zn", "H", "Cl"], gas: ["H2"] },
    { eq: "2Al + 6HCl → 2AlCl3 + 3H2", a: ["Al", 2], b: ["H2", 3], els: ["Al", "H", "Cl"], gas: ["H2"] },
    { eq: "2KClO3 → 2KCl + 3O2", a: ["KClO3", 2], b: ["O2", 3], els: ["K", "Cl", "O"], gas: ["O2"] },
    { eq: "N2 + 3H2 → 2NH3", a: ["H2", 3], b: ["NH3", 2], els: ["N", "H"], gas: ["N2", "H2", "NH3"] },
    { eq: "2Na + 2H2O → 2NaOH + H2", a: ["Na", 2], b: ["H2", 1], els: ["Na", "H", "O"], gas: ["H2"] }
  ];
  T("rxn-mass-to-mass", "u05", 2, 1, 80, (rng) => {
    const r = pick(rng, RXN.filter((x) => !x.gas.includes(x.b[0]) || true)), [fa, ca] = r.a, [fb, cb] = r.b;
    const Ma = mass(fa), Mb = mass(fb), nA = pick(rng, [0.50, 1.0, 2.0, 0.25, 1.5, 4.0]) * ca / ca;
    const gA = sig(nA * Ma, 4), ans = nA * (cb / ca) * Mb;
    return { text: `次の反応で、[[${fa}]] ${nf(gA)} g が完全に反応すると、[[${fb}]] は何 g 生じるか。\n[[${r.eq}]]\n（${AMNOTE(...r.els)}）`, ans, unit: "g", sig: 3, steps: [`[[${fa}]] の物質量: ${nf(gA)} ÷ ${nf(Ma)} = ${nf(nA)} mol`, `係数比 ${fa} : ${fb} = ${ca} : ${cb} より、[[${fb}]] は ${nf(nA)} × ${cb}/${ca} = ${nf(nA * cb / ca)} mol`, `質量: ${nf(nA * cb / ca)} × ${nf(Mb)} = ${nf(ans)} g`] };
  });
  T("rxn-gas-volume", "u05", 2, 1, 80, (rng) => {
    const r = pick(rng, RXN.filter((x) => x.gas.includes(x.b[0]))), [fa, ca] = r.a, [fb, cb] = r.b;
    const Ma = mass(fa), nA = pick(rng, [0.50, 1.0, 2.0, 0.25, 1.5, 4.0]);
    const gA = sig(nA * Ma, 4), ans = nA * (cb / ca) * 22.4;
    return { text: `次の反応で、[[${fa}]] ${nf(gA)} g が完全に反応すると、標準状態で [[${fb}]] は何 L 生じるか。（モル体積 22.4 L/mol）\n[[${r.eq}]]\n（${AMNOTE(...r.els)}）`, ans, unit: "L", sig: 3, steps: [`[[${fa}]] の物質量: ${nf(gA)} ÷ ${nf(Ma)} = ${nf(nA)} mol`, `係数比より [[${fb}]] は ${nf(nA * cb / ca)} mol`, `体積: ${nf(nA * cb / ca)} × 22.4 = ${nf(ans)} L`] };
  });
  /* ===== u06 酸と塩基・中和 ===== */
  T("ph-strong-base", "u06", 1, 1, 60, (rng) => {
    const [name, f, k] = pick(rng, [["水酸化ナトリウム", "NaOH", 1], ["水酸化カルシウム", "Ca(OH)2", 2], ["水酸化カリウム", "KOH", 1]]), c = pick(rng, [0.10, 0.010, 0.0010, 0.050, 0.0050]);
    const OH = c * k, pOH = -Math.log10(OH), pH = 14 - pOH;
    return { text: `${nf(c)} mol/L の${name}（[[${f}]]）水溶液の pH を求めよ。完全に電離するものとし、25℃で水のイオン積 [[Kw]] = 1.0×10^−14 (mol/L)² 、log10 2 = 0.30 とする。`, ans: Math.round(pH * 100) / 100, unit: "", sig: 3, tol: { abs: 0.06 }, steps: [`[[OH^-]] = ${nf(c)} × ${k} = ${nf(OH)} mol/L`, `pOH = ${nf(Math.round(pOH * 100) / 100)}、pH = 14 − pOH = ${nf(Math.round(pH * 100) / 100)}`] };
  });
  T("neutralization-volume", "u06", 2, 1, 80, (rng) => {
    const [fa, ka, name] = pick(rng, [["HCl", 1, "塩酸"], ["H2SO4", 2, "硫酸"], ["CH3COOH", 1, "酢酸"], ["HNO3", 1, "硝酸"]]);
    const [fb, kb, nameB] = pick(rng, [["NaOH", 1, "水酸化ナトリウム水溶液"], ["Ba(OH)2", 2, "水酸化バリウム水溶液"], ["KOH", 1, "水酸化カリウム水溶液"]]);
    const ca = pick(rng, [0.10, 0.20, 0.050, 0.25]), Va = pick(rng, [10, 20, 25, 50]), cb = pick(rng, [0.10, 0.20, 0.050, 0.25, 0.40]);
    const Vb = ka * ca * Va / (kb * cb);
    return { text: `${nf(ca, 2)} mol/L の${name}（[[${fa}]]）${Va} mL を中和するのに、${nf(cb, 2)} mol/L の${nameB}（[[${fb}]]）は何 mL 必要か。`, ans: Vb, unit: "mL", sig: 3, steps: [`酸の出す [[H^+]]: ${ka} × ${nf(ca)} × ${Va}/1000 mol`, `塩基の出す [[OH^-]]: ${kb} × ${nf(cb)} × V/1000 mol`, `中和では 酸の価数×物質量 = 塩基の価数×物質量 なので V = ${nf(Vb)} mL`] };
  });
  /* ===== u07 酸化還元 ===== */
  T("oxidation-number", "u07", 1, 1, 45, (rng) => {
    const [f, el, n] = pick(rng, [["H2SO4", "S", 6], ["SO2", "S", 4], ["H2S", "S", -2], ["KMnO4", "Mn", 7], ["K2Cr2O7", "Cr", 6], ["Na2S2O3", "S", 2], ["NH3", "N", -3], ["HNO3", "N", 5], ["NO2", "N", 4], ["HClO4", "Cl", 7], ["MnO2", "Mn", 4], ["Cl2", "Cl", 0], ["NaClO", "Cl", 1], ["CO2", "C", 4], ["CH4", "C", -4], ["NH4Cl", "N", -3]]);
    return { text: `[[${f}]] にふくまれる ${el} 原子の酸化数を求めよ。（符号をつけて入力。例: −2）`, ans: n, unit: "", sig: 1, tol: { abs: 0.01 }, steps: [`化合物全体の酸化数の和は 0（H は +1、O は −2、アルカリ金属は +1 など）`, `したがって ${el} の酸化数は ${n > 0 ? "+" : ""}${n}`] };
  });
  T("redox-titration", "u07", 3, 2, 110, (rng) => {
    const cK = pick(rng, [0.020, 0.010, 0.040]), VK = pick(rng, [10, 20, 16, 12]), Vh = pick(rng, [10, 20, 25]);
    const ch = 2.5 * cK * VK / Vh;
    return { text: `濃度のわからない過酸化水素水 ${Vh} mL に硫酸を加えて酸性にし、${nf(cK, 3)} mol/L の過マンガン酸カリウム水溶液で滴定したら、${VK} mL で終点になった。過酸化水素水のモル濃度は何 mol/L か。\n[[2MnO4^- + 5H2O2 + 6H^+ → 2Mn^2+ + 5O2 + 8H2O]]`, ans: ch, unit: "mol/L", sig: 3, steps: [`加えた [[KMnO4]]: ${nf(cK)} × ${VK}/1000 = ${nf(cK * VK / 1000)} mol`, `係数比 2 : 5 より [[H2O2]] は ${nf(cK * VK / 1000)} × 5/2 = ${nf(2.5 * cK * VK / 1000)} mol`, `モル濃度: ${nf(2.5 * cK * VK / 1000)} ÷ ${nf(Vh / 1000)} = ${nf(ch)} mol/L`] };
  });

  /* ===== u08 気体 ===== */
  T("ideal-gas-pressure", "u08", 2, 1, 80, (rng) => {
    const n = pick(rng, [0.50, 1.0, 2.0, 0.20]), T0 = pick(rng, [300, 400, 273, 350, 500]), V = pick(rng, [5.0, 10, 4.0, 20, 2.5]);
    const p = n * R_GAS * T0 / V;
    return { text: `${nf(n, 2)} mol の理想気体を、${nf(V, 1)} L の容器に入れて ${T0} K に保った。気体の圧力は何 kPa か。気体定数 R = 8.3 kPa·L/(K·mol)。`, ans: p, unit: "kPa", sig: 3, steps: [`pV = nRT より p = nRT/V`, `p = ${nf(n)} × 8.3 × ${T0} ÷ ${nf(V)} = ${nf(p)} kPa`] };
  });
  T("boyle-charles", "u08", 2, 1, 80, (rng) => {
    const V1 = pick(rng, [2.0, 3.0, 4.0, 6.0]), T1 = pick(rng, [300, 273, 400]), T2 = pick(rng, [600, 546, 450, 360].filter((x) => x !== T1)), p1 = pick(rng, [1.0, 2.0]), p2 = pick(rng, [1.0, 4.0, 0.5]);
    const V2 = V1 * (p1 / p2) * (T2 / T1);
    return { text: `圧力 ${nf(p1, 1)}×10^5 Pa、温度 ${T1} K で体積 ${nf(V1, 1)} L の気体を、圧力 ${nf(p2, 1)}×10^5 Pa、温度 ${T2} K にしたときの体積は何 L か。`, ans: V2, unit: "L", sig: 3, steps: [`ボイル・シャルルの法則 p₁V₁/T₁ = p₂V₂/T₂`, `V₂ = ${nf(V1)} × (${nf(p1)}/${nf(p2)}) × (${T2}/${T1}) = ${nf(V2)} L`] };
  });
  T("partial-pressure", "u08", 2, 1, 80, (rng) => {
    const nA = pick(rng, [1.0, 2.0, 3.0]), nB = pick(rng, [1.0, 2.0, 4.0, 3.0]), P = pick(rng, [1.0, 2.0, 3.0]);
    const pa = P * nA / (nA + nB);
    return { text: `全圧 ${nf(P, 1)}×10^5 Pa の混合気体が、気体 A ${nf(nA, 1)} mol と気体 B ${nf(nB, 1)} mol からなる。A の分圧は何×10^5 Pa か。`, ans: pa, unit: "×10^5 Pa", sig: 3, steps: [`分圧 = 全圧 × モル分率`, `A のモル分率: ${nA}/(${nA}+${nB})`, `${nf(P)} × ${nA}/${nA + nB} = ${nf(pa)} ×10^5 Pa`] };
  });
  T("molar-mass-from-gas", "u08", 3, 2, 100, (rng) => {
    const M = pick(rng, [32, 44, 28, 16, 64, 17]), T0 = pick(rng, [300, 400, 350]), V = pick(rng, [1.0, 2.0, 4.0]), p = pick(rng, [83, 166, 110, 249]);
    const w = M * p * V / (R_GAS * T0);
    return { text: `ある気体 ${nf(sig(w, 4))} g を ${nf(V, 1)} L の容器に入れて ${T0} K に保つと、圧力は ${p} kPa であった。この気体の分子量を求めよ。R = 8.3 kPa·L/(K·mol)。`, ans: M, unit: "", sig: 2, tol: { rel: 0.03 }, steps: [`pV = (w/M)RT より M = wRT/(pV)`, `M = ${nf(sig(w, 4))} × 8.3 × ${T0} ÷ (${p} × ${nf(V)}) ≈ ${nf(M)}`] };
  });

  /* ===== u09 熱化学 ===== */
  T("heat-capacity", "u09", 1, 1, 70, (rng) => {
    const m = pick(rng, [100, 200, 50, 250, 500]), dT = pick(rng, [5.0, 10.0, 15.0, 20.0, 8.0]);
    const q = m * 4.2 * dT / 1000;
    return { text: `水 ${m} g の温度を ${nf(dT, 1)} ℃ 上げるのに必要な熱量は何 kJ か。水の比熱は 4.2 J/(g·K) とする。`, ans: q, unit: "kJ", sig: 3, steps: [`q = m·c·ΔT = ${m} × 4.2 × ${nf(dT)} = ${nf(m * 4.2 * dT)} J`, `${nf(q)} kJ`] };
  });
  T("formation-enthalpy", "u09", 2, 2, 100, (rng) => {
    const set = pick(rng, [
      { eq: "CH4 + 2O2 → CO2 + 2H2O(液)", pr: [["CO2", 1, -394], ["H2O(液)", 2, -286]], re: [["CH4", 1, -75], ["O2", 2, 0]] },
      { eq: "C2H4 + 3O2 → 2CO2 + 2H2O(液)", pr: [["CO2", 2, -394], ["H2O(液)", 2, -286]], re: [["C2H4", 1, 52], ["O2", 3, 0]] },
      { eq: "C2H5OH(液) + 3O2 → 2CO2 + 3H2O(液)", pr: [["CO2", 2, -394], ["H2O(液)", 3, -286]], re: [["C2H5OH(液)", 1, -277], ["O2", 3, 0]] }
    ]);
    const sp = set.pr.reduce((s, x) => s + x[1] * x[2], 0), sr = set.re.reduce((s, x) => s + x[1] * x[2], 0);
    const lines = [...set.pr, ...set.re].filter((x) => x[2] !== 0).map((x) => `[[${x[0]}]] の生成熱 ${x[2] >= 0 ? "+" : "−"}${Math.abs(x[2])} kJ/mol`).join("、");
    return { text: `次の反応の反応熱を、生成熱から求めよ。（答えは符号をつけて入力。発熱なら負）\n[[${set.eq}]]\n生成熱: ${lines}（[[O2]] の生成熱は 0）`, ans: sp - sr, unit: "kJ", sig: 3, steps: [`反応熱 = (生成物の生成熱の和) − (反応物の生成熱の和)`, `= (${set.pr.map((x) => `${x[1]}×(${x[2]})`).join(" + ")}) − (${set.re.map((x) => `${x[1]}×(${x[2]})`).join(" + ")})`, `= ${sp} − (${sr}) = ${sp - sr} kJ`] };
  });
  T("calorimeter", "u09", 3, 2, 110, (rng) => {
    const m = pick(rng, [100, 200, 150, 250]), dT = pick(rng, [2.0, 3.0, 4.0, 5.0]), n = pick(rng, [0.050, 0.10, 0.025]);
    const q = m * 4.2 * dT, Q = q / n / 1000;
    return { text: `${m} g の水に、固体 ${nf(n, 3)} mol を溶かしたら、水温が ${nf(dT, 1)} ℃ 上昇した。この固体の溶解熱は 1 mol あたり何 kJ か。水の比熱は 4.2 J/(g·K) とし、熱は水の温度変化にだけ使われたとする。`, ans: Q, unit: "kJ/mol", sig: 3, steps: [`発生した熱量: ${m} × 4.2 × ${nf(dT)} = ${nf(q)} J = ${nf(q / 1000)} kJ`, `1 mol あたり: ${nf(q / 1000)} ÷ ${nf(n)} = ${nf(Q)} kJ/mol`] };
  });

  /* ===== u10 溶液と希薄溶液 ===== */
  T("osmotic-pressure", "u10", 3, 2, 100, (rng) => {
    const c = pick(rng, [0.010, 0.020, 0.10, 0.050]), T0 = pick(rng, [300, 280, 320, 273]);
    const pi = c * R_GAS * T0;
    return { text: `${nf(c, 3)} mol/L の非電解質水溶液の、${T0} K における浸透圧は何 kPa か。R = 8.3 kPa·L/(K·mol)。`, ans: pi, unit: "kPa", sig: 3, steps: [`ファントホッフの式 Π = cRT`, `Π = ${nf(c)} × 8.3 × ${T0} = ${nf(pi)} kPa`] };
  });

  /* ===== u11 結晶格子と状態変化 ===== */
  /* ===== u12 電池・u13 電気分解 ===== */
  T("electrolysis-gas", "u13", 2, 1, 90, (rng) => {
    const I = pick(rng, [1.0, 2.0, 5.0, 0.50]), t = pick(rng, [965, 1930, 3860, 9650]);
    const q = I * t, ne = q / F_CONST, V = ne / 4 * 22.4;
    return { text: `白金電極を用いて希硫酸（[[H2SO4]]水溶液）を、${nf(I, 2)} A で ${t} 秒間電気分解した。陽極で発生する酸素の体積は、標準状態で何 L か。ファラデー定数 9.65×10^4 C/mol。\n陽極: [[2H2O → O2 + 4H^+ + 4e^-]]`, ans: V, unit: "L", sig: 3, steps: [`電気量 ${nf(I)} × ${t} = ${nf(q)} C → 電子 ${nf(ne)} mol`, `[[O2]] 1 mol あたり電子 4 mol なので [[O2]] は ${nf(ne / 4)} mol`, `体積: ${nf(ne / 4)} × 22.4 = ${nf(V)} L`] };
  });
  T("electrolysis-time", "u13", 3, 2, 110, (rng) => {
    const I = pick(rng, [2.0, 5.0, 1.0, 10.0]), g = pick(rng, [0.64, 1.28, 3.2, 0.32]);
    const n = g / 64 * 2, t = n * F_CONST / I;
    return { text: `硫酸銅(II)水溶液を、銅電極を用いて ${nf(I, 1)} A の電流で電気分解し、陰極に銅 ${nf(g, 2)} g を析出させたい。何秒間電流を流せばよいか。原子量 Cu=64、ファラデー定数 9.65×10^4 C/mol。`, ans: t, unit: "秒", sig: 3, steps: [`銅 ${nf(g)} g = ${nf(g / 64)} mol、電子はその 2 倍 = ${nf(n)} mol`, `電気量: ${nf(n)} × 9.65×10^4 = ${nf(n * F_CONST)} C`, `時間: ${nf(n * F_CONST)} ÷ ${nf(I)} = ${nf(t)} 秒`] };
  });
  T("cell-zinc-mass", "u12", 3, 2, 110, (rng) => {
    const I = pick(rng, [0.50, 1.0, 0.20, 2.0]), t = pick(rng, [1930, 965, 3860, 9650]);
    const q = I * t, dm = q / F_CONST / 2 * 65;
    return { text: `ダニエル電池を ${nf(I, 2)} A で ${t} 秒間放電した。亜鉛板（負極）の質量は何 g 減少するか。原子量 Zn=65、ファラデー定数 9.65×10^4 C/mol。\n負極: [[Zn → Zn^2+ + 2e^-]]`, ans: dm, unit: "g", sig: 3, steps: [`電気量: ${nf(I)} × ${t} = ${nf(q)} C → 電子 ${nf(q / F_CONST)} mol`, `[[Zn]] は電子 2 個で 1 個溶けるので ${nf(q / F_CONST / 2)} mol`, `質量: ${nf(q / F_CONST / 2)} × 65 = ${nf(dm)} g`] };
  });

  /* ===== u14 反応速度 ===== */
  T("rate-average", "u14", 1, 1, 70, (rng) => {
    const c0 = pick(rng, [1.0, 0.80, 0.60, 0.50]), dc = pick(rng, [0.20, 0.10, 0.30, 0.15]), dt = pick(rng, [10, 20, 50, 5]);
    return { text: `反応物 A の濃度が、${dt} 秒間に ${nf(c0, 2)} mol/L から ${nf(c0 - dc, 2)} mol/L に減少した。この間の A の平均の反応速度は何 mol/(L·s) か。`, ans: dc / dt, unit: "mol/(L·s)", sig: 2, steps: [`v = −Δ[A]/Δt = ${nf(dc)} ÷ ${dt} = ${nf(dc / dt)} mol/(L·s)`] };
  });
  T("half-life", "u14", 2, 1, 80, (rng) => {
    const half = pick(rng, [10, 20, 30, 5]), k = pick(rng, [2, 3, 4]), c0 = pick(rng, [0.80, 1.6, 0.40, 2.0]);
    const c = c0 / 2 ** k;
    return { text: `一次反応で、半減期が ${half} 分の物質 A の濃度が最初 ${nf(c0, 2)} mol/L であった。${half * k} 分後の濃度は何 mol/L か。`, ans: c, unit: "mol/L", sig: 2, steps: [`${half * k} 分は半減期 ${k} 回分`, `${nf(c0)} × (1/2)^${k} = ${nf(c)} mol/L`] };
  });
  /* ===== u15 化学平衡と電離平衡 ===== */
  T("ksp-precipitation", "u15", 3, 2, 110, (rng) => {
    const [salt, Ksp] = pick(rng, [["AgCl", 1.8e-10]]), c = pick(rng, [0.010, 0.0010, 0.10]);
    const Ag = Ksp / c;
    return { text: `${nf(c, 3)} mol/L の塩化物イオン [[Cl^-]] を含む水溶液に、銀イオン [[Ag^+]] を加えていく。[[AgCl]] の沈殿が生じ始めるときの [[Ag^+]] の濃度は何 mol/L か。溶解度積 [[Ksp]] = [[Ag^+]][[Cl^-]] = 1.8×10^−10 (mol/L)²。`, ans: Ag, unit: "mol/L", sig: 2, tol: { rel: 0.03 }, steps: [`沈殿が生じ始める条件は [[Ag^+]][[Cl^-]] = Ksp`, `[[Ag^+]] = 1.8×10^−10 ÷ ${nf(c)} = ${show(Ag, 2)} mol/L`] };
  });
  T("buffer-ph", "u15", 3, 3, 120, (rng) => {
    const [ca, cs, Ka] = pick(rng, [[0.10, 0.10, 2.0e-5], [0.20, 0.10, 2.0e-5], [0.10, 0.20, 2.0e-5], [0.10, 0.10, 1.0e-5]]);
    const H = Ka * ca / cs, pH = -Math.log10(H);
    return { text: `${nf(ca, 2)} mol/L の酢酸と ${nf(cs, 2)} mol/L の酢酸ナトリウムを同体積ずつ混ぜた緩衝液の pH を求めよ。酢酸の電離定数 [[Ka]] = ${show(Ka, 2)} mol/L、log10 2 = 0.30 とする。`, ans: Math.round(pH * 100) / 100, unit: "", sig: 3, tol: { abs: 0.06 }, steps: [`混合すると濃度はどちらも半分になるが、比は変わらない`, `[[H^+]] = Ka × [酢酸]/[酢酸イオン] = ${show(Ka, 2)} × ${nf(ca)}/${nf(cs)} = ${show(H, 2)} mol/L`, `pH = ${nf(Math.round(pH * 100) / 100)}`] };
  });

  /* ===== u22 構造決定・u20 u21 有機・u23 u24 高分子 ===== */
  T("polymer-degree", "u24", 2, 1, 90, (rng) => {
    const [name, unit, Mu] = pick(rng, [["ポリエチレン", "[[-CH2-CH2-]]", 28], ["ポリ塩化ビニル", "[[-CH2-CHCl-]]", 62.5], ["ポリスチレン", "[[-CH2-CH(C6H5)-]]", 104], ["ナイロン66", "[[-CO(CH2)4CO-NH(CH2)6NH-]]", 226], ["ポリ酢酸ビニル", "[[-CH2-CH(OCOCH3)-]]", 86]]);
    const n = pick(rng, [1000, 2000, 500, 800, 5000]);
    return { text: `${name}の繰り返し単位 ${unit} の式量は ${nf(Mu)} である。平均分子量が ${show(n * Mu, 3)} の${name}の平均重合度はいくつか。`, ans: n, unit: "", sig: 2, tol: { rel: 0.02 }, steps: [`重合度 n = 平均分子量 ÷ 繰り返し単位の式量`, `= ${show(n * Mu, 3)} ÷ ${nf(Mu)} = ${nf(n)}`] };
  });
  T("amino-acid-mass", "u23", 2, 1, 90, (rng) => {
    const [name, M] = pick(rng, [["グリシン [[H2N-CH2-COOH]]", 75], ["アラニン [[H2N-CH(CH3)-COOH]]", 89]]);
    const n = pick(rng, [2, 3, 4]), peptM = n * M - (n - 1) * 18;
    return { text: `${name}（分子量 ${M}）が ${n} 分子脱水縮合してできた鎖状のペプチドの分子量はいくつか。水の分子量は 18 とする。`, ans: peptM, unit: "", sig: 3, tol: { rel: 0.01 }, steps: [`${n} 分子のアミノ酸から、ペプチド結合が ${n - 1} 個でき、水が ${n - 1} 分子とれる`, `${n} × ${M} − ${n - 1} × 18 = ${peptM}`] };
  });
  T("ester-yield", "u20", 3, 2, 120, (rng) => {
    const [alc, Ma, acid, Mb, ester, Me] = pick(rng, [["エタノール", 46, "酢酸", 60, "酢酸エチル", 88], ["メタノール", 32, "酢酸", 60, "酢酸メチル", 74], ["エタノール", 46, "プロピオン酸", 74, "プロピオン酸エチル", 102]]);
    const na = pick(rng, [0.50, 1.0, 2.0]), nb = pick(rng, [0.50, 1.0, 1.5]), lim = Math.min(na, nb), yld = pick(rng, [0.50, 0.70, 0.80, 0.60]);
    return { text: `${alc}（分子量 ${Ma}）${nf(na * Ma, 1)} g と${acid}（分子量 ${Mb}）${nf(nb * Mb, 1)} g から${ester}（分子量 ${Me}）をつくる。反応の収率が ${Math.round(yld * 100)} % のとき、得られるエステルは何 g か。`, ans: lim * yld * Me, unit: "g", sig: 3, steps: [`物質量: ${alc} ${nf(na)} mol、${acid} ${nf(nb)} mol（1 : 1 で反応）`, `少ないほうの ${nf(lim)} mol が上限`, `${nf(lim)} × ${yld} × ${Me} = ${nf(lim * yld * Me)} g`] };
  });
  T("benzene-nitration", "u21", 3, 2, 110, (rng) => {
    const g = pick(rng, [39, 78, 15.6, 7.8]), y = pick(rng, [1.0, 0.80, 0.50]);
    return { text: `ベンゼン [[C6H6]]（分子量 78）${nf(g, 1)} g を完全にニトロ化してニトロベンゼン [[C6H5NO2]]（分子量 123）にした。収率が ${Math.round(y * 100)} % のとき、得られるニトロベンゼンは何 g か。`, ans: g / 78 * y * 123, unit: "g", sig: 3, steps: [`ベンゼン ${nf(g, 1)} ÷ 78 = ${nf(g / 78)} mol`, `1 : 1 で反応するので理論収量は ${nf(g / 78)} mol`, `${nf(g / 78)} × ${y} × 123 = ${nf(g / 78 * y * 123)} g`] };
  });
  T("sulfuric-acid-industry", "u19", 3, 2, 120, (rng) => {
    const g = pick(rng, [32, 64, 16, 8.0]), M = 98;
    const ans = g / 32 * M;
    return { text: `接触法で、硫黄 S ${nf(g, 1)} g がすべて硫酸 [[H2SO4]] に変わるとすると、何 g の硫酸が得られるか。（原子量: H=1.0, O=16, S=32）\n[[S → SO2 → SO3 → H2SO4]]`, ans, unit: "g", sig: 3, steps: [`硫黄原子 1 個から硫酸 1 分子ができる`, `${nf(g, 1)} ÷ 32 = ${nf(g / 32)} mol → 硫酸も ${nf(g / 32)} mol`, `${nf(g / 32)} × 98 = ${nf(ans)} g`] };
  });
  T("ammonia-hydrogen", "u19", 3, 2, 120, (rng) => {
    const V = pick(rng, [33.6, 67.2, 22.4, 44.8]);
    const ans = V / 22.4 * 3 / 2 * 22.4;
    return { text: `ハーバー・ボッシュ法で、標準状態で ${nf(V, 1)} L のアンモニアを得るには、標準状態で何 L の水素が必要か。\n[[N2 + 3H2 → 2NH3]]`, ans, unit: "L", sig: 3, steps: [`係数比より [[H2]] : [[NH3]] = 3 : 2`, `体積比も同じなので ${nf(V, 1)} × 3/2 = ${nf(ans)} L`] };
  });

  /* ===== 大学入試だけの、複数の段階をふむ問題 ===== */
  T("xo-avogadro", "u11", 3, 3, 150, (rng) => {
    const [name, Z, M, a, d] = pick(rng, [["銀（面心立方格子）", 4, 108, 4.1, 10.5], ["アルミニウム（面心立方格子）", 4, 27, 4.0, 2.7], ["ナトリウム（体心立方格子）", 2, 23, 4.3, 0.97]]);
    const v = (a * 1e-8) ** 3, Na = Z * M / (d * v);
    return { text: `${name}の単位格子の一辺は ${nf(a, 1)}×10^−8 cm、密度は ${nf(d, 2)} g/cm³、原子量は ${M} である。単位格子にふくまれる原子の数を ${Z} として、アボガドロ定数を求めよ。（答えは 6.0×10^23 のように入力）`, ans: Na, unit: "/mol", sig: 2, tol: { rel: 0.05 }, steps: [`単位格子の体積: (${nf(a)}×10^−8)³ = ${show(v, 3)} cm³`, `単位格子の質量 = 密度 × 体積 = ${nf(d)} × ${show(v, 3)} = ${show(d * v, 3)} g`, `原子 ${Z} 個の質量が ${show(d * v, 3)} g なので、原子 1 mol の質量 ${M} g より N = ${Z} × ${M} ÷ ${show(d * v, 3)} = ${show(Na, 2)} /mol`] };
  }, { xo: true });
  T("xo-cell-electrolysis", "u13", 3, 3, 160, (rng) => {
    const I = pick(rng, [0.50, 1.0, 2.0]), t = pick(rng, [1930, 3860, 965]);
    const q = I * t, ne = q / F_CONST, mCu = ne / 2 * 64, mAg = ne * 108;
    return { text: `硫酸銅(II)水溶液と硝酸銀水溶液を満たした電解槽を直列につなぎ、${nf(I, 2)} A の電流を ${t} 秒間流した（電極は白金）。硝酸銀水溶液側の陰極に析出した銀と、硫酸銅(II)水溶液側の陰極に析出した銅の質量の差（銀 − 銅）は何 g か。原子量 Cu=64、Ag=108、ファラデー定数 9.65×10^4 C/mol。`, ans: mAg - mCu, unit: "g", sig: 3, steps: [`直列なので、どちらにも同じ電気量が流れる: ${nf(I)} × ${t} = ${nf(q)} C → 電子 ${nf(ne)} mol`, `銀: ${nf(ne)} × 108 = ${nf(mAg)} g（電子 1 個につき Ag 1 個）`, `銅: ${nf(ne)} ÷ 2 × 64 = ${nf(mCu)} g（電子 2 個につき Cu 1 個）`, `差: ${nf(mAg)} − ${nf(mCu)} = ${nf(mAg - mCu)} g`] };
  }, { xo: true });
  /* ===== （書きなおし）正解が一意で、数が整うように設計した問題 ===== */
  T("rxn-limiting", "u05", 3, 2, 100, (rng) => {
    const nA = pick(rng, [1.0, 2.0, 3.0, 0.60]), nB = pick(rng, [0.30, 0.50, 1.0, 2.0].filter((x) => x !== nA / 2));
    const over = nB > nA / 2;                                   // 酸素が余るか
    const left = over ? nB - nA / 2 : nA - 2 * nB;
    return { text: `水素 ${nf(nA, 2)} mol と酸素 ${nf(nB, 2)} mol を反応させ、水を生成させた。\n[[2H2 + O2 → 2H2O]]\n反応後に残る気体（水は液体として除く）の物質量は何 mol か。`, ans: left, unit: "mol", sig: 2, steps: [`水素 ${nf(nA)} mol と過不足なく反応する酸素は ${nf(nA / 2)} mol`, over ? `酸素は ${nf(nB)} mol あるので、水素がすべて反応し、酸素が ${nf(nB)} − ${nf(nA / 2)} = ${nf(left)} mol 残る` : `酸素 ${nf(nB)} mol と反応する水素は ${nf(2 * nB)} mol なので、酸素がすべて反応し、水素が ${nf(nA)} − ${nf(2 * nB)} = ${nf(left)} mol 残る`] };
  });
  T("ph-strong-acid", "u06", 1, 0, 50, (rng) => {
    const [name, f, k] = pick(rng, [["塩酸", "HCl", 1], ["硫酸", "H2SO4", 2], ["硝酸", "HNO3", 1]]), c = pick(rng, [0.10, 0.010, 0.0010, 0.050, 0.0050]);
    const H = c * k, pH = -Math.log10(H);
    return { text: `${nf(c)} mol/L の${name}（[[${f}]]）の pH を求めよ。完全に電離するものとし、log10 2 = 0.30 とする。（25℃）`, ans: Math.round(pH * 100) / 100, unit: "", sig: 2, tol: { abs: 0.06 }, steps: [`[[H^+]] = ${nf(c)} × ${k} = ${nf(H)} mol/L`, `pH = −log10 ${nf(H)} = ${nf(Math.round(pH * 100) / 100)}`] };
  });
  T("hess-law", "u09", 2, 1, 90, (rng) => {
    const V = pick(rng, [
      { ask: "[[C(黒鉛) + 1/2O2 → CO]]", given: ["[[C(黒鉛) + O2 → CO2]]　ΔH = −394 kJ", "[[CO + 1/2O2 → CO2]]　ΔH = −283 kJ"], ans: -394 + 283, how: "(第1式) − (第2式) = (−394) − (−283)" },
      { ask: "[[H2O(液) → H2O(気)]]", given: ["[[H2 + 1/2O2 → H2O(液)]]　ΔH = −286 kJ", "[[H2 + 1/2O2 → H2O(気)]]　ΔH = −242 kJ"], ans: -242 + 286, how: "(第2式) − (第1式) = (−242) − (−286)" },
      { ask: "[[C(黒鉛) + 2H2 → CH4]]", given: ["[[C(黒鉛) + O2 → CO2]]　ΔH = −394 kJ", "[[H2 + 1/2O2 → H2O(液)]]　ΔH = −286 kJ", "[[CH4 + 2O2 → CO2 + 2H2O(液)]]　ΔH = −891 kJ"], ans: -394 + 2 * -286 + 891, how: "(第1式) + 2×(第2式) − (第3式) = (−394) + 2×(−286) − (−891)" }
    ]);
    return { text: `次の熱化学方程式から、${V.ask} の反応熱 ΔH (kJ) を求めよ。（符号をつけて入力。発熱なら負の値）\n${V.given.join("\n")}`, ans: V.ans, unit: "kJ", sig: 3, tol: { abs: 0.6 }, steps: ["ヘスの法則（反応熱は、はじめと終わりの状態だけで決まる）で式を組み合わせる", `${V.how} = ${V.ans} kJ`] };
  });
  T("faraday-mass", "u13", 2, 1, 90, (rng) => {
    const [name, ion, f, nE, M] = pick(rng, [["銅", "Cu^2+", "Cu", 2, 64], ["銀", "Ag^+", "Ag", 1, 108], ["ニッケル", "Ni^2+", "Ni", 2, 59]]);
    const I = pick(rng, [1.0, 2.0, 0.50, 5.0, 10.0]), t = pick(rng, [965, 1930, 3860, 9650]);
    const q = I * t, n = q / F_CONST / nE, g = n * M;
    return { text: `${name}(イオン [[${ion}]])を含む水溶液を、${nf(I, 2)} A の電流で ${t} 秒間電気分解した。陰極に析出する ${name}（[[${f}]]）は何 g か。ファラデー定数 9.65×10^4 C/mol、原子量 ${f}=${M}。`, ans: g, unit: "g", sig: 3, steps: [`電気量: ${nf(I)} × ${t} = ${nf(q)} C`, `電子の物質量: ${nf(q)} ÷ 9.65×10^4 = ${nf(q / F_CONST)} mol`, `${name}の析出量: ${nf(q / F_CONST)} ÷ ${nE} × ${M} = ${nf(g)} g`] };
  });
  T("lattice-density", "u11", 3, 2, 120, (rng) => {
    const [name, Z, M, a] = pick(rng, [["アルミニウム（面心立方格子）", 4, 27, 4.0], ["銅（面心立方格子）", 4, 64, 3.6], ["鉄（体心立方格子）", 2, 56, 2.9]]);
    const v = (a * 1e-8) ** 3, d = Z * M / (NA * v);
    return { text: `${name}の単位格子の一辺は ${nf(a, 1)}×10^−8 cm である。単位格子にふくまれる原子の数は ${Z}、原子量は ${M}、アボガドロ定数は 6.0×10^23/mol として、密度は何 g/cm³ か。`, ans: d, unit: "g/cm³", sig: 2, tol: { rel: 0.03 }, steps: [`単位格子の体積: (${nf(a)}×10^−8)³ = ${show(v, 3)} cm³`, `単位格子の質量: ${Z} × ${M} ÷ 6.0×10^23 = ${show(Z * M / NA, 3)} g`, `密度 = 質量 ÷ 体積 = ${nf(d)} g/cm³`] };
  });
  T("lattice-count", "u11", 2, 1, 60, (rng) => {
    const [name, Z, how] = pick(rng, [["面心立方格子", 4, "頂点 1/8×8 + 面の中心 1/2×6 = 1 + 3 = 4"], ["体心立方格子", 2, "頂点 1/8×8 + 中心 1 = 2"], ["単純立方格子", 1, "頂点 1/8×8 = 1"]]);
    return { text: `${name}の単位格子にふくまれる原子の数はいくつか。`, ans: Z, unit: "個", sig: 1, tol: { abs: 0.01 }, steps: [how] };
  });
  T("solubility-crystals", "u10", 3, 2, 110, (rng) => {
    const [S1, S2] = pick(rng, [[100, 40], [60, 30], [80, 20], [50, 25], [120, 70]]), k = pick(rng, [1, 2, 3, 4]);
    const mass1 = (100 + S1) * k;                              // 高温の飽和溶液の質量(整数倍にして、答えが整う)
    const crystals = k * (S1 - S2);
    return { text: `ある物質（水和物をつくらない）の溶解度は、高温で ${S1} g/100 g 水、低温で ${S2} g/100 g 水である。高温の飽和水溶液 ${mass1} g を低温に冷やすと、何 g の結晶が析出するか。`, ans: crystals, unit: "g", sig: 3, steps: [`高温の飽和溶液 ${100 + S1} g には溶質 ${S1} g がふくまれる（水 100 g）`, `冷やすと、水 100 g あたり ${S1 - S2} g の結晶が出る。溶液 ${100 + S1} g あたり ${S1 - S2} g`, `${mass1} g では ${mass1} × ${S1 - S2}/${100 + S1} = ${crystals} g`] };
  });
  T("freezing-point", "u10", 3, 2, 110, (rng) => {
    const [f, M, i, name] = pick(rng, [["C6H12O6", 180, 1, "グルコース"], ["C12H22O11", 342, 1, "スクロース"], ["NaCl", 58.5, 2, "塩化ナトリウム"], ["CaCl2", 111, 3, "塩化カルシウム"]]);
    const W = pick(rng, [100, 200, 500]), m = pick(rng, [0.050, 0.10, 0.20]), w = m * (W / 1000) * M, dT = 1.85 * m * i;
    return { text: `水 ${W} g に ${name}（[[${f}]]、式量 ${nf(M)}）${nf(sig(w, 3))} g を溶かした水溶液の凝固点降下度は何 K か。水のモル凝固点降下は 1.85 K·kg/mol とし、電解質は完全に電離するものとする。`, ans: dT, unit: "K", sig: 2, steps: [`質量モル濃度: ${nf(sig(w, 3))} ÷ ${nf(M)} ÷ ${nf(W / 1000)} = ${nf(m)} mol/kg`, `溶けている粒子の数が ${i} 倍になる（i = ${i}）`, `Δt = 1.85 × ${nf(m)} × ${i} = ${nf(dT)} K`] };
  });
  T("weak-acid-ph", "u06", 3, 2, 100, (rng) => {
    const [c, Ka] = pick(rng, [[0.10, 1.0e-5], [0.10, 4.0e-5], [0.050, 2.0e-5], [0.20, 2.0e-5], [0.025, 4.0e-5]]);
    const H = Math.sqrt(c * Ka), pH = -Math.log10(H);
    return { text: `${nf(c)} mol/L の酢酸水溶液の pH を求めよ。酢酸の電離定数を [[Ka]] = ${show(Ka, 2)} mol/L とし、電離度は 1 に比べて十分小さいとする。log10 2 = 0.30 とする。`, ans: Math.round(pH * 100) / 100, unit: "", sig: 2, tol: { abs: 0.06 }, steps: [`[[H^+]] = √(c·Ka) = √(${nf(c)} × ${show(Ka, 2)}) = ${nf(H)} mol/L`, `pH = −log10 [[H^+]] = ${nf(Math.round(pH * 100) / 100)}`] };
  });
  T("rate-law-order", "u14", 3, 2, 100, (rng) => {
    const x = pick(rng, [1, 2]), y = pick(rng, [1, 2]), kk = pick(rng, [2.0, 0.50, 1.0]), A = pick(rng, [0.10, 0.20, 0.050]), B = pick(rng, [0.10, 0.20, 0.30]);
    const v = kk * A ** x * B ** y, m = x + y - 1, kunit = `L${m > 1 ? "^" + m : ""}/(mol${m > 1 ? "^" + m : ""}·s)`;
    const sup = (n) => (n === 2 ? "²" : "");
    return { text: `反応 A + B → 生成物 の反応速度 v は v = k[A]${sup(x)}[B]${sup(y)} で表される。k = ${nf(kk, 1)} ${kunit}、[A] = ${nf(A, 2)} mol/L、[B] = ${nf(B, 2)} mol/L のとき、v は何 mol/(L·s) か。`, ans: v, unit: "mol/(L·s)", sig: 2, steps: [`v = ${nf(kk)} × ${nf(A)}${sup(x)} × ${nf(B)}${sup(y)} = ${nf(v)} mol/(L·s)`] };
  });
  T("equilibrium-constant", "u15", 3, 2, 120, (rng) => {
    const a = pick(rng, [1.0, 2.0, 1.5]), b = pick(rng, [1.0, 2.0, 1.5]), x = pick(rng, [0.20, 0.40, 0.50, 0.25].filter((v) => v < Math.min(a, b))), V = pick(rng, [1.0, 2.0, 5.0]);
    const A = (a - x) / V, B = (b - x) / V, C = 2 * x / V, K = C * C / (A * B);
    return { text: `容積 ${nf(V, 1)} L の容器に A を ${nf(a, 1)} mol、B を ${nf(b, 1)} mol 入れて一定温度に保つと、次の平衡に達して C が ${nf(2 * x, 2)} mol 生じた。この温度での平衡定数 K を求めよ。\n[[A + B ⇌ 2C]]`, ans: K, unit: "", sig: 2, tol: { rel: 0.03 }, steps: [`平衡時の物質量: A = ${nf(a - x, 2)} mol、B = ${nf(b - x, 2)} mol、C = ${nf(2 * x, 2)} mol`, `濃度: [A] = ${nf(A)}、[B] = ${nf(B)}、[C] = ${nf(C)} mol/L`, `K = [C]²/([A][B]) = ${nf(K)}`] };
  });
  T("elemental-analysis", "u22", 3, 2, 120, (rng) => {
    const [nC, nH, nO] = pick(rng, [[2, 6, 1], [3, 6, 1], [2, 4, 2], [4, 10, 1], [3, 8, 1], [6, 6, 0], [2, 6, 2]]);
    const M = 12 * nC + nH + 16 * nO, n = pick(rng, [0.010, 0.020, 0.0050]), sample = n * M, co2 = n * nC * 44, h2o = n * nH / 2 * 18;
    const askC = rng() < 0.5, nOs = nO ? "・酸素" : "";
    return { text: `炭素・水素${nOs}からなる有機化合物 ${nf(sig(sample, 3))} g を完全燃焼させると、二酸化炭素 ${nf(sig(co2, 3))} g と水 ${nf(sig(h2o, 3))} g が生じた。この化合物の分子量は ${nf(M)} である。分子 1 個にふくまれる${askC ? "炭素" : "水素"}原子の数はいくつか。（原子量: H=1.0, C=12, O=16）`, ans: askC ? nC : nH, unit: "個", sig: 1, tol: { abs: 0.01 }, steps: [`化合物の物質量: ${nf(sig(sample, 3))} ÷ ${nf(M)} = ${nf(n)} mol`, askC ? `炭素原子の物質量 = [[CO2]] の物質量: ${nf(sig(co2, 3))} ÷ 44 = ${nf(co2 / 44)} mol` : `水素原子の物質量 = [[H2O]] の物質量 × 2: ${nf(sig(h2o, 3))} ÷ 18 × 2 = ${nf(h2o / 18 * 2)} mol`, `1 分子あたり ${askC ? nf(co2 / 44) : nf(h2o / 9)} ÷ ${nf(n)} = ${askC ? nC : nH} 個`] };
  });
  T("saponification", "u23", 3, 2, 120, (rng) => {
    const Mfat = pick(rng, [884, 890, 806, 860]), g = pick(rng, [0.01, 0.02, 0.005]) * Mfat;
    const ans = 3 * (g / Mfat) * 56.0;
    return { text: `分子量 ${Mfat} の油脂（トリグリセリド）${nf(sig(g, 3))} g を完全にけん化するのに必要な水酸化カリウム（式量 56.0）は何 g か。`, ans, unit: "g", sig: 3, steps: [`油脂 1 mol のけん化に KOH は 3 mol 必要`, `油脂の物質量: ${nf(sig(g, 3))} ÷ ${Mfat} = ${nf(g / Mfat)} mol`, `KOH: ${nf(g / Mfat)} × 3 × 56.0 = ${nf(ans)} g`] };
  });
  T("starch-glucose", "u23", 2, 1, 90, (rng) => {
    const g = pick(rng, [16.2, 32.4, 81.0, 8.1]);
    return { text: `デンプン [[(C6H10O5)n]] ${nf(g, 1)} g を完全に加水分解すると、グルコース [[C6H12O6]] は何 g 得られるか。（原子量: H=1.0, C=12, O=16）`, ans: g / 162 * 180, unit: "g", sig: 3, steps: [`繰り返し単位 [[C6H10O5]] の式量は 162、グルコース [[C6H12O6]] は 180`, `[[(C6H10O5)n + nH2O → nC6H12O6]]`, `${nf(g, 1)} × 180/162 = ${nf(g / 162 * 180)} g`] };
  });
  T("xo-titration-two-step", "u06", 3, 3, 150, (rng) => {
    const cA = pick(rng, [0.10, 0.20, 0.050]), VA = pick(rng, [10, 20, 25]), VB = pick(rng, [20, 25, 40]), Vd = pick(rng, [12.0, 15.0, 9.0, 8.0]);
    const cNaOH = 2 * cA * VA / VB, dil = cNaOH * Vd / 10, orig = 10 * dil;
    return { text: `【標定と滴定】\n(1) ${nf(cA, 2)} mol/L のシュウ酸水溶液（[[(COOH)2]]、2 価の酸）${VA} mL を中和するのに、濃度未知の水酸化ナトリウム水溶液が ${VB} mL 必要だった。\n(2) この水酸化ナトリウム水溶液で、食酢を 10 倍に薄めた液 10 mL を滴定したところ、${nf(Vd, 1)} mL で中和した。\n薄める前の食酢にふくまれる酢酸のモル濃度は何 mol/L か。`, ans: orig, unit: "mol/L", sig: 3, steps: [`(1) シュウ酸は 2 価: 2 × ${nf(cA)} × ${VA} = 1 × c × ${VB} → c = ${nf(cNaOH)} mol/L`, `(2) 酢酸は 1 価: 薄めた液の濃度 = ${nf(cNaOH)} × ${nf(Vd, 1)} ÷ 10 = ${nf(dil)} mol/L`, `10 倍に薄めているので ${nf(orig)} mol/L`] };
  }, { xo: true });
  T("xo-kp", "u15", 3, 3, 150, (rng) => {
    const a = pick(rng, [0.20, 0.50, 0.40, 0.25]), P = pick(rng, [1.0, 2.0, 4.0]), Kp = 4 * a * a * P / (1 - a * a);
    return { text: `四酸化二窒素が、一定温度・全圧 ${nf(P, 1)}×10^5 Pa で、解離度 ${nf(a, 2)} の平衡状態にある。\n[[N2O4 ⇌ 2NO2]]\nこの温度での圧平衡定数 [[Kp]] は何×10^5 Pa か。`, ans: Kp, unit: "×10^5 Pa", sig: 2, tol: { rel: 0.03 }, steps: [`はじめの [[N2O4]] を 1 mol とすると、平衡時: [[N2O4]] = ${nf(1 - a, 2)} mol、[[NO2]] = ${nf(2 * a, 2)} mol、合計 ${nf(1 + a, 2)} mol`, `分圧: [[N2O4]] = ${nf((1 - a) / (1 + a) * P)}、[[NO2]] = ${nf(2 * a / (1 + a) * P)}（×10^5 Pa）`, `Kp = p(NO2)²/p(N2O4) = ${nf(Kp)} ×10^5 Pa`] };
  }, { xo: true });
  T("xo-freezing-association", "u10", 3, 3, 150, (rng) => {
    const w = pick(rng, [1.22, 2.44]), W = pick(rng, [100, 200]), M = 122, a = pick(rng, [0.50, 0.40, 1.0, 0.60]);
    const m0 = (w / M) / (W / 1000), dT = 5.1 * m0 * (1 - a / 2);
    return { text: `安息香酸（分子量 ${M}）${nf(w, 2)} g をベンゼン ${W} g に溶かした。安息香酸は、ベンゼン中で、分子の ${Math.round(a * 100)} % が二量体になっているとする。この溶液の凝固点降下度は何 K か。ベンゼンのモル凝固点降下は 5.1 K·kg/mol とする。`, ans: dT, unit: "K", sig: 2, tol: { rel: 0.03 }, steps: [`二量体をつくらないとした質量モル濃度: ${nf(w, 2)} ÷ ${M} ÷ ${nf(W / 1000)} = ${nf(m0)} mol/kg`, `2 分子が 1 分子の二量体になるので、粒子数は (1 − ${nf(a / 2)}) 倍`, `Δt = 5.1 × ${nf(m0)} × (1 − ${nf(a / 2)}) = ${nf(dT)} K`] };
  }, { xo: true });

  /* ===== 第2群: 単元ごとの問題をふやす ===== */
  /* ---- u01・u02・u03 化学基礎の前半 ---- */
  T("element-mass-percent", "u01", 1, 0, 60, (rng) => {
    const [f, el, els] = pick(rng, [["H2O", "H", ["H", "O"]], ["CO2", "C", ["C", "O"]], ["NH3", "N", ["N", "H"]], ["Fe2O3", "Fe", ["Fe", "O"]], ["CaCO3", "Ca", ["Ca", "C", "O"]], ["NaCl", "Na", ["Na", "Cl"]], ["CH4", "C", ["C", "H"]], ["MgO", "Mg", ["Mg", "O"]], ["Al2O3", "Al", ["Al", "O"]]]);
    const M = mass(f), cnt = Number((new RegExp(el + "(\\d*)(?![a-z])").exec(f) || [0, ""])[1] || 1), pct = cnt * AM[el] / M * 100;
    return { text: `[[${f}]] にふくまれる ${el} の質量パーセントは何 % か。（${AMNOTE(...els)}）`, ans: pct, unit: "%", sig: 3, steps: [`式量: [[${f}]] = ${nf(M)}`, `${el} の質量: ${cnt} × ${AM[el]} = ${nf(cnt * AM[el])}`, `${nf(cnt * AM[el])} ÷ ${nf(M)} × 100 = ${nf(pct)} %`] };
  });
  T("mixture-composition", "u01", 2, 1, 70, (rng) => {
    const dA = pick(rng, [0.80, 1.0, 0.90]), dB = pick(rng, [2.0, 2.5, 3.0]), vA = pick(rng, [10, 20, 25]), vB = pick(rng, [10, 20, 5]);
    const mA = dA * vA, mB = dB * vB;
    return { text: `密度 ${nf(dA, 2)} g/cm³ の液体 A ${vA} cm³ と、密度 ${nf(dB, 2)} g/cm³ の液体 B ${vB} cm³ を混ぜた。混合物の質量パーセント濃度で、液体 A は何 % か。（体積の変化は考えない）`, ans: mA / (mA + mB) * 100, unit: "%", sig: 3, steps: [`A の質量: ${nf(dA)} × ${vA} = ${nf(mA)} g、B の質量: ${nf(dB)} × ${vB} = ${nf(mB)} g`, `${nf(mA)} ÷ (${nf(mA)} + ${nf(mB)}) × 100 = ${nf(mA / (mA + mB) * 100)} %`] };
  });
  T("average-atomic-mass", "u02", 2, 1, 80, (rng) => {
    const [name, m1, m2, a1] = pick(rng, [["塩素", 35, 37, 75], ["塩素", 35, 37, 76], ["ホウ素", 10, 11, 20], ["銅", 63, 65, 70], ["臭素", 79, 81, 50], ["リチウム", 6, 7, 8]]);
    const avg = (m1 * a1 + m2 * (100 - a1)) / 100;
    return { text: `${name}には質量数 ${m1} の同位体と質量数 ${m2} の同位体があり、存在比はそれぞれ ${a1} %、${100 - a1} % である。${name}の原子量を、有効数字 3 桁で求めよ。（各同位体の相対質量は質量数に等しいとする）`, ans: avg, unit: "", sig: 3, steps: [`原子量 = Σ(相対質量 × 存在比)`, `= ${m1} × ${a1}/100 + ${m2} × ${100 - a1}/100 = ${nf(avg)}`] };
  });
  T("neutron-count", "u02", 1, 0, 50, (rng) => {
    const [name, Z, A] = pick(rng, [["炭素 [[C]]", 6, 12], ["炭素 [[C]]", 6, 14], ["酸素 [[O]]", 8, 16], ["ナトリウム [[Na]]", 11, 23], ["塩素 [[Cl]]", 17, 35], ["塩素 [[Cl]]", 17, 37], ["カルシウム [[Ca]]", 20, 40], ["鉄 [[Fe]]", 26, 56], ["ウラン U", 92, 238]]);
    return { text: `${name}（原子番号 ${Z}）で、質量数が ${A} の原子の中性子の数はいくつか。`, ans: A - Z, unit: "個", sig: 3, tol: { abs: 0.01 }, steps: [`質量数 = 陽子の数 + 中性子の数 なので、中性子 = ${A} − ${Z} = ${A - Z}`] };
  });
  T("ion-electrons", "u02", 1, 1, 55, (rng) => {
    const [ion, Z, ch] = pick(rng, [["Na^+", 11, 1], ["Mg^2+", 12, 2], ["Cl^-", 17, -1], ["O^2-", 8, -2], ["Al^3+", 13, 3], ["Ca^2+", 20, 2], ["S^2-", 16, -2], ["F^-", 9, -1], ["K^+", 19, 1]]);
    return { text: `[[${ion}]]（原子番号 ${Z}）がもつ電子の数はいくつか。`, ans: Z - ch, unit: "個", sig: 2, tol: { abs: 0.01 }, steps: [`中性の原子は電子を ${Z} 個もつ`, ch > 0 ? `${ch} 個の電子を失うので ${Z} − ${ch} = ${Z - ch}` : `${-ch} 個の電子を受けとるので ${Z} + ${-ch} = ${Z - ch}`] };
  });
  T("radioactive-decay", "u02", 3, 2, 90, (rng) => {
    const T12 = pick(rng, [5700, 8.0, 12.0, 30.0]), k = pick(rng, [1, 2, 3, 4]), N0 = pick(rng, [64, 80, 160, 32.0]);
    const unit = T12 === 5700 ? "年" : T12 === 8 ? "日" : "年";
    return { text: `ある放射性同位体の半減期は ${nf(T12)} ${unit} である。はじめ ${nf(N0)} mg あった同位体は、${nf(T12 * k)} ${unit}後に何 mg 残っているか。`, ans: N0 / 2 ** k, unit: "mg", sig: 3, steps: [`${nf(T12 * k)} ${unit}は半減期 ${k} 回分`, `${nf(N0)} × (1/2)^${k} = ${nf(N0 / 2 ** k)} mg`] };
  });
  T("electron-pairs", "u03", 2, 1, 60, (rng) => {
    const [f, bond, lone] = pick(rng, [["H2O", 2, 2], ["NH3", 3, 1], ["CH4", 4, 0], ["CO2", 4, 4], ["N2", 3, 2], ["O2", 2, 4], ["HCl", 1, 3], ["C2H4", 6, 0], ["H2S", 2, 2], ["HCN", 4, 1]]);
    const askBond = rng() < 0.5;
    return { text: `[[${f}]] 分子 1 個にふくまれる、${askBond ? "共有電子対" : "非共有電子対（孤立電子対）"}の数はいくつか。（二重結合・三重結合は、共有電子対を 2 組・3 組と数える）`, ans: askBond ? bond : lone, unit: "組", sig: 2, tol: { abs: 0.01 }, steps: [askBond ? `電子式から、原子間で共有されている電子対を数える → ${bond} 組` : `電子式から、結合に使われていない電子対（原子上の対）を数える → ${lone} 組`] };
  });
  T("valence-electron-total", "u03", 2, 1, 60, (rng) => {
    const [f, n] = pick(rng, [["H2O", 8], ["NH3", 8], ["CO2", 16], ["CH4", 8], ["HCl", 8], ["N2", 10], ["O2", 12], ["H2S", 8], ["SO2", 18], ["HCN", 10]]);
    return { text: `[[${f}]] 分子にふくまれる価電子の総数はいくつか。`, ans: n, unit: "個", sig: 2, tol: { abs: 0.01 }, steps: [`各原子の価電子（H:1、C:4、N:5、O:6、S:6、Cl:7）を足す → ${n}`] };
  });
  T("covalent-crystal-bonds", "u03", 3, 2, 70, (rng) => {
    const [name, per, unit] = pick(rng, [["ダイヤモンド", 2, "C 原子 1 個あたりの共有結合の数（C–C 結合の数）"], ["二酸化ケイ素 [[SiO2]]", 4, "Si 原子 1 個あたりの Si–O 結合の数"], ["黒鉛", 1.5, "C 原子 1 個あたりの C–C 結合の数（各原子は 3 つの原子と結合し、結合は 2 原子で共有される）"]]);
    return { text: `${name}の結晶で、${unit}はいくつか。`, ans: per, unit: "", sig: 2, tol: { abs: 0.01 }, steps: name.startsWith("ダイヤ") ? ["各 C 原子は 4 つの C 原子と結合し、結合は 2 原子で共有されるので 4 × 1/2 = 2"] : name.startsWith("二酸化") ? ["Si 原子は 4 つの O 原子と結合する → 4"] : ["各 C は 3 本の結合をもち、2 原子で共有されるので 3 × 1/2 = 1.5"] };
  });

  /* ---- u04・u05 物質量と反応 ---- */
  T("mixture-gas-molar", "u04", 2, 1, 80, (rng) => {
    const [fa, fb] = pick(rng, [["N2", "O2"], ["CO2", "O2"], ["CH4", "H2"]]), nA = pick(rng, [1.0, 2.0, 3.0]), nB = pick(rng, [1.0, 2.0, 0.50]);
    const Ma = mass(fa), Mb = mass(fb), avg = (nA * Ma + nB * Mb) / (nA + nB);
    return { text: `[[${fa}]] ${nf(nA, 1)} mol と [[${fb}]] ${nf(nB, 2)} mol の混合気体の平均分子量を求めよ。（${AMNOTE("H", "C", "N", "O")}）`, ans: avg, unit: "", sig: 3, steps: [`平均分子量 = (全質量) ÷ (全物質量)`, `= (${nf(nA)} × ${nf(Ma)} + ${nf(nB)} × ${nf(Mb)}) ÷ ${nf(nA + nB)} = ${nf(avg)}`] };
  });
  T("hydrate-water", "u04", 3, 2, 90, (rng) => {
    const [f, M, w, name] = pick(rng, [["CuSO4·5H2O", 250, 5, "硫酸銅(II)五水和物"], ["Na2CO3·10H2O", 286, 10, "炭酸ナトリウム十水和物"], ["CaSO4·2H2O", 172, 2, "硫酸カルシウム二水和物"]]);
    const g = pick(rng, [25.0, 50.0, 100.0]), anhydrous = g * (M - 18 * w) / M;
    return { text: `${name}（式量 ${M}）${nf(g, 1)} g を加熱して、結晶水をすべて失わせると、無水物は何 g になるか。（水の分子量 18）`, ans: anhydrous, unit: "g", sig: 3, steps: [`結晶水 ${w} 分子分: 18 × ${w} = ${18 * w}`, `無水物の式量: ${M} − ${18 * w} = ${M - 18 * w}`, `${nf(g, 1)} × ${M - 18 * w}/${M} = ${nf(anhydrous)} g`] };
  });
  T("rxn-precipitation", "u05", 2, 1, 90, (rng) => {
    const mNaCl = pick(rng, [5.85, 11.7, 2.925, 17.55]), n = mNaCl / 58.5;
    return { text: `塩化ナトリウム [[NaCl]] ${nf(mNaCl, 3)} g を水に溶かし、十分な量の硝酸銀水溶液を加えた。生じる塩化銀 [[AgCl]] の沈殿は何 g か。（式量 NaCl=58.5、AgCl=143.5）\n[[NaCl + AgNO3 → AgCl + NaNO3]]`, ans: n * 143.5, unit: "g", sig: 3, steps: [`[[NaCl]] の物質量: ${nf(mNaCl, 3)} ÷ 58.5 = ${nf(n)} mol`, `係数比 1 : 1 なので [[AgCl]] も ${nf(n)} mol`, `${nf(n)} × 143.5 = ${nf(n * 143.5)} g`] };
  });
  T("rxn-purity", "u05", 3, 2, 100, (rng) => {
    const purity = pick(rng, [80, 90, 75, 60]), g = pick(rng, [50, 100, 125, 200]);
    const caco3 = g * purity / 100, V = caco3 / 100 * 22.4;
    return { text: `純度 ${purity} % の石灰石（主成分 [[CaCO3]]、他の成分は反応しない）${g} g に十分な量の塩酸を加えた。発生する二酸化炭素は、標準状態で何 L か。（式量 CaCO3=100、モル体積 22.4 L/mol）\n[[CaCO3 + 2HCl → CaCl2 + H2O + CO2]]`, ans: V, unit: "L", sig: 3, steps: [`[[CaCO3]] の質量: ${g} × ${purity}/100 = ${nf(caco3)} g → ${nf(caco3 / 100)} mol`, `係数比 1 : 1 なので [[CO2]] も ${nf(caco3 / 100)} mol`, `体積: ${nf(caco3 / 100)} × 22.4 = ${nf(V)} L`] };
  });
  T("rxn-gas-combustion-volume", "u05", 3, 2, 100, (rng) => {
    const [name, f, nO2, nCO2] = pick(rng, [["メタン", "CH4", 2, 1], ["エタン", "C2H6", 3.5, 2], ["プロパン", "C3H8", 5, 3], ["エチレン", "C2H4", 3, 2], ["アセチレン", "C2H2", 2.5, 2]]);
    const V = pick(rng, [10, 20, 40, 50]);
    return { text: `同じ温度・圧力で、${name}（[[${f}]]）${V} mL を完全燃焼させるのに必要な酸素は何 mL か。`, ans: V * nO2, unit: "mL", sig: 3, steps: [`気体の体積比は物質量の比（アボガドロの法則）`, `[[${f}]] 1 mol の完全燃焼に [[O2]] ${nf(nO2)} mol 必要なので、${V} × ${nf(nO2)} = ${nf(V * nO2)} mL`] };
  });
  T("rxn-yield", "u05", 2, 1, 80, (rng) => {
    const g = pick(rng, [4.0, 8.0, 12.0, 20.0]), y = pick(rng, [50, 60, 80, 90]);
    return { text: `エタノール [[C2H5OH]]（分子量 46）から、エチレン [[C2H4]]（分子量 28）をつくる。エタノール ${nf(g, 1)} g を用いて、収率が ${y} % のとき、得られるエチレンは何 g か。\n[[C2H5OH → C2H4 + H2O]]`, ans: g / 46 * 28 * y / 100, unit: "g", sig: 3, steps: [`理論収量: ${nf(g, 1)} ÷ 46 × 28 = ${nf(g / 46 * 28)} g`, `収率 ${y} %: ${nf(g / 46 * 28)} × ${y}/100 = ${nf(g / 46 * 28 * y / 100)} g`] };
  });

  /* ---- u06 酸と塩基 ---- */
  T("neutralization-ph-excess", "u06", 3, 2, 120, (rng) => {
    let cA, VA, cB, VB, nH, nOH, excess;
    do {                                                     // 酸が余る組み合わせだけを使う
      cA = pick(rng, [0.20, 0.10]); VA = pick(rng, [50, 100]); cB = pick(rng, [0.10, 0.05]); VB = pick(rng, [50, 100]);
      nH = cA * VA / 1000; nOH = cB * VB / 1000; excess = nH - nOH;
    } while (excess <= 1e-9);
    const V = (VA + VB) / 1000, c = excess / V, pH = -Math.log10(c);
    return { text: `${nf(cA, 2)} mol/L の塩酸 ${VA} mL と ${nf(cB, 2)} mol/L の水酸化ナトリウム水溶液 ${VB} mL を混ぜた。混合後の水溶液の pH を求めよ。（混合による体積の変化は考えない。log10 2 = 0.30、log10 3 = 0.48）`, ans: Math.round(pH * 100) / 100, unit: "", sig: 3, tol: { abs: 0.06 }, steps: [`[[H^+]] の物質量: ${nf(cA)} × ${VA}/1000 = ${nf(nH)} mol、[[OH^-]]: ${nf(cB)} × ${VB}/1000 = ${nf(nOH)} mol`, `中和後に残る [[H^+]]: ${nf(excess)} mol、全体積 ${nf(V)} L`, `[[H^+]] = ${nf(c)} mol/L → pH = ${nf(Math.round(pH * 100) / 100)}`] };
  });
  T("salt-hydrolysis-ph", "u06", 3, 3, 130, (rng) => {
    const [c, Ka] = pick(rng, [[0.10, 1.0e-5], [0.10, 1.0e-5], [0.010, 1.0e-5], [0.40, 1.0e-5]]);
    const Kh = 1e-14 / Ka, OH = Math.sqrt(Kh * c), pH = 14 + Math.log10(OH);
    return { text: `${nf(c, 3)} mol/L の酢酸ナトリウム [[CH3COONa]] 水溶液の pH を求めよ。酢酸の電離定数 [[Ka]] = ${show(Ka, 2)} mol/L、水のイオン積 [[Kw]] = 1.0×10^−14 (mol/L)²、log10 2 = 0.30 とする。\n[[CH3COO^- + H2O ⇌ CH3COOH + OH^-]]`, ans: Math.round(pH * 100) / 100, unit: "", sig: 3, tol: { abs: 0.06 }, steps: [`加水分解定数 Kh = Kw/Ka = ${show(Kh, 2)} mol/L`, `[[OH^-]] = √(Kh × c) = √(${show(Kh, 2)} × ${nf(c)}) = ${show(OH, 2)} mol/L`, `pOH = ${nf(Math.round(-Math.log10(OH) * 100) / 100)} → pH = ${nf(Math.round(pH * 100) / 100)}`] };
  });
  T("back-titration", "u06", 3, 3, 150, (rng) => {
    const nNH3 = pick(rng, [0.0010, 0.0020, 0.0015, 0.0030]), cacid = 0.10, Vacid = 50, cb = 0.10;
    const nacid = cacid * Vacid / 1000, nback = nacid - nNH3, Vb = nback / cb * 1000;
    return { text: `アンモニア [[NH3]] を含む気体を、${nf(cacid, 2)} mol/L の塩酸 ${Vacid} mL にすべて吸収させた。残った塩酸を ${nf(cb, 2)} mol/L の水酸化ナトリウム水溶液で滴定すると、中和に ${nf(Vb, 1)} mL 必要だった。吸収させた [[NH3]] は何 mol か。`, ans: nNH3, unit: "mol", sig: 2, tol: { rel: 0.03 }, steps: [`加えた HCl: ${nf(cacid)} × ${Vacid}/1000 = ${nf(nacid)} mol`, `NaOH で中和した（残った）HCl: ${nf(cb)} × ${nf(Vb, 1)}/1000 = ${nf(cb * Vb / 1000)} mol`, `[[NH3]] と反応した HCl = ${nf(nacid)} − ${nf(cb * Vb / 1000)} = ${nf(nNH3)} mol → [[NH3]] も同じ（1 : 1）`] };
  }, { xo: true });

  /* ---- u07 酸化還元 ---- */
  T("oxalic-permanganate", "u07", 3, 2, 110, (rng) => {
    const cK = pick(rng, [0.020, 0.010, 0.040]), V = pick(rng, [10, 20, 16]), Vo = pick(rng, [10, 20, 25]);
    const co = 2.5 * cK * V / Vo;
    return { text: `シュウ酸水溶液 ${Vo} mL を硫酸酸性にし、${nf(cK, 3)} mol/L の過マンガン酸カリウム水溶液で滴定したところ、${V} mL で終点に達した。シュウ酸のモル濃度は何 mol/L か。\n[[2MnO4^- + 5(COOH)2 + 6H^+ → 2Mn^2+ + 10CO2 + 8H2O]]`, ans: co, unit: "mol/L", sig: 3, steps: [`[[KMnO4]]: ${nf(cK)} × ${V}/1000 = ${nf(cK * V / 1000)} mol`, `係数比 2 : 5 より シュウ酸は ${nf(cK * V / 1000)} × 5/2 = ${nf(2.5 * cK * V / 1000)} mol`, `${nf(2.5 * cK * V / 1000)} ÷ ${nf(Vo / 1000)} = ${nf(co)} mol/L`] };
  });
  T("iodine-titration", "u07", 3, 3, 130, (rng) => {
    const cI = pick(rng, [0.050, 0.020, 0.10]), VI = pick(rng, [10, 20, 25]), Vs = pick(rng, [10, 20, 15]);
    const cS = 2 * cI * VI / Vs;
    return { text: `濃度のわからないチオ硫酸ナトリウム [[Na2S2O3]] 水溶液 ${Vs} mL を、デンプンを指示薬として ${nf(cI, 3)} mol/L のヨウ素溶液で滴定したところ、${VI} mL で終点に達した。チオ硫酸ナトリウム水溶液のモル濃度は何 mol/L か。\n[[I2 + 2S2O3^2- → 2I^- + S4O6^2-]]`, ans: cS, unit: "mol/L", sig: 3, steps: [`[[I2]]: ${nf(cI)} × ${VI}/1000 = ${nf(cI * VI / 1000)} mol`, `係数比 1 : 2 より [[S2O3^2-]] は ${nf(2 * cI * VI / 1000)} mol`, `${nf(2 * cI * VI / 1000)} ÷ ${nf(Vs / 1000)} = ${nf(cS)} mol/L`] };
  });
  T("displacement-mass", "u07", 2, 1, 90, (rng) => {
    const x = pick(rng, [0.10, 0.20, 0.050]);
    return { text: `硝酸銀水溶液に銅板を入れると、銅が溶け、銀が析出した。銀が ${nf(x * 108, 3)} g 析出したとき、溶けた銅は何 g か。原子量 Cu=64、Ag=108。\n[[Cu + 2Ag^+ → Cu^2+ + 2Ag]]`, ans: x / 2 * 64, unit: "g", sig: 3, steps: [`析出した銀: ${nf(x * 108, 3)} ÷ 108 = ${nf(x)} mol`, `係数比 Cu : Ag = 1 : 2 なので、溶けた銅は ${nf(x / 2)} mol`, `質量: ${nf(x / 2)} × 64 = ${nf(x / 2 * 64)} g`] };
  });

  /* ---- u08 気体 ---- */
  T("gas-density", "u08", 2, 1, 80, (rng) => {
    const [f, M] = pick(rng, [["CO2", 44], ["O2", 32], ["N2", 28], ["CH4", 16], ["NH3", 17]]), T0 = pick(rng, [300, 273, 400]), p = pick(rng, [100, 83, 166, 249]);
    const d = p * M / (R_GAS * T0);
    return { text: `${T0} K、${p} kPa における [[${f}]]（分子量 ${M}）の密度は何 g/L か。R = 8.3 kPa·L/(K·mol)。`, ans: d, unit: "g/L", sig: 3, steps: [`pV = (w/M)RT より、密度 d = w/V = pM/(RT)`, `d = ${p} × ${M} ÷ (8.3 × ${T0}) = ${nf(d)} g/L`] };
  });
  T("water-displacement", "u08", 3, 2, 110, (rng) => {
    const P = pick(rng, [101, 100]), pw = pick(rng, [3.0, 4.0, 7.0]), V = pick(rng, [0.50, 1.0, 2.0]), T0 = pick(rng, [300, 290]);
    const n = (P - pw) * V / (R_GAS * T0);
    return { text: `${T0} K で、発生した気体を水上置換で ${nf(V, 2)} L 捕集した。大気圧は ${P} kPa、この温度での水の飽和蒸気圧は ${nf(pw, 1)} kPa である。捕集した気体（水蒸気を除く）の物質量は何 mol か。R = 8.3 kPa·L/(K·mol)。`, ans: n, unit: "mol", sig: 2, tol: { rel: 0.03 }, steps: [`捕集した気体の分圧 = 大気圧 − 水蒸気圧 = ${P} − ${nf(pw, 1)} = ${nf(P - pw)} kPa`, `n = pV/(RT) = ${nf(P - pw)} × ${nf(V)} ÷ (8.3 × ${T0}) = ${nf(n)} mol`] };
  });
  T("gas-pressure-change", "u08", 2, 1, 80, (rng) => {
    const V1 = pick(rng, [2.0, 3.0, 4.0]), V2 = pick(rng, [1.0, 6.0, 8.0].filter((x) => x !== V1)), p1 = pick(rng, [1.0, 2.0, 3.0]);
    return { text: `温度を一定に保って、圧力 ${nf(p1, 1)}×10^5 Pa で体積 ${nf(V1, 1)} L の気体の体積を ${nf(V2, 1)} L にした。圧力は何×10^5 Pa になるか。`, ans: p1 * V1 / V2, unit: "×10^5 Pa", sig: 3, steps: [`ボイルの法則 p₁V₁ = p₂V₂`, `p₂ = ${nf(p1)} × ${nf(V1)} ÷ ${nf(V2)} = ${nf(p1 * V1 / V2)} ×10^5 Pa`] };
  });
  T("partial-pressure-binary", "u08", 2, 1, 90, (rng) => {
    const P = pick(rng, [2.0, 4.0]), x = pick(rng, [0.25, 0.50, 0.20]), V = pick(rng, [1.0, 2.0]);
    return { text: `容積 ${nf(V, 1)} L の容器に、エタン [[C2H6]] とプロパン [[C3H8]] の混合気体が入っている。全圧は ${nf(P, 1)}×10^5 Pa で、エタンのモル分率は ${nf(x, 2)} である。プロパンの分圧は何×10^5 Pa か。`, ans: P * (1 - x), unit: "×10^5 Pa", sig: 3, steps: [`プロパンのモル分率 = 1 − ${nf(x)} = ${nf(1 - x)}`, `分圧 = 全圧 × モル分率 = ${nf(P)} × ${nf(1 - x)} = ${nf(P * (1 - x))} ×10^5 Pa`] };
  });

  /* ---- u09 熱化学 ---- */
  T("combustion-heat-amount", "u09", 2, 1, 90, (rng) => {
    const [f, name, Q, M] = pick(rng, [["CH4", "メタン", 891, 16], ["C3H8", "プロパン", 2220, 44], ["C2H5OH", "エタノール", 1368, 46], ["C", "黒鉛", 394, 12], ["H2", "水素", 286, 2.0]]);
    const g = pick(rng, [8.0, 16.0, 4.0, 22.0].map((x) => x * M / 16 > 0 ? x : x));
    const gg = M * pick(rng, [0.50, 1.0, 2.0, 0.25]);
    return { text: `${name}（[[${f}]]）の燃焼熱は ${Q} kJ/mol である。${name} ${nf(gg, 1)} g を完全燃焼させたときに発生する熱量は何 kJ か。（分子量 ${nf(M)}）`, ans: gg / M * Q, unit: "kJ", sig: 3, steps: [`${nf(gg, 1)} ÷ ${nf(M)} = ${nf(gg / M)} mol`, `${nf(gg / M)} × ${Q} = ${nf(gg / M * Q)} kJ`], _g: g };
  });
  T("neutralization-heat", "u09", 3, 2, 110, (rng) => {
    const [c, V, dT] = pick(rng, [[1.0, 100, 6.7], [1.0, 200, 6.7], [0.50, 100, 3.3], [0.50, 200, 3.3]]);       // 中和熱がおよそ 56 kJ/mol になる組み合わせ
    const q = 2 * V * 4.2 * dT / 1000, n = c * V / 1000, Q = q / n;
    return { text: `${nf(c, 2)} mol/L の塩酸 ${V} mL と ${nf(c, 2)} mol/L の水酸化ナトリウム水溶液 ${V} mL を混ぜたところ、液温が ${nf(dT, 1)} ℃ 上昇した。混合液の密度を 1.0 g/cm³、比熱を 4.2 J/(g·K) として、中和熱は 1 mol あたり何 kJ か。（熱の損失は考えない）`, ans: Q, unit: "kJ/mol", sig: 3, steps: [`混合液の質量: ${2 * V} g、発生した熱量: ${2 * V} × 4.2 × ${nf(dT)} = ${nf(2 * V * 4.2 * dT)} J = ${nf(q)} kJ`, `生じた水（中和した [[H^+]]）: ${nf(c)} × ${V}/1000 = ${nf(n)} mol`, `${nf(q)} ÷ ${nf(n)} = ${nf(Q)} kJ/mol`] };
  });
  T("bond-energy", "u09", 3, 3, 130, (rng) => {
    const set = pick(rng, [
      { eq: "H2 + Cl2 → 2HCl", bonds: [["H–H", 436], ["Cl–Cl", 243]], formed: [["H–Cl", 432, 2]], ans: 436 + 243 - 2 * 432 },
      { eq: "H2 + Br2 → 2HBr", bonds: [["H–H", 436], ["Br–Br", 193]], formed: [["H–Br", 366, 2]], ans: 436 + 193 - 2 * 366 },
      { eq: "N2 + 3H2 → 2NH3", bonds: [["N≡N", 946], ["H–H", 436]], formed: [["N–H", 391, 6]], ans: 946 + 3 * 436 - 6 * 391, cnt: 3 }
    ]);
    const lines = [...set.bonds.map((b, i) => `${b[0]}: ${b[1]} kJ/mol`), ...set.formed.map((b) => `${b[0]}: ${b[1]} kJ/mol`)].join("、");
    return { text: `結合エネルギー（${lines}）から、次の反応の反応熱を求めよ。（発熱なら負の値で入力）\n[[${set.eq}]]`, ans: set.ans, unit: "kJ", sig: 3, tol: { abs: 0.6 }, steps: [`反応熱 ΔH = (切れる結合のエネルギーの和) − (できる結合のエネルギーの和)`, `切る: ${set.bonds.map((b, i) => `${b[1]}${set.cnt && i === 1 ? "×3" : ""}`).join(" + ")} = ${set.bonds.reduce((s, b, i) => s + b[1] * (set.cnt && i === 1 ? 3 : 1), 0)}`, `つくる: ${set.formed.map((b) => `${b[1]}×${b[2]}`).join(" + ")} = ${set.formed.reduce((s, b) => s + b[1] * b[2], 0)}`, `ΔH = ${set.bonds.reduce((s, b, i) => s + b[1] * (set.cnt && i === 1 ? 3 : 1), 0)} − ${set.formed.reduce((s, b) => s + b[1] * b[2], 0)} = ${set.ans} kJ`] };
  });

  /* ---- u10 溶液 ---- */
  T("boiling-point-elevation", "u10", 3, 2, 110, (rng) => {
    const [f, M, i, name] = pick(rng, [["C6H12O6", 180, 1, "グルコース"], ["C12H22O11", 342, 1, "スクロース"], ["NaCl", 58.5, 2, "塩化ナトリウム"], ["CO(NH2)2", 60, 1, "尿素"]]);
    const W = pick(rng, [100, 200, 250]), m = pick(rng, [0.10, 0.20, 0.50]), w = m * W / 1000 * M, dT = 0.52 * m * i;
    return { text: `水 ${W} g に ${name}（[[${f}]]、式量 ${nf(M)}）${nf(sig(w, 3))} g を溶かした水溶液の沸点上昇度は何 K か。水のモル沸点上昇は 0.52 K·kg/mol とし、電解質は完全に電離するものとする。`, ans: dT, unit: "K", sig: 2, steps: [`質量モル濃度: ${nf(sig(w, 3))} ÷ ${nf(M)} ÷ ${nf(W / 1000)} = ${nf(m)} mol/kg`, `Δt = 0.52 × ${nf(m)} × ${i} = ${nf(dT)} K`] };
  });
  T("henry-law", "u10", 2, 1, 80, (rng) => {
    const c1 = pick(rng, [0.60, 0.30, 1.2]), p1 = pick(rng, [1.0, 2.0]), p2 = pick(rng, [3.0, 4.0, 5.0, 0.50]);
    return { text: `ある温度で、${nf(p1, 1)}×10^5 Pa の気体 A は水 1 L に ${nf(c1, 2)} mmol 溶ける（ヘンリーの法則が成り立つ）。同じ温度で、圧力が ${nf(p2, 1)}×10^5 Pa のとき、水 1 L に溶ける気体 A は何 mmol か。`, ans: c1 * p2 / p1, unit: "mmol", sig: 3, steps: [`溶ける物質量は、圧力に比例する`, `${nf(c1)} × ${nf(p2)}/${nf(p1)} = ${nf(c1 * p2 / p1)} mmol`] };
  });
  T("vapor-pressure-lowering", "u10", 3, 3, 130, (rng) => {
    const p0 = pick(rng, [20, 30, 100, 24]), nA = pick(rng, [9.0, 18.0, 4.0]), nB = pick(rng, [1.0, 2.0]);
    const p = p0 * nA / (nA + nB);
    return { text: `一定温度で、純水の飽和蒸気圧は ${nf(p0, 1)} kPa である。この温度で、水 ${nf(nA, 1)} mol に非電解質の不揮発性物質 ${nf(nB, 1)} mol を溶かした溶液の蒸気圧は何 kPa か。（ラウールの法則）`, ans: p, unit: "kPa", sig: 3, steps: [`溶媒（水）のモル分率: ${nf(nA)}/(${nf(nA)} + ${nf(nB)}) = ${nf(nA / (nA + nB))}`, `蒸気圧 = ${nf(p0)} × ${nf(nA / (nA + nB))} = ${nf(p)} kPa`] };
  });

  /* ---- u11 結晶・状態変化 ---- */
  T("nacl-lattice-density", "u11", 3, 3, 140, (rng) => {
    const a = pick(rng, [5.6, 5.64]), Z = 4, M = 58.5, v = (a * 1e-8) ** 3, d = Z * M / (NA * v);
    return { text: `塩化ナトリウムの結晶（NaCl 型）の単位格子の一辺は ${nf(a, 2)}×10^−8 cm である。単位格子には NaCl が ${Z} 組ふくまれるとして、結晶の密度は何 g/cm³ か。式量 58.5、アボガドロ定数 6.0×10^23/mol。`, ans: d, unit: "g/cm³", sig: 3, tol: { rel: 0.03 }, steps: [`単位格子の質量: ${Z} × 58.5 ÷ 6.0×10^23 = ${show(Z * M / NA, 3)} g`, `体積: (${nf(a)}×10^−8)³ = ${show(v, 3)} cm³`, `密度 = ${nf(d)} g/cm³`] };
  }, { xo: true });
  T("state-change-heat", "u11", 3, 2, 120, (rng) => {
    const m = pick(rng, [18, 36, 9.0, 90]), Lf = 6.0, Lv = 41, cw = 75.3 / 1000;
    const nmol = m / 18, q = nmol * Lf + nmol * cw * 100 + nmol * Lv;
    return { text: `0 ℃ の氷 ${nf(m)} g を、すべて 100 ℃ の水蒸気にするのに必要な熱量は何 kJ か。氷の融解熱 6.0 kJ/mol、水の蒸発熱 41 kJ/mol、水のモル比熱 75.3 J/(mol·K)（= 0.0753 kJ/(mol·K)）、水の分子量 18。`, ans: q, unit: "kJ", sig: 3, tol: { rel: 0.015 }, steps: [`物質量: ${nf(m)} ÷ 18 = ${nf(nmol)} mol`, `融解: ${nf(nmol)} × 6.0 = ${nf(nmol * Lf)} kJ`, `0 ℃ → 100 ℃: ${nf(nmol)} × 0.0753 × 100 = ${nf(nmol * cw * 100)} kJ`, `蒸発: ${nf(nmol)} × 41 = ${nf(nmol * Lv)} kJ`, `合計 ${nf(q)} kJ`] };
  });
  T("lattice-atoms-from-density", "u11", 3, 3, 140, (rng) => {
    const [name, M, a, d, Z] = pick(rng, [["金属 X（原子量 56）", 56, 2.87, 7.87, 2], ["金属 Y（原子量 27）", 27, 4.05, 2.70, 4], ["金属 Z（原子量 64）", 64, 3.61, 8.96, 4]]);
    const v = (a * 1e-8) ** 3, n = d * v * NA / M;
    return { text: `${name}の単位格子は立方体で、一辺は ${nf(a, 2)}×10^−8 cm、密度は ${nf(d, 2)} g/cm³ である。単位格子にふくまれる原子の数を、整数で求めよ。アボガドロ定数 6.0×10^23/mol。`, ans: Z, unit: "個", sig: 2, tol: { abs: 0.2 }, steps: [`単位格子の質量 = 密度 × 体積 = ${nf(d)} × ${show(v, 3)} = ${show(d * v, 3)} g`, `原子 1 個の質量 = ${nf(M)} ÷ 6.0×10^23 = ${show(M / NA, 3)} g`, `原子の数 = ${show(d * v, 3)} ÷ ${show(M / NA, 3)} ≈ ${nf(n)} → ${Z}`] };
  }, { xo: true });

  /* ---- u12 電池 ---- */
  T("lead-battery-mass", "u12", 3, 2, 120, (rng) => {
    const ne = pick(rng, [0.20, 0.50, 1.0, 0.10]);
    return { text: `鉛蓄電池を放電したところ、電子が ${nf(ne, 2)} mol 流れた。このとき、負極（[[Pb]]）の質量は何 g 増加するか。原子量 Pb=207、S=32、O=16。\n負極: [[Pb + SO4^2- → PbSO4 + 2e^-]]`, ans: ne / 2 * 96, unit: "g", sig: 3, steps: [`電子 2 mol で [[Pb]] 1 mol が [[PbSO4]] になる。変化した [[Pb]] は ${nf(ne / 2)} mol`, `増加するのは結合した [[SO4]]（式量 96）の分: ${nf(ne / 2)} × 96 = ${nf(ne / 2 * 96)} g`] };
  });
  T("fuel-cell-hydrogen", "u12", 3, 2, 120, (rng) => {
    const I = pick(rng, [2.0, 5.0, 1.0, 10.0]), t = pick(rng, [965, 1930, 9650, 3860]);
    const q = I * t, ne = q / F_CONST, V = ne / 2 * 22.4;
    return { text: `水素を燃料とするリン酸形燃料電池から、${nf(I, 1)} A の電流を ${t} 秒間取り出した。消費された水素は、標準状態で何 L か。ファラデー定数 9.65×10^4 C/mol。\n負極: [[H2 → 2H^+ + 2e^-]]`, ans: V, unit: "L", sig: 3, steps: [`電気量: ${nf(I)} × ${t} = ${nf(q)} C → 電子 ${nf(ne)} mol`, `[[H2]] 1 mol で電子 2 mol なので、${nf(ne / 2)} mol`, `体積: ${nf(ne / 2)} × 22.4 = ${nf(V)} L`] };
  });
  T("cell-electromotive", "u12", 2, 1, 80, (rng) => {
    const [a, b, Ea, Eb] = pick(rng, [["Zn", "Cu", -0.76, 0.34], ["Fe", "Cu", -0.44, 0.34], ["Zn", "Ag", -0.76, 0.80], ["Ni", "Cu", -0.26, 0.34]]);
    return { text: `標準電極電位が [[${a}^2+/${a}]] = ${nf(Ea, 2)} V、${b === "Ag" ? "[[Ag^+/Ag]]" : `[[${b}^2+/${b}]]`} = ${nf(Eb, 2)} V のとき、${a} と ${b} を電極とした電池の標準状態での起電力は何 V か。`, ans: Eb - Ea, unit: "V", sig: 3, tol: { abs: 0.011 }, steps: [`起電力 = (正極の電位) − (負極の電位)。電位が高い ${b} が正極`, `${nf(Eb, 2)} − (${nf(Ea, 2)}) = ${nf(Eb - Ea, 2)} V`] };
  });
  T("cell-capacity", "u12", 3, 2, 110, (rng) => {
    const m = pick(rng, [6.5, 13.0, 3.25, 32.5]);
    const q = m / 65 * 2 * F_CONST, h = q / 3600;
    return { text: `亜鉛 ${nf(m, 2)} g がすべて [[Zn^2+]] になるときに取り出せる電気量は、何 A·h（アンペア時）か。原子量 Zn=65、ファラデー定数 9.65×10^4 C/mol。（1 A·h = 3600 C）`, ans: h, unit: "A·h", sig: 3, steps: [`亜鉛の物質量 ${nf(m)} ÷ 65 = ${nf(m / 65)} mol、電子 ${nf(m / 65 * 2)} mol`, `電気量 ${nf(m / 65 * 2)} × 9.65×10^4 = ${nf(q)} C`, `${nf(q)} ÷ 3600 = ${nf(h)} A·h`] };
  });

  /* ---- u13 電気分解 ---- */
  T("electrolysis-naoh", "u13", 3, 2, 120, (rng) => {
    const I = pick(rng, [5.0, 2.0, 10.0]), t = pick(rng, [1930, 965, 3860, 9650]), q = I * t, n = q / F_CONST;
    return { text: `塩化ナトリウム水溶液を、陽極に炭素、陰極に鉄を用いて、${nf(I, 1)} A で ${t} 秒間電気分解した。陰極側で生じた水酸化ナトリウムは何 g か。式量 NaOH=40、ファラデー定数 9.65×10^4 C/mol。（陰極では水素のみが発生し、電子 1 mol あたり [[OH^-]] 1 mol が生じる）\n陰極: [[2H2O + 2e^- → H2 + 2OH^-]]`, ans: n * 40, unit: "g", sig: 3, steps: [`電気量: ${nf(I)} × ${t} = ${nf(q)} C → 電子 ${nf(n)} mol`, `[[OH^-]] も ${nf(n)} mol → NaOH ${nf(n)} mol`, `${nf(n)} × 40 = ${nf(n * 40)} g`] };
  });
  T("electrolytic-refining", "u13", 3, 2, 110, (rng) => {
    const I = pick(rng, [10.0, 20.0, 5.0]), t = pick(rng, [9650, 4825, 19300]), q = I * t, m = q / F_CONST / 2 * 64 / 1000;
    return { text: `銅の電解精錬で、${nf(I, 1)} A の電流を ${t} 秒間流した。陰極に析出する純銅は、理論上何 kg か。原子量 Cu=64、ファラデー定数 9.65×10^4 C/mol。（電流はすべて銅の析出に使われる）`, ans: m, unit: "kg", sig: 3, steps: [`電気量: ${nf(I)} × ${t} = ${nf(q)} C → 電子 ${nf(q / F_CONST)} mol`, `銅: ${nf(q / F_CONST)} ÷ 2 × 64 = ${nf(q / F_CONST / 2 * 64)} g = ${nf(m)} kg`] };
  });
  T("aluminum-electrolysis", "u13", 3, 2, 120, (rng) => {
    const kg = pick(rng, [0.27, 0.54, 2.7, 0.135]), n = kg * 1000 / 27 * 3, q = n * F_CONST, A = pick(rng, [1.0e4, 5.0e3]), t = q / A;
    return { text: `溶融塩電解（融解した氷晶石に酸化アルミニウムを溶かして電気分解）で、アルミニウムを ${nf(kg, 3)} kg つくりたい。${nf(A)} A の電流を流すとき、何秒かかるか。原子量 Al=27、ファラデー定数 9.65×10^4 C/mol。\n陰極: [[Al^3+ + 3e^- → Al]]`, ans: t, unit: "秒", sig: 3, steps: [`アルミニウム ${nf(kg * 1000)} g = ${nf(kg * 1000 / 27)} mol、必要な電子は 3 倍で ${nf(n)} mol`, `電気量: ${nf(n)} × 9.65×10^4 = ${nf(q)} C`, `時間: ${nf(q)} ÷ ${nf(A)} = ${nf(t)} 秒`] };
  });

  /* ---- u14 反応速度 ---- */
  T("activation-energy", "u14", 3, 3, 130, (rng) => {
    const [T1, T2] = pick(rng, [[300, 310], [300, 320], [290, 300]]), ratio = pick(rng, [2.0, 3.0, 4.0]);
    return { text: `ある反応の速度定数は、温度が ${T1} K から ${T2} K に上がると ${nf(ratio, 1)} 倍になった。この温度範囲での、活性化エネルギー Ea の見積もりとして、アレニウスの式 k = Ae^(−Ea/RT) を使い、ln ${nf(ratio, 1)} = ${nf(Math.log(ratio), 3)} とすると、Ea は何 kJ/mol か。R = 8.3 J/(K·mol)。`, ans: Math.log(ratio) * R_GAS * T1 * T2 / (T2 - T1) / 1000, unit: "kJ/mol", sig: 2, tol: { rel: 0.04 }, steps: [`ln(k₂/k₁) = (Ea/R)(1/T₁ − 1/T₂)`, `Ea = R × ln(k₂/k₁) × T₁T₂/(T₂ − T₁) = 8.3 × ${nf(Math.log(ratio), 3)} × ${T1}×${T2}/${T2 - T1}`, `= ${nf(Math.log(ratio) * R_GAS * T1 * T2 / (T2 - T1) / 1000)} kJ/mol`] };
  }, { xo: true });
  T("first-order-conc", "u14", 3, 2, 110, (rng) => {
    const k = pick(rng, [0.10, 0.050, 0.020]), t = pick(rng, [10, 20, 30]), c0 = pick(rng, [1.0, 0.80, 0.50]);
    return { text: `一次反応 A → B の速度定数は ${nf(k, 3)} /min である。はじめの濃度が ${nf(c0, 2)} mol/L のとき、${t} 分後の A の濃度は何 mol/L か。ただし e^(−${nf(k * t, 2)}) = ${nf(Math.exp(-k * t), 3)} とする。`, ans: c0 * Math.exp(-k * t), unit: "mol/L", sig: 2, tol: { rel: 0.03 }, steps: [`[A] = [A]₀ e^(−kt) = ${nf(c0)} × e^(−${nf(k)} × ${t})`, `= ${nf(c0)} × ${nf(Math.exp(-k * t), 3)} = ${nf(c0 * Math.exp(-k * t))} mol/L`] };
  });
  T("rate-temperature", "u14", 2, 1, 80, (rng) => {
    const dT = pick(rng, [10, 20, 30]), t0 = pick(rng, [80, 160, 64]);
    return { text: `ある反応は、温度が 10 ℃ 上がるごとに反応速度が 2 倍になる。20 ℃ で反応が完了するのに ${t0} 分かかるとき、${20 + dT} ℃ では何分で完了するか。（反応速度と完了までの時間は反比例する）`, ans: t0 / 2 ** (dT / 10), unit: "分", sig: 3, steps: [`${dT} ℃ 上がるので、速度は 2^${dT / 10} = ${2 ** (dT / 10)} 倍`, `時間は ${nf(t0)} ÷ ${2 ** (dT / 10)} = ${nf(t0 / 2 ** (dT / 10))} 分`] };
  });

  /* ---- u15 化学平衡 ---- */
  T("dissociation-degree", "u15", 3, 2, 110, (rng) => {
    const c = pick(rng, [0.10, 0.010, 0.20]), alpha = pick(rng, [0.010, 0.020, 0.050]);
    const Ka = c * alpha * alpha / (1 - alpha);
    return { text: `${nf(c, 3)} mol/L の弱酸 HA の水溶液で、電離度が ${nf(alpha, 3)} であった。この酸の電離定数 [[Ka]] は何 mol/L か。（電離度は小さいので 1 − α ≒ 1 としてよい）`, ans: c * alpha * alpha, unit: "mol/L", sig: 2, tol: { rel: 0.03 }, steps: [`Ka = cα²/(1 − α) ≒ cα²`, `= ${nf(c)} × ${nf(alpha, 3)}² = ${show(c * alpha * alpha, 2)} mol/L`], _Ka: Ka };
  });
  T("ksp-solubility", "u15", 3, 3, 130, (rng) => {
    const [salt, Ksp, kind] = pick(rng, [["AgCl", 1.6e-10, 1], ["BaSO4", 1.0e-10, 1], ["CaF2", 3.2e-11, 2], ["Ag2CrO4", 4.0e-12, 3]]);
    let s;
    if (kind === 1) s = Math.sqrt(Ksp); else if (kind === 2) s = Math.cbrt(Ksp / 4); else s = Math.cbrt(Ksp / 4);
    const form = kind === 1 ? `[[${salt}]] ⇌ 陽イオン + 陰イオン（1 : 1）、Ksp = s²` : `[[${salt}]] は、2 : 1 の割合でイオンに分かれる、Ksp = 4s³`;
    return { text: `${salt === "AgCl" ? "塩化銀" : salt === "BaSO4" ? "硫酸バリウム" : salt === "CaF2" ? "フッ化カルシウム" : "クロム酸銀"}（[[${salt}]]）の溶解度積は ${show(Ksp, 2)}（単位は省略）である。純水への溶解度（飽和水溶液での、溶けている式量あたりの物質量濃度）は何 mol/L か。\n（${form}）`, ans: s, unit: "mol/L", sig: 2, tol: { rel: 0.04 }, steps: [form, `s = ${kind === 1 ? "√Ksp" : "(Ksp/4)^(1/3)"} = ${show(s, 2)} mol/L`] };
  });
  T("buffer-nh3", "u15", 3, 3, 130, (rng) => {
    const [cb, cs, Kb] = pick(rng, [[0.10, 0.10, 2.0e-5], [0.20, 0.10, 2.0e-5], [0.10, 0.20, 2.0e-5]]);
    const OH = Kb * cb / cs, pOH = -Math.log10(OH), pH = 14 - pOH;
    return { text: `${nf(cb, 2)} mol/L のアンモニア水と ${nf(cs, 2)} mol/L の塩化アンモニウム水溶液を同体積ずつ混ぜた緩衝液の pH を求めよ。アンモニアの電離定数 [[Kb]] = ${show(Kb, 2)} mol/L、水のイオン積 1.0×10^−14 (mol/L)²、log10 2 = 0.30 とする。`, ans: Math.round(pH * 100) / 100, unit: "", sig: 3, tol: { abs: 0.06 }, steps: [`[[OH^-]] = Kb × [NH3]/[NH4^+] = ${show(Kb, 2)} × ${nf(cb)}/${nf(cs)} = ${show(OH, 2)} mol/L`, `pOH = ${nf(Math.round(pOH * 100) / 100)} → pH = 14 − pOH = ${nf(Math.round(pH * 100) / 100)}`] };
  }, { xo: true });
  T("kc-kp", "u15", 3, 3, 130, (rng) => {
    const dn = pick(rng, [1, -1, -2]), Kc = pick(rng, [2.0, 4.0, 0.50]), T0 = pick(rng, [300, 400, 500]);
    const Kp = Kc * (R_GAS * 1000 / 1e5 * T0) ** dn;                    // Pa·L/(K·mol) = 8.3×10^3 ; p は ×10^5 Pa
    return { text: `ある気体の反応の濃度平衡定数が [[Kc]] = ${nf(Kc, 2)}（mol/L の単位）、反応の前後で気体の物質量が ${dn > 0 ? "増加する（Δn = +" + dn + "）" : "減少する（Δn = " + dn + "）"}。${T0} K での圧平衡定数 [[Kp]] を、圧力を 10^5 Pa 単位で表したときの値で求めよ。R = 8.3×10^3 Pa·L/(K·mol)。（Kp = Kc(RT)^Δn。RT を 10^5 Pa·L/mol の単位にそろえて計算する）`, ans: Kp, unit: "", sig: 2, tol: { rel: 0.04 }, steps: [`RT = 8.3×10^3 × ${T0} = ${show(R_GAS * 1000 * T0, 3)} Pa·L/mol = ${nf(R_GAS * 1000 * T0 / 1e5)} ×10^5 Pa·L/mol`, `Kp = Kc × (RT)^Δn = ${nf(Kc)} × ${nf(R_GAS * 1000 * T0 / 1e5)}^(${dn}) = ${show(Kp, 2)}`] };
  }, { xo: true });

  /* ---- u16〜u19 無機 ---- */
  T("chlorine-generation", "u16", 2, 1, 90, (rng) => {
    const g = pick(rng, [8.7, 17.4, 4.35, 43.5]);
    return { text: `酸化マンガン(IV) [[MnO2]]（式量 87）${nf(g, 2)} g に濃塩酸を加えて加熱すると、塩素が発生する。標準状態で何 L の塩素が得られるか。（モル体積 22.4 L/mol）\n[[MnO2 + 4HCl → MnCl2 + 2H2O + Cl2]]`, ans: g / 87 * 22.4, unit: "L", sig: 3, steps: [`[[MnO2]]: ${nf(g, 2)} ÷ 87 = ${nf(g / 87)} mol`, `係数比 1 : 1 なので [[Cl2]] も ${nf(g / 87)} mol`, `${nf(g / 87)} × 22.4 = ${nf(g / 87 * 22.4)} L`] };
  });
  T("ostwald-nitric-acid", "u19", 3, 2, 120, (rng) => {
    const kg = pick(rng, [17, 34, 8.5, 51]);
    const nNH3 = kg * 1000 / 17, mHNO3 = nNH3 * 63 / 1000;
    return { text: `オストワルト法で、アンモニア ${nf(kg)} kg（分子量 17）をすべて硝酸（分子量 63）に変えると、硝酸は理論上何 kg 得られるか。\n[[4NH3 + 5O2 → 4NO + 6H2O]]　[[2NO + O2 → 2NO2]]　[[3NO2 + H2O → 2HNO3 + NO]]\n（生じた NO は回収して再び利用し、全体として [[NH3]] 1 mol から [[HNO3]] 1 mol が得られるものとする）`, ans: mHNO3, unit: "kg", sig: 3, steps: [`[[NH3]] ${nf(kg)} kg = ${nf(nNH3)} mol`, `全体の反応では [[NH3]] 1 mol から [[HNO3]] 1 mol なので ${nf(nNH3)} mol`, `${nf(nNH3)} × 63 = ${nf(nNH3 * 63)} g = ${nf(mHNO3)} kg`] };
  });
  T("solvay-process", "u19", 3, 2, 120, (rng) => {
    const kg = pick(rng, [58.5, 117, 29.25, 175.5]);
    const n = kg * 1000 / 58.5, na2co3 = n / 2 * 106 / 1000;
    return { text: `アンモニアソーダ法で、塩化ナトリウム ${nf(kg, 2)} kg（式量 58.5）から、炭酸ナトリウム（式量 106）は理論上何 kg 得られるか。\n[[NaCl + NH3 + CO2 + H2O → NaHCO3 + NH4Cl]]　[[2NaHCO3 → Na2CO3 + CO2 + H2O]]`, ans: na2co3, unit: "kg", sig: 3, steps: [`[[NaCl]] ${nf(kg, 2)} kg = ${nf(n)} mol → [[NaHCO3]] も ${nf(n)} mol`, `[[NaHCO3]] 2 mol から [[Na2CO3]] 1 mol なので ${nf(n / 2)} mol`, `${nf(n / 2)} × 106 = ${nf(n / 2 * 106)} g = ${nf(na2co3)} kg`] };
  });
  T("limewater-co2", "u17", 2, 1, 90, (rng) => {
    const V = pick(rng, [2.24, 4.48, 1.12, 6.72]);
    return { text: `十分な量の石灰水（水酸化カルシウム水溶液）に、標準状態で ${nf(V, 2)} L の二酸化炭素を通じると、炭酸カルシウムの白色沈殿が生じた。沈殿は何 g か。式量 CaCO3=100、モル体積 22.4 L/mol。\n[[Ca(OH)2 + CO2 → CaCO3 + H2O]]`, ans: V / 22.4 * 100, unit: "g", sig: 3, steps: [`[[CO2]]: ${nf(V, 2)} ÷ 22.4 = ${nf(V / 22.4)} mol`, `係数比 1 : 1 なので [[CaCO3]] も ${nf(V / 22.4)} mol`, `${nf(V / 22.4)} × 100 = ${nf(V / 22.4 * 100)} g`] };
  });
  T("iron-smelting", "u18", 3, 2, 120, (rng) => {
    const kg = pick(rng, [160, 320, 80, 480]);
    const nFe2O3 = kg * 1000 / 160, mFe = nFe2O3 * 2 * 56 / 1000;
    return { text: `溶鉱炉で、酸化鉄(III) [[Fe2O3]]（式量 160）${nf(kg)} kg を一酸化炭素で還元して鉄（原子量 56）をつくる。鉄は理論上何 kg 得られるか。\n[[Fe2O3 + 3CO → 2Fe + 3CO2]]`, ans: mFe, unit: "kg", sig: 3, steps: [`[[Fe2O3]] ${nf(kg)} kg = ${nf(nFe2O3)} mol`, `係数比 1 : 2 なので鉄は ${nf(nFe2O3 * 2)} mol`, `${nf(nFe2O3 * 2)} × 56 = ${nf(nFe2O3 * 2 * 56)} g = ${nf(mFe)} kg`] };
  });
  T("copper-sulfate-hydrate", "u18", 2, 1, 90, (rng) => {
    const g = pick(rng, [12.5, 25.0, 50.0, 100.0]);
    return { text: `硫酸銅(II)五水和物 [[CuSO4·5H2O]]（式量 250）${nf(g, 1)} g を水に溶かしたとき、硫酸銅(II) [[CuSO4]] の物質量は何 mol か。`, ans: g / 250, unit: "mol", sig: 3, steps: [`水和物 1 mol に [[CuSO4]] は 1 mol ふくまれる`, `${nf(g, 1)} ÷ 250 = ${nf(g / 250)} mol`] };
  });
  T("sulfur-dioxide-oxidation", "u16", 3, 2, 110, (rng) => {
    const V = pick(rng, [4.48, 8.96, 22.4, 11.2]);
    return { text: `二酸化硫黄 [[SO2]] が標準状態で ${nf(V, 2)} L ある。これを酸化して、すべて三酸化硫黄 [[SO3]] にするには、標準状態で何 L の酸素が必要か。\n[[2SO2 + O2 → 2SO3]]`, ans: V / 2, unit: "L", sig: 3, steps: [`係数比 [[SO2]] : [[O2]] = 2 : 1 で、体積比も同じ`, `${nf(V, 2)} ÷ 2 = ${nf(V / 2)} L`] };
  });

  /* ---- u20 脂肪族 ---- */
  T("hydrocarbon-formula", "u20", 3, 2, 110, (rng) => {
    const [name, nC, nH] = pick(rng, [["アルカン", 3, 8], ["アルカン", 4, 10], ["アルケン", 3, 6], ["アルケン", 4, 8], ["アルキン", 3, 4], ["アルキン", 4, 6]]);
    const askH = true;
    return { text: `炭素原子が ${nC} 個の鎖状の${name}の分子式にふくまれる水素原子は何個か。（アルケンは二重結合を 1 つ、アルキンは三重結合を 1 つもつ）`, ans: nH, unit: "個", sig: 2, tol: { abs: 0.01 }, steps: [name === "アルカン" ? `一般式 [[CnH2n+2]]: 2 × ${nC} + 2 = ${nH}` : name === "アルケン" ? `一般式 [[CnH2n]]: 2 × ${nC} = ${nH}` : `一般式 [[CnH2n-2]]: 2 × ${nC} − 2 = ${nH}`] };
  });
  T("alkene-addition-mass", "u20", 3, 2, 120, (rng) => {
    const g = pick(rng, [2.8, 5.6, 1.4, 14.0]), nBr = g / 28;
    return { text: `エチレン [[C2H4]]（分子量 28）${nf(g, 1)} g を、十分な量の臭素水に通じて完全に付加反応させた。反応した臭素 [[Br2]]（分子量 160）は何 g か。\n[[C2H4 + Br2 → C2H4Br2]]`, ans: nBr * 160, unit: "g", sig: 3, steps: [`[[C2H4]]: ${nf(g, 1)} ÷ 28 = ${nf(nBr)} mol`, `係数比 1 : 1 なので [[Br2]] も ${nf(nBr)} mol`, `${nf(nBr)} × 160 = ${nf(nBr * 160)} g`] };
  });
  T("iodine-value", "u20", 3, 3, 130, (rng) => {
    const [name, M, db] = pick(rng, [["オレイン酸のトリグリセリド", 884, 3], ["リノール酸のトリグリセリド", 878, 6], ["リノレン酸のトリグリセリド", 872, 9]]);
    const g = 100, nI = g / M * db * 254;
    return { text: `${name}（分子量 ${M}、1 分子中の C=C 結合の数 ${db}）100 g に付加するヨウ素 [[I2]]（分子量 254）は何 g か。（ヨウ素価に当たる）`, ans: nI, unit: "g", sig: 3, steps: [`100 g の物質量: 100 ÷ ${M} = ${nf(g / M)} mol`, `C=C 1 個に [[I2]] 1 分子が付加するので、[[I2]] は ${nf(g / M)} × ${db} = ${nf(g / M * db)} mol`, `${nf(g / M * db)} × 254 = ${nf(nI)} g`] };
  }, { xo: true });
  T("alcohol-oxidation", "u20", 3, 2, 110, (rng) => {
    const g = pick(rng, [4.6, 9.2, 2.3, 23.0]);
    return { text: `エタノール [[C2H5OH]]（分子量 46）${nf(g, 1)} g をすべてアセトアルデヒド [[CH3CHO]]（分子量 44）に酸化すると、アセトアルデヒドは何 g 得られるか。`, ans: g / 46 * 44, unit: "g", sig: 3, steps: [`[[C2H5OH]] と [[CH3CHO]] は 1 : 1 の関係`, `${nf(g, 1)} ÷ 46 × 44 = ${nf(g / 46 * 44)} g`] };
  });

  /* ---- u21 芳香族 ---- */
  T("aspirin-yield", "u21", 3, 2, 120, (rng) => {
    const g = pick(rng, [13.8, 27.6, 6.9, 69.0]), y = pick(rng, [60, 70, 80, 90]);
    return { text: `サリチル酸 [[C7H6O3]]（分子量 138）${nf(g, 1)} g と十分な量の無水酢酸から、アセチルサリチル酸 [[C9H8O4]]（分子量 180）をつくる。収率が ${y} % のとき、得られるアセチルサリチル酸は何 g か。`, ans: g / 138 * 180 * y / 100, unit: "g", sig: 3, steps: [`サリチル酸: ${nf(g, 1)} ÷ 138 = ${nf(g / 138)} mol`, `理論収量: ${nf(g / 138)} × 180 = ${nf(g / 138 * 180)} g`, `収率 ${y} %: ${nf(g / 138 * 180)} × ${y}/100 = ${nf(g / 138 * 180 * y / 100)} g`] };
  });
  T("aniline-synthesis", "u21", 3, 2, 120, (rng) => {
    const g = pick(rng, [12.3, 24.6, 6.15, 61.5]), y = pick(rng, [100, 80, 50]);
    return { text: `ニトロベンゼン [[C6H5NO2]]（分子量 123）${nf(g, 2)} g を還元して、アニリン [[C6H5NH2]]（分子量 93）をつくる。収率が ${y} % のとき、アニリンは何 g 得られるか。`, ans: g / 123 * 93 * y / 100, unit: "g", sig: 3, steps: [`ニトロベンゼン: ${nf(g, 2)} ÷ 123 = ${nf(g / 123)} mol（1 : 1 で変化）`, `${nf(g / 123)} × 93 × ${y}/100 = ${nf(g / 123 * 93 * y / 100)} g`] };
  });
  T("phenol-cumene", "u21", 3, 3, 130, (rng) => {
    const kg = pick(rng, [120, 240, 60, 360]);
    return { text: `クメン法で、クメン [[C9H12]]（分子量 120）${nf(kg)} kg から、フェノール [[C6H5OH]]（分子量 94）は理論上何 kg 得られるか。\n[[C6H5CH(CH3)2 + O2 → C6H5OH + CH3COCH3]]`, ans: kg * 94 / 120, unit: "kg", sig: 3, steps: [`クメンとフェノールは 1 : 1 の関係`, `${nf(kg)} × 94/120 = ${nf(kg * 94 / 120)} kg`] };
  });

  /* ---- u22 構造決定・異性体 ---- */
  T("isomer-count", "u22", 2, 1, 80, (rng) => {
    const [f, n, note] = pick(rng, [["C4H10", 2, "アルカン"], ["C5H12", 3, "アルカン"], ["C6H14", 5, "アルカン"], ["C7H16", 9, "アルカン"], ["C3H8O", 3, "アルコールとエーテルをあわせて"], ["C4H8", 5, "鎖状のアルケンと環状のシクロアルカンをあわせて（シスとトランスは別に数えない）"], ["C4H10O", 7, "アルコールとエーテルをあわせて（鏡像異性体は考えない）"], ["C3H6", 2, "アルケンとシクロアルカンをあわせて"]]);
    return { text: `分子式 [[${f}]] で表される構造異性体（${note}）は、全部で何種類あるか。`, ans: n, unit: "種類", sig: 2, tol: { abs: 0.01 }, steps: [`${f} について、炭素骨格・官能基の位置を数えあげると ${n} 種類`] };
  });
  T("empirical-formula", "u22", 3, 2, 120, (rng) => {
    const [nC, nH, nO] = pick(rng, [[1, 2, 1], [2, 4, 1], [1, 2, 0], [3, 6, 1], [2, 6, 1]]);
    const M = 12 * nC + nH + 16 * nO, pc = 12 * nC / M * 100, ph = nH / M * 100, po = 16 * nO / M * 100;
    const parts = [`C ${nf(pc, 3)} %`, `H ${nf(ph, 3)} %`]; if (nO) parts.push(`O ${nf(po, 3)} %`);
    return { text: `ある有機化合物の元素分析の結果、質量パーセントは ${parts.join("、")} であった。組成式 [[C_xH_yO_z]] で、炭素原子の数を 1 としたときの水素原子の数 y/x を、整数または小数で答えよ。（原子量 H=1.0、C=12、O=16）`, ans: nH / nC, unit: "", sig: 3, tol: { abs: 0.02 }, steps: [`物質量の比 C : H${nO ? " : O" : ""} = ${nf(pc, 3)}/12 : ${nf(ph, 3)}/1.0${nO ? ` : ${nf(po, 3)}/16` : ""}`, `= ${nf(pc / 12, 3)} : ${nf(ph, 3)}${nO ? ` : ${nf(po / 16, 3)}` : ""} ≒ 1 : ${nf(nH / nC, 3)}${nO ? " : " + nf(nO / nC, 3) : ""}`] };
  });
  T("molecular-formula-factor", "u22", 3, 2, 110, (rng) => {
    const [emp, Me, k] = pick(rng, [["CH2O", 30, 6], ["CH2O", 30, 2], ["CH", 13, 6], ["C2H5", 29, 2], ["CH2", 14, 4]]);
    return { text: `組成式 [[${emp}]]（式量 ${Me}）の化合物の分子量が ${nf(Me * k)} であった。分子式は、組成式の何倍か。`, ans: k, unit: "倍", sig: 2, tol: { abs: 0.01 }, steps: [`${nf(Me * k)} ÷ ${Me} = ${k} 倍`] };
  });

  /* ---- u23 天然高分子 ---- */
  T("fermentation-ethanol", "u23", 3, 2, 120, (rng) => {
    const g = pick(rng, [18.0, 36.0, 90.0, 180.0]);
    return { text: `グルコース [[C6H12O6]]（分子量 180）${nf(g, 1)} g がアルコール発酵ですべて反応すると、エタノール [[C2H5OH]]（分子量 46）は何 g 得られるか。\n[[C6H12O6 → 2C2H5OH + 2CO2]]`, ans: g / 180 * 2 * 46, unit: "g", sig: 3, steps: [`グルコース: ${nf(g, 1)} ÷ 180 = ${nf(g / 180)} mol`, `係数比 1 : 2 なのでエタノールは ${nf(g / 180 * 2)} mol`, `${nf(g / 180 * 2)} × 46 = ${nf(g / 180 * 2 * 46)} g`] };
  });
  T("maltose-hydrolysis", "u23", 2, 1, 90, (rng) => {
    const g = pick(rng, [34.2, 68.4, 17.1, 171.0]);
    return { text: `マルトース（麦芽糖）[[C12H22O11]]（分子量 342）${nf(g, 1)} g を完全に加水分解すると、グルコース [[C6H12O6]]（分子量 180）は何 g できるか。\n[[C12H22O11 + H2O → 2C6H12O6]]`, ans: g / 342 * 2 * 180, unit: "g", sig: 3, steps: [`マルトース: ${nf(g, 1)} ÷ 342 = ${nf(g / 342)} mol`, `グルコースは 2 倍の ${nf(g / 342 * 2)} mol`, `${nf(g / 342 * 2)} × 180 = ${nf(g / 342 * 2 * 180)} g`] };
  });
  T("fehling-cu2o", "u23", 3, 2, 120, (rng) => {
    const g = pick(rng, [1.8, 3.6, 0.90, 9.0]);
    return { text: `グルコース [[C6H12O6]]（分子量 180）${nf(g, 2)} g を、フェーリング液と反応させると、赤色の酸化銅(I) [[Cu2O]]（式量 144）の沈殿が生じた。グルコース 1 mol から [[Cu2O]] 1 mol が生じるものとして、沈殿は何 g か。`, ans: g / 180 * 144, unit: "g", sig: 3, steps: [`グルコース: ${nf(g, 2)} ÷ 180 = ${nf(g / 180)} mol`, `1 : 1 なので [[Cu2O]] も ${nf(g / 180)} mol`, `${nf(g / 180)} × 144 = ${nf(g / 180 * 144)} g`] };
  });
  T("cellulose-acetate", "u23", 3, 3, 130, (rng) => {
    const g = pick(rng, [16.2, 32.4, 8.1, 81.0]);
    const per = 288 / 162;   // トリアセチルセルロース (C6H7O2(OCOCH3)3)n の繰り返し単位 288
    return { text: `セルロース [[(C6H10O5)n]]（繰り返し単位の式量 162）${nf(g, 1)} g のヒドロキシ基をすべてアセチル化して、トリアセチルセルロース（繰り返し単位の式量 288）をつくる。得られるトリアセチルセルロースは理論上何 g か。`, ans: g / 162 * 288, unit: "g", sig: 3, steps: [`セルロースの繰り返し単位: ${nf(g, 1)} ÷ 162 = ${nf(g / 162)} mol`, `1 単位から 288 の単位ができるので ${nf(g / 162)} × 288 = ${nf(g / 162 * 288)} g`], _p: per };
  }, { xo: true });
  T("protein-nitrogen", "u23", 3, 3, 130, (rng) => {
    const N = pick(rng, [14, 28, 7.0, 21.0]);
    return { text: `ある食品を分解して、窒素をすべてアンモニアとして定量したところ、窒素 ${nf(N, 1)} mg がふくまれていた。タンパク質中の窒素の質量割合を 16 % とすると、この食品中のタンパク質は何 mg か。`, ans: N / 0.16, unit: "mg", sig: 3, steps: [`タンパク質の質量 = 窒素の質量 ÷ 0.16`, `${nf(N, 1)} ÷ 0.16 = ${nf(N / 0.16)} mg`] };
  });

  /* ---- u24 合成高分子 ---- */
  T("nylon66-water", "u24", 3, 2, 120, (rng) => {
    const n = pick(rng, [100, 200, 50, 500]);
    return { text: `ヘキサメチレンジアミンとアジピン酸の縮合重合で、ジアミン ${nf(n)} 分子とジカルボン酸 ${nf(n)} 分子がつながって、1 本の鎖状の高分子（ナイロン 66）ができた。このとき生じた水は、全部で何分子か。`, ans: 2 * n - 1, unit: "分子", sig: 3, tol: { abs: 0.01 }, steps: [`つながる分子は全部で ${2 * n} 個。鎖状につながると、アミド結合は ${2 * n} − 1 = ${2 * n - 1} 個できる`, `アミド結合 1 個ができるごとに水が 1 分子とれるので、水は ${2 * n - 1} 分子`] };
  });
  T("nylon6-monomer", "u24", 2, 1, 90, (rng) => {
    const kg = pick(rng, [11.3, 22.6, 5.65, 56.5]);
    return { text: `ナイロン 6 は、ε-カプロラクタム（分子量 113）の開環重合でつくられる。カプロラクタム ${nf(kg, 2)} kg からは、理論上ナイロン 6 は何 kg 得られるか。（開環重合では、副生成物はない）`, ans: kg, unit: "kg", sig: 3, steps: [`開環重合では、原料の質量がそのまま重合体の質量になる`, `${nf(kg, 2)} kg`] };
  });
  T("pet-synthesis", "u24", 3, 2, 120, (rng) => {
    const n = pick(rng, [100, 200, 500, 1000]), M = n * 192;
    return { text: `ポリエチレンテレフタラート（PET）の繰り返し単位 [[-CO-C6H4-COO-CH2CH2-O-]]（式量 192）をもつ重合体の、重合度が ${nf(n)} のとき、平均分子量はおよそいくらか。（末端は無視する）`, ans: M, unit: "", sig: 3, tol: { rel: 0.01 }, steps: [`平均分子量 = 繰り返し単位の式量 × 重合度`, `192 × ${nf(n)} = ${show(M, 3)}`] };
  });
  T("rubber-vulcanization", "u24", 3, 3, 130, (rng) => {
    const pct = pick(rng, [2.0, 4.0, 8.0, 3.2]), unit = 68;
    const nS = pct / 32 / ((100 - pct) / unit);
    return { text: `生ゴム（ポリイソプレン [[(C5H8)n]]、繰り返し単位の式量 68）に硫黄 S（原子量 32）を加えて加硫した。硫黄が質量で ${nf(pct, 1)} % ふくまれるゴムでは、イソプレン単位 1 個あたり硫黄原子は何個か。（イソプレン単位と硫黄以外の成分は考えない）`, ans: nS, unit: "個", sig: 2, tol: { rel: 0.03 }, steps: [`ゴム 100 g 中: 硫黄 ${nf(pct, 1)} g（${nf(pct / 32)} mol）、イソプレン単位 ${nf(100 - pct, 1)} g（${nf((100 - pct) / unit)} mol）`, `S 原子 / 単位 = ${nf(pct / 32)} ÷ ${nf((100 - pct) / unit)} = ${nf(nS)} 個`] };
  }, { xo: true });
  T("pva-saponification", "u24", 3, 2, 110, (rng) => {
    const kg = pick(rng, [86, 172, 43, 258]);
    return { text: `ポリ酢酸ビニル（繰り返し単位 [[-CH2-CH(OCOCH3)-]]、式量 86）${nf(kg)} kg を完全にけん化して、ポリビニルアルコール（繰り返し単位 [[-CH2-CH(OH)-]]、式量 44）にした。得られるポリビニルアルコールは理論上何 kg か。`, ans: kg * 44 / 86, unit: "kg", sig: 3, steps: [`繰り返し単位 1 個ごとに、${86} → ${44} に変わる`, `${nf(kg)} × 44/86 = ${nf(kg * 44 / 86)} kg`] };
  });

  /* ---------- 組み立て・採点 ---------- */
  /** テンプレートから問題をつくる。pub は端末へ、priv(答え・途中式)はサーバーだけ */
  function build(tpl, rng) {
    let g = tpl.gen(rng), tries = 0;
    while (g._ok === false && tries++ < 6) g = tpl.gen(rng);
    const sg = g.sig || 3;
    const tol = g.tol || { rel: sg >= 3 ? 0.01 : 0.02 };
    return {
      pub: { id: tpl.id, mode: "calc", u: tpl.u, lv: tpl.lv, ex: tpl.ex || 0, text: g.text, unit: g.unit || "", sig: sg, time: tpl.time || 90 },
      priv: { ans: g.ans, unit: g.unit || "", sig: sg, tol, steps: g.steps || [], ansText: show(g.ans, sg) + (g.unit ? " " + g.unit : "") }
    };
  }

  /** 入力した数のよみとり: 1.5 / −0.3 / 1.2e3 / 1.2×10^3 / 3/4。読めなければ null */
  function parse(text) {
    const s = String(text == null ? "" : text).normalize("NFKC").replace(/[−–—ー]/g, "-").replace(/[\s,]/g, "").replace(/\^/g, "^");
    if (!s) return null;
    let m = /^([+-]?\d*\.?\d+)[×x*]10\^?\(?([+-]?\d+)\)?$/i.exec(s);
    if (m) return Number(m[1] + "e" + m[2]);
    m = /^([+-]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
    if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
    m = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.exec(s);
    if (m) return Number(s);
    return null;
  }

  /** 答えが合っているか。許容: 絶対誤差 abs か、相対誤差 rel(途中で丸めた場合のずれ)。有効数字の桁数に丸めた値と同じでも正解 */
  function check(text, priv) {
    const v = parse(text);
    if (v == null || !Number.isFinite(v)) return false;
    const ans = priv.ans, t = priv.tol || {};
    if (t.abs != null) return Math.abs(v - ans) <= t.abs + 1e-12;
    if (sig(v, priv.sig || 3) === sig(ans, priv.sig || 3)) return true;
    return Math.abs(v - ans) <= Math.abs(ans) * (t.rel != null ? t.rel : 0.02) + 1e-12;
  }

  return { TEMPLATES, build, check, parse, mass, AM, show, nf, sig };
});
