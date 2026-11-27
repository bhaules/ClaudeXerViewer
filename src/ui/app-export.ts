// Saving the viewer, Excel exports and copying rows.
import { buildEmbeddedHtml, downloadText } from "../embed";
import { FEATURES } from "../features";
import { bandRows, rowsToTable, type CopiedTable } from "../xer/clipboard";
import { describeTrace } from "../xer/trace";
import { liveComments } from "../xer/comments";
import { formatDate } from "../xer/format";
import { buildRows, expandedAll, type GridRow } from "../xer/rows";
import { buildActivitiesXlsx, buildTableXlsx, XLSX_TYPE, type TableSheet } from "../xer/xlsx";
import { modal } from "./dom";
import { selectedTableRows } from "./table-select";
import { changesSheets, checkSheets, infoSheet } from "../xer/reports";
import { wbsColors } from "./theme";
import type { App } from "./app";
import { draftKey, reindexComments } from "./app-comments";
import { healthResults } from "./app-filters";

export async function saveEmbedded(app: App): Promise<void> {
  if (!app.fileBytes) return;
  if (import.meta.env.DEV) {
    modal("Not available in dev mode", "<p>Run <code>npm run build</code> and use <code>dist/xer-viewer-v*.html</code> to save a viewer with the schedule inside.</p>");
    return;
  }
  const html = await buildEmbeddedHtml({ name: app.fileName, bytes: app.fileBytes }, app.comments, app.baselineFile);
  // A reviewer's copy is named after them, so files coming back don't overwrite each other.
  const base = app.fileName.replace(/\.xer$/i, "");
  const mine = liveComments(app.comments).some((c) => c.author === app.prefs.reviewer);
  const who = mine && app.prefs.reviewer ? ` - comments ${app.prefs.reviewer.replace(/[\\/:*?"<>|]+/g, "")}` : "";
  const fileName = `${base}${who}.html`;
  downloadText(fileName, html, "text/html");
  app.commentsDirty = false;
  try {
    const key = draftKey(app);
    if (key) localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
  reindexComments(app);
  const n = liveComments(app.comments).length;
  app.setStatus(
    `Saved ${fileName} (${(html.length / 1_048_576).toFixed(1)} MB)` +
      (n ? ` with ${n} comment${n === 1 ? "" : "s"}` : "") +
      (app.baselineFile ? ` and the baseline ${app.baselineFile.name}` : "") +
      `. Send that one file: it opens straight to this schedule.`,
  );
}

/** The grid's columns and rows as an .xlsx: as shown, or with every WBS expanded. */
export async function exportExcel(app: App, allRows: boolean): Promise<void> {
  const s = app.schedule;
  if (!s) return;
  const ctx = app.view.ctx;
  const shown = app.shown();
  const rows = allRows ? buildRows(shown, { ...app.view, expanded: expandedAll(shown) }) : app.rows;
  if (!rows.length) {
    app.setStatus("Nothing to export: no rows match the current filters.");
    return;
  }
  const p = s.projects[0];
  await saveXlsx(app, 
    baseName(app) + ".xlsx",
    () =>
      buildActivitiesXlsx({
        sheetName: p?.shortName || "Activities",
        columns: app.columns().map((column) => ({ column, width: app.prefs.widths[column.key] ?? column.width })),
        rows,
        ctx,
        wbsColors,
        info: exportInfo(app, rows, allRows),
      }),
    `${rows.length.toLocaleString()} rows`,
  );
}

/** The open file's name without .xer. */
export function baseName(app: App): string {
  return app.fileName.replace(/\.xer$/i, "");
}

/**
 * Asks where to save (Chrome and Edge) or downloads (other browsers), then writes the
 * workbook `build` makes. `what` describes it in the status bar.
 */
export async function saveXlsx(app: App, fileName: string, build: () => Promise<Uint8Array>, what: string): Promise<void> {
  let handle: FileSystemFileHandle | null = null;
  const picker = (window as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      handle = await picker({ suggestedName: fileName, types: [{ description: "Excel workbook", accept: { [XLSX_TYPE]: [".xlsx"] } }] });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        app.setStatus("Export cancelled.");
        return;
      }
    }
  }
  app.setStatus("Building Excel file...");
  try {
    const bytes = await build();
    if (handle) {
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      app.setStatus(`Exported ${what} to ${handle.name}.`);
    } else {
      downloadText(fileName, bytes, XLSX_TYPE);
      app.setStatus(`Exported ${what} to ${fileName} (in your Downloads folder).`);
    }
  } catch (e) {
    console.error(e);
    app.setStatus(`Excel export failed: ${(e as Error).message}`);
  }
}

/** Common rows for the Export Info sheet of the extra exports. */
export function infoRows(app: App, extra: [string, string][] = []): [string, string][] {
  const p = app.schedule?.projects[0];
  return [
    ["Source file", app.fileName],
    ["Project", p ? `${p.shortName} - ${p.name}` : ""],
    ["Data date", p ? formatDate(p.dataDate) : ""],
    ...extra,
    ["Exported", new Date().toLocaleString()],
    ["Exported with", `XER Viewer ${__APP_VERSION__}`],
  ];
}

/** Changes tab > Export to Excel: every change and the counts. */
export async function exportChanges(app: App): Promise<void> {
  const cmp = app.cmp;
  if (!cmp) return;
  const units = { h: "Hours", d: "Days", w: "Weeks", m: "Months" } as const;
  const sheets = [
    ...changesSheets(cmp, app.view.ctx.unit),
    infoSheet(infoRows(app, [
      ["Baseline", cmp.name],
      ["Baseline data date", formatDate(cmp.baseline.projects[0]?.dataDate ?? null)],
      ["Duration unit", units[app.view.ctx.unit]],
      ["Variance", "Baseline minus current, in working time on each activity's calendar: negative means later than the baseline."],
      ["Left out", "Activities that were only progressed (no other change)."],
    ])),
  ];
  await saveXlsx(app, `${baseName(app)} - changes.xlsx`, () => buildTableXlsx(sheets), "the changes");
}

/** Schedule Check > Export to Excel. */
export async function exportChecks(app: App): Promise<void> {
  const results = healthResults(app);
  if (!results) return;
  const sheets = [
    ...checkSheets(results, app.view.ctx.unit),
    infoSheet(infoRows(app, [["Missed activities and BEI use", app.cmp ? `the baseline (${app.cmp.name})` : "planned dates (no baseline loaded)"]])),
  ];
  await saveXlsx(app, `${baseName(app)} - schedule check.xlsx`, () => buildTableXlsx(sheets), "the schedule check");
}

/** Resource Spreadsheet > Export to Excel (it builds its own sheets). */
export async function exportTables(app: App, sheets: TableSheet[], name: string, what: string): Promise<void> {
  // Put the source file and project at the top of the panel's own Export Info sheet.
  sheets = sheets.map((t) => (t.name === "Export Info" ? { ...t, rows: [...infoSheet(infoRows(app)).rows.slice(0, 2), ...t.rows] } : t));
  await saveXlsx(app, `${baseName(app)} - ${name}.xlsx`, () => buildTableXlsx(sheets), what);
}

/** The "Export Info" sheet: where the rows came from and what was filtered. */
export function exportInfo(app: App, rows: GridRow[], allRows: boolean): [string, string][] {
  const f = app.filterState;
  const label = (k: string) => app.view.columns.get(k)?.label ?? k;
  const columnFilters = [
    ...[...f.columns].filter(([, v]) => v.trim()).map(([k, v]) => `${label(k)}: ${v}`),
    ...[...f.values].map(([k, v]) => {
      const list = [...v].slice(0, 15).map((t) => (t === "" ? "(Blanks)" : t));
      return `${label(k)} in [${list.join(", ")}${v.size > 15 ? `, ... ${v.size - 15} more` : ""}]`;
    }),
  ];
  const other: string[] = [];
  if (f.statuses.size) other.push("Status: " + [...f.statuses].join(", "));
  if (f.criticalOnly) other.push("Critical only");
  if (f.milestonesOnly) other.push("Milestones only");
  if (f.commentedOnly) other.push("With comments");
  if (f.from !== null || f.to !== null) other.push(`Active between ${formatDate(f.from) || "..."} and ${formatDate(f.to) || "..."}`);
  if (app.resourceTabShown() && app.resources.activityFilter()) other.push(`Resource: ${app.resources.selectionLabel()}`);
  if (f.trace) other.push(`Trace: ${describeTrace(f.trace)}`);
  if (f.changes.size) other.push(`Changes vs baseline: ${[...f.changes].join(", ")}`);
  if (f.check) other.push(`Schedule check: ${f.check.name}`);
  const p = app.schedule?.projects[0];
  const sort = app.view.sort;
  const units = { h: "Hours", d: "Days", w: "Weeks", m: "Months" } as const;
  return [
    ["Source file", app.fileName],
    ["Project", p ? `${p.shortName} - ${p.name}` : ""],
    ["Data date", p ? formatDate(p.dataDate) : ""],
    ["Exported", new Date().toLocaleString()],
    ["Rows", `${rows.length.toLocaleString()} (${rows.filter((r) => r.kind === "act").length.toLocaleString()} activities, ${allRows ? "fully expanded" : "as shown"})`],
    ["Sort", sort ? `${label(sort.key)} ${sort.dir > 0 ? "ascending" : "descending"}` : "Default (Start, Activity ID)"],
    ["Column filters", columnFilters.join("; ") || "None"],
    ["Other filters", other.join("; ") || "None"],
    ["Duration unit", units[app.view.ctx.unit]],
    ["Baseline", app.baselineFile ? app.baselineFile.name : "None"],
    ["Exported with", `XER Viewer ${__APP_VERSION__}`],
    ["Note", "Dates are exported as Excel dates; P6 actual (A) and constraint (*) markers are not carried across."],
  ];
}

/** Edit > Copy: the selected activity, or a WBS band with every row shown under it. */
export function copySelected(app: App): void {
  const i = app.selectedIndex();
  if (i >= 0) copyRows(app, bandRows(app.rows, i));
}

export function copyRows(app: App, rows: GridRow[]): void {
  if (!rows.length) return;
  copyTable(app, rowsToTable(rows, app.columns(), app.view.ctx, wbsColors));
  copied(app, rows);
}

/** Puts a table on the clipboard, as text and HTML. */
export function copyTable(app: App, table: CopiedTable): void {
  app.pendingCopy = table;
  document.execCommand("copy"); // fires the copy event below
  if (!app.pendingCopy) return;
  app.pendingCopy = null;
  // The event didn't fire: use the clipboard API instead.
  const blob = (type: string, text: string) => ({ [type]: new Blob([text], { type }) });
  navigator.clipboard
    ?.write([new ClipboardItem({ ...blob("text/plain", table.text), ...blob("text/html", table.html) })])
    .catch(() => app.setStatus("The browser didn't allow copying to the clipboard.", true));
}

export function copied(app: App, rows: GridRow[]): void {
  const n = rows.length;
  app.setStatus(`Copied ${n.toLocaleString()} row${n === 1 ? "" : "s"} with the grid's columns. Paste into an email, Teams, Word or Excel.`);
}

/** Ctrl+C: rows picked in a bottom table, else the grid's. False leaves it to the browser. */
export function copyKey(app: App): boolean {
  if (!FEATURES.copyRows || !app.schedule) return false;
  // Leave normal copying alone: text boxes, selected text, dialogs.
  if (document.activeElement?.closest("input, textarea, select")) return false;
  if (document.querySelector(".modal-back") || window.getSelection()?.toString()) return false;
  const picked = selectedTableRows();
  if (picked) {
    copyTable(app, picked.table);
    app.setStatus(`Copied ${picked.count.toLocaleString()} row${picked.count === 1 ? "" : "s"}. Paste into a spreadsheet or an email.`);
    return true;
  }
  if (app.selectedIndex() < 0) return false;
  copySelected(app);
  return true;
}

export function installCopy(app: App): void {
  document.addEventListener("copy", (e) => {
    const table = app.pendingCopy;
    app.pendingCopy = null;
    if (!table) return;
    e.clipboardData?.setData("text/plain", table.text);
    e.clipboardData?.setData("text/html", table.html);
    e.preventDefault();
  });
}
