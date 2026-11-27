// The menu bar, toolbar and right-click menus.
import { FEATURES } from "../features";
import { type DurationUnit } from "../xer/format";
import { expandedAll, expandedToLevel, type GridRow } from "../xer/rows";
import { TIMESCALES } from "./gantt";
import { popupMenu, type MenuItem } from "./menu";
import { filterMenuItems, traceMenuItems } from "./filter-menu";
import { checkForUpdateNow, hideUpdateBar } from "./update";
import { showAbout, showShortcuts, showUserGuide, showWhatsNew } from "./help";
import { type ToolItem } from "./toolbar";
import type { App } from "./app";
import { type BottomTab, BAR_LABELS, type RelLines, isActivity, rowKey } from "./app-shared";
import { ensureReviewer, addComment, showCommentsTab } from "./app-comments";
import { applyFilter, clearFilters, toggleFilters, openFunnel, setTrace } from "./app-filters";
import { saveEmbedded, exportExcel, copySelected, copyRows } from "./app-export";
import { removeBaseline } from "./app-baseline";

export function fileMenu(app: App): MenuItem[] {
  const loaded = () => app.schedule !== null;
  const items: MenuItem[] = [{ label: "Open...", key: "Ctrl+O", action: () => app.fileInput.click() }];
  if (FEATURES.embedSave) {
    items.push({ label: "Save Viewer with Schedule...", key: "Ctrl+S", enabled: loaded, action: () => void saveEmbedded(app) });
  }
  if (FEATURES.baselineCompare) {
    items.push(
      "-",
      { label: "Compare with Baseline...", enabled: loaded, action: () => app.baselineInput.click() },
      { label: "Remove Baseline", enabled: () => app.cmp !== null, action: () => removeBaseline(app) },
    );
  }
  if (FEATURES.excelExport) {
    items.push("-", {
      label: "Export to Excel",
      enabled: loaded,
      items: () => [
        { label: "Rows as Shown (current expand/collapse)", action: () => void exportExcel(app, false) },
        { label: "All Rows (fully expanded)", key: "Ctrl+E", action: () => void exportExcel(app, true) },
      ],
    });
  }
  return items;
}

export function editMenu(app: App): MenuItem[] {
  const loaded = () => app.schedule !== null;
  const items: MenuItem[] = [];
  if (FEATURES.copyRows) {
    items.push(
      { label: "Copy", key: "Ctrl+C", enabled: () => loaded() && app.selectedIndex() >= 0, action: () => copySelected(app) },
      { label: "Copy All Rows as Shown", enabled: loaded, action: () => copyRows(app, app.rows) },
    );
  }
  if (FEATURES.search) {
    if (items.length) items.push("-");
    items.push(
      { label: "Find...", key: "Ctrl+F", enabled: loaded, action: () => app.search.open() },
      { label: "Find Next", key: "F3", enabled: loaded, action: () => app.search.find(1) },
      { label: "Find Previous", key: "Shift+F3", enabled: loaded, action: () => app.search.find(-1) },
    );
  }
  return items.length ? items : [{ label: "(no edit commands)", enabled: () => false }];
}

export function viewMenu(app: App): MenuItem[] {
  const loaded = () => app.schedule !== null;
  const s = () => app.shown();
  const levels: MenuItem[] = [1, 2, 3, 4, 5].map((n) => ({
    label: `Level ${n}`,
    enabled: loaded,
    action: () => app.setExpanded(expandedToLevel(s(), n)),
  }));
  const units: [DurationUnit, string][] = [["h", "Hours"], ["d", "Days"], ["w", "Weeks"], ["m", "Months"]];
  // Grouped like P6: what the grid shows, the WBS tree, filter and sort, panels, Gantt.
  const items: MenuItem[] = [];
  if (FEATURES.columnChooser) items.push({ label: "Columns...", action: () => app.openColumnsDialog() });
  items.push(
    {
      label: "Duration Unit",
      items: () =>
        units.map(([u, label]) => ({
          label,
          checked: () => app.view.ctx.unit === u,
          action: () => {
            app.view.ctx = { ...app.view.ctx, unit: u };
            app.prefs.unit = u;
            // Ticked duration values were the old unit's text; they would match nothing now.
            for (const k of [...app.filterState.values.keys()]) {
              if (app.view.columns.get(k)?.group === "Durations") app.filterState.values.delete(k);
            }
            app.savePrefs();
            // Duration filters are typed in the displayed unit, so they change meaning.
            if (app.compiled.test) applyFilter(app, true);
            app.grid.render();
            app.preds.render();
            app.succs.render();
            app.changesPanel.render();
            app.details.render();
          },
        })),
    },
    {
      label: "Hide Empty WBS",
      checked: () => app.view.hideEmptyWbs,
      action: () => {
        app.view.hideEmptyWbs = !app.view.hideEmptyWbs;
        app.prefs.hideEmptyWbs = app.view.hideEmptyWbs;
        app.savePrefs();
        app.rebuild();
      },
    },
  );
  if (FEATURES.groupBy) {
    items.push({
      label: "Group By",
      enabled: loaded,
      items: () => [
        { label: "WBS", checked: () => !app.grouping, action: () => app.setGroupBy("") },
        ...(app.schedule?.codeTypes.length ? ["-" as const] : []),
        ...(app.schedule?.codeTypes ?? []).map((t) => ({
          label: t.label,
          checked: () => app.grouping?.type === t,
          action: () => app.setGroupBy(t.label),
        })),
      ],
    });
  }
  if (FEATURES.calendars) items.push({ label: "Calendars...", enabled: loaded, action: () => app.openCalendars() });
  items.push(
    "-",
    { label: "Expand All", enabled: loaded, action: () => app.setExpanded(expandedAll(s())) },
    { label: "Collapse All", enabled: loaded, action: () => app.setExpanded(new Set()) },
    { label: "Expand To", enabled: loaded, items: () => levels },
  );
  if (FEATURES.sorting) {
    items.push("-", { label: "Clear Sort", enabled: () => app.view.sort !== null, action: () => app.clearSort() });
  }

  const panels: MenuItem[] = [];
  if (FEATURES.toolbar) {
    panels.push({
      label: "Toolbar",
      checked: () => app.prefs.showToolbar,
      action: () => {
        app.prefs.showToolbar = !app.prefs.showToolbar;
        app.savePrefs();
        app.applyPanelVisibility();
      },
    });
  }
  if (FEATURES.gantt) {
    panels.push({
      label: "Gantt Chart",
      checked: () => app.prefs.showGantt,
      action: () => {
        app.prefs.showGantt = !app.prefs.showGantt;
        app.savePrefs();
        app.applyPanelVisibility();
      },
    });
  }
  if (FEATURES.relationships) {
    // P6's "Show on Bottom": which tab the bottom panel shows, or none.
    const tabs: [BottomTab, string][] = [["details", FEATURES.activityDetails ? "Activity Details" : "Relationships"]];
    if (FEATURES.resourceHistogram) tabs.push(["resources", "Resource Usage"]);
    if (FEATURES.resourceSpreadsheet) tabs.push(["spreadsheet", "Resource Spreadsheet"]);
    if (FEATURES.comments) tabs.push(["comments", "Comments"]);
    if (FEATURES.baselineCompare) tabs.push(["changes", "Changes"]);
    if (FEATURES.scheduleCheck) tabs.push(["check", "Schedule Check"]);
    panels.push({
      label: "Show on Bottom",
      items: () => [
        ...tabs.map(([t, label]): MenuItem => ({
          label,
          checked: () => app.prefs.showRelations && app.prefs.bottomTab === t,
          action: () => app.showBottom(t),
        })),
        "-",
        { label: "None", checked: () => !app.prefs.showRelations, action: () => app.showBottom(null) },
      ],
    });
  }
  if (panels.length) items.push("-", ...panels);

  if (FEATURES.gantt) {
    items.push("-");
    items.push(
      ...ganttOptions(app),
      {
        label: "Zoom",
        enabled: loaded,
        items: () => [
          { label: "Zoom In", key: "Ctrl+Wheel", action: () => app.gantt.zoom(1.5) },
          { label: "Zoom Out", action: () => app.gantt.zoom(1 / 1.5) },
          { label: "Zoom to Fit", action: () => app.gantt.fit() },
          "-",
          {
            label: "Zoom to Selected",
            key: "Double-click",
            enabled: () => app.selectedIndex() >= 0,
            action: () => app.zoomToRow(app.selectedIndex()),
          },
        ],
      },
      {
        label: "Go to Data Date",
        enabled: () => !!app.schedule?.projects[0]?.dataDate,
        action: () => app.gantt.scrollToDate(app.schedule!.projects[0].dataDate!),
      },
    );
  }
  return items;
}

/** Relationship Lines, Bar Labels and Timescale: on the View menu and the right-click menus. */
export function ganttOptions(app: App): MenuItem[] {
  const choice = <T>(label: string, options: [T, string][], get: () => T, set: (v: T) => void): MenuItem => ({
    label,
    items: () =>
      options.map(([v, text]) => ({
        label: text,
        checked: () => get() === v,
        action: () => {
          set(v);
          app.savePrefs();
          app.gantt.draw();
        },
      })),
  });
  const items: MenuItem[] = [];
  if (FEATURES.ganttRelationships) {
    const modes: [RelLines, string][] = [["none", "None"], ["driving", "Driving Only"], ["all", "All"]];
    items.push(choice("Relationship Lines", modes, () => app.prefs.relLines, (m) => {
      app.prefs.relLines = m;
      app.updateRelLines();
    }));
  }
  if (FEATURES.barLabels) items.push(choice("Bar Labels", BAR_LABELS, () => app.prefs.barLabels, (m) => (app.prefs.barLabels = m)));
  items.push(choice("Timescale", TIMESCALES, () => app.prefs.timescale, (t) => {
    app.prefs.timescale = t;
    app.gantt.setTimescale(t);
  }));
  return items;
}

/** The toolbar's buttons: the commands people reach for most, in menu order. */
export function toolItems(app: App): ToolItem[] {
  const loaded = () => app.schedule !== null;
  const s = () => app.shown();
  const items: ToolItem[] = [{ icon: "open", title: "Open (Ctrl+O)", action: () => app.fileInput.click() }];
  if (FEATURES.embedSave) {
    items.push({ icon: "save", title: "Save Viewer with Schedule (Ctrl+S)", enabled: loaded, action: () => void saveEmbedded(app) });
  }
  if (FEATURES.excelExport) {
    items.push({ icon: "excel", title: "Export All Rows to Excel (Ctrl+E)", enabled: loaded, action: () => void exportExcel(app, true) });
  }
  items.push(
    "-",
    { icon: "expand", title: "Expand All", enabled: loaded, action: () => app.setExpanded(expandedAll(s())) },
    { icon: "collapse", title: "Collapse All", enabled: loaded, action: () => app.setExpanded(new Set()) },
  );
  if (FEATURES.search) items.push("-", { icon: "find", title: "Find (Ctrl+F)", enabled: loaded, action: () => app.search.open() });
  if (FEATURES.filters) {
    items.push(
      {
        icon: "filter",
        title: "Filter menu",
        enabled: loaded,
        pressed: () => app.view.filter !== null,
        action: (b) => {
          const r = b.getBoundingClientRect();
          app.menu.openAt("Filter", r.left, r.bottom);
        },
      },
      { icon: "clearFilter", title: "Clear Filters", enabled: () => app.view.filter !== null, action: () => clearFilters(app) },
    );
  }
  if (FEATURES.gantt) {
    items.push(
      "-",
      {
        icon: "gantt",
        title: "Gantt Chart",
        pressed: () => app.prefs.showGantt,
        action: () => {
          app.prefs.showGantt = !app.prefs.showGantt;
          app.savePrefs();
          app.applyPanelVisibility();
        },
      },
      { icon: "zoomIn", title: "Zoom In (Ctrl+Wheel)", enabled: () => loaded() && app.prefs.showGantt, action: () => app.gantt.zoom(1.5) },
      { icon: "zoomOut", title: "Zoom Out", enabled: () => loaded() && app.prefs.showGantt, action: () => app.gantt.zoom(1 / 1.5) },
      { icon: "fit", title: "Zoom to Fit", enabled: () => loaded() && app.prefs.showGantt, action: () => app.gantt.fit() },
      {
        icon: "dataDate",
        title: "Go to Data Date",
        enabled: () => app.prefs.showGantt && !!app.schedule?.projects[0]?.dataDate,
        action: () => app.gantt.scrollToDate(app.schedule!.projects[0].dataDate!),
      },
    );
  }
  if (FEATURES.comments) {
    items.push("-", {
      icon: "comment",
      title: "Add Comment on the Selected Row (Ctrl+M)",
      enabled: () => loaded() && !!app.selected,
      action: () => void addComment(app, app.selected),
    });
  }
  items.push("-", { icon: "help", title: "User Guide (F1)", action: () => showUserGuide() });
  return items;
}

export function filterMenu(app: App): MenuItem[] {
  return filterMenuItems({
    state: () => app.filterState,
    loaded: () => app.schedule !== null,
    dataDate: () => app.schedule?.projects[0]?.dataDate ?? null,
    onChange: () => applyFilter(app),
    onClear: () => clearFilters(app),
    active: () => app.view.filter !== null,
    filterRowShown: () => app.prefs.showFilters,
    toggleFilterRow: () => toggleFilters(app),
    comparison: () => FEATURES.baselineCompare && app.cmp !== null,
    selected: () => (FEATURES.traceLogic && app.selected && isActivity(app.selected) ? app.selected : null),
    setTrace: (t) => setTrace(app, t),
    onReapply: () => applyFilter(app),
  });
}

export function helpMenu(app: App): MenuItem[] {
  return [
    { label: "User Guide", key: "F1", action: () => showUserGuide() },
    { label: "Keyboard Shortcuts", action: () => showShortcuts() },
    { label: "What's New", action: () => showWhatsNew() },
    "-",
    ...(FEATURES.updateCheck
      ? [
          {
            label: "Notify About Updates",
            checked: () => app.prefs.updateCheck,
            action: () => {
              app.prefs.updateCheck = !app.prefs.updateCheck;
              app.savePrefs();
              if (app.prefs.updateCheck) app.checkForUpdate();
              else hideUpdateBar();
            },
          },
          { label: "Check for Updates Now", action: () => void checkForUpdateNow() },
          "-" as const,
        ]
      : []),
    { label: "About XER Viewer", action: () => showAbout() },
  ];
}

/** Right-click on a column header: sort, filter or hide that column. */
export function headerMenu(app: App, key: string | null, x: number, y: number, cell: HTMLElement | null): void {
  const col = key ? app.view.columns.get(key) : undefined;
  const items: MenuItem[] = [];
  if (key && col && app.schedule) {
    const sorted = (dir: 1 | -1) => app.view.sort?.key === key && app.view.sort.dir === dir;
    const sortBy = (dir: 1 | -1) => {
      app.view.sort = { key, dir };
      app.rebuild();
    };
    if (FEATURES.sorting) {
      items.push(
        { label: col.kind === "text" ? "Sort A to Z" : "Sort Smallest to Largest", checked: () => sorted(1), action: () => sortBy(1) },
        { label: col.kind === "text" ? "Sort Z to A" : "Sort Largest to Smallest", checked: () => sorted(-1), action: () => sortBy(-1) },
        { label: "Clear Sort", enabled: () => app.view.sort !== null, action: () => app.clearSort() },
        "-",
      );
    }
    if (FEATURES.filters && cell) {
      items.push(
        { label: "Filter This Column...", action: () => openFunnel(app, key, cell.querySelector<HTMLElement>(".hf") ?? cell) },
        {
          label: "Clear Filter on This Column",
          enabled: () => !!app.filterState.columns.get(key)?.trim() || app.filterState.values.has(key),
          action: () => {
            app.filterState.columns.delete(key);
            app.filterState.values.delete(key);
            app.grid.syncFilterValues();
            applyFilter(app);
          },
        },
        "-",
      );
    }
    const codeType = FEATURES.groupBy ? app.codeTypeOfColumn(key) : undefined;
    if (codeType) {
      const on = app.grouping?.type === codeType;
      items.push(
        on
          ? { label: "Group by WBS", action: () => app.setGroupBy("") }
          : { label: `Group by ${codeType.label}`, action: () => app.setGroupBy(codeType.label) },
        "-",
      );
    }
    const shown = app.columns().map((c) => c.key);
    items.push({
      label: `Hide "${col.label}"`,
      enabled: () => shown.length > 1,
      action: () => app.setColumns(shown.filter((k) => k !== key)),
    });
  }
  if (FEATURES.columnChooser) items.push({ label: "Columns...", action: () => app.openColumnsDialog() });
  if (items.length) popupMenu(items, x, y);
}

export function reviewMenu(app: App): MenuItem[] {
  const loaded = () => app.schedule !== null;
  const sel = app.selected;
  const onSel = sel ? (isActivity(sel) ? sel.code : sel.group ? `${sel.group.label} ${sel.code}` : `WBS ${sel.code}`) : "";
  return [
    { label: sel ? `Add Comment on ${onSel}...` : "Add Comment...", key: "Ctrl+M", enabled: () => loaded() && !!app.selected, action: () => void addComment(app, app.selected) },
    { label: "Add General Comment...", enabled: loaded, action: () => void addComment(app, null) },
    "-",
    { label: "Show Comments", enabled: loaded, action: () => showCommentsTab(app) },
    { label: "Import Reviewers' Files...", enabled: loaded, action: () => app.importInput.click() },
    "-",
    ...(FEATURES.scheduleCheck ? [{ label: "Schedule Check", enabled: loaded, action: () => app.showBottom("check") }, "-" as const] : []),
    { label: `Your Name${app.prefs.reviewer ? `: ${app.prefs.reviewer}` : ""}...`, action: () => void ensureReviewer(app, true) },
  ];
}

/** Right-click in the grid or the Gantt; `i` is -1 on an empty area. */
export function rowMenu(app: App, i: number, x: number, y: number): void {
  const s = app.schedule;
  if (!s) return;
  const items: MenuItem[] = [];
  const row = app.rows[i];
  if (row) items.push(...rowItems(app, row, i), "-");
  items.push(
    { label: "Expand All", action: () => app.setExpanded(expandedAll(app.shown())) },
    { label: "Collapse All", action: () => app.setExpanded(new Set()) },
    "-",
  );
  if (FEATURES.columnChooser) items.push({ label: "Columns...", action: () => app.openColumnsDialog() });
  if (FEATURES.gantt && app.prefs.showGantt) {
    items.push(
      ...ganttOptions(app),
      { label: "Zoom to Fit", action: () => app.gantt.fit() },
      {
        label: "Go to Data Date",
        enabled: () => !!s.projects[0]?.dataDate,
        action: () => app.gantt.scrollToDate(s.projects[0].dataDate!),
      },
    );
  }
  if (app.view.filter) items.push("-", { label: "Clear Filters", action: () => clearFilters(app) });
  popupMenu(items, x, y);
}

/** The right-click items about the row itself. */
export function rowItems(app: App, row: GridRow, i: number): MenuItem[] {
  const item = row.kind === "wbs" ? row.wbs : row.act;
  const items: MenuItem[] = [];
  const sep = () => items.length && items[items.length - 1] !== "-" && items.push("-");
  if (FEATURES.comments) {
    const counts = app.commentIndex.get(rowKey(row));
    if (!(row.kind === "wbs" && row.wbs.group)) items.push({ label: "Add Comment...", key: "Ctrl+M", action: () => void addComment(app, item) });
    if (counts) items.push({ label: `Show Comments (${counts[0] + counts[1]})`, action: () => showCommentsTab(app) });
  }
  if (FEATURES.copyRows) {
    sep();
    items.push({ label: row.kind === "wbs" ? "Copy Band and Rows Under It" : "Copy Row", key: "Ctrl+C", action: () => copySelected(app) });
  }
  if (FEATURES.traceLogic && row.kind === "act") {
    sep();
    items.push({ label: "Trace Logic", items: () => traceMenuItems(row.act, app.filterState.trace, (t) => setTrace(app, t)) });
  }
  if (FEATURES.gantt && app.prefs.showGantt) {
    sep();
    items.push({ label: "Zoom to Bar", key: "Double-click", action: () => app.zoomToRow(i) });
  }
  if (row.kind === "wbs") {
    sep();
    items.push({ label: app.view.expanded.has(row.wbs.id) ? "Collapse" : "Expand", action: () => app.toggle(i) });
  }
  return items;
}
