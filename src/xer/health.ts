// Review > Schedule Check: a DCMA 14-point style health check of the open schedule.
// Counts are over incomplete activities (or their relationships), leaving out Level of
// Effort and WBS summary activities, as the DCMA assessment does.
import type { Comparison } from "./compare";
import { workHoursBetween } from "./compare";
import { isMilestone } from "./format";
import type { Activity, Relationship, Schedule } from "./model";

export interface CheckResult {
  id: string;
  /** DCMA point number, or "" for an extra check. */
  no: string;
  name: string;
  description: string;
  /** Activities or relationships that fail the check. */
  count: number;
  /** What it's counted out of (e.g. incomplete activities); 0 when not applicable. */
  total: number;
  of: string;
  /** Shown value: a percentage or a ratio. */
  value: string;
  target: string;
  /** null: not applicable or for information only. */
  pass: boolean | null;
  /** The activities to show when the check is clicked. */
  activities: Set<Activity>;
}

/** DCMA's limit for high float and high duration: 44 working days. */
const DAYS_44 = 44;
const HARD = new Set(["CS_MSO", "CS_MEO", "CS_MSOB", "CS_MEOB", "CS_MANDSTART", "CS_MANDFIN"]);

const pct = (n: number, of: number) => {
  if (!of) return "–";
  const p = (n / of) * 100;
  return n > 0 && p < 0.05 ? "<0.1%" : `${p.toFixed(1)}%`;
};
const ratio = (v: number) => v.toFixed(2);

export function checkSchedule(s: Schedule, cmp: Comparison | null = null): CheckResult[] {
  const counted = (a: Activity) => a.type !== "TT_LOE" && a.type !== "TT_WBS";
  const open = s.activities.filter((a) => counted(a) && a.status !== "Completed");
  const tasks = open.filter((a) => !isMilestone(a.type));
  // Relationships into incomplete activities.
  const rels = s.relationships.filter((r) => counted(r.pred) && counted(r.succ) && r.succ.status !== "Completed");
  const out: CheckResult[] = [];

  const byActs = (
    id: string,
    no: string,
    name: string,
    description: string,
    pool: Activity[],
    fails: (a: Activity) => boolean,
    limit: number | null,
    of = "incomplete activities",
  ) => {
    const bad = pool.filter(fails);
    out.push({
      id,
      no,
      name,
      description,
      count: bad.length,
      total: pool.length,
      of,
      value: pct(bad.length, pool.length),
      target: limit === null ? "" : limit === 0 ? "0" : `≤ ${limit}%`,
      pass: limit === null || !pool.length ? null : (bad.length / pool.length) * 100 <= limit,
      activities: new Set(bad),
    });
  };
  const byRels = (id: string, no: string, name: string, description: string, fails: (r: Relationship) => boolean, limit: number) => {
    const bad = rels.filter(fails);
    const acts = new Set<Activity>();
    for (const r of bad) acts.add(r.pred).add(r.succ);
    out.push({
      id,
      no,
      name,
      description,
      count: bad.length,
      total: rels.length,
      of: "relationships",
      value: pct(bad.length, rels.length),
      target: limit === 0 ? "0" : `≤ ${limit}%`,
      pass: rels.length ? (bad.length / rels.length) * 100 <= limit : null,
      activities: acts,
    });
  };

  byActs("logic", "1", "Missing logic", "No predecessor or no successor (open ends).", open, (a) => a.preds.length === 0 || a.succs.length === 0, 5);
  byRels("leads", "2", "Leads", "Relationships with a negative lag.", (r) => r.lagHrs < 0, 0);
  byRels("lags", "3", "Lags", "Relationships with a positive lag.", (r) => r.lagHrs > 0, 5);
  {
    const types = { SS: 0, FF: 0, SF: 0 };
    for (const r of rels) if (r.type !== "FS") types[r.type]++;
    byRels(
      "relTypes",
      "4",
      "Relationship types",
      `Not finish-to-start: ${types.SS} SS, ${types.FF} FF, ${types.SF} SF. At least 90% should be FS.`,
      (r) => r.type !== "FS",
      10,
    );
  }
  byActs("hardConstraints", "5", "Hard constraints", "Start/Finish On, On or Before, or Mandatory constraints.", open, (a) => HARD.has(a.constraint) || HARD.has(a.constraint2), 5);
  byActs(
    "highFloat",
    "6",
    "High float",
    `Total float over ${DAYS_44} working days.`,
    open,
    (a) => a.totalFloatHrs !== null && a.totalFloatHrs > DAYS_44 * a.calendar.dayHrs,
    5,
  );
  byActs("negativeFloat", "7", "Negative float", "Total float below zero.", open, (a) => a.totalFloatHrs !== null && a.totalFloatHrs < 0, 0);
  byActs(
    "highDuration",
    "8",
    "High duration",
    `Remaining duration over ${DAYS_44} working days (milestones left out).`,
    tasks,
    (a) => (a.remDurHrs ?? a.origDurHrs ?? 0) > DAYS_44 * a.calendar.dayHrs,
    5,
    "incomplete tasks",
  );
  {
    const dd = (a: Activity) => a.project?.dataDate ?? null;
    const invalid = (a: Activity) => {
      const d = dd(a);
      if (d === null) return false;
      if ((a.actualStart !== null && a.actualStart > d) || (a.actualFinish !== null && a.actualFinish > d)) return true;
      // Forecast dates (not actuals) must be on or after the data date.
      if (a.status !== "Completed" && !a.startActual && a.start !== null && a.start < d) return true;
      return a.status !== "Completed" && !a.finishActual && a.finish !== null && a.finish < d;
    };
    const pool = s.activities.filter(counted);
    byActs("invalidDates", "9", "Invalid dates", "Actual dates after the data date, or forecast dates before it.", pool, invalid, 0, "activities");
  }
  if (s.resources.length) {
    byActs("resources", "10", "Resources", "Incomplete tasks with a duration but no resource assigned.", tasks, (a) => (a.origDurHrs ?? 0) > 0 && a.assignments.length === 0, 0, "incomplete tasks");
  } else {
    out.push(na("resources", "10", "Resources", "The file has no resource assignments."));
  }

  // 11 and 14 need baseline dates: the loaded baseline, else P6's planned dates.
  const source = cmp ? `the baseline (${cmp.name})` : "planned dates (no baseline loaded)";
  const blFinish = (a: Activity) => (cmp ? cmp.changes.get(a)?.base?.finish ?? null : a.plannedFinish);
  const ddOf = (a: Activity) => a.project?.dataDate ?? null;
  const all = s.activities.filter(counted);
  const due = all.filter((a) => {
    const f = blFinish(a);
    const d = ddOf(a);
    return f !== null && d !== null && f <= d;
  });
  byActs(
    "missed",
    "11",
    "Missed activities",
    `Due to finish by the data date per ${source}, but finished late or not finished.`,
    due,
    (a) => a.actualFinish === null || a.actualFinish > blFinish(a)!,
    5,
    "activities due",
  );

  // 13: Critical Path Length Index for each project's latest-finishing open activity.
  {
    const ends = s.projects
      .map((p) => {
        let last: Activity | null = null;
        for (const a of open) if (a.project === p && a.finish !== null && (!last || a.finish > last.finish!)) last = a;
        return last;
      })
      .filter((a): a is Activity => a !== null);
    const a = ends[0] ?? null;
    const d = a ? ddOf(a) : null;
    if (!a || d === null || a.finish === null || a.totalFloatHrs === null) {
      out.push(na("cpli", "13", "Critical path length index", "Needs a data date and an open activity with total float."));
    } else {
      const len = workHoursBetween(a.calendar, d, a.finish);
      const cpli = len > 0 ? (len + a.totalFloatHrs) / len : 1;
      out.push({
        id: "cpli",
        no: "13",
        name: "Critical path length index",
        description: `(remaining critical path + total float) ÷ remaining critical path, to ${a.code} (finishes last).`,
        // A single ratio: no count to show.
        count: 0,
        total: 0,
        of: "",
        value: ratio(cpli),
        target: "≥ 0.95",
        pass: cpli >= 0.95,
        activities: new Set([a]),
      });
    }
  }

  // 14: Baseline Execution Index.
  {
    const finished = all.filter((a) => a.actualFinish !== null && ddOf(a) !== null && a.actualFinish <= ddOf(a)!).length;
    const notDone = due.filter((a) => a.actualFinish === null);
    out.push(
      due.length
        ? {
            id: "bei",
            no: "14",
            name: "Baseline execution index",
            description: `Activities finished ÷ activities due by the data date per ${source}. Clicking shows the due ones not finished.`,
            count: notDone.length,
            total: due.length,
            of: "activities due",
            value: ratio(finished / due.length),
            target: "≥ 0.95",
            pass: finished / due.length >= 0.95,
            activities: new Set(notDone),
          }
        : na("bei", "14", "Baseline execution index", `No activities were due by the data date per ${source}.`),
    );
  }

  // Extras that P6 schedulers look at.
  byRels("sf", "", "Start-to-finish relationships", "SF relationships are rarely right.", (r) => r.type === "SF", 0);
  byActs("critical", "", "Critical activities", "Incomplete activities on the critical path (for information).", open, (a) => a.critical, null);

  // DCMA order: 1-11, 13, 14, then extras.
  return out.sort((x, y) => (Number(x.no) || 99) - (Number(y.no) || 99));
}

function na(id: string, no: string, name: string, description: string): CheckResult {
  return { id, no, name, description, count: 0, total: 0, of: "", value: "–", target: "", pass: null, activities: new Set() };
}
