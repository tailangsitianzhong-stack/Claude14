/**
 * ゲーム登録リスト
 * 新しいミニゲームを追加するときは、ここに1件足して
 * mount(root) / unmount() を持つオブジェクトを書くだけ。
 *
 *   id        : 一意のID
 *   title     : 表示名
 *   icon      : カードの絵文字
 *   desc      : 一言説明
 *   ready     : false なら「じゅんびちゅう」でタップ不可
 *   mount(root, api) : ゲーム開始。root(DOM) の中に描画する
 *   unmount()        : ゲーム終了時の後始末（タイマー解除など）
 */
window.GAMES = [
  {
    id: "shiritori",
    title: "えいたんご しりとり",
    icon: "🔤",
    desc: "さいごの もじから つなげよう！",
    ready: true,
    mount(root) { window.ShiritoriGame.mount(root); },
    unmount() { window.ShiritoriGame.unmount(); }
  },
  {
    id: "coming-1",
    title: "つぎのゲーム",
    icon: "❓",
    desc: "じゅんびちゅう…",
    ready: false
  }
];
