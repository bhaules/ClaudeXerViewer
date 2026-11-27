// Files that aren't quite what P6 writes, and comments from files someone may have edited:
// these must never crash the viewer, hang it, or get anything into the page unescaped.
import { describe, expect, it } from "vitest";
import { itemKey, parseComments, targetKey } from "../src/xer/comments";
import { buildSchedule } from "../src/xer/model";
import { parseXer } from "../src/xer/parse";
import { allWbs, buildRows, expandedAll, revealActivity } from "../src/xer/rows";
import { scheduleColumns } from "../src/xer/columns";

const xer = (...lines: string[]) => ["ERMHDR\t21.12", ...lines, "%E"].join("\r\n");

describe("malformed .xer", () => {
  // PROJWBS has no wbs_name, TASK has no task_name, RSRC has neither rsrc_name nor rsrc_type,
  // and WBS W2 / W3 are each other's parent.
  const text = xer(
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tlast_recalc_date",
    "%R\t1\tP1\t2026-01-05 08:00",
    "%T\tPROJWBS",
    "%F\twbs_id\tproj_id\tparent_wbs_id\tseq_num\tproj_node_flag\twbs_short_name",
    "%R\tW1\t1\tEPS\t0\tY\tP1",
    "%R\tW2\t1\tW3\t1\tN\tA",
    "%R\tW3\t1\tW2\t2\tN\tB",
    "%R\tW4\t1\tW2\t3\tN\tC",
    "%T\tTASK",
    "%F\ttask_id\tproj_id\twbs_id\ttask_code\tstatus_code\ttask_type\tearly_start_date\tearly_end_date",
    "%R\tT1\t1\tW1\tA100\tTK_NotStart\tTT_Task\t2026-01-05 08:00\t2026-01-09 17:00",
    "%R\tT2\t1\tW4\tA200\tTK_NotStart\tTT_Task\t2026-01-12 08:00\t2026-01-16 17:00",
    "%T\tRSRC",
    "%F\trsrc_id\trsrc_short_name",
    "%R\tR1\tCREW",
    "%T\tTASKRSRC",
    "%F\ttask_id\trsrc_id\ttarget_qty",
    "%R\tT1\tR1\t40",
  );

  it("reads missing text fields as blank instead of crashing", () => {
    const s = buildSchedule(parseXer(text));
    expect(s.activities.map((a) => [a.code, a.name])).toEqual([
      ["A100", ""],
      ["A200", ""],
    ]);
    for (const w of allWbs(s)) expect(typeof w.name).toBe("string");
    expect(s.resources[0]).toMatchObject({ code: "CREW", name: "CREW", type: "" });
    // Building the grid rows sorts and formats every activity.
    const columns = new Map(scheduleColumns(s).map((c) => [c.key, c]));
    const rows = buildRows(s, { expanded: expandedAll(s), hideEmptyWbs: false, sort: null, ctx: { unit: "d" }, columns, filter: null });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("breaks a WBS parent loop so its activities still show and walking up ends", () => {
    const s = buildSchedule(parseXer(text));
    const reachable = new Set(allWbs(s).map((w) => w.id));
    expect([...reachable].sort()).toEqual(["W1", "W2", "W3", "W4"]);
    const a200 = s.activities.find((a) => a.code === "A200")!;
    const expanded = new Set<string>();
    revealActivity(expanded, a200); // looped forever before
    expect(expanded.has("W4")).toBe(true);
    for (const w of allWbs(s)) {
      let steps = 0;
      for (let p = w.parent; p; p = p.parent) expect(++steps).toBeLessThan(10);
    }
  });
});

describe("imported comments", () => {
  const base = {
    id: "c1",
    target: { kind: "activity", project: "P1", code: "A100" },
    type: "Question",
    text: "Why?",
    author: "Sam",
    created: 1,
    updated: 1,
    status: "open",
  };
  const read = (...comments: unknown[]) => parseComments(JSON.stringify({ format: "xer-viewer-comments", version: 1, comments }));

  it("only keeps the four comment types; anything else becomes Comment", () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const out = read(base, { ...base, id: "c2", type: evil }, { ...base, id: "c3", type: undefined }, { ...base, id: "c4", type: 7 });
    expect(out.map((c) => c.type)).toEqual(["Question", "Comment", "Comment", "Comment"]);
  });

  it("drops fields of the wrong type and anything it doesn't know", () => {
    const [c] = read({ ...base, target: { ...base.target, project: { x: 1 } }, doneBy: 5, snapshot: { name: 3, start: "01-Jan-26" }, extra: "<b>" });
    expect(c.target).toEqual({ kind: "activity", project: "", code: "A100" });
    expect(c.doneBy).toBeUndefined();
    expect(c.snapshot).toEqual({ name: "", start: "01-Jan-26", finish: "", remaining: "" });
    expect("extra" in c).toBe(false);
  });

  it("keys comments by project, so the same Activity ID in two projects stays apart", () => {
    const [c] = read(base);
    expect(targetKey(c.target)).toBe("activity|P1|A100");
    expect(targetKey({ kind: "activity", project: "P2", code: "A100" })).not.toBe(targetKey(c.target));
    const s = buildSchedule(
      parseXer(
        xer(
          "%T\tPROJECT",
          "%F\tproj_id\tproj_short_name",
          "%R\t1\tP1",
          "%T\tPROJWBS",
          "%F\twbs_id\tproj_id\tparent_wbs_id\tseq_num\tproj_node_flag\twbs_short_name\twbs_name",
          "%R\tW1\t1\tEPS\t0\tY\tP1\tProject",
          "%T\tTASK",
          "%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\tstatus_code\ttask_type",
          "%R\tT1\t1\tW1\tA100\tFirst\tTK_NotStart\tTT_Task",
        ),
      ),
    );
    expect(itemKey(s.activities[0])).toBe(targetKey(c.target));
  });
});
