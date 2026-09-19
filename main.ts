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
import { msg } from "./i18n.ts";

const API_URL = "https://api.typesafe.ai/v1/systemone";

type PigeonholeSettings = {
  apiKey: string;
  categories: Category[];
  propertyName: string;
  confidenceThreshold: number;
  maxChars: number;
  autoOnSave: boolean;
  createMissingFolder: boolean;
};

const DEFAULT_SETTINGS: PigeonholeSettings = {
  apiKey: "",
  categories: [],
  propertyName: "category",
  confidenceThreshold: 0.6,
  maxChars: 4000,
  autoOnSave: false,
  createMissingFolder: false,
};

export default class PigeonholePlugin extends Plugin {
  settings: PigeonholeSettings = DEFAULT_SETTINGS;

  private pending = new Set<string>();

  private flushPending = debounce(() => void this.drain(), 10000, true);

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new PigeonholeSettingTab(this.app, this));

    this.addCommand({
      id: "classify-current-note",
      name: msg.cmdNote,
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(`Pigeonhole: ${msg.needMarkdown}`);
          return;
        }
        void this.run([file]);
      },
    });

    this.addCommand({
      id: "classify-current-folder",
      name: msg.cmdFolder,
      callback: () => {
        const parent = this.app.workspace.getActiveFile()?.parent;
        if (!parent) {
          new Notice(`Pigeonhole: ${msg.noFolder}`);
          return;
        }
        void this.run(this.unclassifiedIn(parent));
      },
    });

    this.addCommand({
      id: "classify-vault",
      name: msg.cmdVault,
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
      new Notice(`Pigeonhole: ${msg.noApiKey}`);
      return;
    }
    if (this.settings.categories.length === 0) {
      new Notice(`Pigeonhole: ${msg.noCategories}`);
      return;
    }
    if (files.length === 0) {
      if (!quiet) new Notice(`Pigeonhole: ${msg.nothingToDo}`);
      return;
    }

    const single = files.length === 1;
    const notice = new Notice(`Pigeonhole: ${msg.working}`, 0);
    let moved = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        if (!single) notice.setMessage(`Pigeonhole: ${i + 1}/${files.length} ${files[i].basename}`);
        try {
          const result = await this.classifyFile(files[i]);
          if (result.action === "move") moved++;
          else {
            skipped++;
            if (single) new Notice(`Pigeonhole: ${msg.notMoved(msg.skip(result.reason))}`);
          }
        } catch (e) {
          failed++;
          console.error("Pigeonhole:", files[i].path, e);
          if (single) new Notice(`Pigeonhole: ${(e as Error).message}`);
        }
      }
    } finally {
      notice.hide();
    }

    if (moved === 0 && (single || quiet)) return;
    new Notice(`Pigeonhole: ${msg.summary(moved, skipped, failed)}`);
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
      throw new Error(msg.errNotJson);
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
    const folder = normalizePath(category.folder);
    const move = category.folder !== "" && folder !== "." && folder !== "/";
    const target = normalizePath(`${folder}/${file.name}`);
    const missingFolder = move && !this.app.vault.getAbstractFileByPath(folder);

    if (move && target !== file.path) {
      if (this.app.vault.getAbstractFileByPath(target)) {
        throw new Error(msg.errConflict(target));
      }
      if (missingFolder && !this.settings.createMissingFolder) {
        throw new Error(msg.errMissingFolder(folder));
      }
    }

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[this.settings.propertyName] = category.name;
    });

    if (!move || target === file.path) return;
    if (missingFolder) await this.app.vault.createFolder(folder);
    await this.app.fileManager.renameFile(file, target);
  }
}

class PigeonholeSettingTab extends PluginSettingTab {
  plugin: PigeonholePlugin;

  constructor(app: App, plugin: PigeonholePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName(msg.setApiKey)
      .setDesc(msg.setApiKeyDesc)
      .addText((t) =>
        t
          .setPlaceholder("sk-...")
          .setValue(s.apiKey)
          .onChange(async (v) => {
            s.apiKey = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName(msg.setProperty).addText((t) =>
      t.setValue(s.propertyName).onChange(async (v) => {
        s.propertyName = v.trim() || "category";
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName(msg.setThreshold)
      .setDesc(msg.setThresholdDesc)
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

    new Setting(containerEl).setName(msg.setMaxChars).addText((t) =>
      t.setValue(String(s.maxChars)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          s.maxChars = Math.floor(n);
          await this.plugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl)
      .setName(msg.setCreateFolder)
      .setDesc(msg.setCreateFolderDesc)
      .addToggle((t) =>
        t.setValue(s.createMissingFolder).onChange(async (v) => {
          s.createMissingFolder = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(msg.setAutoOnSave)
      .setDesc(msg.setAutoOnSaveDesc)
      .addToggle((t) =>
        t.setValue(s.autoOnSave).onChange(async (v) => {
          s.autoOnSave = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(msg.attributes).setHeading();
    containerEl.createEl("p", {
      text: msg.attributesHint,
      cls: "setting-item-description",
    });

    s.categories.forEach((cat, i) => {
      new Setting(containerEl)
        .addText((t) =>
          t
            .setPlaceholder(msg.phName)
            .setValue(cat.name)
            .onChange(async (v) => {
              cat.name = v.trim();
              await this.plugin.saveSettings();
            }),
        )
        .addText((t) =>
          t
            .setPlaceholder(msg.phDesc)
            .setValue(cat.description)
            .onChange(async (v) => {
              cat.description = v;
              await this.plugin.saveSettings();
            }),
        )
        .addText((t) =>
          t
            .setPlaceholder(msg.phFolder)
            .setValue(cat.folder)
            .onChange(async (v) => {
              cat.folder = v.trim();
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip(msg.remove)
            .onClick(async () => {
              s.categories.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText(msg.addAttribute).onClick(async () => {
        s.categories.push({ name: "", description: "", folder: "" });
        await this.plugin.saveSettings();
        this.display();
      }),
    );
  }
}
