import { mutation, query, t } from "snapback2";
import { follows, profiles } from "./schema";

export const setFollow = mutation(
  { userId: t.ref(profiles), on: t.bool() },
  ({ db, ctx, args }) => {
    db.require(args.userId !== ctx.viewer, "SELF_FOLLOW");
    const target = db.get(profiles, args.userId);
    db.require(target !== null, "TARGET_UNKNOWN");
    const me = db.get(profiles, ctx.viewer);
    db.require(me !== null, "PROFILE_REQUIRED");
    const existing = db.get(follows.byPair, [ctx.viewer, args.userId]);
    if (args.on && existing === null) {
      db.insert(follows, {
        id: ctx.newId(),
        followerId: ctx.viewer,
        followeeId: args.userId,
        at: ctx.now(),
      });
    }
    if (!args.on && existing !== null) {
      db.delete(follows, existing.id);
    }
    return { following: args.on };
  },
);

export const relationship = query({ userId: t.ref(profiles) }, ({ db, ctx, args }) => ({
  following: db.get(follows.byPair, [ctx.viewer, args.userId]) !== null,
  followsMe: db.get(follows.byPair, [args.userId, ctx.viewer]) !== null,
}));
