import { mutation, query, t } from "snapback2";
import {
  counters,
  entries,
  likeCounts,
  likes,
  postReplyCounts,
  posts,
  profiles,
  repostCounts,
  reposts,
} from "./schema";

// Every feed-visible write takes the next global sequence number. The owner
// serializes commits, so read-increment-write on the counter row is safe.
// Reply/like/repost tallies live in engine-maintained count tables.

export const create = mutation({ body: t.text(500) }, ({ db, ctx, args }) => {
  db.require(args.body.length >= 1, "BODY_REQUIRED");
  const author = db.get(profiles, ctx.viewer);
  db.require(author !== null, "PROFILE_REQUIRED");
  const counter = db.get(counters.byName, ["seq"]);
  const seq = counter === null ? 1 : counter.value + 1;
  if (counter === null) {
    db.insert(counters, { id: ctx.newId(), name: "seq", value: seq });
  } else {
    db.update(counters, counter.id, { value: seq });
  }
  const id = ctx.newId();
  const at = ctx.now();
  // Originals are self-parented: the runtime refuses "" as an Id value,
  // and optional columns cannot anchor the byParentTime index. The reply
  // tally therefore counts the self row; readers subtract one.
  db.insert(posts, {
    id,
    authorId: ctx.viewer,
    body: args.body,
    at,
    seq,
    kind: "post",
    parentId: id,
  });
  db.insert(entries, {
    id: ctx.newId(),
    at,
    seq,
    kind: "post",
    postId: id,
    actorId: ctx.viewer,
  });
  return { id };
});

export const reply = mutation(
  { parentId: t.ref(posts), body: t.text(500) },
  ({ db, ctx, args }) => {
    db.require(args.body.length >= 1, "BODY_REQUIRED");
    const author = db.get(profiles, ctx.viewer);
    db.require(author !== null, "PROFILE_REQUIRED");
    const parent = db.get(posts, args.parentId);
    db.require(parent !== null, "PARENT_UNKNOWN");
    const counter = db.get(counters.byName, ["seq"]);
    const seq = counter === null ? 1 : counter.value + 1;
    if (counter === null) {
      db.insert(counters, { id: ctx.newId(), name: "seq", value: seq });
    } else {
      db.update(counters, counter.id, { value: seq });
    }
    const id = ctx.newId();
    db.insert(posts, {
      id,
      authorId: ctx.viewer,
      body: args.body,
      at: ctx.now(),
      seq,
      kind: "reply",
      parentId: args.parentId,
    });
    return { id };
  },
);

export const setLike = mutation(
  { postId: t.ref(posts), on: t.bool() },
  ({ db, ctx, args }) => {
    const post = db.get(posts, args.postId);
    db.require(post !== null, "POST_UNKNOWN");
    const existing = db.get(likes.byPostUser, [args.postId, ctx.viewer]);
    if (args.on && existing === null) {
      db.insert(likes, {
        id: ctx.newId(),
        postId: args.postId,
        userId: ctx.viewer,
        at: ctx.now(),
      });
    }
    if (!args.on && existing !== null) {
      db.delete(likes, existing.id);
    }
    return { liked: args.on };
  },
);

export const setRepost = mutation(
  { postId: t.ref(posts), on: t.bool() },
  ({ db, ctx, args }) => {
    const post = db.get(posts, args.postId);
    db.require(post !== null, "POST_UNKNOWN");
    db.require(post!.kind === "post", "CANNOT_REPOST_REPLY");
    const existing = db.get(reposts.byPostUser, [args.postId, ctx.viewer]);
    if (args.on && existing === null) {
      const counter = db.get(counters.byName, ["seq"]);
      const seq = counter === null ? 1 : counter.value + 1;
      if (counter === null) {
        db.insert(counters, { id: ctx.newId(), name: "seq", value: seq });
      } else {
        db.update(counters, counter.id, { value: seq });
      }
      db.insert(reposts, {
        id: ctx.newId(),
        postId: args.postId,
        userId: ctx.viewer,
        at: ctx.now(),
      });
      db.insert(entries, {
        id: ctx.newId(),
        at: ctx.now(),
        seq,
        kind: "repost",
        postId: args.postId,
        actorId: ctx.viewer,
      });
    }
    if (!args.on && existing !== null) {
      db.delete(reposts, existing.id);
      const entry = db.get(entries.byPostActorKind, [args.postId, ctx.viewer, "repost"]);
      if (entry !== null) db.delete(entries, entry.id);
    }
    return { reposted: args.on };
  },
);

export const thread = query({ postId: t.ref(posts) }, ({ db, ctx, args }) => {
  const post = db.get(posts, args.postId);
  if (post === null) return null;
  const author = db.get(profiles, post.authorId);
  const replyTally = db.get(postReplyCounts.byParent, [args.postId]);
  const likeTally = db.get(likeCounts.byPost, [args.postId]);
  const repostTally = db.get(repostCounts.byPost, [args.postId]);
  const rows = db.scan(posts.byParentTime, [args.postId], { order: "asc", take: 100 });
  const replies = [];
  for (const row of rows) {
    if (row.id === args.postId) continue; // self-parent sentinel row
    const replyAuthor = db.get(profiles, row.authorId);
    const replyLikes = db.get(likeCounts.byPost, [row.id]);
    replies.push({
      id: row.id,
      body: row.body,
      at: row.at,
      likeCount: replyLikes === null ? 0 : replyLikes.value,
      authorId: row.authorId,
      authorName: replyAuthor === null ? "?" : replyAuthor.displayName,
      authorHandle: replyAuthor === null ? "?" : replyAuthor.handle,
      likedByMe: db.get(likes.byPostUser, [row.id, ctx.viewer]) !== null,
    });
  }
  return {
    post: {
      id: post.id,
      body: post.body,
      at: post.at,
      kind: post.kind,
      parentId: post.parentId,
      replyCount:
        replyTally === null ? 0 : post.kind === "post" ? replyTally.value - 1 : replyTally.value,
      likeCount: likeTally === null ? 0 : likeTally.value,
      repostCount: repostTally === null ? 0 : repostTally.value,
      authorId: post.authorId,
      authorName: author === null ? "?" : author.displayName,
      authorHandle: author === null ? "?" : author.handle,
      likedByMe: db.get(likes.byPostUser, [post.id, ctx.viewer]) !== null,
      repostedByMe: db.get(reposts.byPostUser, [post.id, ctx.viewer]) !== null,
    },
    replies,
  };
});

export const byAuthor = query(
  { userId: t.ref(profiles), cursorSeq: t.int() },
  ({ db, ctx, args }) => {
    const rows = db.scan(posts.byAuthorKindSeq, [args.userId, "post"], {
      order: "desc",
      take: 20,
      before: args.cursorSeq,
    });
    const items = [];
    let lastSeq = -1;
    for (const row of rows) {
      const author = db.get(profiles, row.authorId);
      const replyTally = db.get(postReplyCounts.byParent, [row.id]);
      const likeTally = db.get(likeCounts.byPost, [row.id]);
      const repostTally = db.get(repostCounts.byPost, [row.id]);
      items.push({
        id: row.id,
        body: row.body,
        at: row.at,
        seq: row.seq,
        replyCount: replyTally === null ? 0 : replyTally.value - 1,
        likeCount: likeTally === null ? 0 : likeTally.value,
        repostCount: repostTally === null ? 0 : repostTally.value,
        authorId: row.authorId,
        authorName: author === null ? "?" : author.displayName,
        authorHandle: author === null ? "?" : author.handle,
        likedByMe: db.get(likes.byPostUser, [row.id, ctx.viewer]) !== null,
        repostedByMe: db.get(reposts.byPostUser, [row.id, ctx.viewer]) !== null,
      });
      lastSeq = row.seq;
    }
    return {
      items,
      nextCursor: rows.length === 20 && lastSeq >= 0 ? lastSeq : null,
    };
  },
);
