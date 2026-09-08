import { api, defineItems, mutationTarget, withHistory } from "snapback2/client";

// @ref LLP 1018.003.001#3-semantic-mutation-targets — one certified domain binding, independent of insert order and query membership.
export const messageWrites = {
  create: mutationTarget(api.deliveries.post, "messages"),
  update: mutationTarget(api.deliveries.edit, "messages"),
  remove: mutationTarget(api.deliveries.unsend, "messages"),
};
const messageItems = {
  table: "messages",
  order: "reverse" as const,
  update: { target: messageWrites.update },
  remove: { target: messageWrites.remove },
};
export const threadItems = defineItems(api.deliveries.thread, {
  ...messageItems,
  select: delivery => delivery.message,
  create: {
    target: messageWrites.create,
    belongs: (args, query) => query.c === null && args.conversationId === query.conversationId,
    draft: args => ({ body: args.body }),
  },
});

// @ref LLP 1018.006#1-the-declaration — under partial custody the composite's
// rows come from the independently authorized thread page; declared once here,
// the SDK opens and closes that history for both platform arms.
export const conversationItems = withHistory(defineItems(api.deliveries.conversationView, {
  ...messageItems,
  rows: view => view.messages,
  select: delivery => delivery.message,
  create: {
    target: messageWrites.create,
    belongs: (args, query) => query.c == null && args.conversationId === query.conversationId,
    draft: args => ({ body: args.body }),
  },
}), { items: threadItems, args: ({ conversationId }) => ({ conversationId, c: null }) });
