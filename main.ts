import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  Vault,
  debounce,
  normalizePath,
  requestUrl,
} from "obsidian";
import { buildRequest, decide, type Category, type Decision } from "./classify.ts";

const API_URL = "https://api.typesafe.ai/v1/systemone";

type JevSettings = {
  apiKey: string;
  categories: Category[];
  propertyName: string;
  confidenceThreshold: number;
  maxChars: number;
  autoOnSave: boolean;
};

const DEFAULT_SETTINGS: JevSettings = {
  apiKey: "",
  categories: [],
  propertyName: "category",
  confidenceThreshold: 0.6,
  maxChars: 4000,
  autoOnSave: false,
};

export default class JevClassifierPlugin extends Plugin {
  settings: JevSettings = DEFAULT_SETTINGS;

  private pending = new Set<string>();

  private flushPending = debounce(() => void this.drain(), 10000, true);

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new JevSettingTab(this.app, this));

    this.addCommand({
      id: "classify-current-note",
      name: "このノートを分類",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice("Jev: Markdown ファイルを開いてから実行してください");
          return;
        }
        void this.run([file]);
      },
    });

    this.addCommand({
      id: "classify-current-folder",
      name: "このフォルダの未分類ノートを分類",
      callback: () => {
        const parent = this.app.workspace.getActiveFile()?.parent;
        if (!parent) {
          new Notice("Jev: 対象フォルダが分かりません。ノートを開いてから実行してください");
          return;
        }
        void this.run(this.unclassifiedIn(parent));
      },
    });

    this.addCommand({
      id: "classify-vault",
      name: "Vault 全体の未分類ノートを分類",
      callback: () => void this.run(this.unclassifiedIn(this.app.vault.getRoot())),
    });

    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (!this.settings.autoOnSave) return;
        if (f instanceof TFile && f.extension === "md" && !this.isClassified(f)) {
          this.pending.add(f.path);
          this.flushPending();
        }
      }),
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private isClassified(file: TFile): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return fm?.[this.settings.propertyName] != null;
  }

  private unclassifiedIn(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    Vault.recurseChildren(folder, (f) => {
      if (f instanceof TFile && f.extension === "md" && !this.isClassified(f)) files.push(f);
    });
    return files;
  }

  private async drain() {
    const active = this.app.workspace.getActiveFile();
    const files: TFile[] = [];
    for (const path of this.pending) {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile) || f === active || this.isClassified(f)) continue;
      this.pending.delete(path);
      files.push(f);
    }
    if (files.length > 0) await this.run(files, true);
  }

  private async run(files: TFile[], quiet = false) {
    if (!this.settings.apiKey) {
      new Notice("Jev: 設定で API キーを入力してください");
      return;
    }
    if (this.settings.categories.length === 0) {
      new Notice("Jev: 設定で属性を1つ以上登録してください");
      return;
    }
    if (files.length === 0) {
      if (!quiet) new Notice("Jev: 対象の未分類ノートがありません");
      return;
    }

    const single = files.length === 1;
    const notice = new Notice("Jev: 分類中…", 0);
    let moved = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        if (!single) notice.setMessage(`Jev: ${i + 1}/${files.length} ${files[i].basename}`);
        try {
          const result = await this.classifyFile(files[i]);
          if (result.action === "move") moved++;
          else {
            skipped++;
            if (single) new Notice(`Jev: 移動しませんでした — ${result.reason}`);
          }
        } catch (e) {
          failed++;
          console.error("Jev:", files[i].path, e);
          if (single) new Notice(`Jev: ${(e as Error).message}`);
        }
      }
    } finally {
      notice.hide();
    }

    if (moved === 0 && (single || quiet)) return;
    new Notice(`Jev: 移動 ${moved} / 見送り ${skipped} / 失敗 ${failed}`);
  }

  async classifyFile(file: TFile): Promise<Decision> {
    const content = await this.app.vault.cachedRead(file);
    const body = buildRequest(
      content,
      file.basename,
      this.settings.categories,
      this.settings.maxChars,
    );

    const res = await requestUrl({
      url: API_URL,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status !== 200) {
      throw new Error(`API ${res.status}: ${res.text.slice(0, 200)}`);
    }

    let answers;
    try {
      answers = res.json?.answers;
    } catch {
      throw new Error("API レスポンスが JSON ではありません");
    }

    const decision = decide(
      answers?.category,
      this.settings.categories,
      this.settings.confidenceThreshold,
    );
    if (decision.action === "move") await this.apply(file, decision.category);
    return decision;
  }

  private async apply(file: TFile, category: Category) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[this.settings.propertyName] = category.name;
    });

    const folder = normalizePath(category.folder);
    if (!category.folder || folder === "." || folder === "/") return;

    const target = normalizePath(`${folder}/${file.name}`);
    if (target === file.path) return;
    if (this.app.vault.getAbstractFileByPath(target)) {
      throw new Error(`${target} に同名ファイルがあるため移動を中止しました`);
    }
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    await this.app.fileManager.renameFile(file, target);
  }
}

class JevSettingTab extends PluginSettingTab {
  plugin: JevClassifierPlugin;

  constructor(app: App, plugin: JevClassifierPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("TypeSafe API キー")
      .setDesc("data.json に平文で保存されます。")
      .addText((t) =>
        t
          .setPlaceholder("sk-...")
          .setValue(s.apiKey)
          .onChange(async (v) => {
            s.apiKey = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("frontmatter プロパティ名").addText((t) =>
      t.setValue(s.propertyName).onChange(async (v) => {
        s.propertyName = v.trim() || "category";
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName("confidence の下限")
      .setDesc("これを下回ったらファイルを動かしません。")
      .addSlider((sl) =>
        sl
          .setLimits(0, 1, 0.05)
          .setValue(s.confidenceThreshold)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.confidenceThreshold = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("送信する本文の文字数上限").addText((t) =>
      t.setValue(String(s.maxChars)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          s.maxChars = Math.floor(n);
          await this.plugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl)
      .setName("保存時に自動分類")
      .setDesc("編集停止から10秒後、属性が未設定のノートだけを分類します。")
      .addToggle((t) =>
        t.setValue(s.autoOnSave).onChange(async (v) => {
          s.autoOnSave = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("属性").setHeading();
    containerEl.createEl("p", {
      text: "説明文が判定の手がかりになります。移動先を空にすると属性の付与だけ行います。",
      cls: "setting-item-description",
    });

    s.categories.forEach((cat, i) => {
      new Setting(containerEl)
        .addText((t) =>
          t
            .setPlaceholder("属性名")
            .setValue(cat.name)
            .onChange(async (v) => {
              cat.name = v.trim();
              await this.plugin.saveSettings();
            }),
        )
        .addText((t) =>
          t
            .setPlaceholder("説明（どんなノートか）")
            .setValue(cat.description)
            .onChange(async (v) => {
              cat.description = v;
              await this.plugin.saveSettings();
            }),
        )
        .addText((t) =>
          t
            .setPlaceholder("移動先フォルダ")
            .setValue(cat.folder)
            .onChange(async (v) => {
              cat.folder = v.trim();
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip("削除")
            .onClick(async () => {
              s.categories.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("属性を追加").onClick(async () => {
        s.categories.push({ name: "", description: "", folder: "" });
        await this.plugin.saveSettings();
        this.display();
      }),
    );
  }
}
