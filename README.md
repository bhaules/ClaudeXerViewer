# XER Viewer

A read-only viewer for Primavera P6 `.xer` files that looks and works like P6's
Activities view. It's a single HTML file, so it opens in any browser with
nothing to install. The schedule is read inside the browser and never uploaded.

## Sharing a schedule (instead of a PDF)

1. Open `xer-viewer-v<version>.html` (from the Releases page, or `dist/` after a build)
   in Chrome or Edge. **Help > About** shows the version.
2. Drag your `.xer` onto the window, or use **File > Open** (Ctrl+O).
3. **File > Save Viewer with Schedule** (Ctrl+S) saves `<schedule>.html`.
4. Send that one file. The recipient double-clicks it and the schedule opens.

You can also send the viewer file together with a `.xer` file and let people
open the `.xer` themselves.

## Getting review comments back

1. Send the saved `.html` (above) to your reviewers.
2. They open it, enter their name once, then **right-click an activity or WBS band >
   Add Comment** (or select a row and press Ctrl+M). Comments can be a Comment,
   Question, Change request or Error. **Review > Add General Comment** is for the
   schedule as a whole. Rows with comments get an orange marker.
3. They save with **File > Save Viewer with Schedule** (Ctrl+S), which names the file
   after them (e.g. `Project - comments Jane Smith.html`), and send it back.
4. You open your copy and drop all the returned files on it at once (or use
   **Review > Import Reviewers' Files**). The **Comments** tab lists everything: click
   a comment to jump to its activity, tick **Done** as you make the change in P6, and
   filter by status or reviewer. The **Status** column is filled in automatically:
   "Moved since" when an activity's dates have changed since the comment was written,
   "Not in this schedule" when the activity was deleted or renumbered, or who marked
   it done. **Filter > With comments** shows only the activities that have them.

Comments are never written into the `.xer` and nothing is imported into P6: you make
the changes in P6 yourself. If someone closes the window without saving, the browser
warns them, and their unsaved comments come back the next time they open the schedule
in the same browser.

## Using it

- **Toolbar**: the everyday commands as buttons under the menus (Open, Save, Export
  to Excel, Expand/Collapse All, Find, Filters, Gantt and zoom, Add Comment, Help).
  Hover one for its shortcut. **View > Toolbar** hides it.
- **WBS**: double-click a band or click its arrow to expand/collapse.
  **View > Expand All / Collapse All / Expand To > Level n**.
- **Columns**: drag a header edge to resize. Click a header to sort activities
  within each WBS (click again for descending, a third time to reset).
  Right-click a header to sort, filter or hide that column.
  **View > Columns...** opens the Columns dialog:
  pick from Available Options and order them under Selected Options. Besides the
  usual P6 columns (dates, durations, float, constraints, duration and % complete
  types, primary resource, WBS code/name, labor and nonlabor units) it offers every
  **activity code** type in the file (value and description) and every activity
  **UDF** with values. Double-click, the arrow buttons, Ctrl/Shift-click and the
  filter box all work as in P6. Code and UDF columns are saved by name, so a layout
  carries over to other files that use them.
- **Filters** (**View > Filters**, Ctrl+Shift+F; hidden until turned on): tick statuses, Critical or
  Milestones, or pick a date window ("Look ahead..." fills it from the data date).
  Type in the boxes under the column headers: text matches anywhere (`=x` exact,
  `<>x` excludes); numbers and dates take `>`, `<`, `>=`, `<=`, `=`, e.g. `>0` in
  Remaining Labor Units or `<01-Jul-26` in Finish. WBS totals show only what the
  filter matches. **Clear Filters** resets everything.
- **Column filters**: the funnel on each column header opens an Excel-style filter:
  tick the values to keep (with counts, and (Blanks)), search the list, type a
  condition, or sort the column. A filtered column's funnel turns blue. Column filters
  stay on when the filter section is hidden; the status bar then says so.
- **Export to Excel** (**File > Export to Excel**, Ctrl+E for all rows): the columns
  you're showing, with the current sort and filters, as an `.xlsx`. Dates and numbers
  are real Excel values, WBS bands keep their colours and become row groups, and an
  Export Info sheet records the source file, data date and filters. It's built in the
  browser; nothing is uploaded.
- **Resource histogram**: the **Resource Usage** tab at the bottom lists the
  resources with their budgeted, actual and remaining units, and shows a histogram
  lined up under the Gantt (it follows the Gantt's zoom and scrolling). Click a
  resource to see it alone (actual blue, remaining green) and to show only the
  activities that use it; Ctrl-click to add more; **All Resources** stacks every
  resource in its own colour. Hover a bar for the numbers. Untick "Show only
  activities..." to keep all activities in view.
  **Bars by** sets the bar period (Week by default) independently of the Gantt zoom:
  press **Fit project** to squeeze the whole project into view and keep weekly bars.
  Tick **Manning** and enter the hours one person works per week (e.g. 70 for
  7 x 10 h days) to show people instead of hours; monthly bars then show the
  average crew for the month.
- **Relationships**: select an activity to see its predecessors and successors
  (type and lag) below. Double-click one to jump to it.
- **Find**: Ctrl+F, then Enter / F3 for next and Shift+Enter / Shift+F3 for previous.
- **Bottom panel**: **View > Show on Bottom** picks Relationships, Resource Usage,
  Comments or None, like P6.
- **Gantt**: Ctrl+mouse wheel to zoom, **View > Zoom** and **View > Go to Data Date**.
  Driving relationships are drawn as arrows (red on the critical path). Choose
  **View > Relationship Lines > None / Driving Only / All**. The selected
  activity's lines are drawn thicker.
- **Durations**: **View > Duration Unit** (hours, days, weeks, months), converted
  with each activity's calendar. WBS bands show the working time on the project
  calendar between their summarised start and finish (remaining: from the data date),
  in the same unit.

Column choices, widths and units are remembered per browser.

## Development

The version number is `version` in `package.json`. It goes into the built file's name
and Help > About, so bump it before building a release.

Needs Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173/?file=/tests/fixtures/sample.xer
npm test
npm run build      # -> dist/xer-viewer-v<version>.html
```

Put real `.xer` files in the project root to have `npm test` check them too
(they're gitignored). Project notes for Claude Code are in `CLAUDE.md`.
