export const OTHER = "__other__";

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

export function buildRequest(
  content: string,
  title: string,
  cats: Category[],
  maxChars: number,
  parent?: Category,
): object {
  const criteria: Record<string, string> = {};
  for (const c of cats) criteria[c.name] = c.description || c.name;
  criteria[OTHER] = parent
    ? `None of the sub-attributes of ${parent.name} fit this note.`
    : "None of the above attributes fit this note.";

  return {
    state: parent
      ? { title, content: content.slice(0, maxChars), attribute: parent.description || parent.name }
      : { title, content: content.slice(0, maxChars) },
    model: "jev-latest",
    questions: {
      category: {
        type: "choice",
        instructions: parent
          ? "This note already matches the attribute described in `attribute`. Which of the following narrower attributes best describes it?"
          : "Which attribute best describes this note? Judge the note as a whole, using `title` and `content`.",
        criteria,
      },
    },
  };
}

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
