import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "../src/xer";
import {
  changedSince,
  extractCommentsFromHtml,
  liveReplies,
  mergeComments,
  newCommentId,
  parseComments,
  resolveTarget,
  serializeComments,
  snapshotOf,
  targetFor,
  type CommentReply,
  type ReviewComment,
} from "../src/xer/comments";

const schedule = loadSchedule(readFileSync(new URL("./fixtures/sample.xer", import.meta.url)));
const act = (code: string) => schedule.activities.find((a) => a.code === code)!;

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: newCommentId(),
  target: targetFor(act("E1010")),
  type: "Question",
  text: "Is this review really 5 days?",
  author: "Jane",
  created: 1000,
  updated: 1000,
  status: "open",
  snapshot: snapshotOf(act("E1010")),
  ...over,
});

describe("review comments", () => {
  it("targets activities by Activity ID and WBS by full code", () => {
    expect(targetFor(act("C1000"))).toEqual({ kind: "activity", project: "DEMO-001", code: "C1000" });
    const civ = act("C1000").wbs;
    expect(targetFor(civ)).toEqual({ kind: "wbs", project: "DEMO-001", code: "DEMO-001.CON.CIV" });
    expect(resolveTarget(schedule, targetFor(civ))).toBe(civ);
    expect(resolveTarget(schedule, targetFor(act("C1000")))).toBe(act("C1000"));
    expect(resolveTarget(schedule, { kind: "activity", project: "DEMO-001", code: "GONE" })).toBeNull();
  });

  it("remembers what the reviewer saw and spots later moves", () => {
    const c = comment();
    // Plain dates (no "*" constraint mark), so adding a constraint alone isn't a "move".
    expect(c.snapshot).toEqual({ name: "Design Review", start: "17-Feb-25", finish: "21-Feb-25", remaining: "5d" });
    expect(changedSince(c, act("E1010"))).toBeNull();
    const moved = { ...c, snapshot: { ...c.snapshot!, finish: "14-Feb-25" } };
    expect(changedSince(moved, act("E1010"))).toBe("finish was 14-Feb-25");
  });

  it("merges reviewers' files: new comments added, the latest edit wins", () => {
    const mine = comment({ id: "a", text: "original" });
    const theirsEdited = { ...mine, text: "edited", updated: 2000 };
    const theirsOlder = { ...mine, text: "stale", updated: 500 };
    const other = comment({ id: "b", author: "Bob" });

    const r1 = mergeComments([mine], [theirsEdited, other]);
    expect(r1.added).toBe(1);
    expect(r1.updated).toBe(1);
    expect(r1.comments.find((c) => c.id === "a")!.text).toBe("edited");

    const r2 = mergeComments([mine], [theirsOlder]);
    expect(r2.updated).toBe(0);
    expect(r2.comments[0].text).toBe("original");
  });

  it("doesn't bring deleted or done comments back to life when merging an older copy", () => {
    const original = comment({ id: "a" });
    const deleted = { ...original, deleted: true, updated: 3000 };
    const done = { ...original, status: "done" as const, doneBy: "George", updated: 3000 };
    expect(mergeComments([deleted], [original]).comments[0].deleted).toBe(true);
    expect(mergeComments([done], [original]).comments[0].status).toBe("done");
    // Merging the same file twice changes nothing.
    expect(mergeComments([original], [original])).toMatchObject({ added: 0, updated: 0 });
  });

  it("round-trips through the saved HTML, even with '</script>' in a comment", () => {
    const c = comment({ text: 'Watch out: </script><b>"quoted"</b> & £€' });
    const html = `<html><body><script id="xer-comments" type="application/json">${serializeComments([c])}</script></body></html>`;
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(extractCommentsFromHtml(html)).toEqual([c]);
    expect(extractCommentsFromHtml("<html>no comments</html>")).toEqual([]);
  });

  it("skips malformed comments instead of failing the file", () => {
    const good = comment();
    const json = JSON.stringify({ format: "xer-viewer-comments", version: 1, comments: [good, { id: 5 }, null, { ...good, status: "maybe" }] });
    expect(parseComments(json)).toEqual([good]);
    expect(parseComments("not json")).toEqual([]);
  });
});

describe("replies", () => {
  const reply = (id: string, author: string, created: number, over: Partial<CommentReply> = {}): CommentReply => ({
    id,
    author,
    text: `reply ${id}`,
    created,
    updated: created,
    ...over,
  });

  it("keeps replies made in different files, and the comment's own latest edit", () => {
    const base = comment({ id: "c1" });
    // The scheduler replied in their copy; the reviewer edited the comment and replied in theirs.
    const mine = { ...base, replies: [reply("r1", "Scheduler", 2000)] };
    const theirs = { ...base, text: "Edited", updated: 3000, replies: [reply("r2", "Jane", 2500)] };
    const r = mergeComments([mine], [theirs]);
    expect(r.updated).toBe(1);
    expect(r.comments[0].text).toBe("Edited");
    expect(r.comments[0].replies?.map((x) => x.id)).toEqual(["r1", "r2"]);
    // Merging the same file again changes nothing.
    expect(mergeComments(r.comments, [theirs])).toMatchObject({ added: 0, updated: 0 });
  });

  it("a deleted reply stays deleted when an older copy is merged", () => {
    const old = comment({ id: "c2", replies: [reply("r1", "Jane", 2000)] });
    const now = { ...old, replies: [reply("r1", "Jane", 2000, { deleted: true, updated: 4000 })] };
    const r = mergeComments([now], [old]);
    expect(liveReplies(r.comments[0])).toEqual([]);
    expect(r.updated).toBe(0);
  });

  it("round-trips through the saved file, dropping malformed replies", () => {
    const c = comment({ replies: [reply("r1", "Sam", 2000, { text: "</script> done <b>now</b>" })] });
    const html = `<script id="xer-comments" type="application/json">${serializeComments([c])}</script>`;
    expect(extractCommentsFromHtml(html)).toEqual([c]);
    const bad = { ...c, replies: [reply("r1", "Sam", 2000), { id: 3 }, null, { ...reply("r3", "X", 1), created: "yesterday" }] };
    const json = JSON.stringify({ format: "xer-viewer-comments", version: 1, comments: [bad] });
    expect(parseComments(json)[0].replies?.map((x) => x.id)).toEqual(["r1"]);
  });
});
