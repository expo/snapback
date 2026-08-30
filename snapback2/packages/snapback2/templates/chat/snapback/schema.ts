import { channel, rule, schema, table, t } from "snapback2";

export const profiles = table({
  columns: { principal: t.principal(), handle: t.text(32), name: t.text(80), email: t.text(200) },
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
  constraints: [{ unique: "byPrincipal" }, { immutable: ["principal"] }],
});

export const conversations = table({
  columns: { title: t.text(120), creatorId: t.principal() },
  indexes: { byCreator: { columns: ["creatorId"] } },
  rules: {
    read: rule.public("conversation shells are public"),
    insert: rule.viewerIs("creatorId"),
    update: rule.viewerIs("creatorId"),
    delete: rule.viewerIs("creatorId"),
  },
});

export const memberships = table({
  columns: {
    conversationId: t.ref(conversations),
    userId: t.principal(),
    lastReadAt: t.time(),
  },
  indexes: {
    byConvUser: { columns: ["conversationId", "userId"], unique: true },
    byUser: { columns: ["userId"] },
  },
  rules: {
    read: rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer]),
    insert: rule.allow(),
    update: rule.viewerIs("userId"),
    delete: rule.viewerIs("userId"),
  },
  constraints: [{ unique: "byConvUser" }],
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
    read: rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer]),
    insert: rule.and(
      rule.viewerIs("authorId"),
      rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer]),
    ),
    update: rule.viewerIs("authorId"),
    delete: rule.viewerIs("authorId"),
  },
});

export const messageCounts = table({
  columns: { conversationId: t.ref(conversations), value: t.int() },
  indexes: { byConversation: { columns: ["conversationId"], unique: true } },
  rules: {
    read: rule.public("counts disclose no message content"),
    insert: rule.deny(),
    update: rule.deny(),
    delete: rule.deny(),
  },
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
});

export const typing = channel({
  args: { conversationId: t.ref(conversations) },
  publish: rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer]),
  subscribe: rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer]),
  ttlMs: 4000,
});

export default schema({
  auth: { password: true, guests: true },
  tables: { profiles, conversations, memberships, messages, messageCounts, notifications },
  maintains: [{ count: "messages", by: ["conversationId"], into: "messageCounts" }],
  channels: { typing },
});
