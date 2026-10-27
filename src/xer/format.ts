// P6 display rules for dates, durations and lag.
import type { Calendar } from "./model";

export type DurationUnit = "h" | "d" | "w" | "m";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** dd-Mmm-yy, plus " A" for actuals and "*" for constrained dates, like P6. */
export function formatDate(ms: number | null, actual = false, constrained = false): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const s = `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear() % 100).padStart(2, "0")}`;
  return s + (actual ? " A" : "") + (constrained ? "*" : "");
}

export function formatDateTime(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  return `${formatDate(ms)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function hoursTo(hours: number, cal: Calendar, unit: DurationUnit): number {
  switch (unit) {
    case "h": return hours;
    case "w": return hours / cal.weekHrs;
    case "m": return hours / cal.monthHrs;
    default: return hours / cal.dayHrs;
  }
}

/** P6 shows whole days when the value is whole, otherwise one decimal (e.g. "5", "2.5"). */
export function formatDuration(hours: number | null, cal: Calendar, unit: DurationUnit): string {
  if (hours === null) return "";
  return trimNumber(hoursTo(hours, cal, unit)) + unit;
}

export function formatLag(hours: number, cal: Calendar, unit: DurationUnit): string {
  return formatDuration(hours, cal, unit);
}

function trimNumber(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Thousands separators, up to `decimals` places, trailing zeros dropped: 1,234.5 */
export function formatNumber(v: number, decimals = 2): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export function formatPercent(v: number): string {
  return `${Math.round(v)}%`;
}

const TYPE_NAMES: Record<string, string> = {
  TT_Task: "Task Dependent",
  TT_Rsrc: "Resource Dependent",
  TT_LOE: "Level of Effort",
  TT_Mile: "Start Milestone",
  TT_FinMile: "Finish Milestone",
  TT_WBS: "WBS Summary",
};

export function activityTypeName(type: string): string {
  return TYPE_NAMES[type] ?? type;
}

const CONSTRAINT_NAMES: Record<string, string> = {
  CS_MSO: "Start On",
  CS_MSOA: "Start On or After",
  CS_MSOB: "Start On or Before",
  CS_MEO: "Finish On",
  CS_MEOA: "Finish On or After",
  CS_MEOB: "Finish On or Before",
  CS_ALAP: "As Late As Possible",
  CS_MANDSTART: "Mandatory Start",
  CS_MANDFIN: "Mandatory Finish",
};

export function constraintName(c: string): string {
  return CONSTRAINT_NAMES[c] ?? c;
}

export function isMilestone(type: string): boolean {
  return type === "TT_Mile" || type === "TT_FinMile";
}
