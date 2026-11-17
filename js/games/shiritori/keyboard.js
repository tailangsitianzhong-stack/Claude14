/**
 * 専用キーボード（かな50音 / 英語ABC・QWERTY）
 * 本物の <input> を使わないので、スマホの標準キーボード・変換候補・
 * スペルチェック・貼り付けは一切出ない。
 *
 *   const kb = ShiritoriKeyboard.create(rootEl, { onAction });
 *   kb.setMode("kana" | "en");
 *   kb.destroy();
 *
 * onAction には ShiritoriInput.applyAction 用の action と
 * {type:'submit'} が渡される。
 */
(function (root) {
  "use strict";

  // 表示は左から わ行…あ行（右端が あ行）。縦に あ・い・う・え・お の段
  const KANA_COLUMNS = [
    ["わ", "ん", "ー", "", ""],
    "らりるれろ".split(""),
    ["や", "", "ゆ", "", "よ"],
    "まみむめも".split(""),
    "はひふへほ".split(""),
    "なにぬねの".split(""),
    "たちつてと".split(""),
    "さしすせそ".split(""),
    "かきくけこ".split(""),
    "あいうえお".split("")
  ];

  const EN_LAYOUTS = {
    abc: ["abcdefghi", "jklmnopqr", "stuvwxyz"],
    qwerty: ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
  };

  // フリックキー: [タップ(あ段), 左(い段), 上(う段), 右(え段), 下(お段)]。null はその向きが無い
  const FLICK_KEYS = {
    "あ": ["あ", "い", "う", "え", "お"], "か": ["か", "き", "く", "け", "こ"], "さ": ["さ", "し", "す", "せ", "そ"],
    "た": ["た", "ち", "つ", "て", "と"], "な": ["な", "に", "ぬ", "ね", "の"], "は": ["は", "ひ", "ふ", "へ", "ほ"],
    "ま": ["ま", "み", "む", "め", "も"], "や": ["や", null, "ゆ", null, "よ"], "ら": ["ら", "り", "る", "れ", "ろ"],
    "わ": ["わ", "を", "ん", "ー", null]
  };
  const FLICK_ROWS = [["あ", "か", "さ"], ["た", "な", "は"], ["ま", "や", "ら"]];
  const FLICK_THRESHOLD = 16; // px。これ以上動いたらフリックとみなす
  const KANA_METHODS = [["romaji", "ローマ字{じ}"], ["flick", "フリック"], ["grid", "50音{おん}"]];

  const LAYOUT_KEY = "minigames.shiritori.enLayout";
  const METHOD_KEY = "minigames.shiritori.kanaMethod";

  function loadLayout() {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      return v === "qwerty" ? "qwerty" : "abc";
    } catch (_) { return "abc"; }
  }
  function saveLayout(v) {
    try { localStorage.setItem(LAYOUT_KEY, v); } catch (_) {}
  }

  function loadMethod() {
    try {
      const v = localStorage.getItem(METHOD_KEY);
      return KANA_METHODS.some((m) => m[0] === v) ? v : "romaji";
    } catch (_) { return "romaji"; }
  }
  function saveMethod(v) {
    try { localStorage.setItem(METHOD_KEY, v); } catch (_) {}
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function create(rootEl, handlers) {
    const onAction = handlers.onAction;
    let mode = "kana";
    let enLayout = loadLayout();
    let kanaMethod = loadMethod();

    const wrap = el("div", "kb");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "専用キーボード");
    // 長押しメニュー・選択・ダブルタップ拡大を止める
    wrap.addEventListener("contextmenu", (e) => e.preventDefault());
    wrap.addEventListener("dblclick", (e) => e.preventDefault());
    rootEl.appendChild(wrap);

    /** ボタン生成。pointerdown で即反応、キーボード操作(Enter/Space)は click で拾う */
    function button(label, cls, run, aria) {
      const b = el("button", "kb-key " + (cls || ""), label);
      if (label.indexOf("{") >= 0) b.innerHTML = root.Ruby.html(label);   // 「消{け}す」→ ふりがな付き
      b.type = "button";
      if (aria) b.setAttribute("aria-label", aria);
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();               // フォーカス移動・拡大・選択を防ぐ
        run();
      });
      b.addEventListener("click", (e) => {
        if (e.detail === 0) run();        // キーボードからの操作
      });
      return b;
    }
    function key(label, cls, action, aria) {
      return button(label, cls, () => onAction(action), aria);
    }

    function controls(extra) {
      const row = el("div", "kb-controls");
      (extra || []).forEach((k) => row.appendChild(k));
      row.appendChild(key("⌫ 消{け}す", "kb-wide kb-del", { type: "backspace" }, "ひとつ消す"));
      row.appendChild(key("決定{けってい}", "kb-wide kb-enter", { type: "submit" }, "決定"));
      return row;
    }

    /** かな入力の方式タブ（ローマ字 / フリック / 50おん） */
    function methodTabs() {
      const row = el("div", "kb-tabs");
      row.setAttribute("role", "tablist");
      KANA_METHODS.forEach(([id, label]) => {
        const b = button(label, "kb-tab" + (id === kanaMethod ? " is-on" : ""), () => {
          kanaMethod = id;
          saveMethod(id);
          render();
        });
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(id === kanaMethod));
        row.appendChild(b);
      });
      return row;
    }

    function renderKana() {
      wrap.appendChild(methodTabs());
      if (kanaMethod === "flick") return renderFlick();
      if (kanaMethod === "romaji") return renderRomaji();
      return renderKanaGrid();
    }

    /** 50音の表（右端があ行） */
    function renderKanaGrid() {
      const grid = el("div", "kb-kana");
      for (let r = 0; r < 5; r++) {
        KANA_COLUMNS.forEach((col) => {
          const ch = col[r];
          grid.appendChild(
            ch ? key(ch, "", { type: "char", value: ch }) : el("span", "kb-gap")
          );
        });
      }
      wrap.appendChild(grid);
      wrap.appendChild(controls([
        key("゛", "kb-mod", { type: "dakuten" }, "濁点"),
        key("゜", "kb-mod", { type: "handakuten" }, "半濁点"),
        key("小", "kb-mod", { type: "small" }, "小さい字")
      ]));
    }

    /** ローマ字打ち: アルファベットを打つとかなになる（k+a→か） */
    function renderRomaji() {
      const box = el("div", "kb-en kb-romaji");
      EN_LAYOUTS.qwerty.forEach((letters) => {
        const row = el("div", "kb-row");
        letters.split("").forEach((c) => {
          row.appendChild(key(c.toUpperCase(), "", { type: "romaji", value: c }, c));
        });
        box.appendChild(row);
      });
      wrap.appendChild(box);
      wrap.appendChild(controls([key("ー", "kb-mod", { type: "romaji", value: "-" }, "長音")]));
    }

    /** フリック入力: タップで あ段、上下左右にスライドで い・う・え・お段 */
    function renderFlick() {
      const grid = el("div", "kb-flick");

      FLICK_ROWS.forEach((row, ri) => {
        row.forEach((k) => grid.appendChild(flickKey(k)));
        if (ri === 0) grid.appendChild(key("⌫", "kb-flick-ctl kb-del", { type: "backspace" }, "ひとつ消す"));
        if (ri === 1) grid.appendChild(key("決定{けってい}", "kb-flick-ctl kb-enter kb-tall", { type: "submit" }, "決定"));
      });
      grid.appendChild(key("゛゜小", "kb-mod kb-cycle", { type: "cycle" }, "濁点・半濁点・小さい字"));
      grid.appendChild(flickKey("わ"));
      grid.appendChild(key("ん", "", { type: "char", value: "ん" }));
      grid.appendChild(key("ー", "kb-flick-ctl", { type: "char", value: "ー" }, "長音"));
      wrap.appendChild(grid);
    }

    /** 1つのフリックキー（押すと十字の候補が出る） */
    function flickKey(label) {
      const chars = FLICK_KEYS[label];
      const b = el("button", "kb-key kb-flick-key", null);
      b.type = "button";
      b.setAttribute("aria-label", chars.filter(Boolean).join("・"));
      b.appendChild(el("span", "kb-flick-main", label));
      // 方向のヒント（ちいさく表示）: 左・上・右・下
      ["l", "u", "r", "d"].forEach((pos, i) => {
        if (chars[i + 1]) b.appendChild(el("span", "kb-hint kb-hint-" + pos, chars[i + 1]));
      });

      let start = null, popup = null, cells = null, chosen = 0;

      function direction(dx, dy) {
        if (Math.hypot(dx, dy) < FLICK_THRESHOLD) return 0;
        const d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 3) : (dy < 0 ? 2 : 4);
        return chars[d] ? d : 0;                 // その向きに字が無ければ、まん中(タップ)扱い
      }
      function highlight(idx) {
        chosen = idx;
        if (cells) cells.forEach((c, i) => c && c.classList.toggle("is-on", i === idx));
      }
      function showPopup() {
        const r = b.getBoundingClientRect();
        const w = r.width, h = r.height;
        popup = el("div", "kb-flick-pop");
        // 画面の左右にはみ出さないように、十字の中心を内側へ寄せる
        const cx = Math.min(Math.max(r.left + w / 2, w * 1.5 + 4), window.innerWidth - w * 1.5 - 4);
        const cy = Math.max(r.top + h / 2, h * 1.5 + 4);
        popup.style.cssText = `left:${cx}px;top:${cy}px;--w:${w}px;--h:${h}px`;
        const pos = ["c", "l", "u", "r", "d"];
        cells = chars.map((ch, i) => {
          if (!ch) return null;
          const c = el("div", "kb-flick-cell kb-flick-" + pos[i], ch);
          popup.appendChild(c);
          return c;
        });
        wrap.appendChild(popup);
        highlight(0);
      }
      function hidePopup() {
        if (popup) popup.remove();
        popup = cells = null;
      }

      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (_) {}
        start = { x: e.clientX, y: e.clientY };
        showPopup();
      });
      b.addEventListener("pointermove", (e) => {
        if (!start) return;
        highlight(direction(e.clientX - start.x, e.clientY - start.y));
      });
      b.addEventListener("pointerup", (e) => {
        if (!start) return;
        const idx = direction(e.clientX - start.x, e.clientY - start.y);
        start = null;
        hidePopup();
        onAction({ type: "char", value: chars[idx] });
      });
      b.addEventListener("pointercancel", () => { start = null; hidePopup(); });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        if (e.detail === 0) onAction({ type: "char", value: chars[0] }); // キーボード(Enter/Space)からはタップ扱い
      });
      return b;
    }

    function renderEn() {
      const box = el("div", "kb-en");
      EN_LAYOUTS[enLayout].forEach((letters) => {
        const row = el("div", "kb-row");
        letters.split("").forEach((c) => {
          row.appendChild(key(c.toUpperCase(), "", { type: "char", value: c }, c));
        });
        box.appendChild(row);
      });
      wrap.appendChild(box);

      const toggle = button(
        enLayout === "abc" ? "QWERTYにする" : "ABC順{じゅん}にする",
        "kb-mod kb-layout",
        () => {
          enLayout = enLayout === "abc" ? "qwerty" : "abc";
          saveLayout(enLayout);
          render();
        }
      );
      wrap.appendChild(controls([toggle]));
    }

    function render() {
      wrap.innerHTML = "";
      wrap.dataset.mode = mode;
      if (mode === "kana") renderKana(); else renderEn();
    }

    render();

    return {
      setMode(m) { if (m !== mode) { mode = m; render(); } },
      getMode() { return mode; },
      getKanaMethod() { return kanaMethod; },
      destroy() { wrap.remove(); }
    };
  }

  /**
   * パソコンの物理キーボード対応（英語モードは英字のみ、かなモードは操作キーのみ）
   * 戻り値の関数を呼ぶと解除される。
   */
  function attachPhysicalKeys(getMode, onAction, getKanaMethod) {
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "Backspace") { e.preventDefault(); onAction({ type: "backspace" }); }
      else if (e.key === "Enter") {
        if (e.target && e.target.tagName === "BUTTON") return; // ボタン操作はそちらで処理
        e.preventDefault(); onAction({ type: "submit" });
      }
      else if (getMode() === "en" && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        onAction({ type: "char", value: e.key.toLowerCase() });
      }
      else if (getMode() === "kana" && getKanaMethod && getKanaMethod() === "romaji" && /^[a-zA-Z-]$/.test(e.key)) {
        e.preventDefault();                         // ローマ字方式なら物理キーでも k+a → か
        onAction({ type: "romaji", value: e.key.toLowerCase() });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }

  root.ShiritoriKeyboard = { create, attachPhysicalKeys };
})(window);
