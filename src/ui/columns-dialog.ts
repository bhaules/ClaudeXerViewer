// P6-style Columns dialog: Available Options (grouped, filterable) on the left,
// Selected Options (ordered) on the right.
import { COLUMN_GROUPS, type Column } from "../xer/columns";
import { el, esc } from "./dom";

export interface ColumnsDialogOptions {
  available: Column[];
  selected: string[];
  defaults: string[];
  onApply(keys: string[]): void;
}

export function openColumnsDialog(opts: ColumnsDialogOptions): void {
  const byKey = new Map(opts.available.map((c) => [c.key, c]));
  let chosen = opts.selected.filter((k) => byKey.has(k));
  let availSel = new Set<string>();
  let chosenSel = new Set<string>();
  const collapsed = new Set<string>();
  let lastClicked: { list: "a" | "c"; key: string } | null = null;

  const filter = el("input");
  filter.type = "text";
  filter.placeholder = "Filter available columns";
  const availList = el("div", "cl-list");
  const chosenList = el("div", "cl-list");
  availList.tabIndex = 0;
  chosenList.tabIndex = 0;

  const btn = (label: string, title: string, onClick: () => void) => {
    const b = el("button", "btn cl-btn", [label]);
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };
  const addBtn = btn("▶", "Add to Selected Options", () => add());
  const removeBtn = btn("◀", "Remove from Selected Options", () => remove());
  const upBtn = btn("▲", "Move up", () => move(-1));
  const downBtn = btn("▼", "Move down", () => move(1));
  const count = el("span", "cl-count");

  const ok = el("button", "btn primary", ["OK"]);
  const cancel = el("button", "btn", ["Cancel"]);
  const defaults = el("button", "btn", ["Default"]);
  const x = el("button", "xbtn", ["×"]);

  const box = el("div", "modal cl-modal", [
    el("div", "fhead", [el("span", "", ["Columns"]), x]),
    el("div", "cl-body", [
      el("div", "cl-col", [el("div", "cl-label", ["Available Options"]), filter, availList]),
      el("div", "cl-mid", [addBtn, removeBtn]),
      el("div", "cl-col", [el("div", "cl-label", ["Selected Options ", count]), chosenList]),
      el("div", "cl-mid", [upBtn, downBtn]),
    ]),
    el("div", "mfoot cl-foot", [defaults, el("span", "cl-gap"), ok, cancel]),
  ]);
  const back = el("div", "modal-back", [box]);

  const close = () => back.remove();
  const apply = () => {
    if (chosen.length === 0) return;
    close();
    opts.onApply(chosen);
  };

  function add(): void {
    const keys = opts.available.map((c) => c.key).filter((k) => availSel.has(k));
    if (!keys.length) return;
    // Insert after the last selected item on the right, like P6; otherwise at the end.
    const anchor = Math.max(-1, ...chosen.map((k, i) => (chosenSel.has(k) ? i : -1)));
    const at = anchor >= 0 ? anchor + 1 : chosen.length;
    chosen = [...chosen.slice(0, at), ...keys, ...chosen.slice(at)];
    chosenSel = new Set(keys);
    availSel = new Set();
    render();
  }

  function remove(): void {
    if (!chosenSel.size || chosenSel.size >= chosen.length) return; // keep at least one column
    chosen = chosen.filter((k) => !chosenSel.has(k));
    availSel = new Set(chosenSel);
    chosenSel = new Set();
    render();
  }

  function move(dir: -1 | 1): void {
    if (!chosenSel.size) return;
    const list = [...chosen];
    const idx = list.map((k, i) => (chosenSel.has(k) ? i : -1)).filter((i) => i >= 0);
    if (dir === -1 ? idx[0] === 0 : idx[idx.length - 1] === list.length - 1) return;
    for (const i of dir === -1 ? idx : [...idx].reverse()) [list[i], list[i + dir]] = [list[i + dir], list[i]];
    chosen = list;
    render();
    chosenList.querySelector(".cl-item.sel")?.scrollIntoView({ block: "nearest" });
  }

  function select(list: "a" | "c", key: string, e: MouseEvent): void {
    const set = list === "a" ? availSel : chosenSel;
    const order = list === "a" ? visibleAvailable() : chosen;
    if (e.shiftKey && lastClicked?.list === list) {
      const i0 = order.indexOf(lastClicked.key);
      const i1 = order.indexOf(key);
      if (i0 >= 0 && i1 >= 0) {
        if (!e.ctrlKey) set.clear();
        for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) set.add(order[i]);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (set.has(key)) set.delete(key);
      else set.add(key);
      lastClicked = { list, key };
    } else {
      set.clear();
      set.add(key);
      lastClicked = { list, key };
    }
    // Selecting on one side clears the other, so the arrow buttons are unambiguous.
    if (list === "a") chosenSel = new Set();
    else availSel = new Set();
    refreshSelection();
  }

  /** Class toggles only: rebuilding the list here would replace the item under the mouse and break double-click. */
  function refreshSelection(): void {
    for (const n of availList.querySelectorAll<HTMLElement>(".cl-item")) n.classList.toggle("sel", availSel.has(n.dataset.k!));
    for (const n of chosenList.querySelectorAll<HTMLElement>(".cl-item")) n.classList.toggle("sel", chosenSel.has(n.dataset.k!));
    updateButtons();
  }

  function updateButtons(): void {
    addBtn.disabled = availSel.size === 0;
    removeBtn.disabled = chosenSel.size === 0 || chosenSel.size >= chosen.length;
    upBtn.disabled = downBtn.disabled = chosenSel.size === 0;
    ok.disabled = chosen.length === 0;
  }

  function visibleAvailable(): string[] {
    const q = filter.value.trim().toLowerCase();
    const taken = new Set(chosen);
    const out: string[] = [];
    for (const g of COLUMN_GROUPS) {
      if (!q && collapsed.has(g)) continue;
      for (const c of opts.available) {
        if (c.group === g && !taken.has(c.key) && (!q || c.label.toLowerCase().includes(q))) out.push(c.key);
      }
    }
    return out;
  }

  function render(): void {
    const q = filter.value.trim().toLowerCase();
    const taken = new Set(chosen);
    let html = "";
    for (const g of COLUMN_GROUPS) {
      const cols = opts.available.filter((c) => c.group === g && !taken.has(c.key) && (!q || c.label.toLowerCase().includes(q)));
      if (!cols.length) continue;
      const open = q !== "" || !collapsed.has(g);
      html += `<div class="cl-group" data-g="${esc(g)}"><span class="tog${open ? " open" : ""}"></span>${esc(g)}</div>`;
      if (!open) continue;
      for (const c of cols) {
        html += `<div class="cl-item sub${availSel.has(c.key) ? " sel" : ""}" data-k="${esc(c.key)}">${esc(c.label)}</div>`;
      }
    }
    availList.innerHTML = html || `<div class="cl-empty">No matching columns</div>`;
    chosenList.innerHTML = chosen
      .map((k) => `<div class="cl-item${chosenSel.has(k) ? " sel" : ""}" data-k="${esc(k)}">${esc(byKey.get(k)!.label)}</div>`)
      .join("");
    count.textContent = `(${chosen.length})`;
    updateButtons();
  }

  availList.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    const group = t.closest<HTMLElement>(".cl-group");
    if (group) {
      const g = group.dataset.g!;
      if (collapsed.has(g)) collapsed.delete(g);
      else collapsed.add(g);
      render();
      return;
    }
    const item = t.closest<HTMLElement>(".cl-item");
    if (item) {
      e.preventDefault();
      availList.focus();
      select("a", item.dataset.k!, e);
    }
  });
  chosenList.addEventListener("mousedown", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".cl-item");
    if (item) {
      e.preventDefault();
      chosenList.focus();
      select("c", item.dataset.k!, e);
    }
  });
  availList.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".cl-item")) add();
  });
  chosenList.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".cl-item")) remove();
  });
  filter.addEventListener("input", () => {
    availSel = new Set();
    render();
  });
  back.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "Enter" && e.target !== filter) apply();
    else if (e.key === "Delete" && chosenSel.size) remove();
  });
  back.addEventListener("mousedown", (e) => e.target === back && close());
  x.addEventListener("click", close);
  cancel.addEventListener("click", close);
  ok.addEventListener("click", apply);
  defaults.addEventListener("click", () => {
    chosen = opts.defaults.filter((k) => byKey.has(k));
    availSel = new Set();
    chosenSel = new Set();
    render();
  });

  render();
  document.body.append(back);
  filter.focus();
}
