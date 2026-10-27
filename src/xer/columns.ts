// Column definitions for the activity grid: what each column shows and how it sorts.
import { FALLBACK_CAL, UDF_NUMBER_TYPES, type Activity, type LaborUnits, type Schedule, type UdfType, type Wbs } from "./model";
import {
  activityTypeName,
  constraintName,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  hoursTo,
  type DurationUnit,
} from "./format";

export interface ColumnContext {
  unit: DurationUnit;
}

export type SortValue = number | string | null;

/** Groups shown in the Columns dialog, in this order (like P6's Available Options). */
export const COLUMN_GROUPS = ["General", "Dates", "Durations", "Percent Complete", "Units", "User Defined Fields"] as const;
export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

export interface Column {
  key: string;
  label: string;
  group: ColumnGroup;
  /** How the filter row reads this column (see filter.ts). */
  kind: "text" | "number" | "date";
  width: number;
  align: "left" | "right" | "center";
  defaultVisible: boolean;
  text(a: Activity, ctx: ColumnContext): string;
  /** Optional rich cell content (trusted HTML); `text` is still used for tooltips. */
  html?(a: Activity): string;
  wbsText(w: Wbs, ctx: ColumnContext): string;
  sortValue(a: Activity, ctx: ColumnContext): SortValue;
}

const STATUS_NAMES = { NotStarted: "Not Started", InProgress: "In Progress", Completed: "Completed" } as const;

const wbsCal = (w: Wbs) => w.project?.calendar ?? FALLBACK_CAL;

const durationColumn = (
  key: string,
  label: string,
  pick: (a: Activity) => number | null,
  wbsPick: ((w: Wbs) => number | null) | null,
  defaultVisible: boolean,
): Column => ({
  key,
  label,
  group: "Durations",
  kind: "number",
  width: 80,
  align: "right",
  defaultVisible,
  text: (a, ctx) => formatDuration(pick(a), a.calendar, ctx.unit),
  wbsText: (w, ctx) => (wbsPick ? formatDuration(wbsPick(w), wbsCal(w), ctx.unit) : ""),
  sortValue: (a, ctx) => {
    const h = pick(a);
    return h === null ? null : hoursTo(h, a.calendar, ctx.unit);
  },
});

const dateColumn = (
  key: string,
  label: string,
  pick: (a: Activity) => number | null,
  marks: ((a: Activity) => [boolean, boolean]) | null,
  wbsPick: ((w: Wbs) => [number | null, boolean]) | null,
  defaultVisible: boolean,
): Column => ({
  key,
  label,
  group: "Dates",
  kind: "date",
  width: 92,
  align: "left",
  defaultVisible,
  text: (a) => {
    const [actual, constrained] = marks ? marks(a) : [false, false];
    return formatDate(pick(a), actual, constrained);
  },
  wbsText: (w) => {
    if (!wbsPick) return "";
    const [ms, actual] = wbsPick(w);
    return formatDate(ms, actual);
  },
  sortValue: (a) => pick(a),
});

/** Labor units are hours of work; WBS rows show the sum of everything under them. */
const unitsColumn = (key: string, label: string, pick: (l: LaborUnits) => number): Column => ({
  key,
  label,
  group: "Units",
  kind: "number",
  width: 90,
  align: "right",
  defaultVisible: false,
  text: (a) => formatNumber(pick(a.labor)) + "h",
  wbsText: (w) => formatNumber(pick(w.labor)) + "h",
  sortValue: (a) => pick(a.labor),
});

const generalColumn = (
  key: string,
  label: string,
  width: number,
  pick: (a: Activity) => string,
  defaultVisible = false,
  wbsText: (w: Wbs) => string = () => "",
): Column => ({
  key,
  label,
  group: "General",
  kind: "text",
  width,
  align: "left",
  defaultVisible,
  text: pick,
  wbsText,
  sortValue: pick,
});

export const COLUMNS: Column[] = [
  generalColumn("code", "Activity ID", 190, (a) => a.code, true, (w) => w.code),
  generalColumn("name", "Activity Name", 320, (a) => a.name, true, (w) => w.name),
  durationColumn("origDur", "Original Duration", (a) => a.origDurHrs, null, true),
  durationColumn("remDur", "Remaining Duration", (a) => a.remDurHrs, null, true),
  {
    key: "pct",
    label: "Activity % Complete",
    group: "Percent Complete",
    kind: "number",
    width: 80,
    align: "right",
    defaultVisible: false,
    text: (a) => formatPercent(a.pctComplete),
    wbsText: () => "",
    sortValue: (a) => a.pctComplete,
  },
  dateColumn(
    "start",
    "Start",
    (a) => a.start,
    (a) => [a.startActual, a.startConstrained],
    (w) => [w.start, w.startActual],
    true,
  ),
  dateColumn(
    "finish",
    "Finish",
    (a) => a.finish,
    (a) => [a.finishActual, a.finishConstrained],
    (w) => [w.finish, w.finishActual],
    true,
  ),
  durationColumn("totalFloat", "Total Float", (a) => a.totalFloatHrs, (w) => w.totalFloatHrs, true),
  durationColumn("freeFloat", "Free Float", (a) => a.freeFloatHrs, null, false),
  generalColumn("status", "Activity Status", 90, (a) => STATUS_NAMES[a.status]),
  generalColumn("type", "Activity Type", 110, (a) => activityTypeName(a.type)),
  generalColumn("calendar", "Calendar", 160, (a) => a.calendar.name),
  dateColumn("plannedStart", "Planned Start", (a) => a.plannedStart, null, null, false),
  dateColumn("plannedFinish", "Planned Finish", (a) => a.plannedFinish, null, null, false),
  dateColumn("lateStart", "Late Start", (a) => a.lateStart, null, null, false),
  dateColumn("lateFinish", "Late Finish", (a) => a.lateFinish, null, null, false),
  generalColumn("constraint", "Primary Constraint", 130, (a) => constraintName(a.constraint)),
  unitsColumn("budLabor", "Budgeted Labor Units", (l) => l.budget),
  unitsColumn("actLabor", "Actual Labor Units", (l) => l.actual),
  unitsColumn("remLabor", "Remaining Labor Units", (l) => l.remaining),
];

export const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));

/** P6 indicator UDF values. */
const INDICATORS: Record<string, string> = { UDF_G1: "Red", UDF_G2: "Yellow", UDF_G3: "Green", UDF_G4: "Blue" };

/** UDF column keys use the label, so a saved column layout carries over between files. */
export function udfColumnKey(t: UdfType): string {
  return `udf:${t.label}`;
}

function udfColumn(t: UdfType): Column {
  const isDate = t.dataType === "FT_START_DATE" || t.dataType === "FT_END_DATE" || t.dataType === "FT_DATE";
  const isIndicator = t.dataType === "FT_STATICTYPE";
  const isNumber = UDF_NUMBER_TYPES.has(t.dataType);
  const decimals = t.dataType === "FT_INT" ? 0 : 2;
  const text = (a: Activity): string => {
    const v = a.udf.get(t.id);
    if (v === undefined) return "";
    if (typeof v === "string") return isIndicator ? INDICATORS[v] ?? v : v;
    return isDate ? formatDate(v) : formatNumber(v, decimals);
  };
  return {
    key: udfColumnKey(t),
    label: t.label,
    group: "User Defined Fields",
    kind: isDate ? "date" : isNumber ? "number" : "text",
    width: isIndicator ? 70 : 120,
    align: isIndicator ? "center" : isNumber ? "right" : "left",
    defaultVisible: false,
    text,
    html: isIndicator
      ? (a) => {
          const v = a.udf.get(t.id);
          return typeof v === "string" && INDICATORS[v] ? `<span class="ind ${v}"></span>` : "";
        }
      : undefined,
    wbsText: () => "",
    sortValue: (a) => a.udf.get(t.id) ?? null,
  };
}

/** Every column available for this schedule: the fixed ones plus one per activity UDF. */
export function scheduleColumns(s: Schedule | null): Column[] {
  return s ? [...COLUMNS, ...s.udfTypes.map(udfColumn)] : COLUMNS;
}
