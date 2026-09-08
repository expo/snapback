import { api, defineItems } from "snapback2/client";

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

export const conversationItems = defineItems(api.deliveries.conversationView, {
  table: "messages",
  rows: view => view.messages,
  select: delivery => delivery.message,
  order: "reverse",
  create: {
    op: api.deliveries.post,
    belongs: (args, query) => args.conversationId === query.conversationId,
    key: intent => intent.ids[0],
    draft: args => ({ body: args.body }),
  },
  update: { op: api.deliveries.edit, key: args => args.messageId },
  remove: { op: api.deliveries.unsend, key: args => args.messageId },
});
