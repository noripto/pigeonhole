export const OTHER = "__other__";

// Pinned rather than jev-latest: image input is still a preview feature, so a new release
// could change how notes are classified without notice. Bump it deliberately.
export const MODEL = "jev-1.14.0";

export type Category = {
  name: string;
  description: string;
  folder: string;
  children?: Category[];
};

export type ChoiceAnswer = {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type SkipReason =
  | { code: "badResponse" }
  | { code: "noMatch" }
  | { code: "lowConfidence"; confidence: number; threshold: number; top: string }
  | { code: "unknownLabel"; label: string };

export type Decision =
  | { action: "move"; category: Category }
  | { action: "skip"; reason: SkipReason };

// Images are base64 JPEG, already prepared by image.ts.
export type Subject =
  | { kind: "note"; title: string; content: string; images: string[] }
  | { kind: "image"; title: string; image: string };

type Asset = { type: "image"; format: "jpg"; data_base64: string };

export type SystemOneRequest = {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
  assets?: Record<string, Asset>;
};

export const buildRequest = (
  subject: Subject,
  cats: Category[],
  maxChars: number,
  parent?: Category,
): SystemOneRequest => {
  const noun = subject.kind;
  const criteria: Record<string, string> = {};
  for (const c of cats) criteria[c.name] = c.description || c.name;
  criteria[OTHER] = parent
    ? `None of the sub-attributes of ${parent.name} fit this ${noun}.`
    : `None of the above attributes fit this ${noun}.`;

  // A fresh reference per image per request, so it cannot collide with note text.
  const assets: Record<string, Asset> = {};
  const ref = (data: string) => {
    const key = crypto.randomUUID();
    assets[key] = { type: "image", format: "jpg", data_base64: data };
    return key;
  };

  const state: Record<string, unknown> =
    subject.kind === "note"
      ? { title: subject.title, content: subject.content.slice(0, maxChars) }
      : { title: subject.title, image: ref(subject.image) };
  // A separate field, not references inside `content`: maxChars could cut a reference in half.
  if (subject.kind === "note" && subject.images.length > 0) state.images = subject.images.map(ref);
  if (parent) state.attribute = parent.description || parent.name;

  let instructions: string;
  if (parent) {
    instructions = `This ${noun} already matches the attribute described in \`attribute\`. Which of the following narrower attributes best describes it?`;
  } else if (subject.kind === "image") {
    instructions =
      "Which attribute best describes the picture in `image`? Its file name is in `title`.";
  } else if (subject.images.length > 0) {
    instructions =
      "Which attribute best describes this note? Judge the note as a whole, using `title`, `content`, and the pictures in `images`.";
  } else {
    instructions =
      "Which attribute best describes this note? Judge the note as a whole, using `title` and `content`.";
  }

  const request: SystemOneRequest = {
    state,
    model: MODEL,
    questions: { category: { type: "choice", instructions, criteria } },
  };
  if (Object.keys(assets).length > 0) request.assets = assets;
  return request;
};

export function decide(
  answer: ChoiceAnswer | undefined,
  cats: Category[],
  threshold: number,
): Decision {
  if (!answer || typeof answer.choice !== "string") {
    return { action: "skip", reason: { code: "badResponse" } };
  }
  if (answer.choice === OTHER) {
    return { action: "skip", reason: { code: "noMatch" } };
  }

  const confidence = typeof answer.confidence === "number" ? answer.confidence : 0;
  if (confidence < threshold) {
    return {
      action: "skip",
      reason: { code: "lowConfidence", confidence, threshold, top: top2(answer.probabilities) },
    };
  }

  const category = cats.find((c) => c.name === answer.choice);
  if (!category) {
    return { action: "skip", reason: { code: "unknownLabel", label: answer.choice } };
  }
  return { action: "move", category };
}

function top2(probabilities?: Record<string, number>): string {
  if (!probabilities) return "-";
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, p]) => `${name} ${Math.round(p * 100)}%`)
    .join(" / ");
}
