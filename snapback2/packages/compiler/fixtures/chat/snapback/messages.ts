import { emit, mutation, query, t } from "snapback2";
import { conversations, memberships, messages, profiles } from "./schema";
import { notify } from "./notifications";

export const thread = query({ conversationId: t.ref(conversations) }, ({ db, ctx, args }) => {
  db.require(
    db.exists(memberships.byConversationPrincipal, [args.conversationId, ctx.viewer]),
    "MEMBERSHIP_REQUIRED",
  );
  return db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 50 });
});

export const send = mutation({
  conversationId: t.ref(conversations),
  recipientId: t.ref(profiles),
  body: t.text(4000),
}, ({ db, ctx, args }) => {
  db.require(db.exists(memberships.byConversationPrincipal, [args.conversationId, ctx.viewer]), "NOT_MEMBER");
  const recipient = db.get(profiles, args.recipientId);
  db.require(recipient !== null, "RECIPIENT_UNKNOWN");
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — a public profile is not private-message delivery authority.
  db.require(
    db.exists(memberships.byConversationPrincipal, [args.conversationId, recipient!.principal]),
    "RECIPIENT_NOT_MEMBER",
  );
  const id = ctx.newId();
  db.insert(messages, {
    id,
    conversationId: args.conversationId,
    authorId: ctx.viewer,
    body: args.body,
    at: ctx.now(),
  });
  emit(notify, { to: recipient!.principal, body: args.body });
  return { id };
});
