// Resource usage over time, for the histogram: each assignment's actual units are spread
// over its actual dates and its remaining units over its remaining dates, in proportion
// to working time on the activity's calendar (P6's default linear curve).
import { workMinutesByDay } from "./calendar";
import type { Assignment, Schedule } from "./model";

const DAY = 86_400_000;

export interface UsageProfile {
  /** Day index (days since 1970) of the first day with any usage. */
  firstDay: number;
  dayCount: number;
  /** Per resource id: running totals by day (length dayCount + 1), so any range sums in O(1). */
  actual: Map<string, Float64Array>;
  remaining: Map<string, Float64Array>;
}

interface Piece {
  rid: string;
  kind: "actual" | "remaining";
  days: [number, number][]; // [day, units]
}

/** Spreads `qty` over [from, to) by working minutes; all on one day if there are none. */
function spread(a: Assignment, qty: number, from: number | null, to: number | null): [number, number][] {
  if (qty <= 0 || from === null) return [];
  if (to === null || to <= from) return [[Math.floor(from / DAY), qty]];
  const work = workMinutesByDay(a.activity.calendar.work, from, to);
  const total = work.reduce((s, [, m]) => s + m, 0);
  if (total > 0) return work.map(([d, m]) => [d, (qty * m) / total]);
  // No working time in the span (calendar mismatch): spread evenly over calendar days.
  const d0 = Math.floor(from / DAY);
  const d1 = Math.floor((to - 1) / DAY);
  const n = d1 - d0 + 1;
  return Array.from({ length: n }, (_, i) => [d0 + i, qty / n]);
}

export function buildUsageProfile(s: Schedule, dataDate: number | null): UsageProfile {
  const pieces: Piece[] = [];
  let first = Infinity;
  let last = -Infinity;
  for (const r of s.resources) {
    for (const a of r.assignments) {
      // Actual work runs from the actual start to the actual finish, or to the data date while in progress.
      const actEnd = a.actFinish ?? (dataDate !== null && a.actStart !== null && dataDate > a.actStart ? dataDate : a.actStart);
      for (const piece of [
        { rid: r.id, kind: "actual" as const, days: spread(a, a.actual, a.actStart, actEnd) },
        { rid: r.id, kind: "remaining" as const, days: spread(a, a.remaining, a.remStart, a.remFinish) },
      ]) {
        if (!piece.days.length) continue;
        pieces.push(piece);
        first = Math.min(first, piece.days[0][0]);
        last = Math.max(last, piece.days[piece.days.length - 1][0]);
      }
    }
  }
  if (!pieces.length) return { firstDay: 0, dayCount: 0, actual: new Map(), remaining: new Map() };

  const dayCount = last - first + 1;
  const actual = new Map<string, Float64Array>();
  const remaining = new Map<string, Float64Array>();
  for (const p of pieces) {
    const target = p.kind === "actual" ? actual : remaining;
    let arr = target.get(p.rid);
    if (!arr) target.set(p.rid, (arr = new Float64Array(dayCount + 1)));
    for (const [d, units] of p.days) arr[d - first + 1] += units;
  }
  // Daily amounts -> running totals.
  for (const arr of [...actual.values(), ...remaining.values()]) {
    for (let i = 1; i < arr.length; i++) arr[i] += arr[i - 1];
  }
  return { firstDay: first, dayCount, actual, remaining };
}

/**
 * Hours in a period -> average people ("manning"), given how many hours one person
 * works per week. The divisor scales with the period's length, so a weekly bar is
 * hours ÷ hoursPerWeek and a 4-week month is hours ÷ (4 × hoursPerWeek). This is P6's
 * "Calculate Average: divide interval totals by" for weekly intervals.
 */
export function toManning(hours: number, fromDay: number, toDay: number, hoursPerPersonWeek: number): number {
  const weeks = (toDay - fromDay) / 7;
  return weeks > 0 && hoursPerPersonWeek > 0 ? hours / (hoursPerPersonWeek * weeks) : 0;
}

/** Units for one resource between two days (start inclusive, end exclusive). */
export function usageBetween(p: UsageProfile, rid: string, kind: "actual" | "remaining", fromDay: number, toDay: number): number {
  const cum = (kind === "actual" ? p.actual : p.remaining).get(rid);
  if (!cum) return 0;
  const at = (d: number) => cum[Math.max(0, Math.min(p.dayCount, d - p.firstDay))];
  return at(toDay) - at(fromDay);
}
