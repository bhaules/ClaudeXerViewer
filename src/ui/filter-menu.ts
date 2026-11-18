// The Filter menu (also opened from the toolbar's funnel): status, critical, milestones,
// comments, an "active between" date window with look-ahead presets from the data date,
// changes since the baseline, Trace Logic, the filter row under the headers, and Clear Filters.
import { CHANGE_KINDS, type ChangeKind } from "../xer/compare";
import type { FilterState } from "../xer/filter";
import { formatDate } from "../xer/format";
import type { Activity, Status } from "../xer/model";
import type { TraceDirection, TraceSpec } from "../xer/trace";
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
  /** A baseline is loaded (File > Compare with Baseline). */
  comparison(): boolean;
  /** The selected activity, the starting point for Trace Logic. */
  selected(): Activity | null;
  setTrace(t: TraceSpec | null): void;
}

/** Trace Logic choices, shared with the grid row menu. */
export const TRACE_OPTIONS: [string, TraceDirection, boolean][] = [
  ["Driving Predecessors", "pred", true],
  ["Driving Successors", "succ", true],
  ["Driving Path (Both Ways)", "both", true],
  ["All Predecessors", "pred", false],
  ["All Successors", "succ", false],
];

/** The Trace Logic submenu for `root` (the selected activity, else the one being traced). */
export function traceMenuItems(root: Activity | null, current: TraceSpec | null, set: (t: TraceSpec | null) => void): MenuItem[] {
  const items: MenuItem[] = [];
  TRACE_OPTIONS.forEach(([label, dir, drivingOnly], i) => {
    if (i === 3) items.push("-");
    items.push({
      label: root ? `${label} of ${root.code}` : label,
      enabled: () => root !== null,
      checked: () => !!current && current.root === root && current.dir === dir && current.drivingOnly === drivingOnly,
      action: () => root && set({ root, dir, drivingOnly }),
    });
  });
  items.push("-", { label: "Clear Trace", enabled: () => current !== null, action: () => set(null) });
  return items;
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
  const changeToggle = (k: ChangeKind | "any", label: string): MenuItem =>
    toggle(label, () => s().changes.has(k), (on) => (on ? s().changes.add(k) : s().changes.delete(k)));
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
    {
      label: "Changes vs Baseline",
      enabled: () => h.loaded() && h.comparison(),
      items: () => [
        changeToggle("any", "Any Change (not progress)"),
        "-",
        ...CHANGE_KINDS.map(([k, label]) => changeToggle(k, label)),
      ],
    },
    {
      label: "Trace Logic",
      enabled: () => h.loaded() && (h.selected() !== null || s().trace !== null),
      items: () => traceMenuItems(h.selected() ?? s().trace?.root ?? null, s().trace, h.setTrace),
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
