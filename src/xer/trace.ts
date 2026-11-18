// Trace Logic: the chain of predecessors and/or successors of one activity, following
// only driving relationships (why is this activity on this date?) or every relationship.
import type { Activity } from "./model";

export type TraceDirection = "pred" | "succ" | "both";

export interface TraceSpec {
  root: Activity;
  dir: TraceDirection;
  drivingOnly: boolean;
}

/** The root plus everything reachable from it in the chosen direction(s). */
export function traceLogic({ root, dir, drivingOnly }: TraceSpec): Set<Activity> {
  const out = new Set<Activity>([root]);
  const walk = (back: boolean) => {
    const stack = [root];
    while (stack.length) {
      const a = stack.pop()!;
      for (const r of back ? a.preds : a.succs) {
        if (drivingOnly && !r.driving) continue;
        const next = back ? r.pred : r.succ;
        if (out.has(next)) continue;
        out.add(next);
        stack.push(next);
      }
    }
  };
  if (dir !== "succ") walk(true);
  if (dir !== "pred") walk(false);
  return out;
}

export function describeTrace(t: TraceSpec): string {
  const what = t.drivingOnly ? "driving " : "";
  const dir = t.dir === "pred" ? "predecessors" : t.dir === "succ" ? "successors" : "predecessors and successors";
  return `${what}${dir} of ${t.root.code}`;
}
