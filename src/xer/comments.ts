// Review comments: reviewers comment on activities, WBS bands or the schedule as a
// whole; the comments travel inside the saved HTML file, never in the .xer.
// Comments are keyed by Activity ID / WBS code (not internal ids), so they land on
// the right row when opened against a newer export of the same project.
import { formatDate, formatDuration } from "./format";
import type { Activity, Schedule, Wbs } from "./model";

export type CommentTarget =
  | { kind: "activity"; project: string; code: string }
  | { kind: "wbs"; project: string; code: string }
  | { kind: "general" };

export const COMMENT_TYPES = ["Comment", "Question", "Change request", "Error"] as const;
export type CommentType = (typeof COMMENT_TYPES)[number];

/** What the reviewer was looking at when they wrote the comment. */
export interface CommentSnapshot {
  name: string;
  start: string;
  finish: string;
  remaining: string;
}

export interface ReviewComment {
  id: string;
  target: CommentTarget;
  type: CommentType;
  text: string;
  author: string;
  /** Real timestamps (ms since 1970, UTC). */
  created: number;
  updated: number;
  status: "open" | "done";
  doneBy?: string;
  doneAt?: number;
  snapshot?: CommentSnapshot;
  /** Kept (rather than removed) so a merge doesn't bring a deleted comment back. */
  deleted?: boolean;
  /** Answers, oldest first. Merged one by one, so replies made in different files all survive. */
  replies?: CommentReply[];
}

/** An answer to a comment, e.g. the scheduler saying what they changed. */
export interface CommentReply {
  id: string;
  author: string;
  text: string;
  created: number;
  updated: number;
  /** Kept, like deleted comments, so a merge can't bring it back. */
  deleted?: boolean;
}

export function liveReplies(c: ReviewComment): CommentReply[] {
  return (c.replies ?? []).filter((r) => !r.deleted);
}

export interface CommentFile {
  format: "xer-viewer-comments";
  version: 1;
  comments: ReviewComment[];
}

export const COMMENTS_ELEMENT_ID = "xer-comments";

export function newCommentId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function targetFor(item: Activity | Wbs): CommentTarget {
  const project = item.project?.shortName ?? "";
  return "wbs" in item ? { kind: "activity", project, code: item.code } : { kind: "wbs", project, code: item.fullCode };
}

/**
 * Key for indexing comments by row: "activity|PROJ|A1000", "wbs|PROJ|DEMO-001.CON" or
 * "general". The project is part of it, so the same Activity ID in two projects of one
 * file keeps its own comments.
 */
export function targetKey(t: CommentTarget): string {
  return t.kind === "general" ? "general" : `${t.kind}|${t.project}|${t.code}`;
}

/** The comment-index key of a row (matches `targetKey`). */
export function itemKey(item: Activity | Wbs): string {
  return targetKey(targetFor(item));
}

export function snapshotOf(item: Activity | Wbs): CommentSnapshot {
  if ("wbs" in item) {
    return {
      name: item.name,
      start: formatDate(item.start, item.startActual),
      finish: formatDate(item.finish, item.finishActual),
      remaining: formatDuration(item.remDurHrs, item.calendar, "d"),
    };
  }
  return {
    name: item.name,
    start: formatDate(item.start, item.startActual),
    finish: formatDate(item.finish, item.finishActual),
    remaining: "",
  };
}

/** The activity or WBS a comment is about in this schedule, or null if it isn't there. */
export function resolveTarget(s: Schedule, t: CommentTarget): Activity | Wbs | null {
  if (t.kind === "general") return null;
  if (t.kind === "activity") {
    return s.activities.find((a) => a.code === t.code && (!t.project || a.project?.shortName === t.project)) ?? null;
  }
  const walk = (nodes: Wbs[]): Wbs | null => {
    for (const w of nodes) {
      if (w.fullCode === t.code && (!t.project || w.project?.shortName === t.project)) return w;
      const hit = walk(w.children);
      if (hit) return hit;
    }
    return null;
  };
  return walk(s.roots);
}

/** "Moved" when the row's dates now differ from what the reviewer saw. */
export function changedSince(c: ReviewComment, item: Activity | Wbs | null): string | null {
  if (!c.snapshot || !item) return null;
  const now = snapshotOf(item);
  const parts: string[] = [];
  if (now.start !== c.snapshot.start) parts.push(`start was ${c.snapshot.start || "blank"}`);
  if (now.finish !== c.snapshot.finish) parts.push(`finish was ${c.snapshot.finish || "blank"}`);
  return parts.length ? parts.join(", ") : null;
}

export interface MergeResult {
  comments: ReviewComment[];
  added: number;
  updated: number;
}

/**
 * Combines two sets of comments. The same comment (same id) seen twice keeps whichever
 * copy was changed last, so marking Done, editing or deleting survives a merge.
 */
export function mergeComments(mine: ReviewComment[], incoming: ReviewComment[]): MergeResult {
  const byId = new Map(mine.map((c) => [c.id, c]));
  let added = 0;
  let updated = 0;
  for (const c of incoming) {
    const have = byId.get(c.id);
    if (!have) {
      byId.set(c.id, c);
      if (!c.deleted) added++;
      continue;
    }
    // The comment itself: the copy changed last. Its replies: every reply from both copies.
    const newer = c.updated > have.updated;
    const replies = mergeReplies(have.replies ?? [], c.replies ?? []);
    if (newer || replies.changed) {
      const base = newer ? c : have;
      const merged: ReviewComment = { ...base };
      if (replies.list.length) merged.replies = replies.list;
      else delete merged.replies;
      byId.set(c.id, merged);
      updated++;
    }
  }
  return { comments: [...byId.values()].sort((a, b) => a.created - b.created), added, updated };
}

/** Replies from two copies of one comment, by reply id; the copy changed last wins. */
function mergeReplies(mine: CommentReply[], incoming: CommentReply[]): { list: CommentReply[]; changed: boolean } {
  const byId = new Map(mine.map((r) => [r.id, r]));
  let changed = false;
  for (const r of incoming) {
    const have = byId.get(r.id);
    if (!have || r.updated > have.updated) {
      byId.set(r.id, r);
      changed = true;
    }
  }
  return { list: [...byId.values()].sort((a, b) => a.created - b.created), changed };
}

export function liveComments(all: ReviewComment[]): ReviewComment[] {
  return all.filter((c) => !c.deleted);
}

/** JSON for a <script type="application/json"> block. "<" is escaped so it can't close the tag. */
export function serializeComments(comments: ReviewComment[]): string {
  const file: CommentFile = { format: "xer-viewer-comments", version: 1, comments };
  return JSON.stringify(file).replace(/</g, "\\u003c");
}

/** Reads comments from JSON; anything malformed is skipped rather than failing the whole file. */
export function parseComments(json: string): ReviewComment[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const list = (data as Partial<CommentFile>)?.comments;
  if (!Array.isArray(list)) return [];
  const out: ReviewComment[] = [];
  for (const c of list) {
    const clean = cleanComment(c);
    if (clean) out.push(clean);
  }
  return out;
}

/** Pulls the comments out of a saved viewer HTML file (as text). */
export function extractCommentsFromHtml(html: string): ReviewComment[] {
  const m = new RegExp(`<script[^>]*id="${COMMENTS_ELEMENT_ID}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  return m ? parseComments(m[1]) : [];
}

/**
 * A comment from a file someone sent, rebuilt field by field so nothing unexpected gets
 * through: a file can be hand-edited. Null when the essentials are missing or the wrong type.
 * An unknown type becomes "Comment" rather than dropping the comment.
 */
function cleanComment(c: unknown): ReviewComment | null {
  if (!c || typeof c !== "object") return null;
  const x = c as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const time = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const id = str(x.id);
  const text = str(x.text);
  const author = str(x.author);
  const created = time(x.created);
  const updated = time(x.updated);
  const status = x.status === "open" || x.status === "done" ? x.status : undefined;
  if (id === undefined || text === undefined || author === undefined || created === undefined || updated === undefined || !status) {
    return null;
  }
  const t = x.target as Record<string, unknown> | null | undefined;
  if (!t || typeof t !== "object") return null;
  let target: CommentTarget;
  if (t.kind === "general") target = { kind: "general" };
  else if ((t.kind === "activity" || t.kind === "wbs") && typeof t.code === "string") {
    target = { kind: t.kind, project: str(t.project) ?? "", code: t.code };
  } else return null;
  const type = (COMMENT_TYPES as readonly unknown[]).includes(x.type) ? (x.type as CommentType) : "Comment";
  const out: ReviewComment = { id, target, type, text, author, created, updated, status };
  const doneBy = str(x.doneBy);
  const doneAt = time(x.doneAt);
  if (doneBy !== undefined) out.doneBy = doneBy;
  if (doneAt !== undefined) out.doneAt = doneAt;
  const s = x.snapshot as Record<string, unknown> | null | undefined;
  if (s && typeof s === "object") {
    out.snapshot = { name: str(s.name) ?? "", start: str(s.start) ?? "", finish: str(s.finish) ?? "", remaining: str(s.remaining) ?? "" };
  }
  if (x.deleted === true) out.deleted = true;
  if (Array.isArray(x.replies)) {
    const replies = x.replies.map(cleanReply).filter((r): r is CommentReply => r !== null);
    if (replies.length) out.replies = replies;
  }
  return out;
}

function cleanReply(r: unknown): CommentReply | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (typeof x.id !== "string" || typeof x.author !== "string" || typeof x.text !== "string" || !ok(x.created) || !ok(x.updated)) {
    return null;
  }
  const out: CommentReply = { id: x.id, author: x.author, text: x.text, created: x.created as number, updated: x.updated as number };
  if (x.deleted === true) out.deleted = true;
  return out;
}
