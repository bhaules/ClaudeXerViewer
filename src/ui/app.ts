// Wires the model, grid, Gantt, panels, menus and keyboard together.
import { buildEmbeddedHtml, downloadText } from "../embed";
import { FEATURES } from "../features";
import { loadSchedule } from "../xer";
import { COLUMN_BY_KEY, COLUMNS, scheduleColumns, type Column } from "../xer/columns";
import { formatDate, type DurationUnit } from "../xer/format";
import { compileFilter, emptyFilter, filterActive, type CompiledFilter, type FilterState } from "../xer/filter";
import { applyRollups, type Activity, type Relationship, type Schedule, type Wbs } from "../xer/model";
import { XerParseError } from "../xer/parse";
import {
  activitiesInDisplayOrder,
  buildRows,
  expandedAll,
  expandedToLevel,
  revealActivity,
  type GridRow,
  type ViewState,
} from "../xer/rows";
import { el, esc, modal, splitter } from "./dom";
import { openColumnsDialog } from "./columns-dialog";
import { Gantt } from "./gantt";
import { Grid } from "./grid";
import { MenuBar, type MenuItem } from "./menu";
import { RelationsPanel } from "./relations";
import { DEFAULT_HISTOGRAM, ResourcePanel, type HistogramSettings } from "./resources";
import { FilterBar } from "./filterbar";
import { Search } from "./search";

const PREFS_KEY = "xer-viewer-prefs-v1";

interface Prefs {
  columns: string[];
  widths: Record<string, number>;
  unit: DurationUnit;
  hideEmptyWbs: boolean;
  showGantt: boolean;
  showRelations: boolean;
  relLines: RelLines;
  showFilters: boolean;
  bottomTab: BottomTab;
  histogram: HistogramSettings;
}

type BottomTab = "relationships" | "resources";

type RelLines = "none" | "driving" | "all";

const DEFAULT_PREFS: Prefs = {
  columns: COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
  widths: {},
  unit: "d",
  hideEmptyWbs: true,
  showGantt: FEATURES.gantt,
  showRelations: FEATURES.relationships,
  relLines: FEATURES.ganttRelationships ? "driving" : "none",
  showFilters: FEATURES.filters,
  bottomTab: "relationships",
  histogram: DEFAULT_HISTOGRAM,
};

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    const prefs = { ...DEFAULT_PREFS, ...saved };
    prefs.histogram = { ...DEFAULT_HISTOGRAM, ...saved.histogram };
    prefs.columns = prefs.columns.filter((k) => COLUMN_BY_KEY.has(k) || k.startsWith("udf:"));
    if (prefs.columns.length === 0) prefs.columns = DEFAULT_PREFS.columns;
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function isActivity(x: Activity | Wbs): x is Activity {
  return "wbs" in x;
}

export class App {
  private schedule: Schedule | null = null;
  private fileName = "";
  private fileBytes: Uint8Array | null = null;
  private prefs = loadPrefs();
  private view: ViewState = {
    expanded: new Set(),
    hideEmptyWbs: this.prefs.hideEmptyWbs,
    sort: null,
    ctx: { unit: this.prefs.unit },
    columns: new Map(COLUMNS.map((c) => [c.key, c])),
    filter: null,
  };
  private rows: GridRow[] = [];
  private rowIndex = new Map<Activity | Wbs, number>();
  private selected: Activity | Wbs | null = null;
  /** Relationships the Gantt draws, per View > Relationship Lines. */
  private relLines: Relationship[] = [];

  private grid: Grid;
  private gantt: Gantt;
  private preds: RelationsPanel;
  private succs: RelationsPanel;
  private search: Search;
  private menu: MenuBar;
  private workspace: HTMLElement;
  private welcome: HTMLElement;
  private status = el("div", "left");
  private statusRight = el("div", "right");
  private bottom: HTMLElement;
  private bottomSplit: HTMLElement;
  private resources: ResourcePanel;
  private resSplit: HTMLElement;
  private sideSplit: HTMLElement;
  private fileInput: HTMLInputElement;
  private appRoot: HTMLElement;
  private filterBar: FilterBar;
  private filterState: FilterState = emptyFilter();
  private compiled: CompiledFilter = { test: null, errors: new Set() };
  private filterTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(mount: HTMLElement) {
    this.grid = new Grid({
      rows: () => this.rows,
      columns: () => this.columns(),
      width: (k) => this.prefs.widths[k] ?? this.view.columns.get(k)?.width ?? 100,
      setWidth: (k, w) => {
        this.prefs.widths[k] = w;
        this.savePrefs();
      },
      sort: () => this.view.sort,
      sortable: FEATURES.sorting,
      ctx: () => this.view.ctx,
      expanded: (id) => this.view.expanded.has(id),
      selectedIndex: () => this.selectedIndex(),
      isHit: (r) => r.kind === "act" && this.search.isHit(r.act),
      onSort: (k) => this.toggleSort(k),
      onHeaderMenu: () => this.openColumnsDialog(),
      filterRow: () => FEATURES.filters && this.prefs.showFilters,
      filterValue: (k) => this.filterState.columns.get(k) ?? "",
      filterError: (k) => this.compiled.errors.has(k),
      onFilterInput: (k, v) => {
        this.filterState.columns.set(k, v);
        // Typing re-filters 13k+ activities; wait for a pause.
        clearTimeout(this.filterTimer);
        this.filterTimer = setTimeout(() => this.applyFilter(), 200);
      },
      onToggle: (i) => this.toggle(i),
      onSelect: (i) => this.select(i),
      onActivate: (i) => this.activate(i),
      // The scrollTop setters ignore equal values, so the echo scroll event stops the loop.
      onScroll: (top) => (this.gantt.scrollTop = top),
    });

    this.gantt = new Gantt({
      rows: () => this.rows,
      relationships: () => this.relLines,
      rowOf: (a) => this.rowIndex.get(a),
      selectedIndex: () => this.selectedIndex(),
      dataDate: () => this.schedule?.projects[0]?.dataDate ?? null,
      onSelect: (i) => this.select(i),
      onActivate: (i) => this.activate(i),
      onScroll: (top) => (this.grid.scrollTop = top),
      onDraw: () => {
        if (this.resourceTabShown()) this.resources.draw();
      },
    });

    const unit = () => this.view.ctx.unit;
    const nav = (a: Activity) => this.goTo(a);
    this.preds = new RelationsPanel("Predecessors", unit, FEATURES.relationshipNavigation, nav);
    this.succs = new RelationsPanel("Successors", unit, FEATURES.relationshipNavigation, nav);

    this.search = new Search({
      activities: () => (this.schedule ? activitiesInDisplayOrder(this.schedule, this.view) : []),
      current: () => (this.selected && isActivity(this.selected) ? this.selected : null),
      goTo: (a) => this.goTo(a),
      onHitsChanged: () => this.grid.render(),
    });

    this.menu = new MenuBar([
      { label: "File", items: () => this.fileMenu() },
      { label: "Edit", items: () => this.editMenu() },
      { label: "View", items: () => this.viewMenu() },
      { label: "Help", items: () => this.helpMenu() },
    ]);

    // Layout
    const top = el("div", "top");
    // The grid/Gantt divider. The resource tab has a second handle that moves the same
    // divider, so the histogram stays lined up under the Gantt.
    const startSide = () => (this.dragStart = this.grid.root.getBoundingClientRect().width);
    const dragSide = (d: number) => {
      this.grid.root.style.width = `${Math.max(200, Math.min(top.clientWidth - 120, this.dragStart + d))}px`;
      this.syncResourceListWidth();
    };
    this.sideSplit = splitter("v", startSide, dragSide);
    top.append(this.grid.root, this.sideSplit, this.gantt.root);

    const relRow = el("div", "brow");
    const relSplit = splitter("v", () => (this.dragStart = this.preds.root.getBoundingClientRect().width), (d) => {
      this.preds.root.style.flex = "none";
      this.preds.root.style.width = `${Math.max(150, Math.min(relRow.clientWidth - 150, this.dragStart + d))}px`;
    });
    relRow.append(this.preds.root, relSplit, this.succs.root);

    this.resources = new ResourcePanel(
      {
        schedule: () => this.schedule,
        ganttView: () => (FEATURES.gantt && this.prefs.showGantt ? this.gantt.timeline() : null),
        dataDate: () => this.schedule?.projects[0]?.dataDate ?? null,
        onSelectionChange: () => this.applyFilter(),
        onSettingsChange: (s) => {
          this.prefs.histogram = s;
          this.savePrefs();
        },
        onFit: () => this.gantt.fit(),
      },
      this.prefs.histogram,
    );
    this.resSplit = splitter("v", startSide, dragSide);
    const resRow = el("div", "brow", [this.resources.listPane, this.resSplit, this.resources.chartPane]);
    // Keep the resource list exactly as wide as the grid above it.
    new ResizeObserver(() => this.syncResourceListWidth()).observe(this.grid.root);

    const tabs: [BottomTab, string, HTMLElement][] = [
      ["relationships", "Relationships", relRow],
      ["resources", "Resource Usage", resRow],
    ];
    const tabStrip = el("div", "btabs");
    for (const [id, label, body] of tabs) {
      if (id === "resources" && !FEATURES.resourceHistogram) continue;
      const tab = el("div", "btab", [label]);
      tab.dataset.tab = id;
      tab.addEventListener("mousedown", () => this.setBottomTab(id));
      tabStrip.append(tab);
      body.dataset.tab = id;
    }

    this.bottom = el("div", "bottom", [tabStrip, relRow, resRow]);
    this.bottomSplit = splitter("h", () => (this.dragStart = this.bottom.getBoundingClientRect().height), (d) => {
      this.bottom.style.height = `${Math.max(60, Math.min(this.workspace.clientHeight - 120, this.dragStart - d))}px`;
    });

    this.workspace = el("div", "workspace hidden", [top, this.bottomSplit, this.bottom]);
    this.welcome = this.buildWelcome();
    this.fileInput = el("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".xer";
    this.fileInput.className = "hidden";
    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.openFile(f);
      this.fileInput.value = "";
    });

    this.appRoot = mount;
    this.filterBar = new FilterBar({
      state: () => this.filterState,
      dataDate: () => this.schedule?.projects[0]?.dataDate ?? null,
      onChange: () => this.applyFilter(),
      onClear: () => this.clearFilters(),
    });
    mount.append(
      this.menu.root,
      this.filterBar.root,
      this.workspace,
      this.welcome,
      el("div", "statusbar", [this.status, this.statusRight]),
      this.fileInput,
    );
    this.applyPanelVisibility();
    this.installKeys();
    this.installDrop();
    this.setStatus("Ready");
  }

  private dragStart = 0;

  // ---------- Loading ----------

  async openFile(file: File): Promise<void> {
    await this.load(file.name, new Uint8Array(await file.arrayBuffer()));
  }

  async load(name: string, bytes: Uint8Array): Promise<void> {
    const overlay = el("div", "overlay", [el("div", "box", [`Opening ${name}…`])]);
    document.body.append(overlay);
    await new Promise((r) => setTimeout(r, 30)); // let the overlay paint before the parse blocks
    try {
      const t0 = performance.now();
      const schedule = loadSchedule(bytes);
      if (schedule.activities.length === 0 && schedule.roots.length === 0) {
        throw new XerParseError("The file has no WBS or activities in it.");
      }
      this.schedule = schedule;
      this.fileName = name;
      this.fileBytes = bytes;
      this.selected = null;
      this.view.sort = null;
      this.filterState = emptyFilter();
      this.compiled = { test: null, errors: new Set() };
      this.view.filter = null;
      this.filterBar.sync();
      this.filterBar.setCount(0, 0, false);
      this.resources.reset();
      this.view.expanded = expandedToLevel(schedule, FEATURES.defaultExpandLevel);
      this.view.columns = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
      this.updateRelLines();
      this.welcome.classList.add("hidden");
      this.workspace.classList.remove("hidden");
      this.applyPanelVisibility();
      this.grid.syncFilterValues();
      this.rebuild();
      let first: number | null = null;
      let last: number | null = null;
      for (const r of schedule.roots) {
        if (r.start !== null && (first === null || r.start < first)) first = r.start;
        if (r.finish !== null && (last === null || r.finish > last)) last = r.finish;
      }
      this.gantt.setRange(first, last);
      this.grid.scrollTop = 0;
      this.gantt.scrollTop = 0;
      this.showRelations(null);
      this.updateTitle();
      this.setStatus(`Opened ${name} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      const msg = e instanceof XerParseError ? e.message : `Could not read this file: ${(e as Error).message}`;
      modal("Can't open file", `<p><b>${esc(name)}</b></p><p>${esc(msg)}</p>`);
    } finally {
      overlay.remove();
    }
  }

  private updateTitle(): void {
    const s = this.schedule;
    if (!s) return;
    const p = s.projects[0];
    const projectText =
      s.projects.length > 1 ? `${s.projects.length} projects` : p ? `${p.shortName} – ${p.name}` : this.fileName;
    const dd = p?.dataDate ? `Data Date ${formatDate(p.dataDate)}` : "";
    this.menu.title.textContent = [projectText, dd].filter(Boolean).join("   |   ");
    document.title = `${p?.shortName ?? this.fileName} - XER Viewer`;
    this.statusRight.textContent = `${s.activities.length.toLocaleString()} activities   ${s.relationships.length.toLocaleString()} relationships   ${this.fileName}`;
  }

  // ---------- Rows & selection ----------

  /** Visible columns in order. Saved UDF columns the open file doesn't have are skipped. */
  private columns(): Column[] {
    const cols = this.prefs.columns.map((k) => this.view.columns.get(k)).filter((c): c is Column => !!c);
    return cols.length ? cols : DEFAULT_PREFS.columns.map((k) => COLUMN_BY_KEY.get(k)!);
  }

  private rebuild(): void {
    if (!this.schedule) return;
    this.rows = buildRows(this.schedule, this.view);
    this.rowIndex.clear();
    this.rows.forEach((r, i) => this.rowIndex.set(r.kind === "wbs" ? r.wbs : r.act, i));
    this.grid.render();
    this.gantt.update();
  }

  private selectedIndex(): number {
    return this.selected ? this.rowIndex.get(this.selected) ?? -1 : -1;
  }

  private select(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    this.selected = row.kind === "wbs" ? row.wbs : row.act;
    this.grid.updateSelection();
    this.grid.scrollToIndex(i);
    // Don't wait for the grid's scroll event to bring the Gantt along.
    this.gantt.scrollTop = this.grid.scrollTop;
    this.grid.focus();
    this.gantt.draw();
    if (row.kind === "act") {
      this.showRelations(row.act);
      this.setStatus(`${row.act.code} – ${row.act.name}`);
    } else {
      this.showRelations(null);
      this.setStatus(`WBS ${row.wbs.fullCode} – ${row.wbs.name} (${row.wbs.activityCount.toLocaleString()} activities)`);
    }
  }

  private showRelations(a: Activity | null): void {
    if (!this.prefs.showRelations) return;
    this.preds.show(a);
    this.succs.show(a);
  }

  private toggle(i: number): void {
    const row = this.rows[i];
    if (row?.kind !== "wbs") return;
    if (this.view.expanded.has(row.wbs.id)) this.view.expanded.delete(row.wbs.id);
    else this.view.expanded.add(row.wbs.id);
    this.selected = row.wbs;
    this.rebuild();
    this.grid.focus();
  }

  private activate(i: number): void {
    if (this.rows[i]?.kind === "wbs") this.toggle(i);
  }

  /** Expands the activity's WBS, selects it and scrolls it into the middle of the view. */
  private goTo(a: Activity): void {
    if (this.view.filter && !this.view.filter(a)) {
      this.setStatus(`${a.code} is hidden by the current filter. Clear Filters to see it.`);
      return;
    }
    revealActivity(this.view.expanded, a);
    this.rebuild();
    const i = this.rowIndex.get(a);
    if (i === undefined) return;
    this.grid.scrollToIndex(i, true);
    this.select(i);
    this.gantt.reveal(a);
  }

  private toggleSort(key: string): void {
    const s = this.view.sort;
    // Ascending -> descending -> back to the default order.
    this.view.sort = s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null;
    this.rebuild();
  }


  private updateRelLines(): void {
    const all = this.schedule?.relationships ?? [];
    const mode = FEATURES.ganttRelationships ? this.prefs.relLines : "none";
    this.relLines = mode === "all" ? all : mode === "driving" ? all.filter((r) => r.driving) : [];
  }

  private setExpanded(set: Set<string>): void {
    this.view.expanded = set;
    this.rebuild();
  }

  // ---------- Menus ----------

  private fileMenu(): MenuItem[] {
    const loaded = () => this.schedule !== null;
    const items: MenuItem[] = [{ label: "Open...", key: "Ctrl+O", action: () => this.fileInput.click() }];
    if (FEATURES.embedSave) {
      items.push({ label: "Save Viewer with Schedule...", key: "Ctrl+S", enabled: loaded, action: () => void this.saveEmbedded() });
    }
    return items;
  }

  private editMenu(): MenuItem[] {
    if (!FEATURES.search) return [{ label: "(no edit commands)", enabled: () => false }];
    const loaded = () => this.schedule !== null;
    return [
      { label: "Find...", key: "Ctrl+F", enabled: loaded, action: () => this.search.open() },
      { label: "Find Next", key: "F3", enabled: loaded, action: () => this.search.find(1) },
      { label: "Find Previous", key: "Shift+F3", enabled: loaded, action: () => this.search.find(-1) },
    ];
  }

  private viewMenu(): MenuItem[] {
    const loaded = () => this.schedule !== null;
    const s = () => this.schedule!;
    const levels: MenuItem[] = [1, 2, 3, 4, 5].map((n) => ({
      label: `Level ${n}`,
      enabled: loaded,
      action: () => this.setExpanded(expandedToLevel(s(), n)),
    }));
    const units: [DurationUnit, string][] = [["h", "Hours"], ["d", "Days"], ["w", "Weeks"], ["m", "Months"]];
    const items: MenuItem[] = [
      { label: "Expand All", enabled: loaded, action: () => this.setExpanded(expandedAll(s())) },
      { label: "Collapse All", enabled: loaded, action: () => this.setExpanded(new Set()) },
      { label: "Expand To", enabled: loaded, items: () => levels },
      "-",
      {
        label: "Duration Unit",
        items: () =>
          units.map(([u, label]) => ({
            label,
            checked: () => this.view.ctx.unit === u,
            action: () => {
              this.view.ctx = { unit: u };
              this.prefs.unit = u;
              this.savePrefs();
              // Duration filters are typed in the displayed unit, so they change meaning.
              if (this.compiled.test) this.applyFilter();
              this.grid.render();
              this.preds.render();
              this.succs.render();
            },
          })),
      },
    ];
    if (FEATURES.columnChooser) {
      items.push({ label: "Columns...", action: () => this.openColumnsDialog() });
    }
    if (FEATURES.sorting) {
      items.push({
        label: "Clear Sort",
        enabled: () => this.view.sort !== null,
        action: () => {
          this.view.sort = null;
          this.rebuild();
        },
      });
    }
    if (FEATURES.filters) {
      items.push(
        "-",
        { label: "Filters", key: "Ctrl+Shift+F", checked: () => this.prefs.showFilters, enabled: loaded, action: () => this.toggleFilters() },
        { label: "Clear Filters", enabled: () => this.compiled.test !== null, action: () => this.clearFilters() },
      );
    }
    items.push(
      "-",
      {
        label: "Hide Empty WBS",
        checked: () => this.view.hideEmptyWbs,
        action: () => {
          this.view.hideEmptyWbs = !this.view.hideEmptyWbs;
          this.prefs.hideEmptyWbs = this.view.hideEmptyWbs;
          this.savePrefs();
          this.rebuild();
        },
      },
    );
    if (FEATURES.gantt) {
      items.push({
        label: "Gantt Chart",
        checked: () => this.prefs.showGantt,
        action: () => {
          this.prefs.showGantt = !this.prefs.showGantt;
          this.savePrefs();
          this.applyPanelVisibility();
        },
      });
    }
    if (FEATURES.relationships) {
      items.push({
        label: "Bottom Panel",
        checked: () => this.prefs.showRelations,
        action: () => {
          this.prefs.showRelations = !this.prefs.showRelations;
          this.savePrefs();
          this.applyPanelVisibility();
          const sel = this.selected;
          this.showRelations(sel && isActivity(sel) ? sel : null);
          // The resource filter only applies while its tab is on screen.
          this.applyFilter();
        },
      });
      if (FEATURES.resourceHistogram) {
        items.push({
          label: "Resource Usage",
          checked: () => this.prefs.showRelations && this.prefs.bottomTab === "resources",
          action: () => {
            if (!this.prefs.showRelations) {
              this.prefs.showRelations = true;
              this.applyPanelVisibility();
            }
            this.setBottomTab(this.prefs.bottomTab === "resources" && this.prefs.showRelations ? "relationships" : "resources");
          },
        });
      }
    }
    if (FEATURES.gantt && FEATURES.ganttRelationships) {
      const modes: [RelLines, string][] = [["none", "None"], ["driving", "Driving Only"], ["all", "All"]];
      items.push({
        label: "Relationship Lines",
        items: () =>
          modes.map(([m, label]) => ({
            label,
            checked: () => this.prefs.relLines === m,
            action: () => {
              this.prefs.relLines = m;
              this.savePrefs();
              this.updateRelLines();
              this.gantt.draw();
            },
          })),
      });
    }
    if (FEATURES.gantt) {
      items.push(
        "-",
        { label: "Zoom In", key: "Ctrl+Wheel", enabled: loaded, action: () => this.gantt.zoom(1.5) },
        { label: "Zoom Out", enabled: loaded, action: () => this.gantt.zoom(1 / 1.5) },
        { label: "Zoom to Fit", enabled: loaded, action: () => this.gantt.fit() },
        {
          label: "Go to Data Date",
          enabled: () => !!this.schedule?.projects[0]?.dataDate,
          action: () => this.gantt.scrollToDate(this.schedule!.projects[0].dataDate!),
        },
      );
    }
    return items;
  }

  private helpMenu(): MenuItem[] {
    return [
      { label: "Keyboard Shortcuts", action: () => this.showShortcuts() },
      { label: "About XER Viewer", action: () => this.showAbout() },
    ];
  }

  private openColumnsDialog(): void {
    if (!FEATURES.columnChooser) return;
    openColumnsDialog({
      available: [...this.view.columns.values()],
      selected: this.columns().map((c) => c.key),
      defaults: DEFAULT_PREFS.columns,
      onApply: (keys) => {
        // Keep saved UDF columns this file doesn't have, so they come back for files that do.
        const missing = this.prefs.columns.filter((k) => !this.view.columns.has(k));
        this.prefs.columns = [...keys, ...missing];
        this.savePrefs();
        // A sort or filter on a removed column would be invisible; drop it.
        if (this.view.sort && !keys.includes(this.view.sort.key)) this.view.sort = null;
        for (const k of [...this.filterState.columns.keys()]) if (!keys.includes(k)) this.filterState.columns.delete(k);
        this.applyFilter();
      },
    });
  }

  // ---------- Filters ----------

  /** Recompiles the filter, re-totals WBS rows from what passes, and redraws. */
  private applyFilter(): void {
    clearTimeout(this.filterTimer);
    const s = this.schedule;
    if (!s) return;
    this.compiled = compileFilter(this.filterState, this.view.columns, this.view.ctx);
    const base = this.compiled.test;
    const byResource = this.resourceTabShown() ? this.resources.activityFilter() : null;
    const test = base && byResource ? (a: Activity) => base(a) && byResource(a) : base ?? byResource;
    this.view.filter = test;
    applyRollups(s.roots, test ?? undefined);
    this.rebuild();
    this.grid.updateFilterErrors();
    const shown = test ? s.activities.reduce((n, a) => n + (test(a) ? 1 : 0), 0) : s.activities.length;
    const note = byResource ? `Resource: ${this.resources.selectionLabel()}` : "";
    this.filterBar.setCount(shown, s.activities.length, test !== null, note);
    this.grid.setEmptyMessage(test && shown === 0 ? "No activities match the current filters." : null);
  }

  private resourceTabShown(): boolean {
    return FEATURES.resourceHistogram && FEATURES.relationships && this.prefs.showRelations && this.prefs.bottomTab === "resources";
  }

  private setBottomTab(tab: BottomTab): void {
    this.prefs.bottomTab = tab;
    this.savePrefs();
    this.applyBottomTab();
    // The resource filter only applies while its tab is on screen.
    this.applyFilter();
  }

  private applyBottomTab(): void {
    const tab = FEATURES.resourceHistogram ? this.prefs.bottomTab : "relationships";
    for (const n of this.bottom.querySelectorAll<HTMLElement>("[data-tab]")) {
      if (n.classList.contains("btab")) n.classList.toggle("active", n.dataset.tab === tab);
      else n.classList.toggle("hidden", n.dataset.tab !== tab);
    }
    if (tab === "resources") {
      this.syncResourceListWidth();
      this.resources.draw();
    }
  }

  /** The resource list matches the grid's width so the histogram lines up under the Gantt. */
  private syncResourceListWidth(): void {
    this.resources.listPane.style.width = `${this.grid.root.getBoundingClientRect().width}px`;
  }

  private clearFilters(): void {
    this.resources.selectAll();
    this.filterState = emptyFilter();
    this.filterBar.sync();
    this.grid.syncFilterValues();
    this.applyFilter();
  }

  private toggleFilters(): void {
    this.prefs.showFilters = !this.prefs.showFilters;
    this.savePrefs();
    // Hidden filters would silently hide activities, so hiding the section clears them.
    if (!this.prefs.showFilters && filterActive(this.filterState)) this.clearFilters();
    this.applyPanelVisibility();
    this.grid.render();
  }

  private applyPanelVisibility(): void {
    const f = FEATURES.filters && this.prefs.showFilters && this.schedule !== null;
    this.filterBar.root.classList.toggle("hidden", !f);
    this.appRoot.classList.toggle("filters-on", f);
    const g = FEATURES.gantt && this.prefs.showGantt;
    const r = FEATURES.relationships && this.prefs.showRelations;
    this.gantt.root.classList.toggle("hidden", !g);
    this.sideSplit.classList.toggle("hidden", !g);
    this.grid.root.style.flex = g ? "" : "1";
    this.bottom.classList.toggle("hidden", !r);
    this.bottomSplit.classList.toggle("hidden", !r);
    this.resSplit.classList.toggle("hidden", !g);
    if (r) this.applyBottomTab();
    if (g) this.gantt.update();
  }

  private async saveEmbedded(): Promise<void> {
    if (!this.fileBytes) return;
    if (import.meta.env.DEV) {
      modal("Not available in dev mode", "<p>Run <code>npm run build</code> and use <code>dist/xer-viewer.html</code> to save a viewer with the schedule inside.</p>");
      return;
    }
    const html = await buildEmbeddedHtml({ name: this.fileName, bytes: this.fileBytes });
    const base = this.fileName.replace(/\.xer$/i, "");
    downloadText(`${base}.html`, html, "text/html");
    this.setStatus(`Saved ${base}.html (${(html.length / 1_048_576).toFixed(1)} MB). Send that one file: it opens straight to this schedule.`);
  }

  private showShortcuts(): void {
    const rows = [
      ["Ctrl+O", "Open a .xer file"],
      ["Ctrl+S", "Save viewer with schedule"],
      ["Ctrl+F", "Find activity by ID or name"],
      ["F3 / Shift+F3", "Find next / previous"],
      ["↑ ↓ PgUp PgDn Home End", "Move selection"],
      ["→ / ←", "Expand / collapse WBS (← on an activity jumps to its WBS)"],
      ["Enter or double-click", "Expand / collapse WBS"],
      ["Double-click a relationship", "Go to that activity"],
      ["Ctrl+Mouse wheel on Gantt", "Zoom timescale"],
    ];
    modal("Keyboard Shortcuts", `<table>${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join("")}</table>`);
  }

  private showAbout(): void {
    modal(
      "About XER Viewer",
      `<p><b>XER Viewer</b>: a read-only viewer for Primavera P6 .xer files.</p>
       <p>Your file is read inside this browser window. Nothing is uploaded or sent anywhere.</p>`,
    );
  }

  // ---------- Keyboard, drag & drop, status ----------

  private installKeys(): void {
    window.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "o") {
        e.preventDefault();
        this.fileInput.click();
      } else if (ctrl && k === "s" && FEATURES.embedSave && this.schedule) {
        e.preventDefault();
        void this.saveEmbedded();
      } else if (ctrl && e.shiftKey && k === "f" && FEATURES.filters && this.schedule) {
        e.preventDefault();
        this.toggleFilters();
      } else if (ctrl && k === "f" && FEATURES.search && this.schedule) {
        e.preventDefault();
        this.search.open();
      } else if (e.key === "F3" && FEATURES.search && this.schedule) {
        e.preventDefault();
        this.search.find(e.shiftKey ? -1 : 1);
      }
    });
  }

  private installDrop(): void {
    let overlay: HTMLElement | null = null;
    let depth = 0;
    const hide = () => {
      depth = 0;
      overlay?.remove();
      overlay = null;
    };
    window.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      if (!overlay) {
        overlay = el("div", "overlay drop", [el("div", "box", ["Drop the .xer file to open it"])]);
        document.body.append(overlay);
      }
    });
    window.addEventListener("dragleave", () => {
      if (--depth <= 0) hide();
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      hide();
      const f = e.dataTransfer?.files[0];
      if (f) void this.openFile(f);
    });
  }

  private buildWelcome(): HTMLElement {
    const open = el("button", "btn primary", ["Open .xer file..."]);
    open.addEventListener("click", () => this.fileInput.click());
    return el("div", "welcome", [
      el("div", "card", [
        el("h1", "", ["XER Viewer"]),
        el("p", "", ["View a Primavera P6 schedule without P6."]),
        open,
        el("p", "", ["or drag and drop a .xer file anywhere on this window"]),
        el("p", "note", ["Your file stays on this computer. Nothing is uploaded."]),
      ]),
    ]);
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Private windows can block storage; preferences just won't persist.
    }
  }
}
