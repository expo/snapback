import { api, defineItems, mutationTarget, withHistory } from "snapback2/client";

export const messageWrites = {
  create: mutationTarget(api.messages.send, "messages"),
  update: mutationTarget(api.messages.edit, "messages"),
  remove: mutationTarget(api.messages.unsend, "messages"),
};
const messageItems = {
  table: "messages",
  order: "reverse" as const,
  update: { target: messageWrites.update },
  remove: { target: messageWrites.remove },
};
export const threadItems = defineItems(api.messages.thread, {
  ...messageItems,
  select: delivery => delivery.message,
  create: {
    target: messageWrites.create,
    belongs: (args, query) => query.c == null && args.conversationId === query.conversationId,
    draft: args => ({ body: args.body }),
  },
});

export const conversationItems = withHistory(defineItems(api.messages.conversationView, {
  ...messageItems,
  rows: view => view.messages,
  select: delivery => delivery.message,
  create: {
    target: messageWrites.create,
    belongs: (args, query) => query.c == null && args.conversationId === query.conversationId,
    draft: args => ({ body: args.body }),
  },
}), { items: threadItems, args: ({ conversationId }) => ({ conversationId, c: null }) });
