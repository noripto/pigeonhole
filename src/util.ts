export const header = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];

export const logError = (e: unknown) => console.error("Pigeonhole:", e);

export const joinFolder = (parent: string, child: string) =>
  parent === "" || child === "" ? parent || child : `${parent}/${child}`;
