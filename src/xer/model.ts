// Tables -> Schedule: the linked object model the UI works with.
import { defaultPattern, hasWorkBetween, parseCalendarData, type DayRanges, type WorkPattern } from "./calendar";
import type { Row, XerTables } from "./parse";

export type RelType = "FS" | "SS" | "FF" | "SF";
export type Status = "NotStarted" | "InProgress" | "Completed";

export interface Calendar {
  id: string;
  name: string;
  dayHrs: number;
  weekHrs: number;
  monthHrs: number;
  work: WorkPattern;
}

export interface Project {
  id: string;
  shortName: string;
  name: string;
  dataDate: number | null;
  root: Wbs;
  calendar: Calendar;
}

export interface Wbs {
  id: string;
  project: Project | null;
  parent: Wbs | null;
  code: string;
  fullCode: string;
  name: string;
  seq: number;
  level: number;
  children: Wbs[];
  activities: Activity[];
  // Rollups over the whole subtree.
  activityCount: number;
  start: number | null;
  finish: number | null;
  startActual: boolean;
  finishActual: boolean;
  totalFloatHrs: number | null;
  critical: boolean;
  labor: LaborUnits;
}

/** Labor units in hours of work (TASK *_work_qty), summed for WBS. */
export interface LaborUnits {
  budget: number;
  actual: number;
  remaining: number;
}

export interface UdfType {
  id: string;
  label: string;
  /** FT_TEXT, FT_INT, FT_FLOAT_2_DECIMALS, FT_MONEY, FT_START_DATE, FT_END_DATE, FT_STATICTYPE (indicator). */
  dataType: string;
}

/** Text, a number, a date (ms), or an indicator code such as "UDF_G3". */
export type UdfValue = string | number;

export interface Resource {
  id: string;
  code: string;
  name: string;
  /** Labor, Nonlabor or Material. */
  type: string;
  assignments: Assignment[];
  /** Totals over all assignments, in the resource's units (hours for labor). */
  budget: number;
  actual: number;
  remaining: number;
}

/** A resource on an activity (TASKRSRC). Units are hours for labor resources. */
export interface Assignment {
  activity: Activity;
  resource: Resource;
  budget: number;
  actual: number;
  remaining: number;
  actStart: number | null;
  actFinish: number | null;
  remStart: number | null;
  remFinish: number | null;
}

export interface Activity {
  id: string;
  code: string;
  name: string;
  wbs: Wbs;
  project: Project | null;
  calendar: Calendar;
  type: string;
  status: Status;
  origDurHrs: number | null;
  remDurHrs: number | null;
  totalFloatHrs: number | null;
  freeFloatHrs: number | null;
  pctComplete: number;
  start: number | null;
  finish: number | null;
  startActual: boolean;
  finishActual: boolean;
  startConstrained: boolean;
  finishConstrained: boolean;
  constraint: string;
  plannedStart: number | null;
  plannedFinish: number | null;
  lateStart: number | null;
  lateFinish: number | null;
  critical: boolean;
  labor: LaborUnits;
  assignments: Assignment[];
  /** UDF values keyed by udf_type_id. */
  udf: Map<string, UdfValue>;
  preds: Relationship[];
  succs: Relationship[];
  raw: Row;
}

export interface Relationship {
  pred: Activity;
  succ: Activity;
  type: RelType;
  lagHrs: number;
  lagCalendar: Calendar;
  /** The relationship sets the successor's early date (relationship free float is zero). */
  driving: boolean;
}

export interface Schedule {
  header: string[];
  projects: Project[];
  roots: Wbs[];
  activities: Activity[];
  activityById: Map<string, Activity>;
  relationships: Relationship[];
  calendars: Map<string, Calendar>;
  /** Activity (TASK) UDFs that have at least one value, sorted by label. */
  udfTypes: UdfType[];
  /** Resources with at least one assignment in the file, by Resource ID. */
  resources: Resource[];
}

const ALL_DAY: DayRanges = [[0, 24 * 60]];
const HOUR_CAL_24: Calendar = {
  id: "24h",
  name: "24 Hour",
  dayHrs: 24,
  weekHrs: 168,
  monthHrs: 730,
  work: { week: Array.from({ length: 7 }, () => ALL_DAY), exceptions: new Map() },
};
export const FALLBACK_CAL: Calendar = {
  id: "default",
  name: "Default (8h/day)",
  dayHrs: 8,
  weekHrs: 40,
  monthHrs: 172,
  work: defaultPattern(8),
};

const START_CONSTRAINTS = new Set(["CS_MSO", "CS_MSOA", "CS_MSOB", "CS_MANDSTART"]);
const FINISH_CONSTRAINTS = new Set(["CS_MEO", "CS_MEOA", "CS_MEOB", "CS_MANDFIN"]);

/** "yyyy-mm-dd hh:mm" -> ms since epoch, treating the wall-clock time as UTC so DST never shifts it. */
export function parseXerDate(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const year = +m[1];
  if (year < 1900) return null; // P6 writes 1899-12-30 as "no date"
  return Date.UTC(year, +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

function num(s: string | undefined): number | null {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function positive(n: number | null, fallback: number): number {
  return n !== null && n > 0 ? n : fallback;
}

function relType(predType: string): RelType {
  switch (predType) {
    case "PR_SS": return "SS";
    case "PR_FF": return "FF";
    case "PR_SF": return "SF";
    default: return "FS";
  }
}

function status(code: string): Status {
  if (code === "TK_Complete") return "Completed";
  if (code === "TK_Active") return "InProgress";
  return "NotStarted";
}

function pctComplete(r: Row, orig: number | null, rem: number | null): number {
  switch (r.complete_pct_type) {
    case "CP_Phys":
      return num(r.phys_complete_pct) ?? 0;
    case "CP_Units": {
      const act = num(r.act_work_qty) ?? 0;
      const total = act + (num(r.remain_work_qty) ?? 0);
      return total > 0 ? (act / total) * 100 : 0;
    }
    default: {
      if (r.status_code === "TK_Complete") return 100;
      if (!orig || orig <= 0 || rem === null) return 0;
      return Math.max(0, Math.min(100, ((orig - rem) / orig) * 100));
    }
  }
}

export function buildSchedule({ header, tables }: XerTables): Schedule {
  const get = (name: string) => tables.get(name) ?? [];

  const calendars = new Map<string, Calendar>();
  const unparsed: [Calendar, Row][] = [];
  for (const r of get("CALENDAR")) {
    const dayHrs = positive(num(r.day_hr_cnt), 8);
    const parsed = parseCalendarData(r.clndr_data);
    const cal: Calendar = {
      id: r.clndr_id,
      name: r.clndr_name || r.clndr_id,
      dayHrs,
      weekHrs: positive(num(r.week_hr_cnt), dayHrs * 5),
      monthHrs: positive(num(r.month_hr_cnt), dayHrs * 21.5),
      work: parsed ?? defaultPattern(dayHrs),
    };
    if (!parsed) unparsed.push([cal, r]);
    calendars.set(r.clndr_id, cal);
  }
  // A calendar without its own working pattern borrows its base calendar's.
  for (const [cal, r] of unparsed) {
    const base = calendars.get(r.base_clndr_id);
    if (base && base !== cal) cal.work = base.work;
  }
  const defaultCal =
    [...calendars.values()].find((c) => get("CALENDAR").find((r) => r.clndr_id === c.id)?.default_flag === "Y") ??
    FALLBACK_CAL;

  const lagSetting = new Map<string, string>();
  for (const r of get("SCHEDOPTIONS")) lagSetting.set(r.proj_id, r.sched_calendar_on_relationship_lag);

  // WBS nodes
  const wbsById = new Map<string, Wbs>();
  const wbsRows = get("PROJWBS");
  for (const r of wbsRows) {
    wbsById.set(r.wbs_id, {
      id: r.wbs_id,
      project: null,
      parent: null,
      code: r.wbs_short_name,
      fullCode: r.wbs_short_name,
      name: r.wbs_name,
      seq: num(r.seq_num) ?? 0,
      level: 0,
      children: [],
      activities: [],
      activityCount: 0,
      start: null,
      finish: null,
      startActual: false,
      finishActual: false,
      totalFloatHrs: null,
      critical: false,
      labor: { budget: 0, actual: 0, remaining: 0 },
    });
  }

  // Projects
  const projects: Project[] = [];
  const projectById = new Map<string, Project>();
  const projectInfo = new Map<string, Row>();
  for (const r of get("PROJECT")) projectInfo.set(r.proj_id, r);
  for (const r of wbsRows) {
    if (r.proj_node_flag !== "Y") continue;
    const info = projectInfo.get(r.proj_id);
    const root = wbsById.get(r.wbs_id)!;
    const project: Project = {
      id: r.proj_id,
      shortName: info?.proj_short_name || r.wbs_short_name,
      name: r.wbs_name,
      dataDate: parseXerDate(info?.last_recalc_date),
      root,
      calendar: (info && calendars.get(info.clndr_id)) || defaultCal,
    };
    projects.push(project);
    projectById.set(project.id, project);
  }

  // Link the tree. A parent that isn't in the file (an EPS node) makes this a root.
  const roots: Wbs[] = [];
  for (const r of wbsRows) {
    const node = wbsById.get(r.wbs_id)!;
    node.project = projectById.get(r.proj_id) ?? null;
    const parent = r.proj_node_flag === "Y" ? undefined : wbsById.get(r.parent_wbs_id);
    if (parent && parent !== node) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sepFor = (p: Project | null) => (p && projectInfo.get(p.id)?.name_sep_char) || ".";
  const visited = new Set<Wbs>();
  const assignLevels = (node: Wbs, level: number) => {
    if (visited.has(node)) return; // guard against a corrupt parent cycle
    visited.add(node);
    node.level = level;
    if (node.parent) node.fullCode = node.parent.fullCode + sepFor(node.project) + node.code;
    node.children.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code));
    for (const c of node.children) assignLevels(c, level + 1);
  };
  roots.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code));
  for (const r of roots) assignLevels(r, 0);

  // Activities
  let orphanWbs: Wbs | null = null;
  const activities: Activity[] = [];
  const activityById = new Map<string, Activity>();
  for (const r of get("TASK")) {
    let wbs = wbsById.get(r.wbs_id);
    if (!wbs) {
      if (!orphanWbs) {
        orphanWbs = {
          ...structuredClone(EMPTY_WBS),
          id: "__orphan__",
          code: "(No WBS)",
          fullCode: "(No WBS)",
          name: "Activities without a WBS",
          seq: Number.MAX_SAFE_INTEGER,
        };
        roots.push(orphanWbs);
      }
      wbs = orphanWbs;
    }
    const project = projectById.get(r.proj_id) ?? null;
    const actStart = parseXerDate(r.act_start_date);
    const actEnd = parseXerDate(r.act_end_date);
    const origDurHrs = num(r.target_drtn_hr_cnt);
    const remDurHrs = num(r.remain_drtn_hr_cnt);
    const st = status(r.status_code);
    const a: Activity = {
      id: r.task_id,
      code: r.task_code,
      name: r.task_name,
      wbs,
      project,
      calendar: calendars.get(r.clndr_id) ?? project?.calendar ?? defaultCal,
      type: r.task_type || "TT_Task",
      status: st,
      origDurHrs,
      remDurHrs,
      totalFloatHrs: st === "Completed" ? null : num(r.total_float_hr_cnt),
      freeFloatHrs: st === "Completed" ? null : num(r.free_float_hr_cnt),
      pctComplete: pctComplete(r, origDurHrs, remDurHrs),
      start:
        actStart ??
        parseXerDate(r.restart_date) ??
        parseXerDate(r.early_start_date) ??
        parseXerDate(r.target_start_date),
      finish:
        actEnd ?? parseXerDate(r.reend_date) ?? parseXerDate(r.early_end_date) ?? parseXerDate(r.target_end_date),
      startActual: actStart !== null,
      finishActual: actEnd !== null,
      startConstrained: START_CONSTRAINTS.has(r.cstr_type) || START_CONSTRAINTS.has(r.cstr_type2),
      finishConstrained: FINISH_CONSTRAINTS.has(r.cstr_type) || FINISH_CONSTRAINTS.has(r.cstr_type2),
      constraint: r.cstr_type ?? "",
      plannedStart: parseXerDate(r.target_start_date),
      plannedFinish: parseXerDate(r.target_end_date),
      lateStart: parseXerDate(r.late_start_date),
      lateFinish: parseXerDate(r.late_end_date),
      critical: false,
      labor: {
        budget: num(r.target_work_qty) ?? 0,
        actual: num(r.act_work_qty) ?? 0,
        remaining: num(r.remain_work_qty) ?? 0,
      },
      assignments: [],
      udf: new Map(),
      preds: [],
      succs: [],
      raw: r,
    };
    a.critical = isCritical(a, projectInfo.get(r.proj_id));
    activities.push(a);
    activityById.set(a.id, a);
    wbs.activities.push(a);
  }

  // Relationships. Ones pointing at activities in another (unexported) project are dropped.
  const relationships: Relationship[] = [];
  for (const r of get("TASKPRED")) {
    const pred = activityById.get(r.pred_task_id);
    const succ = activityById.get(r.task_id);
    if (!pred || !succ) continue;
    const type = relType(r.pred_type);
    const lagHrs = num(r.lag_hr_cnt) ?? 0;
    const rel: Relationship = {
      pred,
      succ,
      type,
      lagHrs,
      lagCalendar: lagCalendar(lagSetting.get(r.proj_id), pred, succ),
      driving: isDriving(r, type, lagHrs, pred, succ),
    };
    relationships.push(rel);
    pred.succs.push(rel);
    succ.preds.push(rel);
  }

  applyRollups(roots);

  const udfTypes = readActivityUdfs(get("UDFTYPE"), get("UDFVALUE"), activityById);

  const resources = readAssignments(get("RSRC"), get("TASKRSRC"), activityById);

  return { header, projects, roots, activities, activityById, relationships, calendars, udfTypes, resources };
}

const EMPTY_WBS: Wbs = {
  id: "",
  project: null,
  parent: null,
  code: "",
  fullCode: "",
  name: "",
  seq: 0,
  level: 0,
  children: [],
  activities: [],
  activityCount: 0,
  start: null,
  finish: null,
  startActual: false,
  finishActual: false,
  totalFloatHrs: null,
  critical: false,
  labor: { budget: 0, actual: 0, remaining: 0 },
};

const UDF_DATE_TYPES = new Set(["FT_START_DATE", "FT_END_DATE", "FT_DATE"]);
export const UDF_NUMBER_TYPES = new Set(["FT_INT", "FT_FLOAT_2_DECIMALS", "FT_MONEY", "FT_FLOAT"]);

/** UDFVALUE stores a value in udf_text, udf_number or udf_date depending on the type; indicators use udf_text. */
function readActivityUdfs(typeRows: Row[], valueRows: Row[], activities: Map<string, Activity>): UdfType[] {
  const types = new Map<string, UdfType>();
  for (const r of typeRows) {
    if (r.table_name !== "TASK") continue;
    types.set(r.udf_type_id, { id: r.udf_type_id, label: r.udf_type_label || r.udf_type_name, dataType: r.logical_data_type });
  }
  const used = new Set<string>();
  for (const r of valueRows) {
    const type = types.get(r.udf_type_id);
    const act = type && activities.get(r.fk_id);
    if (!type || !act) continue;
    let value: UdfValue | null;
    if (UDF_DATE_TYPES.has(type.dataType)) value = parseXerDate(r.udf_date);
    else if (UDF_NUMBER_TYPES.has(type.dataType)) value = num(r.udf_number);
    else value = r.udf_text || null;
    if (value === null) continue;
    act.udf.set(type.id, value);
    used.add(type.id);
  }
  return [...types.values()].filter((t) => used.has(t.id)).sort((a, b) => a.label.localeCompare(b.label));
}

const RESOURCE_TYPES: Record<string, string> = { RT_Labor: "Labor", RT_Equip: "Nonlabor", RT_Mat: "Material" };

function readAssignments(rsrcRows: Row[], assignRows: Row[], activities: Map<string, Activity>): Resource[] {
  const byId = new Map<string, Resource>();
  for (const r of rsrcRows) {
    byId.set(r.rsrc_id, {
      id: r.rsrc_id,
      code: r.rsrc_short_name || r.rsrc_id,
      name: r.rsrc_name || r.rsrc_short_name,
      type: RESOURCE_TYPES[r.rsrc_type] ?? r.rsrc_type,
      assignments: [],
      budget: 0,
      actual: 0,
      remaining: 0,
    });
  }
  for (const r of assignRows) {
    const resource = byId.get(r.rsrc_id);
    const activity = activities.get(r.task_id);
    if (!resource || !activity) continue; // role-only assignments have no rsrc_id
    const a: Assignment = {
      activity,
      resource,
      budget: num(r.target_qty) ?? 0,
      actual: (num(r.act_reg_qty) ?? 0) + (num(r.act_ot_qty) ?? 0),
      remaining: num(r.remain_qty) ?? 0,
      actStart: parseXerDate(r.act_start_date),
      actFinish: parseXerDate(r.act_end_date),
      remStart: parseXerDate(r.restart_date) ?? parseXerDate(r.target_start_date),
      remFinish: parseXerDate(r.reend_date) ?? parseXerDate(r.target_end_date),
    };
    resource.assignments.push(a);
    resource.budget += a.budget;
    resource.actual += a.actual;
    resource.remaining += a.remaining;
    activity.assignments.push(a);
  }
  return [...byId.values()]
    .filter((r) => r.assignments.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

function isCritical(a: Activity, project: Row | undefined): boolean {
  if (a.status === "Completed") return false;
  if (project?.critical_path_type === "CT_DrivPath") return a.raw.driving_path_flag === "Y";
  const limit = num(project?.critical_drtn_hr_cnt) ?? 0;
  return a.totalFloatHrs !== null && a.totalFloatHrs <= limit;
}

/**
 * P6 exports the date each relationship imposes on its successor as TASKPRED.aref
 * (predecessor date + lag). The relationship drives when no working time on the
 * successor's calendar separates that date from the successor's remaining early
 * start (FS/SS) or finish (FF/SF). Exports without aref can only be judged for zero lag.
 */
function isDriving(r: Row, type: RelType, lagHrs: number, pred: Activity, succ: Activity): boolean {
  if (succ.status === "Completed") return false;
  const raw = succ.raw;
  const toStart = type === "FS" || type === "SS";
  const target = toStart
    ? parseXerDate(raw.restart_date) ?? parseXerDate(raw.early_start_date)
    : parseXerDate(raw.reend_date) ?? parseXerDate(raw.early_end_date);
  let imposed = parseXerDate(r.aref);
  if (imposed === null && lagHrs === 0) imposed = type === "FS" || type === "FF" ? pred.finish : pred.start;
  if (target === null || imposed === null) return false;
  return !hasWorkBetween(succ.calendar.work, imposed, target);
}

function lagCalendar(setting: string | undefined, pred: Activity, succ: Activity): Calendar {
  switch (setting) {
    case "rcal_Successor": return succ.calendar;
    case "rcal_24Hour": return HOUR_CAL_24;
    case "rcal_ProjDefault": return pred.project?.calendar ?? pred.calendar;
    default: return pred.calendar;
  }
}

/**
 * Recomputes every WBS rollup (dates, float, labor, activity count) from the
 * activities that pass `include`, like P6 summarising only what a filter shows.
 */
export function applyRollups(roots: Wbs[], include?: (a: Activity) => boolean): void {
  for (const root of roots) rollUp(root, include);
}

function rollUp(node: Wbs, include?: (a: Activity) => boolean): void {
  const own = include ? node.activities.filter(include) : node.activities;
  let count = own.length;
  let start: number | null = null;
  let finish: number | null = null;
  let startActual = false;
  let allFinished = true;
  let tf: number | null = null;
  let critical = false;

  const take = (s: number | null, sA: boolean, f: number | null, fA: boolean, t: number | null, c: boolean) => {
    if (s !== null && (start === null || s < start)) {
      start = s;
      startActual = sA;
    }
    if (f !== null && (finish === null || f > finish)) finish = f;
    if (!fA) allFinished = false;
    if (t !== null && (tf === null || t < tf)) tf = t;
    if (c) critical = true;
  };

  const labor: LaborUnits = { budget: 0, actual: 0, remaining: 0 };
  const addLabor = (l: LaborUnits) => {
    labor.budget += l.budget;
    labor.actual += l.actual;
    labor.remaining += l.remaining;
  };

  for (const a of own) {
    take(a.start, a.startActual, a.finish, a.finishActual, a.totalFloatHrs, a.critical);
    addLabor(a.labor);
  }
  for (const c of node.children) {
    rollUp(c, include);
    if (c.activityCount === 0) continue;
    count += c.activityCount;
    take(c.start, c.startActual, c.finish, c.finishActual, c.totalFloatHrs, c.critical);
    addLabor(c.labor);
  }
  node.labor = labor;

  node.activityCount = count;
  node.start = start;
  node.finish = finish;
  node.startActual = startActual;
  node.finishActual = count > 0 && allFinished;
  node.totalFloatHrs = tf;
  node.critical = critical;
}
