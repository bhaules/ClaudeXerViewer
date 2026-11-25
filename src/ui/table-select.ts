// Row selection for the bottom panel's tables (Resource Spreadsheet, Codes, UDFs, ...):
// click, Ctrl-click, Shift-click or drag to select rows, Ctrl+A for all, Ctrl+C to copy.
import type { CopiedTable } from "../xer/clipboard";
import { esc } from "./dom";

let active: TableSelect | null = null;

/** The rows selected in the table last clicked, or null (then Ctrl+C copies grid rows). */
export function selectedTableRows(): { table: CopiedTable; count: number } | null {
  return active?.copied() ?? null;
}

export class TableSelect {
  private anchor = -1;

  /** `selector` picks the tables inside `root`; they may be re-rendered at any time. */
  constructor(private root: HTMLElement, private selector: string, private withHeader: boolean) {
    root.tabIndex = -1;
    root.addEventListener("mousedown", (e) => {
      const tr = this.rowOf(e.target);
      if (!tr || e.button !== 0) return;
      const rows = this.rows();
      const i = rows.indexOf(tr);
      e.preventDefault(); // no text selection while picking rows
      window.getSelection()?.removeAllRanges();
      this.root.focus({ preventScroll: true });
      if (e.shiftKey && this.anchor >= 0) {
        this.range(rows, this.anchor, i);
      } else if (e.ctrlKey || e.metaKey) {
        tr.classList.toggle("sel");
        this.anchor = i;
      } else {
        this.range(rows, i, i);
        this.anchor = i;
        this.drag(i);
      }
      active = this;
    });
    root.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && this.rows().length) {
        e.preventDefault();
        const rows = this.rows();
        this.range(rows, 0, rows.length - 1);
        active = this;
      }
    });
    // Clicking anywhere else gives Ctrl+C back to the grid.
    document.addEventListener(
      "mousedown",
      (e) => {
        if (active === this && !this.rowOf(e.target)) active = null;
      },
      true,
    );
  }

  copied(): { table: CopiedTable; count: number } | null {
    const rows = this.rows().filter((r) => r.classList.contains("sel"));
    if (!rows.length || !this.root.offsetParent) return null;
    const cells = (tr: HTMLTableRowElement) => [...tr.cells].map((c) => (c.textContent ?? "").replace(/[\t\r\n]+/g, " ").trim());
    const head = this.withHeader ? rows[0].closest("table")?.tHead?.rows[0] : undefined;
    const lines = rows.map(cells);
    const text = [...(head ? [cells(head)] : []), ...lines].map((l) => l.join("\t")).join("\r\n");
    const tr = (l: string[], tag: string) => `<tr>${l.map((c) => `<${tag}>${esc(c)}</${tag}>`).join("")}</tr>`;
    const html = `<table>${head ? tr(cells(head), "th") : ""}${lines.map((l) => tr(l, "td")).join("")}</table>`;
    return { table: { text, html }, count: rows.length };
  }

  private drag(from: number): void {
    const move = (e: MouseEvent) => {
      const tr = this.rowOf(e.target);
      if (!tr || !(e.buttons & 1)) return;
      const rows = this.rows();
      this.range(rows, from, rows.indexOf(tr));
    };
    const up = () => {
      this.root.removeEventListener("mouseover", move);
      window.removeEventListener("mouseup", up);
    };
    this.root.addEventListener("mouseover", move);
    window.addEventListener("mouseup", up);
  }

  private range(rows: HTMLElement[], a: number, b: number): void {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    rows.forEach((r, k) => r.classList.toggle("sel", k >= lo && k <= hi));
  }

  private rows(): HTMLTableRowElement[] {
    return [...this.root.querySelectorAll<HTMLTableRowElement>(`${this.selector} > tbody > tr`)];
  }

  private rowOf(t: EventTarget | null): HTMLTableRowElement | null {
    const tr = (t as HTMLElement | null)?.closest?.<HTMLTableRowElement>(`${this.selector} > tbody > tr`) ?? null;
    return tr && this.root.contains(tr) ? tr : null;
  }
}
