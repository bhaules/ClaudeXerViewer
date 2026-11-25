// The Activity Details tab at the bottom, like P6's: General, Relationships, Resources,
// Codes, UDFs, Notebook and Steps for the selected activity (or a WBS band's summary).
import { changeDetails, codeColumnKey, udfColumnKey, type Column, type ColumnContext } from "../xer/columns";
import { formatDate, formatNumber, formatPercent } from "../xer/format";
import type { Activity, Schedule, Wbs } from "../xer/model";
import { el, esc } from "./dom";
import { TableSelect } from "./table-select";

export type DetailsTab = "general" | "relationships" | "resources" | "codes" | "udfs" | "notebook" | "steps";

const TABS: [DetailsTab, string][] = [
  ["general", "General"],
  ["relationships", "Relationships"],
  ["resources", "Resources"],
  ["codes", "Codes"],
  ["udfs", "UDFs"],
  ["notebook", "Notebook"],
  ["steps", "Steps"],
];

export interface DetailsHost {
  schedule(): Schedule | null;
  /** Every column for the open file, by key (formats the General tab like the grid). */
  columns(): Map<string, Column>;
  ctx(): ColumnContext;
  tab(): DetailsTab;
  setTab(t: DetailsTab): void;
}

/** General tab sections: [heading, column keys]. */
const GENERAL: [string, string[]][] = [
  ["Activity", ["code", "name", "type", "status", "wbsCode", "wbsName", "project", "calendar", "durationType", "pctType", "primaryResource"]],
  ["Durations", ["origDur", "remDur", "totalFloat", "freeFloat", "pct", "physPct"]],
  ["Dates", ["start", "finish", "actualStart", "actualFinish", "plannedStart", "plannedFinish", "lateStart", "lateFinish", "expectedFinish"]],
  ["Constraints", ["constraint", "constraintDate", "constraint2", "constraint2Date"]],
  ["Units", ["budLabor", "actLabor", "remLabor", "budNonlabor", "actNonlabor", "remNonlabor"]],
  ["Baseline", ["blStart", "blFinish", "startVar", "finishVar", "blOrigDur", "durVar", "blTotalFloat", "change"]],
];

const WBS_GENERAL: string[] = ["wbsCode", "name", "project", "origDur", "remDur", "start", "finish", "totalFloat", "budLabor", "actLabor", "remLabor", "blStart", "blFinish", "startVar", "finishVar"];

export class DetailsPanel {
  readonly root: HTMLElement;
  private strip = el("div", "dtabs");
  private body = el("div", "dbody");
  private item: Activity | Wbs | null = null;

  /** `relations` is the Predecessors | Successors pair, shown on the Relationships tab. */
  constructor(private host: DetailsHost, private relations: HTMLElement) {
    this.strip.addEventListener("mousedown", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-t]");
      if (!t) return;
      this.host.setTab(t.dataset.t as DetailsTab);
      this.render();
    });
    new TableSelect(this.body, ".dtable", false);
    this.root = el("div", "details", [this.strip, this.body, this.relations]);
    this.render();
  }

  show(item: Activity | Wbs | null): void {
    this.item = item;
    this.render();
  }

  render(): void {
    const tab = this.host.tab();
    const a = this.item && "wbs" in this.item ? this.item : null;
    const count = (t: DetailsTab): string => {
      if (!a) return "";
      const n =
        t === "resources" ? a.assignments.length : t === "codes" ? a.codes.size : t === "udfs" ? a.udf.size : t === "notebook" ? a.notes.length : t === "steps" ? a.steps.length : 0;
      return n ? ` (${n})` : "";
    };
    this.strip.innerHTML = TABS.map(([t, label]) => `<span class="dtab${t === tab ? " active" : ""}" data-t="${t}">${label}${count(t)}</span>`).join("");
    const rel = tab === "relationships";
    this.relations.classList.toggle("hidden", !rel);
    this.body.classList.toggle("hidden", rel);
    if (rel) return;
    this.body.scrollTop = 0;
    if (!this.item) {
      this.body.innerHTML = `<div class="rel-empty">Select an activity to see its details.</div>`;
      return;
    }
    if (!a) {
      this.body.innerHTML = tab === "general" ? this.wbsGeneral(this.item as Wbs) : `<div class="rel-empty">Select an activity to see its ${tab === "udfs" ? "UDFs" : tab}.</div>`;
      return;
    }
    switch (tab) {
      case "general": this.body.innerHTML = this.general(a); break;
      case "resources": this.body.innerHTML = this.resources(a); break;
      case "codes": this.body.innerHTML = this.codes(a); break;
      case "udfs": this.body.innerHTML = this.udfs(a); break;
      case "notebook": this.body.innerHTML = this.notebook(a); break;
      case "steps": this.body.innerHTML = this.steps(a); break;
    }
  }

  private fields(keys: string[], value: (c: Column) => string): string {
    const cols = this.host.columns();
    return keys
      .map((k) => cols.get(k))
      .filter((c): c is Column => !!c)
      .map((c) => {
        const v = value(c);
        return `<tr><th>${esc(c.label)}</th><td title="${esc(v)}">${esc(v) || `<span class="muted">–</span>`}</td></tr>`;
      })
      .join("");
  }

  private general(a: Activity): string {
    const ctx = this.host.ctx();
    const sections = GENERAL.filter(([h]) => h !== "Baseline" || ctx.cmp).map(([heading, keys]) => {
      let rows = this.fields(keys, (c) => c.text(a, ctx));
      if (heading === "Activity") rows += `<tr><th>Critical</th><td>${a.critical ? "Yes" : "No"}</td></tr>`;
      if (heading === "Baseline") {
        const d = changeDetails(a, ctx);
        if (d) rows += `<tr><th>What changed</th><td class="wrap">${esc(d).replace(/\n/g, "<br>")}</td></tr>`;
      }
      return `<section><h4>${heading}</h4><table class="dform">${rows}</table></section>`;
    });
    return `<div class="dgen">${sections.join("")}</div>`;
  }

  private wbsGeneral(w: Wbs): string {
    const ctx = this.host.ctx();
    const rows =
      this.fields(WBS_GENERAL, (c) => c.wbsText(w, ctx)) +
      `<tr><th>Activities</th><td>${w.activityCount.toLocaleString()}</td></tr>` +
      `<tr><th>Calendar (for durations)</th><td>${esc(w.calendar?.name ?? w.project?.calendar.name ?? "")}</td></tr>`;
    return `<div class="dgen"><section><h4>WBS ${esc(w.fullCode)}</h4><table class="dform">${rows}</table></section></div>`;
  }

  private resources(a: Activity): string {
    if (!a.assignments.length) return `<div class="rel-empty">No resources are assigned to ${esc(a.code)}.</div>`;
    const u = (r: { type: string }, v: number) => formatNumber(v) + (r.type === "Labor" ? "h" : "");
    const rows = a.assignments
      .map((x) => {
        const start = x.actStart ?? x.remStart;
        const finish = x.actFinish ?? x.remFinish;
        return (
          `<tr><td>${esc(x.resource.code)}</td><td>${esc(x.resource.name)}</td><td>${esc(x.resource.type)}</td>` +
          `<td class="r">${u(x.resource, x.budget)}</td><td class="r">${u(x.resource, x.actual)}</td><td class="r">${u(x.resource, x.remaining)}</td>` +
          `<td class="r">${u(x.resource, x.actual + x.remaining)}</td><td>${formatDate(start, x.actStart !== null)}</td><td>${formatDate(finish, x.actFinish !== null)}</td></tr>`
        );
      })
      .join("");
    return (
      `<table class="dtable"><thead><tr><th>Resource ID</th><th>Resource Name</th><th>Type</th><th>Budgeted Units</th><th>Actual Units</th>` +
      `<th>Remaining Units</th><th>At Completion Units</th><th>Start</th><th>Finish</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }

  private codes(a: Activity): string {
    const s = this.host.schedule();
    const types = (s?.codeTypes ?? []).filter((t) => a.codes.has(t.id));
    if (!types.length) return `<div class="rel-empty">No activity codes are assigned to ${esc(a.code)}.</div>`;
    const cols = this.host.columns();
    const ctx = this.host.ctx();
    const rows = types
      .map((t) => {
        const c = a.codes.get(t.id)!;
        const shown = cols.get(codeColumnKey(t))?.text(a, ctx) ?? c.value;
        return `<tr><td>${esc(t.label)}</td><td>${esc(shown)}</td><td>${esc(c.description)}</td></tr>`;
      })
      .join("");
    return `<table class="dtable"><thead><tr><th>Activity Code</th><th>Code Value</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  private udfs(a: Activity): string {
    const s = this.host.schedule();
    const types = (s?.udfTypes ?? []).filter((t) => a.udf.has(t.id));
    if (!types.length) return `<div class="rel-empty">No user defined fields have a value on ${esc(a.code)}.</div>`;
    const cols = this.host.columns();
    const ctx = this.host.ctx();
    const rows = types
      .map((t) => {
        const c = cols.get(udfColumnKey(t));
        const html = c?.html ? c.html(a) + " " : "";
        return `<tr><td>${esc(t.label)}</td><td>${html}${esc(c?.text(a, ctx) ?? "")}</td></tr>`;
      })
      .join("");
    return `<table class="dtable"><thead><tr><th>User Defined Field</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  private notebook(a: Activity): string {
    if (!a.notes.length) return `<div class="rel-empty">${esc(a.code)} has no notebook notes.</div>`;
    return a.notes.map((n) => `<section class="dnote"><h4>${esc(n.topic)}</h4><div class="dtext">${esc(n.text)}</div></section>`).join("");
  }

  private steps(a: Activity): string {
    if (!a.steps.length) return `<div class="rel-empty">${esc(a.code)} has no steps.</div>`;
    const total = a.steps.reduce((n, s) => n + s.weight, 0);
    const done = a.steps.reduce((n, s) => n + (s.weight * s.pctComplete) / 100, 0);
    const rows = a.steps
      .map(
        (s, i) =>
          `<tr><td class="r">${i + 1}</td><td>${esc(s.name)}</td><td class="c">${s.completed ? "✓" : ""}</td><td class="r">${formatPercent(s.pctComplete)}</td>` +
          `<td class="r">${formatNumber(s.weight)}</td><td class="wrap">${esc(s.description)}</td></tr>`,
      )
      .join("");
    const summary = total > 0 ? `<p class="dsum">Weighted steps complete: <b>${formatPercent((done / total) * 100)}</b></p>` : "";
    return (
      `${summary}<table class="dtable"><thead><tr><th>#</th><th>Step Name</th><th>Completed</th><th>% Complete</th><th>Weight</th><th>Description</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`
    );
  }
}
