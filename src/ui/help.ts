// Help > User Guide, Keyboard Shortcuts and About. Keep this in step with the features:
// when you add or change something users can do, describe it here. Keep it short: one
// line per thing, what to click and what it does. Details belong in tooltips and dialogs.
import changelog from "../../CHANGELOG.md?raw";
import { parseChangelog } from "../xer/changelog";
import { esc, modal } from "./dom";
import { GANTT, wbsColors } from "./theme";

const swatch = (color: string, shape: "bar" | "diamond" | "line" | "summary" = "bar") =>
  `<span class="hg-sw hg-${shape}" style="--c:${color}"></span>`;

interface Section {
  id: string;
  title: string;
  html: string;
}

const SECTIONS: Section[] = [
  {
    id: "start",
    title: "Getting started",
    html: `
      <p>XER Viewer shows a P6 <b>.xer</b> export like P6's Activities view, in your browser. Nothing is installed and nothing is uploaded.</p>
      <ul>
        <li><b>Open a schedule:</b> <b>File &gt; Open</b> (Ctrl+O), or drag a .xer onto the window.</li>
        <li><b>Right-click</b> a row, the Gantt or a column header for the commands you'll use most.</li>
        <li>Hover a toolbar button to see what it does.</li>
        <li>Your columns and settings are remembered in this browser.</li>
        <li>Refreshing the page closes an opened .xer, so the browser asks first.</li>
      </ul>`,
  },
  {
    id: "grid",
    title: "Grid and columns",
    html: `
      <ul>
        <li>Activities are grouped by <b>WBS</b>. Double-click a band, or press → / ←, to expand or collapse it. <b>View &gt; Expand All</b> and <b>Collapse All</b> do the lot.</li>
        <li>Dates: <b>A</b> = actual, <b>*</b> = constrained. The selected row is amber.</li>
        <li>WBS bands show their summary dates, lowest float and totals.</li>
        <li><b>View &gt; Columns...</b> picks the columns, including activity codes, UDFs and baseline columns.</li>
        <li>Drag a header to move a column; drag its edge to resize it.</li>
        <li>Click a header to sort (within each WBS). Click again for descending, a third time to reset.</li>
        <li><b>View &gt; Duration Unit</b> shows hours, days, weeks or months.</li>
        <li><b>View &gt; Calendars...</b> shows each calendar's work week and holidays.</li>
      </ul>`,
  },
  {
    id: "find",
    title: "Find and filters",
    html: `
      <ul>
        <li><b>Find</b> (Ctrl+F) searches IDs and names. F3 / Shift+F3 for next / previous.</li>
        <li>The <b>Filter</b> menu (or the toolbar funnel): status, Critical, Milestones, With Comments, Active Between and Look Ahead.</li>
        <li>The <b>funnel</b> on a column header filters it like Excel: tick values or type a condition.</li>
        <li><b>Filter &gt; Filter Row</b> (Ctrl+Shift+F) puts a box under each header. Type text, or e.g. <code>&gt;0</code> or <code>&lt;01-Jul-26</code>.</li>
        <li>While anything is filtered, a yellow note in the status bar says so. <b>Clear Filters</b> resets everything.</li>
        <li><b>Trace Logic</b> (Filter menu, or right-click an activity) shows only what drives an activity, or what it drives.</li>
      </ul>`,
  },
  {
    id: "gantt",
    title: "Gantt chart",
    html: `
      <p>
        ${swatch(GANTT.remaining)} Remaining &nbsp;
        ${swatch(GANTT.actual)} Actual &nbsp;
        ${swatch(GANTT.critical)} Critical &nbsp;
        ${swatch(GANTT.remaining, "diamond")} Milestone &nbsp;
        ${swatch(GANTT.summary, "summary")} WBS &nbsp;
        ${swatch(GANTT.baseline)} Baseline &nbsp;
        ${swatch(GANTT.dataDate, "line")} Data date
      </p>
      <ul>
        <li><b>Zoom:</b> Ctrl + mouse wheel, or <b>View &gt; Zoom</b>. Double-click a row to zoom to its bar.</li>
        <li>Drag left or right on the chart to make the weeks (or months) narrower or wider.</li>
        <li><b>View &gt; Relationship Lines</b>: Driving Only, All or None.</li>
        <li><b>View &gt; Bar Labels</b> writes names or dates next to the bars.</li>
      </ul>`,
  },
  {
    id: "bottom",
    title: "Bottom panel",
    html: `
      <ul>
        <li><b>Activity Details:</b> the selected activity's general info, relationships, resources, codes, UDFs, notebook and steps. Double-click a relationship to go to that activity.</li>
        <li><b>Resource Usage:</b> a histogram under the Gantt. Click a resource, or Ctrl-click several. <b>Manning</b> shows people instead of hours.</li>
        <li><b>Resource Spreadsheet:</b> the same numbers as a table by week, month, quarter or year.</li>
        <li><b>Comments</b>, <b>Changes</b> and <b>Schedule Check</b>: see below.</li>
        <li>Click rows in a bottom table and press Ctrl+C to copy them.</li>
        <li><b>View &gt; Show on Bottom</b> picks the tab, or hides the panel.</li>
      </ul>`,
  },
  {
    id: "baseline",
    title: "Comparing with a baseline",
    html: `
      <ul>
        <li><b>File &gt; Compare with Baseline...</b> and pick an earlier .xer, e.g. last month's. Activities are matched by ID.</li>
        <li>You get baseline columns (BL Finish, Finish Variance, Change) and yellow baseline bars. Variance is like P6: <b>-5d</b> = 5 days later.</li>
        <li>The <b>Changes</b> tab lists every added, deleted, moved or re-linked activity. Click one to go to it.</li>
        <li><b>Filter &gt; Changes vs Baseline</b> shows one kind of change.</li>
      </ul>`,
  },
  {
    id: "check",
    title: "Schedule Check",
    html: `
      <ul>
        <li><b>Review &gt; Schedule Check</b> runs a DCMA 14-point style health check (logic, leads, lags, constraints, float, durations, dates...) with Pass / Fail for each.</li>
        <li>Click a check to see the activities it flags.</li>
      </ul>`,
  },
  {
    id: "comments",
    title: "Review comments",
    html: `
      <ul>
        <li><b>Reviewing:</b> right-click a row and choose <b>Add Comment</b> (Ctrl+M). Save with Ctrl+S and send the file back.</li>
        <li><b>Collecting:</b> drop all the returned files onto your copy at once. The <b>Comments</b> tab lists them; tick <b>Done</b> as you deal with them.</li>
        <li><b>Moved since</b> means the activity's dates have changed since the comment was written.</li>
        <li>Comments stay in the viewer file. They never go into the .xer or P6.</li>
      </ul>`,
  },
  {
    id: "share",
    title: "Sharing and Excel",
    html: `
      <ul>
        <li><b>File &gt; Save Viewer with Schedule</b> (Ctrl+S) saves one .html file with the schedule inside. Send it instead of a PDF; it opens with a double-click.</li>
        <li><b>Edit &gt; Copy</b> (Ctrl+C) copies the selected row, or a WBS band with its rows, for email, Teams or Excel.</li>
        <li><b>File &gt; Export to Excel</b> saves the grid with your columns, sort and filters. Ctrl+E exports every row.</li>
        <li>The Changes, Schedule Check and Resource Spreadsheet tabs each have their own <b>Export to Excel</b>.</li>
      </ul>`,
  },
  {
    id: "updates",
    title: "Updates",
    html: `
      <ul>
        <li>When a new version is out, a blue bar appears under the toolbar.</li>
        <li>To update: download it, save it in place of your current file with the same name, and press F5. Your settings carry over.</li>
        <li><b>Help &gt; What's New</b> lists the changes. <b>Help &gt; Notify About Updates</b> turns the bar off.</li>
      </ul>`,
  },
  {
    id: "notes",
    title: "Good to know",
    html: `
      <ul>
        <li><b>Private:</b> your schedule never leaves this computer. The update check is the only network request, and it sends nothing about you or your schedule.</li>
        <li><b>Read-only:</b> the viewer never changes a .xer. Make changes in P6.</li>
        <li>Durations and float are converted with each activity's calendar, as P6 last scheduled them.</li>
      </ul>`,
  },
];

/** Help > User Guide (F1). */
export function showUserGuide(): void {
  const toc = SECTIONS.map((s) => `<li><a href="#" data-go="${s.id}">${s.title}</a></li>`).join("");
  const body = SECTIONS.map((s) => `<section id="hg-${s.id}"><h3>${s.title}</h3>${s.html}</section>`).join("");
  const [wbs0] = wbsColors(0);
  const box = modal(
    "XER Viewer – User Guide",
    `<div class="hg"><nav class="hg-toc" style="--accent:${wbs0}"><ul>${toc}</ul></nav><div class="hg-body">${body}</div></div>`,
    "modal-wide",
  );
  const content = box.querySelector<HTMLElement>(".hg-body")!;
  box.querySelector(".hg-toc")!.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("a[data-go]");
    if (!a) return;
    e.preventDefault();
    const target = box.querySelector<HTMLElement>(`#hg-${a.dataset.go}`);
    // .hg-body is position: relative, so offsetTop is already measured from it.
    if (target) content.scrollTop = target.offsetTop;
  });
}

/** Help > Keyboard Shortcuts: keys first, then the mouse. */
export function showShortcuts(): void {
  const keys: [string, string][] = [
    ["F1", "User Guide"],
    ["Ctrl+O", "Open"],
    ["Ctrl+S", "Save viewer with schedule"],
    ["Ctrl+E", "Export all rows to Excel"],
    ["Ctrl+C", "Copy the selected row(s)"],
    ["Ctrl+F", "Find"],
    ["F3 / Shift+F3", "Find next / previous"],
    ["Ctrl+Shift+F", "Filter row on / off"],
    ["Ctrl+M", "Add a comment"],
    ["→ / ←", "Expand / collapse a WBS"],
    ["Esc", "Close a dialog, menu or Find"],
  ];
  const mouse: [string, string][] = [
    ["Right-click", "Menu for a row, the Gantt or a column header"],
    ["Double-click a WBS band", "Expand / collapse it"],
    ["Double-click a relationship", "Go to that activity"],
    ["Double-click a row in the Gantt", "Zoom to its bar"],
    ["Ctrl + wheel on the Gantt", "Zoom"],
    ["Drag on the Gantt", "Make the periods narrower / wider"],
    ["Drag a column header", "Move the column"],
  ];
  const rows = (list: [string, string][]) => list.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join("");
  modal(
    "Keyboard Shortcuts",
    `<table class="hg-keys">${rows(keys)}<tr><th colspan="2">Mouse</th></tr>${rows(mouse)}</table>`,
  );
}

/** Help > What's New: CHANGELOG.md in brief, newest first. */
export function showWhatsNew(): void {
  const html = parseChangelog(changelog)
    .map(
      (r) =>
        `<h4>${esc(r.version)} <span>${esc(r.date)}${r.version === __APP_VERSION__ ? " (this version)" : ""}</span></h4>` +
        r.sections.map(([name, items]) => (name ? `<b>${esc(name)}</b>` : "") + `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join(""),
    )
    .join("");
  modal("What's New", `<div class="wn">${html}</div>`, "modal-wide");
}

export function showAbout(): void {
  modal(
    "About XER Viewer",
    `<p><b>XER Viewer</b> ${__APP_VERSION__}: a read-only viewer for Primavera P6 .xer files, in a single HTML file.</p>
     <p>Your file is read inside this browser window and never uploaded.</p>
     <p>Source and downloads: <b>github.com/bhaules/ClaudeXerViewer</b></p>`,
  );
}
