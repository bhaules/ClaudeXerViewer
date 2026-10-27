// Predecessor / Successor panels under the grid.
import { formatDate, formatDuration, type DurationUnit } from "../xer/format";
import type { Activity, Relationship } from "../xer/model";
import { el, esc } from "./dom";

interface RelColumn {
  label: string;
  cls?: string;
  text(other: Activity, rel: Relationship, unit: DurationUnit): string;
  sort(other: Activity, rel: Relationship, unit: DurationUnit): number | string | null;
}

const COLUMNS: RelColumn[] = [
  { label: "Activity ID", text: (o) => o.code, sort: (o) => o.code },
  { label: "Activity Name", text: (o) => o.name, sort: (o) => o.name },
  { label: "Relationship Type", cls: "type", text: (_o, r) => r.type, sort: (_o, r) => r.type },
  {
    label: "Lag",
    cls: "r",
    text: (_o, r, u) => formatDuration(r.lagHrs, r.lagCalendar, u),
    sort: (_o, r) => r.lagHrs,
  },
  { label: "Driving", text: (_o, r) => (r.driving ? "Yes" : ""), sort: (_o, r) => (r.driving ? 0 : 1) },
  { label: "Start", text: (o) => formatDate(o.start, o.startActual, o.startConstrained), sort: (o) => o.start },
  { label: "Finish", text: (o) => formatDate(o.finish, o.finishActual, o.finishConstrained), sort: (o) => o.finish },
  {
    label: "Total Float",
    cls: "r",
    text: (o, _r, u) => formatDuration(o.totalFloatHrs, o.calendar, u),
    sort: (o) => o.totalFloatHrs,
  },
  { label: "Critical", text: (o) => (o.critical ? "Yes" : ""), sort: (o) => (o.critical ? 0 : 1) },
];

export class RelationsPanel {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private body: HTMLElement;
  private activity: Activity | null = null;
  private sortCol = 0;
  private sortDir: 1 | -1 = 1;
  private selected = -1;
  private shown: Relationship[] = [];

  constructor(
    private kind: "Predecessors" | "Successors",
    private unit: () => DurationUnit,
    private navigable: boolean,
    private onNavigate: (a: Activity) => void,
  ) {
    this.title = el("div", "rel-title");
    this.body = el("div", "rel-body");
    this.root = el("div", "pane rel-pane", [this.title, this.body]);

    this.body.addEventListener("click", (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>("th");
      if (th) {
        const c = Number(th.dataset.c);
        this.sortDir = c === this.sortCol ? (-this.sortDir as 1 | -1) : 1;
        this.sortCol = c;
        this.render();
        return;
      }
      const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-i]");
      if (tr) {
        this.selected = Number(tr.dataset.i);
        this.body.querySelectorAll("tr.sel").forEach((r) => r.classList.remove("sel"));
        tr.classList.add("sel");
      }
    });
    this.body.addEventListener("dblclick", (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-i]");
      if (tr && this.navigable) this.onNavigate(this.other(this.shown[Number(tr.dataset.i)]));
    });
    this.render();
  }

  show(activity: Activity | null): void {
    this.activity = activity;
    this.selected = -1;
    this.render();
  }

  private other(r: Relationship): Activity {
    return this.kind === "Predecessors" ? r.pred : r.succ;
  }

  render(): void {
    const a = this.activity;
    const list = a ? (this.kind === "Predecessors" ? a.preds : a.succs) : [];
    this.title.innerHTML =
      `${this.kind}${a ? ` (${list.length})` : ""}` +
      (a ? `<span class="sub">of ${esc(a.code)} &ndash; ${esc(a.name)}</span>` : "");

    if (!a) {
      this.body.innerHTML = `<div class="rel-empty">Select an activity to see its ${this.kind.toLowerCase()}.</div>`;
      return;
    }

    const unit = this.unit();
    const col = COLUMNS[this.sortCol];
    this.shown = [...list].sort((x, y) => {
      const vx = col.sort(this.other(x), x, unit);
      const vy = col.sort(this.other(y), y, unit);
      if (vx === vy) return 0;
      if (vx === null) return 1;
      if (vy === null) return -1;
      const c = typeof vx === "number" && typeof vy === "number" ? vx - vy : String(vx).localeCompare(String(vy), undefined, { numeric: true });
      return c * this.sortDir;
    });

    const head = COLUMNS.map(
      (c, i) => `<th data-c="${i}">${c.label}${i === this.sortCol ? `<span class="sort">${this.sortDir === 1 ? "▲" : "▼"}</span>` : ""}</th>`,
    ).join("");
    const rows = this.shown
      .map((r, i) => {
        const o = this.other(r);
        const cells = COLUMNS.map((c) => {
          const t = c.text(o, r, unit);
          return `<td class="${c.cls ?? ""}" title="${esc(t)}">${esc(t)}</td>`;
        }).join("");
        return `<tr data-i="${i}" class="${o.critical ? "crit" : ""}${i === this.selected ? " sel" : ""}">${cells}</tr>`;
      })
      .join("");
    this.body.innerHTML = list.length
      ? `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="rel-empty">No ${this.kind.toLowerCase()}.</div>`;
  }
}
