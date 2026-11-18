# data/

`words.js` は `tools/build-dict.mjs` が生成する辞書データです（直接編集しないでください）。

## 出典とライセンス
- **JMdict** © Electronic Dictionary Research and Development Group — [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html)。
  `words.js` はこのデータから派生したもので、同じく CC BY-SA 4.0 です（ゲーム内のクレジット表記が必要）。
- 英単語の使われやすさ（難易度・実在チェック）には SUBTLEX-US の頻度表
  （npm `subtlex-word-frequencies`）を使用しています。頻度表そのものは含めていません。
- 不適切語の除外に `@coffeeandfun/google-profanity-words` を使用しています。

## 再生成の手順
```sh
# 1) JMdict(SQLite版): PyPI の jamdict-data を展開して jamdict.db を取り出す
# 2) 頻度表と不適切語リスト: npm pack subtlex-word-frequencies @coffeeandfun/google-profanity-words
node tools/build-dict.mjs <jamdict.db> --freq <subtlex の index.json> \
     --profanity <google-profanity-words の data/en.txt> --out data/words.js --stats
```
手選びの「CPUが優先して出す語」は `tools/curated-words.txt` で編集します。

## words.js に入れる語の決まり（英単語しりとり）
- **名詞**だけ。日本語の読み(かな)と、英語(小文字1語)のペア。プレイヤーの答えは、**どのペアでも受け付けます**。CPUは手選び/日常語のペアしか使いません。
- **固有名詞**（国・都市・月・曜日・言語名など。JMdictでは `Paris` `India` と大文字で書かれている語）も入れます。ゲームでは小文字(`paris`)で受け付けます。
  人名などをCPUが勝手に出さないよう、CPU用の印が付くのは固有名詞ではない日常語と、手選びリスト(`tools/curated-words.txt`)の地名・曜日だけです。
- 日本語側に「使われやすさ」の印が無い語は、英語がとても有名な語(頻度3000位以内。固有名詞は25000位以内)だけ入れます。それ以外は Gemini が判定します。
- 注意タグ: 不適切(俗語・差別語・性的など)・古語・めずらしい語は除きます。くだけた語・子ども語・男女の言い方・略語・歴史用語は、答えとして有効なので受け付けます。
- 不適切語リストと、`nazi` `hitler` などは入れません。
- **入らない語**: 複数語の英語(`ice cream` `South Korea`)・ハイフンやアポストロフィを含む語・動詞や形容詞(名詞のみのルール)。

## kanji.js（ミニ漢字検定）
`tools/build-kanji.mjs` が JMdict と KANJIDIC2（どちらも © EDRDG, CC BY-SA 4.0）から生成する、漢字検定の出題データです。詳細は `docs/kanken.md`。

## 形式
`window.SHIRITORI_WORDS = { pairs: [[読み, 英語, レベル(1〜3), フラグ], ...] }`
フラグ: 1=主要訳 / 2=CPUが出してよい語 / 4=手選びの語
