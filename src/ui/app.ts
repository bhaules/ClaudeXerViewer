// Wires the model, grid, Gantt, panels, menus and keyboard together.
// Menus, comments, filters, exports and the baseline live in app-*.ts as functions taking the App.
import { extractEmbeddedXer, type EmbeddedFile } from "../embed";
import { FEATURES } from "../features";
import { loadSchedule } from "../xer";
import { BASELINE_DEFAULT_COLUMNS, COLUMN_BY_KEY, COLUMNS, scheduleColumns, type Column } from "../xer/columns";
import { type CopiedTable } from "../xer/clipboard";
import { type ChangeKind, type Comparison } from "../xer/compare";
import { extractCommentsFromHtml, liveComments, type ReviewComment } from "../xer/comments";
import { formatDate, isMilestone } from "../xer/format";
import { emptyFilter, type CompiledFilter, type FilterState } from "../xer/filter";
import { type Activity, type Relationship, type Schedule, type Wbs } from "../xer/model";
import { groupByCode, shownSchedule, type Grouping } from "../xer/group";
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
import { CommentsPanel } from "./comments";
import { MenuBar } from "./menu";
import { RelationsPanel } from "./relations";
import { ResourcePanel } from "./resources";
import { ChangesPanel } from "./changes";
import { DetailsPanel } from "./details";
import { HealthPanel } from "./health";
import { ResourceSpreadsheet } from "./spreadsheet";
import { startUpdateChecks, updateBar } from "./update";
import { type CheckResult } from "../xer/health";
import { showCalendars } from "./calendars";
import { showUserGuide } from "./help";
import { Search } from "./search";
import { ROW_HEIGHT } from "./theme";
import { Toolbar } from "./toolbar";
import { PREFS_KEY, type BottomTab, DEFAULT_PREFS, loadPrefs, isActivity, rowKey } from "./app-shared";
import {
  fileMenu,
  editMenu,
  viewMenu,
  toolItems,
  filterMenu,
  helpMenu,
  headerMenu,
  reviewMenu,
  rowMenu,
} from "./app-menus";
import {
  addComment,
  editComment,
  deleteComment,
  replyTo,
  deleteReply,
  toggleDone,
  importComments,
  loadComments,
} from "./app-comments";
import {
  applyFilter,
  setViewFilter,
  toggleFilters,
  openFunnel,
  healthResults,
  pickCheck,
  filterChanges,
} from "./app-filters";
import {
  saveEmbedded,
  exportExcel,
  exportChanges,
  exportChecks,
  exportTables,
  copyKey,
  installCopy,
} from "./app-export";
import { recompare, openBaseline, removeBaseline, extendGanttForBaseline } from "./app-baseline";

/**
 * The app state and the core of the wiring. Members are public so the app-*.ts modules
 * (menus, comments, filters, exports, baseline) can use them; nothing outside src/ui should.
 */
export class App {
  schedule: Schedule | null = null;
  /** View > Group By: bands by an activity code instead of WBS, or null. */
  grouping: Grouping | null = null;
  fileName = "";
  fileBytes: Uint8Array | null = null;
  prefs = loadPrefs();
  view: ViewState = {
    expanded: new Set(),
    hideEmptyWbs: this.prefs.hideEmptyWbs,
    sort: null,
    ctx: { unit: this.prefs.unit },
    columns: new Map(COLUMNS.map((c) => [c.key, c])),
    filter: null,
  };
  rows: GridRow[] = [];
  rowIndex = new Map<Activity | Wbs, number>();
  selected: Activity | Wbs | null = null;
  /** Relationships the Gantt draws, per View > Relationship Lines. */
  relLines: Relationship[] = [];

  grid: Grid;
  gantt: Gantt;
  preds: RelationsPanel;
  succs: RelationsPanel;
  search: Search;
  menu: MenuBar;
  toolbar!: Toolbar;
  workspace: HTMLElement;
  welcome: HTMLElement;
  status = el("div", "left");
  statusRight = el("div", "right");
  /** "Filter on: showing n of m" while anything is filtered (its own slot, so selecting a row can't hide it). */
  statusFilter = el("div", "filter-note hidden");
  bottom: HTMLElement;
  bottomSplit: HTMLElement;
  resources: ResourcePanel;
  resSplit: HTMLElement;
  sideSplit: HTMLElement;
  fileInput: HTMLInputElement;
  appRoot: HTMLElement;
  filterState: FilterState = emptyFilter();
  compiled: CompiledFilter = { test: null, errors: new Set() };
  filterTimer: ReturnType<typeof setTimeout> | undefined;
  /** The filter without `extras`. */
  baseFilter: ((a: Activity) => boolean) | null = null;
  /** Activities outside the filter shown because the user jumped to them, until it is reapplied (like P6). */
  extras = new Set<Activity>();
  /** In a saved viewer file: what it contains, which a refresh brings back. */
  ownBytes: Uint8Array | null = null;
  /** A saved copy someone was sent: it never checks for updates. */
  savedCopy = false;
  ownBaseline: Uint8Array | null = null;
  /** All review comments, including deleted ones (kept so merges can't revive them). */
  comments: ReviewComment[] = [];
  /** targetKey -> [open, done] counts of live comments. */
  commentIndex = new Map<string, [number, number]>();
  /** Comments changed since the last save. */
  commentsDirty = false;
  commentsPanel!: CommentsPanel;
  commentsTab: HTMLElement | null = null;
  importInput!: HTMLInputElement;
  /** File > Compare with Baseline: the baseline file and its parsed schedule. */
  baselineFile: EmbeddedFile | null = null;
  baseline: Schedule | null = null;
  baselineInput!: HTMLInputElement;
  changesPanel!: ChangesPanel;
  details!: DetailsPanel;
  health!: HealthPanel;
  spreadsheet!: ResourceSpreadsheet;
  /** Schedule Check results for the open schedule and baseline. */
  healthCache: { s: Schedule; cmp: Comparison | null; results: CheckResult[] } | null = null;
  /** Rows waiting for the copy event (Edit menu copies go through execCommand). */
  pendingCopy: CopiedTable | null = null;

  constructor(mount: HTMLElement) {
    this.grid = new Grid({
      rows: () => this.rows,
      columns: () => this.columns(),
      width: (k) => this.prefs.widths[k] ?? this.view.columns.get(k)?.width ?? 100,
      setWidth: (k, w) => {
        this.prefs.widths[k] = w;
        this.savePrefsSoon();
      },
      sort: () => this.view.sort,
      sortable: FEATURES.sorting,
      ctx: () => this.view.ctx,
      expanded: (id) => this.view.expanded.has(id),
      selectedIndex: () => this.selectedIndex(),
      isHit: (r) => r.kind === "act" && this.search.isHit(r.act),
      onSort: (k) => this.toggleSort(k),
      onHeaderMenu: (k, x, y, cell) => headerMenu(this, k, x, y, cell),
      filterRow: () => FEATURES.filters && this.prefs.showFilters,
      filterValue: (k) => this.filterState.columns.get(k) ?? "",
      filterError: (k) => this.compiled.errors.has(k),
      columnFilter: FEATURES.filters
        ? {
            active: (k) => !!this.filterState.columns.get(k)?.trim() || this.filterState.values.has(k),
            open: (k, anchor) => openFunnel(this, k, anchor),
          }
        : null,
      onFilterInput: (k, v) => {
        this.filterState.columns.set(k, v);
        // Typing re-filters 13k+ activities; wait for a pause.
        clearTimeout(this.filterTimer);
        this.filterTimer = setTimeout(() => applyFilter(this), 200);
      },
      onToggle: (i) => this.toggle(i),
      onSelect: (i) => this.select(i),
      onActivate: (i) => this.activate(i),
      // The scrollTop setters ignore equal values, so the echo scroll event stops the loop.
      onScroll: (top) => (this.gantt.scrollTop = top),
      commentBadge: (r) => (FEATURES.comments ? this.commentIndex.get(rowKey(r)) ?? null : null),
      onRowMenu: (i, x, y) => rowMenu(this, i, x, y),
      onMoveColumn: (key, before) => this.moveColumn(key, before),
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
      onContextMenu: (i, x, y) => rowMenu(this, i, x, y),
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

    this.gantt.setTimescale(this.prefs.timescale);

    const unit = () => this.view.ctx.unit;
    const nav = (a: Activity) => this.goTo(a);
    this.preds = new RelationsPanel("Predecessors", unit, FEATURES.relationshipNavigation, nav);
    this.succs = new RelationsPanel("Successors", unit, FEATURES.relationshipNavigation, nav);

    this.search = new Search({
      activities: () => (this.schedule ? activitiesInDisplayOrder(this.shown(), this.view) : []),
      current: () => (this.selected && isActivity(this.selected) ? this.selected : null),
      goTo: (a) => this.goTo(a),
      onHitsChanged: () => this.grid.render(),
    });

    this.menu = new MenuBar([
      { label: "File", items: () => fileMenu(this) },
      { label: "Edit", items: () => editMenu(this) },
      { label: "View", items: () => viewMenu(this) },
      ...(FEATURES.filters ? [{ label: "Filter", items: () => filterMenu(this) }] : []),
      ...(FEATURES.comments ? [{ label: "Review", items: () => reviewMenu(this) }] : []),
      { label: "Help", items: () => helpMenu(this) },
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
        onSelectionChange: () => applyFilter(this),
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
      onEdit: (c) => void editComment(this, c),
      onDelete: (c) => deleteComment(this, c),
      onToggleDone: (c) => void toggleDone(this, c),
      onReply: (c) => void replyTo(this, c),
      onDeleteReply: (c, id) => deleteReply(this, c, id),
      onAddGeneral: () => void addComment(this, null),
      onImport: () => this.importInput.click(),
    });
    const cmRow = el("div", "brow", [this.commentsPanel.root]);

    this.changesPanel = new ChangesPanel({
      comparison: () => this.cmp,
      unit: () => this.view.ctx.unit,
      goTo: (a) => this.goTo(a),
      onCompare: () => this.baselineInput.click(),
      onRemove: () => removeBaseline(this),
      onFilter: (k) => filterChanges(this, k),
      onExport: () => void exportChanges(this),
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
      onExport: (sheets, what) => void exportTables(this, sheets, "resource usage", what),
      onSettingsChange: (s) => {
        this.prefs.spreadsheet = s;
        this.savePrefs();
      },
    }, this.prefs.spreadsheet);
    const ssRow = el("div", "brow", [this.spreadsheet.root]);

    this.health = new HealthPanel({
      results: () => healthResults(this),
      active: () => (this.filterState.check ? healthResults(this)?.find((r) => r.name === this.filterState.check!.name)?.id ?? null : null),
      source: () => (this.cmp ? `the baseline (${this.cmp.name})` : "planned dates (no baseline loaded)"),
      onPick: (r) => pickCheck(this, r),
      onClear: () => {
        this.filterState.check = null;
        applyFilter(this);
      },
      onExport: () => void exportChecks(this),
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
      if (files.length) void importComments(this, files);
    });

    // File > Compare with Baseline: an earlier .xer (or saved viewer) to compare with.
    this.baselineInput = el("input");
    this.baselineInput.type = "file";
    this.baselineInput.accept = ".xer,.html,.htm";
    this.baselineInput.className = "hidden";
    this.baselineInput.addEventListener("change", () => {
      const f = this.baselineInput.files?.[0];
      this.baselineInput.value = "";
      if (f) void openBaseline(this, f);
    });

    this.toolbar = new Toolbar(toolItems(this));
    this.appRoot = mount;
    mount.append(
      this.menu.root,
      this.toolbar.root,
      updateBar(),
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
    installCopy(this);
    // Refreshing or closing loses an opened .xer (the browser can't reopen it by itself) and
    // unsaved comments: warn first. The browser words the question.
    window.addEventListener("pagehide", () => this.savePrefs()); // a pending savePrefsSoon
    window.addEventListener("beforeunload", (e) => {
      if (!this.commentsDirty && !this.losesFiles()) return;
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    });
    this.setStatus("Ready");
  }

  dragStart = 0;

  /** This page is a saved copy whose own schedule (and baseline) is now open. */
  markSavedCopy(): void {
    this.savedCopy = true;
    this.ownBytes = this.fileBytes;
    this.ownBaseline = this.baselineFile?.bytes ?? null;
  }

  /** True when a refresh would lose the open schedule or baseline. */
  losesFiles(): boolean {
    if (!this.schedule) return false;
    return this.fileBytes !== this.ownBytes || (this.baselineFile !== null && this.baselineFile.bytes !== this.ownBaseline);
  }

  /**
   * Checks for a newer version now, and again every so often while the page stays open, if
   * it's on. Not in the dev server, which is always ahead of the releases.
   */
  checkForUpdate(): void {
    if (FEATURES.updateCheck && this.prefs.updateCheck && !this.savedCopy && !import.meta.env.DEV) {
      startUpdateChecks(() => this.prefs.updateCheck);
    }
  }

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
      await importComments(this, [file]);
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
    let parsed = false;
    try {
      const t0 = performance.now();
      const schedule = loadSchedule(bytes);
      if (schedule.activities.length === 0 && schedule.roots.length === 0) {
        throw new XerParseError("The file has no WBS or activities in it.");
      }
      parsed = true;
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
      this.view.columns = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
      this.grouping = this.makeGrouping(schedule);
      this.view.expanded = expandedToLevel(shownSchedule(schedule, this.grouping), FEATURES.defaultExpandLevel);
      // A loaded baseline stays: compare the newly opened file with it.
      recompare(this);
      this.updateRelLines();
      const recovered = loadComments(this, comments);
      this.search.refresh();
      this.welcome.classList.add("hidden");
      this.workspace.classList.remove("hidden");
      this.applyPanelVisibility();
      this.grid.syncFilterValues();
      // A new file starts unfiltered; this also resets the status bar and toolbar.
      applyFilter(this);
      let first: number | null = null;
      let last: number | null = null;
      for (const r of schedule.roots) {
        if (r.start !== null && (first === null || r.start < first)) first = r.start;
        if (r.finish !== null && (last === null || r.finish > last)) last = r.finish;
      }
      this.gantt.setRange(first, last);
      extendGanttForBaseline(this);
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
      console.error(e);
      const msg = e instanceof XerParseError ? e.message : `Could not read this file: ${(e as Error).message}`;
      if (parsed) {
        // The file was fine; showing it went wrong, and the window may be half updated.
        modal(
          "Something went wrong",
          `<p>${esc(name)} was read, but showing it failed: ${esc((e as Error).message)}</p><p>Refresh the page (F5) and open it again.</p>`,
        );
      } else modal("Can't open file", `<p><b>${esc(name)}</b></p><p>${esc(msg)}</p>`);
    } finally {
      overlay.remove();
    }
  }

  updateTitle(): void {
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
  columns(): Column[] {
    const cols = this.prefs.columns.map((k) => this.view.columns.get(k)).filter((c): c is Column => !!c);
    return cols.length ? cols : DEFAULT_PREFS.columns.map((k) => COLUMN_BY_KEY.get(k)!);
  }

  rebuild(): void {
    if (!this.schedule) return;
    this.rows = buildRows(this.shown(), this.view);
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
  rebuildKeepingSelection(): void {
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

  selectedIndex(): number {
    return this.selected ? this.rowIndex.get(this.selected) ?? -1 : -1;
  }

  select(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    this.selected = row.kind === "wbs" ? row.wbs : row.act;
    window.getSelection()?.removeAllRanges(); // so Ctrl+C copies this row, not old text
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
      const w = row.wbs;
      const what = w.group ? `${w.group.label} ${w.code || "(blank)"}` : `WBS ${w.fullCode}`;
      this.setStatus(`${what} – ${w.name} (${w.activityCount.toLocaleString()} activities)`);
    }
  }

  /** The bottom panel's Activity Details (Relationships, General, ...) follow the selection. */
  showDetails(item: Activity | Wbs | null): void {
    if (!this.prefs.showRelations) return;
    const a = item && isActivity(item) ? item : null;
    this.preds.show(a);
    this.succs.show(a);
    this.details.show(item);
  }

  toggle(i: number): void {
    const row = this.rows[i];
    if (row?.kind !== "wbs") return;
    if (this.view.expanded.has(row.wbs.id)) this.view.expanded.delete(row.wbs.id);
    else this.view.expanded.add(row.wbs.id);
    this.selected = row.wbs;
    this.rebuild();
    this.grid.focus();
  }

  activate(i: number): void {
    if (this.rows[i]?.kind === "wbs") this.toggle(i);
  }

  /** Expands the activity's WBS, selects it and scrolls it into the middle of the view. */
  goTo(a: Activity): void {
    // Like P6: an activity the filter hides is shown anyway, until the filter is reapplied.
    const hidden = this.view.filter !== null && !this.view.filter(a);
    if (hidden) {
      this.extras.add(a);
      setViewFilter(this);
    }
    revealActivity(this.view.expanded, a, this.grouping?.bandOf);
    this.rebuild();
    const i = this.rowIndex.get(a);
    if (i === undefined) return;
    this.grid.scrollToIndex(i, true);
    this.select(i);
    this.gantt.reveal(a);
    if (hidden || this.extras.has(a)) {
      this.setStatus(`${a.code} is outside the current filter. It's shown until the filter is reapplied.`, true);
    }
  }

  /** Zooms the Gantt so the row's bar fills the middle of the chart. */
  zoomToRow(i: number): void {
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

  toggleSort(key: string): void {
    const s = this.view.sort;
    // Ascending -> descending -> back to the default order.
    this.view.sort = s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null;
    this.rebuild();
  }

  clearSort(): void {
    this.view.sort = null;
    this.rebuild();
  }


  updateRelLines(): void {
    const all = this.schedule?.relationships ?? [];
    const mode = FEATURES.ganttRelationships ? this.prefs.relLines : "none";
    this.relLines = mode === "all" ? all : mode === "driving" ? all.filter((r) => r.driving) : [];
  }

  setExpanded(set: Set<string>): void {
    this.view.expanded = set;
    this.rebuild();
  }

  // ---------- Columns ----------

  openColumnsDialog(): void {
    if (!FEATURES.columnChooser) return;
    openColumnsDialog({
      available: [...this.view.columns.values()],
      selected: this.columns().map((c) => c.key),
      defaults: DEFAULT_PREFS.columns,
      onApply: (keys) => this.setColumns(keys),
    });
  }

  /** Dragging a header: column `key` goes before `before` (null: last). */
  moveColumn(key: string, before: string | null): void {
    const keys = this.columns().map((c) => c.key).filter((k) => k !== key);
    const at = before === null ? keys.length : keys.indexOf(before);
    if (at < 0) return;
    keys.splice(at, 0, key);
    this.setColumns(keys);
  }

  /** Shows these columns, in this order. */
  setColumns(keys: string[]): void {
    // Keep saved UDF and code columns this file doesn't have, so they come back for files that do.
    const missing = this.prefs.columns.filter((k) => !this.view.columns.has(k));
    this.prefs.columns = [...keys, ...missing];
    this.savePrefs();
    // A sort or filter on a removed column would be invisible; drop it.
    if (this.view.sort && !keys.includes(this.view.sort.key)) this.view.sort = null;
    for (const k of [...this.filterState.columns.keys()]) if (!keys.includes(k)) this.filterState.columns.delete(k);
    for (const k of [...this.filterState.values.keys()]) if (!keys.includes(k)) this.filterState.values.delete(k);
    this.grid.syncFilterValues();
    applyFilter(this, true);
  }

  // ---------- Bottom panel, Group By ----------

  /** View > Show on Bottom: a tab of the bottom panel, or null to hide the panel. */
  showBottom(tab: BottomTab | null): void {
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
      applyFilter(this, true); // the resource filter only applies while its tab is on screen
    }
  }

  /** The schedule as the grid and Gantt show it: by WBS, or the Group By bands. */
  shown(): Schedule {
    return shownSchedule(this.schedule!, this.grouping);
  }

  /** The Group By bands for the saved choice, or null (WBS) when this file lacks that code. */
  makeGrouping(s: Schedule): Grouping | null {
    const t = this.prefs.groupBy ? s.codeTypes.find((c) => c.label === this.prefs.groupBy) : undefined;
    return t ? groupByCode(s, t) : null;
  }

  /** The activity code type a code column shows, if `key` is one. */
  codeTypeOfColumn(key: string) {
    const m = /^code(?:desc)?:(.*)$/.exec(key);
    return m ? this.schedule?.codeTypes.find((t) => t.label === m[1]) : undefined;
  }

  /** View > Group By: "" for WBS, or an activity code type's name. Opens every band. */
  setGroupBy(label: string): void {
    this.prefs.groupBy = label;
    this.savePrefs();
    if (!this.schedule) return;
    this.grouping = this.makeGrouping(this.schedule);
    if (this.selected && !isActivity(this.selected)) this.selected = null;
    this.view.expanded = expandedAll(this.shown());
    applyFilter(this, true);
    this.setStatus(this.grouping ? `Grouped by ${this.grouping.type.label}.` : "Grouped by WBS.");
  }

  /** Selects a WBS band, expanding its parents. */
  goToWbs(w: Wbs): void {
    for (let p = w.parent; p; p = p.parent) this.view.expanded.add(p.id);
    this.rebuild();
    const i = this.rowIndex.get(w);
    if (i === undefined) {
      this.setStatus(
        this.grouping
          ? `WBS ${w.fullCode} isn't shown while grouped by ${this.grouping.type.label} (View > Group By > WBS).`
          : `WBS ${w.fullCode} is hidden by the current filter.`,
        true,
      );
      return;
    }
    this.grid.scrollToIndex(i, true);
    this.select(i);
  }

  // ---------- Filters ----------

  resourceTabShown(): boolean {
    return FEATURES.resourceHistogram && FEATURES.relationships && this.prefs.showRelations && this.prefs.bottomTab === "resources";
  }

  setBottomTab(tab: BottomTab): void {
    this.prefs.bottomTab = tab;
    this.savePrefs();
    this.applyBottomTab();
    // The resource filter only applies while its tab is on screen.
    applyFilter(this, true);
  }

  applyBottomTab(): void {
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
  syncResourceListWidth(): void {
    this.resources.listPane.style.width = `${this.grid.root.getBoundingClientRect().width}px`;
  }

  applyPanelVisibility(): void {
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

  // ---------- Gantt bar labels ----------

  barLabel(a: Activity): string {
    switch (FEATURES.barLabels ? this.prefs.barLabels : "none") {
      case "name": return a.name;
      case "id": return a.code;
      case "idName": return `${a.code}  ${a.name}`;
      case "finish": return formatDate(a.finish, a.finishActual);
      case "dates": return `${formatDate(a.start, a.startActual)} – ${formatDate(a.finish, a.finishActual)}`;
      default: return "";
    }
  }

  // ---------- Baseline comparison ----------

  get cmp(): Comparison | null {
    return this.view.ctx.cmp ?? null;
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
      recompare(this);
      // The first time, show the main baseline columns unless some are showing already.
      const shown = this.columns().map((c) => c.key);
      if (first && !shown.some((k) => this.view.columns.get(k)?.group === "Baseline")) {
        const at = shown.indexOf("finish");
        const add = BASELINE_DEFAULT_COLUMNS.filter((k) => this.view.columns.has(k));
        this.setColumns(at < 0 ? [...shown, ...add] : [...shown.slice(0, at + 1), ...add, ...shown.slice(at + 1)]);
      } else {
        applyFilter(this);
      }
      extendGanttForBaseline(this);
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

  // ---------- Calendars ----------

  openCalendars(): void {
    const s = this.schedule;
    if (!s) return;
    const sel = this.selected;
    const cal = sel?.calendar ?? null;
    const dd = s.projects[0]?.dataDate;
    showCalendars(s, cal, new Date(dd ?? Date.now()).getUTCFullYear());
  }


  // ---------- Keyboard, drag & drop, status ----------

  installKeys(): void {
    window.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (document.querySelector(".modal-back")) {
        // A dialog is open: don't open another one or act on the window behind it. Ctrl+O/S/E
        // are swallowed so the browser's own Open / Save / mail commands don't run either.
        if ((ctrl && ["o", "s", "e", "m"].includes(k)) || e.key === "F1") e.preventDefault();
        return;
      }
      if (e.key === "F1") {
        e.preventDefault(); // instead of the browser's own help page
        showUserGuide();
      } else if (ctrl && k === "o") {
        e.preventDefault();
        this.fileInput.click();
      } else if (ctrl && k === "e" && FEATURES.excelExport && this.schedule) {
        e.preventDefault();
        void exportExcel(this, true);
      } else if (ctrl && k === "s" && FEATURES.embedSave && this.schedule) {
        e.preventDefault();
        void saveEmbedded(this);
      } else if (ctrl && k === "c" && !e.shiftKey && !e.altKey && copyKey(this)) {
        e.preventDefault();
      } else if (ctrl && k === "m" && FEATURES.comments && this.schedule && this.selected) {
        e.preventDefault();
        void addComment(this, this.selected);
      } else if (ctrl && e.shiftKey && k === "f" && FEATURES.filters && this.schedule) {
        e.preventDefault();
        toggleFilters(this);
      } else if (ctrl && k === "f" && FEATURES.search && this.schedule) {
        e.preventDefault();
        this.search.open();
      } else if (e.key === "F3" && FEATURES.search && this.schedule) {
        e.preventDefault();
        this.search.find(e.shiftKey ? -1 : 1);
      }
    });
  }

  installDrop(): void {
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
      if (this.schedule && html.length > 1) void importComments(this, html);
      else if (files[0]) void this.openFile(files[0]);
    });
  }

  buildWelcome(): HTMLElement {
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

  /** `alert` makes it red and bold, e.g. when a row is outside the filter. */
  setStatus(text: string, alert = false): void {
    this.status.textContent = text;
    this.status.classList.toggle("alert", alert);
  }

  prefsTimer = 0;

  /** For changes that come in a stream (dragging): saves once they stop. */
  savePrefsSoon(): void {
    clearTimeout(this.prefsTimer);
    this.prefsTimer = window.setTimeout(() => this.savePrefs(), 400);
  }

  savePrefs(): void {
    clearTimeout(this.prefsTimer);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Private windows can block storage; preferences just won't persist.
    }
  }
}
