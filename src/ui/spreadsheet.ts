// The Resource Spreadsheet tab: resource usage as numbers per week / month / quarter /
// year (P6's Resource Usage Spreadsheet), with an Excel export.
import { formatDate, formatNumber } from "../xer/format";
import type { Resource, Schedule } from "../xer/model";
import { buildUsageProfile, usageBetween, type UsageProfile } from "../xer/usage";
import type { TableSheet } from "../xer/xlsx";
import { el, esc } from "./dom";
import { floorTo, next, type Unit } from "./gantt";
import { TableSelect } from "./table-select";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Values = "total" | "actual" | "remaining";
type Period = "week" | "month" | "quarter" | "year";

export interface SpreadsheetSettings {
  period: Period;
  values: Values;
  manning: boolean;
  /** Hours one person works per period, where the user has set it. */
  perPerson: Partial<Record<Period, number>>;
}

export const DEFAULT_SPREADSHEET: SpreadsheetSettings = { period: "month", values: "total", manning: false, perPerson: {} };

/** Weeks in a period, for the starting hours-per-person figure. */
const WEEKS: Record<Period, number> = { week: 1, month: 52 / 12, quarter: 13, year: 52 };

export interface SpreadsheetHost {
  schedule(): Schedule | null;
  dataDate(): number | null;
  /** The histogram's hours per person-week, the starting point for Manning here. */
  hoursPerWeek(): number;
  onSettingsChange(s: SpreadsheetSettings): void;
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
  private perPerson = el("input", "res-num");
  private perLabel = el("span");
  private body = el("div", "rel-body ss-body");
  private profile: UsageProfile | null = null;
  private profileFor: Schedule | null = null;

  constructor(private host: SpreadsheetHost, private settings: SpreadsheetSettings) {
    this.period.innerHTML = ["week:Week", "month:Month", "quarter:Quarter", "year:Year"].map((o) => `<option value="${o.split(":")[0]}">${o.split(":")[1]}</option>`).join("");
    this.period.value = settings.period;
    this.values.innerHTML = `<option value="total">Total (actual + remaining)</option><option value="actual">Actual</option><option value="remaining">Remaining</option>`;
    this.values.value = settings.values;
    this.manning.type = "checkbox";
    this.manning.checked = settings.manning;
    this.manning.title = "Show labour as people: hours ÷ the hours one person works in the period";
    this.perPerson.type = "number";
    this.perPerson.min = "1";
    this.perPerson.title = "Hours one person works in the period (e.g. 70 a week for 7 x 10 h days). Kept separately for week, month, quarter and year.";
    this.perPerson.addEventListener("input", () => {
      const v = Number(this.perPerson.value);
      if (!(v > 0)) return;
      this.change({ perPerson: { ...this.settings.perPerson, [this.settings.period]: v } });
    });
    this.period.addEventListener("change", () => this.change({ period: this.period.value as Period }));
    this.values.addEventListener("change", () => this.change({ values: this.values.value as Values }));
    this.manning.addEventListener("change", () => this.change({ manning: this.manning.checked }));
    new TableSelect(this.body, ".ss-table", true);
    const exp = el("button", "btn", ["Export to Excel"]);
    exp.addEventListener("click", () => this.export());
    const bar = el("div", "cm-bar", [
      el("span", "", ["Units per"]),
      this.period,
      this.values,
      el("label", "res-row", [this.manning, "Manning: hours ÷"]),
      this.perPerson,
      this.perLabel,
      el("span", "fb-sep"),
      exp,
    ]);
    this.root = el("div", "pane cm-pane", [bar, this.body]);
  }

  private change(c: Partial<SpreadsheetSettings>): void {
    this.settings = { ...this.settings, ...c };
    this.host.onSettingsChange(this.settings);
    this.render();
  }

  /** Hours one person works in the chosen period. */
  private hoursPerPerson(): number {
    const p = this.settings.period;
    return this.settings.perPerson[p] ?? Math.max(1, Math.round(this.host.hoursPerWeek() * WEEKS[p]));
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
    const unit: Unit = this.settings.period;
    const kind = this.settings.values;
    const manning = this.settings.manning;
    const perPerson = this.hoursPerPerson();
    const dd = this.host.dataDate();
    const periods: Table["periods"] = [];
    const end = (p.firstDay + p.dayCount) * DAY;
    for (let t = floorTo(p.firstDay * DAY, unit); t < end; t = next(t, unit)) {
      const tEnd = next(t, unit);
      periods.push({ label: periodLabel(t, unit), d0: Math.floor(t / DAY), d1: Math.floor(tEnd / DAY), current: dd !== null && dd >= t && dd < tEnd });
    }
    const units = (rid: string, d0: number, d1: number) =>
      (kind !== "remaining" ? usageBetween(p, rid, "actual", d0, d1) : 0) + (kind !== "actual" ? usageBetween(p, rid, "remaining", d0, d1) : 0);

    const rows: Table["rows"] = s.resources.map((r) => {
      const labor = r.type === "Labor";
      const hours = periods.map((x) => units(r.id, x.d0, x.d1));
      const values = manning && labor ? hours.map((h) => h / perPerson) : hours;
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
    this.perPerson.disabled = !this.settings.manning;
    // Don't rewrite the box while it's being typed in.
    if (document.activeElement !== this.perPerson) this.perPerson.value = String(this.hoursPerPerson());
    this.perLabel.textContent = `h per person per ${this.settings.period}`;
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
    // The name column sticks right after the ID column, however wide that came out.
    const id = this.body.querySelector<HTMLElement>("th.ss-f1");
    if (id?.offsetWidth) this.body.style.setProperty("--ss-f1", `${id.offsetWidth}px`);
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
        ["Shown as", t.manning ? `Manning for labor: hours ÷ ${this.hoursPerPerson()} hours per person per ${this.settings.period} (Total column is the peak)` : "Units (hours for labor)"],
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
