# Pigeonhole

[日本語](#pigeonhole日本語)

Classify your notes with [Jev](https://docs.typesafe.ai) and file them into folders by attribute.

## Requirements

- Obsidian 1.13.0 or later
- A TypeSafe API key

## Install

Search for **Pigeonhole** in **Settings → Community plugins → Browse**, or open it in the [community plugin page](https://community.obsidian.md/plugins/pigeonhole). Install it and turn it on.

## Setup

1. Get an API key at [console.typesafe.ai/keys](https://console.typesafe.ai/keys).
2. Open **Settings → Pigeonhole**, and under **TypeSafe API key** choose the secret that holds the key. The key is kept in Obsidian's secret storage, not in the plugin settings.

That is the whole setup.

The folders already in your vault are the candidates, so a note about work goes to `work/`, and one about a project goes to `work/that-project/`.

A fresh install starts with three example attributes (`meeting`, `idea`, `reference`). Edit them, or delete them and let your own folders do the work.

Attributes are optional. Add one when you want to describe a category in your own words, or to file notes into a folder that does not exist yet. Press **Add attribute** at the bottom of the settings screen to add an entry to the list, then open it and fill in three fields:


| Field         | Meaning                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Name          | The attribute name, written to frontmatter. For example `meeting`.                                                            |
| Description   | What kind of note belongs here. This is what the model judges against, so write it specifically.                              |
| Target folder | Where notes with this attribute go, for example `Notes/Meetings`. Leave it empty to set the property without moving the file. |


An attribute takes precedence over a vault folder with the same path.

To sort more finely, open an attribute and press **Add sub-attribute**. Pigeonhole then asks twice: first which attribute the note matches, then which of that attribute's sub-attributes fits. A sub-attribute's target folder is relative to its parent's, so `review` under `game` means `game/review`. Leave it empty to use the parent's folder itself.

## Usage

Right-click a note or a folder in the file explorer and pick **Pigeonhole**, or run one of these from the command palette:


| Command                                    | What it does                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| Classify this note                         | Classifies the note you have open.                                                |
| Classify unclassified notes in this folder | Classifies unclassified notes in the current note's folder, including subfolders. |
| Classify unclassified notes in the vault   | Classifies every unclassified note in the vault.                                  |
| Show the last classification result | Opens the result of the last run. |
| Stop the running classification | Stops a bulk run after the current note. |


For each note, Pigeonhole picks one folder or attribute, writes it to frontmatter as `category: meeting`, and moves the file there. A nested destination is split across the two properties, so `work/beacon` is written as `category: work` and `subcategory: beacon`. Links to the note are updated by Obsidian, so nothing breaks. If a note with the same name is already in the target folder, a number is appended, the way Obsidian names new notes.

The two bulk commands ask for confirmation with the number of notes first. While they run, the notice has a **Stop** button. After a run, the result view has **Undo this run**, which moves the notes back and restores their frontmatter.

The note is left where it is when the model is unsure, or when none of your attributes fit. The reason is shown after the run. When only the sub-attribute is uncertain, the note is filed under its parent attribute. Notes that already have the property are treated as classified and are skipped by the two bulk commands, unless **Reclassify classified notes** is on.

## Settings


| Setting                                      | Default       |                                                                                                                                      |
| -------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| TypeSafe API key                             | `pigeonhole-api-key` | The secret that holds your API key.                                                                                           |
| Frontmatter property name                    | `category`    | The frontmatter key the attribute is written to.                                                                                     |
| Frontmatter property name for sub-attributes | `subcategory` | The key the sub-attribute is written to. Leave it empty to skip writing it.                                                          |
| Confidence threshold                         | 0.6           | Below this, the note is not moved. Raise it if notes end up in the wrong folder.                                                     |
| Excluded paths                               | (empty)       | One folder or note per line. Never used as a destination; notes under them are skipped by the bulk commands and by classify on save. |
| Characters of body text to send              | 4000          | How much of the note body is sent.                                                                                                   |
| Create the target folder if missing          | on            | When off, a note whose target folder does not exist is reported as an error instead of being moved.                                  |
| Classify on save                             | off           | Classifies a note 10 seconds after you stop editing it. The note you are currently looking at is never touched.                      |
| Reclassify classified notes | off | The bulk commands also process notes that already have the property, and move them if a better destination is found. Classify on save still handles only unclassified notes. |


## License

MIT

---

# Pigeonhole（日本語）

[English](#pigeonhole)

ノートを [Jev](https://docs.typesafe.ai) で分類し、属性ごとのフォルダへ振り分ける Obsidian プラグイン。

## 動作環境

- Obsidian 1.13.0 以降
- TypeSafe の API キー

## インストール

- [コミュニティプラグインのプロジェクトページ](https://community.obsidian.md/plugins/pigeonhole)からインストール

もしくは

- Obsidian の **設定 → コミュニティプラグイン → 閲覧** で「Pigeonhole」を検索する。

## 初期設定

1. [console.typesafe.ai/keys](https://console.typesafe.ai/keys) で API キーを取得する。
2. **設定 → Pigeonhole** を開き、**TypeSafe API キー** で API キーを保存したシークレットを選ぶ。キーはプラグイン設定ではなく Obsidian のシークレットストレージに保存される。

Vault にあるフォルダがそのまま候補になるので、仕事のノートは `work/` へ、特定案件のノートは `work/その案件/` へ入る。

初回は例として属性が3件（`meeting` / `idea` / `reference`）入っている。書き換えて使ってもいいし、消して既存フォルダに任せてもいい。

属性の登録は任意。自分の言葉で分類を説明したいとき、またはまだ存在しないフォルダへ振り分けたいときに使う。設定画面の下にある **属性を追加** を押すと一覧に項目が増えるので、開いて次の3つを入力する。


| 項目      | 意味                                              |
| ------- | ----------------------------------------------- |
| 属性名     | frontmatter に書き込まれる名前。例: `meeting`              |
| 説明      | どんなノートがここに該当するか。モデルはこの説明を手がかりに判断するので、具体的に書く。    |
| 移動先フォルダ | 振り分け先。例: `Notes/Meetings`。空にすると、移動せず属性の付与だけを行う。 |


同じパスの Vault フォルダと属性が重なった場合は、属性が優先される。

さらに細かく分けたい場合は、属性を開いて **子属性を追加** を押す。判定は2段階になり、まずどの属性に当たるかを選び、次にその属性の子属性のどれに当たるかを選ぶ。子属性の移動先は親からの相対パスで、`game` の下の `review` は `game/review` になる。空にすると親の移動先そのものを使う。

## 使い方

ファイルエクスプローラーでノートやフォルダを右クリックして **Pigeonhole** を選ぶか、コマンドパレットから次のいずれかを実行する。


| コマンド               | 動作                            |
| ------------------ | ----------------------------- |
| このノートを分類           | 開いているノートを分類する。                |
| このフォルダの未分類ノートを分類   | 現在のノートがあるフォルダを、サブフォルダ込みで分類する。 |
| Vault 全体の未分類ノートを分類 | Vault 内の未分類ノートをすべて分類する。       |
| 最後の分類結果を表示 | 直前の実行結果を開く。 |
| 実行中の分類を中止 | 一括処理を、いま処理中のノートの後で止める。 |


各ノートについてフォルダまたは属性を1つ選び、frontmatter に `category: meeting` のように書き込んでから、そこへ移動する。階層のある移動先は2つのプロパティに分けて書かれる。`work/beacon` なら `category: work` と `subcategory: beacon` になる。ノートへのリンクは Obsidian が追従するので壊れない。移動先に同名のノートがある場合は、Obsidian と同じように連番が付く。

一括コマンドは、実行前に対象の件数を示して確認する。実行中の通知には **中止** ボタンがある。実行後の結果画面にある **この実行を元に戻す** を押すと、ノートを元の場所に戻し、frontmatter も元に戻す。

モデルが判断に迷った場合や、どの属性にも当てはまらない場合、ノートは動かさない。理由は実行後に表示される。子属性の判定だけが不確かなときは、親の属性として振り分ける。すでに属性が入っているノートは分類済みとみなし、一括コマンドの対象から外れる。**分類済みのノートも再分類** を ON にすると対象に含まれる。

## 設定


| 設定                     | 既定値           |                                                 |
| ---------------------- | ------------- | ----------------------------------------------- |
| TypeSafe API キー        | `pigeonhole-api-key` | API キーを保存したシークレット。                         |
| frontmatter プロパティ名     | `category`    | 属性を書き込む frontmatter のキー。                        |
| frontmatter サブ属性プロパティ名 | `subcategory` | 子属性を書き込むキー。空にすると書き込まない。                         |
| confidence の下限         | 0.6           | これを下回ると移動しない。誤った振り分けが多いときは上げる。                  |
| 除外パス                   | （空）           | 1行に1つ。移動先の候補から外れ、配下のノートは一括コマンドと保存時の自動分類の対象外になる。 |
| 送信する本文の文字数上限           | 4000          | 本文を何文字まで送るか。                                    |
| 移動先フォルダが無ければ作成         | ON            | OFF のとき、移動先フォルダが存在しないノートは移動せずエラーとして報告される。       |
| 保存時に自動分類               | OFF           | 編集をやめてから10秒後に分類する。いま開いているノートは対象外。               |
| 分類済みのノートも再分類 | OFF | 一括コマンドが属性の入ったノートも分類し直し、より適した移動先があれば移動する。保存時の自動分類は未分類のノートだけが対象のまま。 |


## ライセンス

MIT