import type { Category } from "./classify.ts";

// Keeps a request well under the API's 32 MiB body limit.
export const MAX_IMAGES = 10;

export const named = (cats: Category[]) => cats.filter((c) => c.name !== "");

export const blank = (): Category => ({ name: "", description: "", folder: "" });

export const DEFAULT_CATEGORIES: Category[] = [
  {
    name: "meeting",
    description:
      "Notes from a meeting or call: who was there, what was decided, what happens next.",
    folder: "meeting",
  },
  {
    name: "idea",
    description: "A thought worth keeping: something half-formed, not yet a plan.",
    folder: "idea",
  },
  {
    name: "reference",
    description: "Material to look up later: steps, specs, findings, collected links.",
    folder: "reference",
  },
];

export type PigeonholeSettings = {
  apiKeySecret: string;
  categories: Category[];
  propertyName: string;
  subPropertyName: string;
  confidenceThreshold: number;
  maxChars: number;
  excludePaths: string[];
  maxFolderDepth: number;
  autoOnSave: boolean;
  reclassify: boolean;
  createMissingFolder: boolean;
  noteImages: boolean;
  maxImages: number;
  imageTargets: boolean;
  // Images have no frontmatter, so the attribute given to each image is kept here, by path.
  classifiedImages: Record<string, string>;
};

export const DEFAULT_SETTINGS: PigeonholeSettings = {
  apiKeySecret: "pigeonhole-api-key",
  categories: [],
  propertyName: "category",
  subPropertyName: "subcategory",
  confidenceThreshold: 0.6,
  maxChars: 4000,
  excludePaths: [],
  maxFolderDepth: 0,
  autoOnSave: false,
  reclassify: false,
  createMissingFolder: true,
  noteImages: false,
  maxImages: 4,
  imageTargets: false,
  classifiedImages: {},
};
