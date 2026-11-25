import {
  PluginSettingTab,
  SecretComponent,
  Setting,
  SettingPage,
  normalizePath,
  type App,
  type SettingDefinitionItem,
  type SettingDefinitionPage,
} from "obsidian";
import type PigeonholePlugin from "../main.ts";
import type { Category } from "./classify.ts";
import { msg } from "./i18n.ts";
import { DEFAULT_SETTINGS, MAX_IMAGES, blank } from "./settings.ts";

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

export class PigeonholeSettingTab extends PluginSettingTab {
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
