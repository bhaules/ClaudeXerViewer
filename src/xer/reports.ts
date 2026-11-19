// Excel sheets for the Changes tab and the Schedule Check tab (no DOM; see xlsx.ts).
import { CHANGE_KINDS, changedBesidesProgress, changeSummary, describeChange, type Comparison } from "./compare";
import { hoursTo, type DurationUnit } from "./format";
import type { CheckResult } from "./health";
import type { Activity } from "./model";
import type { SheetCell, TableSheet } from "./xlsx";

const UNIT_LABEL = { h: "h", d: "d", w: "w", m: "mo" } as const;
const date = (ms: number | null): SheetCell => (ms === null ? null : { date: ms });
const dur = (hrs: number | null, a: Activity, unit: DurationUnit): SheetCell =>
  hrs === null ? null : Math.round(hoursTo(hrs, a.calendar, unit) * 100) / 100;

/** A two-column label / value sheet. */
export function infoSheet(rows: [string, string][], name = "Export Info"): TableSheet {
  return {
    name,
    columns: [
      { label: "Item", width: 22 },
      { label: "Value", width: 90 },
    ],
    rows: rows.map(([k, v]) => ({ cells: [k, v] })),
  };
}

/**
 * Every change since the baseline, one row per activity (deleted ones included), plus a
 * summary of counts. `all` false leaves out activities that were only progressed.
 */
export function changesSheets(cmp: Comparison, unit: DurationUnit, all = false): TableSheet[] {
  const u = UNIT_LABEL[unit];
  const columns = [
    { label: "Activity ID", width: 18 },
    { label: "Activity Name", width: 44 },
    { label: "WBS", width: 22 },
    { label: "Change", width: 26 },
    { label: "BL Start", width: 11, align: "right" as const },
    { label: "Start", width: 11, align: "right" as const },
    { label: "BL Finish", width: 11, align: "right" as const },
    { label: "Finish", width: 11, align: "right" as const },
    { label: `Start Variance (${u})`, width: 11 },
    { label: `Finish Variance (${u})`, width: 11 },
    { label: `BL Original Duration (${u})`, width: 12 },
    { label: `Original Duration (${u})`, width: 12 },
    { label: "Details", width: 90 },
  ];
  const rows: TableSheet["rows"] = [];
  const list = [...cmp.changes].filter(([, ch]) => (all ? ch.kinds.size > 0 : changedBesidesProgress(ch)));
  // Biggest finish slips first, then by Activity ID.
  list.sort(([a, x], [b, y]) => (x.finishVarHrs ?? 0) - (y.finishVarHrs ?? 0) || a.code.localeCompare(b.code, undefined, { numeric: true }));
  for (const [a, ch] of list) {
    const b = ch.base;
    rows.push({
      cells: [
        a.code,
        a.name,
        a.wbs.fullCode,
        changeSummary(ch),
        date(b?.start ?? null),
        date(a.start),
        date(b?.finish ?? null),
        date(a.finish),
        dur(ch.startVarHrs, a, unit),
        dur(ch.finishVarHrs, a, unit),
        b ? dur(b.origDurHrs, b, unit) : null,
        dur(a.origDurHrs, a, unit),
        describeChange(a, ch, unit).join("; "),
      ],
    });
  }
  for (const b of cmp.deleted) {
    rows.push({
      cells: [b.code, b.name, b.wbs.fullCode, "Deleted", date(b.start), null, date(b.finish), null, null, null, dur(b.origDurHrs, b, unit), null, "Deleted since the baseline"],
      color: "#808080",
    });
  }

  const anyCount = [...cmp.changes.values()].filter(changedBesidesProgress).length;
  const summary: TableSheet = {
    name: "Summary",
    columns: [
      { label: "Change", width: 30 },
      { label: "Activities", width: 12 },
    ],
    rows: [
      { cells: ["All changes (not progress)", anyCount], bold: true },
      ...CHANGE_KINDS.map(([k, label]) => ({ cells: [label, cmp.counts.get(k) ?? 0] as SheetCell[] })),
      { cells: ["Deleted", cmp.deleted.length] },
    ],
  };
  return [{ name: "Changes", columns, rows, frozenCols: 2 }, summary];
}

/** The check results, and every activity each check flags. */
export function checkSheets(results: CheckResult[], unit: DurationUnit): TableSheet[] {
  const u = UNIT_LABEL[unit];
  const summary: TableSheet = {
    name: "Schedule Check",
    columns: [
      { label: "#", width: 5 },
      { label: "Check", width: 28 },
      { label: "Result", width: 9 },
      { label: "Count", width: 9 },
      { label: "Of", width: 9 },
      { label: "Counted", width: 20 },
      { label: "Value", width: 9, align: "right" },
      { label: "Target", width: 9, align: "right" },
      { label: "What it checks", width: 80 },
    ],
    rows: results.map((r) => ({
      cells: [r.no, r.name, r.pass === null ? "" : r.pass ? "Pass" : "Fail", r.total ? r.count : null, r.total || null, r.of, r.value, r.target, r.description],
      fill: r.pass === false ? "#fde2e0" : r.pass ? "#e3f4e1" : undefined,
    })),
  };
  const details: TableSheet = {
    name: "Flagged Activities",
    columns: [
      { label: "Check", width: 26 },
      { label: "Activity ID", width: 18 },
      { label: "Activity Name", width: 44 },
      { label: "WBS", width: 22 },
      { label: "Start", width: 11, align: "right" },
      { label: "Finish", width: 11, align: "right" },
      { label: `Remaining Duration (${u})`, width: 12 },
      { label: `Total Float (${u})`, width: 11 },
      { label: "Predecessors", width: 12 },
      { label: "Successors", width: 12 },
    ],
    rows: results.flatMap((r) =>
      r.id === "critical"
        ? []
        : [...r.activities].map((a) => ({
            cells: [r.name, a.code, a.name, a.wbs.fullCode, date(a.start), date(a.finish), dur(a.remDurHrs, a, unit), dur(a.totalFloatHrs, a, unit), a.preds.length, a.succs.length],
          })),
    ),
  };
  return [summary, details];
}
