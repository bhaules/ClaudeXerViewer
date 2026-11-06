// Column value filters, WBS band working-time durations and the Excel export.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "../src/xer";
import { scheduleColumns, wbsWorkHours } from "../src/xer/columns";
import { compileFilter, emptyFilter, filterActive } from "../src/xer/filter";
import { buildRows, expandedAll, type ViewState } from "../src/xer/rows";
import { buildActivitiesXlsx, colName, crc32 } from "../src/xer/xlsx";

const schedule = loadSchedule(readFileSync(new URL("./fixtures/sample.xer", import.meta.url)));
const cols = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
const view: ViewState = {
  expanded: expandedAll(schedule),
  hideEmptyWbs: true,
  sort: null,
  ctx: { unit: "d" },
  columns: cols,
  filter: null,
};

describe("column value filters", () => {
  const codes = (values: Map<string, Set<string>>, columns = new Map<string, string>()) => {
    const { test } = compileFilter({ ...emptyFilter(), columns, values }, cols, { unit: "d" });
    return schedule.activities.filter((a) => !test || test(a)).map((a) => a.code).sort();
  };

  it("keeps activities whose displayed value is ticked, blanks included", () => {
    expect(codes(new Map([["udf:Area", new Set(["North"])]]))).toEqual(["E1000"]);
    expect(codes(new Map([["udf:Area", new Set([""])]]))).not.toContain("E1000");
    expect(codes(new Map([["status", new Set(["Completed", "In Progress"])]]))).toEqual(["A1000", "E1000"]);
  });

  it("combines with the column's condition and other columns", () => {
    const values = new Map([["status", new Set(["Not Started"])]]);
    expect(codes(values, new Map([["name", "design"]]))).toEqual(["E1010"]);
  });

  it("counts as an active filter even with no typed expressions", () => {
    expect(filterActive({ ...emptyFilter(), values: new Map([["status", new Set(["Completed"])]]) })).toBe(true);
    expect(filterActive(emptyFilter())).toBe(false);
  });
});

describe("WBS band durations", () => {
  const root = schedule.projects[0].root; // 06-Jan-25 08:00 to 13-Mar-25 08:00, data date 03-Feb-25 08:00
  const con = root.children[1]; // 24-Feb-25 07:00 to 12-Mar-25 17:00
  const working = { unit: "d" as const };

  it("counts working hours on the project calendar between the summarised dates", () => {
    // 8h Mon-Fri: 24-28 Feb, 3-7 Mar and 10-12 Mar are 13 working days.
    expect(wbsWorkHours(con, false)).toBe(13 * 8);
    expect(cols.get("origDur")!.wbsText(con, working)).toBe("13d");
    // From the data date: 3 Feb to 12 Mar is 28 weekdays, less the 10 Feb holiday.
    expect(wbsWorkHours(root, true)).toBe(27 * 8);
    expect(cols.get("remDur")!.wbsText(root, working)).toBe("27d");
    expect(cols.get("remDur")!.wbsText(root, { ...working, unit: "h" })).toBe("216h");
  });

  it("has nothing remaining once complete", () => {
    expect(wbsWorkHours({ ...con, finishActual: true }, true)).toBe(0);
    expect(cols.get("remDur")!.wbsText({ ...con, finishActual: true }, working)).toBe("0d");
  });
});

/** Reads a zip's entries (local headers in order), inflating deflated ones. */
async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (dv.getUint32(at, true) === 0x04034b50) {
    const method = dv.getUint16(at + 8, true);
    const crc = dv.getUint32(at + 14, true);
    const size = dv.getUint32(at + 18, true);
    const nameLen = dv.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    const raw =
      method === 8
        ? new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())
        : data;
    expect(crc32(raw)).toBe(crc);
    out.set(name, new TextDecoder().decode(raw));
    at += 30 + nameLen + size;
  }
  return out;
}

describe("Excel export", () => {
  const pick = ["code", "name", "start", "origDur", "budLabor"].map((k) => ({ column: cols.get(k)!, width: 100 }));
  const build = (info: [string, string][] = []) =>
    buildActivitiesXlsx({
      sheetName: "DEMO-001",
      columns: pick,
      rows: buildRows(schedule, view),
      ctx: { unit: "d" },
      wbsColors: (level) => [["#004080", "#ffffff"], ["#80ff80", "#000000"]][Math.min(level, 1)] as [string, string],
      info,
    });

  it("names columns like Excel", () => {
    expect([0, 25, 26, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
  });

  it("writes a valid workbook with both sheets", async () => {
    const files = await unzip(await build());
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(files.get("xl/workbook.xml")).toContain(`<sheet name="DEMO-001"`);
    expect(files.get("xl/workbook.xml")).toContain(`'DEMO-001'!$A$1:$E$`);
  });

  it("exports dates and numbers as values, with the duration unit in the header", async () => {
    const sheet = (await unzip(await build())).get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain("Original Duration (d)");
    // A1000 starts 06-Jan-25: Excel serial 45663, in a dd-mmm-yy date style.
    const a1000 = /<row r="(\d+)"[^>]*>(?:(?!<\/row>).)*A1000(?:(?!<\/row>).)*<\/row>/.exec(sheet)![0];
    expect(a1000).toMatch(/<c r="C\d+" s="\d+"><v>45663<\/v><\/c>/);
    expect(a1000).toMatch(/<c r="D\d+" s="\d+"><v>0<\/v><\/c>/);
    // Windows-1252 text arrives as proper Unicode.
    expect(sheet).toContain("Contractor’s Mobilisation");
  });

  it("keeps WBS bands as coloured, outlined rows", async () => {
    const files = await unzip(await build());
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain(`<row r="2">`); // the project band: level 0, no outline
    expect(sheet).toMatch(/<row r="\d+" outlineLevel="1">/);
    expect(sheet).toContain(`<autoFilter ref="A1:E`);
    expect(files.get("xl/styles.xml")).toContain(`<fgColor rgb="FF004080"/>`);
    // Band totals become numbers too: 500.5h of budgeted labour on the project band.
    expect(/<row r="2">.*?<c r="E2" s="\d+"><v>500.5<\/v>/.test(sheet)).toBe(true);
  });

  it("escapes text in the info sheet", async () => {
    const info = (await unzip(await build([["Column filters", `Name: <b> & "x"`]]))).get("xl/worksheets/sheet2.xml")!;
    expect(info).toContain("Name: &lt;b&gt; &amp; &quot;x&quot;");
  });
});
