import { getLanguage } from "obsidian";
import type { SkipReason } from "./classify.ts";

const en = {
  cmdNote: "Classify this note",
  cmdFolder: "Classify unclassified notes in this folder",
  cmdVault: "Classify unclassified notes in the vault",

  needMarkdown: "Open a Markdown note first",
  noFolder: "No target folder. Open a note first",
  noApiKey: "Set your API key in the settings",
  noCategories: "No folders in the vault and no attributes in the settings",
  nothingToDo: "No unclassified notes to process",
  working: "Classifying...",
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
  setApiKeyDesc: "Stored as plain text in data.json.",
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

  attributes: "Attributes",
  attributesHint:
    "The folders already in your vault are always candidates, so this list is optional. Add an attribute when you want to describe it in your own words, or to file notes into a folder that does not exist yet. The description is what the model judges against. Leave the folder empty to set the property without moving the file. Give an attribute sub-attributes to classify in two steps; a sub-attribute's folder is relative to its parent's, and an empty one means the parent's folder itself.",
  colName: "Name",
  colDesc: "Description",
  colFolder: "Target folder",
  phName: "Name",
  phDesc: "Description (what kind of note)",
  phFolder: "Target folder",
  addAttribute: "Add attribute",
  addChild: "Add sub-attribute",
  remove: "Remove",
};

const ja: typeof en = {
  cmdNote: "このノートを分類",
  cmdFolder: "このフォルダの未分類ノートを分類",
  cmdVault: "Vault 全体の未分類ノートを分類",

  needMarkdown: "Markdown ファイルを開いてから実行してください",
  noFolder: "対象フォルダが分かりません。ノートを開いてから実行してください",
  noApiKey: "設定で API キーを入力してください",
  noCategories: "Vault にフォルダが無く、設定にも属性がありません",
  nothingToDo: "対象の未分類ノートがありません",
  working: "分類中…",
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
  setApiKeyDesc: "data.json に平文で保存されます。",
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

  attributes: "属性",
  attributesHint:
    "Vault にあるフォルダは常に候補になるので、この一覧は任意です。自分の言葉で説明を付けたいとき、またはまだ存在しないフォルダへ振り分けたいときに登録します。説明文が判定の手がかりになります。移動先を空にすると属性の付与だけ行います。子属性を追加すると2段階で判定します。子属性の移動先は親からの相対パスで、空のときは親の移動先そのものになります。",
  colName: "属性名",
  colDesc: "説明",
  colFolder: "移動先フォルダ",
  phName: "属性名",
  phDesc: "説明（どんなノートか）",
  phFolder: "移動先フォルダ",
  addAttribute: "属性を追加",
  addChild: "子属性を追加",
  remove: "削除",
};

export const msg = getLanguage() === "ja" ? ja : en;
