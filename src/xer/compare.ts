// Compare the open schedule with a baseline .xer (usually last month's update): what was
// added or deleted, which dates moved, and which durations, logic or constraints changed.
// Activities are matched by Activity ID (task_code), WBS by their code path, never by
// internal ids, which change between exports.
import { workMinutesByDay } from "./calendar";
import { constraintName, formatDate, formatDuration, type DurationUnit } from "./format";
import type { Activity, Calendar, Relationship, Schedule, Status, Wbs } from "./model";

export type ChangeKind =
  | "added"
  | "start"
  | "finishLater"
  | "finishEarlier"
  | "duration"
  | "logic"
  | "constraint"
  | "progress"
  | "name"
  | "calendar"
  | "wbs";

/** In the order the Filter menu and the Changes tab list them. */
export const CHANGE_KINDS: [ChangeKind, string][] = [
  ["added", "Added"],
  ["finishLater", "Finish Later"],
  ["finishEarlier", "Finish Earlier"],
  ["start", "Start Moved"],
  ["duration", "Original Duration Changed"],
  ["logic", "Logic Changed"],
  ["constraint", "Constraint Changed"],
  ["progress", "Progressed"],
  ["name", "Renamed"],
  ["calendar", "Calendar Changed"],
  ["wbs", "Moved to Another WBS"],
];

const SHORT: Record<ChangeKind, string> = {
  added: "Added",
  start: "Start moved",
  finishLater: "Finish later",
  finishEarlier: "Finish earlier",
  duration: "Duration",
  logic: "Logic",
  constraint: "Constraint",
  progress: "Progressed",
  name: "Renamed",
  calendar: "Calendar",
  wbs: "WBS",
};

export interface LogicChange {
  /** Predecessor relationships in this schedule that the baseline doesn't have. */
  added: Relationship[];
  /** Baseline predecessor relationships that are gone (baseline objects). */
  removed: Relationship[];
  /** Same predecessor and type, different lag: [current, baseline]. */
  lag: [Relationship, Relationship][];
}

export interface ActivityChange {
  /** The baseline's copy of this activity; null when it was added. */
  base: Activity | null;
  kinds: Set<ChangeKind>;
  /**
   * Baseline date minus current date in working hours on the activity's calendar, like
   * P6's variance columns: negative means later than the baseline. Null without both dates.
   */
  startVarHrs: number | null;
  finishVarHrs: number | null;
  logic: LogicChange | null;
}

export interface Comparison {
  /** The baseline's file name. */
  name: string;
  baseline: Schedule;
  /** One entry per activity in the open schedule. */
  changes: Map<Activity, ActivityChange>;
  /** Baseline activities with no match in the open schedule. */
  deleted: Activity[];
  /** Open schedule WBS -> the baseline's WBS with the same code path. */
  wbs: Map<Wbs, Wbs>;
  /** Activities (current) per change kind; "deleted" is `deleted.length`. */
  counts: Map<ChangeKind, number>;
}

const EPS = 0.01; // hours

/** Working hours from `a` to `b` on `cal` (negative when `b` is earlier). */
export function workHoursBetween(cal: Calendar, a: number, b: number): number {
  if (a === b) return 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const h = workMinutesByDay(cal.work, lo, hi, 4000).reduce((n, [, m]) => n + m, 0) / 60;
  return b > a ? h : -h;
}

/** Baseline minus current, in working hours on `cal` (P6's variance sign). */
export function varianceHrs(cal: Calendar, current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return workHoursBetween(cal, current, baseline);
}

/** WBS code path below the project node, so a renamed project still matches. */
function wbsPath(w: Wbs, multiProject: boolean): string {
  const parts: string[] = [];
  for (let n: Wbs | null = w; n; n = n.parent) {
    if (n.parent || multiProject) parts.push(n.code);
  }
  return parts.reverse().join("\u0001");
}

const relKey = (r: Relationship) => `${r.pred.code}|${r.type}`;
const cstrKey = (a: Activity) => `${a.constraint}|${a.constraintDate ?? ""}|${a.constraint2}|${a.constraint2Date ?? ""}`;

export function compareSchedules(current: Schedule, baseline: Schedule, name: string): Comparison {
  // Activities by ID. Several projects in one file can repeat an ID: prefer the same project.
  const byCode = new Map<string, Activity[]>();
  for (const b of baseline.activities) {
    const list = byCode.get(b.code);
    if (list) list.push(b);
    else byCode.set(b.code, [b]);
  }
  const used = new Set<Activity>();
  const pick = (a: Activity): Activity | null => {
    const list = byCode.get(a.code);
    if (!list) return null;
    const free = list.filter((b) => !used.has(b));
    return free.find((b) => b.project?.shortName === a.project?.shortName) ?? free[0] ?? null;
  };

  const changes = new Map<Activity, ActivityChange>();
  const counts = new Map<ChangeKind, number>();
  const count = (k: ChangeKind) => counts.set(k, (counts.get(k) ?? 0) + 1);

  for (const a of current.activities) {
    const base = pick(a);
    if (!base) {
      changes.set(a, { base: null, kinds: new Set(["added"]), startVarHrs: null, finishVarHrs: null, logic: null });
      count("added");
      continue;
    }
    used.add(base);
    const kinds = new Set<ChangeKind>();
    const startVarHrs = varianceHrs(a.calendar, a.start, base.start);
    const finishVarHrs = varianceHrs(a.calendar, a.finish, base.finish);
    if (startVarHrs !== null ? Math.abs(startVarHrs) > EPS : a.start !== base.start) kinds.add("start");
    if (finishVarHrs !== null && finishVarHrs < -EPS) kinds.add("finishLater");
    else if (finishVarHrs !== null && finishVarHrs > EPS) kinds.add("finishEarlier");
    if (Math.abs((a.origDurHrs ?? 0) - (base.origDurHrs ?? 0)) > EPS) kinds.add("duration");
    if (cstrKey(a) !== cstrKey(base)) kinds.add("constraint");
    if (a.status !== base.status) kinds.add("progress");
    if (a.name !== base.name) kinds.add("name");
    if (a.calendar.name !== base.calendar.name) kinds.add("calendar");
    if (wbsPath(a.wbs, current.projects.length > 1) !== wbsPath(base.wbs, baseline.projects.length > 1)) kinds.add("wbs");

    const before = new Map(base.preds.map((r) => [relKey(r), r]));
    const now = new Map(a.preds.map((r) => [relKey(r), r]));
    const logic: LogicChange = { added: [], removed: [], lag: [] };
    for (const [k, r] of now) {
      const old = before.get(k);
      if (!old) logic.added.push(r);
      else if (Math.abs(old.lagHrs - r.lagHrs) > EPS) logic.lag.push([r, old]);
    }
    for (const [k, r] of before) if (!now.has(k)) logic.removed.push(r);
    const relinked = logic.added.length + logic.removed.length + logic.lag.length > 0;
    if (relinked) kinds.add("logic");

    for (const k of kinds) count(k);
    changes.set(a, { base, kinds, startVarHrs, finishVarHrs, logic: relinked ? logic : null });
  }

  const deleted = baseline.activities.filter((b) => !used.has(b));

  const multiCur = current.projects.length > 1;
  const multiBase = baseline.projects.length > 1;
  const basePaths = new Map<string, Wbs>();
  const walk = (w: Wbs, f: (w: Wbs) => void) => {
    f(w);
    for (const c of w.children) walk(c, f);
  };
  for (const r of baseline.roots) walk(r, (w) => basePaths.has(wbsPath(w, multiBase)) || basePaths.set(wbsPath(w, multiBase), w));
  const wbs = new Map<Wbs, Wbs>();
  for (const r of current.roots) {
    walk(r, (w) => {
      const b = basePaths.get(wbsPath(w, multiCur));
      if (b) wbs.set(w, b);
    });
  }

  return { name, baseline, changes, deleted, wbs, counts };
}

/** True when the activity changed in any way other than being progressed. */
export function changedBesidesProgress(ch: ActivityChange | undefined): boolean {
  if (!ch) return false;
  for (const k of ch.kinds) if (k !== "progress") return true;
  return false;
}

/** "Finish later, Logic" for the Change column. */
export function changeSummary(ch: ActivityChange | undefined): string {
  if (!ch) return "";
  return CHANGE_KINDS.filter(([k]) => ch.kinds.has(k)).map(([k]) => SHORT[k]).join(", ");
}

const STATUS_TEXT: Record<Status, string> = { NotStarted: "not started", InProgress: "in progress", Completed: "completed" };

function shift(hrs: number, cal: Calendar, unit: DurationUnit): string {
  // Variance is baseline - current: negative means the date is now later.
  return `${formatDuration(Math.abs(hrs), cal, unit)} ${hrs < 0 ? "later" : "earlier"}`;
}

function relText(r: Relationship, unit: DurationUnit): string {
  const lag = Math.abs(r.lagHrs) > EPS ? ` ${r.lagHrs > 0 ? "+" : ""}${formatDuration(r.lagHrs, r.lagCalendar, unit)}` : "";
  return `${r.pred.code} ${r.type}${lag}`;
}

/** Every change on one activity, in words, for the Changes tab and tooltips. */
export function describeChange(a: Activity, ch: ActivityChange, unit: DurationUnit): string[] {
  const out: string[] = [];
  const b = ch.base;
  if (!b) return ["Added since the baseline"];
  const cal = a.calendar;
  if (ch.kinds.has("start")) {
    const by = ch.startVarHrs !== null && Math.abs(ch.startVarHrs) > EPS ? ` ${shift(ch.startVarHrs, cal, unit)}` : "";
    out.push(`Start${by} (${formatDate(b.start, b.startActual)} → ${formatDate(a.start, a.startActual)})`);
  }
  if ((ch.kinds.has("finishLater") || ch.kinds.has("finishEarlier")) && ch.finishVarHrs !== null) {
    out.push(`Finish ${shift(ch.finishVarHrs, cal, unit)} (${formatDate(b.finish, b.finishActual)} → ${formatDate(a.finish, a.finishActual)})`);
  }
  if (ch.kinds.has("duration")) {
    out.push(`Original Duration ${formatDuration(b.origDurHrs ?? 0, b.calendar, unit)} → ${formatDuration(a.origDurHrs ?? 0, cal, unit)}`);
  }
  if (ch.logic) {
    const l = ch.logic;
    if (l.added.length) out.push(`Predecessor added: ${l.added.map((r) => relText(r, unit)).join(", ")}`);
    if (l.removed.length) out.push(`Predecessor removed: ${l.removed.map((r) => relText(r, unit)).join(", ")}`);
    for (const [r, old] of l.lag) {
      out.push(`Lag ${r.pred.code} ${r.type}: ${formatDuration(old.lagHrs, old.lagCalendar, unit)} → ${formatDuration(r.lagHrs, r.lagCalendar, unit)}`);
    }
  }
  if (ch.kinds.has("constraint")) {
    const c = (x: Activity) => {
      const parts = [x.constraint && `${constraintName(x.constraint)} ${formatDate(x.constraintDate)}`.trim(), x.constraint2 && `${constraintName(x.constraint2)} ${formatDate(x.constraint2Date)}`.trim()];
      return parts.filter(Boolean).join(" + ") || "none";
    };
    out.push(`Constraint ${c(b)} → ${c(a)}`);
  }
  if (ch.kinds.has("progress")) out.push(`Was ${STATUS_TEXT[b.status]}, now ${STATUS_TEXT[a.status]}`);
  if (ch.kinds.has("name")) out.push(`Renamed from "${b.name}"`);
  if (ch.kinds.has("calendar")) out.push(`Calendar ${b.calendar.name} → ${a.calendar.name}`);
  if (ch.kinds.has("wbs")) out.push(`Moved from WBS ${b.wbs.fullCode}`);
  return out;
}
