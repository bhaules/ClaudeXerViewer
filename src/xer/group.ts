// View > Group By: bands by activity code value instead of WBS, like P6's Group and Sort.
// The bands are Wbs-shaped (flagged with `group`) so the grid, Gantt, rollups, filters,
// copy and Excel export treat them like WBS bands. Activities keep their real WBS.
import { EMPTY_WBS, type Activity, type ActivityCodeType, type Schedule, type Wbs } from "./model";

export interface Grouping {
  type: ActivityCodeType;
  /** The bands, in code dictionary order; activities without a value come last. */
  roots: Wbs[];
  /** The band each activity is in (for revealing an activity). */
  bandOf: Map<Activity, Wbs>;
}

/** Id of the band for activities that have no value for the code. */
const NONE = "none";

export function groupByCode(s: Schedule, type: ActivityCodeType): Grouping {
  const bands = new Map<string, { band: Wbs; seq: number }>();
  const bandOf = new Map<Activity, Wbs>();
  // A band's remaining duration is counted from the data date, which comes from its project.
  const project = s.projects[0] ?? null;
  for (const a of s.activities) {
    const v = a.codes.get(type.id);
    const key = v ? v.id : NONE;
    let entry = bands.get(key);
    if (!entry) {
      const band: Wbs = {
        ...structuredClone(EMPTY_WBS),
        id: `group:${type.id}:${key}`,
        project,
        code: v ? v.value : "",
        fullCode: v ? v.value : "",
        name: v ? v.description || v.value : `No ${type.label}`,
        group: type,
      };
      entry = { band, seq: v ? v.seq : Number.MAX_SAFE_INTEGER };
      bands.set(key, entry);
    }
    entry.band.activities.push(a);
    bandOf.set(a, entry.band);
  }
  const roots = [...bands.values()]
    .sort(
      (x, y) =>
        x.seq - y.seq ||
        x.band.code.localeCompare(y.band.code, undefined, { numeric: true, sensitivity: "base" }),
    )
    .map((e) => e.band);
  return { type, roots, bandOf };
}

/** The schedule as the grid and Gantt show it: its WBS tree, or the Group By bands. */
export function shownSchedule(s: Schedule, g: Grouping | null): Schedule {
  return g ? { ...s, roots: g.roots } : s;
}
