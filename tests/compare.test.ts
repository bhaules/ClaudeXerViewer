// Baseline comparison, Trace Logic and copying rows.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bandRows, rowsToTable } from "../src/xer/clipboard";
import { COLUMN_BY_KEY, scheduleColumns } from "../src/xer/columns";
import { changeSummary, compareSchedules, describeChange, workHoursBetween } from "../src/xer/compare";
import { compileFilter, emptyFilter } from "../src/xer/filter";
import { buildSchedule } from "../src/xer/model";
import { decodeXer, parseXer, type Row } from "../src/xer/parse";
import { buildRows, expandedAll } from "../src/xer/rows";
import { traceLogic } from "../src/xer/trace";

const bytes = readFileSync(new URL("./fixtures/sample.xer", import.meta.url));
const current = buildSchedule(parseXer(decodeXer(bytes)));

/** The fixture with some edits: an older version of the same schedule. */
function baselineSchedule() {
  const parsed = parseXer(decodeXer(bytes));
  const t = (name: string) => parsed.tables.get(name)!;
  const task = (code: string) => t("TASK").find((r) => r.task_code === code)!;
  const e1010 = task("E1010");
  // E1010 didn't exist yet (so it was added since), X5000 did (deleted since).
  parsed.tables.set("TASK", t("TASK").filter((r) => r !== e1010));
  parsed.tables.set("TASKPRED", t("TASKPRED").filter((r) => r.task_id !== e1010.task_id && r.pred_task_id !== e1010.task_id));
  t("TASK").push({ ...task("C1010"), task_id: "1099", task_code: "X5000", task_name: "Old activity" } as Row);
  // C1000 used to finish two working days earlier; C1010 was shorter and had no predecessor.
  task("C1000").early_end_date = "2025-03-10 17:00";
  task("C1010").target_drtn_hr_cnt = "40";
  parsed.tables.set("TASKPRED", t("TASKPRED").filter((r) => r.task_pred_id !== "4"));
  task("F1000").task_name = "Project Completion";
  return buildSchedule(parsed);
}

const cmp = compareSchedules(current, baselineSchedule(), "baseline.xer");
const act = (code: string) => current.activities.find((a) => a.code === code)!;
const change = (code: string) => cmp.changes.get(act(code))!;

describe("baseline comparison", () => {
  it("matches activities by Activity ID and finds added and deleted ones", () => {
    expect([...change("E1010").kinds]).toEqual(["added"]);
    expect(change("E1010").base).toBeNull();
    expect(cmp.deleted.map((a) => a.code)).toEqual(["X5000"]);
    expect(change("A1000").kinds.size).toBe(0);
  });

  it("measures finish variance in working time on the activity's calendar, P6 sign", () => {
    // Mon 10-Mar 17:00 -> Wed 12-Mar 17:00 on a 10 h/day calendar: 20 h later.
    expect(change("C1000").finishVarHrs).toBe(-20);
    expect(change("C1000").kinds.has("finishLater")).toBe(true);
    const finishVar = COLUMN_BY_KEY.get("finishVar")!;
    expect(finishVar.text(act("C1000"), { unit: "d", cmp })).toBe("-2d");
    expect(COLUMN_BY_KEY.get("blFinish")!.text(act("C1000"), { unit: "d", cmp })).toBe("10-Mar-25");
    expect(finishVar.text(act("C1000"), { unit: "d" })).toBe("");
  });

  it("finds duration, logic, lag and name changes", () => {
    const c1010 = change("C1010");
    expect(c1010.kinds.has("duration")).toBe(true);
    expect(c1010.logic?.added.map((r) => r.pred.code)).toEqual(["E1000"]);
    expect(changeSummary(c1010)).toBe("Duration, Logic");
    // E1010 is new, so its link into C1000 is new too.
    expect(change("C1000").logic?.added.map((r) => r.pred.code)).toEqual(["E1010"]);
    expect(change("F1000").kinds.has("name")).toBe(true);
    const text = describeChange(act("C1010"), c1010, "d");
    expect(text).toContain("Predecessor added: E1000 FF -1d");
    expect(text.some((t) => t.startsWith("Original Duration 4d → 5d"))).toBe(true);
    expect(describeChange(act("F1000"), change("F1000"), "d")).toContain('Renamed from "Project Completion"');
  });

  it("counts changes and filters by them", () => {
    expect(cmp.counts.get("added")).toBe(1);
    const only = (kinds: string[]) => {
      const { test } = compileFilter({ ...emptyFilter(), changes: new Set(kinds as never[]) }, new Map(), { unit: "d", cmp });
      return current.activities.filter((a) => test!(a)).map((a) => a.code).sort();
    };
    expect(only(["added"])).toEqual(["E1010"]);
    expect(only(["duration"])).toEqual(["C1010"]);
    expect(only(["logic", "duration"])).toEqual(["C1000", "C1010"]);
    expect(only(["any"])).toEqual(["C1000", "C1010", "E1010", "F1000"]);
  });

  it("matches WBS bands by their code path", () => {
    const root = current.roots[0];
    expect(cmp.wbs.get(root)?.code).toBe(root.code);
  });

  it("counts working hours in both directions", () => {
    const cal = act("C1000").calendar;
    const a = Date.UTC(2025, 2, 10, 17);
    const b = Date.UTC(2025, 2, 12, 17);
    expect(workHoursBetween(cal, a, b)).toBe(20);
    expect(workHoursBetween(cal, b, a)).toBe(-20);
  });
});

describe("trace logic", () => {
  const codes = (set: Set<{ code: string }>) => [...set].map((a) => a.code).sort();

  it("follows driving relationships only, or all of them", () => {
    expect(codes(traceLogic({ root: act("F1000"), dir: "pred", drivingOnly: true }))).toEqual(["C1000", "F1000"]);
    expect(codes(traceLogic({ root: act("F1000"), dir: "pred", drivingOnly: false }))).toEqual(["A1000", "C1000", "E1000", "E1010", "F1000"]);
    expect(codes(traceLogic({ root: act("E1000"), dir: "succ", drivingOnly: true }))).toEqual(["C1010", "E1000", "E1010"]);
    expect(codes(traceLogic({ root: act("E1010"), dir: "both", drivingOnly: true }))).toEqual(["E1000", "E1010"]);
  });

  it("filters the grid to the traced chain", () => {
    const { test } = compileFilter({ ...emptyFilter(), trace: { root: act("F1000"), dir: "pred", drivingOnly: true } }, new Map(), { unit: "d" });
    expect(current.activities.filter((a) => test!(a)).map((a) => a.code).sort()).toEqual(["C1000", "F1000"]);
  });
});

describe("copy rows", () => {
  const cols = new Map(scheduleColumns(current).map((c) => [c.key, c]));
  const view = { expanded: expandedAll(current), hideEmptyWbs: true, sort: null, ctx: { unit: "d" as const }, columns: cols, filter: null };
  const rows = buildRows(current, view);
  const columns = ["code", "name", "finish"].map((k) => cols.get(k)!);

  it("writes tab-separated text with a header and coloured HTML", () => {
    const t = rowsToTable(rows, columns, view.ctx, () => ["#0070c0", "#ffffff"]);
    const lines = t.text.split("\r\n");
    expect(lines[0]).toBe("Activity ID\tActivity Name\tFinish");
    expect(lines).toContain("C1000\tExcavation\t12-Mar-25");
    expect(t.html).toContain("background:#0070c0");
    expect(t.html).toContain("<th");
  });

  it("copies a WBS band with the rows under it", () => {
    const i = rows.findIndex((r) => r.kind === "wbs" && r.level === 1);
    const band = bandRows(rows, i);
    expect(band[0]).toBe(rows[i]);
    expect(band.slice(1).every((r) => r.level > rows[i].level)).toBe(true);
    const act = rows.findIndex((r) => r.kind === "act");
    expect(bandRows(rows, act)).toEqual([rows[act]]);
  });

  it("escapes HTML in names", () => {
    const fake = [{ kind: "act" as const, level: 0, act: { ...current.activities[0], name: "<b>x</b>" } }];
    expect(rowsToTable(fake, [cols.get("name")!], view.ctx, () => ["#fff", "#000"]).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
