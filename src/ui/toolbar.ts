// Toolbar under the menu bar (View > Toolbar), like P6's: icon buttons for the common
// commands, each with a tooltip naming it and its shortcut.
import { el } from "./dom";

export type ToolItem =
  | "-"
  | {
      icon: keyof typeof ICONS;
      title: string;
      /** Gets the button, e.g. to open a menu under it. */
      action: (button: HTMLElement) => void;
      enabled?: () => boolean;
      /** Toggle buttons draw pressed while this is true. */
      pressed?: () => boolean;
    };

/** 16x16 line icons, drawn in the button's text colour. */
const ICONS = {
  open: `<path d="M1.5 12.5v-9h4l1.5 1.5h5.5v2"/><path d="M1.5 12.5l2-5.5h11l-2 5.5z"/>`,
  save: `<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5v-3.5M4.5 13.5v-4.5h7v4.5"/>`,
  excel: `<rect x="2.5" y="2.5" width="11" height="11" fill="#e8f4ec" stroke="#217346"/><path d="M2.5 6h11M2.5 9.5h11M6.5 2.5v11" stroke="#217346"/>`,
  expand: `<rect x="2.5" y="2.5" width="11" height="11"/><path d="M5 8h6M8 5v6"/>`,
  collapse: `<rect x="2.5" y="2.5" width="11" height="11"/><path d="M5 8h6"/>`,
  find: `<circle cx="6.5" cy="6.5" r="4"/><path d="M9.5 9.5l4.5 4.5"/>`,
  filter: `<path d="M1.5 2.5h13l-5 6v5l-3-1.5v-3.5z"/>`,
  clearFilter: `<path d="M1.5 2.5h11l-4.5 5.5v4.5l-2.5-1.3v-3.2z"/><path d="M10.5 10l4 4M14.5 10l-4 4" stroke="#c0110c"/>`,
  zoomIn: `<circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4"/>`,
  zoomOut: `<circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4.5 4.5M4.5 6.5h4"/>`,
  fit: `<path d="M1.5 8h13M4.5 5l-3 3 3 3M11.5 5l3 3-3 3"/>`,
  dataDate: `<path d="M8 1.5v13" stroke="#1f4fd8" stroke-dasharray="2 1.5"/><path d="M2 5.5h4M3 9.5h3M10 7.5h4M10 11.5h3" stroke-width="2"/>`,
  gantt: `<path d="M2 4h6M5 8h8M3 12h7" stroke-width="2.5"/>`,
  comment: `<path d="M2.5 3h11v7.5h-6l-3 3v-3h-2z"/><path d="M8 4.8v4M6 6.8h4"/>`,
  help: `<circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.3M8 11.2v.4"/>`,
} as const;

export class Toolbar {
  readonly root = el("div", "toolbar");
  private buttons: [HTMLButtonElement, Exclude<ToolItem, "-">][] = [];

  constructor(items: ToolItem[]) {
    for (const item of items) {
      if (item === "-") {
        this.root.append(el("div", "tb-sep"));
        continue;
      }
      const b = el("button", "tb");
      b.type = "button";
      b.title = item.title;
      b.setAttribute("aria-label", item.title);
      b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[item.icon]}</svg>`;
      // mousedown, not click: keep keyboard focus on the grid.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        if (item.enabled && !item.enabled()) return;
        item.action(b);
        this.refresh();
      });
      this.buttons.push([b, item]);
      this.root.append(b);
    }
    this.refresh();
  }

  /** Updates enabled and pressed states; call after anything they depend on changes. */
  refresh(): void {
    for (const [b, item] of this.buttons) {
      const enabled = item.enabled ? item.enabled() : true;
      b.disabled = !enabled;
      b.classList.toggle("pressed", enabled && !!item.pressed?.());
    }
  }
}
