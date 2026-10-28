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

export function sameTarget(a: CommentTarget, b: CommentTarget): boolean {
  if (a.kind === "general" || b.kind === "general") return a.kind === b.kind;
  return a.kind === b.kind && a.code === b.code && (a.project === b.project || !a.project || !b.project);
}

/** Key for indexing comments by row: "activity|A1000", "wbs|DEMO-001.CON" or "general". */
export function targetKey(t: CommentTarget): string {
  return t.kind === "general" ? "general" : `${t.kind}|${t.code}`;
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
    } else if (c.updated > have.updated) {
      byId.set(c.id, c);
      updated++;
    }
  }
  return { comments: [...byId.values()].sort((a, b) => a.created - b.created), added, updated };
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
  return list.filter(isComment);
}

/** Pulls the comments out of a saved viewer HTML file (as text). */
export function extractCommentsFromHtml(html: string): ReviewComment[] {
  const m = new RegExp(`<script[^>]*id="${COMMENTS_ELEMENT_ID}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  return m ? parseComments(m[1]) : [];
}

function isComment(c: unknown): c is ReviewComment {
  const x = c as ReviewComment;
  return (
    !!x &&
    typeof x.id === "string" &&
    typeof x.text === "string" &&
    typeof x.author === "string" &&
    typeof x.created === "number" &&
    typeof x.updated === "number" &&
    (x.status === "open" || x.status === "done") &&
    !!x.target &&
    (x.target.kind === "general" || ((x.target.kind === "activity" || x.target.kind === "wbs") && typeof x.target.code === "string"))
  );
}
