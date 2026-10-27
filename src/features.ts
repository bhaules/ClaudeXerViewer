// Feature switches (replaces the Python app's config.json). Turn a feature off
// here rather than deleting its code.
export const FEATURES = {
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
  /** File > Save Viewer with Schedule (one HTML file with the .xer inside). */
  embedSave: true,
  /** WBS levels expanded when a file opens. */
  defaultExpandLevel: 2,
} as const;
