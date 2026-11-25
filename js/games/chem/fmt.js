/**
 * 化学式・単位の表示。問題文や選択肢に [[H2SO4]] [[Cu^2+]] [[SO4^2-]] [[CH3COOH]] のように書くと、
 * 添え字(下つき)・電荷(上つき)つきで表示する。[[ ]] の外は、ふつうの文字。
 *
 *   ChemFmt.html("[[H2SO4]]は強酸")  → "H<sub>2</sub>SO<sub>4</sub>は強酸"   (HTMLは安全にエスケープされる)
 *   ChemFmt.plain("[[H2SO4]]")       → "H2SO4"   (括弧を取った文字だけ。読みあげ・比較用)
 *   ChemFmt.normalize("H₂SO₄ ")      → "H2SO4"   (入力した式をそろえる: 下つき・全角・空白・中点を整理)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChemFmt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** [[ ]] で囲んだ化学式。中に [Cu(NH3)4] のような角かっこが 1 段あってもよい */
  const FORMULA_INNER = "(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*";
  const FORMULA_SPLIT = new RegExp("(\\[\\[" + FORMULA_INNER + "\\]\\])");
  const FORMULA_ONLY = new RegExp("^\\[\\[" + FORMULA_INNER + "\\]\\]$");
  const FORMULA_ALL = new RegExp("\\[\\[(" + FORMULA_INNER + ")\\]\\]", "g");

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SUB = "₀₁₂₃₄₅₆₇₈₉", SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";

  /** [[…]] の中身: 「^」のあとの 数字と+−(または +−だけ)を上つきに、そのほかの数字を下つきにする */
  function formula(s) {
    let out = "", i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "^") {                                          // ^2+ ^+ ^2- ^−
        const m = /^\^(\d*[+\-−]|\d+)/.exec(s.slice(i));
        if (m) { out += `<sup>${esc(m[1].replace(/-/g, "−"))}</sup>`; i += m[0].length; continue; }
      }
      if (/\d/.test(c) && i > 0 && /[A-Za-z)\]·]/.test(s[i - 1] === "}" ? "A" : s[i - 1]) || (/\d/.test(c) && /<\/sub>/.test(out.slice(-6)))) {
        let j = i; while (j < s.length && /\d/.test(s[j])) j++;
        out += `<sub>${s.slice(i, j)}</sub>`; i = j; continue;
      }
      out += esc(c); i++;
    }
    return out;
  }

  /** ふつうの文字: 「10^23」「10^−14」の指数を上つきにする */
  const plainHtml = (part) => esc(part).replace(/10\^(−|-)?(\d+)/g, (m, sg, d) => `10<sup>${sg ? "−" : ""}${d}</sup>`);
  function html(text) {
    return String(text == null ? "" : text).split(FORMULA_SPLIT).map((part) => (FORMULA_ONLY.test(part) ? `<span class="chem-f">${formula(part.slice(2, -2))}</span>` : plainHtml(part))).join("");
  }
  const plain = (text) => String(text == null ? "" : text).replace(FORMULA_ALL, "$1");

  /** 入力した式を比較用にそろえる(大文字小文字は、そのまま) */
  function normalize(s) {
    return String(s == null ? "" : s).normalize("NFKC")
      .replace(/[₀-₉]/g, (c) => String(SUB.indexOf(c))).replace(/[⁰-⁹]/g, (c) => String(SUP.indexOf(c)))
      .replace(/[−–—ー‐]/g, "-").replace(/[\s·・･.]/g, "");
  }

  return { html, plain, normalize, esc, FORMULA_SPLIT, FORMULA_ONLY };
});
