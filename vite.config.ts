import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    target: "es2018",
    outDir: ".",
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: "main.ts", formats: ["cjs"], fileName: () => "main.js" },
    rollupOptions: { external: ["obsidian", "electron"] },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // The real module only exists inside Obsidian; tests get a stand-in.
    alias: { obsidian: fileURLToPath(new URL("./tests/obsidian.ts", import.meta.url)) },
  },
});
