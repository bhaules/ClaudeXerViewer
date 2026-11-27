// File > Compare with Baseline.
import { extractEmbeddedXer } from "../embed";
import { compareSchedules } from "../xer/compare";
import { esc, modal } from "./dom";
import type { App } from "./app";
import { applyFilter } from "./app-filters";

/** Compares the open schedule with the loaded baseline (if any). */
export function recompare(app: App): void {
  const cmp = app.schedule && app.baseline && app.baselineFile ? compareSchedules(app.schedule, app.baseline, app.baselineFile.name) : null;
  app.view.ctx = { ...app.view.ctx, cmp };
}

/** File > Compare with Baseline: an earlier .xer, or a saved viewer .html with one inside. */
export async function openBaseline(app: App, file: File): Promise<void> {
  if (!/\.html?$/i.test(file.name)) {
    await app.setBaseline(file.name, new Uint8Array(await file.arrayBuffer()));
    return;
  }
  const embedded = await extractEmbeddedXer(await file.text()).catch(() => null);
  if (!embedded) {
    modal("Can't open baseline", `<p><b>${esc(file.name)}</b></p><p>This HTML file doesn't contain a schedule.</p>`);
    return;
  }
  await app.setBaseline(embedded.name, embedded.bytes);
}

export function removeBaseline(app: App): void {
  app.baseline = null;
  app.baselineFile = null;
  recompare(app);
  app.filterState.changes.clear();
  // Baseline columns would only be empty now; loading a baseline brings them back.
  const shown = app.columns().map((c) => c.key);
  const keep = shown.filter((k) => app.view.columns.get(k)?.group !== "Baseline");
  if (keep.length && keep.length < shown.length) app.setColumns(keep);
  else applyFilter(app);
  app.grid.render();
  app.gantt.draw();
  app.changesPanel.render();
  app.setStatus("Baseline removed.");
}

/** Makes room on the Gantt for baseline bars outside the schedule's own dates. */
export function extendGanttForBaseline(app: App): void {
  const b = app.baseline;
  if (!b || !app.cmp) return;
  let first: number | null = null;
  let last: number | null = null;
  for (const r of b.roots) {
    if (r.start !== null && (first === null || r.start < first)) first = r.start;
    if (r.finish !== null && (last === null || r.finish > last)) last = r.finish;
  }
  app.gantt.extendRange(first, last);
}
