// Filters: compiling, applying, the status note, the header funnel, checks and traces.
import { type Column } from "../xer/columns";
import { type ChangeKind } from "../xer/compare";
import { describeTrace, traceLogic, type TraceSpec } from "../xer/trace";
import { itemKey } from "../xer/comments";
import { compileFilter, emptyFilter, type FilterState } from "../xer/filter";
import { applyRollups, type Activity } from "../xer/model";
import { compareValues, revealActivity } from "../xer/rows";
import { openColumnFilter } from "./column-filter";
import { checkSchedule, type CheckResult } from "../xer/health";
import type { App } from "./app";

/** Recompiles the filter, re-totals WBS rows from what passes, and redraws. */
export function applyFilter(app: App, keepExtras = false): void {
  clearTimeout(app.filterTimer);
  const s = app.schedule;
  if (!s) return;
  app.compiled = compileFilter(app.filterState, app.view.columns, app.view.ctx, (a) =>
    app.commentIndex.has(itemKey(a)),
  );
  const base = app.compiled.test;
  const byResource = app.resourceTabShown() ? app.resources.activityFilter() : null;
  const test = base && byResource ? (a: Activity) => base(a) && byResource(a) : base ?? byResource;
  app.baseFilter = test;
  if (!keepExtras || !test) {
    app.extras.clear();
    if (app.status.classList.contains("alert")) app.setStatus(""); // the note about a row outside the filter
  }
  setViewFilter(app);
  app.rebuildKeepingSelection();
  app.grid.updateFilterErrors();
  const shown = test ? s.activities.reduce((n, a) => n + (test(a) ? 1 : 0), 0) : s.activities.length;
  app.grid.setEmptyMessage(test && shown === 0 && !app.extras.size ? "No activities match the current filters." : null);
  const notes: string[] = [];
  if (byResource) notes.push(`resource: ${app.resources.selectionLabel()}`);
  if (app.filterState.trace) notes.push(`trace: ${describeTrace(app.filterState.trace)}`);
  if (app.filterState.changes.size) notes.push("changes vs baseline");
  if (app.filterState.check) notes.push(`check: ${app.filterState.check.name}`);
  if (app.prefs.showRelations && app.prefs.bottomTab === "check") app.health.render();
  filterStatus(app, test ? shown : null, notes);
  app.toolbar.refresh();
}

/** The filter plus any activities jumped to outside it; re-totals the WBS bands from what shows. */
export function setViewFilter(app: App): void {
  const test = app.baseFilter;
  const extras = app.extras;
  app.view.filter = test && extras.size ? (a) => test(a) || extras.has(a) : test;
  if (app.schedule) applyRollups(app.shown().roots, app.view.filter ?? undefined);
}

/**
 * While anything is filtered the status bar says so and how many activities show, so
 * nothing is ever filtered out of sight. `shown` is null when unfiltered; `resource`
 * names the Resource Usage selection when that is filtering too.
 */
export function filterStatus(app: App, shown: number | null, notes: string[] = []): void {
  const total = app.schedule?.activities.length ?? 0;
  app.statusFilter.classList.toggle("hidden", shown === null);
  app.statusFilter.textContent =
    shown === null
      ? ""
      : `Filter on${notes.length ? ` (${notes.join("; ")})` : ""}: showing ${shown.toLocaleString()} of ${total.toLocaleString()} activities`;
  app.statusFilter.title = "Filter > Clear Filters to remove";
}

export function clearFilters(app: App): void {
  app.resources.selectAll();
  app.filterState = emptyFilter();
  app.grid.syncFilterValues();
  applyFilter(app);
}

/** Filter > Filter Row (Ctrl+Shift+F): the text boxes under the column headers. */
export function toggleFilters(app: App): void {
  app.prefs.showFilters = !app.prefs.showFilters;
  app.savePrefs();
  // Typed filters stay on while the row is hidden: their funnels stay highlighted and
  // the status bar keeps the count.
  app.applyPanelVisibility();
  app.grid.render();
}

/** The header funnel: values come from the activities the other filters leave in. */
export function openFunnel(app: App, key: string, anchor: HTMLElement): void {
  const col = app.view.columns.get(key);
  const s = app.schedule;
  if (!col || !s) return;
  const ctx = app.view.ctx;
  const others: FilterState = { ...app.filterState, columns: new Map(app.filterState.columns), values: new Map(app.filterState.values) };
  others.columns.delete(key);
  others.values.delete(key);
  const test = compileFilter(others, app.view.columns, ctx, (a) => app.commentIndex.has(itemKey(a))).test;
  const byResource = app.resourceTabShown() ? app.resources.activityFilter() : null;
  const found = new Map<string, { count: number; sort: ReturnType<Column["sortValue"]> }>();
  for (const a of s.activities) {
    if ((test && !test(a)) || (byResource && !byResource(a))) continue;
    const text = col.text(a, ctx);
    const v = found.get(text);
    if (v) v.count++;
    else found.set(text, { count: 1, sort: col.sortValue(a, ctx) });
  }
  const values = [...found]
    .sort(([ta, a], [tb, b]) => compareValues(a.sort, b.sort) || ta.localeCompare(tb, undefined, { numeric: true }))
    .map(([text, v]) => ({ text, count: v.count }));
  const refresh = () => {
    app.grid.syncFilterValues();
    applyFilter(app);
  };
  openColumnFilter(anchor, {
    column: col,
    values,
    condition: app.filterState.columns.get(key) ?? "",
    ticked: app.filterState.values.get(key) ?? null,
    onApply: (condition, ticked) => {
      if (condition.trim()) app.filterState.columns.set(key, condition);
      else app.filterState.columns.delete(key);
      if (ticked) app.filterState.values.set(key, ticked);
      else app.filterState.values.delete(key);
      refresh();
    },
    onClear: () => {
      app.filterState.columns.delete(key);
      app.filterState.values.delete(key);
      refresh();
    },
    onSort: (dir) => {
      app.view.sort = { key, dir };
      app.rebuild();
    },
  });
}

export function healthResults(app: App): CheckResult[] | null {
  const s = app.schedule;
  if (!s) return null;
  const cmp = app.cmp;
  if (!app.healthCache || app.healthCache.s !== s || app.healthCache.cmp !== cmp) {
    app.healthCache = { s, cmp, results: checkSchedule(s, cmp) };
  }
  return app.healthCache.results;
}

/** Shows only the activities a check flagged, opening the WBS they are in. */
export function pickCheck(app: App, r: CheckResult): void {
  app.filterState.check = { name: r.name, ids: r.activities };
  for (const a of r.activities) revealActivity(app.view.expanded, a, app.grouping?.bandOf);
  applyFilter(app);
  const n = r.activities.size;
  app.setStatus(`${r.name}: showing the ${n.toLocaleString()} activit${n === 1 ? "y" : "ies"} it flags. Show All Activities (or Clear Filters) to go back.`);
}

/** The Changes tab's "Filter Activities": only this kind of change. */
export function filterChanges(app: App, kind: ChangeKind | "any"): void {
  app.filterState.changes = new Set([kind]);
  applyFilter(app);
}

/** Filter > Trace Logic: shows only the traced chain, expanding the WBS it runs through. */
export function setTrace(app: App, t: TraceSpec | null): void {
  app.filterState.trace = t;
  if (t) for (const a of traceLogic(t)) revealActivity(app.view.expanded, a, app.grouping?.bandOf);
  applyFilter(app);
  if (!t) return;
  const i = app.rowIndex.get(t.root);
  if (i !== undefined) {
    app.grid.scrollToIndex(i, true);
    app.select(i);
  }
  const n = traceLogic(t).size - 1;
  app.setStatus(`Tracing ${describeTrace(t)}: ${n.toLocaleString()} activit${n === 1 ? "y" : "ies"}. Filter > Trace Logic > Clear Trace to go back.`);
}
