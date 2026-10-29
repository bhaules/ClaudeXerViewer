// Parses any real .xer files sitting in the project root (they are gitignored)
// and cross-checks counts against a plain line count. Skipped when there are none.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "../src/xer";
import { buildUsageProfile, usageBetween } from "../src/xer/usage";

const root = new URL("../", import.meta.url);
const files = readdirSync(root).filter((f) => f.toLowerCase().endsWith(".xer"));

function countRows(text: string, table: string): number {
  const start = text.indexOf(`%T\t${table}\r\n`);
  if (start === -1) return 0;
  const end = text.indexOf("%T\t", start + 3);
  return text.slice(start, end === -1 ? undefined : end).split("\n%R\t").length - 1;
}

describe.skipIf(files.length === 0)("real XER files", () => {
  for (const f of files) {
    it(f, () => {
      const bytes = readFileSync(new URL(f, root));
      const text = bytes.toString("latin1");
      const t0 = performance.now();
      const s = loadSchedule(bytes);
      const ms = performance.now() - t0;

      expect(s.activities.length).toBe(countRows(text, "TASK"));
      expect(s.projects.length).toBeGreaterThan(0);
      expect(s.activities.every((a) => a.wbs)).toBe(true);
      expect(s.relationships.length).toBeLessThanOrEqual(countRows(text, "TASKPRED"));
      expect(s.activities.some((a) => a.name.includes("�"))).toBe(false);
      // The histogram must account for every unit: spreading over time loses nothing.
      const t1 = performance.now();
      const profile = buildUsageProfile(s, s.projects[0]?.dataDate ?? null);
      const usageMs = performance.now() - t1;
      for (const r of s.resources) {
        const all = (kind: "actual" | "remaining") => usageBetween(profile, r.id, kind, -1e6, 1e6);
        expect(all("remaining")).toBeCloseTo(r.remaining, 0);
        // Actuals without an actual start can't be placed in time; allow for those.
        const unplaced = r.assignments.filter((a) => a.actStart === null).reduce((n, a) => n + a.actual, 0);
        expect(all("actual") + unplaced).toBeCloseTo(r.actual, 0);
      }

      // Every activity code assignment lands on an activity.
      const codeCells = s.activities.reduce((n, a) => n + a.codes.size, 0);
      expect(codeCells).toBe(countRows(text, "TASKACTV"));
      expect(new Set(s.codeTypes.map((t) => t.label)).size).toBe(s.codeTypes.length); // no duplicate column names

      console.log(
        `${f}: ${s.activities.length} activities, ${s.relationships.length} relationships, ${ms.toFixed(0)} ms; ` +
          `${s.resources.length} resources, usage profile ${usageMs.toFixed(0)} ms; ` +
          `${s.codeTypes.length} code types, ${codeCells} code values`,
      );
    });
  }
});
