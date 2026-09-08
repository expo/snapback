import { api, defineItems, withHistory } from "snapback2/client";

// @ref LLP 1018.003.000#2-correspondence —
// only the head page owns drafts; post inserts its message before its fan-out.
export const threadItems = defineItems(api.deliveries.thread, {
  table: "messages",
  select: delivery => delivery.message,
  order: "reverse",
  create: {
    op: api.deliveries.post,
    belongs: (args, query) => query.c === null && args.conversationId === query.conversationId,
    key: intent => intent.ids[0],
    draft: args => ({ body: args.body }),
  },
  update: { op: api.deliveries.edit, key: args => args.messageId },
  remove: { op: api.deliveries.unsend, key: args => args.messageId },
});

// @ref LLP 1018.006#1-the-declaration — under partial custody the composite's
// rows come from the independently authorized thread page; declared once here,
// the SDK opens and closes that history for both platform arms.
export const conversationItems = withHistory(defineItems(api.deliveries.conversationView, {
  table: "messages",
  rows: view => view.messages,
  select: delivery => delivery.message,
  order: "reverse",
  create: {
    op: api.deliveries.post,
    belongs: (args, query) => query.c == null && args.conversationId === query.conversationId,
    key: intent => intent.ids[0],
    draft: args => ({ body: args.body }),
  },
  update: { op: api.deliveries.edit, key: args => args.messageId },
  remove: { op: api.deliveries.unsend, key: args => args.messageId },
}), { items: threadItems, args: ({ conversationId }) => ({ conversationId, c: null }) });
