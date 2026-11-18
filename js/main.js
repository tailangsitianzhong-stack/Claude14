/**
 * 画面遷移とゲーム起動の土台
 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const screens = document.querySelectorAll(".screen");
  const SETTINGS_KEY = "minigames.settings";

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
    game.mount(root, { goHome, settings: loadSettings() });
  }

  function goHome() {
    if (currentGame && currentGame.unmount) currentGame.unmount();
    currentGame = null;
    $("#game-root").innerHTML = "";
    show("home");
  }

  /* ---------- 設定（localStorage） ---------- */
  function loadSettings() {
    try {
      return Object.assign({ sound: true }, JSON.parse(localStorage.getItem(SETTINGS_KEY)));
    } catch (_) {
      return { sound: true };
    }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {}
  }

  /* ---------- イベント ---------- */
  $("#btn-home").addEventListener("click", goHome);
  $("#btn-settings").addEventListener("click", () => show("settings"));
  document.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.goto))
  );

  const soundBox = $("#opt-sound");
  soundBox.checked = loadSettings().sound;
  soundBox.addEventListener("change", () => {
    saveSettings(Object.assign(loadSettings(), { sound: soundBox.checked }));
  });

  /* ---------- 起動 ---------- */
  renderGameList();
  show("home");
  Ruby.apply(document.body);   // index.html にある「漢字{よみ}」をふりがな付きにする
  // 友達のQRコード/リンク(?room=12345)から開いた時は、しりとりの部屋へ直接入る
  if (/[?&]room=\d{5}(?:&|$)/.test(location.search)) {
    startGame(/[?&]game=kanken(?:&|$)/.test(location.search) ? "kanken" : "shiritori");
  }
})();
