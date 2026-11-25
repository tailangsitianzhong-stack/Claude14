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

## nep.js（ミニネプリーグ）
`tools/build-nep.mjs` が生成します（直接編集しないでください。お題の元は `tools/nep-source/`）。
- 単語リストは SUBTLEX-US の頻度表の上位30,000語（小文字の原形のみ）。変化形・短縮形のかけら・略語・不適切語は除いています。頻度表そのものは含めていません。
- カテゴリ・穴うめ・慣用句・反対語・過去形は手作りです。「日本語→英語」のお題は `words.js` の子ども向けの語で、漢字の表記は JMdict から引いています（どちらも JMdict 由来・CC BY-SA 4.0）。
- 詳しくは `docs/nep.md`。

## geo-map.js / geo.js / assets/geo（地理クイズ）
`tools/build-geo-map.mjs` と `tools/build-geo.mjs` が生成します（直接編集しないでください。元は `tools/geo-source/`）。
- 地図の図形: Natural Earth（パブリックドメイン）。world-atlas（ISC）経由の世界の国と、admin-1 の日本の都道府県。
- 国の隣接・面積・位置: world-countries（ODbL。出典表記が必要です。ゲーム内の「出典・クレジット」に載せています）。
- 国の統計（人口構成・人口密度・都市人口率・1人あたり国民総所得・平均寿命など）: World Bank Open Data（CC BY 4.0）。
- 雨温図の気温・降水量: 各都市の観測の平年値（気象庁・各国の気象機関。英語版Wikipediaの気候表、CC BY-SA）。取れなかった4都市は NASA POWER の気候値（約50km四方の平均）を補正して使っています。
- 写真: Wikimedia Commons（パブリックドメイン・CC0・CC BY・CC BY-SA）。写真ごとの作者・ライセンス・元ページは `geo.js` の `photos[].credit` にあり、ゲーム内に表示します。
- 問題数: 早押し約630・地図約720・資料選択約1260（現地写真約250問を含む）（レベル1〜3がほぼ均等）。有名さの段階は `tools/geo-source/fame.txt`。
- 大学入試の問題: 早押し261・地図268・資料選択884（`ex`=1〜3）。手書きの元は `tools/geo-source/exam-*.txt`。
- 詳しくは `docs/geo.md`。

## chem.js（化学クイズ）
`tools/build-chem.mjs` が生成します（直接編集しないでください。元は `tools/chem-source/`）。
- すべて**オリジナルの問題**です（過去問・教科書の文章は使っていません）。グラフ・構造式・周期表は、`js/games/chem/draw.js` が描く自前のSVGで、外部の画像やデータは使っていません。溶解度などの値は、理科年表などにある代表的な値（g/100 g 水）です。原子量は4桁の概数です。
- 問題数: 早押し691・資料選択605（図の問題61）。計算は `js/games/chem/calc.js` の128テンプレート（数字を毎回変えて出す）。
- 大学入試の問題: `ex`（1=基礎 / 2=標準 / 3=発展）。大学入試だけの問題は `xo`。
- 詳しくは `docs/chem.md`。

## kanji.js（ミニ漢字検定）
`tools/build-kanji.mjs` が JMdict と KANJIDIC2（どちらも © EDRDG, CC BY-SA 4.0）から生成する、漢字検定の出題データです。詳細は `docs/kanken.md`。

## 形式
`window.SHIRITORI_WORDS = { pairs: [[読み, 英語, レベル(1〜3), フラグ], ...] }`
フラグ: 1=主要訳 / 2=CPUが出してよい語 / 4=手選びの語
