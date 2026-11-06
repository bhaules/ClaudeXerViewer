// The funnel on each column header: an Excel-style filter with sort buttons, a condition
// (the same expressions as the filter row) and a tick list of the column's values.
import type { Column } from "../xer/columns";
import { esc } from "./dom";

/** Longest list drawn at once; typing in the search box narrows it. */
const MAX_SHOWN = 1500;

export interface ColumnFilterOptions {
  column: Column;
  /** Distinct displayed values (with how many activities have each), in sort order. */
  values: { text: string; count: number }[];
  condition: string;
  /** Ticked values, or null for all of them. */
  ticked: Set<string> | null;
  /** `values` null means every value is ticked (no value filter). */
  onApply(condition: string, values: Set<string> | null): void;
  onClear(): void;
  onSort(dir: 1 | -1): void;
}

export function openColumnFilter(anchor: HTMLElement, o: ColumnFilterOptions): void {
  document.querySelector(".cf-pop")?.remove();
  const c = o.column;
  const hint =
    c.kind === "text" ? "Contains text. =x exact, <>x excludes" : c.kind === "number" ? "e.g. >5, <=0, =10" : "e.g. >01-Jul-26, <=30/6/26";
  const [asc, desc] = c.kind === "text" ? ["Sort A → Z", "Z → A"] : ["Sort Smallest → Largest", "Largest → Smallest"];
  const pop = document.createElement("div");
  pop.className = "cf-pop";
  pop.innerHTML =
    `<div class="cf-head"><span>${esc(c.label)}</span><button class="xbtn" data-a="close" title="Close (Esc)">×</button></div>` +
    `<div class="cf-body"><div class="cf-row"><button class="btn" data-a="asc">${asc}</button><button class="btn" data-a="desc">${desc}</button></div>` +
    `<label class="cf-lbl">Condition</label><input type="text" class="cf-cond" placeholder="${esc(hint)}" title="${esc(hint)}" value="${esc(o.condition)}">` +
    `<label class="cf-lbl">Values</label><input type="text" class="cf-search" placeholder="Search values">` +
    `<div class="cf-list"></div><div class="cf-note"></div></div>` +
    `<div class="cf-foot"><button class="btn" data-a="clear">Clear Filter</button><span class="cl-gap"></span>` +
    `<button class="btn primary" data-a="ok">OK</button><button class="btn" data-a="close">Cancel</button></div>`;
  document.body.append(pop);

  const list = pop.querySelector<HTMLElement>(".cf-list")!;
  const search = pop.querySelector<HTMLInputElement>(".cf-search")!;
  const cond = pop.querySelector<HTMLInputElement>(".cf-cond")!;
  const note = pop.querySelector<HTMLElement>(".cf-note")!;
  const ticked = new Set(o.ticked ? o.values.filter((v) => o.ticked!.has(v.text)).map((v) => v.text) : o.values.map((v) => v.text));
  let matching = o.values;

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    matching = q ? o.values.filter((v) => v.text.toLowerCase().includes(q)) : o.values;
    const shown = matching.slice(0, MAX_SHOWN);
    const all = shown.length > 0 && shown.every((v) => ticked.has(v.text));
    list.innerHTML =
      `<label class="cf-item cf-all"><input type="checkbox" data-i="-1"${all ? " checked" : ""}> (Select All${q ? " Search Results" : ""})</label>` +
      shown
        .map(
          (v, i) =>
            `<label class="cf-item"><input type="checkbox" data-i="${i}"${ticked.has(v.text) ? " checked" : ""}> ` +
            `<span class="cf-t">${v.text === "" ? "<i>(Blanks)</i>" : esc(v.text)}</span><span class="cf-n">${v.count.toLocaleString()}</span></label>`,
        )
        .join("");
    note.textContent =
      matching.length > MAX_SHOWN
        ? `Showing ${MAX_SHOWN.toLocaleString()} of ${matching.length.toLocaleString()} values. Type to narrow the list.`
        : matching.length
          ? ""
          : "No values match.";
  };
  draw();

  list.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const i = Number(box.dataset.i);
    const shown = matching.slice(0, MAX_SHOWN);
    if (i < 0) {
      for (const v of shown) box.checked ? ticked.add(v.text) : ticked.delete(v.text);
      draw();
      return;
    }
    box.checked ? ticked.add(shown[i].text) : ticked.delete(shown[i].text);
    const allBox = list.querySelector<HTMLInputElement>('[data-i="-1"]');
    if (allBox) allBox.checked = shown.every((v) => ticked.has(v.text));
  });
  search.addEventListener("input", draw);

  const close = () => {
    pop.remove();
    window.removeEventListener("mousedown", outside, true);
    window.removeEventListener("keydown", keys, true);
  };
  const apply = () => {
    // With a search typed, OK keeps only the ticked values that match it (like Excel).
    const q = search.value.trim().toLowerCase();
    const keep = q ? new Set([...ticked].filter((t) => t.toLowerCase().includes(q))) : new Set(ticked);
    close();
    o.onApply(cond.value, !q && keep.size === o.values.length ? null : keep);
  };
  const outside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) close();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.target === cond || e.target === search)) {
      e.preventDefault();
      apply();
    }
  };
  window.addEventListener("mousedown", outside, true);
  window.addEventListener("keydown", keys, true);
  pop.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (a === "close") close();
    else if (a === "ok") apply();
    else if (a === "clear") {
      close();
      o.onClear();
    } else if (a === "asc" || a === "desc") {
      close();
      o.onSort(a === "asc" ? 1 : -1);
    }
  });

  const r = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(r.right - p.width, innerWidth - p.width - 4))}px`;
  pop.style.top = `${Math.min(r.bottom + 2, Math.max(4, innerHeight - p.height - 4))}px`;
  cond.focus();
}
