import { mutation, query, t } from "snapback2";
import { followerCounts, followingCounts, profiles } from "./schema";

export const me = query({}, ({ db, ctx }) => db.get(profiles, ctx.viewer));

export const byId = query({ userId: t.ref(profiles) }, ({ db, args }) => {
  const profile = db.get(profiles, args.userId);
  if (profile === null) return null;
  const followerTally = db.get(followerCounts.byFollowee, [args.userId]);
  const followingTally = db.get(followingCounts.byFollower, [args.userId]);
  return {
    id: profile.id,
    displayName: profile.displayName,
    handle: profile.handle,
    bio: profile.bio,
    location: profile.location,
    link: profile.link,
    followerCount: followerTally === null ? 0 : followerTally.value,
    followingCount: followingTally === null ? 0 : followingTally.value,
  };
});

export const byHandle = query({ handle: t.text(20) }, ({ db, args }) =>
  db.get(profiles.byHandle, [args.handle]),
);

export const save = mutation(
  {
    displayName: t.text(50),
    handle: t.text(20),
    bio: t.text(200),
    location: t.text(50),
    link: t.text(200),
  },
  ({ db, ctx, args }) => {
    db.require(args.displayName.length >= 1, "DISPLAY_NAME_REQUIRED");
    db.require(args.handle.length >= 3, "HANDLE_TOO_SHORT");
    // Handle charset ([a-z0-9_]) is validated client-side; the certified
    // handler surface has no per-character string ops. Uniqueness and length
    // are enforced here (plus the unique index constraint).
    const existing = db.get(profiles.byHandle, [args.handle]);
    db.require(existing === null || existing.id === ctx.viewer, "HANDLE_TAKEN");
    const mine = db.get(profiles, ctx.viewer);
    if (mine === null) {
      db.insert(profiles, {
        id: ctx.viewer,
        displayName: args.displayName,
        handle: args.handle,
        bio: args.bio,
        location: args.location,
        link: args.link,
      });
    } else {
      db.update(profiles, ctx.viewer, {
        displayName: args.displayName,
        handle: args.handle,
        bio: args.bio,
        location: args.location,
        link: args.link,
      });
    }
    return { id: ctx.viewer };
  },
);
