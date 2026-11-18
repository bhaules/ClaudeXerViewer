// Edit > Copy: grid rows as a table for pasting into an email, Teams, Word or Excel.
// Plain text is tab-separated; the HTML version keeps the WBS band colours.
import type { Column, ColumnContext } from "./columns";
import type { GridRow } from "./rows";

export interface CopiedTable {
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Header plus one line per row, in the grid's column order. */
export function rowsToTable(
  rows: GridRow[],
  columns: Column[],
  ctx: ColumnContext,
  wbsColors: (level: number) => [string, string],
): CopiedTable {
  const minLevel = Math.min(...rows.map((r) => r.level));
  const cell = (r: GridRow, c: Column) => (r.kind === "wbs" ? c.wbsText(r.wbs, ctx) : c.text(r.act, ctx));
  const text = [
    columns.map((c) => c.label).join("\t"),
    ...rows.map((r) => columns.map((c) => cell(r, c).replace(/[\t\r\n]+/g, " ")).join("\t")),
  ].join("\r\n");

  const font = "font-family:Segoe UI,Arial,sans-serif;font-size:9pt";
  const border = "border:1px solid #c8c8c8;padding:2px 6px;white-space:nowrap";
  const head = columns.map((c) => `<th style="${border};background:#e8e8e8;text-align:left">${esc(c.label)}</th>`).join("");
  const body = rows
    .map((r) => {
      const style = r.kind === "wbs" ? (() => {
        const [bg, fg] = wbsColors(r.level);
        return `background:${bg};color:${fg};font-weight:bold`;
      })() : "";
      const tds = columns
        .map((c, i) => {
          const align = c.align === "right" ? ";text-align:right" : c.align === "center" ? ";text-align:center" : "";
          const indent = i === 0 ? `;padding-left:${6 + (r.level - minLevel) * 12}px` : "";
          return `<td style="${border}${align}${indent}">${esc(cell(r, c))}</td>`;
        })
        .join("");
      return `<tr style="${style}">${tds}</tr>`;
    })
    .join("");
  const html = `<table style="border-collapse:collapse;${font}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  return { text, html };
}

/** A WBS band and every row shown under it (the rows after it with a deeper level). */
export function bandRows(rows: GridRow[], index: number): GridRow[] {
  const first = rows[index];
  if (!first) return [];
  if (first.kind === "act") return [first];
  let end = index + 1;
  while (end < rows.length && rows[end].level > first.level) end++;
  return rows.slice(index, end);
}
