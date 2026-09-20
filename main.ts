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
  setIcon,
} from "obsidian";
import {
  buildRequest,
  decide,
  type Category,
  type ChoiceAnswer,
  type Decision,
} from "./classify.ts";
import { msg } from "./i18n.ts";

const API_URL = "https://api.typesafe.ai/v1/systemone";

const named = (cats: Category[]) => cats.filter((c) => c.name !== "");

const joinFolder = (parent: string, child: string) =>
  parent === "" || child === "" ? parent || child : `${parent}/${child}`;

type PigeonholeSettings = {
  apiKey: string;
  categories: Category[];
  propertyName: string;
  subPropertyName: string;
  confidenceThreshold: number;
  maxChars: number;
  autoOnSave: boolean;
  createMissingFolder: boolean;
};

const DEFAULT_SETTINGS: PigeonholeSettings = {
  apiKey: "",
  categories: [],
  propertyName: "category",
  subPropertyName: "subcategory",
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
    if (!fm) return false;

    const name = fm[this.settings.propertyName];
    if (name == null) return false;

    const category = named(this.settings.categories).find((c) => c.name === name);
    if (!category || named(category.children ?? []).length === 0) return true;
    return !this.settings.subPropertyName || fm[this.settings.subPropertyName] != null;
  }

  private candidates(): Category[] {
    const cats = named(this.settings.categories);
    const used = new Set(cats.flatMap((c) => [c.name, c.folder]));

    Vault.recurseChildren(this.app.vault.getRoot(), (f) => {
      if (!(f instanceof TFolder) || f.isRoot() || used.has(f.path)) return;
      const titles = f.children
        .filter((c): c is TFile => c instanceof TFile && c.extension === "md")
        .slice(0, 5)
        .map((c) => c.basename);
      cats.push({
        name: f.path,
        description: titles.length === 0 ? f.path : `${f.path} (${titles.join(", ")})`,
        folder: f.path,
      });
    });
    return cats;
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
    if (this.candidates().length === 0) {
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
            const text = msg.notMoved(msg.skip(result.reason));
            if (single) new Notice(`Pigeonhole: ${text}`);
            else console.log("Pigeonhole:", files[i].path, text);
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

  private async ask(body: object): Promise<ChoiceAnswer | undefined> {
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
    try {
      return res.json?.answers?.category;
    } catch {
      throw new Error(msg.errNotJson);
    }
  }

  async classifyFile(file: TFile): Promise<Decision> {
    const content = await this.app.vault.cachedRead(file);
    const { maxChars, confidenceThreshold } = this.settings;
    const categories = this.candidates();

    const answer = await this.ask(buildRequest(content, file.basename, categories, maxChars));
    const decision = decide(answer, categories, confidenceThreshold);
    if (decision.action !== "move") return decision;

    const children = named(decision.category.children ?? []);
    let sub: Category | undefined;
    if (children.length > 0) {
      const subAnswer = await this.ask(
        buildRequest(content, file.basename, children, maxChars, decision.category),
      );
      const subDecision = decide(subAnswer, children, confidenceThreshold);
      if (subDecision.action === "move") sub = subDecision.category;
    }

    await this.apply(file, decision.category, sub);
    return decision;
  }

  private async apply(file: TFile, category: Category, sub?: Category) {
    const destination = sub ? joinFolder(category.folder, sub.folder) : category.folder;
    const folder = normalizePath(destination);
    const move = destination !== "" && folder !== "." && folder !== "/";
    const missingFolder = move && !this.app.vault.getAbstractFileByPath(folder);

    if (missingFolder && !this.settings.createMissingFolder) {
      throw new Error(msg.errMissingFolder(folder));
    }

    const [head, ...rest] = category.name.split("/");
    const subName = sub ? sub.name : rest.join("/");

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[this.settings.propertyName] = head;
      if (!this.settings.subPropertyName) return;
      if (subName !== "") fm[this.settings.subPropertyName] = subName;
      else delete fm[this.settings.subPropertyName];
    });

    if (!move || file.parent?.path === folder) return;
    if (missingFolder) await this.createFolder(folder);
    await this.app.fileManager.renameFile(file, this.freeName(folder, file));
  }

  private async createFolder(folder: string) {
    let path = "";
    for (const part of folder.split("/")) {
      path = path === "" ? part : `${path}/${part}`;
      if (!this.app.vault.getAbstractFileByPath(path)) {
        await this.app.vault.createFolder(path);
      }
    }
  }

  private freeName(folder: string, file: TFile): string {
    let path = normalizePath(`${folder}/${file.name}`);
    for (let n = 1; this.app.vault.getAbstractFileByPath(path); n++) {
      path = normalizePath(`${folder}/${file.basename} ${n}.${file.extension}`);
    }
    return path;
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

    new Setting(containerEl).setName(msg.setSubProperty).addText((t) =>
      t.setValue(s.subPropertyName).onChange(async (v) => {
        s.subPropertyName = v.trim();
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

    const grid = containerEl.createDiv({ cls: "pigeonhole-attrs" });
    for (const label of [msg.colName, msg.colDesc, msg.colFolder]) {
      grid.createDiv({ text: label, cls: "pigeonhole-head" });
    }
    grid.createDiv();
    grid.createDiv();

    s.categories.forEach((cat, i) => {
      this.attrRow(grid, cat, false);
      this.iconButton(grid, "plus", msg.addChild, () => {
        if (!cat.children) cat.children = [];
        cat.children.push({ name: "", description: "", folder: "" });
        void this.saveAndRedraw();
      });
      this.iconButton(grid, "trash", msg.remove, () => {
        s.categories.splice(i, 1);
        void this.saveAndRedraw();
      });

      (cat.children ?? []).forEach((child, j) => {
        this.attrRow(grid, child, true);
        grid.createDiv();
        this.iconButton(grid, "trash", msg.remove, () => {
          cat.children?.splice(j, 1);
          void this.saveAndRedraw();
        });
      });
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText(msg.addAttribute).onClick(() => {
        s.categories.push({ name: "", description: "", folder: "" });
        void this.saveAndRedraw();
      }),
    );
  }

  private async saveAndRedraw() {
    await this.plugin.saveSettings();
    this.display();
  }

  private attrRow(grid: HTMLElement, cat: Category, child: boolean) {
    const first = child ? grid.createDiv({ cls: "pigeonhole-child-cell" }) : grid.createDiv();
    this.field(first, cat.name, msg.phName, (v) => (cat.name = v.trim()));
    this.field(grid, cat.description, msg.phDesc, (v) => (cat.description = v));
    this.field(grid, cat.folder, msg.phFolder, (v) => (cat.folder = v.trim()));
  }

  private field(el: HTMLElement, value: string, placeholder: string, set: (v: string) => void) {
    const input = el.createEl("input", { type: "text", value, placeholder });
    input.addEventListener("input", async () => {
      set(input.value);
      await this.plugin.saveSettings();
    });
  }

  private iconButton(el: HTMLElement, icon: string, label: string, onClick: () => void) {
    const button = el.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
  }
}
