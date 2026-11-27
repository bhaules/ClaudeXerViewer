// Review comments: adding, editing, replying, importing and the per-row index.
import {
  extractCommentsFromHtml,
  itemKey,
  liveComments,
  mergeComments,
  newCommentId,
  parseComments,
  resolveTarget,
  snapshotOf,
  targetFor,
  targetKey,
  type ReviewComment,
} from "../xer/comments";
import { type Activity, type Wbs } from "../xer/model";
import { askReviewerName, describeTarget, editCommentDialog, replyDialog } from "./comments";
import type { App } from "./app";
import { DRAFT_KEY, isActivity } from "./app-shared";
import { applyFilter } from "./app-filters";

/** Asks for the reviewer's name if we don't have one (or `force`). Returns it, or null if cancelled. */
export async function ensureReviewer(app: App, force = false): Promise<string | null> {
  if (app.prefs.reviewer && !force) return app.prefs.reviewer;
  const name = await askReviewerName(app.prefs.reviewer);
  if (name) {
    app.prefs.reviewer = name;
    app.savePrefs();
  }
  return name ?? (force ? app.prefs.reviewer || null : null);
}

/** Adds a comment on an activity or WBS band, or a general one when `item` is null. */
export async function addComment(app: App, item: Activity | Wbs | null): Promise<void> {
  if (!app.schedule) return;
  if (item && !isActivity(item) && item.group) {
    app.setStatus(`Comments go on activities and WBS bands. "${item.group.label}" bands aren't WBS, so comment on an activity, or use View > Group By > WBS.`, true);
    return;
  }
  const author = await ensureReviewer(app);
  if (!author) return;
  const target = item ? targetFor(item) : ({ kind: "general" } as const);
  const about = item ? (isActivity(item) ? `${item.code} – ${item.name}` : `WBS ${item.fullCode} – ${item.name}`) : "General comment on the schedule";
  const draft = await editCommentDialog(about, author);
  if (!draft) return;
  const now = Date.now();
  app.comments.push({
    id: newCommentId(),
    target,
    type: draft.type,
    text: draft.text,
    author,
    created: now,
    updated: now,
    status: "open",
    snapshot: item ? snapshotOf(item) : undefined,
  });
  commentsChanged(app, `Comment added on ${item ? describeTarget(app.comments[app.comments.length - 1], item) : "the schedule"}.`);
}

export async function editComment(app: App, c: ReviewComment): Promise<void> {
  const draft = await editCommentDialog(describeTarget(c, null), c.author, { type: c.type, text: c.text });
  if (!draft) return;
  replaceComment(app, { ...c, ...draft, updated: Date.now() });
  commentsChanged(app, "Comment updated.");
}

export function deleteComment(app: App, c: ReviewComment): void {
  const preview = c.text.length > 80 ? c.text.slice(0, 80) + "…" : c.text;
  if (!window.confirm(`Delete this comment by ${c.author}?\n\n"${preview}"`)) return;
  replaceComment(app, { ...c, deleted: true, updated: Date.now() });
  commentsChanged(app, "Comment deleted.");
}

/** Adds a reply. The comment's own `updated` stays: replies merge by their own ids. */
export async function replyTo(app: App, c: ReviewComment): Promise<void> {
  const author = await ensureReviewer(app);
  if (!author) return;
  const item = app.schedule ? resolveTarget(app.schedule, c.target) : null;
  const text = await replyDialog(c, describeTarget(c, item), author);
  if (!text) return;
  const now = Date.now();
  replaceComment(app, { ...c, replies: [...(c.replies ?? []), { id: newCommentId(), author, text, created: now, updated: now }] });
  commentsChanged(app, "Reply added.");
}

export function deleteReply(app: App, c: ReviewComment, id: string): void {
  const r = c.replies?.find((x) => x.id === id);
  if (!r) return;
  const preview = r.text.length > 80 ? r.text.slice(0, 80) + "…" : r.text;
  if (!window.confirm(`Delete this reply by ${r.author}?\n\n"${preview}"`)) return;
  const replies = (c.replies ?? []).map((x) => (x.id === id ? { ...x, deleted: true, updated: Date.now() } : x));
  replaceComment(app, { ...c, replies });
  commentsChanged(app, "Reply deleted.");
}

export async function toggleDone(app: App, c: ReviewComment): Promise<void> {
  if (c.status === "done") {
    replaceComment(app, { ...c, status: "open", doneBy: undefined, doneAt: undefined, updated: Date.now() });
    commentsChanged(app, "Comment reopened.");
    return;
  }
  const by = await ensureReviewer(app);
  if (!by) {
    app.commentsPanel.render(); // undo the checkbox tick
    return;
  }
  const now = Date.now();
  replaceComment(app, { ...c, status: "done", doneBy: by, doneAt: now, updated: now });
  commentsChanged(app, "Comment marked done.");
}

export function replaceComment(app: App, c: ReviewComment): void {
  app.comments = app.comments.map((x) => (x.id === c.id ? c : x));
}

/** Merges comments from saved review files (several reviewers at once). */
export async function importComments(app: App, files: File[]): Promise<void> {
  if (!app.schedule) return;
  let added = 0;
  let updated = 0;
  const empty: string[] = [];
  for (const f of files) {
    const found = extractCommentsFromHtml(await f.text());
    if (!found.length) {
      empty.push(f.name);
      continue;
    }
    const r = mergeComments(app.comments, found);
    app.comments = r.comments;
    added += r.added;
    updated += r.updated;
  }
  const parts = [`Imported from ${files.length - empty.length} file${files.length - empty.length === 1 ? "" : "s"}: ${added} new comment${added === 1 ? "" : "s"}, ${updated} updated.`];
  if (empty.length) parts.push(`No comments in: ${empty.join(", ")}.`);
  if (added || updated) commentsChanged(app, parts.join(" "));
  else app.setStatus(parts.join(" "));
  showCommentsTab(app);
}

/**
 * Comments for a newly opened schedule: keep the current ones (they match by Activity
 * ID), add any from the file, and recover unsaved work from the last session.
 * Returns how many changes were recovered.
 */
export function loadComments(app: App, fromFile: ReviewComment[]): number {
  app.comments = mergeComments(app.comments, fromFile).comments;
  let recovered = 0;
  const key = draftKey(app);
  if (key) {
    try {
      const draft = parseComments(localStorage.getItem(key) ?? "");
      const r = mergeComments(app.comments, draft);
      app.comments = r.comments;
      recovered = r.added + r.updated;
    } catch {
      // Storage blocked; nothing to recover.
    }
  }
  app.commentsDirty = recovered > 0;
  reindexComments(app);
  return recovered;
}

export function draftKey(app: App): string | null {
  const p = app.schedule?.projects[0];
  return p ? DRAFT_KEY + p.shortName : null;
}

/** After any change: mark unsaved, back up, and refresh badges, panel and filters. */
export function commentsChanged(app: App, message: string): void {
  app.commentsDirty = true;
  const key = draftKey(app);
  if (key) {
    try {
      localStorage.setItem(key, JSON.stringify({ format: "xer-viewer-comments", version: 1, comments: app.comments }));
    } catch {
      // Storage blocked; the unsaved-changes warning still protects the work.
    }
  }
  reindexComments(app);
  if (app.filterState.commentedOnly) applyFilter(app);
  else app.grid.render();
  app.setStatus(`${message} Save with File > Save Viewer with Schedule (Ctrl+S) to keep it.`);
}

export function reindexComments(app: App): void {
  app.commentIndex.clear();
  for (const c of liveComments(app.comments)) {
    // A comment without a project (older files) is filed under the row it lands on.
    const item = c.target.kind !== "general" && !c.target.project && app.schedule ? resolveTarget(app.schedule, c.target) : null;
    const key = item ? itemKey(item) : targetKey(c.target);
    const counts = app.commentIndex.get(key) ?? [0, 0];
    counts[c.status === "open" ? 0 : 1]++;
    app.commentIndex.set(key, counts);
  }
  const live = liveComments(app.comments);
  const open = live.filter((c) => c.status === "open").length;
  if (app.commentsTab) {
    app.commentsTab.textContent = `Comments${live.length ? ` (${open} open)` : ""}${app.commentsDirty ? " *" : ""}`;
    app.commentsTab.title = app.commentsDirty ? "Comments not saved yet: File > Save Viewer with Schedule" : "";
  }
  app.commentsPanel.render();
}

export function showCommentsTab(app: App): void {
  app.showBottom("comments");
}
