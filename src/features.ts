// Feature switches (replaces the Python app's config.json). Turn a feature off
// here rather than deleting its code.
export const FEATURES = {
  /** Toolbar under the menus (View > Toolbar). */
  toolbar: true,
  /** Gantt chart to the right of the grid. */
  gantt: true,
  /** Relationship lines on the Gantt (View > Relationship Lines; driving only by default). */
  ganttRelationships: true,
  /** Resource Usage tab in the bottom panel: resource list + histogram. */
  resourceHistogram: true,
  /** Predecessor / Successor panels under the grid. */
  relationships: true,
  /** Double-click a relationship row to jump to that activity. */
  relationshipNavigation: true,
  /** Ctrl+F find dialog with F3 / Shift+F3. */
  search: true,
  /** Filter bar (status, critical, milestones, dates) and the filter row under the headers. */
  filters: true,
  /** Click column headers to sort activities within their WBS. */
  sorting: true,
  /** View > Columns menu. */
  columnChooser: true,
  /** Review menu: comments on activities/WBS, saved inside the HTML, merged from reviewers' files. */
  comments: true,
  /** File > Save Viewer with Schedule (one HTML file with the .xer inside). */
  embedSave: true,
  /** File > Export to Excel (Ctrl+E): the grid's columns and rows as an .xlsx. */
  excelExport: true,
  /** File > Compare with Baseline: baseline columns and bars, the Changes tab and filter. */
  baselineCompare: true,
  /** Filter > Trace Logic: driving (or all) predecessors / successors of an activity. */
  traceLogic: true,
  /** Edit > Copy (Ctrl+C): rows as a table for email, Teams or Excel. */
  copyRows: true,
  /** View > Calendars: work weeks and holidays. */
  calendars: true,
  /** Activity Details tab: General, Relationships, Resources, Codes, UDFs, Notebook, Steps. */
  activityDetails: true,
  /** Resource Spreadsheet tab: usage per week / month / quarter / year, to Excel. */
  resourceSpreadsheet: true,
  /** Review > Schedule Check: DCMA 14-point style checks. */
  scheduleCheck: true,
  /** View > Bar Labels on the Gantt. */
  barLabels: true,
  /** Check GitHub for a newer version (at startup and while open), and Help > Check for Updates Now. */
  updateCheck: true,
  /** WBS levels expanded when a file opens (Infinity = all). */
  defaultExpandLevel: Infinity,
} as const;
