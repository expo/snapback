const follows = table("follows");
const feedEvents = table("feedEvents");

export const followingFeed = query({}, ({ db, ctx }) => {
  const fs = db.scan(follows.byFollower, [ctx.viewer]);
  return fs.map((follow) =>
    db.scan(feedEvents.byActorTime, [follow.followeeId], { order: "desc", take: 20 }),
  );
});
