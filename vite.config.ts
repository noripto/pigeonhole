import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2018",
    outDir: ".",
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: "main.ts", formats: ["cjs"], fileName: () => "main.js" },
    rollupOptions: { external: ["obsidian", "electron"] },
  },
});
