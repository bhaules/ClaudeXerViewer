// The Resource Spreadsheet tab: resource usage as numbers per week / month / quarter /
// year (P6's Resource Usage Spreadsheet), with an Excel export.
import { formatDate, formatNumber } from "../xer/format";
import type { Resource, Schedule } from "../xer/model";
import { buildUsageProfile, toManning, usageBetween, type UsageProfile } from "../xer/usage";
import type { TableSheet } from "../xer/xlsx";
import { el, esc } from "./dom";
import { floorTo, next, type Unit } from "./gantt";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Values = "total" | "actual" | "remaining";

export interface SpreadsheetHost {
  schedule(): Schedule | null;
  dataDate(): number | null;
  /** Hours one person works per week, for Manning (shared with the histogram). */
  hoursPerWeek(): number;
  onExport(sheets: TableSheet[], what: string): void;
}

interface Table {
  periods: { label: string; d0: number; d1: number; current: boolean }[];
  rows: { r: Resource | null; label: string; name: string; type: string; values: number[]; total: number }[];
  manning: boolean;
}

export class ResourceSpreadsheet {
  readonly root: HTMLElement;
  private period = el("select");
  private values = el("select");
  private manning = el("input");
  private body = el("div", "rel-body ss-body");
  private profile: UsageProfile | null = null;
  private profileFor: Schedule | null = null;

  constructor(private host: SpreadsheetHost) {
    this.period.innerHTML = ["week:Week", "month:Month", "quarter:Quarter", "year:Year"].map((o) => `<option value="${o.split(":")[0]}">${o.split(":")[1]}</option>`).join("");
    this.period.value = "month";
    this.values.innerHTML = `<option value="total">Total (actual + remaining)</option><option value="actual">Actual</option><option value="remaining">Remaining</option>`;
    this.manning.type = "checkbox";
    this.manning.title = "Show labour as people: hours ÷ the hours one person works per week (set on the Resource Usage tab)";
    for (const c of [this.period, this.values, this.manning]) c.addEventListener("change", () => this.render());
    const exp = el("button", "btn", ["Export to Excel"]);
    exp.addEventListener("click", () => this.export());
    const bar = el("div", "cm-bar", [
      el("span", "", ["Units per"]),
      this.period,
      this.values,
      el("label", "res-row", [this.manning, "Manning"]),
      el("span", "fb-sep"),
      exp,
    ]);
    this.root = el("div", "pane cm-pane", [bar, this.body]);
  }

  /** Call when the file changes. */
  reset(): void {
    this.profile = null;
    this.profileFor = null;
  }

  private table(): Table | null {
    const s = this.host.schedule();
    if (!s || !s.resources.length) return null;
    if (this.profileFor !== s) {
      this.profile = buildUsageProfile(s, this.host.dataDate());
      this.profileFor = s;
    }
    const p = this.profile!;
    if (!p.dayCount) return null;
    const unit = this.period.value as Unit;
    const kind = this.values.value as Values;
    const manning = this.manning.checked;
    const perWeek = this.host.hoursPerWeek();
    const dd = this.host.dataDate();
    const periods: Table["periods"] = [];
    const end = (p.firstDay + p.dayCount) * DAY;
    for (let t = floorTo(p.firstDay * DAY, unit); t < end; t = next(t, unit)) {
      const tEnd = next(t, unit);
      periods.push({ label: periodLabel(t, unit), d0: Math.floor(t / DAY), d1: Math.floor(tEnd / DAY), current: dd !== null && dd >= t && dd < tEnd });
    }
    const units = (rid: string, d0: number, d1: number) =>
      (kind !== "remaining" ? usageBetween(p, rid, "actual", d0, d1) : 0) + (kind !== "actual" ? usageBetween(p, rid, "remaining", d0, d1) : 0);
    const show = (hrs: number, d0: number, d1: number, labor: boolean) => (manning && labor ? toManning(hrs, d0, d1, perWeek) : hrs);

    const rows: Table["rows"] = s.resources.map((r) => {
      const labor = r.type === "Labor";
      const hours = periods.map((x) => units(r.id, x.d0, x.d1));
      const values = hours.map((h, i) => show(h, periods[i].d0, periods[i].d1, labor));
      const total = manning && labor ? Math.max(0, ...values) : hours.reduce((n, h) => n + h, 0);
      return { r, label: r.code, name: r.name, type: r.type, values, total };
    });
    const labor = rows.filter((x) => x.type === "Labor");
    if (labor.length > 1) {
      const values = periods.map((_, i) => labor.reduce((n, x) => n + x.values[i], 0));
      const total = manning ? Math.max(0, ...values) : labor.reduce((n, x) => n + x.total, 0);
      rows.push({ r: null, label: "Total labor", name: "", type: "Labor", values, total });
    }
    return { periods, rows, manning };
  }

  render(): void {
    const t = this.table();
    if (!t) {
      this.body.innerHTML = `<div class="rel-empty">${this.host.schedule() ? "No resources are assigned in this file." : "Open a schedule to see resource usage."}</div>`;
      return;
    }
    const dec = t.manning ? 1 : 0;
    const cell = (v: number) => (Math.abs(v) < 0.05 ? "" : formatNumber(v, dec));
    const totalLabel = t.manning ? "Peak / Total" : "Total";
    const head =
      `<tr><th class="ss-f1">Resource ID</th><th class="ss-f2">Resource Name</th><th>Type</th><th class="r">${totalLabel}</th>` +
      t.periods.map((p) => `<th class="r${p.current ? " ss-dd" : ""}"${p.current ? ` title="Contains the data date"` : ""}>${esc(p.label)}</th>`).join("") +
      `</tr>`;
    const body = t.rows
      .map(
        (x) =>
          `<tr${x.r ? "" : ` class="ss-total"`}><td class="ss-f1">${esc(x.label)}</td><td class="ss-f2" title="${esc(x.name)}">${esc(x.name)}</td><td>${esc(x.type)}</td>` +
          `<td class="r ss-tot" title="${t.manning && x.type === "Labor" ? "Peak people" : "Total units"}">${formatNumber(x.total, dec)}</td>` +
          x.values.map((v, i) => `<td class="r${t.periods[i].current ? " ss-dd" : ""}">${cell(v)}</td>`).join("") +
          `</tr>`,
      )
      .join("");
    const scroll = this.body.scrollLeft;
    this.body.innerHTML = `<table class="ss-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    this.body.scrollLeft = scroll;
  }

  private export(): void {
    const t = this.table();
    if (!t) return;
    const unit = this.period.selectedOptions[0]?.textContent ?? "";
    const what = this.values.selectedOptions[0]?.textContent ?? "";
    const sheet: TableSheet = {
      name: "Resource Usage",
      columns: [
        { label: "Resource ID", width: 16 },
        { label: "Resource Name", width: 32 },
        { label: "Type", width: 10 },
        { label: t.manning ? "Peak / Total" : "Total", width: 11 },
        ...t.periods.map((p) => ({ label: p.label, width: 10 })),
      ],
      rows: t.rows.map((x) => ({
        cells: [x.label, x.name, x.type, round(x.total), ...x.values.map((v) => (Math.abs(v) < 0.005 ? null : round(v)))],
        bold: !x.r,
        fill: x.r ? undefined : "#e8e8e8",
      })),
      frozenCols: 2,
    };
    const info: TableSheet = {
      name: "Export Info",
      columns: [
        { label: "Item", width: 22 },
        { label: "Value", width: 70 },
      ],
      rows: [
        ["Units per", unit],
        ["Values", what],
        ["Shown as", t.manning ? `Manning for labor: hours ÷ ${this.host.hoursPerWeek()} hours per person-week (Total column is the peak)` : "Units (hours for labor)"],
        ["Data date", formatDate(this.host.dataDate())],
        ["Spreading", "Actual units over actual dates, remaining units over remaining dates, evenly over working time (no resource curves)."],
        ["Exported with", `XER Viewer ${__APP_VERSION__}`],
      ].map(([k, v]) => ({ cells: [k, v] })),
    };
    this.host.onExport([sheet, info], "resource usage");
  }
}

const round = (v: number) => Math.round(v * 100) / 100;

function periodLabel(t: number, unit: Unit): string {
  const d = new Date(t);
  const yy = String(d.getUTCFullYear() % 100).padStart(2, "0");
  switch (unit) {
    case "year": return String(d.getUTCFullYear());
    case "quarter": return `Q${Math.floor(d.getUTCMonth() / 3) + 1}-${yy}`;
    case "month": return `${MONTHS[d.getUTCMonth()]}-${yy}`;
    default: return formatDate(t);
  }
}
