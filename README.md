# ミニゲームひろば

ミニゲームをたくさん遊べるWebゲームの土台です。ビルド不要（`index.html` をブラウザで開くだけ）。

## 構成
- `index.html` … ホーム / ゲーム / せってい画面と、黄色クレヨン風の背景(SVGフィルタ)
- `css/style.css` … 見た目
- `js/main.js` … 画面切り替え・ゲーム起動
- `js/games.js` … ゲーム登録リスト（ここに足すとホームにカードが増える）

## ゲームの追加方法
`js/games.js` の `window.GAMES` に `{ id, title, icon, desc, ready, mount(root), unmount() }` を追加します。
