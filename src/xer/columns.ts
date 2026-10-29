// Column definitions for the activity grid: what each column shows and how it sorts.
import {
  FALLBACK_CAL,
  UDF_NUMBER_TYPES,
  type Activity,
  type ActivityCodeType,
  type LaborUnits,
  type Schedule,
  type UdfType,
  type Wbs,
} from "./model";
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
export const COLUMN_GROUPS = ["General", "Activity Codes", "Dates", "Durations", "Percent Complete", "Units", "User Defined Fields"] as const;
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

const WEEK_MS = 7 * 86_400_000;

/**
 * WBS band durations in calendar weeks from the band's summarised dates, ignoring the
 * activities' own durations. Remaining runs from the later of the start and the data
 * date; a band whose activities are all complete has 0w remaining.
 */
export function wbsWeeks(w: Wbs, remaining: boolean): number | null {
  if (w.start === null || w.finish === null) return null;
  if (!remaining) return Math.max(0, w.finish - w.start) / WEEK_MS;
  if (w.finishActual) return 0;
  const from = Math.max(w.start, w.project?.dataDate ?? w.start);
  return Math.max(0, w.finish - from) / WEEK_MS;
}

const formatWeeks = (weeks: number | null) => (weeks === null ? "" : formatNumber(weeks, 1) + "w");

const durationColumn = (
  key: string,
  label: string,
  pick: (a: Activity) => number | null,
  wbsText: ((w: Wbs, ctx: ColumnContext) => string) | null,
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
  wbsText: wbsText ?? (() => ""),
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

/** Labor and nonlabor units are hours; WBS rows show the sum of everything under them. */
const unitsColumn = (
  key: string,
  label: string,
  pick: (l: LaborUnits) => number,
  which: "labor" | "nonlabor" = "labor",
): Column => ({
  key,
  label,
  group: "Units",
  kind: "number",
  width: 90,
  align: "right",
  defaultVisible: false,
  text: (a) => formatNumber(pick(a[which])) + "h",
  wbsText: (w) => formatNumber(pick(w[which])) + "h",
  sortValue: (a) => pick(a[which]),
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
  durationColumn("origDur", "Original Duration", (a) => a.origDurHrs, (w) => formatWeeks(wbsWeeks(w, false)), true),
  durationColumn("remDur", "Remaining Duration", (a) => a.remDurHrs, (w) => formatWeeks(wbsWeeks(w, true)), true),
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
  durationColumn(
    "totalFloat",
    "Total Float",
    (a) => a.totalFloatHrs,
    (w, ctx) => formatDuration(w.totalFloatHrs, wbsCal(w), ctx.unit),
    true,
  ),
  durationColumn("freeFloat", "Free Float", (a) => a.freeFloatHrs, null, false),
  generalColumn("status", "Activity Status", 90, (a) => STATUS_NAMES[a.status]),
  generalColumn("type", "Activity Type", 110, (a) => activityTypeName(a.type)),
  generalColumn("calendar", "Calendar", 160, (a) => a.calendar.name),
  dateColumn("plannedStart", "Planned Start", (a) => a.plannedStart, null, null, false),
  dateColumn("plannedFinish", "Planned Finish", (a) => a.plannedFinish, null, null, false),
  dateColumn("lateStart", "Late Start", (a) => a.lateStart, null, null, false),
  dateColumn("lateFinish", "Late Finish", (a) => a.lateFinish, null, null, false),
  generalColumn("constraint", "Primary Constraint", 130, (a) => constraintName(a.constraint)),
  dateColumn("constraintDate", "Primary Constraint Date", (a) => a.constraintDate, null, null, false),
  generalColumn("constraint2", "Secondary Constraint", 130, (a) => constraintName(a.constraint2)),
  dateColumn("constraint2Date", "Secondary Constraint Date", (a) => a.constraint2Date, null, null, false),
  dateColumn("actualStart", "Actual Start", (a) => a.actualStart, null, null, false),
  dateColumn("actualFinish", "Actual Finish", (a) => a.actualFinish, null, null, false),
  dateColumn("expectedFinish", "Expected Finish", (a) => a.expectedFinish, null, null, false),
  generalColumn("durationType", "Duration Type", 170, (a) => durationTypeName(a.durationType)),
  generalColumn("pctType", "Percent Complete Type", 110, (a) => pctTypeName(a.pctCompleteType)),
  {
    key: "physPct",
    label: "Physical % Complete",
    group: "Percent Complete",
    kind: "number",
    width: 80,
    align: "right",
    defaultVisible: false,
    text: (a) => (a.physPctComplete === null ? "" : formatPercent(a.physPctComplete)),
    wbsText: () => "",
    sortValue: (a) => a.physPctComplete,
  },
  generalColumn("primaryResource", "Primary Resource", 150, (a) => a.primaryResource),
  generalColumn("wbsCode", "WBS Code", 180, (a) => a.wbs.fullCode, false, (w) => w.fullCode),
  generalColumn("wbsName", "WBS Name", 220, (a) => a.wbs.name, false, (w) => w.name),
  generalColumn("project", "Project", 130, (a) => a.project?.shortName ?? "", false, (w) => w.project?.shortName ?? ""),
  unitsColumn("budLabor", "Budgeted Labor Units", (l) => l.budget),
  unitsColumn("actLabor", "Actual Labor Units", (l) => l.actual),
  unitsColumn("remLabor", "Remaining Labor Units", (l) => l.remaining),
  unitsColumn("budNonlabor", "Budgeted Nonlabor Units", (l) => l.budget, "nonlabor"),
  unitsColumn("actNonlabor", "Actual Nonlabor Units", (l) => l.actual, "nonlabor"),
  unitsColumn("remNonlabor", "Remaining Nonlabor Units", (l) => l.remaining, "nonlabor"),
];

const DURATION_TYPES: Record<string, string> = {
  DT_FixedDUR2: "Fixed Duration and Units",
  DT_FixedDrtn: "Fixed Duration and Units/Time",
  DT_FixedQty: "Fixed Units",
  DT_FixedRate: "Fixed Units/Time",
};
const durationTypeName = (t: string) => DURATION_TYPES[t] ?? t;

const PCT_TYPES: Record<string, string> = { CP_Drtn: "Duration", CP_Phys: "Physical", CP_Units: "Units" };
const pctTypeName = (t: string) => PCT_TYPES[t] ?? t;

/** Code column keys use the code type's name, so a saved layout carries over between files. */
export function codeColumnKey(t: ActivityCodeType, description = false): string {
  return `${description ? "codedesc" : "code"}:${t.label}`;
}

/** Two columns per code type, like P6: the code value ("ME") and its description ("Mechanical"). */
function codeColumns(t: ActivityCodeType): Column[] {
  const make = (description: boolean): Column => {
    const pick = (a: Activity) => {
      const c = a.codes.get(t.id);
      return c ? (description ? c.description : c.value) : "";
    };
    return {
      key: codeColumnKey(t, description),
      label: description ? `${t.label} (Description)` : t.label,
      group: "Activity Codes",
      kind: "text",
      width: description ? 180 : 100,
      align: "left",
      defaultVisible: false,
      text: pick,
      wbsText: () => "",
      sortValue: pick,
    };
  };
  return [make(false), make(true)];
}

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
  return s ? [...COLUMNS, ...s.codeTypes.flatMap(codeColumns), ...s.udfTypes.map(udfColumn)] : COLUMNS;
}
