/**
 * 演出（アニメーション）の小さな部品。動きを減らす設定(prefers-reduced-motion)の人には何もしない。
 *
 *   Fx.shake(el)            … ぶるっと揺らす（間違い）
 *   Fx.pop(el)              … ぽんっと弾ませる（正解）
 *   Fx.floatText(el, "+24") … el の近くに文字が浮かんで消える（得点）
 *   Fx.confetti()           … 紙吹雪（勝ち・合格）
 */
(function (root) {
  "use strict";

  const COLORS = ["#ef5b4c", "#4a90d9", "#5cb85c", "#ffd23f", "#ff8fb1", "#ffffff"];
  const reduced = () => {
    try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (_) { return false; }
  };

  /** class を付けて、アニメーションが終わったら外す（何度でも再生できる） */
  function run(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;                         // 再生しなおすための再描画
    el.classList.add(cls);
    el.addEventListener("animationend", function done(e) {
      if (e.target !== el) return;
      el.classList.remove(cls);
      el.removeEventListener("animationend", done);
    });
  }

  function floatText(anchor, text, cls) {
    if (!anchor || reduced()) return;
    const r = anchor.getBoundingClientRect();
    const s = document.createElement("span");
    s.className = "fx-float " + (cls || "");
    s.textContent = text;
    s.style.left = r.left + r.width / 2 + "px";
    s.style.top = r.top + "px";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }

  function confetti(count) {
    if (reduced()) return;
    const box = document.createElement("div");
    box.className = "fx-confetti";
    box.setAttribute("aria-hidden", "true");
    for (let i = 0; i < (count || 44); i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = COLORS[i % COLORS.length];
      p.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
      p.style.animationDelay = Math.random() * 0.6 + "s";
      p.style.setProperty("--drift", (Math.random() * 120 - 60) + "px");
      p.style.setProperty("--spin", (Math.random() * 720 - 360) + "deg");
      p.style.width = 7 + Math.random() * 7 + "px";
      p.style.height = 9 + Math.random() * 9 + "px";
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4200);
  }

  root.Fx = {
    shake: (el) => run(el, "fx-shake"),
    pop: (el) => run(el, "fx-pop"),
    pulse: (el) => run(el, "fx-pulse"),
    floatText, confetti
  };
})(window);
