// Review comments UI: the add/edit dialog, the reviewer-name dialog, and the Comments
// tab that lists every comment.
import {
  COMMENT_TYPES,
  changedSince,
  liveComments,
  resolveTarget,
  type CommentType,
  type ReviewComment,
} from "../xer/comments";
import type { Activity, Schedule, Wbs } from "../xer/model";
import { el, esc } from "./dom";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A real timestamp in the viewer's local time: 28-Oct-26 14:05. */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${MONTHS[d.getMonth()]}-${p(d.getFullYear() % 100)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Label for what a comment is about: "A1000 – Project Start", "WBS DEMO-001.CON – Construction", "General". */
export function describeTarget(c: ReviewComment, item: Activity | Wbs | null): string {
  if (c.target.kind === "general") return "General";
  const name = item?.name ?? c.snapshot?.name ?? "";
  const prefix = c.target.kind === "wbs" ? `WBS ${c.target.code}` : c.target.code;
  return name ? `${prefix} – ${name}` : prefix;
}

/** Small form dialog. Resolves with the result of `read()` on OK, or null on Cancel. */
function formDialog<T>(title: string, body: HTMLElement, okLabel: string, read: () => T | null, focus?: HTMLElement): Promise<T | null> {
  return new Promise((resolve) => {
    const x = el("button", "xbtn", ["×"]);
    const ok = el("button", "btn primary", [okLabel]);
    const cancel = el("button", "btn", ["Cancel"]);
    const box = el("div", "modal", [
      el("div", "fhead", [el("span", "", [title]), x]),
      el("div", "mbody", [body]),
      el("div", "mfoot dlg-foot", [ok, cancel]),
    ]);
    const back = el("div", "modal-back", [box]);
    const finish = (v: T | null) => {
      back.remove();
      resolve(v);
    };
    const submit = () => {
      const v = read();
      if (v !== null) finish(v);
    };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", () => finish(null));
    x.addEventListener("click", () => finish(null));
    back.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish(null);
      // Enter submits, except in the comment box (Ctrl+Enter there).
      else if (e.key === "Enter" && ((e.target as HTMLElement).tagName !== "TEXTAREA" || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    });
    document.body.append(back);
    (focus ?? ok).focus();
  });
}

/** Asks for the reviewer's name, shown on their comments. */
export async function askReviewerName(current: string): Promise<string | null> {
  const input = el("input");
  input.type = "text";
  input.className = "dlg-input";
  input.value = current;
  input.placeholder = "e.g. Jane Smith";
  input.maxLength = 60;
  const note = el("p", "dlg-note", ["Shown next to your comments so the scheduler knows who wrote them. Remembered in this browser."]);
  const body = el("div", "", [el("label", "dlg-label", ["Your name"]), input, note]);
  const name = await formDialog("Your Name", body, "OK", () => input.value.trim() || null, input);
  return name;
}

export interface CommentDraft {
  type: CommentType;
  text: string;
}

/** Add or edit a comment. `about` describes what it's on (e.g. "A1000 – Project Start"). */
export async function editCommentDialog(about: string, author: string, initial?: CommentDraft): Promise<CommentDraft | null> {
  const type = el("select", "dlg-select");
  type.innerHTML = COMMENT_TYPES.map((t) => `<option>${t}</option>`).join("");
  type.value = initial?.type ?? "Comment";
  const text = el("textarea", "dlg-text");
  text.value = initial?.text ?? "";
  text.rows = 6;
  text.placeholder = "Type your comment";
  const warn = el("div", "dlg-warn hidden", ["Please type a comment."]);
  const body = el("div", "", [
    el("div", "dlg-about", [about]),
    el("div", "dlg-row", [el("label", "dlg-label", ["Type"]), type, el("span", "dlg-by", [`by ${author}`])]),
    text,
    warn,
    el("p", "dlg-note", ["Ctrl+Enter to save."]),
  ]);
  return formDialog(initial ? "Edit Comment" : "Add Comment", body, "Save", () => {
    if (!text.value.trim()) {
      warn.classList.remove("hidden");
      text.focus();
      return null;
    }
    return { type: type.value as CommentType, text: text.value.trim() };
  }, text);
}

export interface CommentsPanelHost {
  schedule(): Schedule | null;
  /** All comments, including deleted ones (the panel skips those). */
  comments(): ReviewComment[];
  goTo(item: Activity | Wbs): void;
  onEdit(c: ReviewComment): void;
  onDelete(c: ReviewComment): void;
  onToggleDone(c: ReviewComment): void;
  onAddGeneral(): void;
  onImport(): void;
}

export class CommentsPanel {
  readonly root: HTMLElement;
  private show = el("select");
  private author = el("select");
  private summary = el("span", "cm-summary");
  private body = el("div", "rel-body cm-body");
  private shown: ReviewComment[] = [];

  constructor(private host: CommentsPanelHost) {
    this.show.innerHTML = `<option value="open">Open</option><option value="done">Done</option><option value="all">All</option>`;
    this.show.addEventListener("change", () => this.render());
    this.author.addEventListener("change", () => this.render());
    const add = el("button", "btn", ["Add General Comment"]);
    add.addEventListener("click", () => this.host.onAddGeneral());
    const imp = el("button", "btn", ["Import Reviewers' Files..."]);
    imp.title = "Add the comments from saved review files that people sent back";
    imp.addEventListener("click", () => this.host.onImport());

    const bar = el("div", "cm-bar", [
      el("span", "", ["Show"]),
      this.show,
      el("span", "", ["by"]),
      this.author,
      el("span", "fb-sep"),
      add,
      imp,
      this.summary,
    ]);
    this.root = el("div", "pane cm-pane", [bar, this.body]);

    this.body.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const tr = t.closest<HTMLElement>("tr[data-i]");
      if (!tr) return;
      const c = this.shown[Number(tr.dataset.i)];
      if (t.closest(".cm-done")) this.host.onToggleDone(c);
      else if (t.closest(".cm-edit")) this.host.onEdit(c);
      else if (t.closest(".cm-del")) this.host.onDelete(c);
      else {
        const s = this.host.schedule();
        const item = s && resolveTarget(s, c.target);
        if (item) this.host.goTo(item);
        this.body.querySelectorAll("tr.sel").forEach((r) => r.classList.remove("sel"));
        tr.classList.add("sel");
      }
    });
    this.body.addEventListener("dblclick", (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-i]");
      if (tr && !(e.target as HTMLElement).closest("button, input")) this.host.onEdit(this.shown[Number(tr.dataset.i)]);
    });
    this.render();
  }

  render(): void {
    const s = this.host.schedule();
    const all = liveComments(this.host.comments());

    // Author filter, keeping the current choice if that person still has comments.
    const authors = [...new Set(all.map((c) => c.author))].sort((a, b) => a.localeCompare(b));
    const keep = this.author.value;
    this.author.innerHTML =
      `<option value="">Everyone</option>` + authors.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
    this.author.value = authors.includes(keep) ? keep : "";

    const show = this.show.value;
    this.shown = all.filter(
      (c) => (show === "all" || c.status === show) && (!this.author.value || c.author === this.author.value),
    );
    const open = all.filter((c) => c.status === "open").length;
    this.summary.textContent = all.length ? `${open} open, ${all.length - open} done` : "";

    if (!all.length) {
      this.body.innerHTML =
        `<div class="rel-empty">No comments yet. Right-click an activity or WBS band and choose <b>Add Comment</b>, ` +
        `or use the <b>Review</b> menu. Comments are saved with <b>File &gt; Save Viewer with Schedule</b>.</div>`;
      return;
    }
    if (!this.shown.length) {
      this.body.innerHTML = `<div class="rel-empty">No ${show === "all" ? "" : show + " "}comments${this.author.value ? " by " + esc(this.author.value) : ""}.</div>`;
      return;
    }

    const rows = this.shown
      .map((c, i) => {
        const item = s ? resolveTarget(s, c.target) : null;
        const notes: string[] = [];
        if (c.target.kind !== "general" && s && !item) notes.push("Not in this schedule");
        const moved = changedSince(c, item);
        if (moved) notes.push(`Moved since: ${moved}`);
        if (c.status === "done" && c.doneBy) notes.push(`Done by ${c.doneBy}${c.doneAt ? " " + formatStamp(c.doneAt) : ""}`);
        return (
          `<tr data-i="${i}" class="${c.status === "done" ? "cm-isdone" : ""}">` +
          `<td class="c"><input type="checkbox" class="cm-done" title="Mark done" ${c.status === "done" ? "checked" : ""}></td>` +
          `<td><span class="cm-type t-${c.type.replace(/\s+/g, "")}">${esc(c.type)}</span></td>` +
          `<td class="cm-target" title="${esc(describeTarget(c, item))}">${esc(describeTarget(c, item))}</td>` +
          `<td class="cm-text">${esc(c.text)}</td>` +
          `<td>${esc(c.author)}</td>` +
          `<td>${formatStamp(c.created)}${c.updated > c.created + 1000 ? " (edited)" : ""}</td>` +
          `<td class="cm-notes">${esc(notes.join(" · "))}</td>` +
          `<td class="cm-actions"><button class="btn cm-edit" title="Edit">Edit</button><button class="btn cm-del" title="Delete">Delete</button></td>` +
          `</tr>`
        );
      })
      .join("");
    this.body.innerHTML =
      `<table class="cm-table"><thead><tr><th>Done</th><th>Type</th><th>Activity / WBS</th><th>Comment</th><th>By</th><th>Date</th><th title="Filled in automatically: moved since the comment, not in this schedule, or who marked it done">Status</th><th></th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  }
}
