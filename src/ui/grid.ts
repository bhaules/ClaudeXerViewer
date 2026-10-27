// Virtualized tree grid: only the rows in view exist in the DOM.
import type { Column, ColumnContext } from "../xer/columns";
import { isMilestone } from "../xer/format";
import type { Activity } from "../xer/model";
import type { GridRow, SortSpec } from "../xer/rows";
import { el, esc } from "./dom";
import { ROW_HEIGHT, wbsColors } from "./theme";

const INDENT = 14;
const OVERSCAN = 8;
const MIN_COL_WIDTH = 30;

export interface GridHost {
  rows(): GridRow[];
  columns(): Column[];
  width(key: string): number;
  setWidth(key: string, width: number): void;
  sort(): SortSpec | null;
  sortable: boolean;
  ctx(): ColumnContext;
  expanded(wbsId: string): boolean;
  selectedIndex(): number;
  isHit(row: GridRow): boolean;
  onSort(key: string): void;
  /** Right-click on the column headers. */
  onHeaderMenu(): void;
  /** Filter row under the headers. */
  filterRow(): boolean;
  filterValue(key: string): string;
  filterError(key: string): boolean;
  onFilterInput(key: string, value: string): void;
  onToggle(index: number): void;
  onSelect(index: number): void;
  onActivate(index: number): void;
  onScroll(scrollTop: number): void;
}

export class Grid {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private head: HTMLElement;
  private headInner: HTMLElement;
  private labels = el("div", "hrow");
  private filters = el("div", "hfilters hidden");
  private filterSig = "";
  private empty = el("div", "grid-empty hidden");
  /** scrollTop last set by the scrollTop setter (syncing to the Gantt), until its echo arrives. */
  private syncedTop: number | null = null;
  private sizer: HTMLElement;
  private rowEls = new Map<number, { html: string; el: HTMLElement }>();

  constructor(private host: GridHost) {
    this.headInner = el("div", "ghead-inner", [this.labels, this.filters]);
    this.head = el("div", "ghead", [this.headInner]);
    this.filters.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      this.host.onFilterInput(input.dataset.key!, input.value);
    });
    this.filters.addEventListener("keydown", (e) => {
      const input = e.target as HTMLInputElement;
      if (e.key === "Escape" && input.value) {
        input.value = "";
        this.host.onFilterInput(input.dataset.key!, "");
      } else if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        this.focus();
      }
    });
    this.sizer = el("div", "gsizer");
    this.body = el("div", "gbody", [this.sizer]);
    this.body.tabIndex = 0;
    this.head.addEventListener("contextmenu", (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return; // keep copy/paste in filter boxes
      e.preventDefault();
      this.host.onHeaderMenu();
    });
    this.root = el("div", "pane grid-pane", [this.head, this.body, this.empty]);

    let lastTop = 0;
    this.body.addEventListener("scroll", () => {
      this.headInner.style.transform = `translateX(${-this.body.scrollLeft}px)`;
      this.renderRows();
      const top = this.body.scrollTop;
      if (top === lastTop) return; // horizontal scroll
      lastTop = top;
      // Our position was just set to match the Gantt: don't echo it back. The echo can
      // arrive a frame late, mid smooth-scroll, and would drag the Gantt backwards.
      if (this.syncedTop !== null && Math.abs(top - this.syncedTop) < 1) {
        this.syncedTop = null;
        return;
      }
      this.syncedTop = null;
      this.host.onScroll(top);
    });
    this.body.addEventListener("mousedown", (e) => {
      const i = this.rowIndexAt(e);
      if (i < 0) return;
      if ((e.target as HTMLElement).closest(".tog")) this.host.onToggle(i);
      else this.host.onSelect(i);
    });
    this.body.addEventListener("dblclick", (e) => {
      const i = this.rowIndexAt(e);
      if (i >= 0 && !(e.target as HTMLElement).closest(".tog")) this.host.onActivate(i);
    });
    this.body.addEventListener("keydown", (e) => this.onKey(e));
    new ResizeObserver(() => this.renderRows()).observe(this.body);
  }

  /** Full redraw: header, sizes and rows. */
  render(): void {
    this.renderHeader();
    const width = this.host.columns().reduce((s, c) => s + this.host.width(c.key), 0);
    this.sizer.style.width = `${width}px`;
    this.sizer.style.height = `${this.host.rows().length * ROW_HEIGHT}px`;
    for (const r of this.rowEls.values()) r.el.remove();
    this.rowEls.clear();
    this.renderRows();
  }

  get scrollTop(): number {
    return this.body.scrollTop;
  }

  /** Sync from the Gantt. Doesn't report back via onScroll (see the scroll handler). */
  set scrollTop(v: number) {
    if (Math.abs(this.body.scrollTop - v) < 1) return;
    this.body.scrollTop = v;
    this.syncedTop = this.body.scrollTop; // may be clamped
  }

  scrollToIndex(i: number, center = false): void {
    const top = i * ROW_HEIGHT;
    const h = this.body.clientHeight;
    if (center) this.body.scrollTop = Math.max(0, top - h / 2 + ROW_HEIGHT);
    else if (top < this.body.scrollTop) this.body.scrollTop = top;
    else if (top + ROW_HEIGHT > this.body.scrollTop + h) this.body.scrollTop = top + ROW_HEIGHT - h;
  }

  /** Text shown over an empty grid (e.g. when a filter matches nothing); null hides it. */
  setEmptyMessage(text: string | null): void {
    this.empty.textContent = text ?? "";
    this.empty.classList.toggle("hidden", !text);
  }

  focus(): void {
    this.body.focus({ preventScroll: true });
  }

  private renderHeader(): void {
    const sort = this.host.sort();
    this.labels.innerHTML = this.host
      .columns()
      .map((c) => {
        const ind = sort?.key === c.key ? `<span class="sort">${sort.dir === 1 ? "▲" : "▼"}</span>` : "";
        return `<div class="hcell${this.host.sortable ? " sortable" : ""}" data-key="${esc(c.key)}" style="width:${this.host.width(c.key)}px">${esc(c.label)}${ind}<span class="rz"></span></div>`;
      })
      .join("");
    this.renderFilterRow();

    for (const cell of this.labels.querySelectorAll<HTMLElement>(".hcell")) {
      const key = cell.dataset.key!;
      cell.addEventListener("click", (e) => {
        if (this.host.sortable && !(e.target as HTMLElement).classList.contains("rz")) this.host.onSort(key);
      });
      cell.querySelector<HTMLElement>(".rz")!.addEventListener("mousedown", (e) => this.startResize(e, key));
    }
  }

  /**
   * One text box per column under the headers. Rebuilt only when the columns or their
   * widths change, never while typing, so the focused box keeps its caret.
   */
  private renderFilterRow(): void {
    const show = this.host.filterRow();
    this.filters.classList.toggle("hidden", !show);
    if (!show) {
      this.filterSig = "";
      return;
    }
    const cols = this.host.columns();
    const sig = cols.map((c) => `${c.key}:${this.host.width(c.key)}`).join("|");
    if (sig !== this.filterSig) {
      this.filterSig = sig;
      this.filters.innerHTML = cols
        .map((c) => {
          const tip = c.kind === "text" ? "Contains text. =x exact, <>x excludes" : c.kind === "number" ? "e.g. >5, <=0, =10" : "e.g. >01-Jul-26, <=30/6/26, or Jul-26";
          return `<div class="fcell" style="width:${this.host.width(c.key)}px"><input type="text" data-key="${esc(c.key)}" title="${tip}" value="${esc(this.host.filterValue(c.key))}"></div>`;
        })
        .join("");
    }
    this.updateFilterErrors();
  }

  updateFilterErrors(): void {
    for (const input of this.filters.querySelectorAll<HTMLInputElement>("input")) {
      input.classList.toggle("bad", this.host.filterError(input.dataset.key!));
    }
  }

  /** Puts the boxes back in step with the filter state (e.g. after Clear Filters). */
  syncFilterValues(): void {
    for (const input of this.filters.querySelectorAll<HTMLInputElement>("input")) {
      input.value = this.host.filterValue(input.dataset.key!);
    }
    this.updateFilterErrors();
  }

  private startResize(e: MouseEvent, key: string): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = this.host.width(key);
    const move = (ev: MouseEvent) => {
      this.host.setWidth(key, Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX));
      this.render();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /**
   * Draws only the rows in view; called on every scroll. Row elements are reused when
   * unchanged and selection is a class toggle, so a click never replaces the row
   * under the mouse (that would break dblclick).
   */
  renderRows(): void {
    const rows = this.host.rows();
    const first = Math.max(0, Math.floor(this.body.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((this.body.scrollTop + this.body.clientHeight) / ROW_HEIGHT) + OVERSCAN);
    const cols = this.host.columns();
    const ctx = this.host.ctx();

    for (const [i, r] of this.rowEls) {
      if (i < first || i >= last) {
        r.el.remove();
        this.rowEls.delete(i);
      }
    }
    for (let i = first; i < last; i++) {
      const html = this.rowHtml(rows[i], i, cols, ctx);
      const existing = this.rowEls.get(i);
      if (existing?.html === html) continue;
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      const node = tpl.content.firstElementChild as HTMLElement;
      if (existing) existing.el.replaceWith(node);
      else this.body.append(node);
      this.rowEls.set(i, { html, el: node });
    }
    this.updateSelection();
  }

  updateSelection(): void {
    const sel = this.host.selectedIndex();
    for (const [i, r] of this.rowEls) r.el.classList.toggle("sel", i === sel);
  }

  private rowHtml(row: GridRow, i: number, cols: Column[], ctx: ColumnContext): string {
    const top = i * ROW_HEIGHT;
    const hit = this.host.isHit(row) ? " hit" : "";
    let cells = "";
    cols.forEach((c, ci) => {
      const w = this.host.width(c.key);
      const align = c.align === "right" ? " r" : c.align === "center" ? " c" : "";
      const text = row.kind === "wbs" ? c.wbsText(row.wbs, ctx) : c.text(row.act, ctx);
      let lead = "";
      if (ci === 0) {
        lead = `<span style="flex:none;width:${row.level * INDENT}px"></span>`;
        lead +=
          row.kind === "wbs"
            ? `<span class="tog${this.host.expanded(row.wbs.id) ? " open" : ""}"></span>`
            : `<span class="${iconClass(row.act)}"></span>`;
      }
      const title = text.length > 20 || c.html ? ` title="${esc(text)}"` : "";
      const content = c.html && row.kind === "act" ? c.html(row.act) : esc(text);
      cells += `<div class="cell${align}" style="width:${w}px">${lead}<span class="txt"${title}>${content}</span></div>`;
    });

    if (row.kind === "wbs") {
      const [bg, fg] = wbsColors(row.level);
      return `<div class="row wbs${hit}" data-i="${i}" style="top:${top}px;background:${bg};color:${fg}" title="${esc(row.wbs.fullCode)}">${cells}</div>`;
    }
    return `<div class="row act${hit}" data-i="${i}" style="top:${top}px">${cells}</div>`;
  }

  private rowIndexAt(e: MouseEvent): number {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>(".row");
    return rowEl ? Number(rowEl.dataset.i) : -1;
  }

  private onKey(e: KeyboardEvent): void {
    const rows = this.host.rows();
    if (rows.length === 0) return;
    const sel = this.host.selectedIndex();
    const page = Math.max(1, Math.floor(this.body.clientHeight / ROW_HEIGHT) - 1);
    const go = (i: number) => {
      e.preventDefault();
      this.host.onSelect(Math.max(0, Math.min(rows.length - 1, i)));
    };
    const row = rows[sel];
    switch (e.key) {
      case "ArrowDown": return go(sel + 1);
      case "ArrowUp": return go(sel - 1);
      case "PageDown": return go(sel + page);
      case "PageUp": return go(sel - page);
      case "Home": return go(0);
      case "End": return go(rows.length - 1);
      case "ArrowRight":
        if (row?.kind === "wbs" && !this.host.expanded(row.wbs.id)) {
          e.preventDefault();
          this.host.onToggle(sel);
        }
        return;
      case "ArrowLeft":
        if (row?.kind === "wbs" && this.host.expanded(row.wbs.id)) {
          e.preventDefault();
          this.host.onToggle(sel);
        } else if (row) {
          // Jump to the parent WBS band.
          for (let i = sel - 1; i >= 0; i--) {
            const r = rows[i];
            if (r.kind === "wbs" && r.level < row.level) return go(i);
          }
        }
        return;
      case "Enter":
        e.preventDefault();
        this.host.onActivate(sel);
        return;
    }
  }
}

function iconClass(a: Activity): string {
  const status = a.status === "Completed" ? "cp" : a.status === "InProgress" ? "ip" : "ns";
  return `ico ${status}${a.critical ? " crit" : ""}${isMilestone(a.type) ? " ms" : ""}`;
}
