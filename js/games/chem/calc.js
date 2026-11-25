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
