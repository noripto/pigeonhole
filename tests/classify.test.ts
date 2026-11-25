import { describe, expect, test } from "vitest";
import { MODEL, OTHER, buildRequest, decide, type Category } from "../classify.ts";
import { msg } from "../i18n.ts";

const meeting: Category = { name: "meeting", description: "Notes from a meeting", folder: "m" };
const idea: Category = { name: "idea", description: "", folder: "i" };
const cats = [meeting, idea];

const note = (content: string, images: string[] = []) =>
  ({ kind: "note", title: "Weekly sync", content, images }) as const;

describe("decide", () => {
  test("moves to the chosen attribute when confident", () => {
    expect(decide({ choice: "meeting", confidence: 0.9 }, cats, 0.6)).toEqual({
      action: "move",
      category: meeting,
    });
  });

  test("skips a response without a choice", () => {
    expect(decide(undefined, cats, 0.6)).toEqual({
      action: "skip",
      reason: { code: "badResponse" },
    });
    expect(decide({ confidence: 1 }, cats, 0.6).action).toBe("skip");
  });

  test("skips when nothing fits", () => {
    expect(decide({ choice: OTHER, confidence: 1 }, cats, 0.6)).toEqual({
      action: "skip",
      reason: { code: "noMatch" },
    });
  });

  test("skips below the threshold and names the two most likely attributes", () => {
    const answer = {
      choice: "meeting",
      confidence: 0.4,
      probabilities: { idea: 0.25, meeting: 0.4, [OTHER]: 0.35 },
    };
    expect(decide(answer, cats, 0.6)).toEqual({
      action: "skip",
      reason: {
        code: "lowConfidence",
        confidence: 0.4,
        threshold: 0.6,
        top: `meeting 40% / ${OTHER} 35%`,
      },
    });
  });

  test("treats a missing confidence as zero", () => {
    expect(decide({ choice: "meeting" }, cats, 0.6)).toMatchObject({
      reason: { code: "lowConfidence", confidence: 0, top: "-" },
    });
  });

  test("skips a label that is not one of the attributes", () => {
    expect(decide({ choice: "recipe", confidence: 0.9 }, cats, 0.6)).toEqual({
      action: "skip",
      reason: { code: "unknownLabel", label: "recipe" },
    });
  });
});

describe("msg.skip", () => {
  test("shows the low-confidence reason without the internal label", () => {
    const reason = {
      code: "lowConfidence",
      confidence: 0.4,
      threshold: 0.6,
      top: `${OTHER} 50% / idea 30%`,
    } as const;
    expect(msg.skip(reason)).toBe("confidence 0.40 < 0.6 (none 50% / idea 30%)");
  });
});

describe("buildRequest", () => {
  test("sends a text-only note without assets", () => {
    const body = buildRequest(note("abcdef"), cats, 3);
    expect(body).toEqual({
      model: MODEL,
      state: { title: "Weekly sync", content: "abc" },
      questions: {
        category: {
          type: "choice",
          instructions: expect.stringContaining("`title` and `content`"),
          criteria: {
            meeting: "Notes from a meeting",
            idea: "idea",
            [OTHER]: "None of the above attributes fit this note.",
          },
        },
      },
    });
  });

  test("references every note image from state and sends each once", () => {
    const body = buildRequest(note("text", ["A", "B"]), cats, 100);
    const refs = body.state.images;
    expect(refs).toEqual(Object.keys(body.assets ?? {}));
    expect(Object.values(body.assets ?? {})).toEqual([
      { type: "image", format: "jpg", data_base64: "A" },
      { type: "image", format: "jpg", data_base64: "B" },
    ]);
    expect(body.questions.category).toMatchObject({
      instructions: expect.stringContaining("`images`"),
    });
  });

  test("keeps image references out of the truncated content", () => {
    const body = buildRequest(note("x".repeat(50), ["A"]), cats, 10);
    expect(body.state.content).toBe("x".repeat(10));
    expect(body.state.images).toHaveLength(1);
  });

  test("describes an image file by its picture and file name", () => {
    const body = buildRequest({ kind: "image", title: "cat.png", image: "A" }, cats, 100);
    expect(body.state).toEqual({ title: "cat.png", image: Object.keys(body.assets ?? {})[0] });
    expect(body.questions.category).toMatchObject({
      instructions: expect.stringContaining("`image`"),
      criteria: { [OTHER]: "None of the above attributes fit this image." },
    });
  });

  test("asks for a narrower attribute under a parent", () => {
    const body = buildRequest(note("text"), [idea], 100, meeting);
    expect(body.state.attribute).toBe("Notes from a meeting");
    expect(body.questions.category).toMatchObject({
      instructions: expect.stringContaining("narrower attributes"),
      criteria: { [OTHER]: "None of the sub-attributes of meeting fit this note." },
    });
  });

  test("uses fresh references for each request", () => {
    const a = buildRequest(note("text", ["A"]), cats, 100);
    const b = buildRequest(note("text", ["A"]), cats, 100);
    expect(a.state.images).not.toEqual(b.state.images);
  });
});
