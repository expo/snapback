import { channel, rule, schema, table, t } from "snapback2";

export const profiles = table({
  columns: {
    principal: t.principal(),
    displayName: t.text(50),
    handle: t.text(20),
    avatarUrl: t.optional(t.text(2048)),
    bio: t.text(200),
    location: t.text(50),
    link: t.optional(t.text(2048)),
  },
  indexes: {
    byPrincipal: { columns: ["principal"], unique: true },
    byHandle: { columns: ["handle"], unique: true },
  },
  rules: {
    read: rule.public("profiles are public"),
    insert: rule.viewerIs("principal"),
    update: rule.viewerIs("principal"),
    delete: rule.deny(),
  },
  constraints: [
    { unique: "byPrincipal" },
    { unique: "byHandle" },
    { immutable: ["principal"] },
    { text: { field: "displayName", min: 1 } },
    { text: { field: "handle", min: 3, format: "handle" } },
    { text: { field: "avatarUrl", format: "url" } },
    { text: { field: "link", format: "url" } },
  ],
});

export const conversations = table({
  columns: { title: t.text(120), creatorId: t.principal() },
  indexes: {
    byCreator: { columns: ["creatorId"] },
    byIdCreator: { columns: ["id", "creatorId"], unique: true },
  },
  rules: {
    read: rule.exists(memberships, "byConversationPrincipal", [
      rule.field("id"),
      rule.viewer,
    ]),
    insert: rule.viewerIs("creatorId"),
    update: rule.deny(),
    delete: rule.deny(),
  },
  constraints: [
    { unique: "byIdCreator" },
    { finalExistsOnInsert: {
      table: "memberships",
      index: "byConversationPrincipalRole",
      key: [rule.field("id"), rule.field("creatorId"), rule.literal("admin")],
    } },
  ],
});

// The compiler statically lowers descriptors; `var` permits this reciprocal rule/ref declaration.
export var memberships = table({
  columns: {
    conversationId: t.ref(conversations),
    principal: t.principal(),
    role: t.enum(["member", "admin"]),
    joinedAt: t.time(),
  },
  indexes: {
    byConversationPrincipal: { columns: ["conversationId", "principal"], unique: true },
    byConversationPrincipalRole: { columns: ["conversationId", "principal", "role"] },
    byPrincipalConversation: { columns: ["principal", "conversationId"] },
  },
  rules: {
    read: rule.exists(memberships, "byConversationPrincipal", [
      rule.field("conversationId"),
      rule.viewer,
    ]),
    insert: rule.or(
      rule.exists(memberships, "byConversationPrincipalRole", [
        rule.field("conversationId"),
        rule.viewer,
        rule.literal("admin"),
      ]),
      rule.and(
        rule.viewerIs("principal"),
        rule.eq(rule.field("role"), rule.literal("admin")),
        rule.created(conversations, "byIdCreator", [
          rule.field("conversationId"),
          rule.viewer,
        ]),
      ),
    ),
    update: rule.and(
      rule.exists(memberships, "byConversationPrincipalRole", [
        rule.oldField("conversationId"),
        rule.viewer,
        rule.literal("admin"),
      ]),
      rule.eq(rule.oldField("conversationId"), rule.nextField("conversationId")),
      rule.eq(rule.oldField("principal"), rule.nextField("principal")),
      rule.eq(rule.oldField("role"), rule.literal("member")),
      rule.eq(rule.nextField("role"), rule.literal("admin")),
    ),
    delete: rule.or(
      rule.viewerIs("principal"),
      rule.exists(memberships, "byConversationPrincipalRole", [
        rule.field("conversationId"),
        rule.viewer,
        rule.literal("admin"),
      ]),
    ),
  },
  constraints: [
    { unique: "byConversationPrincipal" },
    { immutable: ["conversationId", "principal", "joinedAt"] },
  ],
});

export const messages = table({
  columns: {
    conversationId: t.ref(conversations),
    authorId: t.principal(),
    body: t.text(4000),
    at: t.time(),
  },
  indexes: { byConvTime: { columns: ["conversationId", "at", "id"] } },
  rules: {
    read: rule.exists(memberships, "byConversationPrincipal", [rule.field("conversationId"), rule.viewer]),
    insert: rule.and(
      rule.viewerIs("authorId"),
      rule.exists(memberships, "byConversationPrincipal", [rule.field("conversationId"), rule.viewer]),
    ),
    update: rule.viewerIs("authorId"),
    delete: rule.viewerIs("authorId"),
  },
});

export const posts = table({
  columns: {
    author: t.principal(),
    body: t.text(500),
    at: t.time(),
  },
  indexes: {
    byTime: { columns: ["at", "id"] },
    byAuthorTime: { columns: ["author", "at", "id"] },
  },
  rules: {
    read: rule.public("posts are globally readable product content"),
    insert: rule.viewerIs("author"),
    update: rule.viewerIs("author"),
    delete: rule.viewerIs("author"),
  },
  constraints: [
    { immutable: ["author", "at"] },
    { text: { field: "body", min: 1 } },
  ],
});

export const follows = table({
  columns: {
    follower: t.principal(),
    followed: t.principal(),
    at: t.time(),
  },
  indexes: {
    byFollowerFollowed: { columns: ["follower", "followed"], unique: true },
    byFollower: { columns: ["follower", "followed"] },
    byFollowed: { columns: ["followed", "follower"] },
  },
  rules: {
    read: rule.public("follows are public product-selection relationships"),
    insert: rule.viewerIs("follower"),
    update: rule.deny(),
    delete: rule.viewerIs("follower"),
  },
  constraints: [
    { unique: "byFollowerFollowed" },
    { immutable: ["follower", "followed", "at"] },
  ],
});

export const messageCounts = table({
  columns: { conversationId: t.ref(conversations), value: t.int() },
  indexes: { byConversation: { columns: ["conversationId"], unique: true } },
  rules: {
    read: rule.exists(memberships, "byConversationPrincipal", [
      rule.field("conversationId"),
      rule.viewer,
    ]),
    insert: rule.deny(),
    update: rule.deny(),
    delete: rule.deny(),
  },
  constraints: [{ unique: "byConversation" }],
});

export const notifications = table({
  columns: { outboxId: t.id(), effect: t.text(100), providerId: t.text(200) },
  indexes: { byOutbox: { columns: ["outboxId"], unique: true } },
  rules: {
    read: rule.deny(),
    // @ref LLP 1003#2-the-outbox-lifecycle — effect continuations re-enter as system.
    insert: rule.system(),
    update: rule.system(),
    delete: rule.deny(),
  },
  constraints: [{ unique: "byOutbox" }],
});

export const typing = channel({
  args: { conversationId: t.ref(conversations) },
  publish: rule.exists(memberships, "byConversationPrincipal", [rule.field("conversationId"), rule.viewer]),
  subscribe: rule.exists(memberships, "byConversationPrincipal", [rule.field("conversationId"), rule.viewer]),
  ttlMs: 4000,
});

export default schema({
  auth: { password: true, guests: true },
  tables: { profiles, conversations, memberships, messages, posts, follows, messageCounts, notifications },
  maintains: [{ count: "messages", by: ["conversationId"], into: "messageCounts" }],
  channels: { typing },
});
