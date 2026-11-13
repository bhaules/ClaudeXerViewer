// Resource Usage tab: resource list (left, under the grid) and a histogram (right,
// lined up under the Gantt's timescale), like P6's Resource Usage Profile.
import { valueTest } from "../xer/filter";
import { formatDate, formatNumber } from "../xer/format";
import type { Activity, Resource, Schedule } from "../xer/model";
import { buildUsageProfile, toManning, usageBetween, type UsageProfile } from "../xer/usage";
import { el, esc } from "./dom";
import { floorTo, labelFor, next, type GanttView, type Unit } from "./gantt";
import { GANTT } from "./theme";

const DAY = 86_400_000;
const AXIS_H = 18;
const TOP_PAD = 16;
const ALL = "__all__";

/** One colour per resource when several are shown (distinct, readable on white). */
const PALETTE = [
  "#2e7dd7", "#e8833a", "#3aa655", "#d64545", "#8e5cc4", "#c9a227",
  "#1fa5a5", "#d45fa0", "#6b7b8c", "#7fae2e", "#b5652b", "#4655c4",
];

const UNIT_NAMES: Record<Unit, string> = { year: "year", quarter: "quarter", month: "month", week: "week", day: "day" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ResourcePanelHost {
  schedule(): Schedule | null;
  /** Null while the Gantt is hidden (there's no timescale to line up with). */
  ganttView(): GanttView | null;
  dataDate(): number | null;
  /** Selection or the "show only these activities" box changed. */
  onSelectionChange(): void;
  /** Histogram settings changed (to save them). */
  onSettingsChange(s: HistogramSettings): void;
  /** "Fit project" button: zoom the Gantt (and so the histogram) to the whole project. */
  onFit(): void;
}

export interface HistogramSettings {
  /** Bar period; "auto" follows the Gantt's lower timescale tier. */
  interval: Unit | "auto";
  /** Show average people instead of hours. */
  manning: boolean;
  /** Hours one person works per week (P6's "divide interval totals by" for weekly bars). */
  hoursPerWeek: number;
}

export const DEFAULT_HISTOGRAM: HistogramSettings = { interval: "week", manning: false, hoursPerWeek: 70 };

const INTERVALS: [HistogramSettings["interval"], string][] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
  ["quarter", "Quarter"],
  ["auto", "Follow Gantt zoom"],
];

/** Resource list columns (after the colour swatch): sortable, each with a filter box. */
const LIST_COLUMNS: { label: string; kind: "text" | "number"; value: (r: Resource) => string | number }[] = [
  { label: "Resource ID", kind: "text", value: (r) => r.code },
  { label: "Resource Name", kind: "text", value: (r) => r.name },
  { label: "Type", kind: "text", value: (r) => r.type },
  { label: "Budgeted Units", kind: "number", value: (r) => r.budget },
  { label: "Actual Units", kind: "number", value: (r) => r.actual },
  { label: "Remaining Units", kind: "number", value: (r) => r.remaining },
];

interface DrawnBucket {
  x0: number;
  x1: number;
  start: number;
  /** Day range covered (for converting hours to manning). */
  d0: number;
  d1: number;
  unit: Unit;
  values: [Resource, number, number][]; // resource, actual hours, remaining hours
}

export class ResourcePanel {
  readonly listPane: HTMLElement;
  readonly chartPane: HTMLElement;
  /** Selected resource ids; null means all resources. */
  selection: Set<string> | null = null;
  filterActivities = true;

  private table = el("div", "rel-body");
  private listTable = el("table", "res-table");
  private headRow = el("tr");
  private listBody = el("tbody");
  private empty = el("div", "rel-empty hidden");
  /** Resource list sort (column index into LIST_COLUMNS, or null for file order). */
  private sortCol: number | null = null;
  private sortDir: 1 | -1 = 1;
  /** Filter box text per LIST_COLUMNS index. */
  private listFilters: string[] = LIST_COLUMNS.map(() => "");
  private listFilterTimer: ReturnType<typeof setTimeout> | undefined;
  private filterBox: HTMLInputElement;
  private canvas = el("canvas");
  private tip = el("div", "hist-tip hidden");
  private message = el("div", "hist-msg hidden");
  private profile: UsageProfile | null = null;
  private profileFor: Schedule | null = null;
  private maxCache = new Map<string, number>();
  private drawn: DrawnBucket[] = [];

  constructor(
    private host: ResourcePanelHost,
    private settings: HistogramSettings,
  ) {
    this.filterBox = el("input");
    this.filterBox.type = "checkbox";
    this.filterBox.checked = true;
    this.filterBox.addEventListener("change", () => {
      this.filterActivities = this.filterBox.checked;
      this.host.onSelectionChange();
    });

    // Histogram settings, like P6's Resource Usage Profile Options.
    const interval = el("select");
    interval.innerHTML = INTERVALS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    interval.value = settings.interval;
    interval.title = "Period each bar covers. Stays the same when you zoom the Gantt.";
    interval.addEventListener("change", () => this.changeSettings({ interval: interval.value as HistogramSettings["interval"] }));

    const manning = el("input");
    manning.type = "checkbox";
    manning.checked = settings.manning;
    const perWeek = el("input");
    perWeek.type = "number";
    perWeek.min = "1";
    perWeek.step = "1";
    perWeek.value = String(settings.hoursPerWeek);
    perWeek.className = "res-num";
    perWeek.title = "Hours one person works per week (e.g. 70 for 7 x 10h days)";
    perWeek.disabled = !settings.manning;
    manning.addEventListener("change", () => {
      perWeek.disabled = !manning.checked;
      this.changeSettings({ manning: manning.checked });
    });
    perWeek.addEventListener("input", () => {
      const v = Number(perWeek.value);
      if (v > 0) this.changeSettings({ hoursPerWeek: v });
    });

    const fit = el("button", "btn res-fit", ["Fit project"]);
    fit.title = "Zoom the Gantt and histogram to show the whole project";
    fit.addEventListener("click", () => this.host.onFit());

    const footer = el("div", "res-foot", [
      el("label", "res-row", [this.filterBox, "Show only activities that use the selected resources"]),
      el("div", "res-row", [
        el("span", "", ["Bars by"]),
        interval,
        el("span", "fb-sep"),
        el("label", "res-row", [manning, "Manning: hours ÷"]),
        perWeek,
        el("span", "", ["per person-week"]),
        fit,
      ]),
    ]);
    const filterRow = el("tr", "res-filters", [el("th")]);
    LIST_COLUMNS.forEach((c, i) => {
      const input = el("input");
      input.type = "text";
      input.dataset.i = String(i);
      input.placeholder = c.kind === "number" ? ">0" : "Filter";
      input.title = c.kind === "number" ? "e.g. >1000, <=0, =500" : "Contains text. =x exact, <>x excludes";
      filterRow.append(el("th", "", [input]));
    });
    filterRow.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      this.listFilters[Number(input.dataset.i)] = input.value;
      clearTimeout(this.listFilterTimer);
      this.listFilterTimer = setTimeout(() => this.applyListFilter(), 150);
    });
    filterRow.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const input = e.target as HTMLInputElement;
      input.value = "";
      this.listFilters[Number(input.dataset.i)] = "";
      this.applyListFilter();
    });
    this.headRow.addEventListener("click", (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>("th[data-c]");
      if (!th) return;
      const c = Number(th.dataset.c);
      // Ascending -> descending -> the file's order, like the activity grid.
      if (this.sortCol !== c) [this.sortCol, this.sortDir] = [c, 1];
      else if (this.sortDir === 1) this.sortDir = -1;
      else this.sortCol = null;
      this.renderList();
    });
    this.listTable.append(el("thead", "", [this.headRow, filterRow]), this.listBody);
    this.table.append(this.listTable, this.empty);
    this.listPane = el("div", "pane res-list", [this.table, footer]);
    this.chartPane = el("div", "pane hist-pane", [this.canvas, this.message, this.tip]);

    this.table.addEventListener("mousedown", (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-r]");
      if (!tr) return;
      e.preventDefault();
      this.select(tr.dataset.r!, e.ctrlKey || e.metaKey);
    });
    this.canvas.addEventListener("mousemove", (e) => this.showTip(e));
    this.canvas.addEventListener("mouseleave", () => this.tip.classList.add("hidden"));
    new ResizeObserver(() => this.draw()).observe(this.chartPane);
  }

  /** A new file was opened. */
  reset(): void {
    this.selection = null;
    this.sortCol = null;
    this.listFilters = LIST_COLUMNS.map(() => "");
    for (const input of this.listTable.querySelectorAll<HTMLInputElement>(".res-filters input")) input.value = "";
    this.profile = null;
    this.profileFor = null;
    this.maxCache.clear();
    this.renderList();
    this.draw();
  }

  /** Back to "All Resources" with the list unfiltered (e.g. Clear Filters). */
  selectAll(): void {
    this.selection = null;
    this.listFilters = LIST_COLUMNS.map(() => "");
    for (const input of this.listTable.querySelectorAll<HTMLInputElement>(".res-filters input")) input.value = "";
    this.renderList();
    this.draw();
  }

  /** Activity filter for the current selection, or null when nothing should be hidden. */
  activityFilter(): ((a: Activity) => boolean) | null {
    if (!this.filterActivities) return null;
    const s = this.host.schedule();
    if (!s) return null;
    // "All Resources" with the list filtered means all the resources still listed.
    const ids = this.selection ?? (this.listFiltered() ? new Set(this.listed(s).map((r) => r.id)) : null);
    if (ids === null) return null;
    return (a) => a.assignments.some((x) => ids.has(x.resource.id));
  }

  /** e.g. "CON.Civil" or "3 resources", for the filter bar. */
  selectionLabel(): string {
    const s = this.host.schedule();
    if (!s) return "";
    if (this.selection === null) return this.listFiltered() ? `${this.listed(s).length} listed resources` : "";
    if (this.selection.size === 1) return s.resources.find((r) => this.selection!.has(r.id))?.name ?? "";
    return `${this.selection.size} resources`;
  }

  private changeSettings(change: Partial<HistogramSettings>): void {
    this.settings = { ...this.settings, ...change };
    this.maxCache.clear();
    this.draw();
    this.host.onSettingsChange(this.settings);
  }

  /** Bar value for a period: hours, or average people when Manning is on. */
  private measure(hours: number, d0: number, d1: number): number {
    return this.settings.manning ? toManning(hours, d0, d1, this.settings.hoursPerWeek) : hours;
  }

  private select(id: string, toggle: boolean): void {
    if (id === ALL) this.selection = null;
    else if (toggle) {
      const set = new Set(this.selection ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      this.selection = set.size ? set : null;
    } else this.selection = new Set([id]);
    this.renderList();
    this.draw();
    this.host.onSelectionChange();
  }

  private colorOf(r: Resource, s: Schedule): string {
    return PALETTE[s.resources.indexOf(r) % PALETTE.length];
  }

  /** True when any list filter box has text. */
  private listFiltered(): boolean {
    return this.listFilters.some((f) => f.trim() !== "");
  }

  /** Resources passing the list's filter boxes, in the list's sort order. */
  private listed(s: Schedule): Resource[] {
    const tests = this.listFilters.map((f, i) => (f.trim() ? valueTest(LIST_COLUMNS[i].kind, f) : null));
    let list = s.resources.filter((r) => tests.every((t, i) => !t || t === "error" || t(LIST_COLUMNS[i].value(r))));
    if (this.sortCol !== null) {
      const col = LIST_COLUMNS[this.sortCol];
      const dir = this.sortDir;
      list = [...list].sort((x, y) => {
        const vx = col.value(x);
        const vy = col.value(y);
        const c = typeof vx === "number" && typeof vy === "number" ? vx - vy : String(vx).localeCompare(String(vy), undefined, { numeric: true });
        return c * dir;
      });
    }
    return list;
  }

  /** The list's filter boxes changed: re-list, and drop selected resources no longer listed. */
  private applyListFilter(): void {
    clearTimeout(this.listFilterTimer);
    const s = this.host.schedule();
    if (s && this.selection) {
      const listed = new Set(this.listed(s).map((r) => r.id));
      const kept = new Set([...this.selection].filter((id) => listed.has(id)));
      this.selection = kept.size ? kept : null;
    }
    this.renderList();
    this.draw();
    this.host.onSelectionChange();
  }

  private renderList(): void {
    const s = this.host.schedule();
    const none = !s || !s.resources.length;
    this.listTable.classList.toggle("hidden", none);
    this.empty.classList.toggle("hidden", !none);
    this.empty.textContent = s ? "No resources are assigned in this file." : "";
    this.headRow.innerHTML =
      `<th></th>` +
      LIST_COLUMNS.map(
        (c, i) =>
          `<th data-c="${i}" title="Click to sort">${c.label}${i === this.sortCol ? `<span class="sort">${this.sortDir === 1 ? "▲" : "▼"}</span>` : ""}</th>`,
      ).join("");
    for (const input of this.listTable.querySelectorAll<HTMLInputElement>(".res-filters input")) {
      const f = this.listFilters[Number(input.dataset.i)];
      input.classList.toggle("bad", !!f.trim() && valueTest(LIST_COLUMNS[Number(input.dataset.i)].kind, f) === "error");
    }
    if (none) {
      this.listBody.innerHTML = "";
      return;
    }
    const list = this.listed(s);
    const units = (r: { type?: string }, v: number) => formatNumber(v, 0) + (r.type === "Labor" ? "h" : "");
    const allLabor = list.every((r) => r.type === "Labor");
    const sum = (k: "budget" | "actual" | "remaining") => list.reduce((n, r) => n + r[k], 0);
    const count = list.length === s.resources.length ? `${list.length}` : `${list.length} of ${s.resources.length}`;
    const allRow =
      `<tr data-r="${ALL}" class="res-all${this.selection === null ? " sel" : ""}"><td></td><td colspan="3">All Resources (${count})</td>` +
      ["budget", "actual", "remaining"].map((k) => `<td class="r">${units({ type: allLabor ? "Labor" : "" }, sum(k as "budget"))}</td>`).join("") +
      `</tr>`;
    const rows = list
      .map((r) => {
        const sel = this.selection?.has(r.id) ? " sel" : "";
        return (
          `<tr data-r="${esc(r.id)}" class="${sel}"><td><span class="sw" style="background:${this.colorOf(r, s)}"></span></td>` +
          `<td>${esc(r.code)}</td><td title="${esc(r.name)}">${esc(r.name)}</td><td>${esc(r.type)}</td>` +
          `<td class="r">${units(r, r.budget)}</td><td class="r">${units(r, r.actual)}</td><td class="r">${units(r, r.remaining)}</td></tr>`
        );
      })
      .join("");
    this.listBody.innerHTML = allRow + (rows || `<tr><td></td><td colspan="6" class="res-none">No resources match the filter.</td></tr>`);
  }

  private shown(s: Schedule): Resource[] {
    return this.selection === null ? this.listed(s) : s.resources.filter((r) => this.selection!.has(r.id));
  }

  /** Redraws the histogram for the Gantt's current zoom and scroll. */
  draw(): void {
    const s = this.host.schedule();
    const view = this.host.ganttView();
    const w = this.chartPane.clientWidth;
    const h = this.chartPane.clientHeight;
    this.drawn = [];
    this.tip.classList.add("hidden"); // its numbers would be stale
    let msg = "";
    if (!s) msg = " ";
    else if (!s.resources.length) msg = "No resources are assigned in this file.";
    else if (!view || view.width === 0) msg = "Turn on View > Gantt Chart to see the histogram (it shares the Gantt's timescale).";
    this.message.textContent = msg.trim();
    this.message.classList.toggle("hidden", !msg.trim());
    this.canvas.classList.toggle("hidden", !!msg);
    if (msg || !s || !view || w === 0 || h === 0) return;

    if (this.profileFor !== s) {
      this.profile = buildUsageProfile(s, this.host.dataDate());
      this.profileFor = s;
      this.maxCache.clear();
    }
    const profile = this.profile!;
    const resources = this.shown(s);
    const single = this.selection !== null && resources.length === 1;
    // Bars use the chosen interval (weekly even when the Gantt is squeezed to fit the
    // project); the axis labels follow the Gantt's own tier so they stay readable.
    const unit: Unit = this.settings.interval === "auto" ? view.unit : this.settings.interval;
    const labelUnit = view.unit;

    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const ctx = this.canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "11px 'Segoe UI', Tahoma, Arial, sans-serif";
    ctx.textBaseline = "middle";

    const dateToX = (ms: number) => ((ms - view.start) / DAY) * view.pixelsPerDay - view.scrollLeft;
    const xToDate = (x: number) => view.start + ((x + view.scrollLeft) / view.pixelsPerDay) * DAY;
    const plotTop = TOP_PAD;
    const plotBottom = h - AXIS_H;
    const plotH = Math.max(10, plotBottom - plotTop);

    // A fixed scale for the whole project (for this zoom and selection), so bars don't
    // change height as you scroll.
    const key = `${unit}|${this.settings.manning ? this.settings.hoursPerWeek : "h"}|${resources.map((r) => r.id).join(",")}`;
    let max = this.maxCache.get(key);
    if (max === undefined) {
      max = 0;
      const end = (profile.firstDay + profile.dayCount) * DAY;
      for (let t = floorTo(profile.firstDay * DAY, unit); t < end; t = next(t, unit)) {
        const d0 = Math.floor(t / DAY);
        const d1 = Math.floor(next(t, unit) / DAY);
        let total = 0;
        for (const r of resources) total += usageBetween(profile, r.id, "actual", d0, d1) + usageBetween(profile, r.id, "remaining", d0, d1);
        max = Math.max(max, this.measure(total, d0, d1));
      }
      this.maxCache.set(key, max);
    }
    const step = niceStep((max || 1) / 4);
    const yMax = Math.max(step, Math.ceil(max / step) * step);
    const yOf = (v: number) => plotBottom - (v / yMax) * plotH;

    // Grid lines.
    ctx.strokeStyle = "#ececec";
    ctx.lineWidth = 1;
    for (let v = step; v <= yMax + 1e-9; v += step) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Bars.
    const from = xToDate(0);
    const to = xToDate(w);
    for (let t = floorTo(from, unit); t < to; t = next(t, unit)) {
      const tEnd = next(t, unit);
      const x0 = dateToX(t);
      const x1 = dateToX(tEnd);
      const d0 = Math.floor(t / DAY);
      const d1 = Math.floor(tEnd / DAY);
      const gap = x1 - x0 > 4 ? 1 : 0;
      const values: [Resource, number, number][] = [];
      let y = plotBottom;
      for (const r of resources) {
        const act = usageBetween(profile, r.id, "actual", d0, d1);
        const rem = usageBetween(profile, r.id, "remaining", d0, d1);
        values.push([r, act, rem]);
        const color = single ? GANTT.remaining : this.colorOf(r, s);
        const actColor = single ? GANTT.actual : shade(color, 0.35);
        for (const [v, c] of [[act, actColor], [rem, color]] as const) {
          if (v <= 0) continue;
          const hgt = (this.measure(v, d0, d1) / yMax) * plotH;
          ctx.fillStyle = c;
          ctx.fillRect(x0 + gap, y - hgt, Math.max(1, x1 - x0 - gap), hgt);
          y -= hgt;
        }
      }
      this.drawn.push({ x0, x1, start: t, d0, d1, unit, values });
    }

    // Data date.
    const dd = this.host.dataDate();
    if (dd !== null) {
      const x = Math.round(dateToX(dd)) + 0.5;
      ctx.strokeStyle = GANTT.dataDate;
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // Timescale strip along the bottom.
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, plotBottom, w, AXIS_H);
    ctx.strokeStyle = GANTT.headerLine;
    ctx.beginPath();
    ctx.moveTo(0, plotBottom + 0.5);
    ctx.lineTo(w, plotBottom + 0.5);
    ctx.stroke();
    ctx.fillStyle = GANTT.headerText;
    for (let t = floorTo(from, labelUnit); t < to; t = next(t, labelUnit)) {
      const x0 = dateToX(t);
      const x1 = dateToX(next(t, labelUnit));
      const xl = Math.round(x0) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xl, plotBottom);
      ctx.lineTo(xl, h);
      ctx.stroke();
      const label = labelFor(t, labelUnit, x1 - x0);
      const tw = ctx.measureText(label).width;
      if (label && x1 - x0 > tw + 4) ctx.fillText(label, x0 + (x1 - x0 - tw) / 2, plotBottom + AXIS_H / 2 + 1);
    }

    // Y axis labels, over a soft background so bars stay readable behind them.
    const allLabor = resources.every((r) => r.type === "Labor");
    const what = this.settings.manning
      ? `Manning per ${UNIT_NAMES[unit]} (${formatNumber(this.settings.hoursPerWeek, 1)} h per person-week)`
      : `${allLabor ? "Hours" : "Units"} per ${UNIT_NAMES[unit]}`;
    const title = what + (single ? ` – ${resources[0].name}` : "");
    const decimals = this.settings.manning && yMax < 10 ? 1 : 0;
    const labels: [string, number][] = [];
    for (let v = 0; v <= yMax + 1e-9; v += step) labels.push([formatNumber(v, decimals), yOf(v)]);
    const labelW = Math.max(...labels.map(([l]) => ctx.measureText(l).width)) + 8;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, 0, labelW, plotBottom);
    ctx.fillStyle = "#555";
    for (const [l, y] of labels) ctx.fillText(l, labelW - 4 - ctx.measureText(l).width, Math.min(plotBottom - 6, Math.max(6, y)));
    ctx.font = "600 11px 'Segoe UI', Tahoma, Arial, sans-serif";
    const tw = ctx.measureText(title).width;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(labelW + 2, 1, tw + 8, 14);
    ctx.fillStyle = "#333";
    ctx.fillText(title, labelW + 6, 8);
  }

  private showTip(e: MouseEvent): void {
    const s = this.host.schedule();
    const b = this.drawn.find((d) => e.offsetX >= d.x0 && e.offsetX < d.x1);
    if (!s || !b) {
      this.tip.classList.add("hidden");
      return;
    }
    const total = b.values.reduce((n, [, a, r]) => n + a + r, 0);
    const single = this.selection !== null && b.values.length === 1;
    const manning = this.settings.manning;
    const show = (hours: number) => formatNumber(this.measure(hours, b.d0, b.d1), 1);
    const rows = b.values
      .filter(([, a, r]) => a + r > 0.005)
      .map(([res, a, r]) => {
        const color = single ? GANTT.remaining : this.colorOf(res, s);
        return `<tr><td><span class="sw" style="background:${color}"></span>${esc(res.name)}</td><td class="r">${show(a)}</td><td class="r">${show(r)}</td></tr>`;
      })
      .join("");
    // In manning mode the total also gives the hours behind it.
    const totalText = manning ? `${show(total)} people (${formatNumber(total, 0)}h)` : `${formatNumber(total, 1)}h`;
    this.tip.innerHTML =
      `<div class="tt-head">${esc(periodLabel(b.start, b.unit))}</div>` +
      (rows
        ? `<table><tr><th></th><th>Actual</th><th>Remaining</th></tr>${rows}` +
          `<tr class="tt-total"><td>Total${manning ? " manning" : ""}</td><td colspan="2" class="r">${totalText}</td></tr>` +
          `</table>`
        : `<div class="tt-none">No units in this period</div>`);
    this.tip.classList.remove("hidden");
    const pw = this.chartPane.clientWidth;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(pw - tw - 4, e.offsetX + 14)}px`;
    this.tip.style.top = `${Math.max(4, e.offsetY - this.tip.offsetHeight - 8)}px`;
  }
}

/** 1, 2, 2.5 or 5 times a power of ten, at least `raw`. */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Darken a #rrggbb colour by `amount` (0-1). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function periodLabel(ms: number, unit: Unit): string {
  const d = new Date(ms);
  switch (unit) {
    case "year": return String(d.getUTCFullYear());
    case "quarter": return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case "month": return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    case "week": return `Week of ${formatDate(ms)}`;
    default: return formatDate(ms);
  }
}
