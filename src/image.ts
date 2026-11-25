import type { TFile } from "obsidian";

// Jev accepts PNG or JPEG with each side between these bounds, and rejects anything else.
const MIN_SIDE = 280;
const MAX_SIDE = 1568;

const MIME = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["bmp", "image/bmp"],
  ["svg", "image/svg+xml"],
  ["avif", "image/avif"],
]);

export const imageMime = (ext: string): string | undefined => MIME.get(ext.toLowerCase());

export const isImage = (file: TFile) => imageMime(file.extension) !== undefined;

export type Fit = { width: number; height: number; drawWidth: number; drawHeight: number };

// Scale into the allowed range; when the aspect ratio makes that impossible, pad the short side.
export const fit = (w: number, h: number): Fit => {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  let s = Math.min(1, MAX_SIDE / long);
  s = Math.max(s, MIN_SIDE / short);
  s = Math.min(s, MAX_SIDE / long);
  const drawWidth = Math.max(1, Math.round(w * s));
  const drawHeight = Math.max(1, Math.round(h * s));
  return {
    width: Math.max(MIN_SIDE, drawWidth),
    height: Math.max(MIN_SIDE, drawHeight),
    drawWidth,
    drawHeight,
  };
};

// Every image is re-encoded: <img> applies EXIF orientation, which the API does not,
// and the metadata (GPS included) is dropped before upload.
export const toJpegBase64 = async (data: ArrayBuffer, mime: string): Promise<string> => {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // An SVG without width and height has no natural size.
    const size = fit(img.naturalWidth || 1024, img.naturalHeight || 1024);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(
      img,
      (size.width - size.drawWidth) / 2,
      (size.height - size.drawHeight) / 2,
      size.drawWidth,
      size.drawHeight,
    );
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
};
