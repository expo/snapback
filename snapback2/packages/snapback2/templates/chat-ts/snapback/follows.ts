import { mutation, t } from "snapback2";
import { follows } from "./schema";

export const setFollow = mutation({
  target: t.principal(),
  following: t.bool(),
}, ({ db, ctx, args }) => {
  db.require(args.target !== ctx.viewer, "SELF_FOLLOW");
  const existing = db.get(follows.byFollowerFollowed, [ctx.viewer, args.target]);
  if (args.following) {
    if (existing !== null) return existing;
    const id = ctx.newId();
    const at = ctx.now();
    db.insert(follows, { id, follower: ctx.viewer, followed: args.target, at });
    return { id, follower: ctx.viewer, followed: args.target, at };
  }
  if (existing !== null) db.delete(follows, existing.id);
  return null;
});
