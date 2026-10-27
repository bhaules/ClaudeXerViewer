# XER Viewer

A read-only viewer for Primavera P6 `.xer` files that looks and works like P6's
Activities view. It's a single HTML file, so it opens in any browser with
nothing to install. The schedule is read inside the browser and never uploaded.

## Sharing a schedule (instead of a PDF)

1. Open `dist/xer-viewer.html` in Chrome or Edge.
2. Drag your `.xer` onto the window, or use **File > Open** (Ctrl+O).
3. **File > Save Viewer with Schedule** (Ctrl+S) saves `<schedule>.html`.
4. Send that one file. The recipient double-clicks it and the schedule opens.

You can also send `xer-viewer.html` together with a `.xer` file and let people
open the `.xer` themselves.

## Using it

- **WBS**: double-click a band or click its arrow to expand/collapse.
  **View > Expand All / Collapse All / Expand To > Level n**.
- **Columns**: drag a header edge to resize. Click a header to sort activities
  within each WBS (click again for descending, a third time to reset).
  **View > Columns...** (or right-click the headers) opens the Columns dialog:
  pick from Available Options (including Labor Units and the file's activity
  UDFs) and order them under Selected Options. Double-click, the arrow buttons,
  Ctrl/Shift-click and the filter box all work as in P6.
- **Filters** (**View > Filters**, Ctrl+Shift+F): tick statuses, Critical or
  Milestones, or pick a date window ("Look ahead..." fills it from the data date).
  Type in the boxes under the column headers: text matches anywhere (`=x` exact,
  `<>x` excludes); numbers and dates take `>`, `<`, `>=`, `<=`, `=`, e.g. `>0` in
  Remaining Labor Units or `<01-Jul-26` in Finish. WBS totals show only what the
  filter matches. **Clear Filters** resets everything.
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
- **Gantt**: Ctrl+mouse wheel to zoom, **View > Zoom to Fit / Go to Data Date**.
  Driving relationships are drawn as arrows (red on the critical path). Choose
  **View > Relationship Lines > None / Driving Only / All**. The selected
  activity's lines are drawn thicker.
- **Durations**: **View > Duration Unit** (hours, days, weeks, months), converted
  with each activity's calendar.

Column choices, widths and units are remembered per browser.

## Development

Needs Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173/?file=/tests/fixtures/sample.xer
npm test
npm run build      # -> dist/xer-viewer.html
```

Put real `.xer` files in the project root to have `npm test` check them too
(they're gitignored). Project notes for Claude Code are in `CLAUDE.md`.
