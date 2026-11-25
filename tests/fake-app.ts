import { App, TFile, TFolder, type TAbstractFile } from "obsidian";
import { expect } from "vitest";
import { MODEL, type SystemOneRequest } from "../src/classify.ts";
import PigeonholePlugin from "../main.ts";
import { http, pluginState, type FakeResponse } from "./obsidian.ts";

// Obsidian provides `sleep` as a global. Tests replace it to control waiting.
export const setSleep = (fn: (ms: number) => Promise<void>) =>
  Object.defineProperty(globalThis, "sleep", { value: fn, writable: true, configurable: true });

// Yields one macrotask, so anything already settled (such as a fake HTTP reply) wins a race.
export const yieldSleep = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

setSleep(yieldSleep);

export type Entry = {
  frontmatter?: Record<string, unknown>;
  body?: string;
  // Image files: the bytes the plugin reads.
  data?: Uint8Array;
};

type Listener = (...args: unknown[]) => void;

// Vault embeds as Obsidian caches them: wikilinks and Markdown links that are not URLs.
const EMBED = /!\[\[([^\]|#]+)[^\]]*\]\]|!\[[^\]]*\]\((?!https?:)([^)\s]+)\)/g;

// An in-memory vault with the parts of App the plugin uses.
export class FakeVault {
  readonly root = new TFolder();
  readonly entries = new Map<string, Entry>();
  resolvedLinks: Record<string, Record<string, number>> = {};
  active: TFile | null = null;
  frontmatterWrites = 0;
  readonly secrets = new Map<string, string>();
  readonly app: App;
  private listeners = new Map<string, Listener[]>();

  constructor(entries: Record<string, Entry> = {}, folders: string[] = []) {
    this.root.path = "/";
    for (const path of folders) this.folder(path);
    for (const [path, entry] of Object.entries(entries)) this.add(path, entry);
    this.app = toApp(this);
  }

  get(path: string): TAbstractFile | null {
    if (path === "/") return this.root;
    let found: TAbstractFile | null = null;
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child.path === path) found = child;
        else if (child instanceof TFolder) walk(child);
      }
    };
    walk(this.root);
    return found;
  }

  file(path: string): TFile {
    const file = this.get(path);
    if (!(file instanceof TFile)) throw new Error(`no file ${path}`);
    return file;
  }

  folder(path: string): TFolder {
    let parent = this.root;
    for (const part of path.split("/")) {
      const childPath = parent === this.root ? part : `${parent.path}/${part}`;
      const existing = this.get(childPath);
      if (existing instanceof TFolder) {
        parent = existing;
        continue;
      }
      const folder = new TFolder();
      folder.path = childPath;
      folder.name = part;
      folder.parent = parent;
      parent.children.push(folder);
      parent = folder;
    }
    return parent;
  }

  add(path: string, entry: Entry): TFile {
    const slash = path.lastIndexOf("/");
    const parent = slash === -1 ? this.root : this.folder(path.slice(0, slash));
    const file = new TFile();
    this.place(file, path, parent);
    this.entries.set(path, entry);
    return file;
  }

  raw(file: TFile): string {
    const entry = this.entries.get(file.path);
    return this.header(entry) + (entry?.body ?? "");
  }

  header(entry: Entry | undefined): string {
    if (!entry?.frontmatter) return "";
    const lines = Object.entries(entry.frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return `---\n${lines.join("\n")}\n---\n`;
  }

  on(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    return {};
  }

  trigger(name: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(name) ?? []) listener(...args);
  }

  rename(file: TAbstractFile, path: string) {
    if (this.get(path)) throw new Error(`${path} already exists`);
    const slash = path.lastIndexOf("/");
    const parent = this.get(slash === -1 ? "/" : path.slice(0, slash));
    if (!(parent instanceof TFolder)) throw new Error(`no folder for ${path}`);
    const oldPath = file.path;
    file.parent?.children.splice(file.parent.children.indexOf(file), 1);
    this.place(file, path, parent);
    const entry = this.entries.get(oldPath);
    if (entry) {
      this.entries.delete(oldPath);
      this.entries.set(path, entry);
    }
    this.trigger("rename", file, oldPath);
  }

  private place(file: TAbstractFile, path: string, parent: TFolder) {
    file.path = path;
    file.name = path.slice(path.lastIndexOf("/") + 1);
    file.parent = parent;
    parent.children.push(file);
    if (file instanceof TFile) {
      const dot = file.name.lastIndexOf(".");
      file.basename = dot === -1 ? file.name : file.name.slice(0, dot);
      file.extension = dot === -1 ? "" : file.name.slice(dot + 1);
    }
  }
}

const toApp = (fake: FakeVault): App =>
  // Only the parts of App the plugin calls; the rest stays as the stub left it.
  Object.assign(new App(), {
    vault: {
      getRoot: () => fake.root,
      getAbstractFileByPath: (path: string) => fake.get(path),
      cachedRead: async (file: TFile) => fake.raw(file),
      readBinary: async (file: TFile) => {
        const data = fake.entries.get(file.path)?.data;
        if (!data) throw new Error(`no data for ${file.path}`);
        return data.slice().buffer;
      },
      createFolder: async (path: string) => {
        if (fake.get(path)) throw new Error("Folder already exists.");
        fake.folder(path);
      },
      on: (name: string, listener: Listener) => fake.on(name, listener),
    },
    metadataCache: {
      get resolvedLinks() {
        return fake.resolvedLinks;
      },
      getFileCache: (file: TFile) => {
        const entry = fake.entries.get(file.path);
        if (!entry || file.extension !== "md") return null;
        const raw = fake.raw(file);
        const header = fake.header(entry);
        const embeds = [...raw.matchAll(EMBED)].map((m) => ({
          link: m[1] ?? m[2] ?? "",
          original: m[0],
          position: { start: { offset: m.index ?? 0 } },
        }));
        return {
          frontmatter: entry.frontmatter,
          frontmatterPosition: entry.frontmatter
            ? { end: { offset: header.length - 1 } }
            : undefined,
          embeds,
        };
      },
      getFirstLinkpathDest: (link: string) => {
        for (const path of fake.entries.keys()) {
          if (path === link || path.endsWith(`/${link}`)) return fake.file(path);
        }
        return null;
      },
    },
    fileManager: {
      processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const entry = fake.entries.get(file.path);
        if (!entry) throw new Error(`no file ${file.path}`);
        fake.frontmatterWrites++;
        entry.frontmatter ??= {};
        fn(entry.frontmatter);
      },
      renameFile: async (file: TFile, path: string) => fake.rename(file, path),
    },
    workspace: {
      getActiveFile: () => fake.active,
      on: () => ({}),
      getLeavesOfType: () => [],
      getLeaf: () => ({ setViewState: async () => {}, view: null }),
      revealLeaf: async () => {},
    },
    secretStorage: {
      getSecret: (id: string) => fake.secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => fake.secrets.set(id, value),
    },
  });

export const API_URL = "https://api.typesafe.ai/v1/systemone";

export const bytes = (text: string) => new TextEncoder().encode(text);

const MANIFEST = {
  id: "pigeonhole",
  name: "Pigeonhole",
  author: "",
  version: "0.0.0",
  minAppVersion: "0.0.0",
  description: "",
};

// A loaded plugin on a fake vault. `data` is what data.json holds; null means a first run.
export const setup = async (
  entries: Record<string, Entry> = {},
  data: Record<string, unknown> | null = {},
) => {
  const vault = new FakeVault(entries);
  const plugin = new PigeonholePlugin(vault.app, MANIFEST);
  pluginState(plugin).data = data;
  vault.secrets.set("pigeonhole-api-key", "test-key");
  await plugin.onload();
  return { vault, plugin };
};

// TypeSafe answers in turn (the last one repeats); other URLs come from `urls`.
export const serve = (
  api: FakeResponse[],
  urls: Record<string, FakeResponse | Promise<FakeResponse>> = {},
) => {
  let i = 0;
  http.respond = (req) => {
    if (req.url !== API_URL) return urls[req.url] ?? { status: 404 };
    const res = api[Math.min(i++, api.length - 1)];
    if (!res) throw new Error("no API response set");
    return res;
  };
};

export const answer = (choice: string, confidence = 0.9): FakeResponse => ({
  status: 200,
  text: JSON.stringify({ answers: { category: { type: "choice", choice, confidence } } }),
});

// The bodies sent to TypeSafe, in order.
export const requests = (): SystemOneRequest[] =>
  http.calls
    .filter((c) => c.url === API_URL)
    .map((c) => {
      const body: unknown = JSON.parse(c.body ?? "null");
      expect(body).toMatchObject({ model: MODEL, state: {}, questions: {} });
      // The shape was checked just above.
      return body as SystemOneRequest;
    });
