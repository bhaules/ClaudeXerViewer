# Changelog

All notable changes to XER Viewer. Each version is a GitHub release with the viewer
attached as `xer-viewer-v<version>.html` (`xer-viewer.html` before 0.6.0).

## 0.6.1 (2026-11-13)

### Changed
- **WBS band durations use the activities' calendar.** A band's Original and Remaining
  Duration are now counted on the calendar most of its activities use, not the project's
  default calendar. A project calendar without holidays no longer adds a Christmas
  shutdown back into bands whose activities stop over Christmas.
- **Filter menu.** The filter bar is now a **Filter** menu, also opened from the toolbar's
  funnel button. It has the status, Critical, Milestones and With Comments filters,
  **Active Between...**, **Look Ahead** from the data date, **Filter Row** (the boxes
  under the column headers, Ctrl+Shift+F) and **Clear Filters**.
- **Filter indicator.** While anything is filtered, a yellow note in the status bar shows
  how many activities are showing, and the toolbar's funnel button is pressed.
- **Selected row in amber.** The selected row is amber in the grid and the Gantt, so it
  no longer disappears against a blue WBS band.

### Added
- **Resource list sort and filter.** Click a header in the Resource Usage list to sort
  it. Type in the boxes under the headers to filter it, e.g. `>20000` in Budgeted Units.
  **All Resources** then means the resources still listed.

### Fixed
- **Selection survives filtering.** Filtering keeps the selected activity selected and
  where it was on screen. Clearing a filter no longer jumps back to the top.
- **Resource filter can be cleared.** A resource selected on the Resource Usage tab
  filters the activities, but Clear Filters stayed greyed out. It now clears it.
- **Opening another file resets filters.** Opening a file now resets every filter and the
  filter indicators.

## 0.6.0 (2026-11-06)

### Changed
- **WBS band durations in working time.** Bands show working time between their
  summarised dates in the Duration Unit. The calendar-weeks option and **View > WBS Band
  Durations** were removed.

### Added
- **Version number.** The version is in the download's file name
  (`xer-viewer-v0.6.0.html`), in Help > About, on the welcome screen and in Excel exports.

## 0.5.0 (2026-11-06)

### Added
- **Toolbar.** A toolbar under the menus: Open, Save, Export to Excel, Expand/Collapse
  All, Find, Filters, Clear Filters, Gantt Chart, Zoom, Go to Data Date, Add Comment and
  Help. **View > Toolbar** hides it.
- **Column header menu.** Right-click a column header to sort it, filter it, clear its
  filter, hide it, or open the Columns dialog.

### Changed
- **View menu regrouped.** **Show on Bottom** (Relationships, Resource Usage, Comments,
  None) replaces the separate panel toggles, and the zoom commands are in **View > Zoom**.
- **Filters start hidden.** For new users the filter bar and filter row start hidden.

## 0.4.0 (2026-11-06)

### Added
- **Export to Excel.** File > Export to Excel (Ctrl+E for all rows) saves an `.xlsx`:
  - real Excel dates and numbers;
  - coloured WBS rows as outline groups;
  - a frozen header with AutoFilter;
  - an Export Info sheet.
- **Column funnels.** A funnel on each column header opens an Excel-style value filter:
  tick values, search, type a condition, or sort.
- **WBS band duration option.** View > WBS Band Durations could show bands in calendar
  weeks or working time.

### Fixed
- **Code columns in saved layouts.** Activity code columns now stay in the saved column
  layout after a reload.

## 0.3.0 (2026-10-29)

### Added
- **Activity codes.** Every activity code type is offered as two columns: the value and
  its description.
- **More columns:**
  - Secondary Constraint
  - Duration Type and % Complete Type
  - Primary Resource
  - WBS Code and Name, and Project
  - Actual Start/Finish and Expected Finish
  - Constraint dates
  - Physical % Complete
  - Nonlabor units

## 0.2.0 (2026-10-28)

### Added
- **Review comments.** Reviewers add comments to activities or WBS bands and save them
  in the HTML file. The scheduler imports several reviewers' files at once, ticks Done,
  and sees "Moved since" when dates have changed.
- **User Guide.** Help > User Guide (F1).

## 0.1.1 (2026-10-27)

### Added
- **WBS band durations.** WBS bands show Original and Remaining Duration in weeks from
  their summarised dates.

## 0.1.0 (2026-10-27)

First release:
- **Activities view:** a P6-style WBS grid, Gantt chart, and predecessor / successor
  panels.
- **Columns:** a Columns dialog with labor units and UDFs.
- **Find and filters:** Find, a filter bar and a filter row.
- **Resources:** a Resource Usage histogram with a manning option.
- **Sharing:** File > Save Viewer with Schedule.
