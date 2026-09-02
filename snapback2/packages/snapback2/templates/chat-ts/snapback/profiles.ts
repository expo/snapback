import { mutation, query, t } from "snapback2";
import { profiles } from "./schema";

const profileArgs = {
  displayName: t.text(50),
  handle: t.text(20),
  avatarUrl: t.optional(t.text(2048)),
  bio: t.text(200),
  location: t.text(50),
  link: t.optional(t.text(2048)),
};

export const mine = query({}, ({ db, ctx }) =>
  db.get(profiles.byPrincipal, [ctx.viewer]));

export const byHandle = query({ handle: t.text(20) }, ({ db, args }) =>
  db.get(profiles.byHandle, [args.handle]));

export const createMyProfile = mutation({ ...profileArgs }, ({ db, ctx, args }) => {
  const existing = db.get(profiles.byPrincipal, [ctx.viewer]);
  if (existing !== null) return existing;
  const id = ctx.newId();
  db.insert(profiles, {
    id,
    principal: ctx.viewer,
    displayName: args.displayName,
    handle: args.handle,
    avatarUrl: args.avatarUrl,
    bio: args.bio,
    location: args.location,
    link: args.link,
  });
  return { id, principal: ctx.viewer, ...args };
});

export const updateMyProfile = mutation({ ...profileArgs }, ({ db, ctx, args }) => {
  const existing = db.get(profiles.byPrincipal, [ctx.viewer]);
  db.require(existing !== null, "PROFILE_REQUIRED");
  db.update(profiles, existing!.id, {
    displayName: args.displayName,
    handle: args.handle,
    avatarUrl: args.avatarUrl,
    bio: args.bio,
    location: args.location,
    link: args.link,
  });
  return { id: existing!.id, principal: ctx.viewer, ...args };
});
