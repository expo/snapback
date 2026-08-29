import { emit, mutation, query, t } from "snapback2";
import { memberships, messages, profiles } from "./schema";
import { notify } from "./notifications";

export const thread = query({ conversationId: t.id() }, ({ db, args }) =>
  db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 50 }),
);

export const send = mutation({
  conversationId: t.id(),
  recipientId: t.id(),
  body: t.text(4000),
}, ({ db, ctx, args }) => {
  db.require(db.exists(memberships.byConvUser, [args.conversationId, ctx.viewer]), "NOT_MEMBER");
  const recipient = db.get(profiles, args.recipientId);
  db.require(recipient !== null, "RECIPIENT_UNKNOWN");
  const id = ctx.newId();
  db.insert(messages, {
    id,
    conversationId: args.conversationId,
    authorId: ctx.viewer,
    body: args.body,
    at: ctx.now(),
  });
  emit(notify, { to: recipient!.email, body: args.body });
  return { id };
});
