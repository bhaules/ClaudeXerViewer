// Activity filters: quick filters (status, critical, milestones, date window) plus a
// per-column expression for each grid column.
import type { Column, ColumnContext } from "./columns";
import { isMilestone } from "./format";
import type { Activity, Status } from "./model";

export type Predicate = (a: Activity) => boolean;

export interface FilterState {
  /** Empty means any status. */
  statuses: Set<Status>;
  criticalOnly: boolean;
  milestonesOnly: boolean;
  /** Keep activities active at any time between these days (inclusive). */
  from: number | null;
  to: number | null;
  /** Column key -> expression typed in the filter row. */
  columns: Map<string, string>;
}

export function emptyFilter(): FilterState {
  return { statuses: new Set(), criticalOnly: false, milestonesOnly: false, from: null, to: null, columns: new Map() };
}

export function filterActive(f: FilterState): boolean {
  return (
    f.statuses.size > 0 ||
    f.criticalOnly ||
    f.milestonesOnly ||
    f.from !== null ||
    f.to !== null ||
    [...f.columns.values()].some((v) => v.trim() !== "")
  );
}

export interface CompiledFilter {
  /** Null when nothing is filtered. */
  test: Predicate | null;
  /** Column keys whose expression couldn't be understood (they are ignored). */
  errors: Set<string>;
}

const DAY = 86_400_000;

export function compileFilter(f: FilterState, columns: Map<string, Column>, ctx: ColumnContext): CompiledFilter {
  const tests: Predicate[] = [];
  const errors = new Set<string>();

  if (f.statuses.size) tests.push((a) => f.statuses.has(a.status));
  if (f.criticalOnly) tests.push((a) => a.critical);
  if (f.milestonesOnly) tests.push((a) => isMilestone(a.type));
  if (f.from !== null || f.to !== null) {
    const from = f.from ?? -Infinity;
    const toEnd = f.to === null ? Infinity : f.to + DAY; // `to` includes its whole day
    tests.push((a) => {
      const s = a.start ?? a.finish;
      const e = a.finish ?? a.start;
      return s !== null && e !== null && s < toEnd && e >= from;
    });
  }
  for (const [key, expr] of f.columns) {
    const col = columns.get(key);
    if (!col || !expr.trim()) continue;
    const t = columnTest(col, expr, ctx);
    if (t === "error") errors.add(key);
    else tests.push(t);
  }

  if (!tests.length) return { test: null, errors };
  return { test: (a) => tests.every((t) => t(a)), errors };
}

type Op = ">" | "<" | ">=" | "<=" | "=" | "<>";

function compare(v: number, op: Op, n: number): boolean {
  switch (op) {
    case ">": return v > n;
    case "<": return v < n;
    case ">=": return v >= n;
    case "<=": return v <= n;
    case "=": return v === n;
    case "<>": return v !== n;
  }
}

/**
 * Text columns: contains (case-insensitive); "=x" exact; "<>x" or "!x" doesn't contain.
 * Number and date columns also take > < >= <= = <> with a number or a date. A plain
 * number in a number column means equals; a plain value in a date column means contains,
 * so "Mar-26" finds every date in March 2026.
 */
export function columnTest(col: Column, expr: string, ctx: ColumnContext): Predicate | "error" {
  const e = expr.trim();
  const m = /^(>=|<=|<>|!=|=|>|<|!)\s*(.*)$/.exec(e);
  const op = m ? ((m[1] === "!=" || m[1] === "!" ? "<>" : m[1]) as Op) : null;
  const operand = m ? m[2].trim() : e;
  const text = (a: Activity) => col.text(a, ctx).toLowerCase();
  const needle = operand.toLowerCase();

  if (col.kind === "number" && (op || parseNumber(operand) !== null)) {
    const n = parseNumber(operand);
    if (n === null) return "error";
    const o = op ?? "=";
    return (a) => {
      const v = col.sortValue(a, ctx);
      if (typeof v !== "number") return false;
      // Displayed values are rounded, so "=5" should match 4.99.
      if (o === "=") return Math.abs(v - n) < 0.05;
      if (o === "<>") return Math.abs(v - n) >= 0.05;
      return compare(v, o, n);
    };
  }

  if (col.kind === "date" && op) {
    const d = parseDateInput(operand);
    if (d === null) return "error";
    const day = Math.floor(d / DAY);
    return (a) => {
      const v = col.sortValue(a, ctx);
      return typeof v === "number" && compare(Math.floor(v / DAY), op, day);
    };
  }

  if (op === "=") return (a) => text(a) === needle;
  if (op === "<>") return (a) => !text(a).includes(needle);
  if (op) return "error"; // > or < on a text column
  return (a) => text(a).includes(needle);
}

/** "1,234.5", "5d", "12h", "40%" -> number. */
export function parseNumber(s: string): number | null {
  const t = s.replace(/,/g, "").replace(/\s*[a-z%]+$/i, "").trim();
  if (t === "" || !/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Accepts 05-Mar-26, 5-Mar-2026, 2026-03-05 and 5/3/26 (day first). Returns UTC-wall ms. */
export function parseDateInput(s: string): number | null {
  const t = s.trim().replace(/\s*\*$/, "").replace(/\s+A$/i, "");
  let m = /^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s](\d{2}|\d{4})$/i.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month < 0) return null;
    return utc(year(m[3]), month, +m[1]);
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return utc(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) return utc(year(m[3]), +m[2] - 1, +m[1]);
  return null;
}

function year(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

function utc(y: number, month: number, d: number): number | null {
  const ms = Date.UTC(y, month, d);
  const dt = new Date(ms);
  return dt.getUTCMonth() === month && dt.getUTCDate() === d ? ms : null;
}
