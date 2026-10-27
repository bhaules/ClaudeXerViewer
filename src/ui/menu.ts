// Windows-style menu bar with dropdowns and cascading submenus.
import { el, esc } from "./dom";

export type MenuItem =
  | "-"
  | {
      label: string;
      key?: string;
      checked?: () => boolean;
      enabled?: () => boolean;
      action?: () => void;
      items?: () => MenuItem[];
    };

export interface TopMenu {
  label: string;
  items: () => MenuItem[];
}

export class MenuBar {
  readonly root: HTMLElement;
  readonly title = el("div", "title");
  private open: { top: HTMLElement; menus: HTMLElement[] } | null = null;

  constructor(menus: TopMenu[]) {
    this.root = el("div", "menubar");
    for (const m of menus) {
      const top = el("div", "mtop", [m.label]);
      top.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (this.open?.top === top) this.close();
        else this.show(top, m);
      });
      top.addEventListener("mouseenter", () => {
        if (this.open && this.open.top !== top) this.show(top, m);
      });
      this.root.append(top);
    }
    this.root.append(this.title);
    window.addEventListener("mousedown", (e) => {
      if (this.open && !(e.target as HTMLElement).closest(".menu, .menubar")) this.close();
    });
    window.addEventListener("keydown", (e) => e.key === "Escape" && this.close());
    window.addEventListener("blur", () => this.close());
  }

  private show(top: HTMLElement, m: TopMenu): void {
    this.close();
    top.classList.add("open");
    const r = top.getBoundingClientRect();
    this.open = { top, menus: [] };
    this.dropdown(m.items(), r.left, r.bottom, 0);
  }

  close(): void {
    if (!this.open) return;
    this.open.top.classList.remove("open");
    this.open.menus.forEach((m) => m.remove());
    this.open = null;
  }

  private dropdown(items: MenuItem[], x: number, y: number, depth: number): void {
    if (!this.open) return;
    this.open.menus.splice(depth).forEach((m) => m.remove());
    const menu = el("div", "menu");
    for (const item of items) {
      if (item === "-") {
        menu.append(el("div", "sep"));
        continue;
      }
      const enabled = item.enabled ? item.enabled() : true;
      const row = el("div", `mi${enabled ? "" : " disabled"}`);
      row.innerHTML =
        `<span class="chk">${item.checked?.() ? "✓" : ""}</span><span>${esc(item.label)}</span>` +
        `<span class="key">${esc(item.key ?? "")}</span><span class="sub">${item.items ? "▶" : ""}</span>`;
      row.addEventListener("mouseenter", () => {
        menu.querySelectorAll(".mi.open").forEach((n) => n.classList.remove("open"));
        if (item.items && enabled) {
          row.classList.add("open");
          const rr = row.getBoundingClientRect();
          this.dropdown(item.items(), rr.right - 2, rr.top - 3, depth + 1);
        } else if (this.open) {
          this.open.menus.splice(depth + 1).forEach((m) => m.remove());
        }
      });
      row.addEventListener("mouseup", () => {
        if (!enabled || item.items) return;
        this.close();
        item.action?.();
      });
      menu.append(row);
    }
    document.body.append(menu);
    // Keep the menu on screen.
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width - 2))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height - 2))}px`;
    this.open.menus.push(menu);
  }
}
