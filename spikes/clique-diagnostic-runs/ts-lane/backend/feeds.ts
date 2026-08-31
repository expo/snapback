import { query, t } from "snapback2";
import {
  entries,
  follows,
  likeCounts,
  likes,
  postReplyCounts,
  posts,
  profiles,
  repostCounts,
  reposts,
} from "./schema";

// Feed pages are 20 entries ordered by the global sequence number, newest
// first. The cursor is always present: the first page passes the sentinel
// 9007199254740991 and every next page passes the seq of the last entry of
// the previous page. seq is unique, so `range: { lt: cursorSeq }` pages
// never duplicate and never gap.
//
// Feeds return raw entry rows; the client pairs a feed page with the
// `hydrate` query below (post bodies, author names, counts, viewer state).
// That split exists because the certifier's read-key provenance rule
// (E_PROVENANCE_AMBIGUOUS) refuses db.get keys taken from a merged+sorted
// intermediate array; keys from a declared-max args list are direct.

export const global = query({ cursorSeq: t.int() }, ({ db, args }) => {
  const rows = db.scan(entries.bySeq, [], {
    order: "desc",
    take: 20,
    before: args.cursorSeq,
  });
  const page = [];
  let lastSeq = -1;
  for (const row of rows) {
    page.push({ entryId: row.id, at: row.at, seq: row.seq, kind: row.kind, postId: row.postId, actorId: row.actorId });
    lastSeq = row.seq;
  }
  return {
    entries: page,
    nextCursor: rows.length === 20 && lastSeq >= 0 ? lastSeq : null,
  };
});

export const following = query({ cursorSeq: t.int() }, ({ db, ctx, args }) => {
  // Certified-output ceiling (1 MiB) bounds the merge product; the feed
  // merges the viewer plus their 12 most recent follows. This is the
  // documented bound of this program, not an incidental truncation.
  const edges = db.scan(follows.byFollowerTime, [ctx.viewer], { order: "desc", take: 12 });
  const actorIds = edges.map((edge) => edge.followeeId);
  actorIds.push(ctx.viewer);
  const merged: { entryId: string; at: number; seq: number; kind: string; postId: string; actorId: string }[] = [];
  let more = false;
  for (const actorId of actorIds) {
    const rows = db.scan(entries.byActorSeq, [actorId], {
      order: "desc",
      take: 20,
      before: args.cursorSeq,
    });
    if (rows.length === 20) more = true;
    for (const row of rows) {
      merged.push({ entryId: row.id, at: row.at, seq: row.seq, kind: row.kind, postId: row.postId, actorId: row.actorId });
    }
  }
  const sorted = merged.sort((a, b) => b.seq - a.seq);
  if (sorted.length > 20) more = true;
  const page = sorted.slice(0, 20);
  let lastSeq = -1;
  for (const item of page) {
    lastSeq = item.seq;
  }
  return {
    entries: page,
    nextCursor: more && lastSeq >= 0 ? lastSeq : null,
  };
});

export const hydrate = query(
  {
    postIds: t.list(t.id(), { max: 20 }),
    actorIds: t.list(t.id(), { max: 20 }),
  },
  ({ db, ctx, args }) => {
    const cards = [];
    for (const postId of args.postIds) {
      const post = db.get(posts, postId);
      if (post === null) continue;
      const author = db.get(profiles, post.authorId);
      const replyTally = db.get(postReplyCounts.byParent, [postId]);
      const likeTally = db.get(likeCounts.byPost, [postId]);
      const repostTally = db.get(repostCounts.byPost, [postId]);
      cards.push({
        postId,
        body: post.body,
        postAt: post.at,
        replyCount: replyTally === null ? 0 : replyTally.value - 1, // minus self-parent row
        likeCount: likeTally === null ? 0 : likeTally.value,
        repostCount: repostTally === null ? 0 : repostTally.value,
        authorId: post.authorId,
        authorName: author === null ? "?" : author.displayName,
        authorHandle: author === null ? "?" : author.handle,
        likedByMe: db.get(likes.byPostUser, [postId, ctx.viewer]) !== null,
        repostedByMe: db.get(reposts.byPostUser, [postId, ctx.viewer]) !== null,
      });
    }
    const actors = [];
    for (const actorId of args.actorIds) {
      const profile = db.get(profiles, actorId);
      if (profile !== null) actors.push({ id: actorId, name: profile.displayName });
    }
    return { cards, actors };
  },
);
