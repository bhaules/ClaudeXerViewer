// Find dialog (Ctrl+F), with F3 / Shift+F3 for next / previous.
import type { Activity } from "../xer/model";
import { el } from "./dom";

export interface SearchHost {
  /** All activities in display order. */
  activities(): Activity[];
  current(): Activity | null;
  goTo(a: Activity): void;
  onHitsChanged(): void;
}

export class Search {
  private box: HTMLElement;
  private input: HTMLInputElement;
  private matchCase: HTMLInputElement;
  private status: HTMLElement;
  private hits = new Set<Activity>();
  private term = "";

  constructor(private host: SearchHost) {
    this.input = el("input");
    this.input.type = "text";
    this.input.placeholder = "Activity ID or name";
    this.matchCase = el("input");
    this.matchCase.type = "checkbox";
    this.status = el("div", "fstatus");

    const prev = button("Find Previous", () => this.find(-1));
    const next = button("Find Next", () => this.find(1));
    next.classList.add("primary");
    const close = el("button", "xbtn", ["×"]);
    close.title = "Close (Esc)";
    close.addEventListener("click", () => this.close());

    const label = el("label", "", [this.matchCase, " Match case"]);
    const head = el("div", "fhead", [el("span", "", ["Find"]), close]);
    this.box = el("div", "find hidden", [
      head,
      el("div", "fbody", [
        el("div", "frow", [this.input]),
        el("div", "frow", [label, el("span", "", []), prev, next]),
        this.status,
      ]),
    ]);
    (label.nextSibling as HTMLElement).style.flex = "1";
    document.body.append(this.box);

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.find(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") this.close();
    });
    this.input.addEventListener("input", () => this.refreshHits());
    this.matchCase.addEventListener("change", () => this.refreshHits());
    this.makeDraggable(head);
  }

  open(): void {
    this.box.classList.remove("hidden");
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.box.classList.add("hidden");
    this.input.value = "";
    this.refreshHits();
  }

  isHit(a: Activity): boolean {
    return this.hits.has(a);
  }

  /** Find the next (+1) or previous (-1) match after the current activity, wrapping around. */
  find(dir: 1 | -1): void {
    if (!this.term) {
      this.open();
      return;
    }
    const list = this.host.activities();
    const matches = list.filter((a) => this.hits.has(a));
    if (matches.length === 0) {
      this.status.textContent = `No activities match "${this.input.value}".`;
      return;
    }
    const pos = new Map(list.map((a, i) => [a, i]));
    const cur = this.host.current();
    const curPos = cur ? pos.get(cur) ?? -1 : -1;
    const target =
      dir === 1
        ? matches.find((a) => pos.get(a)! > curPos) ?? matches[0]
        : matches.findLast((a) => curPos >= 0 && pos.get(a)! < curPos) ?? matches[matches.length - 1];
    this.host.goTo(target);
    this.status.textContent = `Match ${matches.indexOf(target) + 1} of ${matches.length}`;
  }

  private refreshHits(): void {
    const raw = this.input.value.trim();
    const cs = this.matchCase.checked;
    this.term = cs ? raw : raw.toLowerCase();
    this.hits.clear();
    if (this.term) {
      for (const a of this.host.activities()) {
        const id = cs ? a.code : a.code.toLowerCase();
        const name = cs ? a.name : a.name.toLowerCase();
        if (id.includes(this.term) || name.includes(this.term)) this.hits.add(a);
      }
      this.status.textContent = this.hits.size ? `${this.hits.size} matching activities` : "No matches";
    } else {
      this.status.textContent = "";
    }
    this.host.onHitsChanged();
  }

  private makeDraggable(handle: HTMLElement): void {
    handle.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const r = this.box.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = (ev: MouseEvent) => {
        this.box.style.left = `${Math.max(0, ev.clientX - dx)}px`;
        this.box.style.top = `${Math.max(0, ev.clientY - dy)}px`;
        this.box.style.right = "auto";
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "btn", [label]);
  b.addEventListener("click", onClick);
  return b;
}
