/// <reference types="vitest" />
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Ship the build as dist/xer-viewer-v<version>.html instead of dist/index.html.
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
  plugins: [viteSingleFile(), renameHtml(`xer-viewer-v${version}.html`)],
  // Shown in Help > About, on the welcome screen and in Excel exports.
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: { environment: "node" },
});
