/**
 * ゲーム登録リスト
 * 新しいミニゲームを追加するときは、ここに1件足して
 * mount(root) / unmount() を持つオブジェクトを書くだけ。
 *
 *   id        : 一意のID
 *   title     : 表示名
 *   icon      : カードの絵文字
 *   desc      : 一言説明
 *   ready     : false なら「準備中」でタップ不可
 *   title/desc: 漢字には「漢字{よみ}」と書くとふりがなが付く(js/ruby.js)
 *   mount(root, api) : ゲーム開始。root(DOM) の中に描画する
 *   unmount()        : ゲーム終了時の後始末（タイマー解除など）
 */
window.GAMES = [
  {
    id: "shiritori",
    title: "英単語{えいたんご}しりとり",
    icon: "🔤",
    desc: "最後{さいご}の文字{もじ}からつなげよう！",
    ready: true,
    mount(root) { window.ShiritoriGame.mount(root); },
    unmount() { window.ShiritoriGame.unmount(); }
  },
  {
    id: "kanken",
    title: "ミニ漢字検定{かんじけんてい}",
    icon: "📝",
    desc: "読{よ}みや漢字{かんじ}を答{こた}えてポイントをためよう！",
    ready: true,
    mount(root) { window.KankenGame.mount(root); },
    unmount() { window.KankenGame.unmount(); }
  },
  {
    id: "nep",
    title: "ミニネプリーグ（英語{えいご}）",
    icon: "💣",
    desc: "爆弾{ばくだん}をまわして英単語{えいたんご}を答{こた}えよう！",
    ready: true,
    mount(root) { window.NepGame.mount(root); },
    unmount() { window.NepGame.unmount(); }
  },
  {
    id: "coming-1",
    title: "次{つぎ}のゲーム",
    icon: "❓",
    desc: "準備中{じゅんびちゅう}…",
    ready: false
  }
];
