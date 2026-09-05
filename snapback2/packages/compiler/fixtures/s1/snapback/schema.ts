import { rule, schema, table, t } from "snapback2";

export const users = table({
  columns: { principal: t.principal(), handle: t.text(32) },
  indexes: {
    byPrincipal: { columns: ["principal"], unique: true },
    byHandle: { columns: ["handle"], unique: true },
  },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const conversations = table({
  columns: { title: t.text(64) },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const memberships = table({
  columns: { conversationId: t.ref(conversations), userId: t.principal(), lastReadAt: t.time(), lastReadId: t.optional(t.id()), activity: t.time() },
  indexes: {
    byConvUser: { columns: ["conversationId", "userId"], unique: true },
    byUserActivity: { columns: ["userId", "activity"] },
    byConversation: { columns: ["conversationId", "userId"] },
  },
  rules: {
    read: rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer]),
    insert: rule.allow(), update: rule.viewerIs("userId"), delete: rule.viewerIs("userId"),
  },
  constraints: [{ unique: "byConvUser" }, { cap: { by: ["conversationId"], max: 256 } }],
});

export const messages = table({
  columns: { conversationId: t.ref(conversations), authorId: t.principal(), body: t.text(256), at: t.time() },
  indexes: { byConvTime: { columns: ["conversationId", "at", "id"] }, byToken: { columns: ["body", "id"] } },
  rules: {
    read: rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer]),
    insert: rule.and(rule.viewerIs("authorId"), rule.exists(memberships, "byConvUser", [rule.field("conversationId"), rule.viewer])),
    update: rule.viewerIs("authorId"), delete: rule.viewerIs("authorId"),
  },
});

export const unreads = table({
  columns: { conversationId: t.ref(conversations), userId: t.principal(), value: t.int() },
  indexes: { byConvUser: { columns: ["conversationId", "userId"], unique: true } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const dmKeys = table({
  columns: { lo: t.principal(), hi: t.principal(), conversationId: t.ref(conversations) },
  indexes: { byPair: { columns: ["lo", "hi"], unique: true } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
  constraints: [{ unique: "byPair" }],
});

export const columns = table({
  columns: { boardId: t.id(), order: t.int(), title: t.text(64) },
  indexes: { byParentOrder: { columns: ["boardId", "order", "id"] } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const cards = table({
  columns: { columnId: t.id(), order: t.int(), title: t.text(64) },
  indexes: { byParentOrder: { columns: ["columnId", "order", "id"] } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const cardCounts = table({
  columns: { columnId: t.id(), value: t.int() },
  indexes: { byGroup: { columns: ["columnId"], unique: true } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const expenses = table({
  columns: { groupId: t.id(), amount: t.int(), payerId: t.principal() },
  indexes: { byGroup: { columns: ["groupId", "id"] } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const shares = table({
  columns: { expenseId: t.ref(expenses), groupId: t.id(), userId: t.principal(), amount: t.int() },
  indexes: { byExpense: { columns: ["expenseId", "id"] }, byGroupUser: { columns: ["groupId", "userId", "id"] } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const owed = table({
  columns: { groupId: t.id(), userId: t.principal(), value: t.int() },
  indexes: { byGroup: { columns: ["groupId", "userId"], unique: true } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const accounts = table({
  columns: { groupId: t.id(), parentId: t.id(), name: t.text(64) },
  indexes: { byGroup: { columns: ["groupId", "id"] } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const waitlist = table({
  columns: { resourceId: t.id(), ownerId: t.principal() },
  indexes: { byResource: { columns: ["resourceId", "id"] } },
  rules: { read: rule.viewerIs("ownerId"), insert: rule.allow(), update: rule.allow(), delete: rule.allow() },
});

export const waitCounts = table({
  columns: { resourceId: t.id(), value: t.int() },
  indexes: { byGroup: { columns: ["resourceId"], unique: true } },
  rules: { read: rule.public("spike fixture"), insert: rule.public("spike fixture"), update: rule.public("spike fixture"), delete: rule.public("spike fixture") },
});

export const entitlements = table({
  columns: { userId: t.principal() },
  indexes: { byUser: { columns: ["userId"], unique: true } },
  rules: { read: rule.deny(), insert: rule.allow(), update: rule.allow(), delete: rule.allow() },
});

export const secretDocs = table({
  columns: { title: t.text(64) },
  rules: {
    read: rule.exists(entitlements, "byUser", [rule.viewer]),
    insert: rule.allow(), update: rule.allow(), delete: rule.allow(),
  },
});

export default schema({
  auth: { password: true, guests: true },
  tables: {
    users, conversations, memberships, messages, unreads, dmKeys, columns, cards,
    cardCounts, expenses, shares, owed, accounts, waitlist, waitCounts, entitlements, secretDocs,
  },
  maintains: [
    { count: "cards", by: ["columnId"], into: "cardCounts" },
    { sum: { source: "shares", of: "amount" }, by: ["groupId", "userId"], into: "owed" },
    { count: "waitlist", by: ["resourceId"], into: "waitCounts", readable: rule.public("resource owners disclose queue depth") },
  ],
});
