import { ItemView, MarkdownRenderer, type TFile, type WorkspaceLeaf } from "obsidian";
import { msg } from "./i18n.ts";

export const RESULT_VIEW = "pigeonhole-result";

export type RunResult = {
  moved: { path: string; from: string; to: string }[];
  tagged: { path: string; name: string }[];
  skipped: { path: string; reason: string }[];
  failed: { path: string; error: string }[];
  changes: { file: TFile; path: string; prev: Record<string, unknown> }[];
  undone?: boolean;
};

const cell = (text: string) => text.split("|").join("\\|");

const link = (path: string) => {
  const target = path.replace(/\.md$/, "");
  return `[[${target}|${target.split("/").pop() ?? target}]]`;
};

const folder = (path: string) => `\`${path}\``;

export class ResultView extends ItemView {
  result: () => RunResult | null;
  undo: (result: RunResult) => Promise<void>;

  constructor(
    leaf: WorkspaceLeaf,
    result: () => RunResult | null,
    undo: (result: RunResult) => Promise<void>,
  ) {
    super(leaf);
    this.result = result;
    this.undo = undo;
  }

  getViewType(): string {
    return RESULT_VIEW;
  }

  getDisplayText(): string {
    return msg.resultTitle;
  }

  getIcon(): string {
    return "inbox";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    this.contentEl.empty();
    const result = this.result();
    if (result && result.changes.length > 0 && !result.undone) {
      const button = this.contentEl.createEl("button", { text: msg.undo, cls: "mod-warning" });
      button.onclick = () => {
        button.disabled = true;
        void this.undo(result);
      };
    }
    const body = this.contentEl
      .createDiv({ cls: "markdown-preview-view markdown-rendered is-readable-line-width" })
      .createDiv({ cls: "markdown-preview-sizer markdown-preview-section" });
    await MarkdownRenderer.render(this.app, this.markdown(), body, "", this);
  }

  private markdown(): string {
    const result = this.result();
    if (result === null) return msg.resultEmpty;

    const lines = [
      `# ${msg.resultTitle}`,
      "",
      `> [!info] ${msg.summary(result.moved.length, result.skipped.length, result.failed.length)}`,
    ];

    const table = (heading: string, columns: string[], rows: string[][]) => {
      if (rows.length === 0) return;
      lines.push(
        "",
        `## ${heading} (${rows.length})`,
        "",
        `| ${columns.join(" | ")} |`,
        `|${" --- |".repeat(columns.length)}`,
      );
      for (const row of rows) lines.push(`| ${row.map(cell).join(" | ")} |`);
    };

    table(
      msg.resultMoved,
      [msg.colNote, msg.colFrom, msg.colDestination],
      result.moved.map((m) => [link(m.path), folder(m.from), folder(m.to)]),
    );
    table(
      msg.resultTagged,
      [msg.colNote, msg.colCategory],
      result.tagged.map((t) => [link(t.path), t.name]),
    );
    table(
      msg.resultSkipped,
      [msg.colNote, msg.colReason],
      result.skipped.map((s) => [link(s.path), s.reason]),
    );
    table(
      msg.resultFailed,
      [msg.colNote, msg.colError],
      result.failed.map((f) => [link(f.path), f.error]),
    );

    return lines.join("\n");
  }
}
