// Help > User Guide, Keyboard Shortcuts and About. Keep this in step with the features:
// when you add or change something users can do, describe it here.
import { modal } from "./dom";
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
      <p>XER Viewer shows a Primavera P6 schedule (<b>.xer</b> export) the way P6's Activities view does, in any browser, with nothing to install.</p>
      <ul>
        <li><b>Open a schedule:</b> <b>File &gt; Open</b> (Ctrl+O), or drag a <b>.xer</b> file onto the window.</li>
        <li><b>Saved viewer files</b> (<b>.html</b>) open straight to their schedule when you double-click them. You can also drop one onto a blank viewer.</li>
        <li>The <b>toolbar</b> under the menus has the everyday commands: Open, Save, Export to Excel, Expand / Collapse All, Find, the Filter menu, Clear Filters, Gantt Chart, Zoom In / Out / to Fit, Go to Data Date, Add Comment and this guide. Hover a button for its name and shortcut. <b>View &gt; Toolbar</b> hides it.</li>
        <li>The title bar shows the project and its <b>data date</b>. The status bar shows what's selected and how many activities and relationships the file has.</li>
        <li>Your choices (columns, widths, units, panels, histogram settings) are remembered in this browser.</li>
      </ul>`,
  },
  {
    id: "navigate",
    title: "Moving around",
    html: `
      <ul>
        <li>Activities are grouped by <b>WBS</b>. Click a band's arrow, double-click it, or press → / ← to expand or collapse it.</li>
        <li><b>View &gt; Expand All</b>, <b>Collapse All</b> and <b>Expand To &gt; Level n</b> open the whole tree to a level.</li>
        <li>Move with ↑ ↓, Page Up/Down, Home and End. ← on an activity jumps up to its WBS band.</li>
        <li>WBS bands show the summarised <b>Start</b> and <b>Finish</b>, the lowest <b>Total Float</b> and labour totals. Their <b>Original Duration</b> is the working time between the band's summarised Start and Finish, on the calendar most of its activities use (so a Christmas shutdown in the activities' calendar is left out even if the project calendar has none); <b>Remaining Duration</b> is the same from the data date (0 once everything under it is complete). They are not added up from the activities, so overlapping activities aren't counted twice. Both show in the Duration Unit, like the activities.</li>
        <li>The selected row is highlighted in <b>amber</b> in the grid and the Gantt, so it stands out from the blue WBS bands.</li>
        <li>Dates follow P6: <b>A</b> after a date means actual; <b>*</b> means a constraint applies.</li>
        <li><b>View &gt; Hide Empty WBS</b> hides bands with no activities under them.</li>
      </ul>`,
  },
  {
    id: "columns",
    title: "Columns and sorting",
    html: `
      <ul>
        <li><b>View &gt; Columns...</b> opens the Columns dialog. Pick from <b>Available Options</b> and order them under <b>Selected Options</b>. Double-click, the arrow buttons, Ctrl/Shift-click and the filter box all work.</li>
        <li>Available columns, grouped like P6:
          <ul>
            <li><b>General:</b> Activity ID and Name, Status, Activity Type, Calendar, Duration Type, Percent Complete Type, Primary and Secondary Constraint, Primary Resource, WBS Code, WBS Name, Project.</li>
            <li><b>Activity Codes:</b> every code type the file uses, each as the code value and as its description.</li>
            <li><b>Dates:</b> Start, Finish, Actual Start/Finish, Planned Start/Finish, Late Start/Finish, Expected Finish, constraint dates.</li>
            <li><b>Durations:</b> Original and Remaining Duration, Total and Free Float.</li>
            <li><b>Percent Complete:</b> Activity % Complete, Physical % Complete.</li>
            <li><b>Units:</b> Budgeted / Actual / Remaining Labor and Nonlabor Units (WBS bands show totals).</li>
            <li><b>User Defined Fields:</b> every activity UDF that has a value in the file.</li>
          </ul>
        </li>
        <li>Code and UDF columns are saved by name, so a layout carries over to other files that use the same codes and UDFs.</li>
        <li>Drag the edge of a header to resize a column.</li>
        <li>The <b>funnel</b> on each header opens that column's filter: sort buttons, a condition, and a list of the column's values to tick (see Find and filters).</li>
        <li><b>Right-click a column header</b> to sort it, filter it, clear its filter, hide it, or open the Columns dialog.</li>
        <li>Click a header to sort activities <b>within each WBS</b>; click again for descending, a third time to go back to the default (Start, then Activity ID). <b>View &gt; Clear Sort</b> also resets it.</li>
        <li><b>View &gt; Duration Unit</b> shows activity durations in hours, days, weeks or months, using each activity's own calendar.</li>
      </ul>`,
  },
  {
    id: "find",
    title: "Find and filters",
    html: `
      <ul>
        <li><b>Find</b> (Ctrl+F) searches Activity IDs and names. Enter or F3 for the next match, Shift+Enter or Shift+F3 for the previous. Matches are highlighted.</li>
        <li>The <b>Filter</b> menu (also the funnel button on the toolbar): tick <b>Not Started</b> / <b>In Progress</b> / <b>Completed</b>, <b>Critical</b>, <b>Milestones</b> or <b>With Comments</b>. <b>Active Between...</b> keeps activities that are underway at any point in a date range; <b>Look Ahead</b> sets that range from the data date (2 weeks to 3 months). Ticks show what's on.</li>
        <li><b>Filter &gt; Filter Row</b> (Ctrl+Shift+F) shows a row of boxes under the column headers. Type under any column. Text matches anywhere (<code>=x</code> exact, <code>&lt;&gt;x</code> excludes). Numbers and dates take <code>&gt;</code> <code>&lt;</code> <code>&gt;=</code> <code>&lt;=</code> <code>=</code>, e.g. <code>&gt;0</code> in Remaining Labor Units or <code>&lt;01-Jul-26</code> in Finish. A plain <code>Jul-26</code> finds any date in July 2026. A red box means the filter wasn't understood. Esc clears a box.</li>
        <li><b>Column funnel:</b> click the funnel on a column header for an Excel-style filter. Tick the values to keep (with how many activities have each; <i>(Blanks)</i> is the empty ones), search the list, type a condition (same as the filter row), or sort the column. The list only shows values left in by the other filters. A filtered column's funnel turns blue.</li>
        <li>While anything is filtered, a yellow note in the status bar says how many activities are showing, and the toolbar's funnel button is pressed. WBS bands only show matching activities and their totals are added up from those, like P6.</li>
        <li><b>Clear Filters</b> (Filter menu or toolbar) resets everything, including a resource selected on the Resource Usage tab. Hiding the filter row keeps what you typed; those columns' funnels stay blue.</li>
        <li>The <b>selected activity stays selected</b> while you filter. If it is still showing it stays where it was on screen, and when a filter that hid it is cleared, the grid scrolls back to it.</li>
        <li>Changing the Duration Unit drops values ticked in duration columns, since they were in the old unit.</li>
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
        ${swatch(GANTT.summary, "summary")} WBS summary &nbsp;
        ${swatch(GANTT.dataDate, "line")} Data date
      </p>
      <ul>
        <li><b>Zoom:</b> Ctrl + mouse wheel over the chart, or <b>View &gt; Zoom</b> (In, Out, Zoom to Fit). <b>View &gt; Go to Data Date</b> scrolls to the data date.</li>
        <li><b>Relationship lines</b> (<b>View &gt; Relationship Lines</b>): <b>Driving Only</b> (default) draws the relationships that drive each activity's dates; <b>All</b> adds the rest as dashed lines; <b>None</b> hides them. Lines are red when both ends are critical, and drawn thicker for the selected activity.</li>
        <li>Jumping to an activity (Find, a relationship, a comment) also scrolls the chart to its bar.</li>
        <li><b>View &gt; Gantt Chart</b> hides or shows it; drag the divider to change its width.</li>
      </ul>`,
  },
  {
    id: "relationships",
    title: "Relationships",
    html: `
      <ul>
        <li>The <b>Relationships</b> tab at the bottom lists the selected activity's <b>Predecessors</b> and <b>Successors</b> with relationship type (FS/SS/FF/SF), lag, whether it is <b>Driving</b>, dates, float and criticality.</li>
        <li>Double-click a row to jump to that activity. Click a column header to sort.</li>
        <li><b>View &gt; Show on Bottom</b> picks what the bottom panel shows (Relationships, Resource Usage or Comments), or <b>None</b> to hide it, like P6. You can also click its tabs; drag its top edge to resize it.</li>
      </ul>`,
  },
  {
    id: "resources",
    title: "Resource Usage (histogram)",
    html: `
      <ul>
        <li>The <b>Resource Usage</b> tab lists the resources with budgeted, actual and remaining units, and draws a histogram lined up under the Gantt (it follows the Gantt's zoom and scrolling).</li>
        <li>Click a column header in the resource list to sort it (again for descending, a third time for the file's order). Type in the boxes under the headers to filter it: text matches anywhere (<code>=x</code> exact, <code>&lt;&gt;x</code> excludes) and units take <code>&gt;</code> <code>&lt;</code> <code>&gt;=</code> <code>&lt;=</code> <code>=</code>, e.g. <code>&gt;20000</code>. <b>All Resources</b> then means the resources still listed.</li>
        <li>Click a resource to see it alone: actual in blue, remaining in green. Ctrl-click to add more; <b>All Resources</b> stacks every resource in its own colour. Hover a bar for the numbers.</li>
        <li>Selecting resources also shows only the activities that use them. Untick <b>Show only activities that use the selected resources</b> to keep everything in view.</li>
        <li><b>Bars by</b> sets each bar's period (Week by default) separately from the Gantt zoom. <b>Fit project</b> squeezes the whole project into view and keeps weekly bars.</li>
        <li><b>Manning</b> shows people instead of hours: hours ÷ the hours one person works per week (e.g. 70 for 7 × 10 h days). Longer bars are scaled, so a monthly bar shows the average crew for that month.</li>
        <li>Hours are spread evenly over each assignment's working time on the activity's calendar (no resource curves).</li>
      </ul>`,
  },
  {
    id: "comments",
    title: "Review comments",
    html: `
      <p><b>Reviewing a schedule someone sent you</b></p>
      <ol>
        <li>Right-click an activity or WBS band and choose <b>Add Comment</b> (or select it and press Ctrl+M). <b>Review &gt; Add General Comment</b> is for the schedule as a whole. You'll be asked your name the first time.</li>
        <li>Pick a type (Comment, Question, Change request or Error) and type your comment. Rows with comments get an orange marker.</li>
        <li>Save with <b>File &gt; Save Viewer with Schedule</b> (Ctrl+S). The file is named after you; send it back.</li>
      </ol>
      <p><b>Collecting comments</b></p>
      <ol>
        <li>Open your copy of the schedule, then drop all the returned files onto it at once (or <b>Review &gt; Import Reviewers' Files</b>). Importing the same file twice doesn't duplicate anything.</li>
        <li>The <b>Comments</b> tab lists every comment. Click one to jump to its activity; tick <b>Done</b> once you've made the change in P6; filter by Open / Done or by reviewer. The <b>Status</b> column is filled in automatically: <b>Moved since</b> (the activity's dates have changed since the comment was written), <b>Not in this schedule</b> (the activity was deleted or renumbered), or who marked it done and when.</li>
        <li><b>Filter &gt; With Comments</b> shows only the activities that have them.</li>
      </ol>
      <p>Comments are never written into the .xer or imported into P6. If the window is closed without saving, the browser warns you, and unsaved comments come back the next time the schedule is opened in the same browser.</p>`,
  },
  {
    id: "share",
    title: "Sending a schedule",
    html: `
      <ul>
        <li><b>File &gt; Save Viewer with Schedule</b> (Ctrl+S) saves one <b>.html</b> file with the schedule (and any comments) inside. Send it instead of a PDF: whoever receives it double-clicks it and the schedule opens, with nothing to install.</li>
        <li>The schedule is compressed, so the file is usually much smaller than the .xer.</li>
        <li><b>File &gt; Export to Excel</b> saves the grid as an <b>.xlsx</b>: <b>Rows as Shown</b> (what's expanded now) or <b>All Rows</b> (every WBS expanded, Ctrl+E). It has the columns you're showing, in order, with the current sort and filters. Dates and numbers are real Excel values, WBS bands keep their colours and become Excel row groups, and the header row is frozen with AutoFilter on. A second sheet, <b>Export Info</b>, records the file, data date, sort and filters. Chrome and Edge ask where to save; other browsers put it in Downloads. The A (actual) and * (constraint) date markers aren't carried across.</li>
      </ul>`,
  },
  {
    id: "notes",
    title: "Good to know",
    html: `
      <ul>
        <li><b>Private:</b> files are read inside this browser window. Nothing is uploaded or sent anywhere, and the viewer works offline. The Excel export is built in the browser too.</li>
        <li><b>Read-only:</b> the viewer never changes a .xer file. Make schedule changes in P6.</li>
        <li><b>Durations</b> are shown as P6 stored them when the schedule was last scheduled, converted with each activity's calendar. If your P6 is set to a fixed hours-per-day instead, day counts can differ for 10 or 12-hour calendars.</li>
        <li><b>Driving relationships</b> are worked out from the dates P6 exports, using each activity's working calendar.</li>
        <li>Large schedules (tens of thousands of activities) are fine: only the rows on screen are drawn.</li>
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

export function showShortcuts(): void {
  const rows: [string, string][] = [
    ["F1", "User guide"],
    ["Ctrl+O", "Open a .xer (or a saved viewer .html)"],
    ["Ctrl+S", "Save viewer with schedule (and comments)"],
    ["Ctrl+E", "Export all rows to Excel"],
    ["Ctrl+F", "Find activity by ID or name"],
    ["F3 / Shift+F3", "Find next / previous"],
    ["Ctrl+Shift+F", "Show / hide the filter row under the headers"],
    ["Ctrl+M or right-click a row", "Add a review comment"],
    ["↑ ↓ PgUp PgDn Home End", "Move selection"],
    ["→ / ←", "Expand / collapse WBS (← on an activity jumps to its WBS)"],
    ["Enter or double-click", "Expand / collapse WBS"],
    ["Double-click a relationship", "Go to that activity"],
    ["Ctrl+Mouse wheel on Gantt", "Zoom timescale"],
    ["Right-click a column header", "Sort, filter or hide that column"],
    ["Funnel on a column header", "Filter or sort that column"],
    ["Esc", "Close a dialog, menu or the Find box; clear a filter box"],
  ];
  modal("Keyboard Shortcuts", `<table class="hg-keys">${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join("")}</table>`);
}

export function showAbout(): void {
  modal(
    "About XER Viewer",
    `<p><b>XER Viewer</b> ${__APP_VERSION__}: a read-only viewer for Primavera P6 .xer files, in a single HTML file.</p>
     <p>Your file is read inside this browser window. Nothing is uploaded or sent anywhere.</p>
     <p>Source and downloads: <b>github.com/bhaules/ClaudeXerViewer</b></p>`,
  );
}
