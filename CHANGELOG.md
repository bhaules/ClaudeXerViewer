# Changelog

All notable changes to XER Viewer. Each version is a GitHub release with the viewer
attached as `xer-viewer-v<version>.html` (`xer-viewer.html` before 0.6.0).

## 0.8.0 (2026-11-19)

### Added
- **Activity Details.** The first bottom tab is now **Activity Details**, like P6's, with
  tabs for the selected activity:
  - **General**: IDs, status, WBS, calendar, durations, float, dates, constraints, units,
    and baseline dates and changes when a baseline is loaded. A selected WBS band shows its
    summary.
  - **Relationships**: the Predecessors and Successors panels (as before).
  - **Resources**: assignments with budgeted, actual, remaining and at-completion units
    and dates.
  - **Codes** and **UDFs**: every activity code and user defined field on the activity.
  - **Notebook**: notebook notes by topic, as plain text.
  - **Steps**: steps with weight, % complete, description and the weighted total.
- **Schedule Check.** **Review > Schedule Check** runs a DCMA 14-point style health check
  (missing logic, leads, lags, relationship types, hard constraints, high and negative
  float, high duration, invalid dates, resources, missed activities, CPLI, BEI) with pass /
  fail. Click a check to show the activities it flags; **Export to Excel** saves the results
  and every flagged activity.
- **Resource Spreadsheet.** A bottom tab with resource usage as a table per week, month,
  quarter or year (total, actual or remaining units, or manning), exported to Excel.
- **Bar labels.** **View > Bar Labels** writes the activity name, ID, both, the finish
  date, or the start and finish dates next to each Gantt bar.
- **Changes to Excel.** **Export to Excel** on the Changes tab saves every change
  (deleted activities included) and a summary of counts.

### Changed
- **Calendars** dialog shows the whole year on one screen, with the work week across the
  top.

## 0.7.0 (2026-11-19)

### Added
- **Compare with a baseline.** **File > Compare with Baseline...** loads an earlier .xer
  (for example last month's update) and compares the open schedule with it, matching
  activities by Activity ID:
  - **Baseline columns**: BL Start, BL Finish, Start and Finish Variance (working time,
    P6 sign), BL Original Duration, Duration Variance, BL Total Float and Change.
    BL Finish, Finish Variance and Change are added after Finish the first time.
  - **Baseline bars**: a thin yellow bar under each Gantt bar.
  - **Changes tab**: every added, deleted, moved, re-planned or re-linked activity, with
    what changed. Pick a category, sort, click to go to the activity.
  - **Filter > Changes vs Baseline**: filter by kind of change.
  - Saved viewer files keep the baseline, so recipients see the comparison.
- **Trace Logic.** **Filter > Trace Logic** (or right-click an activity) shows only its
  driving predecessors, driving successors, both, or all predecessors / successors.
- **Copy rows.** **Edit > Copy** (Ctrl+C) copies the selected activity, or a WBS band
  with the rows under it, as a table for email, Teams, Word or Excel. **Copy All Rows
  as Shown** copies the whole view.
- **Zoom to a bar.** Double-click a row in the Gantt to zoom to its bar, like P6. Also
  **View > Zoom > Zoom to Selected** and **Zoom to Bar** on the row's right-click menu.
- **Calendars.** **View > Calendars...** shows each calendar's work week and a year view
  of holidays and changed-hours days.

### Changed
- **Gantt double-click** zooms to the bar instead of expanding or collapsing a WBS band
  (double-click in the grid still does that).
- **Right-click menus** can have submenus.

## 0.6.2 (2026-11-13)

### Added
- **Tab icon.** The page has its own icon (a small Gantt chart), so it is easy to spot in
  pinned tabs and bookmarks. It is built into the file and works offline.

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
