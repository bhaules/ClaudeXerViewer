// The Changes tab: everything that changed since the baseline (File > Compare with
// Baseline), including deleted activities, which the grid can't show.
import { CHANGE_KINDS, changedBesidesProgress, changeSummary, describeChange, type ChangeKind, type Comparison } from "../xer/compare";
import { formatDate, formatDuration, hoursTo, type DurationUnit } from "../xer/format";
import type { Activity } from "../xer/model";
import { compareValues } from "../xer/rows";
import { el, esc } from "./dom";

export type ChangesShow = "any" | ChangeKind | "deleted";

export interface ChangesPanelHost {
  comparison(): Comparison | null;
  unit(): DurationUnit;
  goTo(a: Activity): void;
  onCompare(): void;
  onRemove(): void;
  /** Filters the grid to this kind of change. */
  onFilter(kind: ChangeKind | "any"): void;
  /** Every change (and the counts) to Excel. */
  onExport(): void;
}

interface Item {
  /** The open schedule's activity, or null for a deleted one. */
  act: Activity | null;
  /** What the row shows: the current activity, or the baseline's for a deleted one. */
  shown: Activity;
  base: Activity | null;
  change: string;
  details: string;
  finishVar: number | null;
}

interface ChangeColumn {
  label: string;
  cls?: string;
  text(i: Item, unit: DurationUnit): string;
  sort(i: Item, unit: DurationUnit): number | string | null;
}

const COLUMNS: ChangeColumn[] = [
  { label: "Activity ID", text: (i) => i.shown.code, sort: (i) => i.shown.code },
  { label: "Activity Name", text: (i) => i.shown.name, sort: (i) => i.shown.name },
  { label: "Change", text: (i) => i.change, sort: (i) => i.change },
  { label: "BL Start", text: (i) => (i.base ? formatDate(i.base.start, i.base.startActual) : ""), sort: (i) => i.base?.start ?? null },
  { label: "Start", text: (i) => (i.act ? formatDate(i.act.start, i.act.startActual) : ""), sort: (i) => i.act?.start ?? null },
  { label: "BL Finish", text: (i) => (i.base ? formatDate(i.base.finish, i.base.finishActual) : ""), sort: (i) => i.base?.finish ?? null },
  { label: "Finish", text: (i) => (i.act ? formatDate(i.act.finish, i.act.finishActual) : ""), sort: (i) => i.act?.finish ?? null },
  {
    label: "Finish Variance",
    cls: "r",
    text: (i, u) => (i.act ? formatDuration(i.finishVar, i.act.calendar, u) : ""),
    sort: (i, u) => (i.act && i.finishVar !== null ? hoursTo(i.finishVar, i.act.calendar, u) : null),
  },
  { label: "Details", cls: "ch-details", text: (i) => i.details, sort: (i) => i.details },
];

/** Big comparisons are listed up to this many rows; the Show box narrows them. */
const MAX_ROWS = 3000;

export class ChangesPanel {
  readonly root: HTMLElement;
  private show = el("select");
  private summary = el("span", "cm-summary");
  private body = el("div", "rel-body");
  private compare = el("button", "btn", ["Compare with Baseline..."]);
  private remove = el("button", "btn", ["Remove Baseline"]);
  private filter = el("button", "btn", ["Filter Activities"]);
  private exportBtn = el("button", "btn", ["Export to Excel"]);
  private items: Item[] = [];
  private sortCol = 7;
  private sortDir: 1 | -1 = 1;

  constructor(private host: ChangesPanelHost) {
    this.show.addEventListener("change", () => this.render());
    this.compare.addEventListener("click", () => this.host.onCompare());
    this.remove.addEventListener("click", () => this.host.onRemove());
    this.filter.title = "Show only these activities in the grid and Gantt (Filter > Changes vs Baseline)";
    this.filter.addEventListener("click", () => {
      const v = this.show.value as ChangesShow;
      if (v !== "deleted") this.host.onFilter(v);
    });
    this.exportBtn.title = "Every change, including deleted activities, plus a summary of counts, as an .xlsx";
    this.exportBtn.addEventListener("click", () => this.host.onExport());
    const bar = el("div", "cm-bar", [el("span", "", ["Show"]), this.show, this.filter, this.exportBtn, el("span", "fb-sep"), this.compare, this.remove, this.summary]);
    this.root = el("div", "pane cm-pane", [bar, this.body]);

    this.body.addEventListener("click", (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>("th[data-c]");
      if (th) {
        const c = Number(th.dataset.c);
        this.sortDir = c === this.sortCol ? (-this.sortDir as 1 | -1) : 1;
        this.sortCol = c;
        this.render();
        return;
      }
      const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-i]");
      if (!tr) return;
      this.body.querySelectorAll("tr.sel").forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      const item = this.items[Number(tr.dataset.i)];
      if (item?.act) this.host.goTo(item.act);
    });
    this.render();
  }

  /** Call when the comparison or the duration unit changes. */
  render(): void {
    const cmp = this.host.comparison();
    this.remove.disabled = !cmp;
    this.exportBtn.disabled = !cmp;
    this.filter.disabled = !cmp || this.show.value === "deleted";
    if (!cmp) {
      this.show.innerHTML = "";
      this.summary.textContent = "";
      this.body.innerHTML =
        `<div class="rel-empty">No baseline loaded. Use <b>File &gt; Compare with Baseline...</b> to open an earlier .xer ` +
        `(for example last month's update) and see what was added, deleted, moved or re-linked since then.</div>`;
      return;
    }

    // Show box with counts; keep the current choice.
    const keep = this.show.value || "any";
    const anyCount = [...cmp.changes.values()].filter(changedBesidesProgress).length;
    const opts: [ChangesShow, string, number][] = [
      ["any", "All Changes (not progress)", anyCount],
      ...CHANGE_KINDS.map(([k, label]): [ChangesShow, string, number] => [k, label, cmp.counts.get(k) ?? 0]),
      ["deleted", "Deleted", cmp.deleted.length],
    ];
    this.show.innerHTML = opts.map(([v, label, n]) => `<option value="${v}">${esc(label)} (${n.toLocaleString()})</option>`).join("");
    this.show.value = opts.some(([v]) => v === keep) ? keep : "any";
    const show = this.show.value as ChangesShow;
    this.filter.disabled = show === "deleted";

    const unit = this.host.unit();
    const p = cmp.baseline.projects[0];
    const dd = p?.dataDate ? `, data date ${formatDate(p.dataDate)}` : "";
    this.summary.textContent = `Baseline: ${cmp.name}${dd}`;
    this.summary.title = this.summary.textContent;

    const items: Item[] = [];
    if (show === "deleted") {
      for (const b of cmp.deleted) {
        items.push({ act: null, shown: b, base: b, change: "Deleted", details: `Deleted (was in WBS ${b.wbs.fullCode})`, finishVar: null });
      }
    } else {
      for (const [a, ch] of cmp.changes) {
        const hit = show === "any" ? changedBesidesProgress(ch) : ch.kinds.has(show);
        if (!hit) continue;
        items.push({
          act: a,
          shown: a,
          base: ch.base,
          change: changeSummary(ch),
          details: describeChange(a, ch, unit).join("; "),
          finishVar: ch.finishVarHrs,
        });
      }
    }
    const col = COLUMNS[this.sortCol];
    items.sort((x, y) => compareValues(col.sort(x, unit), col.sort(y, unit)) * this.sortDir || compareValues(x.shown.code, y.shown.code));
    this.items = items.slice(0, MAX_ROWS);

    if (!items.length) {
      this.body.innerHTML = `<div class="rel-empty">No activities in this category.</div>`;
      return;
    }
    const head = COLUMNS.map(
      (c, i) => `<th data-c="${i}">${c.label}${i === this.sortCol ? `<span class="sort">${this.sortDir === 1 ? "▲" : "▼"}</span>` : ""}</th>`,
    ).join("");
    const rows = this.items
      .map((it, i) => {
        const tds = COLUMNS.map((c) => {
          const t = c.text(it, unit);
          return `<td${c.cls ? ` class="${c.cls}"` : ""}${t.length > 30 ? ` title="${esc(t)}"` : ""}>${esc(t)}</td>`;
        }).join("");
        return `<tr data-i="${i}"${it.act ? "" : ` class="ch-deleted"`}>${tds}</tr>`;
      })
      .join("");
    const more = items.length > MAX_ROWS ? `<div class="rel-empty">Showing the first ${MAX_ROWS.toLocaleString()} of ${items.length.toLocaleString()}. Pick a narrower category in Show.</div>` : "";
    this.body.innerHTML = `<table class="ch-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${more}`;
  }
}
