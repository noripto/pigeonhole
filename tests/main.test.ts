import { PluginSettingTab, type TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MODEL, OTHER, type Category } from "../classify.ts";
import { msg } from "../i18n.ts";
import type PigeonholePlugin from "../main.ts";
import { answer, bytes, requests, serve, setSleep, setup, yieldSleep } from "./fake-app.ts";
import { http, modal, notices, pluginState, resetStub } from "./obsidian.ts";

vi.mock("../image.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../image.ts")>();
  return {
    ...real,
    // Node has no canvas. The fake encoding keeps the source visible in the request.
    toJpegBase64: async (data: ArrayBuffer, mime: string) => {
      const text = new TextDecoder().decode(data);
      if (text === "broken") throw new Error("decode failed");
      return `${mime}:${text}`;
    },
  };
});

const meeting: Category = { name: "meeting", description: "Meeting notes", folder: "meeting" };
const idea: Category = { name: "idea", description: "Ideas", folder: "" };
const photo: Category = { name: "photo", description: "Photos", folder: "photos" };

const paths = (files: TFile[]) => files.map((f) => f.path);

const run = (plugin: PigeonholePlugin, files: TFile[], mode: "single" | "bulk" | "auto") =>
  plugin["run"](files, mode);

// The images a request sent with the note, in the order `state.images` lists them.
const assetData = (i: number) => {
  const body = requests()[i];
  const refs: unknown = body?.state.images;
  if (!Array.isArray(refs)) return undefined;
  return refs.map((ref) => (typeof ref === "string" ? body?.assets?.[ref]?.data_base64 : ref));
};

// Notices other than the progress one every run shows.
const shown = () => notices.filter((n) => n !== `Pigeonhole: ${msg.working}`);

const apiCalls = () => http.calls.filter((c) => c.method === "POST");

// Date.now() moves only when the plugin sleeps; returns the total time slept.
const fakeClock = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let waited = 0;
  setSleep(async (ms) => {
    waited += ms;
    vi.setSystemTime(Date.now() + ms);
  });
  return () => waited;
};

beforeEach(() => {
  resetStub();
  setSleep(yieldSleep);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("loading", () => {
  test("adds the default attributes on first run", async () => {
    const { plugin } = await setup({}, null);
    expect(plugin.settings.categories.map((c) => c.name)).toEqual(["meeting", "idea", "reference"]);
    expect(pluginState(plugin).data).toMatchObject({ categories: plugin.settings.categories });
    expect(shown()).toEqual([`Pigeonhole: ${msg.defaultsAdded}`]);
  });

  test("moves a key saved by an old version into secret storage", async () => {
    const { vault, plugin } = await setup({}, { apiKey: "old-key", categories: [] });
    expect(vault.secrets.get("pigeonhole-api-key")).toBe("old-key");
    expect(pluginState(plugin).data).not.toHaveProperty("apiKey");
  });
});

describe("targets", () => {
  test("takes unclassified notes outside excluded folders", async () => {
    const { vault, plugin } = await setup({
      "a.md": {},
      "done.md": { frontmatter: { category: "idea" } },
      "private/b.md": {},
      "pic.png": { data: bytes("p") },
    });
    plugin.settings.excludePaths = ["private"];
    expect(paths(plugin["targetsIn"](vault.root))).toEqual(["a.md"]);

    plugin.settings.reclassify = true;
    expect(paths(plugin["targetsIn"](vault.root))).toEqual(["a.md", "done.md"]);
  });

  test("takes only images no note links to, when image files are on", async () => {
    const { vault, plugin } = await setup(
      {
        "note.md": { body: "![[shown.png]]" },
        "shown.png": { data: bytes("s") },
        "loose.png": { data: bytes("l") },
        "done.png": { data: bytes("d") },
        "private/x.png": { data: bytes("x") },
      },
      { classifiedImages: { "done.png": "photo" }, excludePaths: ["private"] },
    );
    vault.resolvedLinks = { "note.md": { "shown.png": 1 } };
    expect(paths(plugin["targetsIn"](vault.root))).toEqual(["note.md"]);

    plugin.settings.imageTargets = true;
    expect(paths(plugin["targetsIn"](vault.root))).toEqual(["note.md", "loose.png"]);

    plugin.settings.reclassify = true;
    expect(paths(plugin["targetsIn"](vault.root))).toEqual(["note.md", "loose.png", "done.png"]);
  });
});

describe("candidates", () => {
  test("adds folders after the attributes, with a few note titles", async () => {
    const notes = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f"].map((n) => [`projects/${n}.md`, {}]),
    );
    const { plugin } = await setup(
      {
        ...notes,
        "projects/pic.png": { data: bytes("p") },
        "projects/alpha/x.md": {},
        "meeting/x.md": {},
        "archive/x.md": {},
        "empty/sub/x.md": {},
      },
      {
        categories: [meeting, { name: "", description: "", folder: "" }],
        excludePaths: ["archive"],
      },
    );
    expect(plugin["candidates"]()).toEqual([
      meeting,
      {
        name: "projects",
        description: "projects (a, b, c, d, e)",
        folder: "projects",
      },
      { name: "projects/alpha", description: "projects/alpha (x)", folder: "projects/alpha" },
      { name: "empty", description: "empty", folder: "empty" },
      { name: "empty/sub", description: "empty/sub (x)", folder: "empty/sub" },
    ]);

    plugin.settings.maxFolderDepth = 1;
    expect(plugin["candidates"]().map((c) => c.name)).toEqual(["meeting", "projects", "empty"]);
  });
});

describe("classifying a note", () => {
  const load = (fm?: Record<string, unknown>, cats: Category[] = [meeting, idea]) =>
    setup(
      { "inbox/a.md": { frontmatter: fm, body: "Agenda and decisions" } },
      { categories: cats },
    );

  test("sets the property and moves the note, without sending its frontmatter", async () => {
    const { vault, plugin } = await load({ tags: ["x"] });
    const file = vault.file("inbox/a.md");
    serve([answer("meeting")]);
    await run(plugin, [file], "single");

    expect(file.path).toBe("meeting/a.md");
    expect(vault.entries.get("meeting/a.md")?.frontmatter).toEqual({
      tags: ["x"],
      category: "meeting",
    });
    const [body] = requests();
    expect(body?.model).toBe(MODEL);
    expect(body?.state).toEqual({ title: "a", content: "Agenda and decisions" });
    expect(body?.assets).toBeUndefined();
    expect(http.calls[0]?.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(shown()).toEqual([`Pigeonhole: ${msg.summary(1, 0, 0)}`]);
  });

  test("only tags when the attribute has no folder, and clears a stale subproperty", async () => {
    const { vault, plugin } = await load({ category: "meeting", subcategory: "weekly" });
    const file = vault.file("inbox/a.md");
    serve([answer("idea")]);
    await run(plugin, [file], "single");

    expect(file.path).toBe("inbox/a.md");
    expect(vault.entries.get("inbox/a.md")?.frontmatter).toEqual({ category: "idea" });
    expect(shown()).toEqual([`Pigeonhole: ${msg.tagged("idea")}`]);
  });

  test("splits a folder-style attribute name into property and subproperty", async () => {
    const work: Category = { name: "work/meeting", description: "", folder: "work/meeting" };
    const { vault, plugin } = await load(undefined, [work]);
    serve([answer("work/meeting")]);
    await run(plugin, [vault.file("inbox/a.md")], "single");

    expect(vault.entries.get("work/meeting/a.md")?.frontmatter).toEqual({
      category: "work",
      subcategory: "meeting",
    });
  });

  test("asks again among the children and moves into the child folder", async () => {
    const weekly: Category = { name: "weekly", description: "Weekly sync", folder: "weekly" };
    const { vault, plugin } = await load(undefined, [{ ...meeting, children: [weekly] }]);
    serve([answer("meeting"), answer("weekly")]);
    await run(plugin, [vault.file("inbox/a.md")], "single");

    expect(vault.entries.get("meeting/weekly/a.md")?.frontmatter).toEqual({
      category: "meeting",
      subcategory: "weekly",
    });
    const second = requests()[1];
    expect(second?.state.attribute).toBe("Meeting notes");
    expect(second?.questions.category).toMatchObject({
      criteria: { weekly: "Weekly sync", [OTHER]: expect.any(String) },
    });
  });

  test("stays in the parent folder when unsure about the child", async () => {
    const weekly: Category = { name: "weekly", description: "", folder: "weekly" };
    const { vault, plugin } = await load(undefined, [{ ...meeting, children: [weekly] }]);
    serve([answer("meeting"), answer("weekly", 0.2)]);
    await run(plugin, [vault.file("inbox/a.md")], "single");

    expect(vault.entries.get("meeting/a.md")?.frontmatter).toEqual({ category: "meeting" });
  });

  test("leaves the note alone when unsure", async () => {
    const { vault, plugin } = await load();
    const file = vault.file("inbox/a.md");
    serve([answer("meeting", 0.3)]);
    await run(plugin, [file], "single");

    expect(file.path).toBe("inbox/a.md");
    expect(vault.frontmatterWrites).toBe(0);
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toContain("0.30 < 0.6");
  });

  test("numbers the name when the destination is taken", async () => {
    const { vault, plugin } = await setup(
      { "a.md": {}, "meeting/a.md": {}, "meeting/a 1.md": {} },
      { categories: [meeting] },
    );
    const file = vault.file("a.md");
    serve([answer("meeting")]);
    await run(plugin, [file], "single");

    expect(file.path).toBe("meeting/a 2.md");
  });

  test("fails without touching the note when the folder is missing and may not be created", async () => {
    const { vault, plugin } = await load();
    plugin.settings.createMissingFolder = false;
    serve([answer("meeting")]);
    await run(plugin, [vault.file("inbox/a.md")], "single");

    expect(vault.get("inbox/a.md")).not.toBeNull();
    expect(vault.frontmatterWrites).toBe(0);
    expect(shown()).toEqual([`Pigeonhole: ${msg.errMissingFolder("meeting")}`]);
  });

  test("sends nothing without an API key", async () => {
    const { vault, plugin } = await load();
    vault.secrets.clear();
    await run(plugin, [vault.file("inbox/a.md")], "single");

    expect(http.calls).toEqual([]);
    expect(shown()).toEqual([`Pigeonhole: ${msg.noApiKey}`]);
  });
});

describe("API errors", () => {
  const two = async () => {
    const { vault, plugin } = await setup({ "a.md": {}, "b.md": {} }, { categories: [meeting] });
    modal.accept = true;
    return { vault, plugin, files: [vault.file("a.md"), vault.file("b.md")] };
  };

  test("waits as long as Retry-After says, then retries", async () => {
    const waited = fakeClock();
    const { vault, plugin } = await setup({ "a.md": {} }, { categories: [meeting] });
    serve([{ status: 429, headers: { "Retry-After": "5" } }, answer("meeting")]);
    await run(plugin, [vault.file("a.md")], "single");

    expect(waited()).toBe(5000);
    expect(vault.get("meeting/a.md")).not.toBeNull();
  });

  test("backs off on 529 and stops the whole run when it does not clear", async () => {
    const waited = fakeClock();
    const { vault, plugin, files } = await two();
    serve([{ status: 529, text: "overloaded" }]);
    await run(plugin, files, "bulk");

    expect(apiCalls()).toHaveLength(4);
    expect(waited()).toBe(2000 + 4000 + 8000);
    expect(plugin["lastResult"]?.failed).toEqual([{ path: "a.md", error: "API 529: overloaded" }]);
    expect(vault.get("b.md")).not.toBeNull();
  });

  test("goes on to the next note after an ordinary error", async () => {
    const { vault, plugin, files } = await two();
    serve([{ status: 500, text: "oops" }, answer("meeting")]);
    await run(plugin, files, "bulk");

    expect(plugin["lastResult"]?.failed).toEqual([{ path: "a.md", error: "API 500: oops" }]);
    expect(vault.get("meeting/b.md")).not.toBeNull();
  });

  test("stops at once on a rejected key", async () => {
    const { plugin, files } = await two();
    serve([{ status: 401, text: "bad key" }]);
    await run(plugin, files, "bulk");

    expect(apiCalls()).toHaveLength(1);
  });

  test("stops waiting when the user stops the run", async () => {
    const { vault, plugin } = await setup({ "a.md": {} }, { categories: [meeting] });
    setSleep(async () => {
      plugin["stopRequested"] = true;
    });
    serve([{ status: 529, text: "" }]);
    await run(plugin, [vault.file("a.md")], "single");

    expect(apiCalls()).toHaveLength(1);
  });

  test("reports a response that is not JSON", async () => {
    const { vault, plugin } = await setup({ "a.md": {} }, { categories: [meeting] });
    serve([{ status: 200, text: "<html>" }]);
    await run(plugin, [vault.file("a.md")], "single");

    expect(shown()).toEqual([`Pigeonhole: ${msg.errNotJson}`]);
  });
});

describe("bulk runs", () => {
  test("ask first, and do nothing when declined", async () => {
    const { vault, plugin } = await setup({ "a.md": {} }, { categories: [meeting] });
    await run(plugin, [vault.file("a.md")], "bulk");

    expect(modal.opened).toBe(1);
    expect(http.calls).toEqual([]);
  });

  test("say so when there is nothing to classify", async () => {
    const { plugin } = await setup({}, { categories: [meeting] });
    await run(plugin, [], "bulk");

    expect(shown()).toEqual([`Pigeonhole: ${msg.nothingToDo}`]);
  });

  test("do not start while another run is going", async () => {
    const { vault, plugin } = await setup({ "a.md": {} }, { categories: [meeting] });
    plugin["running"] = true;
    await run(plugin, [vault.file("a.md")], "single");

    expect(shown()).toEqual([`Pigeonhole: ${msg.busy}`]);
    expect(http.calls).toEqual([]);
  });
});

describe("undo", () => {
  test("restores the properties and the place, renaming when the old path is taken", async () => {
    const { vault, plugin } = await setup(
      { "inbox/a.md": { frontmatter: { category: "old" } } },
      { categories: [{ ...meeting, children: [{ name: "weekly", description: "", folder: "" }] }] },
    );
    const file = vault.file("inbox/a.md");
    modal.accept = true;
    serve([answer("meeting"), answer("weekly")]);
    await run(plugin, [file], "bulk");
    expect(file.path).toBe("meeting/a.md");

    vault.add("inbox/a.md", {});
    const result = plugin["lastResult"];
    if (!result) throw new Error("no result");
    await plugin["undo"](result);

    expect(file.path).toBe("inbox/a 1.md");
    expect(vault.entries.get("inbox/a 1.md")?.frontmatter).toEqual({ category: "old" });
    expect(result.undone).toBe(true);
    expect(shown()).toContain(`Pigeonhole: ${msg.undone(1, 1)}`);
  });
});

describe("classify on save", () => {
  const load = async (entries: string[]) => {
    const { vault, plugin } = await setup(Object.fromEntries(entries.map((p) => [p, {}])), {
      categories: [meeting],
      autoOnSave: true,
    });
    const save = (path: string) => vault.trigger("modify", vault.file(path));
    return { vault, plugin, save };
  };

  test("does nothing when turned off", async () => {
    const { plugin, save } = await load(["a.md"]);
    plugin.settings.autoOnSave = false;
    save("a.md");
    expect(plugin["pending"].size).toBe(0);
  });

  test("classifies saved notes, but waits on the one still open", async () => {
    const { vault, plugin, save } = await load(["a.md", "b.md"]);
    vault.active = vault.file("b.md");
    save("a.md");
    save("b.md");
    serve([answer("meeting")]);
    await plugin["drain"]();

    expect(vault.get("meeting/a.md")).not.toBeNull();
    expect([...plugin["pending"]]).toEqual(["b.md"]);
  });

  test("does not ask again about a note it gave up on", async () => {
    const { plugin, save } = await load(["a.md"]);
    save("a.md");
    serve([answer("meeting", 0.1)]);
    await plugin["drain"]();

    save("a.md");
    expect(plugin["pending"].size).toBe(0);
    expect(apiCalls()).toHaveLength(1);
  });

  test("asks before classifying many notes at once, and remembers a no", async () => {
    const names = Array.from({ length: 11 }, (_, i) => `n${i}.md`);
    const { plugin, save } = await load(names);
    for (const name of names) save(name);
    await plugin["drain"]();

    expect(modal.opened).toBe(1);
    expect(http.calls).toEqual([]);
    save("n0.md");
    expect(plugin["pending"].size).toBe(0);
  });
});

describe("images in notes", () => {
  const load = (body: string, entries: Record<string, string> = {}, fm?: Record<string, unknown>) =>
    setup(
      {
        "a.md": { body, frontmatter: fm },
        ...Object.fromEntries(Object.entries(entries).map(([p, d]) => [p, { data: bytes(d) }])),
      },
      { categories: [meeting], noteImages: true },
    );

  const image = (text: string, type = "image/png") => ({
    status: 200,
    headers: { "Content-Type": `${type}; charset=binary` },
    data: bytes(text).slice().buffer,
  });

  test("are not read when turned off", async () => {
    const { vault, plugin } = await load("![[p.png]]", { "p.png": "P" });
    plugin.settings.noteImages = false;
    serve([answer("meeting")]);
    await run(plugin, [vault.file("a.md")], "single");

    expect(requests()[0]?.assets).toBeUndefined();
    expect(apiCalls()[0]?.headers).not.toHaveProperty("TypeSafe-Danger-Zone-Images");
  });

  test("go with the note in document order, once each", async () => {
    const { vault, plugin } = await load(
      "![[a.png]]\n![](https://x.test/b.png)\n![c](img/c.png)\n![[a.png]]",
      { "a.png": "A", "img/c.png": "C" },
      { cover: "![](https://x.test/cover.png)" },
    );
    serve([answer("meeting")], { "https://x.test/b.png": image("B") });
    await run(plugin, [vault.file("a.md")], "single");

    expect(assetData(0)).toEqual(["image/png:A", "image/png:B", "image/png:C"]);
    expect(apiCalls()[0]?.headers).toMatchObject({ "TypeSafe-Danger-Zone-Images": "true" });
    expect(http.calls.map((c) => c.url)).not.toContain("https://x.test/cover.png");
  });

  test("stop at the limit, skipping ones that cannot be read or are excluded", async () => {
    const { vault, plugin } = await load(
      "![[gone.png]] ![[private/p.png]] ![[broken.png]] ![[d.png]] ![[e.png]] ![[f.png]]",
      { "private/p.png": "P", "broken.png": "broken", "d.png": "D", "e.png": "E", "f.png": "F" },
    );
    plugin.settings.excludePaths = ["private"];
    plugin.settings.maxImages = 2;
    vault.add("gone.png", {});
    serve([answer("meeting")]);
    await run(plugin, [vault.file("a.md")], "single");

    expect(assetData(0)).toEqual(["image/png:D", "image/png:E"]);
    expect(vault.get("meeting/a.md")).not.toBeNull();
  });

  test("from URLs are skipped when they fail or time out", async () => {
    const { vault, plugin } = await load(
      "![](https://x.test/404.png) ![](https://x.test/slow.png) ![](https://x.test/page)",
    );
    serve([answer("meeting")], {
      "https://x.test/404.png": { status: 404 },
      "https://x.test/slow.png": new Promise(() => {}),
      // Not labelled as an image: the browser is left to sniff the format.
      "https://x.test/page": image("H", "text/html"),
    });
    await run(plugin, [vault.file("a.md")], "single");

    expect(assetData(0)).toEqual([":H"]);
  });
});

describe("image files", () => {
  const load = async (data = "meow", saved: Record<string, unknown> = {}) => {
    const { vault, plugin } = await setup(
      { "inbox/cat.png": { data: bytes(data) } },
      { categories: [photo], imageTargets: true, ...saved },
    );
    return { vault, plugin, file: vault.file("inbox/cat.png") };
  };

  test("are classified by the picture, moved, and recorded in plugin data", async () => {
    const { vault, plugin, file } = await load();
    serve([answer("photo")]);
    await run(plugin, [file], "single");

    expect(file.path).toBe("photos/cat.png");
    expect(plugin.settings.classifiedImages).toEqual({ "photos/cat.png": "photo" });
    expect(vault.frontmatterWrites).toBe(0);
    const [body] = requests();
    const ref = body?.state.image;
    expect(body?.state.title).toBe("cat.png");
    expect(typeof ref === "string" && body?.assets?.[ref]?.data_base64).toBe("image/png:meow");
    expect(apiCalls()[0]?.headers).toMatchObject({ "TypeSafe-Danger-Zone-Images": "true" });
  });

  test("record the child attribute with its parent", async () => {
    const pet: Category = { name: "pet", description: "", folder: "pet" };
    const { plugin, file } = await load("meow", { categories: [{ ...photo, children: [pet] }] });
    serve([answer("photo"), answer("pet")]);
    await run(plugin, [file], "single");

    expect(plugin.settings.classifiedImages).toEqual({ "photos/pet/cat.png": "photo/pet" });
  });

  test("fail with a clear message when they cannot be decoded", async () => {
    const { plugin, file } = await load("broken");
    await run(plugin, [file], "single");

    expect(http.calls).toEqual([]);
    expect(shown()).toEqual([`Pigeonhole: ${msg.errImage}`]);
  });

  test("get their earlier record back on undo", async () => {
    const { plugin, file } = await load("meow", { classifiedImages: { "inbox/cat.png": "old" } });
    modal.accept = true;
    serve([answer("photo")]);
    await run(plugin, [file], "bulk");
    const result = plugin["lastResult"];
    if (!result) throw new Error("no result");
    await plugin["undo"](result);

    expect(file.path).toBe("inbox/cat.png");
    expect(plugin.settings.classifiedImages).toEqual({ "inbox/cat.png": "old" });
  });

  test("keep their records through renames and deletes", async () => {
    const { vault, plugin } = await load("meow", {
      classifiedImages: { "pics/a.png": "x", "pics/sub/b.png": "y", "picsx/c.png": "z" },
    });
    vault.trigger("rename", vault.folder("archive/pics"), "pics");
    expect(plugin.settings.classifiedImages).toEqual({
      "archive/pics/a.png": "x",
      "archive/pics/sub/b.png": "y",
      "picsx/c.png": "z",
    });

    vault.trigger("delete", vault.folder("archive"));
    expect(plugin.settings.classifiedImages).toEqual({ "picsx/c.png": "z" });
  });
});

describe("the note command", () => {
  const callback = (plugin: PigeonholePlugin) =>
    pluginState(plugin).commands.find((c) => c.id === "classify-current-note")?.callback;

  const open = async (path: string, imageTargets: boolean) => {
    const { vault, plugin } = await setup(
      { [path]: { data: bytes("x") } },
      { categories: [photo], imageTargets },
    );
    vault.active = vault.file(path);
    return { vault, plugin };
  };

  test("asks for a note when an image is open but image files are off", async () => {
    const { plugin } = await open("cat.png", false);
    callback(plugin)?.();
    expect(shown()).toEqual([`Pigeonhole: ${msg.needMarkdown}`]);
  });

  test("mentions images when they are on and something else is open", async () => {
    const { plugin } = await open("doc.pdf", true);
    callback(plugin)?.();
    expect(shown()).toEqual([`Pigeonhole: ${msg.needNoteOrImage}`]);
  });
});

describe("settings tab", () => {
  const tab = async () => {
    const { plugin } = await setup({}, { categories: [meeting] });
    const settingTab = pluginState(plugin).tabs[0];
    if (!(settingTab instanceof PluginSettingTab)) throw new Error("no setting tab");
    return { plugin, settingTab };
  };

  test("cleans up the excluded paths", async () => {
    const { plugin, settingTab } = await tab();
    await settingTab.setControlValue("excludePaths", " a/ \n\n/\n.\nb//c\n");
    expect(plugin.settings.excludePaths).toEqual(["a", "b/c"]);
    expect(settingTab.getControlValue("excludePaths")).toBe("a\nb/c");
  });

  test("trims nested values except descriptions", async () => {
    const { plugin, settingTab } = await tab();
    await settingTab.setControlValue("categories.0.name", " minutes ");
    await settingTab.setControlValue("categories.0.description", " keep spaces ");
    expect(plugin.settings.categories[0]).toMatchObject({
      name: "minutes",
      description: " keep spaces ",
    });
    expect(settingTab.getControlValue("categories.0.name")).toBe("minutes");
  });

  test("falls back to the default property name when cleared", async () => {
    const { plugin, settingTab } = await tab();
    await settingTab.setControlValue("propertyName", "  ");
    expect(plugin.settings.propertyName).toBe("category");
    expect(pluginState(plugin).data).toMatchObject({ propertyName: "category" });
  });
});
