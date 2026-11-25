/**
 * 画面遷移とゲーム起動の土台
 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const screens = document.querySelectorAll(".screen");

  let currentGame = null;

  /* ---------- 画面切り替え ---------- */
  function show(name) {
    screens.forEach((s) => { s.hidden = s.dataset.screen !== name; });
    window.scrollTo(0, 0);
  }

  /* ---------- ホームのゲーム一覧 ---------- */
  function renderGameList() {
    const list = $("#game-list");
    list.innerHTML = "";
    window.GAMES.forEach((g) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "game-card";
      card.setAttribute("role", "listitem");
      card.disabled = !g.ready;
      card.innerHTML = `
        <span class="badge">${g.ready ? "遊{あそ}べる！" : "もうすぐ"}</span>
        <span class="icon">${g.icon}</span>
        <span class="name">${g.title}</span>
        <span class="desc">${g.desc}</span>`;
      if (g.ready) card.addEventListener("click", () => startGame(g.id));
      list.appendChild(card);
    });
    Ruby.apply(list);
  }

  /* ---------- ゲーム起動・終了 ---------- */
  function startGame(id) {
    const game = window.GAMES.find((g) => g.id === id);
    if (!game || !game.ready) return;
    currentGame = game;
    $("#game-title").innerHTML = Ruby.html(game.title);
    const root = $("#game-root");
    root.innerHTML = "";
    show("game");
    game.mount(root, { goHome, settings: Sfx.get() });
  }

  function goHome() {
    if (currentGame && currentGame.unmount) currentGame.unmount();
    currentGame = null;
    $("#game-root").innerHTML = "";
    show("home");
  }

  /* ---------- スマホの「長押しメニュー」を出さない ----------
     ダブルタップ拡大の無効化と文字選択の無効化は CSS(css/style.css)。ここは長押しのメニューの保険。ピンチ拡大は残す */
  if (window.matchMedia && matchMedia("(pointer: coarse)").matches) {
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /* ---------- イベント ---------- */
  $("#btn-home").addEventListener("click", goHome);
  $("#btn-settings").addEventListener("click", () => show("settings"));
  { const v = $("#app-version"); if (v) v.textContent = "バージョン " + (window.APP_VERSION || "-"); }
  document.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.goto))
  );

  /* ---------- 設定: 音・音量・バイブ（保存は js/sfx.js） ---------- */
  const cur = Sfx.get();
  const soundBox = $("#opt-sound"), volume = $("#opt-volume"), vibe = $("#opt-vibe");
  soundBox.checked = cur.sound;
  volume.value = Math.round(cur.volume * 100);
  vibe.checked = cur.vibrate;
  soundBox.addEventListener("change", () => { Sfx.set({ sound: soundBox.checked }); Sfx.play("ok"); });
  volume.addEventListener("input", () => Sfx.set({ volume: volume.value / 100 }));
  volume.addEventListener("change", () => Sfx.play("ok"));
  vibe.addEventListener("change", () => { Sfx.set({ vibrate: vibe.checked }); Sfx.play("ng"); });
  $("#btn-test-sound").addEventListener("click", () => Sfx.play("win"));
  Sfx.attach(document);                                   // ボタンの音と、最初のタップでの音の準備

  /* ---------- 起動 ---------- */
  renderGameList();
  show("home");
  Ruby.apply(document.body);   // index.html にある「漢字{よみ}」をふりがな付きにする
  // 友達のQRコード/リンク(?room=12345&game=…)から開いた時は、そのゲームの部屋へ直接入る
  if (/[?&]room=\d{5}(?:&|$)/.test(location.search)) {
    const g = /[?&]game=(kanken|nep|geo|chem|duo)(?:&|$)/.exec(location.search);
    startGame(g ? g[1] : "shiritori");
  }
})();
