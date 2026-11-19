// The Schedule Check tab (Review > Schedule Check): DCMA 14-point style results; click a
// check to show only the activities it flags.
import type { CheckResult } from "../xer/health";
import { el, esc } from "./dom";

export interface HealthPanelHost {
  /** Null when no schedule is open. */
  results(): CheckResult[] | null;
  /** The check currently filtering the activities, if any. */
  active(): string | null;
  /** Where dates for checks 11 and 14 come from. */
  source(): string;
  onPick(r: CheckResult): void;
  onClear(): void;
  onExport(): void;
}

export class HealthPanel {
  readonly root: HTMLElement;
  private body = el("div", "rel-body");
  private note = el("span", "cm-summary");
  private clear = el("button", "btn", ["Show All Activities"]);
  private shown: CheckResult[] = [];

  constructor(private host: HealthPanelHost) {
    const exp = el("button", "btn", ["Export to Excel"]);
    exp.title = "The results and every flagged activity, as an .xlsx";
    exp.addEventListener("click", () => this.host.onExport());
    this.clear.addEventListener("click", () => this.host.onClear());
    const bar = el("div", "cm-bar", [el("span", "", ["Click a check to show the activities it flags."]), this.clear, exp, this.note]);
    this.root = el("div", "pane cm-pane", [bar, this.body]);
    this.body.addEventListener("click", (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-i]");
      if (!tr) return;
      const r = this.shown[Number(tr.dataset.i)];
      if (r && r.activities.size) this.host.onPick(r);
    });
  }

  render(): void {
    const results = this.host.results();
    const active = this.host.active();
    this.clear.disabled = active === null;
    this.note.textContent = results ? `Incomplete activities, LOE and WBS summary left out. Missed activities and BEI use ${this.host.source()}.` : "";
    this.note.title = "Like the DCMA 14-point assessment. Point 12 (critical path test) needs P6 to reschedule, so it isn't included.";
    if (!results) {
      this.shown = [];
      this.body.innerHTML = `<div class="rel-empty">Open a schedule to check it.</div>`;
      return;
    }
    this.shown = results;
    const rows = results
      .map((r, i) => {
        const result = r.pass === null ? `<span class="hc-na">–</span>` : r.pass ? `<span class="hc-pass">Pass</span>` : `<span class="hc-fail">Fail</span>`;
        const cls = [r.id === active ? "sel" : "", r.activities.size ? "hc-click" : ""].filter(Boolean).join(" ");
        return (
          `<tr data-i="${i}" class="${cls}"${r.activities.size ? ` title="Show these ${r.activities.size.toLocaleString()} activities"` : ""}>` +
          `<td class="r">${esc(r.no)}</td><td>${esc(r.name)}</td><td class="c">${result}</td>` +
          `<td class="r">${r.total ? r.count.toLocaleString() : ""}</td><td class="r">${r.total ? r.total.toLocaleString() : ""}</td><td>${esc(r.of)}</td>` +
          `<td class="r">${esc(r.value)}</td><td class="r">${esc(r.target)}</td><td class="hc-desc" title="${esc(r.description)}">${esc(r.description)}</td></tr>`
        );
      })
      .join("");
    this.body.innerHTML =
      `<table class="hc-table"><thead><tr><th>#</th><th>Check</th><th>Result</th><th>Count</th><th>Of</th><th>Counted</th><th>Value</th><th>Target</th><th>What it checks</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  }
}
