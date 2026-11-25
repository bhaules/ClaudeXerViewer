// Help > What's New (from CHANGELOG.md) and version comparison for the update check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareVersions, parseChangelog } from "../src/xer/changelog";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("What's New", () => {
  it("shortens each change to its lead and first sentence, without sub-bullets", () => {
    const md = [
      "# Changelog",
      "Intro text.",
      "## 1.2.0 (2026-01-02)",
      "",
      "### Added",
      "- **Tab icon.** The page has its own icon, so it is",
      "  easy to spot. It works offline.",
      "- **Menus:**",
      "  - one thing",
      "- **File > Open...** opens a `file`.",
      "### Fixed",
      "- Plain bullet.",
      "## 1.1.0",
      "First release:",
      "- **View:** a grid.",
    ].join("\r\n");
    expect(parseChangelog(md)).toEqual([
      {
        version: "1.2.0",
        date: "2026-01-02",
        sections: [
          ["Added", ["Tab icon: The page has its own icon, so it is easy to spot", "Menus", "File > Open: opens a file"]],
          ["Fixed", ["Plain bullet."]],
        ],
      },
      { version: "1.1.0", date: "", sections: [["", ["View: a grid"]]] },
    ]);
  });

  it("starts with the version being built", () => {
    const all = parseChangelog(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
    expect(all[0].version).toBe(version);
    expect(all.every((r) => r.sections.some(([, items]) => items.length > 0))).toBe(true);
  });
});

describe("compareVersions", () => {
  it("compares number by number, not as text", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("v1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "v0.9.0")).toBe(0);
  });
});
