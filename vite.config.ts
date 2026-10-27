/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Ship the build as dist/xer-viewer.html instead of dist/index.html.
function renameHtml(name: string): Plugin {
  return {
    name: "rename-html",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (html) html.fileName = name;
    },
  };
}

export default defineConfig({
  plugins: [viteSingleFile(), renameHtml("xer-viewer.html")],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: { environment: "node" },
});
