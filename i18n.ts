import { getLanguage } from "obsidian";
import type { SkipReason } from "./classify.ts";

const en = {
  cmdNote: "Classify this note",
  cmdFolder: "Classify unclassified notes in this folder",
  cmdVault: "Classify unclassified notes in the vault",
  cmdResult: "Show the last classification result",
  cmdStop: "Stop the running classification",

  resultTitle: "Classification result",
  resultEmpty: "Nothing has been classified yet.",
  resultMoved: "Moved",
  resultTagged: "Tagged only",
  resultSkipped: "Skipped",
  resultFailed: "Failed",
  colNote: "Note",
  colFrom: "From",
  colDestination: "To",
  colCategory: "Attribute",
  colReason: "Reason",
  colError: "Error",

  needMarkdown: "Open a Markdown note first",
  noFolder: "No target folder. Open a note first",
  noApiKey: "Set your API key in the settings",
  noCategories: "No folders in the vault and no attributes in the settings",
  nothingToDo: "No unclassified notes to process",
  working: "Classifying...",
  stop: "Stop",
  busy: "A classification is already running",
  confirmBody: (n: number) =>
    `Classify ${n} notes? Notes may be moved and their frontmatter rewritten. You can undo from the result view.`,
  confirmRun: "Classify",
  undo: "Undo this run",
  undone: (restored: number, total: number) => `Undid ${restored} of ${total} notes`,
  notMoved: (reason: string) => `Not moved - ${reason}`,
  summary: (moved: number, skipped: number, failed: number) =>
    `moved ${moved} / skipped ${skipped} / failed ${failed}`,

  errMissingFolder: (folder: string) =>
    `The folder ${folder} does not exist (automatic creation can be enabled in the settings)`,
  errNotJson: "The API response was not JSON",

  skip: (r: SkipReason) => {
    switch (r.code) {
      case "badResponse":
        return "Unexpected API response (no choice)";
      case "noMatch":
        return "None of your attributes fit this note";
      case "lowConfidence":
        return `confidence ${r.confidence.toFixed(2)} < ${r.threshold} (${r.top})`;
      case "unknownLabel":
        return `Unknown attribute: ${r.label}`;
    }
  },

  setApiKey: "TypeSafe API key",
  setApiKeyDesc: "You need to get a Jev API key.",
  setProperty: "Frontmatter property name",
  setSubProperty: "Frontmatter property name for sub-attributes",
  setThreshold: "Confidence threshold",
  setThresholdDesc: "Below this, the note is not moved.",
  setExclude: "Excluded paths",
  setExcludeDesc:
    "One folder or note per line. They are never used as a destination, and notes under them are left alone by the bulk commands and by classify on save.",
  phExclude: "templates\narchive/2024",
  setMaxChars: "Characters of body text to send",
  setCreateFolder: "Create the target folder if missing",
  setCreateFolderDesc:
    "When off, a note whose target folder does not exist is reported as an error instead of being moved.",
  setAutoOnSave: "Classify on save",
  setAutoOnSaveDesc:
    "Classifies a note 10 seconds after you stop editing it. The note you are looking at is left alone.",
  setReclassify: "Reclassify classified notes",
  setReclassifyDesc:
    "When on, the bulk commands also process notes that already have the property, and move them if a better destination is found. Classify on save still handles only unclassified notes.",

  attributes: "Attributes",
  attributesHint:
    "The folders already in your vault are always candidates, so this list is optional. Add an attribute when you want to describe it in your own words, or to file notes into a folder that does not exist yet. The description is what the model judges against. Leave the folder empty to set the property without moving the file. Give an attribute sub-attributes to classify in two steps; a sub-attribute's folder is relative to its parent's, and an empty one means the parent's folder itself.",
  phName: "Name",
  phDesc: "Description (what kind of note)",
  phFolder: "Target folder",
  addAttribute: "Add attribute",
  addChild: "Add sub-attribute",
  attributesEmpty: "No attributes. The folders in your vault are used as they are.",
  defaultsAdded: "Added three example attributes. Edit or delete them in the settings.",
  children: "Sub-attributes",
  childrenEmpty: "No sub-attributes.",
  unnamed: "(unnamed)",
  remove: "Remove",
};

const ja: typeof en = {
  cmdNote: "このノートを分類",
  cmdFolder: "このフォルダの未分類ノートを分類",
  cmdVault: "Vault 全体の未分類ノートを分類",
  cmdResult: "最後の分類結果を表示",
  cmdStop: "実行中の分類を中止",

  resultTitle: "分類結果",
  resultEmpty: "まだ何も分類していません。",
  resultMoved: "移動",
  resultTagged: "属性のみ付与",
  resultSkipped: "見送り",
  resultFailed: "失敗",
  colNote: "ノート",
  colFrom: "移動元",
  colDestination: "移動先",
  colCategory: "属性",
  colReason: "理由",
  colError: "エラー",

  needMarkdown: "Markdown ファイルを開いてから実行してください",
  noFolder: "対象フォルダが分かりません。ノートを開いてから実行してください",
  noApiKey: "設定で API キーを入力してください",
  noCategories: "Vault にフォルダが無く、設定にも属性がありません",
  nothingToDo: "対象の未分類ノートがありません",
  working: "分類中…",
  stop: "中止",
  busy: "別の分類を実行中です",
  confirmBody: (n: number) =>
    `${n} 件のノートを分類します。ノートの移動と frontmatter の書き換えが起きます。結果画面から元に戻せます。`,
  confirmRun: "分類する",
  undo: "この実行を元に戻す",
  undone: (restored: number, total: number) => `${total} 件中 ${restored} 件を元に戻しました`,
  notMoved: (reason: string) => `移動しませんでした — ${reason}`,
  summary: (moved: number, skipped: number, failed: number) =>
    `移動 ${moved} / 見送り ${skipped} / 失敗 ${failed}`,

  errMissingFolder: (folder: string) =>
    `フォルダ ${folder} がありません（設定で自動作成を有効にできます）`,
  errNotJson: "API レスポンスが JSON ではありません",

  skip: (r: SkipReason) => {
    switch (r.code) {
      case "badResponse":
        return "予期しない API レスポンス（choice が無い）";
      case "noMatch":
        return "どの属性にも当てはまらないと判定された";
      case "lowConfidence":
        return `confidence ${r.confidence.toFixed(2)} < ${r.threshold}（${r.top}）`;
      case "unknownLabel":
        return `未知の属性名: ${r.label}`;
    }
  },

  setApiKey: "TypeSafe API キー",
  setApiKeyDesc: "Jev の API キーを取得する必要があります。",
  setProperty: "frontmatter プロパティ名",
  setSubProperty: "frontmatter サブ属性プロパティ名",
  setThreshold: "confidence の下限",
  setThresholdDesc: "これを下回ったらファイルを動かしません。",
  setExclude: "除外パス",
  setExcludeDesc:
    "1行に1つ、フォルダかノートを書きます。移動先の候補から外れ、配下のノートは一括コマンドと保存時の自動分類の対象外になります。",
  phExclude: "templates\narchive/2024",
  setMaxChars: "送信する本文の文字数上限",
  setCreateFolder: "移動先フォルダが無ければ作成",
  setCreateFolderDesc: "OFF のときは、フォルダが存在しないノートは移動せずエラーとして報告します。",
  setAutoOnSave: "保存時に自動分類",
  setAutoOnSaveDesc:
    "編集停止から10秒後、属性が未設定のノートだけを分類します。いま開いているノートは対象外です。",
  setReclassify: "分類済みのノートも再分類",
  setReclassifyDesc:
    "ON のとき、一括コマンドは属性が入っているノートも分類し直し、より適した移動先が見つかれば移動します。保存時の自動分類は ON でも未分類のノートだけが対象です。",

  attributes: "属性",
  attributesHint:
    "Vault にあるフォルダは常に候補になるので、この一覧は任意です。自分の言葉で説明を付けたいとき、またはまだ存在しないフォルダへ振り分けたいときに登録します。説明文が判定の手がかりになります。移動先を空にすると属性の付与だけ行います。子属性を追加すると2段階で判定します。子属性の移動先は親からの相対パスで、空のときは親の移動先そのものになります。",
  phName: "属性名",
  phDesc: "説明（どんなノートか）",
  phFolder: "移動先フォルダ",
  addAttribute: "属性を追加",
  addChild: "子属性を追加",
  attributesEmpty: "属性はありません。Vault のフォルダがそのまま候補になります。",
  defaultsAdded: "例として属性を3件用意しました。設定で変更・削除できます。",
  children: "子属性",
  childrenEmpty: "子属性はありません。",
  unnamed: "（名前未設定）",
  remove: "削除",
};

export const msg = getLanguage() === "ja" ? ja : en;
