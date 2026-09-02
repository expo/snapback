import { channel, rule, schema, table, t } from "snapback2";

export const profiles = table({
  columns: {
    displayName: t.text(50),
    handle: t.text(20),
    bio: t.text(200),
    location: t.text(50),
    link: t.text(200),
  },
  indexes: { byHandle: { columns: ["handle"], unique: true } },
  rules: {
    read: rule.public("profiles are public"),
    insert: rule.viewerIs("id"),
    update: rule.viewerIs("id"),
    delete: rule.deny(),
  },
  constraints: [{ unique: "byHandle" }],
});

// A single global sequence counter drives feed ordering and pagination.
// Timestamps are kept for display, but cursors are the unique, monotonic
// `seq` value: the runtime only accepts scalar range bounds, so a composite
// (at, id) cursor is not expressible and `at` ties would make pages gap.
export const counters = table({
  columns: { name: t.text(20), value: t.int() },
  indexes: { byName: { columns: ["name"], unique: true } },
  rules: {
    read: rule.public("counters disclose only a sequence number"),
    insert: rule.allow(),
    update: rule.allow(),
    delete: rule.deny(),
  },
  constraints: [{ unique: "byName" }],
});

export const posts = table({
  columns: {
    authorId: t.ref(profiles),
    body: t.text(500),
    at: t.time(),
    seq: t.int(),
    kind: t.enum(["post", "reply"]),
    parentId: t.id(), // "" for originals, the parent post id for replies
  },
  indexes: {
    byAuthorKindSeq: { columns: ["authorId", "kind", "seq"], unique: true },
    byParentTime: { columns: ["parentId", "at", "id"] },
  },
  rules: {
    read: rule.public("posts are public"),
    insert: rule.viewerIs("authorId"),
    update: rule.deny(),
    delete: rule.deny(),
  },
});

// Reply/like/repost/follower tallies are engine-maintained count tables
// (`maintains` below): table rules would otherwise deny one viewer's
// mutation bumping a counter on another viewer's row.
export const postReplyCounts = table({
  columns: { parentId: t.id(), value: t.int() },
  indexes: { byParent: { columns: ["parentId"], unique: true } },
  rules: {
    read: rule.public("reply counts disclose no content"),
    insert: rule.deny(),
    update: rule.deny(),
    delete: rule.deny(),
  },
});

export const likeCounts = table({
  columns: { postId: t.ref(posts), value: t.int() },
  indexes: { byPost: { columns: ["postId"], unique: true } },
  rules: {
    read: rule.public("like counts are public"),
    insert: rule.deny(),
    update: rule.deny(),
    delete: rule.deny(),
  },
});

export const repostCounts = table({
  columns: { postId: t.ref(posts), value: t.int() },
  indexes: { byPost: { columns: ["postId"], unique: true } },
  rules: {
    read: rule.public("repost counts are public"),
    insert: rule.deny(),
    update: rule.deny(),
    delete: rule.deny(),
  },
});

export const followerCounts = table({
  columns: { followeeId: t.ref(profiles), value: t.int() },
  indexes: { byFollowee: { columns: ["followeeId"], unique: true } },
  rules: {
    read: rule.public("follower counts are public"),
    insert: rule.deny(),
    update: rule.deny(),
    delete: rule.deny(),
  },
});

export const followingCounts = table({
  columns: { followerId: t.ref(profiles), value: t.int() },
  indexes: { byFollower: { columns: ["followerId"], unique: true } },
  rules: {
    read: rule.public("following counts are public"),
    insert: rule.deny(),
    update: rule.deny(),
    delete: rule.deny(),
  },
});

export const likes = table({
  columns: { postId: t.ref(posts), userId: t.ref(profiles), at: t.time() },
  indexes: { byPostUser: { columns: ["postId", "userId"], unique: true } },
  rules: {
    read: rule.public("likes are public"),
    insert: rule.viewerIs("userId"),
    update: rule.deny(),
    delete: rule.viewerIs("userId"),
  },
  constraints: [{ unique: "byPostUser" }],
});

export const reposts = table({
  columns: { postId: t.ref(posts), userId: t.ref(profiles), at: t.time() },
  indexes: { byPostUser: { columns: ["postId", "userId"], unique: true } },
  rules: {
    read: rule.public("reposts are public"),
    insert: rule.viewerIs("userId"),
    update: rule.deny(),
    delete: rule.viewerIs("userId"),
  },
  constraints: [{ unique: "byPostUser" }],
});

export const follows = table({
  columns: { followerId: t.ref(profiles), followeeId: t.ref(profiles), at: t.time() },
  indexes: {
    byPair: { columns: ["followerId", "followeeId"], unique: true },
    byFollower: { columns: ["followerId"] },
    byFollowerTime: { columns: ["followerId", "at", "id"] },
  },
  rules: {
    read: rule.public("the follow graph is public"),
    insert: rule.viewerIs("followerId"),
    update: rule.deny(),
    delete: rule.viewerIs("followerId"),
  },
  constraints: [{ unique: "byPair" }],
});

// One row per feed-visible event: an original post or a repost. Replies get
// no entry, so feeds never contain them. Fan-out happens on read (the
// following feed merges per-actor scans), so an unfollow removes that
// actor's entries from the merge immediately, older posts included.
export const entries = table({
  columns: {
    at: t.time(),
    seq: t.int(),
    kind: t.enum(["post", "repost"]),
    postId: t.ref(posts),
    actorId: t.ref(profiles), // author for "post", reposter for "repost"
  },
  indexes: {
    bySeq: { columns: ["seq"], unique: true },
    byActorSeq: { columns: ["actorId", "seq"], unique: true },
    byPostActorKind: { columns: ["postId", "actorId", "kind"], unique: true },
  },
  rules: {
    read: rule.public("feed entries mirror public posts"),
    insert: rule.viewerIs("actorId"),
    update: rule.deny(),
    delete: rule.viewerIs("actorId"),
  },
  constraints: [{ unique: "byPostActorKind" }],
});

// ---------------------------------------------------------------- messaging
//
// Two-table membership split, forced by two certifier rules meeting:
// - chat.list must scan "my conversations" by viewer prefix, and a capped
//   scan refuses unless its read rule is uniform over the prefix
//   (E_STRUCTURAL_COUNT) -> the scanned table's read rule must be
//   viewerIs(userId).
// - admins must read and update other members' state, which viewerIs
//   forbids -> that state must live in a table readable via a
//   prefix-constant membership probe.
// So: `members` is the personal inbox pointer (one row per user per
// conversation, never deleted or deactivated - a removed member keeps the
// conversation and its history). `roster` is the single source of truth
// for role/active/joinedAt/removedAt and the receipt watermarks.

export const members = table({
  columns: {
    convoId: t.id(),
    userId: t.ref(profiles),
  },
  indexes: {
    byConvUser: { columns: ["convoId", "userId"], unique: true },
    byUser: { columns: ["userId"] },
  },
  rules: {
    read: rule.viewerIs("userId"),
    insert: rule.allow(), // created when a user first joins; guarded in mutations
    update: rule.deny(),
    delete: rule.deny(),
  },
  constraints: [{ unique: "byConvUser" }],
});

export const roster = table({
  columns: {
    convoId: t.id(),
    userId: t.ref(profiles),
    role: t.enum(["admin", "member"]),
    active: t.bool(),
    joinedAt: t.time(),
    removedAt: t.time(), // 0 while active
    // Receipt watermarks: the highest message seq this member's client has
    // fetched (delivered) and viewed (read) in this conversation. Monotonic.
    deliveredSeq: t.int(),
    readSeq: t.int(),
  },
  indexes: {
    byConvUser: { columns: ["convoId", "userId"], unique: true },
    byConvUserActive: { columns: ["convoId", "userId", "active"] },
  },
  rules: {
    read: rule.exists(members, "byConvUser", [rule.field("convoId"), rule.viewer]),
    insert: rule.allow(), // guarded in mutations
    update: rule.allow(), // guarded in mutations
    delete: rule.deny(),
  },
  constraints: [{ unique: "byConvUser" }],
});

export const convos = table({
  columns: {
    kind: t.enum(["dm", "group"]),
    name: t.text(50), // "" for DMs
    description: t.text(200),
    creatorId: t.ref(profiles),
    lastBody: t.text(2000), // preview; UI truncates
    lastAt: t.time(),
    lastSeq: t.int(),
    memberCount: t.int(), // active members, maintained by chat mutations
  },
  indexes: {},
  rules: {
    read: rule.exists(members, "byConvUser", [rule.field("id"), rule.viewer]),
    insert: rule.viewerIs("creatorId"),
    // lastBody/lastAt/lastSeq/memberCount are updated by member mutations.
    update: rule.allow(),
    delete: rule.deny(),
  },
});

// At most one DM channel per user pair. The owner serializes commits and
// openDm checks both orders before inserting, so no canonical ordering of
// the pair is needed (ids cannot be concatenated into a text key: the
// value model keeps Id a distinct scalar kind).
export const dmPairs = table({
  columns: {
    userA: t.ref(profiles),
    userB: t.ref(profiles),
    convoId: t.ref(convos),
  },
  indexes: { byPair: { columns: ["userA", "userB"], unique: true } },
  rules: {
    read: rule.or(rule.viewerIs("userA"), rule.viewerIs("userB")),
    insert: rule.or(rule.viewerIs("userA"), rule.viewerIs("userB")),
    update: rule.deny(),
    delete: rule.deny(),
  },
  constraints: [{ unique: "byPair" }],
});

export const messages = table({
  columns: {
    convoId: t.ref(convos),
    authorId: t.ref(profiles),
    body: t.text(2000),
    at: t.time(),
    seq: t.int(), // global sequence; per-convo ordering + receipt watermarks
    hasQuote: t.bool(),
    quotedId: t.id(), // self id when hasQuote is false ("" is not a valid Id)
  },
  indexes: { byConvSeq: { columns: ["convoId", "seq"], unique: true } },
  rules: {
    read: rule.exists(members, "byConvUser", [rule.field("convoId"), rule.viewer]),
    insert: rule.and(
      rule.viewerIs("authorId"),
      rule.exists(roster, "byConvUserActive", [rule.field("convoId"), rule.viewer, rule.literal(true)]),
    ),
    update: rule.deny(),
    delete: rule.deny(),
  },
});

export const typing = channel({
  args: { convoId: t.id() },
  publish: rule.exists(roster, "byConvUserActive", [rule.field("convoId"), rule.viewer, rule.literal(true)]),
  subscribe: rule.exists(roster, "byConvUserActive", [rule.field("convoId"), rule.viewer, rule.literal(true)]),
  ttlMs: 4000,
});

export default schema({
  auth: { password: true },
  channels: { typing },
  tables: {
    convos,
    dmPairs,
    members,
    messages,
    roster,
    profiles,
    counters,
    posts,
    likes,
    reposts,
    follows,
    entries,
    postReplyCounts,
    likeCounts,
    repostCounts,
    followerCounts,
    followingCounts,
  },
  maintains: [
    { count: "posts", by: ["parentId"], into: "postReplyCounts" },
    { count: "likes", by: ["postId"], into: "likeCounts" },
    { count: "reposts", by: ["postId"], into: "repostCounts" },
    { count: "follows", by: ["followeeId"], into: "followerCounts" },
    { count: "follows", by: ["followerId"], into: "followingCounts" },
  ],
});
