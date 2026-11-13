// The Filter menu (also opened from the toolbar's funnel): status, critical, milestones,
// comments, an "active between" date window with look-ahead presets from the data date,
// the filter row under the headers, and Clear Filters.
import type { FilterState } from "../xer/filter";
import { formatDate } from "../xer/format";
import type { Status } from "../xer/model";
import { el, formDialog } from "./dom";
import type { MenuItem } from "./menu";

const DAY = 86_400_000;

const LOOKAHEADS: [string, number][] = [
  ["2 Weeks", 14],
  ["3 Weeks", 21],
  ["4 Weeks", 28],
  ["6 Weeks", 42],
  ["3 Months", 91],
];

const STATUSES: [Status, string][] = [
  ["NotStarted", "Not Started"],
  ["InProgress", "In Progress"],
  ["Completed", "Completed"],
];

export interface FilterMenuHost {
  state(): FilterState;
  loaded(): boolean;
  dataDate(): number | null;
  /** Called after the menu has changed the filter state. */
  onChange(): void;
  onClear(): void;
  active(): boolean;
  filterRowShown(): boolean;
  toggleFilterRow(): void;
}

export function filterMenuItems(h: FilterMenuHost): MenuItem[] {
  const s = () => h.state();
  const toggle = (label: string, get: () => boolean, set: (on: boolean) => void): MenuItem => ({
    label,
    checked: get,
    enabled: h.loaded,
    action: () => {
      set(!get());
      h.onChange();
    },
  });
  const range = () => {
    const { from, to } = s();
    return from === null && to === null ? "" : ` (${formatDate(from) || "..."} to ${formatDate(to) || "..."})`;
  };
  const lookAheadStart = () => {
    const dd = h.dataDate();
    return dd === null ? null : Math.floor(dd / DAY) * DAY;
  };
  return [
    ...STATUSES.map(([status, label]) =>
      toggle(label, () => s().statuses.has(status), (on) => (on ? s().statuses.add(status) : s().statuses.delete(status))),
    ),
    "-",
    toggle("Critical", () => s().criticalOnly, (on) => (s().criticalOnly = on)),
    toggle("Milestones", () => s().milestonesOnly, (on) => (s().milestonesOnly = on)),
    toggle("With Comments", () => s().commentedOnly, (on) => (s().commentedOnly = on)),
    "-",
    {
      label: `Active Between...${range()}`,
      checked: () => s().from !== null || s().to !== null,
      enabled: h.loaded,
      action: () => void editDateRange(h),
    },
    {
      label: "Look Ahead",
      enabled: () => h.loaded() && h.dataDate() !== null,
      items: () =>
        LOOKAHEADS.map(([label, days]): MenuItem => ({
          label: `${label} from Data Date`,
          checked: () => {
            const start = lookAheadStart();
            return start !== null && s().from === start && s().to === start + (days - 1) * DAY;
          },
          action: () => {
            const start = lookAheadStart();
            if (start === null) return;
            s().from = start;
            s().to = start + (days - 1) * DAY;
            h.onChange();
          },
        })),
    },
    "-",
    { label: "Filter Row", key: "Ctrl+Shift+F", checked: h.filterRowShown, enabled: h.loaded, action: h.toggleFilterRow },
    { label: "Clear Filters", enabled: h.active, action: h.onClear },
  ];
}

/** Filter > Active Between: keeps activities underway at any point in the range. */
async function editDateRange(h: FilterMenuHost): Promise<void> {
  const s = h.state();
  const from = dateInput(s.from);
  const to = dateInput(s.to);
  const body = el("div", "", [
    el("p", "dlg-note", ["Shows activities that are underway at any point between these dates. Leave a box empty for no limit."]),
    el("div", "dlg-row", [el("label", "dlg-label", ["From"]), from, el("label", "dlg-label", ["to"]), to]),
  ]);
  const result = await formDialog("Active Between", body, "OK", () => ({ from: fromInput(from.value), to: fromInput(to.value) }), from);
  if (!result) return;
  s.from = result.from;
  s.to = result.to;
  h.onChange();
}

function dateInput(ms: number | null): HTMLInputElement {
  const input = el("input", "dlg-select");
  input.type = "date";
  input.value = ms === null ? "" : new Date(ms).toISOString().slice(0, 10);
  return input;
}

function fromInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
