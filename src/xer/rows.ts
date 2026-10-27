// Turns the WBS tree into the flat list of rows the grid and Gantt draw.
import type { Column, ColumnContext, SortValue } from "./columns";
import type { Predicate } from "./filter";
import type { Activity, Schedule, Wbs } from "./model";

export type GridRow = { kind: "wbs"; wbs: Wbs; level: number } | { kind: "act"; act: Activity; level: number };

export interface SortSpec {
  key: string;
  dir: 1 | -1;
}

export interface ViewState {
  expanded: Set<string>;
  hideEmptyWbs: boolean;
  sort: SortSpec | null;
  ctx: ColumnContext;
  /** Every column available for the open schedule (fixed + UDF), by key. */
  columns: Map<string, Column>;
  /**
   * Activities to show, or null for all. WBS rollups must have been recomputed with
   * the same predicate (`applyRollups`), since empty-WBS hiding uses `activityCount`.
   */
  filter: Predicate | null;
}

function compareValues(a: SortValue, b: SortValue): number {
  // Blanks always sort last, whichever direction.
  if (a === null || a === "") return b === null || b === "" ? 0 : 1;
  if (b === null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Default order when no column is sorted: Start, then Activity ID. */
function defaultCompare(a: Activity, b: Activity): number {
  return compareValues(a.start, b.start) || compareValues(a.code, b.code);
}

/** Sorts one WBS node's own activities. WBS nodes themselves always keep seq_num order. */
export function sortActivities(list: Activity[], state: ViewState): Activity[] {
  const { sort, ctx } = state;
  const col = sort ? state.columns.get(sort.key) : undefined;
  if (!sort || !col) return [...list].sort(defaultCompare);
  const keyed = list.map((a) => ({ a, v: col.sortValue(a, ctx) }));
  keyed.sort((x, y) => {
    const blankX = x.v === null || x.v === "";
    const blankY = y.v === null || y.v === "";
    if (blankX !== blankY) return blankX ? 1 : -1;
    return compareValues(x.v, y.v) * sort.dir || defaultCompare(x.a, y.a);
  });
  return keyed.map((k) => k.a);
}

/** While a filter is on, WBS with no matching activities are always hidden. */
function hidesEmpty(state: ViewState): boolean {
  return state.hideEmptyWbs || state.filter !== null;
}

function visibleChildren(w: Wbs, state: ViewState): Wbs[] {
  return hidesEmpty(state) ? w.children.filter((c) => c.activityCount > 0) : w.children;
}

function visibleRoots(schedule: Schedule, state: ViewState): Wbs[] {
  return hidesEmpty(state) ? schedule.roots.filter((r) => r.activityCount > 0) : schedule.roots;
}

function shownActivities(w: Wbs, state: ViewState): Activity[] {
  return sortActivities(state.filter ? w.activities.filter(state.filter) : w.activities, state);
}

/**
 * Rows in display order. Like P6's WBS grouping, a WBS band is followed by its own
 * activities and then its child WBS bands.
 */
export function buildRows(schedule: Schedule, state: ViewState): GridRow[] {
  const rows: GridRow[] = [];
  const walk = (w: Wbs, level: number) => {
    rows.push({ kind: "wbs", wbs: w, level });
    if (!state.expanded.has(w.id)) return;
    for (const a of shownActivities(w, state)) rows.push({ kind: "act", act: a, level: level + 1 });
    for (const c of visibleChildren(w, state)) walk(c, level + 1);
  };
  for (const r of visibleRoots(schedule, state)) walk(r, 0);
  return rows;
}

/** Every activity in display order, ignoring what is collapsed. Used by search. */
export function activitiesInDisplayOrder(schedule: Schedule, state: ViewState): Activity[] {
  const out: Activity[] = [];
  const walk = (w: Wbs) => {
    out.push(...shownActivities(w, state));
    for (const c of visibleChildren(w, state)) walk(c);
  };
  for (const r of visibleRoots(schedule, state)) walk(r);
  return out;
}

export function allWbs(schedule: Schedule): Wbs[] {
  const out: Wbs[] = [];
  const walk = (w: Wbs) => {
    out.push(w);
    w.children.forEach(walk);
  };
  schedule.roots.forEach(walk);
  return out;
}

/** Level 1 shows the project root's children; 0 collapses everything. */
export function expandedToLevel(schedule: Schedule, level: number): Set<string> {
  return new Set(allWbs(schedule).filter((w) => w.level < level).map((w) => w.id));
}

export function expandedAll(schedule: Schedule): Set<string> {
  return new Set(allWbs(schedule).map((w) => w.id));
}

export function revealActivity(expanded: Set<string>, act: Activity): void {
  for (let w: Wbs | null = act.wbs; w; w = w.parent) expanded.add(w.id);
}
