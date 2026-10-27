// Tiny DOM helpers.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Drag handle between two panes. `onDrag` gets the total movement since mousedown. */
export function splitter(direction: "v" | "h", onStart: () => void, onDrag: (delta: number) => void): HTMLElement {
  const handle = el("div", direction === "v" ? "splitter-v" : "splitter-h");
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const start = direction === "v" ? e.clientX : e.clientY;
    onStart();
    handle.classList.add("drag");
    const move = (ev: MouseEvent) => onDrag((direction === "v" ? ev.clientX : ev.clientY) - start);
    const up = () => {
      handle.classList.remove("drag");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  return handle;
}

export function modal(title: string, bodyHtml: string): void {
  const close = () => back.remove();
  const x = el("button", "xbtn", ["×"]);
  x.addEventListener("click", close);
  const ok = el("button", "btn primary", ["OK"]);
  ok.addEventListener("click", close);
  const box = el("div", "modal", [el("div", "fhead", [el("span", "", [title]), x]), el("div", "mbody"), el("div", "mfoot", [ok])]);
  box.querySelector(".mbody")!.innerHTML = bodyHtml;
  const back = el("div", "modal-back", [box]);
  back.addEventListener("mousedown", (e) => e.target === back && close());
  back.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(back);
  ok.focus();
}
