export const OTHER = "__other__";

export type Category = { name: string; description: string; folder: string };

export type ChoiceAnswer = {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type Decision = { action: "move"; category: Category } | { action: "skip"; reason: string };

export function buildRequest(
  content: string,
  title: string,
  cats: Category[],
  maxChars: number,
): object {
  const criteria: Record<string, string> = {};
  for (const c of cats) criteria[c.name] = c.description || c.name;
  criteria[OTHER] = "None of the above attributes fit this note.";

  return {
    state: { title, content: content.slice(0, maxChars) },
    model: "jev-latest",
    questions: {
      category: {
        type: "choice",
        instructions:
          "Which attribute best describes this note? Judge the note as a whole, using `title` and `content`.",
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
    return { action: "skip", reason: "予期しない API レスポンス（choice が無い）" };
  }
  if (answer.choice === OTHER) {
    return { action: "skip", reason: "どの属性にも当てはまらないと判定された" };
  }

  const confidence = typeof answer.confidence === "number" ? answer.confidence : 0;
  if (confidence < threshold) {
    return {
      action: "skip",
      reason: `confidence ${confidence.toFixed(2)} < ${threshold}（${top2(answer.probabilities)}）`,
    };
  }

  const category = cats.find((c) => c.name === answer.choice);
  if (!category) {
    return { action: "skip", reason: `未知の属性名: ${answer.choice}` };
  }
  return { action: "move", category };
}

function top2(probabilities?: Record<string, number>): string {
  if (!probabilities) return "確率分布なし";
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, p]) => `${name} ${Math.round(p * 100)}%`)
    .join(" / ");
}
