import { seed } from "snapback2";

// Static fixture for `snapback2 test` (fresh isolated owner). The
// development/demo seed is the richer scripts/seed.mjs, which drives the
// real auth + mutation surface idempotently.
export default seed({
  personas: ["alice", "bob", "carol"],
  rows: {
    profiles: [
      { id: "dev:alice", displayName: "Alice", handle: "alice_p", bio: "", location: "", link: "" },
      { id: "dev:bob", displayName: "Bob", handle: "bob_p", bio: "", location: "", link: "" },
      { id: "dev:carol", displayName: "Carol", handle: "carol_p", bio: "", location: "", link: "" },
    ],
    counters: [{ id: "counter-seq", name: "seq", value: 7 }],
    posts: [
      { id: "post-1", authorId: "dev:alice", body: "First post", at: 1, seq: 1, kind: "post", parentId: "post-1" },
      { id: "post-2", authorId: "dev:alice", body: "Second post", at: 2, seq: 2, kind: "post", parentId: "post-2" },
      { id: "reply-1", authorId: "dev:bob", body: "A reply", at: 3, seq: 3, kind: "reply", parentId: "post-1" },
    ],
    entries: [
      { id: "entry-1", at: 1, seq: 1, kind: "post", postId: "post-1", actorId: "dev:alice" },
      { id: "entry-2", at: 2, seq: 2, kind: "post", postId: "post-2", actorId: "dev:alice" },
      { id: "entry-3", at: 4, seq: 4, kind: "repost", postId: "post-1", actorId: "dev:bob" },
    ],
    likes: [{ id: "like-1", postId: "post-1", userId: "dev:bob", at: 3 }],
    reposts: [{ id: "repost-1", postId: "post-1", userId: "dev:bob", at: 4 }],
    follows: [{ id: "follow-1", followerId: "dev:bob", followeeId: "dev:alice", at: 1 }],
    postReplyCounts: [],
    likeCounts: [],
    repostCounts: [],
    followerCounts: [],
    followingCounts: [],
    convos: [
      { id: "convo-1", kind: "dm", name: "", description: "", creatorId: "dev:alice", lastBody: "Hi Bob", lastAt: 5, lastSeq: 5, memberCount: 2 },
      { id: "convo-2", kind: "group", name: "Fixture Group", description: "", creatorId: "dev:alice", lastBody: "", lastAt: 6, lastSeq: 6, memberCount: 2 },
    ],
    dmPairs: [{ id: "dmpair-1", userA: "dev:alice", userB: "dev:bob", convoId: "convo-1" }],
    members: [
      { id: "member-a1", convoId: "convo-1", userId: "dev:alice" },
      { id: "member-b1", convoId: "convo-1", userId: "dev:bob" },
      { id: "member-a2", convoId: "convo-2", userId: "dev:alice" },
      { id: "member-b2", convoId: "convo-2", userId: "dev:bob" },
    ],
    roster: [
      { id: "roster-a1", convoId: "convo-1", userId: "dev:alice", role: "member", active: true, joinedAt: 1, removedAt: 0, deliveredSeq: 5, readSeq: 5 },
      { id: "roster-b1", convoId: "convo-1", userId: "dev:bob", role: "member", active: true, joinedAt: 1, removedAt: 0, deliveredSeq: 0, readSeq: 0 },
      { id: "roster-a2", convoId: "convo-2", userId: "dev:alice", role: "admin", active: true, joinedAt: 1, removedAt: 0, deliveredSeq: 6, readSeq: 6 },
      { id: "roster-b2", convoId: "convo-2", userId: "dev:bob", role: "member", active: true, joinedAt: 1, removedAt: 0, deliveredSeq: 0, readSeq: 0 },
    ],
    messages: [
      { id: "message-1", convoId: "convo-1", authorId: "dev:alice", body: "Hi Bob", at: 5, seq: 5, hasQuote: false, quotedId: "message-1" },
      { id: "message-2", convoId: "convo-2", authorId: "dev:alice", body: "Group hello", at: 6, seq: 6, hasQuote: false, quotedId: "message-2" },
    ],
  },
});
