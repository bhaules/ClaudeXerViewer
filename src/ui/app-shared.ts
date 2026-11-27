// Preferences and small helpers shared by app.ts and the app-*.ts modules.
import { FEATURES } from "../features";
import { COLUMN_BY_KEY, COLUMNS } from "../xer/columns";
import { itemKey } from "../xer/comments";
import { type DurationUnit } from "../xer/format";
import { type Activity, type Wbs } from "../xer/model";
import { type GridRow } from "../xer/rows";
import { TIMESCALES, type Timescale } from "./gantt";
import { DEFAULT_HISTOGRAM, type HistogramSettings } from "./resources";
import { type DetailsTab } from "./details";
import { DEFAULT_SPREADSHEET, type SpreadsheetSettings } from "./spreadsheet";

export const PREFS_KEY = "xer-viewer-prefs-v1";

export interface Prefs {
  columns: string[];
  widths: Record<string, number>;
  unit: DurationUnit;
  hideEmptyWbs: boolean;
  showToolbar: boolean;
  showGantt: boolean;
  /** The bottom panel is showing (named when it only held the relationship panels). */
  showRelations: boolean;
  relLines: RelLines;
  /** Filter row under the headers. */
  showFilters: boolean;
  bottomTab: BottomTab;
  /** Which Activity Details tab is showing. */
  detailsTab: DetailsTab;
  /** View > Bar Labels. */
  barLabels: BarLabels;
  /** View > Timescale. */
  timescale: Timescale;
  /** Help > Notify About Updates. */
  updateCheck: boolean;
  spreadsheet: SpreadsheetSettings;
  histogram: HistogramSettings;
  /** Name shown on review comments made in this browser. */
  reviewer: string;
  /** View > Group By: an activity code type's name, or "" for WBS. */
  groupBy: string;
}

export type BottomTab = "details" | "resources" | "spreadsheet" | "comments" | "changes" | "check";

export type BarLabels = "none" | "name" | "id" | "idName" | "finish" | "dates";

export const BAR_LABELS: [BarLabels, string][] = [
  ["none", "None"],
  ["name", "Activity Name"],
  ["id", "Activity ID"],
  ["idName", "Activity ID and Name"],
  ["finish", "Finish Date"],
  ["dates", "Start and Finish Dates"],
];

/** Unsaved comments are also kept here, per project, so closing the tab doesn't lose them. */
export const DRAFT_KEY = "xer-viewer-comment-draft:";

export type RelLines = "none" | "driving" | "all";

export const DEFAULT_PREFS: Prefs = {
  columns: COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
  widths: {},
  unit: "d",
  hideEmptyWbs: true,
  showToolbar: FEATURES.toolbar,
  showGantt: FEATURES.gantt,
  showRelations: FEATURES.relationships,
  relLines: FEATURES.ganttRelationships ? "driving" : "none",
  showFilters: false,
  bottomTab: "details",
  detailsTab: "relationships",
  barLabels: "none",
  timescale: "auto",
  updateCheck: true,
  spreadsheet: DEFAULT_SPREADSHEET,
  histogram: DEFAULT_HISTOGRAM,
  reviewer: "",
  groupBy: "",
};

export function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    const prefs = { ...DEFAULT_PREFS, ...saved };
    prefs.histogram = { ...DEFAULT_HISTOGRAM, ...saved.histogram };
    prefs.spreadsheet = { ...DEFAULT_SPREADSHEET, ...saved.spreadsheet };
    if (!TIMESCALES.some(([t]) => t === prefs.timescale)) prefs.timescale = "auto";
    // Before 0.8 the first bottom tab was just Relationships; it's inside Activity Details now.
    if ((prefs.bottomTab as string) === "relationships") prefs.bottomTab = "details";
    // UDF and activity code columns depend on the file; keep them for files that have them.
    prefs.columns = prefs.columns.filter((k) => COLUMN_BY_KEY.has(k) || /^(udf|code|codedesc):/.test(k));
    if (prefs.columns.length === 0) prefs.columns = DEFAULT_PREFS.columns;
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function isActivity(x: Activity | Wbs): x is Activity {
  return "wbs" in x;
}

/** The comment-index key for a grid row (matches `targetKey`). */
export function rowKey(r: GridRow): string {
  if (r.kind === "wbs" && r.wbs.group) return "";
  return itemKey(r.kind === "wbs" ? r.wbs : r.act);
}
