import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "../src/xer";
import { hasWorkBetween, parseCalendarData } from "../src/xer/calendar";
import { scheduleColumns } from "../src/xer/columns";
import { formatDate, formatDuration } from "../src/xer/format";
import { compileFilter, emptyFilter, parseDateInput, parseNumber, type FilterState } from "../src/xer/filter";
import { applyRollups, parseXerDate } from "../src/xer/model";
import { buildUsageProfile, toManning, usageBetween } from "../src/xer/usage";
import { parseXer, XerParseError } from "../src/xer/parse";
import { activitiesInDisplayOrder, buildRows, expandedAll, expandedToLevel, type ViewState } from "../src/xer/rows";

const schedule = loadSchedule(readFileSync(new URL("./fixtures/sample.xer", import.meta.url)));
const act = (code: string) => schedule.activities.find((a) => a.code === code)!;

const view = (over: Partial<ViewState> = {}): ViewState => ({
  expanded: expandedAll(schedule),
  hideEmptyWbs: true,
  sort: null,
  ctx: { unit: "d" },
  columns: new Map(scheduleColumns(schedule).map((c) => [c.key, c])),
  filter: null,
  ...over,
});

describe("parseXer", () => {
  it("rejects files without the ERMHDR header", () => {
    expect(() => parseXer("hello")).toThrow(XerParseError);
  });

  it("ignores unknown tables", () => {
    const t = parseXer("ERMHDR\t21\r\n%T\tWHATEVER\r\n%F\ta\r\n%R\t1\r\n%E\r\n");
    expect(t.tables.get("WHATEVER")).toEqual([{ a: "1" }]);
  });
});

describe("buildSchedule", () => {
  it("decodes Windows-1252 text", () => {
    expect(act("E1000").name).toBe("Design – Civil");
    expect(act("C1010").name).toBe("Contractor’s Mobilisation");
  });

  it("builds the WBS tree in seq_num order with the EPS parent treated as missing", () => {
    expect(schedule.projects).toHaveLength(1);
    const root = schedule.projects[0].root;
    expect(root.parent).toBeNull();
    expect(root.children.map((c) => c.code)).toEqual(["ENG", "CON", "EMPTY"]);
    expect(act("C1000").wbs.fullCode).toBe("DEMO-001.CON.CIV");
  });

  it("puts activities with an unknown WBS under a (No WBS) root", () => {
    expect(act("Z9999").wbs.code).toBe("(No WBS)");
    expect(schedule.roots.at(-1)?.code).toBe("(No WBS)");
  });

  it("uses current dates, not planned dates", () => {
    const a = act("E1000");
    expect(formatDate(a.start, a.startActual)).toBe("07-Jan-25 A");
    expect(formatDate(a.finish, a.finishActual)).toBe("14-Feb-25");
    expect(formatDate(a.plannedFinish)).toBe("31-Jan-25");
  });

  it("treats 1899-12-30 as no date", () => {
    expect(act("A1000").lateStart).toBeNull();
  });

  it("flags constraints and criticality", () => {
    expect(act("E1010").startConstrained).toBe(true);
    expect(act("F1000").finishConstrained).toBe(true);
    expect(act("E1010").critical).toBe(true); // TF 0
    expect(act("E1000").critical).toBe(false); // TF 40h
    expect(act("A1000").critical).toBe(false); // completed
  });

  it("links relationships both ways and drops ones to missing activities", () => {
    expect(schedule.relationships).toHaveLength(5);
    const c1000 = act("C1000");
    expect(c1000.preds.map((r) => [r.pred.code, r.type])).toEqual([["E1010", "SS"]]);
    expect(act("E1000").succs.map((r) => r.succ.code).sort()).toEqual(["C1010", "E1010"]);
  });

  it("converts lag with the predecessor calendar", () => {
    const rel = act("C1000").preds[0];
    expect(formatDuration(rel.lagHrs, rel.lagCalendar, "d")).toBe("2d"); // 16h on an 8h/day calendar
    const ff = act("C1010").preds[0];
    expect(formatDuration(ff.lagHrs, ff.lagCalendar, "d")).toBe("-1d");
  });

  it("converts durations with each activity's own calendar", () => {
    const a = act("C1000"); // 80h on a 10h/day, 60h/week calendar
    expect(formatDuration(a.remDurHrs, a.calendar, "d")).toBe("8d");
    expect(formatDuration(a.remDurHrs, a.calendar, "w")).toBe("1.3w");
    expect(formatDuration(a.remDurHrs, a.calendar, "h")).toBe("80h");
  });

  it("computes % complete by complete_pct_type", () => {
    expect(act("E1000").pctComplete).toBe(50);
    expect(act("A1000").pctComplete).toBe(100);
  });

  it("rolls up WBS dates, float and counts", () => {
    const con = schedule.projects[0].root.children[1];
    expect(con.activityCount).toBe(2);
    expect(formatDate(con.start)).toBe("24-Feb-25");
    expect(formatDate(con.finish)).toBe("12-Mar-25");
    expect(con.totalFloatHrs).toBe(-10);
    expect(schedule.projects[0].root.startActual).toBe(true);
  });
});

describe("calendars", () => {
  const cal10 = schedule.calendars.get("10")!.work;
  const at = (s: string) => parseXerDate(s)!;

  it("parses DEL-separated clndr_data into a working week", () => {
    expect(cal10.week[1]).toEqual([[480, 720], [750, 990]]); // Monday
    expect(cal10.week[0]).toEqual([]); // Sunday
  });

  it("reads 'f|00:00' as midnight at the end of the day", () => {
    const p = parseCalendarData("(0||CalendarData()((0||DaysOfWeek()((0||2()((0||0(s|18:00|f|00:00)())))))))")!;
    expect(p.week[1]).toEqual([[1080, 1440]]);
  });

  it("finds no working time across a weekend or a holiday", () => {
    expect(hasWorkBetween(cal10, at("2025-02-14 16:30"), at("2025-02-17 08:00"))).toBe(false); // Fri -> Mon
    expect(hasWorkBetween(cal10, at("2025-02-07 16:30"), at("2025-02-11 08:00"))).toBe(false); // Mon 10th is a holiday
    expect(hasWorkBetween(cal10, at("2025-02-11 12:00"), at("2025-02-11 12:30"))).toBe(false); // lunch
    expect(hasWorkBetween(cal10, at("2025-02-11 11:00"), at("2025-02-11 13:00"))).toBe(true);
  });

  it("falls back to Mon-Fri when clndr_data is missing", () => {
    expect(parseCalendarData("")).toBeNull();
  });
});

describe("driving relationships", () => {
  const rel = (pred: string, succ: string) => act(succ).preds.find((r) => r.pred.code === pred)!;

  it("drives when no working time separates aref from the successor's date", () => {
    expect(rel("E1000", "E1010").driving).toBe(true); // across a weekend
    expect(rel("E1000", "C1010").driving).toBe(true); // FF, to the successor's finish
  });

  it("doesn't drive when there is working time in between", () => {
    expect(rel("A1000", "E1000").driving).toBe(false);
    expect(rel("E1010", "C1000").driving).toBe(false);
  });

  it("falls back to the predecessor's date when aref is missing and lag is zero", () => {
    expect(rel("C1000", "F1000").driving).toBe(true);
  });
});

describe("labor units and UDF columns", () => {
  const ctx = { unit: "d" as const };
  const cols = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
  const cell = (key: string, code: string) => cols.get(key)!.text(act(code), ctx);

  it("shows labor units per activity and sums them on WBS rows", () => {
    expect(cell("remLabor", "C1000")).toBe("240h");
    expect(cell("budLabor", "E1000")).toBe("160h");
    expect(cell("actLabor", "E1000")).toBe("80h");
    const con = schedule.projects[0].root.children[1];
    expect(cols.get("remLabor")!.wbsText(con, ctx)).toBe("340.5h");
    expect(cols.get("budLabor")!.wbsText(schedule.projects[0].root, ctx)).toBe("500.5h");
  });

  it("offers only activity UDFs that have values, by label", () => {
    expect(schedule.udfTypes.map((t) => t.label)).toEqual(["Area", "Men per Day", "Review Date", "Traffic Light"]);
  });

  it("formats each UDF type", () => {
    expect(cell("udf:Area", "E1000")).toBe("North");
    expect(cell("udf:Men per Day", "E1000")).toBe("2.5");
    expect(cell("udf:Review Date", "E1010")).toBe("20-Feb-25");
    expect(cell("udf:Traffic Light", "C1000")).toBe("Red");
    expect(cols.get("udf:Traffic Light")!.html!(act("C1000"))).toContain("UDF_G1");
    expect(cell("udf:Area", "A1000")).toBe("");
  });

  it("sorts by a UDF column within each WBS, blanks last", () => {
    const codes = activitiesInDisplayOrder(schedule, view({ sort: { key: "udf:Area", dir: -1 } })).map((a) => a.code);
    expect(codes).toEqual(["A1000", "F1000", "E1000", "E1010", "C1010", "C1000", "Z9999"]);
  });
});

describe("resources and usage", () => {
  const dd = schedule.projects[0].dataDate;
  const profile = buildUsageProfile(schedule, dd);
  const day = (s: string) => Math.floor(parseXerDate(s)! / 86_400_000);
  const res = (code: string) => schedule.resources.find((r) => r.code === code)!;
  const use = (code: string, kind: "actual" | "remaining", from: string, to: string) =>
    usageBetween(profile, res(code).id, kind, day(from), day(to));

  it("lists only resources with assignments, with their totals", () => {
    expect(schedule.resources.map((r) => r.code)).toEqual(["CIV", "ENG"]);
    expect(res("CIV").remaining).toBe(340.5);
    expect(res("ENG").actual).toBe(80); // regular + overtime
    expect(act("C1000").assignments.map((a) => a.resource.code)).toEqual(["CIV"]); // role-only one ignored
  });

  it("keeps every unit when spreading over time", () => {
    expect(use("ENG", "remaining", "2025-01-01", "2025-12-31")).toBeCloseTo(80);
    expect(use("ENG", "actual", "2025-01-01", "2025-12-31")).toBeCloseTo(80);
    expect(use("CIV", "remaining", "2025-01-01", "2025-12-31")).toBeCloseTo(340.5);
  });

  it("spreads by working time: nothing on weekends or holidays", () => {
    expect(use("CIV", "remaining", "2025-02-24", "2025-02-25")).toBeCloseTo(20.1);
    expect(use("ENG", "remaining", "2025-02-10", "2025-02-11")).toBe(0); // holiday on calendar 10
    expect(use("ENG", "remaining", "2025-02-08", "2025-02-10")).toBe(0); // weekend
    // 9 working days 03-14 Feb (the 10th is a holiday): 5 of them in the first week.
    expect(use("ENG", "remaining", "2025-02-03", "2025-02-10")).toBeCloseTo((80 * 5) / 9);
  });

  it("converts hours to manning, scaling the divisor to the period length", () => {
    expect(toManning(700, 0, 7, 70)).toBe(10); // a week: 700h / 70h per person
    expect(toManning(2800, 0, 28, 70)).toBe(10); // four weeks: same average crew
    expect(toManning(100, 0, 1, 70)).toBe(10); // one day: 100h is 10 people at 10h/day
    expect(toManning(100, 0, 0, 70)).toBe(0);
  });

  it("puts actuals before the data date and nothing actual after it", () => {
    expect(use("ENG", "actual", "2025-02-03", "2025-12-31")).toBe(0);
    expect(use("ENG", "actual", "2025-01-07", "2025-01-08")).toBeCloseTo(80 / 19); // 19 working days 07-31 Jan
  });
});

describe("filters", () => {
  const cols = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
  const ctx = { unit: "d" as const };
  const codes = (f: Partial<FilterState>) => {
    const { test, errors } = compileFilter({ ...emptyFilter(), ...f }, cols, ctx);
    return { codes: schedule.activities.filter((a) => !test || test(a)).map((a) => a.code).sort(), errors: [...errors] };
  };
  const byCol = (key: string, expr: string) => codes({ columns: new Map([[key, expr]]) }).codes;

  it("filters by status, critical and milestones", () => {
    expect(codes({ statuses: new Set(["InProgress"]) }).codes).toEqual(["E1000"]);
    expect(codes({ criticalOnly: true }).codes).toEqual(["C1000", "E1010", "F1000"]);
    expect(codes({ milestonesOnly: true, statuses: new Set(["NotStarted"]) }).codes).toEqual(["F1000"]);
  });

  it("keeps activities active at any point in a date window", () => {
    const at = (s: string) => parseXerDate(s)!;
    // 17-21 Feb: E1010 runs then; E1000 finished on the 14th; C1010 starts on the 24th.
    expect(codes({ from: at("2025-02-17"), to: at("2025-02-21") }).codes).toEqual(["E1010"]);
    // `to` includes its whole day: C1010 starts 24-Feb 07:00.
    expect(codes({ from: at("2025-02-22"), to: at("2025-02-24") }).codes).toEqual(["C1010"]);
  });

  it("matches text columns by 'contains', '=' and '<>'", () => {
    expect(byCol("name", "design")).toEqual(["E1000", "E1010"]);
    expect(byCol("name", "=design review")).toEqual(["E1010"]);
    expect(byCol("udf:Area", "<>North")).toEqual(["A1000", "C1000", "C1010", "E1010", "F1000", "Z9999"]);
  });

  it("compares numbers in the displayed unit, ignoring blanks", () => {
    expect(byCol("remDur", ">5")).toEqual(["C1000", "E1000"]); // 8d and 10d
    expect(byCol("remDur", "5d")).toEqual(["C1010", "E1010"]); // plain number = equals; 50h on 10h/day
    expect(byCol("totalFloat", "<0")).toEqual(["C1000", "F1000"]);
    expect(byCol("remLabor", ">=100.5")).toEqual(["C1000", "C1010"]);
  });

  it("compares dates by day, and treats a plain date value as 'contains'", () => {
    // A1000 is a start milestone with no finish, so it never matches a finish comparison.
    expect(byCol("finish", "<17-Feb-25")).toEqual(["E1000", "Z9999"]);
    expect(byCol("start", ">=2025-03-01")).toEqual(["C1000", "F1000"]);
    expect(byCol("start", "Mar-25")).toEqual(["C1000", "F1000"]);
  });

  it("reports expressions it can't read and ignores them", () => {
    const r = codes({ columns: new Map([["remDur", ">abc"], ["name", "<x"], ["start", ">31-Feb-25"]]) });
    expect(r.errors.sort()).toEqual(["name", "remDur", "start"]);
    expect(r.codes).toHaveLength(schedule.activities.length);
  });

  it("parses the date and number formats people type", () => {
    expect(parseDateInput("05-Mar-26")).toBe(Date.UTC(2026, 2, 5));
    expect(parseDateInput("5/3/2026")).toBe(Date.UTC(2026, 2, 5)); // day first
    expect(parseDateInput("2026-03-05")).toBe(Date.UTC(2026, 2, 5));
    expect(parseDateInput("05-Mar-26 A")).toBe(Date.UTC(2026, 2, 5));
    expect(parseNumber("1,234.5h")).toBe(1234.5);
    expect(parseNumber("-3d")).toBe(-3);
  });

  it("re-totals WBS rows from the filtered activities and hides WBS with none", () => {
    const { test } = compileFilter({ ...emptyFilter(), columns: new Map([["udf:Area", "South"]]) }, cols, ctx);
    applyRollups(schedule.roots, test!);
    try {
      const con = schedule.projects[0].root.children[1];
      expect(con.labor.remaining).toBe(240); // C1010's 100.5h is filtered out
      const rows = buildRows(schedule, view({ filter: test }));
      expect(rows.map((r) => (r.kind === "wbs" ? `[${r.wbs.code}]` : r.act.code))).toEqual([
        "[DEMO-001]", "[CON]", "[CIV]", "C1000",
      ]);
    } finally {
      applyRollups(schedule.roots);
    }
  });
});

describe("rows", () => {
  it("lists a WBS's own activities before its child WBS and hides empty WBS", () => {
    const codes = buildRows(schedule, view()).map((r) => (r.kind === "wbs" ? `[${r.wbs.code}]` : r.act.code));
    expect(codes).toEqual([
      "[DEMO-001]", "A1000", "F1000",
      "[ENG]", "E1000", "E1010",
      "[CON]", "C1010", "[CIV]", "C1000",
      "[(No WBS)]", "Z9999",
    ]);
  });

  it("shows empty WBS when asked", () => {
    const rows = buildRows(schedule, view({ hideEmptyWbs: false }));
    expect(rows.some((r) => r.kind === "wbs" && r.wbs.code === "EMPTY")).toBe(true);
  });

  it("sorts activities within their WBS only", () => {
    const rows = buildRows(schedule, view({ sort: { key: "code", dir: -1 } }));
    const codes = rows.map((r) => (r.kind === "wbs" ? `[${r.wbs.code}]` : r.act.code));
    expect(codes.slice(0, 6)).toEqual(["[DEMO-001]", "F1000", "A1000", "[ENG]", "E1010", "E1000"]);
  });

  it("keeps blanks last in either direction", () => {
    const asc = activitiesInDisplayOrder(schedule, view({ sort: { key: "totalFloat", dir: 1 } }));
    const desc = activitiesInDisplayOrder(schedule, view({ sort: { key: "totalFloat", dir: -1 } }));
    // In the root WBS, A1000 is complete (no float) so it stays after F1000 both ways.
    expect(asc.slice(0, 2).map((a) => a.code)).toEqual(["F1000", "A1000"]);
    expect(desc.slice(0, 2).map((a) => a.code)).toEqual(["F1000", "A1000"]);
  });

  it("collapses to a level", () => {
    const rows = buildRows(schedule, view({ expanded: expandedToLevel(schedule, 1) }));
    expect(rows.filter((r) => r.kind === "wbs").map((r) => r.kind === "wbs" && r.wbs.code)).toEqual([
      "DEMO-001", "ENG", "CON", "(No WBS)",
    ]);
  });
});
