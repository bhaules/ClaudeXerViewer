# UI behaviour

Reference for `src/ui/*`. Read the section a task touches. Match P6, don't invent.

## Grid and Gantt scrolling
Grid and Gantt share `ROW_HEIGHT` and `HEADER_HEIGHT`, and both scroll areas use
`overflow: scroll` so their scrollbars match; change those together or rows drift.
Vertical scroll sync: each side reports only real scrollTop changes (horizontal
scrolls fire `scroll` too). The `scrollTop` setters (used for syncing) remember the
value they set and the scroll handler swallows that echo instead of reporting it
back: during a smooth wheel scroll the echo arrives a frame late and would drag the
other pane backwards, making scrolling crawl. Because setters don't report back,
code that scrolls one pane programmatically must set the other too (see `select`,
`load`). Don't use an rAF-based "syncing" flag: hidden windows never run rAF.
Grid rows are reused and selection is a class toggle: never re-create the row
under the mouse on mousedown, or double-click stops working.

## Layout and look
- Menu bar; activity grid left, Gantt right (shared vertical scroll);
  Predecessors | Successors panels below; status bar.
- WBS band rows: bold, colour by level (P6/Python palette in `src/ui/theme.ts`),
  white text on the dark levels, rolled-up start/finish and min total float.
  Band Original / Remaining Duration come from the band's summarised dates, never from
  activity durations (`wbsWorkHours`): working hours from start to finish, and from
  max(start, data date) to finish (0 when all complete), on `Wbs.calendar` = the
  calendar most of the band's (filtered) activities use, ties to the project calendar
  (set in `rollUp`). Projects often have a no-holiday default calendar while the
  activities have a Christmas break, so the project calendar overstates bands. Shown in
  the Duration Unit with that calendar's hours per day. Cached per calendar and dates.
- Selection: grid row and Gantt use amber (`--row-select`, `GANTT.selection`), never a
  blue (WBS bands are blue). Filtering never drops the selection: `rebuildKeepingSelection`
  keeps it at the same screen height, or centres it when a filter that hid it goes away.
- Dates `dd-Mmm-yy`; suffix ` A` for actuals, `*` when a constraint applies.
- Under each WBS band: its own activities first, then its child WBS bands.
- Files open fully expanded (`FEATURES.defaultExpandLevel`). `beforeunload` warns when a
  refresh would lose an opened .xer or baseline (not a saved copy's own) or comments.

## Group By
- View > Group By (`src/xer/group.ts`): bands per activity code value are Wbs-shaped nodes
  with `group` set (not real WBS: no comments on them, `a.wbs` stays the real WBS);
  `shownSchedule` swaps them in as `roots`, so rows, rollups, Gantt, copy and Excel work
  unchanged. App code that shows or expands bands uses `app.shown()`, and
  `revealActivity` takes `bandOf`. The choice is saved in prefs by code type name (`groupBy`).

## Activity Details
- `src/ui/details.ts`: General, Relationships, Resources, Codes, UDFs, Notebook, Steps.
  General reuses each column's `text`.

## Sorting, keys, jumping
- Sorting reorders activities WITHIN their WBS; WBS stay in seq_num order.
  Header click cycles ascending -> descending -> default (Start, then ID). Blanks sort last.
- Double-click WBS row toggles; double-click relationship row jumps to that
  activity (expanding its WBS). Keys: Ctrl+F, F3/Shift+F3, arrows, Left/Right
  collapse/expand, Ctrl+O open.
- Jumping to an activity (Find, relationship double-click) also scrolls the Gantt
  sideways to its bar. Double-clicking a row in the Gantt zooms to its bar
  (`Gantt.focusRange`), like P6; it does not expand/collapse WBS.
- Jumping (`goTo`) to an activity the filter hides adds it to `extras`: shown until
  `applyFilter()` runs without `keepExtras` (P6 behaviour). `view.filter` includes extras.

## Gantt
- Remaining = green, actual = blue, critical = red, milestones as
  diamonds, WBS summary bars dark, data date as a vertical line.
- Relationship lines (View > Relationship Lines: None / Driving Only (default) / All):
  driving solid, non-driving dashed, red when both ends are critical; lines touching
  the selected activity drawn thicker. Only rows expanded into view get lines.
- Dragging on the Gantt or its header stretches the timescale (`startStretch`) and holds the
  tiers (`held`) until the next zoom; View > Timescale fixes them. Periods too narrow to
  label are labelled every nth (`periods`). Dragging a grid header moves its column.
- Baseline (File > Compare with Baseline): variance = baseline minus current in working
  hours on the activity's calendar (P6 sign: negative = later). Baseline bars are thin
  yellow bars under the current bars, which move up 3 px while a baseline is loaded.
  "Any change" excludes progress-only changes. Opening another .xer keeps the baseline.

## Bottom panel
- Tabs: Activity Details | Resource Usage | Resource Spreadsheet | Comments |
  Changes | Schedule Check.
- Predecessor/Successor panels have a Driving column. They sit on the Relationships tab of
  Activity Details (bottom tab id "details"; old prefs with "relationships" are mapped).
- Resource Usage (`src/ui/resources.ts`): the resource list is kept exactly as wide as
  the grid and the histogram uses the Gantt's timescale (`Gantt.timeline()`, redrawn
  from `onDraw`), so bars line up under the Gantt. Bar period is a setting ("Bars by",
  default Week, or "Follow Gantt zoom"), so weekly bars stay weekly when the Gantt is
  squeezed to fit the whole project; the axis labels under the bars follow the Gantt's
  own tier so they stay readable. Manning option (P6's "Calculate Average"): hours ÷
  hours-per-person-week, scaled to the bar's length (`toManning`), so monthly bars show
  average people too. Settings are saved in prefs (`histogram`). One selected
  resource: actual blue + remaining green. All / several (Ctrl-click): stacked, one
  palette colour per resource, actual in a darker shade. The y scale is fixed for the
  whole project at the current zoom so bars don't jump while scrolling. The resource
  list sorts by header click and has a filter row (`valueTest` in filter.ts); with "All
  Resources" selected and the list filtered, "all" means the listed resources (histogram
  and activity filter). Selecting resources filters activities (combined with the other
  filters in `applyFilter`) only while the Resource Usage tab is on screen and its
  checkbox is ticked; the status bar's filter note names it. Clear Filters also resets
  to All Resources.

## Menus
- View is grouped (Columns / units / Hide Empty WBS; expand; Clear Sort;
  Toolbar / Gantt Chart / Show on Bottom (P6's name: the bottom
  tabs, or None); Relationship Lines / Zoom / Go to Data Date).
- Right-clicking a column header opens a menu (sort, filter, clear filter, hide,
  Columns...). The Filter menu (`src/ui/filter-menu.ts`; the toolbar funnel opens it via
  `MenuBar.openAt`) has the quick filters (status, critical, milestones, with comments,
  Active Between... dialog, Look Ahead from the data date), Filter Row and Clear Filters.
- Right-click popups (`popupMenu`) support submenus, like the menu bar. Grid and Gantt share
  `rowMenu` (index -1 = empty area); `ganttOptions` is shared with the View menu.

## Filters
- The quick filters above, and a filter row under the grid headers (Filter >
  Filter Row, Ctrl+Shift+F, off by default). While anything is filtered (`view.filter`,
  which includes the resource filter) the status bar shows a yellow "Filter on: showing
  n of m" note and Clear Filters is enabled; opening a file resets and re-applies.
- Logic is in `src/xer/filter.ts`; column expressions follow
  `Column.kind` (text: contains / =x / <>x; number and date: > < >= <= = <>; numbers
  are in the displayed duration unit). While filtering, WBS with no matches are hidden
  and WBS totals are re-added from matching activities only (`applyRollups`), like P6.
- Column funnels (`FilterState.values`: column key -> ticked display texts) give an
  Excel-style value list; its values come from activities passing the OTHER filters.
- Hiding the filter row keeps typed filters (funnels stay highlighted, the status note
  stays), so nothing is filtered invisibly. Changing the Duration Unit drops ticked values
  on duration columns (their text changed). The filter row's inputs are only rebuilt when
  columns/widths change, never while typing (that would steal focus).

## Export to Excel
- Ctrl+E = all rows, or rows as shown: visible columns in order,
  current sort/filters; activity dates/numbers as values (via `sortValue`), WBS rows as
  coloured bold rows with outline levels (max 7), WBS dates/numbers parsed back from
  their text. Uses `showSaveFilePicker` when available, else a download.

## Review comments
- Never in the .xer and never imported into P6: they live in the saved HTML file.
  Reviewers add them (right-click a row / Ctrl+M / Review menu), save, and send the
  file back; the scheduler imports several returned files at once (Review > Import
  Reviewers' Files, or drop several .html on an open schedule) and ticks Done.
- Targets are keyed by Activity ID (`task_code`) or WBS full code plus project short
  name, never internal ids, so comments land on the right row in a newer export.
  Each comment keeps a snapshot of the row's dates; the panel's automatic Status column
  says "Moved since" when they differ (also "Not in this schedule" and "Done by").
- Merging (`mergeComments`) is by comment id; the copy with the later `updated` wins.
  Replies (`replies`) merge separately by reply id (later `updated` wins, deletes are
  tombstones), and adding one doesn't bump the comment's `updated`, so a reviewer's edit
  and the scheduler's reply made in different files both survive.
  Deletes are tombstones (`deleted: true`) and are saved too, so merging an older
  file can't bring a deleted comment back. Importing the same file twice is a no-op.
- Saving: Ctrl+S includes the comments; a reviewer's copy is named
  `<schedule> - comments <name>.html`. Unsaved changes mark the tab "*", trigger the
  browser's leave-page warning, and are backed up in localStorage
  (`xer-viewer-comment-draft:<project>`) and recovered on the next open; saving clears it.
- No identity check: the reviewer name is typed and remembered per browser.

## Update check
`src/ui/update.ts`: GitHub's latest release, silent on failure, asked at most every 4 h
per browser (the open page looks every 30 min and on tab focus, reusing the saved answer),
never in saved copies or dev; a newer version shows a bar under the toolbar, not a popup;
offers only links under this repo's releases. It must never send anything about the
schedule or the user.
