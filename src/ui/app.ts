// Wires the model, grid, Gantt, panels, menus and keyboard together.
import { buildEmbeddedHtml, downloadText, extractEmbeddedXer, type EmbeddedFile } from "../embed";
import { FEATURES } from "../features";
import { loadSchedule } from "../xer";
import { BASELINE_DEFAULT_COLUMNS, COLUMN_BY_KEY, COLUMNS, scheduleColumns, type Column } from "../xer/columns";
import { bandRows, rowsToTable, type CopiedTable } from "../xer/clipboard";
import { compareSchedules, type ChangeKind, type Comparison } from "../xer/compare";
import { describeTrace, traceLogic, type TraceSpec } from "../xer/trace";
import {
  extractCommentsFromHtml,
  liveComments,
  mergeComments,
  newCommentId,
  parseComments,
  snapshotOf,
  targetFor,
  targetKey,
  type ReviewComment,
} from "../xer/comments";
import { formatDate, isMilestone, type DurationUnit } from "../xer/format";
import { compileFilter, emptyFilter, type CompiledFilter, type FilterState } from "../xer/filter";
import { applyRollups, type Activity, type Relationship, type Schedule, type Wbs } from "../xer/model";
import { XerParseError } from "../xer/parse";
import {
  activitiesInDisplayOrder,
  buildRows,
  compareValues,
  expandedAll,
  expandedToLevel,
  revealActivity,
  type GridRow,
  type ViewState,
} from "../xer/rows";
import { buildActivitiesXlsx, buildTableXlsx, XLSX_TYPE, type TableSheet } from "../xer/xlsx";
import { el, esc, modal, splitter } from "./dom";
import { openColumnFilter } from "./column-filter";
import { openColumnsDialog } from "./columns-dialog";
import { Gantt } from "./gantt";
import { Grid } from "./grid";
import { askReviewerName, CommentsPanel, describeTarget, editCommentDialog } from "./comments";
import { MenuBar, popupMenu, type MenuItem } from "./menu";
import { RelationsPanel } from "./relations";
import { DEFAULT_HISTOGRAM, ResourcePanel, type HistogramSettings } from "./resources";
import { filterMenuItems, traceMenuItems } from "./filter-menu";
import { ChangesPanel } from "./changes";
import { DetailsPanel, type DetailsTab } from "./details";
import { HealthPanel } from "./health";
import { ResourceSpreadsheet } from "./spreadsheet";
import { checkSchedule, type CheckResult } from "../xer/health";
import { changesSheets, checkSheets, infoSheet } from "../xer/reports";
import { showCalendars } from "./calendars";
import { showAbout, showShortcuts, showUserGuide } from "./help";
import { Search } from "./search";
import { ROW_HEIGHT, wbsColors } from "./theme";
import { Toolbar, type ToolItem } from "./toolbar";

const PREFS_KEY = "xer-viewer-prefs-v1";

interface Prefs {
  columns: string[];
  widths: Record<string, number>;
  unit: DurationUnit;
  hideEmptyWbs: boolean;
  showToolbar: boolean;
  showGantt: boolean;
  showRelations: boolean;
  relLines: RelLines;
  showFilters: boolean;
  bottomTab: BottomTab;
  /** Which Activity Details tab is showing. */
  detailsTab: DetailsTab;
  /** View > Bar Labels. */
  barLabels: BarLabels;
  histogram: HistogramSettings;
  /** Name shown on review comments made in this browser. */
  reviewer: string;
}

type BottomTab = "details" | "resources" | "spreadsheet" | "comments" | "changes" | "check";

type BarLabels = "none" | "name" | "id" | "idName" | "finish" | "dates";

const BAR_LABELS: [BarLabels, string][] = [
  ["none", "None"],
  ["name", "Activity Name"],
  ["id", "Activity ID"],
  ["idName", "Activity ID and Name"],
  ["finish", "Finish Date"],
  ["dates", "Start and Finish Dates"],
];

/** Unsaved comments are also kept here, per project, so closing the tab doesn't lose them. */
const DRAFT_KEY = "xer-viewer-comment-draft:";

type RelLines = "none" | "driving" | "all";

const DEFAULT_PREFS: Prefs = {
  columns: COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
  widths: {},
  unit: "d",
  hideEmptyWbs: true,
  showToolbar: FEATURES.toolbar,
  showGantt: FEATURES.gantt,
  showRelations: FEATURES.relationships,
  relLines: FEATURES.ganttRelationships ? "driving" : "none",
  showFilters: false,
  bottomTab: "details",
  detailsTab: "relationships",
  barLabels: "none",
  histogram: DEFAULT_HISTOGRAM,
  reviewer: "",
};

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    const prefs = { ...DEFAULT_PREFS, ...saved };
    prefs.histogram = { ...DEFAULT_HISTOGRAM, ...saved.histogram };
    // Before 0.8 the first bottom tab was just Relationships; it's inside Activity Details now.
    if ((prefs.bottomTab as string) === "relationships") prefs.bottomTab = "details";
    // UDF and activity code columns depend on the file; keep them for files that have them.
    prefs.columns = prefs.columns.filter((k) => COLUMN_BY_KEY.has(k) || /^(udf|code|codedesc):/.test(k));
    if (prefs.columns.length === 0) prefs.columns = DEFAULT_PREFS.columns;
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function isActivity(x: Activity | Wbs): x is Activity {
  return "wbs" in x;
}

/** The comment-index key for a grid row (matches `targetKey`). */
function rowKey(r: GridRow): string {
  return r.kind === "wbs" ? `wbs|${r.wbs.fullCode}` : `activity|${r.act.code}`;
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
  private toolbar!: Toolbar;
  private workspace: HTMLElement;
  private welcome: HTMLElement;
  private status = el("div", "left");
  private statusRight = el("div", "right");
  /** "Filter on: showing n of m" while anything is filtered (its own slot, so selecting a row can't hide it). */
  private statusFilter = el("div", "filter-note hidden");
  private bottom: HTMLElement;
  private bottomSplit: HTMLElement;
  private resources: ResourcePanel;
  private resSplit: HTMLElement;
  private sideSplit: HTMLElement;
  private fileInput: HTMLInputElement;
  private appRoot: HTMLElement;
  private filterState: FilterState = emptyFilter();
  private compiled: CompiledFilter = { test: null, errors: new Set() };
  private filterTimer: ReturnType<typeof setTimeout> | undefined;
  /** All review comments, including deleted ones (kept so merges can't revive them). */
  private comments: ReviewComment[] = [];
  /** targetKey -> [open, done] counts of live comments. */
  private commentIndex = new Map<string, [number, number]>();
  /** Comments changed since the last save. */
  private commentsDirty = false;
  private commentsPanel!: CommentsPanel;
  private commentsTab: HTMLElement | null = null;
  private importInput!: HTMLInputElement;
  /** File > Compare with Baseline: the baseline file and its parsed schedule. */
  private baselineFile: EmbeddedFile | null = null;
  private baseline: Schedule | null = null;
  private baselineInput!: HTMLInputElement;
  private changesPanel!: ChangesPanel;
  private details!: DetailsPanel;
  private health!: HealthPanel;
  private spreadsheet!: ResourceSpreadsheet;
  /** Schedule Check results for the open schedule and baseline. */
  private healthCache: { s: Schedule; cmp: Comparison | null; results: CheckResult[] } | null = null;
  /** Rows waiting for the copy event (Edit menu copies go through execCommand). */
  private pendingCopy: CopiedTable | null = null;

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
      onHeaderMenu: (k, x, y, cell) => this.headerMenu(k, x, y, cell),
      filterRow: () => FEATURES.filters && this.prefs.showFilters,
      filterValue: (k) => this.filterState.columns.get(k) ?? "",
      filterError: (k) => this.compiled.errors.has(k),
      columnFilter: FEATURES.filters
        ? {
            active: (k) => !!this.filterState.columns.get(k)?.trim() || this.filterState.values.has(k),
            open: (k, anchor) => this.openColumnFilter(k, anchor),
          }
        : null,
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
      commentBadge: (r) => (FEATURES.comments ? this.commentIndex.get(rowKey(r)) ?? null : null),
      onRowMenu: (i, x, y) => this.rowMenu(i, x, y),
    });

    this.gantt = new Gantt({
      rows: () => this.rows,
      relationships: () => this.relLines,
      rowOf: (a) => this.rowIndex.get(a),
      selectedIndex: () => this.selectedIndex(),
      dataDate: () => this.schedule?.projects[0]?.dataDate ?? null,
      onSelect: (i) => this.select(i),
      // Like P6: double-clicking a row in the Gantt brings its bar into view.
      onDoubleClick: (i) => {
        this.select(i);
        this.zoomToRow(i);
      },
      onScroll: (top) => (this.grid.scrollTop = top),
      baseline: (row) => {
        const cmp = this.cmp;
        if (!cmp) return null;
        if (row.kind === "act") {
          const b = cmp.changes.get(row.act)?.base;
          return b ? [b.start, b.finish] : null;
        }
        const w = cmp.wbs.get(row.wbs);
        return w ? [w.start, w.finish] : null;
      },
      showBaseline: () => this.cmp !== null,
      barLabel: (a) => this.barLabel(a),
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
      ...(FEATURES.filters ? [{ label: "Filter", items: () => this.filterMenu() }] : []),
      ...(FEATURES.comments ? [{ label: "Review", items: () => this.reviewMenu() }] : []),
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

    this.commentsPanel = new CommentsPanel({
      schedule: () => this.schedule,
      comments: () => this.comments,
      goTo: (item) => (isActivity(item) ? this.goTo(item) : this.goToWbs(item)),
      onEdit: (c) => void this.editComment(c),
      onDelete: (c) => this.deleteComment(c),
      onToggleDone: (c) => void this.toggleDone(c),
      onAddGeneral: () => void this.addComment(null),
      onImport: () => this.importInput.click(),
    });
    const cmRow = el("div", "brow", [this.commentsPanel.root]);

    this.changesPanel = new ChangesPanel({
      comparison: () => this.cmp,
      unit: () => this.view.ctx.unit,
      goTo: (a) => this.goTo(a),
      onCompare: () => this.baselineInput.click(),
      onRemove: () => this.removeBaseline(),
      onFilter: (k) => this.filterChanges(k),
      onExport: () => void this.exportChanges(),
    });
    const chRow = el("div", "brow", [this.changesPanel.root]);

    this.details = new DetailsPanel(
      {
        schedule: () => this.schedule,
        columns: () => this.view.columns,
        ctx: () => this.view.ctx,
        tab: () => (FEATURES.activityDetails ? this.prefs.detailsTab : "relationships"),
        setTab: (t) => {
          this.prefs.detailsTab = t;
          this.savePrefs();
        },
      },
      relRow,
    );
    const detailsRow = el("div", "brow", [this.details.root]);
    // Without the feature, only the Relationships part shows.
    if (!FEATURES.activityDetails) this.details.root.classList.add("details-off");

    this.spreadsheet = new ResourceSpreadsheet({
      schedule: () => this.schedule,
      dataDate: () => this.schedule?.projects[0]?.dataDate ?? null,
      hoursPerWeek: () => this.prefs.histogram.hoursPerWeek,
      onExport: (sheets, what) => void this.exportTables(sheets, "resource usage", what),
    });
    const ssRow = el("div", "brow", [this.spreadsheet.root]);

    this.health = new HealthPanel({
      results: () => this.healthResults(),
      active: () => (this.filterState.check ? this.healthResults()?.find((r) => r.name === this.filterState.check!.name)?.id ?? null : null),
      source: () => (this.cmp ? `the baseline (${this.cmp.name})` : "planned dates (no baseline loaded)"),
      onPick: (r) => this.pickCheck(r),
      onClear: () => {
        this.filterState.check = null;
        this.applyFilter();
      },
      onExport: () => void this.exportChecks(),
    });
    const hcRow = el("div", "brow", [this.health.root]);

    const tabs: [BottomTab, string, HTMLElement][] = [
      ["details", FEATURES.activityDetails ? "Activity Details" : "Relationships", detailsRow],
      ["resources", "Resource Usage", resRow],
      ["spreadsheet", "Resource Spreadsheet", ssRow],
      ["comments", "Comments", cmRow],
      ["changes", "Changes", chRow],
      ["check", "Schedule Check", hcRow],
    ];
    const tabStrip = el("div", "btabs");
    for (const [id, label, body] of tabs) {
      if (id === "resources" && !FEATURES.resourceHistogram) continue;
      if (id === "comments" && !FEATURES.comments) continue;
      if (id === "changes" && !FEATURES.baselineCompare) continue;
      if (id === "spreadsheet" && !FEATURES.resourceSpreadsheet) continue;
      if (id === "check" && !FEATURES.scheduleCheck) continue;
      const tab = el("div", "btab", [label]);
      tab.dataset.tab = id;
      tab.addEventListener("mousedown", () => this.setBottomTab(id));
      tabStrip.append(tab);
      body.dataset.tab = id;
      if (id === "comments") this.commentsTab = tab;
    }

    this.bottom = el("div", "bottom", [tabStrip, detailsRow, resRow, ssRow, cmRow, chRow, hcRow]);
    this.bottomSplit = splitter("h", () => (this.dragStart = this.bottom.getBoundingClientRect().height), (d) => {
      this.bottom.style.height = `${Math.max(60, Math.min(this.workspace.clientHeight - 120, this.dragStart - d))}px`;
    });

    this.workspace = el("div", "workspace hidden", [top, this.bottomSplit, this.bottom]);
    this.welcome = this.buildWelcome();
    this.fileInput = el("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".xer,.html,.htm";
    this.fileInput.className = "hidden";
    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.openFile(f);
      this.fileInput.value = "";
    });
    // Review > Import Comments: several reviewers' saved files at once.
    this.importInput = el("input");
    this.importInput.type = "file";
    this.importInput.accept = ".html,.htm";
    this.importInput.multiple = true;
    this.importInput.className = "hidden";
    this.importInput.addEventListener("change", () => {
      const files = [...(this.importInput.files ?? [])];
      this.importInput.value = "";
      if (files.length) void this.importComments(files);
    });

    // File > Compare with Baseline: an earlier .xer (or saved viewer) to compare with.
    this.baselineInput = el("input");
    this.baselineInput.type = "file";
    this.baselineInput.accept = ".xer,.html,.htm";
    this.baselineInput.className = "hidden";
    this.baselineInput.addEventListener("change", () => {
      const f = this.baselineInput.files?.[0];
      this.baselineInput.value = "";
      if (f) void this.openBaseline(f);
    });

    this.toolbar = new Toolbar(this.toolItems());
    this.appRoot = mount;
    mount.append(
      this.menu.root,
      this.toolbar.root,
      this.workspace,
      this.welcome,
      el("div", "statusbar", [this.status, this.statusFilter, this.statusRight]),
      this.fileInput,
      this.importInput,
      this.baselineInput,
    );
    this.applyPanelVisibility();
    this.installKeys();
    this.installDrop();
    this.installCopy();
    // Comments only persist when saved into the HTML file: warn before they're lost.
    window.addEventListener("beforeunload", (e) => {
      if (!this.commentsDirty) return;
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    });
    this.setStatus("Ready");
  }

  private dragStart = 0;

  // ---------- Loading ----------

  /**
   * A .xer opens as the schedule (keeping any comments, which match by Activity ID).
   * A saved review .html opens its schedule and comments, or, if a schedule is already
   * open, just merges its comments in.
   */
  async openFile(file: File): Promise<void> {
    if (!/\.html?$/i.test(file.name)) {
      await this.load(file.name, new Uint8Array(await file.arrayBuffer()));
      return;
    }
    if (this.schedule) {
      await this.importComments([file]);
      return;
    }
    const text = await file.text();
    const embedded = await extractEmbeddedXer(text).catch(() => null);
    if (!embedded) {
      modal("Can't open file", `<p><b>${esc(file.name)}</b></p><p>This HTML file doesn't contain a schedule. Open a .xer, or a file saved with <b>File &gt; Save Viewer with Schedule</b>.</p>`);
      return;
    }
    await this.load(embedded.name, embedded.bytes, extractCommentsFromHtml(text));
  }

  async load(name: string, bytes: Uint8Array, comments: ReviewComment[] = []): Promise<void> {
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
      this.resources.reset();
      this.spreadsheet.reset();
      this.healthCache = null;
      this.view.expanded = expandedToLevel(schedule, FEATURES.defaultExpandLevel);
      this.view.columns = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
      // A loaded baseline stays: compare the newly opened file with it.
      this.recompare();
      this.updateRelLines();
      const recovered = this.loadComments(comments);
      this.welcome.classList.add("hidden");
      this.workspace.classList.remove("hidden");
      this.applyPanelVisibility();
      this.grid.syncFilterValues();
      // A new file starts unfiltered; this also resets the status bar and toolbar.
      this.applyFilter();
      let first: number | null = null;
      let last: number | null = null;
      for (const r of schedule.roots) {
        if (r.start !== null && (first === null || r.start < first)) first = r.start;
        if (r.finish !== null && (last === null || r.finish > last)) last = r.finish;
      }
      this.gantt.setRange(first, last);
      this.extendGanttForBaseline();
      this.changesPanel.render();
      this.grid.scrollTop = 0;
      this.gantt.scrollTop = 0;
      this.showDetails(null);
      this.updateTitle();
      const open = liveComments(this.comments).filter((c) => c.status === "open").length;
      this.setStatus(
        `Opened ${name} in ${((performance.now() - t0) / 1000).toFixed(1)} s` +
          (open ? `. ${open} open review comment${open === 1 ? "" : "s"} (Review > Show Comments).` : "") +
          (recovered ? ` Recovered ${recovered} unsaved comment change${recovered === 1 ? "" : "s"} from your last session.` : ""),
      );
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

  /**
   * Rebuilds after a filter change without losing the selected row: if it was on screen
   * it stays at the same height; if the filter had hidden it, it's centred when it comes
   * back. The selection itself is never dropped by filtering.
   */
  private rebuildKeepingSelection(): void {
    const before = this.selectedIndex();
    const top = this.grid.scrollTop;
    const offset = before * ROW_HEIGHT - top;
    const wasOnScreen = before >= 0 && offset >= 0 && offset < this.grid.body.clientHeight;
    this.rebuild();
    const after = this.selectedIndex();
    if (after < 0) return;
    if (wasOnScreen) this.grid.scrollTop = Math.max(0, after * ROW_HEIGHT - offset);
    else if (before < 0) this.grid.scrollToIndex(after, true);
    else return;
    this.gantt.scrollTop = this.grid.scrollTop;
  }

  private selectedIndex(): number {
    return this.selected ? this.rowIndex.get(this.selected) ?? -1 : -1;
  }

  private select(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    this.selected = row.kind === "wbs" ? row.wbs : row.act;
    this.grid.updateSelection();
    this.toolbar.refresh();
    this.grid.scrollToIndex(i);
    // Don't wait for the grid's scroll event to bring the Gantt along.
    this.gantt.scrollTop = this.grid.scrollTop;
    this.grid.focus();
    this.gantt.draw();
    this.showDetails(this.selected);
    if (row.kind === "act") {
      this.setStatus(`${row.act.code} – ${row.act.name}`);
    } else {
      this.setStatus(`WBS ${row.wbs.fullCode} – ${row.wbs.name} (${row.wbs.activityCount.toLocaleString()} activities)`);
    }
  }

  /** The bottom panel's Activity Details (Relationships, General, ...) follow the selection. */
  private showDetails(item: Activity | Wbs | null): void {
    if (!this.prefs.showRelations) return;
    const a = item && isActivity(item) ? item : null;
    this.preds.show(a);
    this.succs.show(a);
    this.details.show(item);
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

  /** Zooms the Gantt so the row's bar fills the middle of the chart. */
  private zoomToRow(i: number): void {
    const row = this.rows[i];
    if (!row || !FEATURES.gantt || !this.prefs.showGantt) return;
    let s: number | null;
    let f: number | null;
    if (row.kind === "wbs") [s, f] = [row.wbs.start, row.wbs.finish];
    else if (isMilestone(row.act.type)) s = f = row.act.type === "TT_Mile" ? row.act.start : row.act.finish ?? row.act.start;
    else [s, f] = [row.act.start, row.act.finish];
    s ??= f;
    f ??= s;
    if (s === null || f === null) return;
    this.gantt.focusRange(s, f);
  }

  private toggleSort(key: string): void {
    const s = this.view.sort;
    // Ascending -> descending -> back to the default order.
    this.view.sort = s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null;
    this.rebuild();
  }

  private clearSort(): void {
    this.view.sort = null;
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
    if (FEATURES.baselineCompare) {
      items.push(
        "-",
        { label: "Compare with Baseline...", enabled: loaded, action: () => this.baselineInput.click() },
        { label: "Remove Baseline", enabled: () => this.cmp !== null, action: () => this.removeBaseline() },
      );
    }
    if (FEATURES.excelExport) {
      items.push("-", {
        label: "Export to Excel",
        enabled: loaded,
        items: () => [
          { label: "Rows as Shown (current expand/collapse)", action: () => void this.exportExcel(false) },
          { label: "All Rows (fully expanded)", key: "Ctrl+E", action: () => void this.exportExcel(true) },
        ],
      });
    }
    return items;
  }

  private editMenu(): MenuItem[] {
    const loaded = () => this.schedule !== null;
    const items: MenuItem[] = [];
    if (FEATURES.copyRows) {
      items.push(
        { label: "Copy", key: "Ctrl+C", enabled: () => loaded() && this.selectedIndex() >= 0, action: () => this.copySelected() },
        { label: "Copy All Rows as Shown", enabled: loaded, action: () => this.copyRows(this.rows) },
      );
    }
    if (FEATURES.search) {
      if (items.length) items.push("-");
      items.push(
        { label: "Find...", key: "Ctrl+F", enabled: loaded, action: () => this.search.open() },
        { label: "Find Next", key: "F3", enabled: loaded, action: () => this.search.find(1) },
        { label: "Find Previous", key: "Shift+F3", enabled: loaded, action: () => this.search.find(-1) },
      );
    }
    return items.length ? items : [{ label: "(no edit commands)", enabled: () => false }];
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
    // Grouped like P6: what the grid shows, the WBS tree, filter and sort, panels, Gantt.
    const items: MenuItem[] = [];
    if (FEATURES.columnChooser) items.push({ label: "Columns...", action: () => this.openColumnsDialog() });
    items.push(
      {
        label: "Duration Unit",
        items: () =>
          units.map(([u, label]) => ({
            label,
            checked: () => this.view.ctx.unit === u,
            action: () => {
              this.view.ctx = { ...this.view.ctx, unit: u };
              this.prefs.unit = u;
              // Ticked duration values were the old unit's text; they would match nothing now.
              for (const k of [...this.filterState.values.keys()]) {
                if (this.view.columns.get(k)?.group === "Durations") this.filterState.values.delete(k);
              }
              this.savePrefs();
              // Duration filters are typed in the displayed unit, so they change meaning.
              if (this.compiled.test) this.applyFilter();
              this.grid.render();
              this.preds.render();
              this.succs.render();
              this.changesPanel.render();
              this.details.render();
            },
          })),
      },
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
    if (FEATURES.calendars) items.push({ label: "Calendars...", enabled: loaded, action: () => this.openCalendars() });
    items.push(
      "-",
      { label: "Expand All", enabled: loaded, action: () => this.setExpanded(expandedAll(s())) },
      { label: "Collapse All", enabled: loaded, action: () => this.setExpanded(new Set()) },
      { label: "Expand To", enabled: loaded, items: () => levels },
    );
    if (FEATURES.sorting) {
      items.push("-", { label: "Clear Sort", enabled: () => this.view.sort !== null, action: () => this.clearSort() });
    }

    const panels: MenuItem[] = [];
    if (FEATURES.toolbar) {
      panels.push({
        label: "Toolbar",
        checked: () => this.prefs.showToolbar,
        action: () => {
          this.prefs.showToolbar = !this.prefs.showToolbar;
          this.savePrefs();
          this.applyPanelVisibility();
        },
      });
    }
    if (FEATURES.gantt) {
      panels.push({
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
            checked: () => this.prefs.showRelations && this.prefs.bottomTab === t,
            action: () => this.showBottom(t),
          })),
          "-",
          { label: "None", checked: () => !this.prefs.showRelations, action: () => this.showBottom(null) },
        ],
      });
    }
    if (panels.length) items.push("-", ...panels);

    if (FEATURES.gantt) {
      items.push("-");
      if (FEATURES.ganttRelationships) {
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
      if (FEATURES.barLabels) {
        items.push({
          label: "Bar Labels",
          items: () =>
            BAR_LABELS.map(([m, label]) => ({
              label,
              checked: () => this.prefs.barLabels === m,
              action: () => {
                this.prefs.barLabels = m;
                this.savePrefs();
                this.gantt.draw();
              },
            })),
        });
      }
      items.push(
        {
          label: "Zoom",
          enabled: loaded,
          items: () => [
            { label: "Zoom In", key: "Ctrl+Wheel", action: () => this.gantt.zoom(1.5) },
            { label: "Zoom Out", action: () => this.gantt.zoom(1 / 1.5) },
            { label: "Zoom to Fit", action: () => this.gantt.fit() },
            "-",
            {
              label: "Zoom to Selected",
              key: "Double-click",
              enabled: () => this.selectedIndex() >= 0,
              action: () => this.zoomToRow(this.selectedIndex()),
            },
          ],
        },
        {
          label: "Go to Data Date",
          enabled: () => !!this.schedule?.projects[0]?.dataDate,
          action: () => this.gantt.scrollToDate(this.schedule!.projects[0].dataDate!),
        },
      );
    }
    return items;
  }

  /** The toolbar's buttons: the commands people reach for most, in menu order. */
  private toolItems(): ToolItem[] {
    const loaded = () => this.schedule !== null;
    const s = () => this.schedule!;
    const items: ToolItem[] = [{ icon: "open", title: "Open (Ctrl+O)", action: () => this.fileInput.click() }];
    if (FEATURES.embedSave) {
      items.push({ icon: "save", title: "Save Viewer with Schedule (Ctrl+S)", enabled: loaded, action: () => void this.saveEmbedded() });
    }
    if (FEATURES.excelExport) {
      items.push({ icon: "excel", title: "Export All Rows to Excel (Ctrl+E)", enabled: loaded, action: () => void this.exportExcel(true) });
    }
    items.push(
      "-",
      { icon: "expand", title: "Expand All", enabled: loaded, action: () => this.setExpanded(expandedAll(s())) },
      { icon: "collapse", title: "Collapse All", enabled: loaded, action: () => this.setExpanded(new Set()) },
    );
    if (FEATURES.search) items.push("-", { icon: "find", title: "Find (Ctrl+F)", enabled: loaded, action: () => this.search.open() });
    if (FEATURES.filters) {
      items.push(
        {
          icon: "filter",
          title: "Filter menu",
          enabled: loaded,
          pressed: () => this.view.filter !== null,
          action: (b) => {
            const r = b.getBoundingClientRect();
            this.menu.openAt("Filter", r.left, r.bottom);
          },
        },
        { icon: "clearFilter", title: "Clear Filters", enabled: () => this.view.filter !== null, action: () => this.clearFilters() },
      );
    }
    if (FEATURES.gantt) {
      items.push(
        "-",
        {
          icon: "gantt",
          title: "Gantt Chart",
          pressed: () => this.prefs.showGantt,
          action: () => {
            this.prefs.showGantt = !this.prefs.showGantt;
            this.savePrefs();
            this.applyPanelVisibility();
          },
        },
        { icon: "zoomIn", title: "Zoom In (Ctrl+Wheel)", enabled: () => loaded() && this.prefs.showGantt, action: () => this.gantt.zoom(1.5) },
        { icon: "zoomOut", title: "Zoom Out", enabled: () => loaded() && this.prefs.showGantt, action: () => this.gantt.zoom(1 / 1.5) },
        { icon: "fit", title: "Zoom to Fit", enabled: () => loaded() && this.prefs.showGantt, action: () => this.gantt.fit() },
        {
          icon: "dataDate",
          title: "Go to Data Date",
          enabled: () => this.prefs.showGantt && !!this.schedule?.projects[0]?.dataDate,
          action: () => this.gantt.scrollToDate(this.schedule!.projects[0].dataDate!),
        },
      );
    }
    if (FEATURES.comments) {
      items.push("-", {
        icon: "comment",
        title: "Add Comment on the Selected Row (Ctrl+M)",
        enabled: () => loaded() && !!this.selected,
        action: () => void this.addComment(this.selected),
      });
    }
    items.push("-", { icon: "help", title: "User Guide (F1)", action: () => showUserGuide() });
    return items;
  }

  private filterMenu(): MenuItem[] {
    return filterMenuItems({
      state: () => this.filterState,
      loaded: () => this.schedule !== null,
      dataDate: () => this.schedule?.projects[0]?.dataDate ?? null,
      onChange: () => this.applyFilter(),
      onClear: () => this.clearFilters(),
      active: () => this.view.filter !== null,
      filterRowShown: () => this.prefs.showFilters,
      toggleFilterRow: () => this.toggleFilters(),
      comparison: () => FEATURES.baselineCompare && this.cmp !== null,
      selected: () => (FEATURES.traceLogic && this.selected && isActivity(this.selected) ? this.selected : null),
      setTrace: (t) => this.setTrace(t),
    });
  }

  private helpMenu(): MenuItem[] {
    return [
      { label: "User Guide", key: "F1", action: () => showUserGuide() },
      { label: "Keyboard Shortcuts", action: () => showShortcuts() },
      "-",
      { label: "About XER Viewer", action: () => showAbout() },
    ];
  }

  private openColumnsDialog(): void {
    if (!FEATURES.columnChooser) return;
    openColumnsDialog({
      available: [...this.view.columns.values()],
      selected: this.columns().map((c) => c.key),
      defaults: DEFAULT_PREFS.columns,
      onApply: (keys) => this.setColumns(keys),
    });
  }

  /** Shows these columns, in this order. */
  private setColumns(keys: string[]): void {
    // Keep saved UDF and code columns this file doesn't have, so they come back for files that do.
    const missing = this.prefs.columns.filter((k) => !this.view.columns.has(k));
    this.prefs.columns = [...keys, ...missing];
    this.savePrefs();
    // A sort or filter on a removed column would be invisible; drop it.
    if (this.view.sort && !keys.includes(this.view.sort.key)) this.view.sort = null;
    for (const k of [...this.filterState.columns.keys()]) if (!keys.includes(k)) this.filterState.columns.delete(k);
    for (const k of [...this.filterState.values.keys()]) if (!keys.includes(k)) this.filterState.values.delete(k);
    this.grid.syncFilterValues();
    this.applyFilter();
  }

  /** Right-click on a column header: sort, filter or hide that column. */
  private headerMenu(key: string | null, x: number, y: number, cell: HTMLElement | null): void {
    const col = key ? this.view.columns.get(key) : undefined;
    const items: MenuItem[] = [];
    if (key && col && this.schedule) {
      const sorted = (dir: 1 | -1) => this.view.sort?.key === key && this.view.sort.dir === dir;
      const sortBy = (dir: 1 | -1) => {
        this.view.sort = { key, dir };
        this.rebuild();
      };
      if (FEATURES.sorting) {
        items.push(
          { label: col.kind === "text" ? "Sort A to Z" : "Sort Smallest to Largest", checked: () => sorted(1), action: () => sortBy(1) },
          { label: col.kind === "text" ? "Sort Z to A" : "Sort Largest to Smallest", checked: () => sorted(-1), action: () => sortBy(-1) },
          { label: "Clear Sort", enabled: () => this.view.sort !== null, action: () => this.clearSort() },
          "-",
        );
      }
      if (FEATURES.filters && cell) {
        items.push(
          { label: "Filter This Column...", action: () => this.openColumnFilter(key, cell.querySelector<HTMLElement>(".hf") ?? cell) },
          {
            label: "Clear Filter on This Column",
            enabled: () => !!this.filterState.columns.get(key)?.trim() || this.filterState.values.has(key),
            action: () => {
              this.filterState.columns.delete(key);
              this.filterState.values.delete(key);
              this.grid.syncFilterValues();
              this.applyFilter();
            },
          },
          "-",
        );
      }
      const shown = this.columns().map((c) => c.key);
      items.push({
        label: `Hide "${col.label}"`,
        enabled: () => shown.length > 1,
        action: () => this.setColumns(shown.filter((k) => k !== key)),
      });
    }
    if (FEATURES.columnChooser) items.push({ label: "Columns...", action: () => this.openColumnsDialog() });
    if (items.length) popupMenu(items, x, y);
  }

  // ---------- Review comments ----------

  private reviewMenu(): MenuItem[] {
    const loaded = () => this.schedule !== null;
    const sel = this.selected;
    const onSel = sel ? (isActivity(sel) ? sel.code : `WBS ${sel.code}`) : "";
    return [
      { label: sel ? `Add Comment on ${onSel}...` : "Add Comment...", key: "Ctrl+M", enabled: () => loaded() && !!this.selected, action: () => void this.addComment(this.selected) },
      { label: "Add General Comment...", enabled: loaded, action: () => void this.addComment(null) },
      "-",
      { label: "Show Comments", enabled: loaded, action: () => this.showCommentsTab() },
      { label: "Import Reviewers' Files...", enabled: loaded, action: () => this.importInput.click() },
      "-",
      ...(FEATURES.scheduleCheck ? [{ label: "Schedule Check", enabled: loaded, action: () => this.showBottom("check") }, "-" as const] : []),
      { label: `Your Name${this.prefs.reviewer ? `: ${this.prefs.reviewer}` : ""}...`, action: () => void this.ensureReviewer(true) },
    ];
  }

  private rowMenu(i: number, x: number, y: number): void {
    const row = this.rows[i];
    if (!row) return;
    const item = row.kind === "wbs" ? row.wbs : row.act;
    const items: MenuItem[] = [];
    const sep = () => items.length && items[items.length - 1] !== "-" && items.push("-");
    if (FEATURES.comments) {
      const counts = this.commentIndex.get(rowKey(row));
      items.push({ label: "Add Comment...", key: "Ctrl+M", action: () => void this.addComment(item) });
      if (counts) items.push({ label: `Show Comments (${counts[0] + counts[1]})`, action: () => this.showCommentsTab() });
    }
    if (FEATURES.copyRows) {
      sep();
      items.push({ label: row.kind === "wbs" ? "Copy Band and Rows Under It" : "Copy Row", key: "Ctrl+C", action: () => this.copySelected() });
    }
    if (FEATURES.traceLogic && row.kind === "act") {
      sep();
      items.push({ label: "Trace Logic", items: () => traceMenuItems(row.act, this.filterState.trace, (t) => this.setTrace(t)) });
    }
    if (FEATURES.gantt && this.prefs.showGantt) {
      sep();
      items.push({ label: "Zoom to Bar", key: "Double-click", action: () => this.zoomToRow(i) });
    }
    if (row.kind === "wbs") {
      sep();
      items.push({ label: this.view.expanded.has(row.wbs.id) ? "Collapse" : "Expand", action: () => this.toggle(i) });
    }
    if (items.length) popupMenu(items, x, y);
  }

  /** Asks for the reviewer's name if we don't have one (or `force`). Returns it, or null if cancelled. */
  private async ensureReviewer(force = false): Promise<string | null> {
    if (this.prefs.reviewer && !force) return this.prefs.reviewer;
    const name = await askReviewerName(this.prefs.reviewer);
    if (name) {
      this.prefs.reviewer = name;
      this.savePrefs();
    }
    return name ?? (force ? this.prefs.reviewer || null : null);
  }

  /** Adds a comment on an activity or WBS band, or a general one when `item` is null. */
  private async addComment(item: Activity | Wbs | null): Promise<void> {
    if (!this.schedule) return;
    const author = await this.ensureReviewer();
    if (!author) return;
    const target = item ? targetFor(item) : ({ kind: "general" } as const);
    const about = item ? (isActivity(item) ? `${item.code} – ${item.name}` : `WBS ${item.fullCode} – ${item.name}`) : "General comment on the schedule";
    const draft = await editCommentDialog(about, author);
    if (!draft) return;
    const now = Date.now();
    this.comments.push({
      id: newCommentId(),
      target,
      type: draft.type,
      text: draft.text,
      author,
      created: now,
      updated: now,
      status: "open",
      snapshot: item ? snapshotOf(item) : undefined,
    });
    this.commentsChanged(`Comment added on ${item ? describeTarget(this.comments[this.comments.length - 1], item) : "the schedule"}.`);
  }

  private async editComment(c: ReviewComment): Promise<void> {
    const draft = await editCommentDialog(describeTarget(c, null), c.author, { type: c.type, text: c.text });
    if (!draft) return;
    this.replaceComment({ ...c, ...draft, updated: Date.now() });
    this.commentsChanged("Comment updated.");
  }

  private deleteComment(c: ReviewComment): void {
    const preview = c.text.length > 80 ? c.text.slice(0, 80) + "…" : c.text;
    if (!window.confirm(`Delete this comment by ${c.author}?\n\n"${preview}"`)) return;
    this.replaceComment({ ...c, deleted: true, updated: Date.now() });
    this.commentsChanged("Comment deleted.");
  }

  private async toggleDone(c: ReviewComment): Promise<void> {
    if (c.status === "done") {
      this.replaceComment({ ...c, status: "open", doneBy: undefined, doneAt: undefined, updated: Date.now() });
      this.commentsChanged("Comment reopened.");
      return;
    }
    const by = await this.ensureReviewer();
    if (!by) {
      this.commentsPanel.render(); // undo the checkbox tick
      return;
    }
    const now = Date.now();
    this.replaceComment({ ...c, status: "done", doneBy: by, doneAt: now, updated: now });
    this.commentsChanged("Comment marked done.");
  }

  private replaceComment(c: ReviewComment): void {
    this.comments = this.comments.map((x) => (x.id === c.id ? c : x));
  }

  /** Merges comments from saved review files (several reviewers at once). */
  private async importComments(files: File[]): Promise<void> {
    if (!this.schedule) return;
    let added = 0;
    let updated = 0;
    const empty: string[] = [];
    for (const f of files) {
      const found = extractCommentsFromHtml(await f.text());
      if (!found.length) {
        empty.push(f.name);
        continue;
      }
      const r = mergeComments(this.comments, found);
      this.comments = r.comments;
      added += r.added;
      updated += r.updated;
    }
    const parts = [`Imported from ${files.length - empty.length} file${files.length - empty.length === 1 ? "" : "s"}: ${added} new comment${added === 1 ? "" : "s"}, ${updated} updated.`];
    if (empty.length) parts.push(`No comments in: ${empty.join(", ")}.`);
    if (added || updated) this.commentsChanged(parts.join(" "));
    else this.setStatus(parts.join(" "));
    this.showCommentsTab();
  }

  /**
   * Comments for a newly opened schedule: keep the current ones (they match by Activity
   * ID), add any from the file, and recover unsaved work from the last session.
   * Returns how many changes were recovered.
   */
  private loadComments(fromFile: ReviewComment[]): number {
    this.comments = mergeComments(this.comments, fromFile).comments;
    let recovered = 0;
    const key = this.draftKey();
    if (key) {
      try {
        const draft = parseComments(localStorage.getItem(key) ?? "");
        const r = mergeComments(this.comments, draft);
        this.comments = r.comments;
        recovered = r.added + r.updated;
      } catch {
        // Storage blocked; nothing to recover.
      }
    }
    this.commentsDirty = recovered > 0;
    this.reindexComments();
    return recovered;
  }

  private draftKey(): string | null {
    const p = this.schedule?.projects[0];
    return p ? DRAFT_KEY + p.shortName : null;
  }

  /** After any change: mark unsaved, back up, and refresh badges, panel and filters. */
  private commentsChanged(message: string): void {
    this.commentsDirty = true;
    const key = this.draftKey();
    if (key) {
      try {
        localStorage.setItem(key, JSON.stringify({ format: "xer-viewer-comments", version: 1, comments: this.comments }));
      } catch {
        // Storage blocked; the unsaved-changes warning still protects the work.
      }
    }
    this.reindexComments();
    if (this.filterState.commentedOnly) this.applyFilter();
    else this.grid.render();
    this.setStatus(`${message} Save with File > Save Viewer with Schedule (Ctrl+S) to keep it.`);
  }

  private reindexComments(): void {
    this.commentIndex.clear();
    for (const c of liveComments(this.comments)) {
      const key = targetKey(c.target);
      const counts = this.commentIndex.get(key) ?? [0, 0];
      counts[c.status === "open" ? 0 : 1]++;
      this.commentIndex.set(key, counts);
    }
    const live = liveComments(this.comments);
    const open = live.filter((c) => c.status === "open").length;
    if (this.commentsTab) {
      this.commentsTab.textContent = `Comments${live.length ? ` (${open} open)` : ""}${this.commentsDirty ? " *" : ""}`;
      this.commentsTab.title = this.commentsDirty ? "Comments not saved yet: File > Save Viewer with Schedule" : "";
    }
    this.commentsPanel.render();
  }

  private showCommentsTab(): void {
    this.showBottom("comments");
  }

  /** View > Show on Bottom: a tab of the bottom panel, or null to hide the panel. */
  private showBottom(tab: BottomTab | null): void {
    const show = tab !== null;
    if (show !== this.prefs.showRelations) {
      this.prefs.showRelations = show;
      this.applyPanelVisibility();
      this.showDetails(this.selected);
    }
    if (tab) {
      this.setBottomTab(tab);
    } else {
      this.savePrefs();
      this.applyFilter(); // the resource filter only applies while its tab is on screen
    }
  }

  /** Selects a WBS band, expanding its parents. */
  private goToWbs(w: Wbs): void {
    for (let p = w.parent; p; p = p.parent) this.view.expanded.add(p.id);
    this.rebuild();
    const i = this.rowIndex.get(w);
    if (i === undefined) {
      this.setStatus(`WBS ${w.fullCode} is hidden by the current filter.`);
      return;
    }
    this.grid.scrollToIndex(i, true);
    this.select(i);
  }

  // ---------- Filters ----------

  /** Recompiles the filter, re-totals WBS rows from what passes, and redraws. */
  private applyFilter(): void {
    clearTimeout(this.filterTimer);
    const s = this.schedule;
    if (!s) return;
    this.compiled = compileFilter(this.filterState, this.view.columns, this.view.ctx, (a) =>
      this.commentIndex.has(`activity|${a.code}`),
    );
    const base = this.compiled.test;
    const byResource = this.resourceTabShown() ? this.resources.activityFilter() : null;
    const test = base && byResource ? (a: Activity) => base(a) && byResource(a) : base ?? byResource;
    this.view.filter = test;
    applyRollups(s.roots, test ?? undefined);
    this.rebuildKeepingSelection();
    this.grid.updateFilterErrors();
    const shown = test ? s.activities.reduce((n, a) => n + (test(a) ? 1 : 0), 0) : s.activities.length;
    this.grid.setEmptyMessage(test && shown === 0 ? "No activities match the current filters." : null);
    const notes: string[] = [];
    if (byResource) notes.push(`resource: ${this.resources.selectionLabel()}`);
    if (this.filterState.trace) notes.push(`trace: ${describeTrace(this.filterState.trace)}`);
    if (this.filterState.changes.size) notes.push("changes vs baseline");
    if (this.filterState.check) notes.push(`check: ${this.filterState.check.name}`);
    if (this.prefs.showRelations && this.prefs.bottomTab === "check") this.health.render();
    this.filterStatus(test ? shown : null, notes);
    this.toolbar.refresh();
  }

  /**
   * While anything is filtered the status bar says so and how many activities show, so
   * nothing is ever filtered out of sight. `shown` is null when unfiltered; `resource`
   * names the Resource Usage selection when that is filtering too.
   */
  private filterStatus(shown: number | null, notes: string[] = []): void {
    const total = this.schedule?.activities.length ?? 0;
    this.statusFilter.classList.toggle("hidden", shown === null);
    this.statusFilter.textContent =
      shown === null
        ? ""
        : `Filter on${notes.length ? ` (${notes.join("; ")})` : ""}: showing ${shown.toLocaleString()} of ${total.toLocaleString()} activities`;
    this.statusFilter.title = "Filter > Clear Filters to remove";
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
    const t = this.prefs.bottomTab;
    const tab =
      (t === "resources" && !FEATURES.resourceHistogram) ||
      (t === "comments" && !FEATURES.comments) ||
      (t === "changes" && !FEATURES.baselineCompare) ||
      (t === "spreadsheet" && !FEATURES.resourceSpreadsheet) ||
      (t === "check" && !FEATURES.scheduleCheck)
        ? "details"
        : t;
    for (const n of this.bottom.querySelectorAll<HTMLElement>("[data-tab]")) {
      if (n.classList.contains("btab")) n.classList.toggle("active", n.dataset.tab === tab);
      else n.classList.toggle("hidden", n.dataset.tab !== tab);
    }
    if (tab === "resources") {
      this.syncResourceListWidth();
      this.resources.draw();
    }
    if (tab === "comments") this.commentsPanel.render();
    if (tab === "changes") this.changesPanel.render();
    if (tab === "spreadsheet") this.spreadsheet.render();
    if (tab === "check") this.health.render();
    if (tab === "details") this.details.render();
  }

  /** The resource list matches the grid's width so the histogram lines up under the Gantt. */
  private syncResourceListWidth(): void {
    this.resources.listPane.style.width = `${this.grid.root.getBoundingClientRect().width}px`;
  }

  private clearFilters(): void {
    this.resources.selectAll();
    this.filterState = emptyFilter();
    this.grid.syncFilterValues();
    this.applyFilter();
  }

  /** Filter > Filter Row (Ctrl+Shift+F): the text boxes under the column headers. */
  private toggleFilters(): void {
    this.prefs.showFilters = !this.prefs.showFilters;
    this.savePrefs();
    // Typed filters stay on while the row is hidden: their funnels stay highlighted and
    // the status bar keeps the count.
    this.applyPanelVisibility();
    this.grid.render();
  }

  private applyPanelVisibility(): void {
    const f = FEATURES.filters && this.prefs.showFilters && this.schedule !== null;
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
    this.toolbar.root.classList.toggle("hidden", !(FEATURES.toolbar && this.prefs.showToolbar));
    this.toolbar.refresh();
  }

  private async saveEmbedded(): Promise<void> {
    if (!this.fileBytes) return;
    if (import.meta.env.DEV) {
      modal("Not available in dev mode", "<p>Run <code>npm run build</code> and use <code>dist/xer-viewer-v*.html</code> to save a viewer with the schedule inside.</p>");
      return;
    }
    const html = await buildEmbeddedHtml({ name: this.fileName, bytes: this.fileBytes }, this.comments, this.baselineFile);
    // A reviewer's copy is named after them, so files coming back don't overwrite each other.
    const base = this.fileName.replace(/\.xer$/i, "");
    const mine = liveComments(this.comments).some((c) => c.author === this.prefs.reviewer);
    const who = mine && this.prefs.reviewer ? ` - comments ${this.prefs.reviewer.replace(/[\\/:*?"<>|]+/g, "")}` : "";
    const fileName = `${base}${who}.html`;
    downloadText(fileName, html, "text/html");
    this.commentsDirty = false;
    try {
      const key = this.draftKey();
      if (key) localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
    this.reindexComments();
    const n = liveComments(this.comments).length;
    this.setStatus(
      `Saved ${fileName} (${(html.length / 1_048_576).toFixed(1)} MB)` +
        (n ? ` with ${n} comment${n === 1 ? "" : "s"}` : "") +
        (this.baselineFile ? ` and the baseline ${this.baselineFile.name}` : "") +
        `. Send that one file: it opens straight to this schedule.`,
    );
  }

  // ---------- Column filter popup ----------

  /** The header funnel: values come from the activities the other filters leave in. */
  private openColumnFilter(key: string, anchor: HTMLElement): void {
    const col = this.view.columns.get(key);
    const s = this.schedule;
    if (!col || !s) return;
    const ctx = this.view.ctx;
    const others: FilterState = { ...this.filterState, columns: new Map(this.filterState.columns), values: new Map(this.filterState.values) };
    others.columns.delete(key);
    others.values.delete(key);
    const test = compileFilter(others, this.view.columns, ctx, (a) => this.commentIndex.has(`activity|${a.code}`)).test;
    const byResource = this.resourceTabShown() ? this.resources.activityFilter() : null;
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
      this.grid.syncFilterValues();
      this.applyFilter();
    };
    openColumnFilter(anchor, {
      column: col,
      values,
      condition: this.filterState.columns.get(key) ?? "",
      ticked: this.filterState.values.get(key) ?? null,
      onApply: (condition, ticked) => {
        if (condition.trim()) this.filterState.columns.set(key, condition);
        else this.filterState.columns.delete(key);
        if (ticked) this.filterState.values.set(key, ticked);
        else this.filterState.values.delete(key);
        refresh();
      },
      onClear: () => {
        this.filterState.columns.delete(key);
        this.filterState.values.delete(key);
        refresh();
      },
      onSort: (dir) => {
        this.view.sort = { key, dir };
        this.rebuild();
      },
    });
  }

  // ---------- Excel export ----------

  /** The grid's columns and rows as an .xlsx: as shown, or with every WBS expanded. */
  private async exportExcel(allRows: boolean): Promise<void> {
    const s = this.schedule;
    if (!s) return;
    const ctx = this.view.ctx;
    const rows = allRows ? buildRows(s, { ...this.view, expanded: expandedAll(s) }) : this.rows;
    if (!rows.length) {
      this.setStatus("Nothing to export: no rows match the current filters.");
      return;
    }
    const p = s.projects[0];
    await this.saveXlsx(
      this.baseName() + ".xlsx",
      () =>
        buildActivitiesXlsx({
          sheetName: p?.shortName || "Activities",
          columns: this.columns().map((column) => ({ column, width: this.prefs.widths[column.key] ?? column.width })),
          rows,
          ctx,
          wbsColors,
          info: this.exportInfo(rows, allRows),
        }),
      `${rows.length.toLocaleString()} rows`,
    );
  }

  /** The open file's name without .xer. */
  private baseName(): string {
    return this.fileName.replace(/\.xer$/i, "");
  }

  /**
   * Asks where to save (Chrome and Edge) or downloads (other browsers), then writes the
   * workbook `build` makes. `what` describes it in the status bar.
   */
  private async saveXlsx(fileName: string, build: () => Promise<Uint8Array>, what: string): Promise<void> {
    let handle: FileSystemFileHandle | null = null;
    const picker = (window as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (picker) {
      try {
        handle = await picker({ suggestedName: fileName, types: [{ description: "Excel workbook", accept: { [XLSX_TYPE]: [".xlsx"] } }] });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          this.setStatus("Export cancelled.");
          return;
        }
      }
    }
    this.setStatus("Building Excel file...");
    try {
      const bytes = await build();
      if (handle) {
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        this.setStatus(`Exported ${what} to ${handle.name}.`);
      } else {
        downloadText(fileName, bytes, XLSX_TYPE);
        this.setStatus(`Exported ${what} to ${fileName} (in your Downloads folder).`);
      }
    } catch (e) {
      console.error(e);
      this.setStatus(`Excel export failed: ${(e as Error).message}`);
    }
  }

  /** Common rows for the Export Info sheet of the extra exports. */
  private infoRows(extra: [string, string][] = []): [string, string][] {
    const p = this.schedule?.projects[0];
    return [
      ["Source file", this.fileName],
      ["Project", p ? `${p.shortName} - ${p.name}` : ""],
      ["Data date", p ? formatDate(p.dataDate) : ""],
      ...extra,
      ["Exported", new Date().toLocaleString()],
      ["Exported with", `XER Viewer ${__APP_VERSION__}`],
    ];
  }

  /** Changes tab > Export to Excel: every change and the counts. */
  private async exportChanges(): Promise<void> {
    const cmp = this.cmp;
    if (!cmp) return;
    const units = { h: "Hours", d: "Days", w: "Weeks", m: "Months" } as const;
    const sheets = [
      ...changesSheets(cmp, this.view.ctx.unit),
      infoSheet(this.infoRows([
        ["Baseline", cmp.name],
        ["Baseline data date", formatDate(cmp.baseline.projects[0]?.dataDate ?? null)],
        ["Duration unit", units[this.view.ctx.unit]],
        ["Variance", "Baseline minus current, in working time on each activity's calendar: negative means later than the baseline."],
        ["Left out", "Activities that were only progressed (no other change)."],
      ])),
    ];
    await this.saveXlsx(`${this.baseName()} - changes.xlsx`, () => buildTableXlsx(sheets), "the changes");
  }

  /** Schedule Check > Export to Excel. */
  private async exportChecks(): Promise<void> {
    const results = this.healthResults();
    if (!results) return;
    const sheets = [
      ...checkSheets(results, this.view.ctx.unit),
      infoSheet(this.infoRows([["Missed activities and BEI use", this.cmp ? `the baseline (${this.cmp.name})` : "planned dates (no baseline loaded)"]])),
    ];
    await this.saveXlsx(`${this.baseName()} - schedule check.xlsx`, () => buildTableXlsx(sheets), "the schedule check");
  }

  /** Resource Spreadsheet > Export to Excel (it builds its own sheets). */
  private async exportTables(sheets: TableSheet[], name: string, what: string): Promise<void> {
    // Put the source file and project at the top of the panel's own Export Info sheet.
    sheets = sheets.map((t) => (t.name === "Export Info" ? { ...t, rows: [...infoSheet(this.infoRows()).rows.slice(0, 2), ...t.rows] } : t));
    await this.saveXlsx(`${this.baseName()} - ${name}.xlsx`, () => buildTableXlsx(sheets), what);
  }

  // ---------- Schedule Check ----------

  private healthResults(): CheckResult[] | null {
    const s = this.schedule;
    if (!s) return null;
    const cmp = this.cmp;
    if (!this.healthCache || this.healthCache.s !== s || this.healthCache.cmp !== cmp) {
      this.healthCache = { s, cmp, results: checkSchedule(s, cmp) };
    }
    return this.healthCache.results;
  }

  /** Shows only the activities a check flagged, opening the WBS they are in. */
  private pickCheck(r: CheckResult): void {
    this.filterState.check = { name: r.name, ids: r.activities };
    for (const a of r.activities) revealActivity(this.view.expanded, a);
    this.applyFilter();
    const n = r.activities.size;
    this.setStatus(`${r.name}: showing the ${n.toLocaleString()} activit${n === 1 ? "y" : "ies"} it flags. Show All Activities (or Clear Filters) to go back.`);
  }

  // ---------- Gantt bar labels ----------

  private barLabel(a: Activity): string {
    switch (FEATURES.barLabels ? this.prefs.barLabels : "none") {
      case "name": return a.name;
      case "id": return a.code;
      case "idName": return `${a.code}  ${a.name}`;
      case "finish": return formatDate(a.finish, a.finishActual);
      case "dates": return `${formatDate(a.start, a.startActual)} – ${formatDate(a.finish, a.finishActual)}`;
      default: return "";
    }
  }

  /** The "Export Info" sheet: where the rows came from and what was filtered. */
  private exportInfo(rows: GridRow[], allRows: boolean): [string, string][] {
    const f = this.filterState;
    const label = (k: string) => this.view.columns.get(k)?.label ?? k;
    const columnFilters = [
      ...[...f.columns].filter(([, v]) => v.trim()).map(([k, v]) => `${label(k)}: ${v}`),
      ...[...f.values].map(([k, v]) => {
        const list = [...v].slice(0, 15).map((t) => (t === "" ? "(Blanks)" : t));
        return `${label(k)} in [${list.join(", ")}${v.size > 15 ? `, ... ${v.size - 15} more` : ""}]`;
      }),
    ];
    const other: string[] = [];
    if (f.statuses.size) other.push("Status: " + [...f.statuses].join(", "));
    if (f.criticalOnly) other.push("Critical only");
    if (f.milestonesOnly) other.push("Milestones only");
    if (f.commentedOnly) other.push("With comments");
    if (f.from !== null || f.to !== null) other.push(`Active between ${formatDate(f.from) || "..."} and ${formatDate(f.to) || "..."}`);
    if (this.resourceTabShown() && this.resources.activityFilter()) other.push(`Resource: ${this.resources.selectionLabel()}`);
    if (f.trace) other.push(`Trace: ${describeTrace(f.trace)}`);
    if (f.changes.size) other.push(`Changes vs baseline: ${[...f.changes].join(", ")}`);
    if (f.check) other.push(`Schedule check: ${f.check.name}`);
    const p = this.schedule?.projects[0];
    const sort = this.view.sort;
    const units = { h: "Hours", d: "Days", w: "Weeks", m: "Months" } as const;
    return [
      ["Source file", this.fileName],
      ["Project", p ? `${p.shortName} - ${p.name}` : ""],
      ["Data date", p ? formatDate(p.dataDate) : ""],
      ["Exported", new Date().toLocaleString()],
      ["Rows", `${rows.length.toLocaleString()} (${rows.filter((r) => r.kind === "act").length.toLocaleString()} activities, ${allRows ? "fully expanded" : "as shown"})`],
      ["Sort", sort ? `${label(sort.key)} ${sort.dir > 0 ? "ascending" : "descending"}` : "Default (Start, Activity ID)"],
      ["Column filters", columnFilters.join("; ") || "None"],
      ["Other filters", other.join("; ") || "None"],
      ["Duration unit", units[this.view.ctx.unit]],
      ["Baseline", this.baselineFile ? this.baselineFile.name : "None"],
      ["Exported with", `XER Viewer ${__APP_VERSION__}`],
      ["Note", "Dates are exported as Excel dates; P6 actual (A) and constraint (*) markers are not carried across."],
    ];
  }

  // ---------- Baseline comparison ----------

  private get cmp(): Comparison | null {
    return this.view.ctx.cmp ?? null;
  }

  /** Compares the open schedule with the loaded baseline (if any). */
  private recompare(): void {
    const cmp = this.schedule && this.baseline && this.baselineFile ? compareSchedules(this.schedule, this.baseline, this.baselineFile.name) : null;
    this.view.ctx = { ...this.view.ctx, cmp };
  }

  /** File > Compare with Baseline: an earlier .xer, or a saved viewer .html with one inside. */
  private async openBaseline(file: File): Promise<void> {
    if (!/\.html?$/i.test(file.name)) {
      await this.setBaseline(file.name, new Uint8Array(await file.arrayBuffer()));
      return;
    }
    const embedded = await extractEmbeddedXer(await file.text()).catch(() => null);
    if (!embedded) {
      modal("Can't open baseline", `<p><b>${esc(file.name)}</b></p><p>This HTML file doesn't contain a schedule.</p>`);
      return;
    }
    await this.setBaseline(embedded.name, embedded.bytes);
  }

  async setBaseline(name: string, bytes: Uint8Array): Promise<void> {
    if (!this.schedule) return;
    const overlay = el("div", "overlay", [el("div", "box", [`Comparing with ${name}…`])]);
    document.body.append(overlay);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const baseline = loadSchedule(bytes);
      if (!baseline.activities.length) throw new XerParseError("The baseline has no activities in it.");
      const first = this.cmp === null;
      this.baseline = baseline;
      this.baselineFile = { name, bytes };
      this.recompare();
      // The first time, show the main baseline columns unless some are showing already.
      const shown = this.columns().map((c) => c.key);
      if (first && !shown.some((k) => this.view.columns.get(k)?.group === "Baseline")) {
        const at = shown.indexOf("finish");
        const add = BASELINE_DEFAULT_COLUMNS.filter((k) => this.view.columns.has(k));
        this.setColumns(at < 0 ? [...shown, ...add] : [...shown.slice(0, at + 1), ...add, ...shown.slice(at + 1)]);
      } else {
        this.applyFilter();
      }
      this.extendGanttForBaseline();
      this.grid.render();
      this.gantt.draw();
      const cmp = this.cmp!;
      const n = (k: ChangeKind) => (cmp.counts.get(k) ?? 0).toLocaleString();
      this.showBottom("changes");
      this.changesPanel.render();
      const total = cmp.changes.size;
      const matched = total - (cmp.counts.get("added") ?? 0);
      this.setStatus(
        matched < total / 2
          ? `Only ${matched.toLocaleString()} of ${total.toLocaleString()} activities have the same Activity ID in ${name}. Is it an earlier version of this project?`
          : `Compared with ${name}: ${n("added")} added, ${cmp.deleted.length.toLocaleString()} deleted, ` +
              `${n("finishLater")} finishing later, ${n("logic")} with logic changes. Details on the Changes tab.`,
      );
    } catch (e) {
      const msg = e instanceof XerParseError ? e.message : `Could not read this file: ${(e as Error).message}`;
      modal("Can't open baseline", `<p><b>${esc(name)}</b></p><p>${esc(msg)}</p>`);
    } finally {
      overlay.remove();
    }
  }

  private removeBaseline(): void {
    this.baseline = null;
    this.baselineFile = null;
    this.recompare();
    this.filterState.changes.clear();
    // Baseline columns would only be empty now; loading a baseline brings them back.
    const shown = this.columns().map((c) => c.key);
    const keep = shown.filter((k) => this.view.columns.get(k)?.group !== "Baseline");
    if (keep.length && keep.length < shown.length) this.setColumns(keep);
    else this.applyFilter();
    this.grid.render();
    this.gantt.draw();
    this.changesPanel.render();
    this.setStatus("Baseline removed.");
  }

  /** Makes room on the Gantt for baseline bars outside the schedule's own dates. */
  private extendGanttForBaseline(): void {
    const b = this.baseline;
    if (!b || !this.cmp) return;
    let first: number | null = null;
    let last: number | null = null;
    for (const r of b.roots) {
      if (r.start !== null && (first === null || r.start < first)) first = r.start;
      if (r.finish !== null && (last === null || r.finish > last)) last = r.finish;
    }
    this.gantt.extendRange(first, last);
  }

  /** The Changes tab's "Filter Activities": only this kind of change. */
  private filterChanges(kind: ChangeKind | "any"): void {
    this.filterState.changes = new Set([kind]);
    this.applyFilter();
  }

  // ---------- Trace Logic ----------

  /** Filter > Trace Logic: shows only the traced chain, expanding the WBS it runs through. */
  private setTrace(t: TraceSpec | null): void {
    this.filterState.trace = t;
    if (t) for (const a of traceLogic(t)) revealActivity(this.view.expanded, a);
    this.applyFilter();
    if (!t) return;
    const i = this.rowIndex.get(t.root);
    if (i !== undefined) {
      this.grid.scrollToIndex(i, true);
      this.select(i);
    }
    const n = traceLogic(t).size - 1;
    this.setStatus(`Tracing ${describeTrace(t)}: ${n.toLocaleString()} activit${n === 1 ? "y" : "ies"}. Filter > Trace Logic > Clear Trace to go back.`);
  }

  // ---------- Copy ----------

  /** Edit > Copy: the selected activity, or a WBS band with every row shown under it. */
  private copySelected(): void {
    const i = this.selectedIndex();
    if (i >= 0) this.copyRows(bandRows(this.rows, i));
  }

  private copyRows(rows: GridRow[]): void {
    if (!rows.length) return;
    const table = rowsToTable(rows, this.columns(), this.view.ctx, wbsColors);
    this.pendingCopy = table;
    // execCommand fires the copy event, which puts both HTML and text on the clipboard.
    const ok = document.execCommand("copy");
    if (this.pendingCopy) {
      this.pendingCopy = null;
      if (!ok) {
        void navigator.clipboard?.writeText(table.text);
      }
    }
    this.copied(rows);
  }

  private copied(rows: GridRow[]): void {
    const n = rows.length;
    this.setStatus(`Copied ${n.toLocaleString()} row${n === 1 ? "" : "s"} with the grid's columns. Paste into an email, Teams, Word or Excel.`);
  }

  /** Ctrl+C on the grid (and the Edit menu, through execCommand) copies rows as a table. */
  private installCopy(): void {
    document.addEventListener("copy", (e) => {
      let table = this.pendingCopy;
      this.pendingCopy = null;
      if (!table) {
        if (!FEATURES.copyRows || !this.schedule) return;
        // Leave normal copying alone: text boxes, selected text, dialogs.
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("input, textarea, select, .modal-back")) return;
        if (window.getSelection()?.toString()) return;
        const i = this.selectedIndex();
        if (i < 0) return;
        const rows = bandRows(this.rows, i);
        table = rowsToTable(rows, this.columns(), this.view.ctx, wbsColors);
        this.copied(rows);
      }
      e.clipboardData?.setData("text/plain", table.text);
      e.clipboardData?.setData("text/html", table.html);
      e.preventDefault();
    });
  }

  // ---------- Calendars ----------

  private openCalendars(): void {
    const s = this.schedule;
    if (!s) return;
    const sel = this.selected;
    const cal = sel ? (isActivity(sel) ? sel.calendar : sel.calendar) : null;
    const dd = s.projects[0]?.dataDate;
    showCalendars(s, cal, new Date(dd ?? Date.now()).getUTCFullYear());
  }


  // ---------- Keyboard, drag & drop, status ----------

  private installKeys(): void {
    window.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === "F1") {
        e.preventDefault(); // instead of the browser's own help page
        if (!document.querySelector(".modal-back")) showUserGuide();
      } else if (ctrl && k === "o") {
        e.preventDefault();
        this.fileInput.click();
      } else if (ctrl && k === "e" && FEATURES.excelExport && this.schedule) {
        e.preventDefault();
        void this.exportExcel(true);
      } else if (ctrl && k === "s" && FEATURES.embedSave && this.schedule) {
        e.preventDefault();
        void this.saveEmbedded();
      } else if (ctrl && k === "m" && FEATURES.comments && this.schedule && this.selected) {
        e.preventDefault();
        void this.addComment(this.selected);
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
        const what = this.schedule
          ? "Drop a .xer to open it, or reviewers' saved .html files to add their comments"
          : "Drop a .xer, or a saved viewer .html, to open it";
        overlay = el("div", "overlay drop", [el("div", "box", [what])]);
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
      const files = [...(e.dataTransfer?.files ?? [])];
      const html = files.filter((f) => /\.html?$/i.test(f.name));
      // Several reviewers' files dropped onto an open schedule: import all their comments.
      if (this.schedule && html.length > 1) void this.importComments(html);
      else if (files[0]) void this.openFile(files[0]);
    });
  }

  private buildWelcome(): HTMLElement {
    const open = el("button", "btn primary", ["Open .xer file..."]);
    open.addEventListener("click", () => this.fileInput.click());
    const guide = el("a", "welcome-help", ["How to use it (F1)"]);
    guide.href = "#";
    guide.addEventListener("click", (e) => {
      e.preventDefault();
      showUserGuide();
    });
    return el("div", "welcome", [
      el("div", "card", [
        el("h1", "", ["XER Viewer"]),
        el("p", "", ["View a Primavera P6 schedule without P6."]),
        open,
        el("p", "", ["or drag and drop a .xer file anywhere on this window"]),
        el("p", "note", ["Your file stays on this computer. Nothing is uploaded."]),
        el("p", "note", [`Version ${__APP_VERSION__}`]),
        guide,
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
