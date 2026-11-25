import { TFile, WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, test } from "vitest";
import { msg } from "../i18n.ts";
import { ResultView, type RunResult } from "../result-view.ts";
import { El, rendered, resetStub } from "./obsidian.ts";

const empty = (): RunResult => ({ moved: [], tagged: [], skipped: [], failed: [], changes: [] });

const show = async (
  result: RunResult | null,
  undo: (result: RunResult) => Promise<void> = async () => {},
) => {
  const view = new ResultView(new WorkspaceLeaf(), () => result, undo);
  await view.render();
  const el = view.contentEl;
  if (!(el instanceof El)) throw new Error("not a stub element");
  return {
    markdown: rendered[rendered.length - 1] ?? "",
    button: el.created.find((c) => c.tag === "button"),
  };
};

beforeEach(resetStub);

describe("ResultView", () => {
  test("says so when nothing has run", async () => {
    expect((await show(null)).markdown).toBe(msg.resultEmpty);
  });

  test("lists each kind of outcome in its own table", async () => {
    const { markdown } = await show({
      ...empty(),
      moved: [{ path: "meeting/a.md", from: "/", to: "meeting" }],
      tagged: [{ path: "b.md", name: "idea" }],
      skipped: [{ path: "img/c.png", reason: "low | confidence" }],
      failed: [{ path: "d.md", error: "API 500" }],
    });
    expect(markdown).toContain(`> [!info] ${msg.summary(1, 1, 1)}`);
    expect(markdown).toContain(`## ${msg.resultMoved} (1)`);
    // The link drops .md, and pipes are escaped so they do not split the table cell.
    expect(markdown).toContain("| [[meeting/a\\|a]] | `/` | `meeting` |");
    expect(markdown).toContain("| [[b\\|b]] | idea |");
    expect(markdown).toContain("| [[img/c.png\\|c.png]] | low \\| confidence |");
    expect(markdown).toContain("| [[d\\|d]] | API 500 |");
  });

  test("leaves out empty tables", async () => {
    const { markdown } = await show({ ...empty(), tagged: [{ path: "b.md", name: "idea" }] });
    expect(markdown).not.toContain(msg.resultMoved);
    expect(markdown).not.toContain(msg.resultFailed);
  });

  test("offers undo once, only when something changed", async () => {
    expect((await show(empty())).button).toBeUndefined();

    const change = { file: new TFile(), path: "a.md", prev: {} };
    const undone: RunResult[] = [];
    const result = { ...empty(), changes: [change] };
    const { button } = await show(result, async (r) => {
      undone.push(r);
    });
    expect(button?.text).toBe(msg.undo);
    button?.onclick?.();
    expect(button?.disabled).toBe(true);
    expect(undone).toEqual([result]);

    expect((await show({ ...result, undone: true })).button).toBeUndefined();
  });
});
