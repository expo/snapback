import { mutation, t } from "snapback2";
import { conversations, memberships } from "./schema";

export const groupCreate = mutation({
  title: t.text(120),
  members: t.list(t.principal(), { max: 49 }),
}, ({ db, ctx, args }) => {
  db.require(args.members.length >= 1, "GROUP_REQUIRES_MEMBER");
  const conversationId = ctx.newId();
  const creatorMembershipId = ctx.newId();
  const joinedAt = ctx.now();
  db.insert(conversations, { id: conversationId, title: args.title, creatorId: ctx.viewer });
  db.insert(memberships, {
    id: creatorMembershipId,
    conversationId,
    principal: ctx.viewer,
    role: "admin",
    joinedAt,
  });
  for (const principal of args.members) {
    db.require(principal !== ctx.viewer, "CREATOR_ALREADY_ADMIN");
    db.insert(memberships, {
      id: ctx.newId(),
      conversationId,
      principal,
      role: "member",
      joinedAt,
    });
  }
  return { id: conversationId, creatorMembershipId };
});

export const memberAdd = mutation({
  conversationId: t.ref(conversations),
  principal: t.principal(),
}, ({ db, ctx, args }) => {
  db.require(
    db.exists(memberships.byConversationPrincipalRole, [args.conversationId, ctx.viewer, "admin"]),
    "ADMIN_REQUIRED",
  );
  db.require(args.principal !== ctx.viewer, "ADMIN_SELF_RESEAT");
  const id = ctx.newId();
  db.insert(memberships, {
    id,
    conversationId: args.conversationId,
    principal: args.principal,
    role: "member",
    joinedAt: ctx.now(),
  });
  return { id };
});

export const memberPromote = mutation({
  conversationId: t.ref(conversations),
  membershipId: t.ref(memberships),
}, ({ db, ctx, args }) => {
  db.require(
    db.exists(memberships.byConversationPrincipalRole, [args.conversationId, ctx.viewer, "admin"]),
    "ADMIN_REQUIRED",
  );
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — target identity never substitutes for the handler's authored authority scope.
  const membership = db.get(memberships, args.membershipId);
  db.require(membership !== null, "MEMBERSHIP_REQUIRED");
  db.require(membership!.conversationId === args.conversationId, "MEMBERSHIP_SCOPE_REQUIRED");
  db.require(membership!.role === "member", "MEMBER_REQUIRED");
  db.update(memberships, membership!.id, { role: "admin" });
  return null;
});

export const memberRemove = mutation({
  conversationId: t.ref(conversations),
  membershipId: t.ref(memberships),
}, ({ db, ctx, args }) => {
  db.require(
    db.exists(memberships.byConversationPrincipalRole, [args.conversationId, ctx.viewer, "admin"]),
    "ADMIN_REQUIRED",
  );
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — target identity never substitutes for the handler's authored authority scope.
  const membership = db.get(memberships, args.membershipId);
  db.require(membership !== null, "MEMBERSHIP_REQUIRED");
  db.require(membership!.conversationId === args.conversationId, "MEMBERSHIP_SCOPE_REQUIRED");
  db.require(membership!.principal !== ctx.viewer, "ADMIN_SELF_REMOVE");
  db.delete(memberships, membership!.id);
  return null;
});

export const memberLeave = mutation({
  conversationId: t.ref(conversations),
  membershipId: t.ref(memberships),
}, ({ db, ctx, args }) => {
  const membership = db.get(memberships.byConversationPrincipal, [args.conversationId, ctx.viewer]);
  db.require(membership !== null, "MEMBERSHIP_REQUIRED");
  db.require(membership!.id === args.membershipId, "MEMBERSHIP_SELF_REQUIRED");
  db.delete(memberships, membership!.id);
  return null;
});
