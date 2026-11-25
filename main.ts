import {
  App,
  ConfirmationModal,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  SettingPage,
  TFile,
  TFolder,
  Vault,
  debounce,
  getLinkpath,
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
  type Subject,
  type SystemOneRequest,
} from "./classify.ts";
import { msg } from "./i18n.ts";
import { imageMime, toJpegBase64 } from "./image.ts";
import { RESULT_VIEW, ResultView, type RunResult } from "./result-view.ts";

const API_URL = "https://api.typesafe.ai/v1/systemone";

type Mode = "single" | "bulk" | "auto";

class FatalApiError extends Error {}

// 529 is TypeSafe being overloaded; the docs ask clients to back off like for 429.
const RETRY_STATUS = new Set([429, 529]);

const FATAL_STATUS = new Set([401, 403, 429, 529]);

const MAX_RETRIES = 3;

// Keeps a request well under the API's 32 MiB body limit.
const MAX_IMAGES = 10;

const URL_IMAGE_TIMEOUT = 15000;

const EXTERNAL_IMAGE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)/g;

const isImage = (file: TFile) => imageMime(file.extension) !== undefined;

const header = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];

const logError = (e: unknown) => console.error("Pigeonhole:", e);

// Above this many notes at once (e.g. after a sync), classify on save asks first.
const AUTO_CONFIRM_OVER = 10;

class ConfirmModal extends ConfirmationModal {
  private confirmed = false;
  private resolve: (ok: boolean) => void;

  constructor(app: App, body: string, resolve: (ok: boolean) => void) {
    super(app);
    this.resolve = resolve;
    this.setTitle("Pigeonhole").setContent(body);
    this.addButton((b) =>
      b
        .setButtonText(msg.confirmRun)
        .setCta()
        .setInitialFocus()
        .onClick(() => {
          this.confirmed = true;
        }),
    );
    this.addCancelButton();
  }

  onClose() {
    super.onClose();
    this.resolve(this.confirmed);
  }
}

const confirm = (app: App, body: string) =>
  new Promise<boolean>((resolve) => new ConfirmModal(app, body, resolve).open());

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
  apiKeySecret: string;
  categories: Category[];
  propertyName: string;
  subPropertyName: string;
  confidenceThreshold: number;
  maxChars: number;
  excludePaths: string[];
  maxFolderDepth: number;
  autoOnSave: boolean;
  reclassify: boolean;
  createMissingFolder: boolean;
  noteImages: boolean;
  maxImages: number;
  imageTargets: boolean;
  // Images have no frontmatter, so the attribute given to each image is kept here, by path.
  classifiedImages: Record<string, string>;
};

const DEFAULT_SETTINGS: PigeonholeSettings = {
  apiKeySecret: "pigeonhole-api-key",
  categories: [],
  propertyName: "category",
  subPropertyName: "subcategory",
  confidenceThreshold: 0.6,
  maxChars: 4000,
  excludePaths: [],
  maxFolderDepth: 0,
  autoOnSave: false,
  reclassify: false,
  createMissingFolder: true,
  noteImages: false,
  maxImages: 4,
  imageTargets: false,
  classifiedImages: {},
};

export default class PigeonholePlugin extends Plugin {
  settings: PigeonholeSettings = DEFAULT_SETTINGS;

  private lastResult: RunResult | null = null;

  private pending = new Set<string>();

  // Notes classify on save already gave up on this session, so editing them does not call the API again.
  private autoSkipped = new Set<string>();

  private stopRequested = false;

  private running = false;

  private flushPending = debounce(() => void this.drain(), 10000, true);

  async onload() {
    const saved = (await this.loadData()) as
      | (Partial<PigeonholeSettings> & { apiKey?: string })
      | null;
    const { apiKey: legacyKey, ...rest } = saved ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rest);
    this.settings.classifiedImages = { ...this.settings.classifiedImages };
    if (legacyKey) {
      this.app.secretStorage.setSecret(this.settings.apiKeySecret, legacyKey);
      await this.saveSettings();
    }
    if (saved === null) {
      this.settings.categories = DEFAULT_CATEGORIES;
      await this.saveSettings();
      new Notice(`Pigeonhole: ${msg.defaultsAdded}`);
    }
    this.addSettingTab(new PigeonholeSettingTab(this.app, this));
    this.registerView(
      RESULT_VIEW,
      (leaf) =>
        new ResultView(
          leaf,
          () => this.lastResult,
          (result) => this.undo(result),
        ),
    );

    this.addCommand({
      id: "classify-current-note",
      name: msg.cmdNote,
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isTarget(file)) {
          const need = this.settings.imageTargets ? msg.needNoteOrImage : msg.needMarkdown;
          new Notice(`Pigeonhole: ${need}`);
          return;
        }
        void this.run([file], "single");
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
        void this.run(this.targetsIn(parent), "bulk");
      },
    });

    this.addCommand({
      id: "show-result",
      name: msg.cmdResult,
      callback: () => void this.showResult(),
    });

    this.addCommand({
      id: "stop-classification",
      name: msg.cmdStop,
      callback: () => {
        this.stopRequested = true;
      },
    });

    this.addCommand({
      id: "classify-vault",
      name: msg.cmdVault,
      callback: () => void this.run(this.targetsIn(this.app.vault.getRoot()), "bulk"),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          this.addMenuItem(menu, msg.cmdFolder, "bulk", () => this.targetsIn(file));
        } else if (file instanceof TFile && this.isTarget(file)) {
          this.addMenuItem(menu, msg.cmdNote, "single", () => [file]);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => this.moveImageRecords(oldPath, f.path)),
    );
    this.registerEvent(this.app.vault.on("delete", (f) => this.moveImageRecords(f.path, null)));

    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (!this.settings.autoOnSave) return;
        if (
          f instanceof TFile &&
          f.extension === "md" &&
          !this.excluded(f.path) &&
          !this.autoSkipped.has(f.path) &&
          !this.isClassified(f)
        ) {
          this.pending.add(f.path);
          this.flushPending();
        }
      }),
    );
  }

  onunload() {
    this.flushPending.cancel();
  }

  private addMenuItem(menu: Menu, title: string, mode: Mode, files: () => TFile[]) {
    menu.addItem((item) =>
      item
        .setTitle(`Pigeonhole: ${title}`)
        .setIcon("inbox")
        .onClick(() => void this.run(files(), mode)),
    );
  }

  apiKey(): string {
    return this.app.secretStorage.getSecret(this.settings.apiKeySecret) ?? "";
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private isTarget(file: TFile): boolean {
    return file.extension === "md" || (this.settings.imageTargets && isImage(file));
  }

  private isClassified(file: TFile): boolean {
    if (isImage(file)) return this.settings.classifiedImages[file.path] !== undefined;
    const fm: Record<string, unknown> | undefined =
      this.app.metadataCache.getFileCache(file)?.frontmatter;
    return fm?.[this.settings.propertyName] != null;
  }

  // Follows a renamed or deleted file or folder; `to` is null on delete.
  private moveImageRecords(from: string, to: string | null) {
    const records = this.settings.classifiedImages;
    let changed = false;
    // ponytail: scans every record per rename; index by folder if vaults get huge.
    for (const path of Object.keys(records)) {
      if (path !== from && !path.startsWith(`${from}/`)) continue;
      if (to !== null) records[to + path.slice(from.length)] = records[path];
      delete records[path];
      changed = true;
    }
    if (changed) this.saveSettings().catch(logError);
  }

  // Images some note links to or embeds. The bulk commands leave these with their notes.
  private linkedPaths(): Set<string> {
    const linked = new Set<string>();
    for (const dests of Object.values(this.app.metadataCache.resolvedLinks)) {
      for (const path of Object.keys(dests)) linked.add(path);
    }
    return linked;
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
      const { maxFolderDepth } = this.settings;
      if (maxFolderDepth > 0 && f.path.split("/").length > maxFolderDepth) return;
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

  private targetsIn(folder: TFolder): TFile[] {
    const linked = this.settings.imageTargets ? this.linkedPaths() : new Set<string>();
    const files: TFile[] = [];
    Vault.recurseChildren(folder, (f) => {
      if (!(f instanceof TFile) || !this.isTarget(f)) return;
      if (isImage(f) && linked.has(f.path)) return;
      if (this.excluded(f.path)) return;
      if (!this.settings.reclassify && this.isClassified(f)) return;
      files.push(f);
    });
    return files;
  }

  private async drain() {
    if (this.running) {
      this.flushPending();
      return;
    }
    const active = this.app.workspace.getActiveFile();
    const files: TFile[] = [];
    for (const path of this.pending) {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile && f === active) continue;
      this.pending.delete(path);
      if (f instanceof TFile && !this.isClassified(f)) files.push(f);
    }
    if (files.length > 0) await this.run(files, "auto");
  }

  private async run(files: TFile[], mode: Mode) {
    if (this.running) {
      if (mode !== "auto") new Notice(`Pigeonhole: ${msg.busy}`);
      return;
    }
    this.running = true;
    try {
      await this.execute(files, mode);
    } finally {
      this.running = false;
    }
  }

  private async execute(files: TFile[], mode: Mode) {
    if (!this.apiKey()) {
      new Notice(`Pigeonhole: ${msg.noApiKey}`);
      return;
    }
    const categories = this.candidates();
    if (categories.length === 0) {
      new Notice(`Pigeonhole: ${msg.noCategories}`);
      return;
    }
    if (files.length === 0) {
      if (mode !== "auto") new Notice(`Pigeonhole: ${msg.nothingToDo}`);
      return;
    }

    if (mode === "bulk" && !(await confirm(this.app, msg.confirmBody(files.length)))) return;
    if (
      mode === "auto" &&
      files.length > AUTO_CONFIRM_OVER &&
      !(await confirm(this.app, msg.confirmAuto(files.length)))
    ) {
      for (const f of files) this.autoSkipped.add(f.path);
      return;
    }

    const single = mode === "single";
    const notice = new Notice(`Pigeonhole: ${msg.working}`, 0);
    const progress = notice.messageEl.createSpan();
    if (!single) {
      notice.messageEl.createEl("button", { text: msg.stop }).onclick = () => {
        this.stopRequested = true;
      };
    }
    const result: RunResult = { moved: [], tagged: [], skipped: [], failed: [], changes: [] };
    this.stopRequested = false;

    try {
      for (let i = 0; i < files.length; i++) {
        if (this.stopRequested) break;
        if (!single) progress.setText(`Pigeonhole: ${i + 1}/${files.length} ${files[i].basename}`);
        try {
          const from = files[i].path;
          const fromFolder = files[i].parent?.path ?? "/";
          const prev = this.properties(files[i]);
          const decision = await this.classifyFile(files[i], categories);
          if (decision.action === "move") {
            result.changes.push({ file: files[i], path: from, prev });
            if (files[i].path !== from) {
              result.moved.push({
                path: files[i].path,
                from: fromFolder,
                to: files[i].parent?.path ?? "/",
              });
            } else {
              result.tagged.push({ path: from, name: decision.category.name });
            }
          } else {
            const reason = msg.skip(decision.reason);
            result.skipped.push({ path: files[i].path, reason });
            if (mode === "auto") this.autoSkipped.add(files[i].path);
            if (single) new Notice(`Pigeonhole: ${msg.notMoved(reason)}`);
          }
        } catch (e) {
          const error = (e as Error).message;
          result.failed.push({ path: files[i].path, error });
          console.error("Pigeonhole:", files[i].path, e);
          if (single) new Notice(`Pigeonhole: ${error}`);
          if (e instanceof FatalApiError) break;
        }
      }
    } finally {
      notice.hide();
    }

    this.lastResult = result;
    if (mode === "bulk") {
      await this.showResult();
      return;
    }
    if (single && result.tagged.length > 0) {
      new Notice(`Pigeonhole: ${msg.tagged(result.tagged[0].name)}`);
      return;
    }
    if (result.moved.length === 0) return;
    new Notice(
      `Pigeonhole: ${msg.summary(result.moved.length, result.skipped.length, result.failed.length)}`,
    );
  }

  private properties(file: TFile): Record<string, unknown> {
    if (isImage(file)) return { classifiedImage: this.settings.classifiedImages[file.path] };
    const fm: Record<string, unknown> | undefined =
      this.app.metadataCache.getFileCache(file)?.frontmatter;
    const keys = [this.settings.propertyName, this.settings.subPropertyName].filter((k) => k);
    return Object.fromEntries(keys.map((k) => [k, fm?.[k]]));
  }

  private async undo(result: RunResult) {
    let restored = 0;
    for (const { file, path, prev } of result.changes) {
      try {
        if (isImage(file)) {
          // Restored at the current path; the rename below carries it back with the file.
          const before = prev.classifiedImage;
          if (typeof before === "string") this.settings.classifiedImages[file.path] = before;
          else delete this.settings.classifiedImages[file.path];
          await this.saveSettings();
        } else {
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(prev)) {
              if (value === undefined) delete fm[key];
              else fm[key] = value;
            }
          });
        }
        if (file.path !== path) {
          const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
          if (folder !== "") await this.createFolder(folder);
          const target = this.app.vault.getAbstractFileByPath(path)
            ? this.freeName(folder, file)
            : path;
          await this.app.fileManager.renameFile(file, target);
        }
        restored++;
      } catch (e) {
        console.error("Pigeonhole: undo", file.path, e);
      }
    }
    result.undone = true;
    new Notice(`Pigeonhole: ${msg.undone(restored, result.changes.length)}`);
    await this.showResult();
  }

  private async showResult() {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(RESULT_VIEW)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: RESULT_VIEW, active: true });
    await workspace.revealLeaf(leaf);
    if (leaf.view instanceof ResultView) await leaf.view.render();
  }

  private async ask(body: SystemOneRequest): Promise<ChoiceAnswer | undefined> {
    let res = await this.post(body);
    for (let attempt = 0; RETRY_STATUS.has(res.status) && attempt < MAX_RETRIES; attempt++) {
      const retryAfter = header(res.headers, "retry-after");
      // Retry-After may be an HTTP date; fall back to exponential backoff then.
      const until = Date.now() + Math.min(Number(retryAfter) || 2 ** attempt * 2, 60) * 1000;
      while (Date.now() < until && !this.stopRequested) await sleep(500);
      if (this.stopRequested) break;
      res = await this.post(body);
    }
    if (res.status !== 200) {
      const message = `API ${res.status}: ${res.text.slice(0, 200)}`;
      throw FATAL_STATUS.has(res.status) ? new FatalApiError(message) : new Error(message);
    }
    let payload: { answers?: Record<string, ChoiceAnswer> } | undefined;
    try {
      payload = res.json as { answers?: Record<string, ChoiceAnswer> } | undefined;
    } catch {
      throw new Error(msg.errNotJson);
    }
    return payload?.answers?.category;
  }

  private post(body: SystemOneRequest) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey()}`,
      "Content-Type": "application/json",
    };
    if (body.assets) headers["TypeSafe-Danger-Zone-Images"] = "true";
    return requestUrl({
      url: API_URL,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    });
  }

  private async noteSubject(file: TFile): Promise<Subject> {
    const raw = await this.app.vault.cachedRead(file);
    // Frontmatter would eat into maxChars, and an existing property biases reclassification.
    const end = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
    const content = end === undefined ? raw : raw.slice(end).trimStart();
    const images = this.settings.noteImages ? await this.embeddedImages(file, raw, end ?? 0) : [];
    return { kind: "note", title: file.basename, content, images };
  }

  // The images in the note body, in document order, up to maxImages that could be read.
  private async embeddedImages(file: TFile, raw: string, bodyStart: number): Promise<string[]> {
    type Source = { offset: number; read: () => Promise<{ data: ArrayBuffer; mime: string }> };
    const sources: Source[] = [];
    const seen = new Set<string>();

    for (const embed of this.app.metadataCache.getFileCache(file)?.embeds ?? []) {
      const target = this.app.metadataCache.getFirstLinkpathDest(
        getLinkpath(embed.link),
        file.path,
      );
      const mime = target ? imageMime(target.extension) : undefined;
      if (!target || mime === undefined || this.excluded(target.path) || seen.has(target.path)) {
        continue;
      }
      seen.add(target.path);
      sources.push({
        offset: embed.position.start.offset,
        read: async () => ({ data: await this.app.vault.readBinary(target), mime }),
      });
    }

    // Obsidian's link cache covers vault files only, so URLs are found in the text.
    EXTERNAL_IMAGE.lastIndex = 0;
    for (let m = EXTERNAL_IMAGE.exec(raw); m; m = EXTERNAL_IMAGE.exec(raw)) {
      const url = m[1];
      if (m.index < bodyStart || seen.has(url)) continue;
      seen.add(url);
      sources.push({ offset: m.index, read: () => this.fetchImage(url) });
    }

    sources.sort((a, b) => a.offset - b.offset);
    const limit = Math.min(this.settings.maxImages, MAX_IMAGES);
    const images: string[] = [];
    for (const source of sources) {
      if (images.length >= limit) break;
      try {
        const { data, mime } = await source.read();
        images.push(await toJpegBase64(data, mime));
      } catch (e) {
        // One unreadable image should not cost the note its classification.
        console.warn("Pigeonhole: image skipped in", file.path, e);
      }
    }
    return images;
  }

  private async fetchImage(url: string): Promise<{ data: ArrayBuffer; mime: string }> {
    // ponytail: requestUrl cannot be aborted, so the timeout only stops waiting for it.
    const res = await Promise.race([
      requestUrl({ url, throw: false }),
      sleep(URL_IMAGE_TIMEOUT).then(() => null),
    ]);
    if (res === null) throw new Error(`Timed out: ${url}`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`);
    // The browser sniffs raster formats itself; only SVG needs its type to decode.
    const type = header(res.headers, "content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    return { data: res.arrayBuffer, mime: type.startsWith("image/") ? type : "" };
  }

  private async imageSubject(file: TFile): Promise<Subject> {
    try {
      const data = await this.app.vault.readBinary(file);
      const image = await toJpegBase64(data, imageMime(file.extension) ?? "");
      return { kind: "image", title: file.name, image };
    } catch (e) {
      console.error("Pigeonhole:", file.path, e);
      throw new Error(msg.errImage);
    }
  }

  async classifyFile(file: TFile, categories: Category[]): Promise<Decision> {
    const subject = isImage(file) ? await this.imageSubject(file) : await this.noteSubject(file);
    const { maxChars, confidenceThreshold } = this.settings;

    const answer = await this.ask(buildRequest(subject, categories, maxChars));
    const decision = decide(answer, categories, confidenceThreshold);
    if (decision.action !== "move") return decision;

    const children = named(decision.category.children ?? []);
    let sub: Category | undefined;
    if (children.length > 0) {
      // Images are sent again here; they were encoded once above.
      const subAnswer = await this.ask(
        buildRequest(subject, children, maxChars, decision.category),
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

    if (isImage(file)) {
      // Recorded before the move; the rename handler carries it to the new path.
      this.settings.classifiedImages[file.path] = sub
        ? `${category.name}/${sub.name}`
        : category.name;
      await this.saveSettings();
    } else {
      const [head, ...rest] = category.name.split("/");
      const subName = sub ? sub.name : rest.join("/");

      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm[this.settings.propertyName] = head;
        if (!this.settings.subPropertyName) return;
        if (subName !== "") fm[this.settings.subPropertyName] = subName;
        else delete fm[this.settings.subPropertyName];
      });
    }

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
        render: (setting) => {
          setting.addComponent((el) =>
            new SecretComponent(this.app, el).setValue(s.apiKeySecret).onChange((id) => {
              s.apiKeySecret = id;
              void this.plugin.saveSettings();
            }),
          );
        },
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
      {
        name: msg.setFolderDepth,
        desc: msg.setFolderDepthDesc,
        control: { type: "number", key: "maxFolderDepth", min: 0 },
      },
      { name: msg.setMaxChars, control: { type: "number", key: "maxChars", min: 1 } },
      {
        name: msg.setNoteImages,
        desc: msg.setNoteImagesDesc,
        control: { type: "toggle", key: "noteImages" },
      },
      {
        name: msg.setMaxImages,
        control: { type: "number", key: "maxImages", min: 1, max: MAX_IMAGES },
      },
      {
        name: msg.setImageTargets,
        desc: msg.setImageTargetsDesc,
        control: { type: "toggle", key: "imageTargets" },
      },
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
        name: msg.setReclassify,
        desc: msg.setReclassifyDesc,
        control: { type: "toggle", key: "reclassify" },
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
      assign(s, key, next);
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
