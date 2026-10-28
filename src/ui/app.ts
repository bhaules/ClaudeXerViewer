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
import { askReviewerName, CommentsPanel, describeTarget, editCommentDialog } from "./comments";
import { MenuBar, popupMenu, type MenuItem } from "./menu";
import { RelationsPanel } from "./relations";
import { DEFAULT_HISTOGRAM, ResourcePanel, type HistogramSettings } from "./resources";
import { FilterBar } from "./filterbar";
import { showAbout, showShortcuts, showUserGuide } from "./help";
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
  showGantt: FEATURES.gantt,
  showRelations: FEATURES.relationships,
  relLines: FEATURES.ganttRelationships ? "driving" : "none",
  showFilters: FEATURES.filters,
  bottomTab: "relationships",
  histogram: DEFAULT_HISTOGRAM,
  reviewer: "",
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
      this.filterBar.sync();
      this.filterBar.setCount(0, 0, false);
      this.resources.reset();
      this.view.expanded = expandedToLevel(schedule, FEATURES.defaultExpandLevel);
      this.view.columns = new Map(scheduleColumns(schedule).map((c) => [c.key, c]));
      this.updateRelLines();
      const recovered = this.loadComments(comments);
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
    if (!this.prefs.showRelations) {
      this.prefs.showRelations = true;
      this.applyPanelVisibility();
    }
    this.setBottomTab("comments");
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
