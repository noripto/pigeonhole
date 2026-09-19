# Pigeonhole

Classify your notes with [Jev](https://docs.typesafe.ai) and file them into folders by attribute.

## Requirements

- Obsidian 1.8.7 or later
- A TypeSafe API key

## Install

## Setup

1. Get an API key at [console.typesafe.ai/keys](https://console.typesafe.ai/keys).
2. Open **Settings → Pigeonhole** and paste it into **TypeSafe API key**.
3. At the bottom of the same screen, press **Add attribute**. Each attribute takes three fields:

| Field | Meaning                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Name          | The attribute name, written to frontmatter. For example `meeting`.                                                            |
| Description   | What kind of note belongs here. This is what the model judges against, so write it specifically.                              |
| Target folder | Where notes with this attribute go, for example `Notes/Meetings`. Leave it empty to set the property without moving the file. |

Add as many attributes as you need. Two or three is enough to start.

To sort more finely, press the **+** button on an attribute to give it sub-attributes. Pigeonhole then asks twice: first which attribute the note matches, then which of that attribute's sub-attributes fits. A sub-attribute with an empty target folder uses its parent's folder.

## Usage

Run one of these from the command palette:

| Command                                    | What it does                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| Classify this note                         | Classifies the note you have open.                                                |
| Classify unclassified notes in this folder | Classifies unclassified notes in the current note's folder, including subfolders. |
| Classify unclassified notes in the vault   | Classifies every unclassified note in the vault.                                  |

For each note, Pigeonhole picks one attribute, writes it to frontmatter as `category: meeting`, and moves the file into that attribute's folder. If the attribute has sub-attributes, the chosen one is written as `subcategory: retro` and its folder is used instead. Links to the note are updated by Obsidian, so nothing breaks.

The note is left where it is when the model is unsure, or when none of your attributes fit. A notice tells you why. When only the sub-attribute is uncertain, the note is filed under its parent attribute. Notes that already have the property are treated as classified and are skipped by the two bulk commands.

## Settings

| Setting                                      | Default       |                                                                                                                 |
| -------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| TypeSafe API key                             | (empty)       | Your API key.                                                                                                   |
| Frontmatter property name                    | `category`    | The frontmatter key the attribute is written to.                                                                |
| Frontmatter property name for sub-attributes | `subcategory` | The key the sub-attribute is written to. Leave it empty to skip writing it.                                     |
| Confidence threshold                         | 0.6           | Below this, the note is not moved. Raise it if notes end up in the wrong folder.                                |
| Characters of body text to send              | 4000          | How much of the note body is sent.                                                                              |
| Create the target folder if missing          | off           | When off, a note whose target folder does not exist is reported as an error instead of being moved.             |
| Classify on save                             | off           | Classifies a note 10 seconds after you stop editing it. The note you are currently looking at is never touched. |

## Notes

- The interface is in English or Japanese, following Obsidian's language setting.
- The title and the first 4000 characters of each note are sent to the TypeSafe API.
- Your API key is stored as plain text in this plugin's `data.json`. Keep that in mind if you sync or share your vault.

## License

MIT

---

# Pigeonhole（日本語）

ノートを [Jev](https://docs.typesafe.ai) で分類し、属性ごとのフォルダへ振り分ける Obsidian プラグイン。

## 動作環境

- Obsidian 1.8.7 以降
- TypeSafe の API キー

## インストール

## 初期設定

1. [console.typesafe.ai/keys](https://console.typesafe.ai/keys) で API キーを取得する。
2. **設定 → Pigeonhole** を開き、**TypeSafe API キー** に貼り付ける。
3. 同じ画面の下にある **属性を追加** を押して属性を登録する。1件につき3つの項目がある。

| 項目           | 意味                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| 属性名         | frontmatter に書き込まれる名前。例: `meeting`                                            |
| 説明           | どんなノートがここに該当するか。モデルはこの説明を手がかりに判断するので、具体的に書く。 |
| 移動先フォルダ | 振り分け先。例: `Notes/Meetings`。空にすると、移動せず属性の付与だけを行う。             |

属性はいくつでも登録できる。まずは2〜3件あれば足りる。

さらに細かく分けたい場合は、属性の行にある **+** ボタンで子属性を追加する。判定は2段階になり、まずどの属性に当たるかを選び、次にその属性の子属性のどれに当たるかを選ぶ。子属性の移動先が空のときは親の移動先を使う。

## 使い方

コマンドパレットから次のいずれかを実行する。

| コマンド                         | 動作                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| このノートを分類                 | 開いているノートを分類する。                               |
| このフォルダの未分類ノートを分類 | 現在のノートがあるフォルダを、サブフォルダ込みで分類する。 |
| Vault 全体の未分類ノートを分類   | Vault 内の未分類ノートをすべて分類する。                   |

各ノートについて属性を1つ選び、frontmatter に `category: meeting` のように書き込んでから、その属性のフォルダへ移動する。子属性がある場合は `subcategory: retro` も書き込み、移動先は子属性のフォルダになる。ノートへのリンクは Obsidian が追従するので壊れない。

モデルが判断に迷った場合や、どの属性にも当てはまらない場合、ノートは動かさない。理由は通知に表示される。子属性の判定だけが不確かなときは、親の属性として振り分ける。すでに属性が入っているノートは分類済みとみなし、一括コマンドの対象から外れる。

## 設定

| 設定                             | 既定値        |                                                                                |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| TypeSafe API キー                | （空）        | API キー。                                                                     |
| frontmatter プロパティ名         | `category`    | 属性を書き込む frontmatter のキー。                                            |
| frontmatter サブ属性プロパティ名 | `subcategory` | 子属性を書き込むキー。空にすると書き込まない。                                 |
| confidence の下限                | 0.6           | これを下回ると移動しない。誤った振り分けが多いときは上げる。                   |
| 送信する本文の文字数上限         | 4000          | 本文を何文字まで送るか。                                                       |
| 移動先フォルダが無ければ作成     | OFF           | OFF のとき、移動先フォルダが存在しないノートは移動せずエラーとして報告される。 |
| 保存時に自動分類                 | OFF           | 編集をやめてから10秒後に分類する。いま開いているノートは対象外。               |

## 注意

- 表示言語は Obsidian の言語設定に従って日本語と英語が切り替わる。
- ノートのタイトルと本文の先頭4000文字が TypeSafe の API に送信される。
- API キーはこのプラグインの `data.json` に平文で保存される。Vault を同期・共有している場合は注意すること。

## ライセンス

MIT
