/**
 * ふりがな(ルビ)つきの文字を作る小さな道具
 *
 * 文章には「漢字{よみ}」と書く。 例: "英語{えいご}で遊{あそ}ぼう" → 漢字の上に読みが付く
 * 送りがなは外に出す: "遊{あそ}び方{かた}"
 *
 *   Ruby.html("読{よ}み")        → 安全にエスケープ済みの HTML 文字列
 *   Ruby.apply(element)          → element の中の文字(テキスト)を、ふりがな付きに置き換える
 *
 * ユーザーが入力した文字は「{」を含まない(かな・英字のみ)ので、そのまま混ぜても安全。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Ruby = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PATTERN = /([一-龠々〆ヶ]+)\{([^{}]+)\}/g;
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  /** 先にHTMLをエスケープしてから、「漢字{よみ}」だけを <ruby> に変える */
  function html(text) {
    return String(text)
      .replace(/[&<>"']/g, (c) => ESC[c])
      .replace(PATTERN, "<ruby>$1<rt>$2</rt></ruby>");
  }

  /** 「漢字{よみ}」を含む文字を、ふりがな付きの要素に置き換える */
  function apply(el) {
    if (!el || typeof document === "undefined") return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const tag = n.parentNode && n.parentNode.nodeName;
        if (/^(SCRIPT|STYLE|RT|TEXTAREA)$/.test(tag)) return NodeFilter.FILTER_REJECT;
        return n.nodeValue.indexOf("{") >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const tmp = document.createElement("span");
      tmp.innerHTML = html(n.nodeValue);
      n.replaceWith(...tmp.childNodes);
    });
  }

  return { html, apply };
});
