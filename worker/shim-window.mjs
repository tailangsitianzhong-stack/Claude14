// 出題データ(data/kanji.js)は、ブラウザ用に「window.KANKEN_DATA = …」と書かれている。
// Worker でも同じファイルをそのまま読めるよう、先に window を用意しておく。
globalThis.window = globalThis.window || globalThis;
