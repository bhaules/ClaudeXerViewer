// View > Group By: bands by activity code value.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "../src/xer";
import { scheduleColumns } from "../src/xer/columns";
import { groupByCode, shownSchedule } from "../src/xer/group";
import { applyRollups } from "../src/xer/model";
import { buildRows, expandedAll, revealActivity } from "../src/xer/rows";

const schedule = loadSchedule(readFileSync(new URL("./fixtures/sample.xer", import.meta.url)));
const byTask = (id: string) => schedule.activityById.get(id)!;
const discipline = schedule.codeTypes.find((t) => t.label === "Discipline")!;

describe("Group By activity code", () => {
  const g = groupByCode(schedule, discipline);

  it("makes one band per code value in dictionary order, with uncoded activities last", () => {
    expect(g.roots.map((b) => [b.code, b.name])).toEqual([
      ["ENG", "Engineering"],
      ["CIV", "Civil works"],
      ["", "No Discipline"],
    ]);
    expect(g.roots[0].activities).toEqual([byTask("1002"), byTask("1003")]);
    expect(g.roots[1].activities).toEqual([byTask("1004"), byTask("1005")]);
    const coded = g.roots[0].activities.length + g.roots[1].activities.length;
    expect(g.roots[2].activities.length).toBe(schedule.activities.length - coded);
    expect(g.roots.every((b) => b.group === discipline && b.level === 0)).toBe(true);
  });

  it("rolls the bands up from their activities and lists them in the grid", () => {
    const shown = shownSchedule(schedule, g);
    applyRollups(shown.roots);
    const eng = g.roots[0];
    expect(eng.activityCount).toBe(2);
    expect(eng.start).toBe(Math.min(byTask("1002").start!, byTask("1003").start!));
    const columns = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
    const rows = buildRows(shown, { expanded: expandedAll(shown), hideEmptyWbs: true, sort: null, ctx: { unit: "d" }, columns, filter: null });
    expect(rows.filter((r) => r.kind === "wbs").map((r) => (r.kind === "wbs" ? r.wbs.code : ""))).toEqual(["ENG", "CIV", ""]);
    expect(rows.filter((r) => r.kind === "act")).toHaveLength(schedule.activities.length);
    // Activities keep their real WBS.
    expect(byTask("1002").wbs.group).toBeUndefined();
  });

  it("reveals an activity by opening its band, not its WBS", () => {
    const expanded = new Set<string>();
    revealActivity(expanded, byTask("1004"), g.bandOf);
    expect([...expanded]).toEqual([g.roots[1].id]);
  });
});
