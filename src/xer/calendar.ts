// P6 calendar working time, parsed from CALENDAR.clndr_data. Used to decide whether
// any working time separates two dates (driving relationships).

/** Working ranges for one day, as [startMinute, endMinute] pairs. */
export type DayRanges = [number, number][];

export interface WorkPattern {
  /** Index 0 = Sunday ... 6 = Saturday (JS getUTCDay order). */
  week: DayRanges[];
  /** Keyed by days since 1970-01-01 (UTC wall-clock days). */
  exceptions: Map<number, DayRanges>;
}

interface BlobNode {
  name: string;
  attrs: Record<string, string>;
  children: BlobNode[];
}

/** P6 writes 0x7F (DEL) between lines inside clndr_data, so treat it as whitespace. */
const WS = /[\s\x7f]/;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** P6 date serials count days from 1899-12-30; this many days later is 1970-01-01. */
const SERIAL_EPOCH_OFFSET = 25569;

/** A Monday-Friday pattern starting 08:00, for calendars without usable clndr_data. */
export function defaultPattern(dayHrs: number): WorkPattern {
  const day: DayRanges = [[8 * 60, Math.min(24 * 60, 8 * 60 + Math.round(dayHrs * 60))]];
  return { week: [[], day, day, day, day, day, []], exceptions: new Map() };
}

/**
 * Parses the nested `(0||Name(attr|value|...)(children...))` blob. Returns null when
 * it has no DaysOfWeek section.
 */
export function parseCalendarData(data: string): WorkPattern | null {
  if (!data) return null;
  let roots: BlobNode[];
  try {
    roots = parseNodes(data, { i: 0 });
  } catch {
    return null;
  }
  const find = (nodes: BlobNode[], name: string): BlobNode | undefined => {
    for (const n of nodes) {
      if (n.name === name) return n;
      const hit = find(n.children, name);
      if (hit) return hit;
    }
    return undefined;
  };

  const days = find(roots, "DaysOfWeek");
  if (!days) return null;
  const week: DayRanges[] = [[], [], [], [], [], [], []];
  for (const d of days.children) {
    const p6Day = Number(d.name); // 1 = Sunday ... 7 = Saturday
    if (p6Day >= 1 && p6Day <= 7) week[p6Day - 1] = ranges(d.children);
  }

  const exceptions = new Map<number, DayRanges>();
  for (const e of find(roots, "Exceptions")?.children ?? []) {
    const serial = Number(e.attrs.d);
    if (Number.isFinite(serial)) exceptions.set(Math.floor(serial) - SERIAL_EPOCH_OFFSET, ranges(e.children));
  }
  return { week, exceptions };
}

function ranges(nodes: BlobNode[]): DayRanges {
  const out: DayRanges = [];
  for (const n of nodes) {
    const s = minutes(n.attrs.s);
    let f = minutes(n.attrs.f);
    if (s === null || f === null) continue;
    if (f <= s) f = 24 * 60; // "f|00:00" means midnight at the end of the day
    out.push([s, f]);
  }
  return out;
}

function minutes(hhmm: string | undefined): number | null {
  const m = hhmm ? /^(\d{1,2}):(\d{2})/.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function parseNodes(s: string, at: { i: number }): BlobNode[] {
  const nodes: BlobNode[] = [];
  for (;;) {
    while (at.i < s.length && WS.test(s[at.i])) at.i++;
    if (s[at.i] !== "(") return nodes;
    nodes.push(parseNode(s, at));
  }
}

function parseNode(s: string, at: { i: number }): BlobNode {
  at.i++; // (
  const bar = s.indexOf("||", at.i);
  const open = s.indexOf("(", bar);
  if (bar === -1 || open === -1) throw new Error("bad calendar node");
  const name = s.slice(bar + 2, open).trim();
  const close = s.indexOf(")", open);
  const parts = s.slice(open + 1, close).split("|");
  const attrs: Record<string, string> = {};
  for (let k = 0; k + 1 < parts.length; k += 2) attrs[parts[k]] = parts[k + 1];
  at.i = close + 1;
  while (WS.test(s[at.i])) at.i++;
  if (s[at.i] !== "(") throw new Error("bad calendar node");
  at.i++;
  const children = parseNodes(s, at);
  at.i++; // ) closing children
  while (WS.test(s[at.i])) at.i++;
  at.i++; // ) closing node
  return { name, attrs, children };
}

/**
 * Working minutes on each day between `from` and `to`, as [day (days since 1970), minutes]
 * for days with work. Spans longer than `maxDays` are cut short.
 */
export function workMinutesByDay(p: WorkPattern, from: number, to: number, maxDays = 3700): [number, number][] {
  const out: [number, number][] = [];
  if (to <= from) return out;
  const firstDay = Math.floor(from / DAY_MS);
  const lastDay = Math.min(Math.floor((to - 1) / DAY_MS), firstDay + maxDays);
  for (let day = firstDay; day <= lastDay; day++) {
    const dayRanges = p.exceptions.get(day) ?? p.week[new Date(day * DAY_MS).getUTCDay()];
    let minutes = 0;
    for (const [s, f] of dayRanges) {
      const rs = day * DAY_MS + s * MINUTE_MS;
      const rf = day * DAY_MS + f * MINUTE_MS;
      const overlap = Math.min(rf, to) - Math.max(rs, from);
      if (overlap > 0) minutes += overlap / MINUTE_MS;
    }
    if (minutes > 0) out.push([day, minutes]);
  }
  return out;
}

/**
 * True when there is any working time strictly between `a` and `b` (in either order).
 * Gaps over a year are assumed to contain work rather than walking every day.
 */
export function hasWorkBetween(p: WorkPattern, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo < MINUTE_MS) return false;
  const firstDay = Math.floor(lo / DAY_MS);
  const lastDay = Math.floor((hi - 1) / DAY_MS);
  if (lastDay - firstDay > 370) return true;
  for (let day = firstDay; day <= lastDay; day++) {
    const dayRanges = p.exceptions.get(day) ?? p.week[new Date(day * DAY_MS).getUTCDay()];
    for (const [s, f] of dayRanges) {
      const rs = day * DAY_MS + s * MINUTE_MS;
      const rf = day * DAY_MS + f * MINUTE_MS;
      if (Math.min(rf, hi) - Math.max(rs, lo) >= MINUTE_MS) return true;
    }
  }
  return false;
}
