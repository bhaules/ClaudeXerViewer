// Notebook notes and steps, the schedule health check, and the plain-table Excel export.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "../src/xer";
import { compareSchedules } from "../src/xer/compare";
import { checkSchedule } from "../src/xer/health";
import { changesSheets, checkSheets } from "../src/xer/reports";
import { htmlToText } from "../src/xer/text";
import { buildTableXlsx } from "../src/xer/xlsx";

const schedule = loadSchedule(readFileSync(new URL("./fixtures/sample.xer", import.meta.url)));
const act = (code: string) => schedule.activities.find((a) => a.code === code)!;

/** Reads the stored (uncompressed or deflated) files of a zip. */
async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    const raw = method === 8 ? new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) : data;
    out.set(name, new TextDecoder().decode(raw));
    at += 30 + nameLen + size;
  }
  return out;
}

describe("notebook and steps", () => {
  it("reads notes as plain text, in topic order", () => {
    const notes = act("C1000").notes;
    expect(notes.map((n) => n.topic)).toEqual(["Scope", "Assumptions"]);
    expect(notes[0].text).toBe("Bulk excavation\n\nto RL 100");
    expect(notes[1].text).toBe("Rock is <2m deep & dry.\n\n• Two excavators\n• Day shift only");
    expect(notes[1].text).not.toContain("alert");
  });

  it("reads steps in order", () => {
    const steps = act("E1000").steps;
    expect(steps.map((s) => s.name)).toEqual(["Draft drawings", "Issue for review"]);
    expect(steps[0]).toMatchObject({ completed: true, weight: 1, pctComplete: 100, description: "All sheets" });
    expect(steps[1]).toMatchObject({ completed: false, weight: 3, pctComplete: 0 });
    expect(act("A1000").steps).toEqual([]);
  });

  it("turns HTML into text without running or keeping markup", () => {
    expect(htmlToText("<p>a<br>b</p><p>c &amp; &#8211; &#x41;</p>")).toBe("a\nb\n\nc & – A");
    expect(htmlToText("<style>p{}</style><script>x()</script><b>bold</b>")).toBe("bold");
    expect(htmlToText("plain\x7fline <not a tag")).toBe("plain\nline <not a tag");
    expect(htmlToText(undefined)).toBe("");
  });
});

describe("schedule check", () => {
  const results = checkSchedule(schedule);
  const r = (id: string) => results.find((x) => x.id === id)!;
  const codes = (id: string) => [...r(id).activities].map((a) => a.code).sort();

  it("lists the DCMA checks in order", () => {
    expect(results.slice(0, 13).map((x) => x.no)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "13", "14"]);
  });

  it("counts open ends, negative float and hard constraints on incomplete activities", () => {
    // A1000 is complete, so it doesn't count.
    expect(r("logic").total).toBe(6);
    // C1010 and F1000 have no successor; Z9999 has no logic at all.
    expect(codes("logic")).toEqual(["C1010", "F1000", "Z9999"]);
    expect(codes("negativeFloat")).toEqual(["C1000", "F1000"]);
    expect(r("negativeFloat").pass).toBe(false);
    // F1000: finish on or before. E1010: start on or after (soft) but a secondary finish on or before.
    expect(codes("hardConstraints")).toEqual(["E1010", "F1000"]);
  });

  it("checks relationships into incomplete activities", () => {
    expect(r("leads").count).toBe(1); // E1000 -> C1010 FF -8h
    expect(r("lags").count).toBe(1); // E1010 -> C1000 SS +16h
    expect(r("relTypes").description).toContain("1 SS, 1 FF, 0 SF");
  });

  it("uses the baseline for missed activities when one is loaded", () => {
    const cmp = compareSchedules(schedule, schedule, "same.xer");
    const withBl = checkSchedule(schedule, cmp);
    expect(withBl.find((x) => x.id === "missed")!.description).toContain("same.xer");
  });

  it("exports results and flagged activities", async () => {
    const files = await unzip(await buildTableXlsx(checkSheets(results, "d")));
    expect(files.get("xl/workbook.xml")).toContain(`<sheet name="Schedule Check"`);
    expect(files.get("xl/workbook.xml")).toContain(`<sheet name="Flagged Activities"`);
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("Negative float");
    expect(files.get("xl/worksheets/sheet2.xml")).toContain("F1000");
  });
});

describe("table export", () => {
  it("writes numbers and dates as values, escapes text and makes sheet names safe", async () => {
    const bytes = await buildTableXlsx([
      {
        name: "A/B: <x>",
        columns: [
          { label: "Name", width: 10 },
          { label: "Hours", width: 8 },
          { label: "Date", width: 10 },
        ],
        rows: [{ cells: ["<b>&", 12.345, { date: Date.UTC(2025, 0, 6) }] }, { cells: ["Total", null, null], bold: true, fill: "#e8e8e8" }],
      },
      { name: "A/B: <x>", columns: [{ label: "x", width: 5 }], rows: [] },
    ]);
    const files = await unzip(bytes);
    const wb = files.get("xl/workbook.xml")!;
    expect(wb).toContain(`<sheet name="A B  &lt;x&gt;"`);
    expect(wb).toContain(`<sheet name="A B  &lt;x&gt; (2)"`);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain("&lt;b&gt;&amp;");
    expect(sheet).toMatch(/<c r="B2" s="\d+"><v>12.35<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="C2" s="\d+"><v>45663<\/v><\/c>/);
    expect(files.has("xl/worksheets/sheet2.xml")).toBe(true);
  });

  it("exports changes including deleted activities", async () => {
    const parsed = loadSchedule(readFileSync(new URL("./fixtures/sample.xer", import.meta.url)));
    // A baseline with an extra activity, so the current schedule has one deleted.
    const baseline = loadSchedule(readFileSync(new URL("./fixtures/sample.xer", import.meta.url)));
    baseline.activities.push({ ...baseline.activities[1], code: "OLD1", name: "Removed activity", preds: [], succs: [] });
    const cmp = compareSchedules(parsed, baseline, "bl.xer");
    const [changes, summary] = changesSheets(cmp, "d");
    expect(changes.rows.some((r) => r.cells[0] === "OLD1" && r.cells[3] === "Deleted")).toBe(true);
    expect(summary.rows.find((r) => r.cells[0] === "Deleted")!.cells[1]).toBe(1);
  });
});
