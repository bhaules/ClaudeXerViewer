// Canvas Gantt chart. Draws only the rows in view; vertical scroll is synced with the grid.
import { formatDate, isMilestone } from "../xer/format";
import type { Activity, Relationship } from "../xer/model";
import type { GridRow } from "../xer/rows";
import { el } from "./dom";
import { GANTT, HEADER_HEIGHT, ROW_HEIGHT } from "./theme";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN_PPD = 0.15;
const MAX_PPD = 80;

export interface GanttHost {
  rows(): GridRow[];
  /** Relationship lines to draw (already filtered to the user's choice). */
  relationships(): Relationship[];
  rowOf(a: Activity): number | undefined;
  selectedIndex(): number;
  dataDate(): number | null;
  onSelect(index: number): void;
  /** Double-click on a row: the app zooms to its bar. */
  onDoubleClick(index: number): void;
  /** Right-click: on a row, or -1 for the empty area and the timescale. */
  onContextMenu(index: number, x: number, y: number): void;
  onScroll(scrollTop: number): void;
  /** Baseline [start, finish] for a row, or null; only called while showBaseline() is true. */
  baseline(row: GridRow): [number | null, number | null] | null;
  /** A baseline is loaded: bars move up and the baseline bar is drawn under them. */
  showBaseline(): boolean;
  /** Text drawn to the right of an activity's bar (View > Bar Labels), or "". */
  barLabel(a: Activity): string;
  /** After every redraw (scroll, zoom, resize). */
  onDraw?(): void;
}

export interface GanttView {
  /** ms at x = 0 of the full (unscrolled) chart. */
  start: number;
  pixelsPerDay: number;
  scrollLeft: number;
  width: number;
  /** The lower timescale tier; the histogram buckets by it. */
  unit: Unit;
}

export type Unit = "year" | "quarter" | "month" | "week" | "day";

/** View > Timescale: the two header tiers, or Auto to follow the zoom. */
export type Timescale = "auto" | "yearQuarter" | "yearMonth" | "monthWeek" | "weekDay";

export const TIMESCALES: [Timescale, string][] = [
  ["auto", "Auto (follows the zoom)"],
  ["yearQuarter", "Year / Quarter"],
  ["yearMonth", "Year / Month"],
  ["monthWeek", "Month / Week"],
  ["weekDay", "Week / Day"],
];

const TIERS: Record<Exclude<Timescale, "auto">, [Unit, Unit]> = {
  yearQuarter: ["year", "quarter"],
  yearMonth: ["year", "month"],
  monthWeek: ["month", "week"],
  weekDay: ["week", "day"],
};

const UNIT_DAYS: Record<Unit, number> = { year: 365.25, quarter: 91.31, month: 30.44, week: 7, day: 1 };
/** Narrowest period worth its own label. Narrower ones are labelled every 2nd, 3rd, ... with room for a full label. */
const MIN_LABEL: Record<Unit, number> = { year: 30, quarter: 42, month: 12, week: 24, day: 15 };
const FULL_LABEL: Record<Unit, number> = { year: 30, quarter: 42, month: 72, week: 64, day: 15 };
/** Mouse travel before a press becomes a drag. */
const DRAG_START = 5;

export class Gantt {
  readonly root: HTMLElement;
  private headCanvas = el("canvas");
  private canvas = el("canvas");
  private scroller: HTMLElement;
  private spacer = el("div", "gantt-spacer");
  private view: HTMLElement;
  private head: HTMLElement;
  private start = 0;
  private end = 0;
  private ppd = 3; // pixels per day
  /** View > Timescale. */
  private timescale: Timescale = "auto";
  /** Tiers held since a drag, so stretching doesn't switch weeks to months; until the next zoom. */
  private held: [Unit, Unit] | null = null;
  private frame = 0;
  /** scrollTop last set by the scrollTop setter (syncing to the grid), until its echo arrives. */
  private syncedTop: number | null = null;

  constructor(private host: GanttHost) {
    this.scroller = el("div", "gantt-scroll", [this.spacer]);
    this.view = el("div", "gantt-view", [this.canvas, this.scroller]);
    this.head = el("div", "gantt-head", [this.headCanvas]);
    this.root = el("div", "pane gantt-pane", [this.head, this.view]);

    let lastTop = 0;
    this.scroller.addEventListener("scroll", () => {
      this.draw();
      // Horizontal scrolling fires this too; only report real vertical moves, or a
      // stale scrollTop would be pushed onto the grid.
      const top = this.scroller.scrollTop;
      if (top === lastTop) return;
      lastTop = top;
      // Our position was just set to match the grid: don't echo it back. The echo can
      // arrive a frame late, mid smooth-scroll, and would drag the grid backwards.
      if (this.syncedTop !== null && Math.abs(top - this.syncedTop) < 1) {
        this.syncedTop = null;
        return;
      }
      this.syncedTop = null;
      this.host.onScroll(top);
    });
    this.scroller.addEventListener("mousedown", (e) => {
      if (e.offsetX >= this.scroller.clientWidth || e.offsetY >= this.scroller.clientHeight) return; // on a scrollbar
      const i = this.rowAt(e);
      if (i >= 0) this.host.onSelect(i);
      this.startStretch(e);
    });
    this.head.addEventListener("mousedown", (e) => this.startStretch(e));
    for (const area of [this.scroller, this.head]) {
      area.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.host.onContextMenu(area === this.scroller ? this.rowAt(e) : -1, e.clientX, e.clientY);
      });
    }
    this.scroller.addEventListener("dblclick", (e) => {
      const i = this.rowAt(e);
      if (i >= 0) this.host.onDoubleClick(i);
    });
    this.scroller.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX);
      },
      { passive: false },
    );
    new ResizeObserver(() => this.draw()).observe(this.view);
  }

  /** Sets the date range from the schedule and fits it to the visible width. */
  setRange(start: number | null, end: number | null): void {
    const s = start ?? Date.now();
    const e = end ?? s + 365 * DAY;
    this.start = s - 30 * DAY;
    this.end = e + 60 * DAY;
    this.fit();
  }

  fit(): void {
    this.held = null;
    const width = this.scroller.clientWidth || 600;
    this.ppd = clamp(width / ((this.end - this.start) / DAY), MIN_PPD, MAX_PPD);
    this.update();
    this.scroller.scrollLeft = 0;
  }

  zoom(factor: number, anchorX = this.scroller.clientWidth / 2): void {
    this.held = null;
    const anchorDate = this.xToDate(this.scroller.scrollLeft + anchorX);
    this.ppd = clamp(this.ppd * factor, MIN_PPD, MAX_PPD);
    this.update();
    this.scroller.scrollLeft = this.dateToX(anchorDate) - anchorX;
  }

  /**
   * Zooms so the range fills about 60% of the chart and centres it (double-click a row).
   * Short or zero-length ranges (milestones) get a two-week window.
   */
  focusRange(start: number, finish: number): void {
    this.held = null;
    const w = this.scroller.clientWidth || 600;
    const span = Math.max(finish - start, 14 * DAY);
    const mid = (start + finish) / 2;
    // Widen the chart's range if the bar sits outside it (e.g. a baseline bar).
    this.start = Math.min(this.start, mid - span);
    this.end = Math.max(this.end, mid + span);
    this.ppd = clamp((w * 0.6) / (span / DAY), MIN_PPD, MAX_PPD);
    this.update();
    this.scroller.scrollLeft = Math.max(0, this.dateToX(mid) - w / 2);
  }

  /** Widens the date range (e.g. to take in a baseline) without changing the zoom. */
  extendRange(start: number | null, end: number | null): void {
    const left = this.xToDate(this.scroller.scrollLeft);
    if (start !== null) this.start = Math.min(this.start, start - 30 * DAY);
    if (end !== null) this.end = Math.max(this.end, end + 60 * DAY);
    this.update();
    this.scroller.scrollLeft = this.dateToX(left);
  }

  scrollToDate(ms: number): void {
    this.scroller.scrollLeft = Math.max(0, this.dateToX(ms) - this.scroller.clientWidth / 3);
  }

  /** Scrolls sideways only if the bar's start is off screen. */
  reveal(a: Activity): void {
    const t = a.start ?? a.finish;
    if (t === null) return;
    const x = this.dateToX(t);
    const left = this.scroller.scrollLeft;
    const w = this.scroller.clientWidth;
    if (x < left + 20 || x > left + w - 40) this.scroller.scrollLeft = Math.max(0, x - w / 4);
  }

  get scrollTop(): number {
    return this.scroller.scrollTop;
  }

  /** Sync from the grid. Doesn't report back via onScroll (see the scroll handler). */
  set scrollTop(v: number) {
    if (Math.abs(this.scroller.scrollTop - v) < 1) return;
    this.scroller.scrollTop = v;
    this.syncedTop = this.scroller.scrollTop; // may be clamped
  }

  /** Call after rows change. */
  update(): void {
    this.spacer.style.width = `${Math.ceil(((this.end - this.start) / DAY) * this.ppd)}px`;
    this.spacer.style.height = `${this.host.rows().length * ROW_HEIGHT}px`;
    this.draw();
  }

  draw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.drawHeader();
      this.drawBody();
      this.host.onDraw?.();
    });
  }

  /** The visible timescale, so other charts (the resource histogram) can line up with it. */
  timeline(): GanttView {
    return {
      start: this.start,
      pixelsPerDay: this.ppd,
      scrollLeft: this.scroller.scrollLeft,
      width: this.scroller.clientWidth,
      unit: this.labelledUnit(),
    };
  }

  setTimescale(t: Timescale): void {
    this.timescale = t;
    this.held = null;
    this.draw();
  }

  /**
   * Drag left / right on the chart or the timescale to make periods narrower / wider. The
   * date grabbed stays under where it was pressed, and the tiers (e.g. weeks) don't change.
   */
  private startStretch(e: MouseEvent): void {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startPpd = this.ppd;
    const anchorX = startX - this.scroller.getBoundingClientRect().left;
    const anchorDate = this.xToDate(this.scroller.scrollLeft + anchorX);
    let dragging = false;
    const move = (ev: MouseEvent) => {
      if (!(ev.buttons & 1)) return up();
      const dx = ev.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_START) return;
        dragging = true;
        this.held = this.tiers();
        document.body.classList.add("stretching");
      }
      this.ppd = clamp(startPpd * Math.exp(dx / 220), MIN_PPD, MAX_PPD);
      this.update();
      this.scroller.scrollLeft = this.dateToX(anchorDate) - anchorX;
    };
    const up = () => {
      document.body.classList.remove("stretching");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  private dateToX(ms: number): number {
    return ((ms - this.start) / DAY) * this.ppd;
  }

  private xToDate(x: number): number {
    return this.start + (x / this.ppd) * DAY;
  }

  private rowAt(e: MouseEvent): number {
    const i = Math.floor((e.offsetY + this.scroller.scrollTop) / ROW_HEIGHT);
    return i < this.host.rows().length ? i : -1;
  }

  /** The lower tier, or the next unit up while its periods are too narrow to label each one. */
  private labelledUnit(): Unit {
    const order: Unit[] = ["day", "week", "month", "quarter", "year"];
    let i = order.indexOf(this.tiers()[1]);
    while (i < order.length - 1 && UNIT_DAYS[order[i]] * this.ppd < 6) i++;
    return order[i];
  }

  /**
   * The periods of a tier that get a line and label, as [start, end) in view. When periods
   * are too narrow to label, only every 2nd, 3rd, ... one, counted from a fixed point so
   * the labels don't jump while scrolling.
   */
  private periods(unit: Unit, from: number, to: number): [number, number][] {
    const width = UNIT_DAYS[unit] * this.ppd;
    const step = width >= MIN_LABEL[unit] ? 1 : Math.ceil(FULL_LABEL[unit] / width);
    const out: [number, number][] = [];
    let t = floorTo(from - (step - 1) * UNIT_DAYS[unit] * DAY, unit);
    while (periodIndex(t, unit) % step !== 0) t = floorTo(t - 1, unit);
    while (t < to) {
      let end = t;
      for (let k = 0; k < step; k++) end = next(end, unit);
      out.push([t, end]);
      t = end;
    }
    return out;
  }

  private tiers(): [Unit, Unit] {
    if (this.held) return this.held;
    if (this.timescale !== "auto") return TIERS[this.timescale];
    if (this.ppd < 0.6) return ["year", "quarter"];
    if (this.ppd < 4) return ["year", "month"];
    if (this.ppd < 18) return ["month", "week"];
    return ["week", "day"];
  }

  private prepare(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  private drawHeader(): void {
    const w = this.head.clientWidth;
    // The header grows when the grid's filter row is shown; the timescale keeps the
    // top HEADER_HEIGHT and the strip below it stays blank so the rows still line up.
    const total = Math.max(HEADER_HEIGHT, this.head.clientHeight) - 1;
    const h = HEADER_HEIGHT - 1;
    const ctx = this.prepare(this.headCanvas, w, total);
    const g = ctx.createLinearGradient(0, 0, 0, total);
    g.addColorStop(0, "#fafafa");
    g.addColorStop(1, "#e9e9e9");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, total);
    if (total > h) {
      ctx.strokeStyle = GANTT.headerLine;
      ctx.beginPath();
      ctx.moveTo(0, h + 0.5);
      ctx.lineTo(w, h + 0.5);
      ctx.stroke();
    }
    ctx.font = "11px 'Segoe UI', Tahoma, Arial, sans-serif";
    ctx.textBaseline = "middle";

    const left = this.scroller.scrollLeft;
    const from = this.xToDate(left);
    const to = this.xToDate(left + w);
    const [top, bottom] = this.tiers();
    const half = Math.floor(h / 2);

    const tier = (unit: Unit, y0: number, y1: number) => {
      ctx.strokeStyle = GANTT.headerLine;
      ctx.fillStyle = GANTT.headerText;
      for (const [t, end] of this.periods(unit, from, to)) {
        const x0 = Math.round(this.dateToX(t) - left) + 0.5;
        const x1 = this.dateToX(end) - left;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0, y1);
        ctx.stroke();
        const label = labelFor(t, unit, x1 - x0);
        if (label) {
          const tw = ctx.measureText(label).width;
          if (x1 - x0 > tw + 6) {
            // Centre in the visible part of the period so labels stay readable while scrolling.
            const lx = clamp((Math.max(x0, 0) + Math.min(x1, w) - tw) / 2, x0 + 3, x1 - tw - 3);
            ctx.fillText(label, lx, (y0 + y1) / 2 + 1);
          }
        }
      }
    };
    tier(top, 0, half);
    tier(bottom, half, h);
    ctx.strokeStyle = GANTT.headerLine;
    ctx.beginPath();
    ctx.moveTo(0, half + 0.5);
    ctx.lineTo(w, half + 0.5);
    ctx.stroke();
  }

  private drawBody(): void {
    const w = this.scroller.clientWidth;
    const h = this.scroller.clientHeight;
    const ctx = this.prepare(this.canvas, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);

    const rows = this.host.rows();
    const left = this.scroller.scrollLeft;
    const top = this.scroller.scrollTop;
    const first = Math.floor(top / ROW_HEIGHT);
    const last = Math.min(rows.length, Math.ceil((top + h) / ROW_HEIGHT));

    // Vertical lines at the lower timescale tier.
    const [, bottom] = this.tiers();
    const from = this.xToDate(left);
    const to = this.xToDate(left + w);
    ctx.lineWidth = 1;
    for (const [t] of this.periods(bottom, from, to)) {
      const x = Math.round(this.dateToX(t) - left) + 0.5;
      ctx.strokeStyle = GANTT.gridLine;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    const sel = this.host.selectedIndex();
    if (sel >= first && sel < last) {
      ctx.fillStyle = GANTT.selection;
      ctx.fillRect(0, sel * ROW_HEIGHT - top, w, ROW_HEIGHT);
    }

    const dd = this.host.dataDate();
    const bl = this.host.showBaseline();
    // With a baseline, bars move up a little and the baseline bar runs underneath.
    const lift = bl ? -3 : 0;
    for (let i = first; i < last; i++) {
      const y = i * ROW_HEIGHT - top;
      ctx.strokeStyle = "#f1f1f1";
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_HEIGHT - 0.5);
      ctx.lineTo(w, y + ROW_HEIGHT - 0.5);
      ctx.stroke();
      const row = rows[i];
      if (bl) this.drawBaseline(ctx, row, y, left);
      if (row.kind === "wbs") this.drawSummary(ctx, row.wbs.start, row.wbs.finish, y + lift, left);
      else this.drawActivity(ctx, row.act, y + lift, left, dd);
    }

    this.drawRelationships(ctx, w, h, left, top, dd);
    this.drawLabels(ctx, rows, first, last, w, left, top, lift);

    if (dd !== null) {
      const x = Math.round(this.dateToX(dd) - left) + 0.5;
      ctx.strokeStyle = GANTT.dataDate;
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }

  /**
   * Relationship lines between rows that are both expanded into view. Driving lines are
   * solid, others dashed; red when both ends are critical. Lines touching the selected
   * activity are drawn last and thicker.
   */
  private drawRelationships(ctx: CanvasRenderingContext2D, w: number, h: number, left: number, top: number, dd: number | null): void {
    const sel = this.host.selectedIndex();
    const later: [Relationship, number[]][] = [];
    const half = ROW_HEIGHT / 2 + (this.host.showBaseline() ? -3 : 0);

    for (const r of this.host.relationships()) {
      const i = this.host.rowOf(r.pred);
      const j = this.host.rowOf(r.succ);
      if (i === undefined || j === undefined) continue;
      const y0 = i * ROW_HEIGHT - top + half;
      const y1 = j * ROW_HEIGHT - top + half;
      if (Math.max(y0, y1) < -ROW_HEIGHT || Math.min(y0, y1) > h + ROW_HEIGHT) continue;
      const pts = this.relPath(r, y0, y1, left, dd);
      if (!pts) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        minX = Math.min(minX, pts[k]);
        maxX = Math.max(maxX, pts[k]);
      }
      if (maxX < -10 || minX > w + 10) continue;
      if (i === sel || j === sel) later.push([r, pts]);
      else this.strokeRel(ctx, r, pts, false);
    }
    for (const [r, pts] of later) this.strokeRel(ctx, r, pts, true);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  /** Polyline [x0, y0, x1, y1, ...] from the predecessor's anchor to the successor's, P6-style elbows. */
  private relPath(r: Relationship, y0: number, y1: number, left: number, dd: number | null): number[] | null {
    const fromFinish = r.type === "FS" || r.type === "FF";
    const toStart = r.type === "FS" || r.type === "SS";
    const x0 = this.anchorX(r.pred, fromFinish ? "finish" : "start", dd);
    const x1 = this.anchorX(r.succ, toStart ? "start" : "finish", dd);
    if (x0 === null || x1 === null) return null;
    const a = x0 - left;
    const b = x1 - left;
    const out = a + (fromFinish ? 6 : -6);
    const into = b + (toStart ? -6 : 6);
    // Single vertical leg if the line can drop straight down and then run into the bar.
    if (toStart ? out <= into : out >= into) return [a, y0, out, y0, out, y1, b, y1];
    // Otherwise go around through the gap between rows.
    const ymid = y1 + (y1 > y0 ? -ROW_HEIGHT / 2 : ROW_HEIGHT / 2);
    return [a, y0, out, y0, out, ymid, into, ymid, into, y1, b, y1];
  }

  private anchorX(a: Activity, end: "start" | "finish", dd: number | null): number | null {
    if (isMilestone(a.type)) {
      const t = a.type === "TT_Mile" ? a.start : a.finish ?? a.start;
      return t === null ? null : this.dateToX(t) + (end === "start" ? -6 : 6);
    }
    if (end === "finish") return a.finish === null ? null : this.dateToX(a.finish);
    if (a.start === null) return null;
    // An in-progress bar's remaining part starts at the data date.
    if (a.status === "InProgress" && dd !== null) return this.dateToX(clamp(dd, a.start, a.finish ?? dd));
    return this.dateToX(a.start);
  }

  private strokeRel(ctx: CanvasRenderingContext2D, r: Relationship, pts: number[], emphasis: boolean): void {
    const color = r.pred.critical && r.succ.critical ? GANTT.critical : GANTT.relationship;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = emphasis ? 2 : 1;
    ctx.setLineDash(r.driving ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(pts[0]) + 0.5, Math.round(pts[1]) + 0.5);
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(Math.round(pts[k]) + 0.5, Math.round(pts[k + 1]) + 0.5);
    ctx.stroke();

    // Arrowhead pointing along the last segment.
    const n = pts.length;
    const x = pts[n - 2];
    const y = pts[n - 1];
    const dir = Math.sign(x - pts[n - 4]) || 1;
    const s = emphasis ? 5 : 4;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y + 0.5);
    ctx.lineTo(x - dir * s, y - s + 0.5);
    ctx.lineTo(x - dir * s, y + s + 0.5);
    ctx.closePath();
    ctx.fill();
  }

  /** View > Bar Labels: text just right of each activity's bar, over a light backing so lines don't hide it. */
  private drawLabels(ctx: CanvasRenderingContext2D, rows: GridRow[], first: number, last: number, w: number, left: number, top: number, lift: number): void {
    ctx.font = "11px 'Segoe UI', Tahoma, Arial, sans-serif";
    ctx.textBaseline = "middle";
    for (let i = first; i < last; i++) {
      const row = rows[i];
      if (row.kind !== "act") continue;
      const a = row.act;
      const text = this.host.barLabel(a);
      if (!text) continue;
      let end: number | null;
      if (isMilestone(a.type)) {
        const t = a.type === "TT_Mile" ? a.start : a.finish ?? a.start;
        end = t === null ? null : this.dateToX(t) + 7;
      } else {
        end = a.finish === null ? null : this.dateToX(a.finish);
      }
      if (end === null) continue;
      const x = Math.max(end - left, this.dateToX(a.start ?? a.finish ?? 0) - left) + 4;
      if (x > w) continue;
      const y = i * ROW_HEIGHT - top + ROW_HEIGHT / 2 + lift;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.fillRect(x - 1, y - 7, tw + 2, 14);
      ctx.fillStyle = GANTT.label;
      ctx.fillText(text, x, y + 0.5);
    }
  }

  /** P6's baseline bar: a thin yellow bar under the current one (a small diamond for milestones). */
  private drawBaseline(ctx: CanvasRenderingContext2D, row: GridRow, y: number, left: number): void {
    const b = this.host.baseline(row);
    if (!b) return;
    const [s, f] = b;
    const top = y + ROW_HEIGHT - 7;
    ctx.fillStyle = GANTT.baseline;
    ctx.strokeStyle = GANTT.baselineEdge;
    const milestone = row.kind === "act" && isMilestone(row.act.type);
    if (milestone || s === null || f === null || f <= s) {
      const t = row.kind === "act" && row.act.type === "TT_Mile" ? s ?? f : f ?? s;
      if (t === null) return;
      const x = this.dateToX(t) - left;
      ctx.beginPath();
      ctx.moveTo(x, top - 1);
      ctx.lineTo(x + 3.5, top + 2.5);
      ctx.lineTo(x, top + 6);
      ctx.lineTo(x - 3.5, top + 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }
    const x0 = this.dateToX(s) - left;
    const x1 = Math.max(x0 + 2, this.dateToX(f) - left);
    ctx.fillRect(x0, top, x1 - x0, 4);
    ctx.strokeRect(Math.round(x0) + 0.5, top + 0.5, Math.max(1, Math.round(x1 - x0) - 1), 3);
  }

  private drawSummary(ctx: CanvasRenderingContext2D, s: number | null, f: number | null, y: number, left: number): void {
    if (s === null || f === null) return;
    const x0 = this.dateToX(s) - left;
    const x1 = Math.max(x0 + 1, this.dateToX(f) - left);
    const mid = y + ROW_HEIGHT / 2;
    ctx.fillStyle = GANTT.summary;
    ctx.fillRect(x0, mid - 3, x1 - x0, 5);
    // End caps, like P6's WBS summary bar.
    for (const x of [x0, x1]) {
      ctx.beginPath();
      ctx.moveTo(x - 4, mid - 3);
      ctx.lineTo(x + 4, mid - 3);
      ctx.lineTo(x, mid + 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawActivity(ctx: CanvasRenderingContext2D, a: Activity, y: number, left: number, dd: number | null): void {
    const mid = y + ROW_HEIGHT / 2;
    const remainingColor = a.critical ? GANTT.critical : GANTT.remaining;

    if (isMilestone(a.type)) {
      const t = a.type === "TT_Mile" ? a.start : a.finish ?? a.start;
      if (t === null) return;
      const x = this.dateToX(t) - left;
      const done = a.type === "TT_Mile" ? a.startActual : a.finishActual;
      ctx.fillStyle = done ? GANTT.actual : remainingColor;
      ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.beginPath();
      ctx.moveTo(x, mid - 6);
      ctx.lineTo(x + 6, mid);
      ctx.lineTo(x, mid + 6);
      ctx.lineTo(x - 6, mid);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }

    if (a.start === null || a.finish === null) return;
    const x0 = this.dateToX(a.start) - left;
    const x1 = Math.max(x0 + 2, this.dateToX(a.finish) - left);
    const barTop = mid - 5;
    const barH = 10;

    if (a.status === "Completed") {
      ctx.fillStyle = GANTT.actual;
      ctx.fillRect(x0, barTop, x1 - x0, barH);
    } else if (a.status === "InProgress" && dd !== null) {
      const xd = clamp(this.dateToX(dd) - left, x0, x1);
      ctx.fillStyle = GANTT.actual;
      ctx.fillRect(x0, barTop, xd - x0, barH);
      ctx.fillStyle = remainingColor;
      ctx.fillRect(xd, barTop, x1 - xd, barH);
    } else {
      ctx.fillStyle = remainingColor;
      ctx.fillRect(x0, barTop, x1 - x0, barH);
    }
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.strokeRect(Math.round(x0) + 0.5, barTop + 0.5, Math.max(1, Math.round(x1 - x0) - 1), barH - 1);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Counts periods from a fixed point, for labelling every nth one. */
function periodIndex(ms: number, unit: Unit): number {
  const d = new Date(ms);
  switch (unit) {
    case "year": return d.getUTCFullYear();
    case "quarter": return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
    case "month": return d.getUTCFullYear() * 12 + d.getUTCMonth();
    case "week": return Math.floor((ms / DAY + 3) / 7);
    default: return Math.floor(ms / DAY);
  }
}

export function floorTo(ms: number, unit: Unit): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case "year": return Date.UTC(y, 0, 1);
    case "quarter": return Date.UTC(y, m - (m % 3), 1);
    case "month": return Date.UTC(y, m, 1);
    case "week": {
      // P6 weeks start on Monday by default.
      const day = Date.UTC(y, m, d.getUTCDate());
      return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
    }
    default: return Date.UTC(y, m, d.getUTCDate());
  }
}

export function next(ms: number, unit: Unit): number {
  const d = new Date(ms);
  switch (unit) {
    case "year": return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
    case "quarter": return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
    case "month": return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    case "week": return ms + 7 * DAY;
    default: return ms + DAY;
  }
}

export function labelFor(ms: number, unit: Unit, width: number): string {
  const d = new Date(ms);
  switch (unit) {
    case "year": return String(d.getUTCFullYear());
    case "quarter": return width > 40 ? `Q${Math.floor(d.getUTCMonth() / 3) + 1}` : "";
    case "month":
      if (width > 70) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      return width > 26 ? MONTHS[d.getUTCMonth()] : width > 10 ? MONTHS[d.getUTCMonth()][0] : "";
    case "week": return width > 50 ? formatDate(ms) : width > 22 ? String(d.getUTCDate()) : "";
    default: return width > 14 ? String(d.getUTCDate()) : width > 8 ? "SMTWTFS"[d.getUTCDay()] : "";
  }
}
