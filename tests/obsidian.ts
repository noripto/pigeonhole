// Stand-in for the `obsidian` module, which only exists inside the app.
// vite.config.ts aliases `obsidian` to this file for tests. It covers what the plugin
// calls; anything a test needs to inspect is exported alongside the stubs.

// Just enough of an HTMLElement: what was created in it, and the text set on it.
export class El {
  tag = "";
  text = "";
  disabled = false;
  onclick: (() => void) | null = null;
  created: El[] = [];
  createEl(tag = "", options?: { text?: string }) {
    const el = new El();
    el.tag = tag;
    el.text = options?.text ?? "";
    this.created.push(el);
    return el;
  }
  createSpan() {
    return this.createEl("span");
  }
  createDiv() {
    return this.createEl("div");
  }
  setText(text: string) {
    this.text = text;
  }
  empty() {
    this.created = [];
  }
}

export const notices: string[] = [];

export class Notice {
  messageEl = new El();
  constructor(message: string) {
    notices.push(message);
  }
  hide() {}
}

export class App {}

export class Menu {
  addItem() {
    return this;
  }
}

// Whether the next confirmation dialog is accepted, and how many were opened.
export const modal = { accept: false, opened: 0 };

type Button = {
  setButtonText: () => Button;
  setCta: () => Button;
  setInitialFocus: () => Button;
  onClick: (handler: () => void) => Button;
};

export class ConfirmationModal {
  app: unknown;
  private handlers: (() => void)[] = [];
  constructor(app: unknown) {
    this.app = app;
  }
  setTitle() {
    return this;
  }
  setContent() {
    return this;
  }
  addButton(build: (button: Button) => void) {
    const button: Button = {
      setButtonText: () => button,
      setCta: () => button,
      setInitialFocus: () => button,
      onClick: (handler) => {
        this.handlers.push(handler);
        return button;
      },
    };
    build(button);
    return this;
  }
  addCancelButton() {
    return this;
  }
  open() {
    modal.opened++;
    if (modal.accept) for (const handler of this.handlers) handler();
    this.onClose();
  }
  onClose() {}
}

export type Command = { id: string; callback?: () => void };

export type PluginState = { data: unknown; tabs: unknown[]; commands: Command[] };

const plugins = new WeakMap<object, PluginState>();

// What a plugin saved, and what it registered.
export const pluginState = (plugin: object): PluginState => {
  const state = plugins.get(plugin);
  if (!state) throw new Error("not a stub plugin");
  return state;
};

export class Plugin {
  app: unknown;
  manifest: unknown;
  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
    plugins.set(this, { data: null, tabs: [], commands: [] });
  }
  async loadData(): Promise<unknown> {
    return structuredClone(pluginState(this).data);
  }
  async saveData(data: unknown) {
    pluginState(this).data = structuredClone(data);
  }
  addSettingTab(tab: unknown) {
    pluginState(this).tabs.push(tab);
  }
  addCommand(command: Command) {
    pluginState(this).commands.push(command);
  }
  registerView() {}
  registerEvent() {}
}

export class PluginSettingTab {
  app: unknown;
  constructor(app: unknown) {
    this.app = app;
  }
  update() {}
}

export class SettingPage {
  containerEl = new El();
  title = "";
}

export class Setting {
  setName() {
    return this;
  }
  setHeading() {
    return this;
  }
  addButton() {
    return this;
  }
  addExtraButton() {
    return this;
  }
  addText() {
    return this;
  }
  addTextArea() {
    return this;
  }
}

export class SecretComponent {
  setValue() {
    return this;
  }
  onChange() {
    return this;
  }
}

export class ItemView {
  leaf: unknown;
  contentEl = new El();
  constructor(leaf: unknown) {
    this.leaf = leaf;
  }
}

// Every Markdown string a view rendered.
export const rendered: string[] = [];

export const MarkdownRenderer = {
  render: async (_app: unknown, markdown: string) => {
    rendered.push(markdown);
  },
};

export class WorkspaceLeaf {}

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  basename = "";
  extension = "";
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot() {
    return this.path === "/";
  }
}

export class Vault {
  static recurseChildren(root: TAbstractFile, cb: (file: TAbstractFile) => void) {
    cb(root);
    if (root instanceof TFolder)
      for (const child of root.children) Vault.recurseChildren(child, cb);
  }
}

// Same rules as Obsidian's: one slash between parts, none at the ends, "/" for the root.
export const normalizePath = (path: string) => {
  const p = path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  return p === "" ? "/" : p;
};

export const getLinkpath = (link: string) => link.split("#")[0] ?? "";

export const getLanguage = () => "en";

// Tests call drain() themselves, so the debounced call is a no-op.
export const debounce = () => Object.assign(() => {}, { cancel: () => {} });

export type FakeRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type FakeResponse = {
  status: number;
  headers?: Record<string, string>;
  text?: string;
  data?: ArrayBuffer;
};

// Every request the plugin sends, and how the fake server answers it.
export const http: {
  calls: FakeRequest[];
  respond: (req: FakeRequest) => FakeResponse | Promise<FakeResponse>;
} = {
  calls: [],
  respond: () => ({ status: 500, text: "no response set" }),
};

export const resetStub = () => {
  notices.length = 0;
  rendered.length = 0;
  http.calls = [];
  http.respond = () => ({ status: 500, text: "no response set" });
  modal.accept = false;
  modal.opened = 0;
};

export const requestUrl = async (req: FakeRequest) => {
  http.calls.push(req);
  const res = await http.respond(req);
  const text = res.text ?? "";
  return {
    status: res.status,
    headers: res.headers ?? {},
    text,
    arrayBuffer: res.data ?? new ArrayBuffer(0),
    get json(): unknown {
      return JSON.parse(text);
    },
  };
};
