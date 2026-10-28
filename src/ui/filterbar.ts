// Quick filters above the grid: status, critical, milestones and a date window with
// look-ahead presets from the data date.
import type { FilterState } from "../xer/filter";
import type { Status } from "../xer/model";
import { el } from "./dom";

const DAY = 86_400_000;

export interface FilterBarHost {
  state(): FilterState;
  dataDate(): number | null;
  /** Called after the bar has changed the filter state. */
  onChange(): void;
  onClear(): void;
}

const LOOKAHEADS: [string, number][] = [
  ["2 weeks", 14],
  ["3 weeks", 21],
  ["4 weeks", 28],
  ["6 weeks", 42],
  ["3 months", 91],
];

export class FilterBar {
  readonly root: HTMLElement;
  private statusBoxes = new Map<Status, HTMLInputElement>();
  private critical: HTMLInputElement;
  private milestones: HTMLInputElement;
  private commented: HTMLInputElement;
  private from: HTMLInputElement;
  private to: HTMLInputElement;
  private lookahead: HTMLSelectElement;
  private count = el("span", "fb-count");

  constructor(private host: FilterBarHost) {
    const check = (label: string, onChange: (on: boolean) => void): [HTMLElement, HTMLInputElement] => {
      const box = el("input");
      box.type = "checkbox";
      box.addEventListener("change", () => {
        onChange(box.checked);
        this.host.onChange();
      });
      return [el("label", "fb-check", [box, label]), box];
    };

    const statusEls: HTMLElement[] = [];
    for (const [s, label] of [["NotStarted", "Not Started"], ["InProgress", "In Progress"], ["Completed", "Completed"]] as const) {
      const [wrap, box] = check(label, (on) => {
        const set = this.host.state().statuses;
        if (on) set.add(s);
        else set.delete(s);
      });
      this.statusBoxes.set(s, box);
      statusEls.push(wrap);
    }
    const [critWrap, crit] = check("Critical", (on) => (this.host.state().criticalOnly = on));
    const [mileWrap, mile] = check("Milestones", (on) => (this.host.state().milestonesOnly = on));
    const [cmtWrap, cmt] = check("With comments", (on) => (this.host.state().commentedOnly = on));
    this.critical = crit;
    this.milestones = mile;
    this.commented = cmt;

    this.from = dateInput();
    this.to = dateInput();
    for (const input of [this.from, this.to]) {
      input.addEventListener("change", () => {
        const s = this.host.state();
        s.from = fromInput(this.from.value);
        s.to = fromInput(this.to.value);
        this.lookahead.value = "";
        this.host.onChange();
      });
    }

    this.lookahead = el("select");
    this.lookahead.title = "Activities active from the data date for the chosen period";
    this.lookahead.innerHTML =
      `<option value="">Look ahead...</option>` + LOOKAHEADS.map(([label, days]) => `<option value="${days}">${label}</option>`).join("");
    this.lookahead.addEventListener("change", () => {
      const days = Number(this.lookahead.value);
      const dd = this.host.dataDate();
      if (!days || dd === null) return;
      const start = Math.floor(dd / DAY) * DAY;
      const s = this.host.state();
      s.from = start;
      s.to = start + (days - 1) * DAY;
      this.from.value = toInput(s.from);
      this.to.value = toInput(s.to);
      this.host.onChange();
    });

    const clear = el("button", "btn fb-clear", ["Clear Filters"]);
    clear.addEventListener("click", () => this.host.onClear());

    this.root = el("div", "filterbar", [
      el("span", "fb-title", ["Filter"]),
      el("span", "fb-group", statusEls),
      el("span", "fb-sep"),
      el("span", "fb-group", [critWrap, mileWrap, cmtWrap]),
      el("span", "fb-sep"),
      el("span", "fb-group", [el("span", "", ["Active between"]), this.from, el("span", "", ["and"]), this.to, this.lookahead]),
      el("span", "fb-sep"),
      clear,
      this.count,
    ]);
  }

  /** Puts the controls back in step with the state (after Clear or a new file). */
  sync(): void {
    const s = this.host.state();
    for (const [status, box] of this.statusBoxes) box.checked = s.statuses.has(status);
    this.critical.checked = s.criticalOnly;
    this.milestones.checked = s.milestonesOnly;
    this.commented.checked = s.commentedOnly;
    this.from.value = toInput(s.from);
    this.to.value = toInput(s.to);
    this.lookahead.value = "";
  }

  /** `note` names a filter set elsewhere (e.g. the selected resource) so it's never hidden. */
  setCount(shown: number, total: number, active: boolean, note = ""): void {
    this.count.textContent = active
      ? `${note ? note + "   |   " : ""}Showing ${shown.toLocaleString()} of ${total.toLocaleString()} activities`
      : "";
    this.root.classList.toggle("active", active);
  }
}

function dateInput(): HTMLInputElement {
  const input = el("input");
  input.type = "date";
  return input;
}

function fromInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

function toInput(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toISOString().slice(0, 10);
}
