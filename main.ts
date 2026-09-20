import {
  App,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingPage,
  TFile,
  TFolder,
  Vault,
  debounce,
  normalizePath,
  requestUrl,
  type SettingDefinitionItem,
  type SettingDefinitionPage,
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

const blank = (): Category => ({ name: "", description: "", folder: "" });

const DEFAULT_CATEGORIES: Category[] = [
  {
    name: "meeting",
    description:
      "Notes from a meeting or call: who was there, what was decided, what happens next.",
    folder: "meeting",
  },
  {
    name: "idea",
    description: "A thought worth keeping: something half-formed, not yet a plan.",
    folder: "idea",
  },
  {
    name: "reference",
    description: "Material to look up later: steps, specs, findings, collected links.",
    folder: "reference",
  },
];

const joinFolder = (parent: string, child: string) =>
  parent === "" || child === "" ? parent || child : `${parent}/${child}`;

type PigeonholeSettings = {
  apiKey: string;
  categories: Category[];
  propertyName: string;
  subPropertyName: string;
  confidenceThreshold: number;
  maxChars: number;
  excludePaths: string[];
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
  excludePaths: [],
  autoOnSave: false,
  createMissingFolder: true,
};

export default class PigeonholePlugin extends Plugin {
  settings: PigeonholeSettings = DEFAULT_SETTINGS;

  private pending = new Set<string>();

  private flushPending = debounce(() => void this.drain(), 10000, true);

  async onload() {
    const saved = (await this.loadData()) as Partial<PigeonholeSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (saved === null) {
      this.settings.categories = DEFAULT_CATEGORIES;
      await this.saveSettings();
      new Notice(`Pigeonhole: ${msg.defaultsAdded}`);
    }
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
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          this.addMenuItem(menu, msg.cmdFolder, () => this.unclassifiedIn(file));
        } else if (file instanceof TFile && file.extension === "md") {
          this.addMenuItem(menu, msg.cmdNote, () => [file]);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (!this.settings.autoOnSave) return;
        if (
          f instanceof TFile &&
          f.extension === "md" &&
          !this.excluded(f.path) &&
          !this.isClassified(f)
        ) {
          this.pending.add(f.path);
          this.flushPending();
        }
      }),
    );
  }

  private addMenuItem(menu: Menu, title: string, files: () => TFile[]) {
    menu.addItem((item) =>
      item
        .setTitle(`Pigeonhole: ${title}`)
        .setIcon("inbox")
        .onClick(() => void this.run(files())),
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private isClassified(file: TFile): boolean {
    const fm: Record<string, unknown> | undefined =
      this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return false;

    const name = fm[this.settings.propertyName];
    if (name == null) return false;

    const category = named(this.settings.categories).find((c) => c.name === name);
    if (!category || named(category.children ?? []).length === 0) return true;
    return !this.settings.subPropertyName || fm[this.settings.subPropertyName] != null;
  }

  private excluded(path: string): boolean {
    return this.settings.excludePaths.some((p) => path === p || path.startsWith(`${p}/`));
  }

  private candidates(): Category[] {
    const cats = named(this.settings.categories);
    const used = new Set(cats.flatMap((c) => [c.name, c.folder]));

    Vault.recurseChildren(this.app.vault.getRoot(), (f) => {
      if (!(f instanceof TFolder) || f.isRoot() || used.has(f.path)) return;
      if (this.excluded(f.path)) return;
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
      if (!(f instanceof TFile) || f.extension !== "md") return;
      if (this.excluded(f.path) || this.isClassified(f)) return;
      files.push(f);
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
    let payload: { answers?: Record<string, ChoiceAnswer> } | undefined;
    try {
      payload = res.json as { answers?: Record<string, ChoiceAnswer> } | undefined;
    } catch {
      throw new Error(msg.errNotJson);
    }
    return payload?.answers?.category;
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

    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
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

const resolve = (root: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], root);

const assign = (root: Record<string, unknown>, key: string, value: unknown) => {
  const parts = key.split(".");
  const last = parts.pop() ?? "";
  const target = parts.reduce<Record<string, unknown>>(
    (obj, part) => obj[part] as Record<string, unknown>,
    root,
  );
  target[last] = value;
};

class PigeonholeSettingTab extends PluginSettingTab {
  plugin: PigeonholePlugin;

  constructor(app: App, plugin: PigeonholePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    return [
      {
        name: msg.setApiKey,
        desc: msg.setApiKeyDesc,
        control: { type: "text", key: "apiKey", placeholder: "apikey_..." },
      },
      { name: msg.setProperty, control: { type: "text", key: "propertyName" } },
      { name: msg.setSubProperty, control: { type: "text", key: "subPropertyName" } },
      {
        name: msg.setThreshold,
        desc: msg.setThresholdDesc,
        control: { type: "slider", key: "confidenceThreshold", min: 0, max: 1, step: 0.05 },
      },
      {
        name: msg.setExclude,
        desc: msg.setExcludeDesc,
        control: { type: "textarea", key: "excludePaths", placeholder: msg.phExclude, rows: 3 },
      },
      { name: msg.setMaxChars, control: { type: "number", key: "maxChars", min: 1 } },
      {
        name: msg.setCreateFolder,
        desc: msg.setCreateFolderDesc,
        control: { type: "toggle", key: "createMissingFolder" },
      },
      {
        name: msg.setAutoOnSave,
        desc: msg.setAutoOnSaveDesc,
        control: { type: "toggle", key: "autoOnSave" },
      },
      {
        type: "list",
        name: msg.attributes,
        desc: msg.attributesHint,
        emptyState: msg.attributesEmpty,
        addItem: {
          name: msg.addAttribute,
          action: () => this.mutate(() => s.categories.push(blank())),
        },
        onDelete: (index) => this.mutate(() => s.categories.splice(index, 1)),
        items: s.categories.map((cat) => this.page(cat)),
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "excludePaths") return this.plugin.settings.excludePaths.join("\n");
    return resolve(this.plugin.settings, key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    if (key === "excludePaths") {
      s.excludePaths = String(value)
        .split("\n")
        .map((line) => normalizePath(line.trim()))
        .filter((line) => line !== "" && line !== "." && line !== "/");
    } else {
      const next = typeof value === "string" && !key.endsWith("description") ? value.trim() : value;
      assign(s as unknown as Record<string, unknown>, key, next);
      if (s.propertyName === "") s.propertyName = DEFAULT_SETTINGS.propertyName;
    }
    await this.plugin.saveSettings();
  }

  private page(cat: Category): SettingDefinitionPage {
    return {
      type: "page",
      name: cat.name === "" ? msg.unnamed : cat.name,
      displayValue: () => cat.folder,
      page: () => new AttributePage(this, cat),
    };
  }

  private mutate(change: () => void) {
    change();
    this.update();
    void this.plugin.saveSettings();
  }
}

class AttributePage extends SettingPage {
  tab: PigeonholeSettingTab;
  cat: Category;

  constructor(tab: PigeonholeSettingTab, cat: Category) {
    super();
    this.tab = tab;
    this.cat = cat;
    this.title = cat.name === "" ? msg.unnamed : cat.name;
  }

  display(): void {
    const el = this.containerEl;
    el.empty();
    this.fields(el, this.cat);

    new Setting(el)
      .setName(msg.children)
      .setHeading()
      .addButton((b) =>
        b.setButtonText(msg.addChild).onClick(() => {
          if (!this.cat.children) this.cat.children = [];
          this.cat.children.push(blank());
          this.save();
        }),
      );

    const children = this.cat.children ?? [];
    if (children.length === 0) {
      el.createEl("p", { text: msg.childrenEmpty, cls: "setting-item-description" });
      return;
    }

    children.forEach((child, index) => {
      new Setting(el)
        .setName(child.name === "" ? msg.unnamed : child.name)
        .setHeading()
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip(msg.remove)
            .onClick(() => {
              this.cat.children?.splice(index, 1);
              this.save();
            }),
        );
      this.fields(el, child);
    });
  }

  private fields(el: HTMLElement, cat: Category) {
    new Setting(el).setName(msg.phName).addText((t) =>
      t.setValue(cat.name).onChange((v) => {
        cat.name = v.trim();
        this.persist();
      }),
    );
    new Setting(el).setName(msg.phDesc).addTextArea((t) =>
      t.setValue(cat.description).onChange((v) => {
        cat.description = v;
        this.persist();
      }),
    );
    new Setting(el).setName(msg.phFolder).addText((t) =>
      t.setValue(cat.folder).onChange((v) => {
        cat.folder = v.trim();
        this.persist();
      }),
    );
  }

  private persist() {
    void this.tab.plugin.saveSettings();
  }

  private save() {
    this.persist();
    this.display();
  }

  hide(): void {
    this.tab.update();
  }
}
