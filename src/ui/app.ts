// Wires the model, grid, Gantt, panels, menus and keyboard together.
import { buildEmbeddedHtml, downloadText, extractEmbeddedXer } from "../embed";
import { FEATURES } from "../features";
import { loadSchedule } from "../xer";
import { COLUMN_BY_KEY, COLUMNS, scheduleColumns, type Column } from "../xer/columns";
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
import { formatDate, type DurationUnit } from "../xer/format";
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
import { buildActivitiesXlsx, XLSX_TYPE } from "../xer/xlsx";
import { el, esc, modal, splitter } from "./dom";
import { openColumnFilter } from "./column-filter";
import { openColumnsDialog } from "./columns-dialog";
import { Gantt } from "./gantt";
import { Grid } from "./grid";
import { askReviewerName, CommentsPanel, describeTarget, editCommentDialog } from "./comments";
import { MenuBar, popupMenu, type MenuItem } from "./menu";
import { RelationsPanel } from "./relations";
import { DEFAULT_HISTOGRAM, ResourcePanel, type HistogramSettings } from "./resources";
import { filterMenuItems } from "./filter-menu";
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
  histogram: HistogramSettings;
  /** Name shown on review comments made in this browser. */
  reviewer: string;
}

type BottomTab = "relationships" | "resources" | "comments";

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
  bottomTab: "relationships",
  histogram: DEFAULT_HISTOGRAM,
  reviewer: "",
};

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    const prefs = { ...DEFAULT_PREFS, ...saved };
    prefs.histogram = { ...DEFAULT_HISTOGRAM, ...saved.histogram };
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

    const tabs: [BottomTab, string, HTMLElement][] = [
      ["relationships", "Relationships", relRow],
      ["resources", "Resource Usage", resRow],
      ["comments", "Comments", cmRow],
    ];
    const tabStrip = el("div", "btabs");
    for (const [id, label, body] of tabs) {
      if (id === "resources" && !FEATURES.resourceHistogram) continue;
      if (id === "comments" && !FEATURES.comments) continue;
      const tab = el("div", "btab", [label]);
      tab.dataset.tab = id;
      tab.addEventListener("mousedown", () => this.setBottomTab(id));
      tabStrip.append(tab);
      body.dataset.tab = id;
      if (id === "comments") this.commentsTab = tab;
    }

    this.bottom = el("div", "bottom", [tabStrip, relRow, resRow, cmRow]);
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
    );
    this.applyPanelVisibility();
    this.installKeys();
    this.installDrop();
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
      this.view.expanded = expandedToLevel(schedule, FEATURES.defaultExpandLevel);
      this.view.columns = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
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
      this.grid.scrollTop = 0;
      this.gantt.scrollTop = 0;
      this.showRelations(null);
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
      const tabs: [BottomTab, string][] = [["relationships", "Relationships"]];
      if (FEATURES.resourceHistogram) tabs.push(["resources", "Resource Usage"]);
      if (FEATURES.comments) tabs.push(["comments", "Comments"]);
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
      items.push(
        {
          label: "Zoom",
          enabled: loaded,
          items: () => [
            { label: "Zoom In", key: "Ctrl+Wheel", action: () => this.gantt.zoom(1.5) },
            { label: "Zoom Out", action: () => this.gantt.zoom(1 / 1.5) },
            { label: "Zoom to Fit", action: () => this.gantt.fit() },
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
      { label: `Your Name${this.prefs.reviewer ? `: ${this.prefs.reviewer}` : ""}...`, action: () => void this.ensureReviewer(true) },
    ];
  }

  private rowMenu(i: number, x: number, y: number): void {
    if (!FEATURES.comments) return;
    const row = this.rows[i];
    if (!row) return;
    const item = row.kind === "wbs" ? row.wbs : row.act;
    const counts = this.commentIndex.get(rowKey(row));
    const items: MenuItem[] = [{ label: "Add Comment...", key: "Ctrl+M", action: () => void this.addComment(item) }];
    if (counts) items.push({ label: `Show Comments (${counts[0] + counts[1]})`, action: () => this.showCommentsTab() });
    if (row.kind === "wbs") {
      items.push("-", { label: this.view.expanded.has(row.wbs.id) ? "Collapse" : "Expand", action: () => this.toggle(i) });
    }
    popupMenu(items, x, y);
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
      const sel = this.selected;
      this.showRelations(sel && isActivity(sel) ? sel : null);
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
    this.filterStatus(test ? shown : null, byResource ? this.resources.selectionLabel() : "");
    this.toolbar.refresh();
  }

  /**
   * While anything is filtered the status bar says so and how many activities show, so
   * nothing is ever filtered out of sight. `shown` is null when unfiltered; `resource`
   * names the Resource Usage selection when that is filtering too.
   */
  private filterStatus(shown: number | null, resource = ""): void {
    const total = this.schedule?.activities.length ?? 0;
    this.statusFilter.classList.toggle("hidden", shown === null);
    this.statusFilter.textContent =
      shown === null
        ? ""
        : `Filter on${resource ? ` (resource: ${resource})` : ""}: showing ${shown.toLocaleString()} of ${total.toLocaleString()} activities`;
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
      (t === "resources" && !FEATURES.resourceHistogram) || (t === "comments" && !FEATURES.comments) ? "relationships" : t;
    for (const n of this.bottom.querySelectorAll<HTMLElement>("[data-tab]")) {
      if (n.classList.contains("btab")) n.classList.toggle("active", n.dataset.tab === tab);
      else n.classList.toggle("hidden", n.dataset.tab !== tab);
    }
    if (tab === "resources") {
      this.syncResourceListWidth();
      this.resources.draw();
    }
    if (tab === "comments") this.commentsPanel.render();
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
    const html = await buildEmbeddedHtml({ name: this.fileName, bytes: this.fileBytes }, this.comments);
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
    const fileName = this.fileName.replace(/\.xer$/i, "") + ".xlsx";
    // Chrome and Edge can ask where to save; other browsers download it.
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
      const p = s.projects[0];
      const bytes = await buildActivitiesXlsx({
        sheetName: p?.shortName || "Activities",
        columns: this.columns().map((column) => ({ column, width: this.prefs.widths[column.key] ?? column.width })),
        rows,
        ctx,
        wbsColors,
        info: this.exportInfo(rows, allRows),
      });
      if (handle) {
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        this.setStatus(`Exported ${rows.length.toLocaleString()} rows to ${handle.name}.`);
      } else {
        downloadText(fileName, bytes, XLSX_TYPE);
        this.setStatus(`Exported ${rows.length.toLocaleString()} rows to ${fileName} (in your Downloads folder).`);
      }
    } catch (e) {
      console.error(e);
      this.setStatus(`Excel export failed: ${(e as Error).message}`);
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
      ["Exported with", `XER Viewer ${__APP_VERSION__}`],
      ["Note", "Dates are exported as Excel dates; P6 actual (A) and constraint (*) markers are not carried across."],
    ];
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
