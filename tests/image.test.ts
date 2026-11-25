import { describe, expect, test } from "vitest";
import { fit, imageMime } from "../src/image.ts";

describe("fit", () => {
  test("shrinks a large photo to the longest allowed side", () => {
    expect(fit(4000, 3000)).toEqual({
      width: 1568,
      height: 1176,
      drawWidth: 1568,
      drawHeight: 1176,
    });
  });

  test("enlarges a small image until the short side is allowed", () => {
    expect(fit(100, 50)).toEqual({ width: 560, height: 280, drawWidth: 560, drawHeight: 280 });
  });

  test("pads the short side when the aspect ratio cannot fit", () => {
    expect(fit(10000, 100)).toEqual({ width: 1568, height: 280, drawWidth: 1568, drawHeight: 16 });
  });

  test("handles a single pixel", () => {
    expect(fit(1, 1)).toEqual({ width: 280, height: 280, drawWidth: 280, drawHeight: 280 });
  });

  test("leaves an image already in range alone", () => {
    expect(fit(800, 600)).toEqual({ width: 800, height: 600, drawWidth: 800, drawHeight: 600 });
  });
});

describe("imageMime", () => {
  test("knows image extensions in any case", () => {
    expect(imageMime("PNG")).toBe("image/png");
    expect(imageMime("jpeg")).toBe("image/jpeg");
    expect(imageMime("svg")).toBe("image/svg+xml");
  });

  test("returns undefined for other files", () => {
    expect(imageMime("md")).toBeUndefined();
    expect(imageMime("pdf")).toBeUndefined();
    expect(imageMime("heic")).toBeUndefined();
  });
});
