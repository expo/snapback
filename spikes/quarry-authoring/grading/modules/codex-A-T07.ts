const users = table("users");        // { id, name }
const clubs = table("clubs");        // { id, name }
const members = table("members");    // { id, clubId, userId, joinedAt }
                                     // index members.byClubUser: (clubId, userId)
                                     // index members.byClub: (clubId, joinedAt)
const posts = table("posts");        // { id, clubId, authorId, body, at }
                                     // index posts.byClubAt: (clubId, at)
const unseen = table("unseen");      // { id, clubId, userId, n }
                                     // unique index unseen.byClubUser: (clubId, userId)

export const announce = mutation(
  {
    clubId: id(clubs),
    body: text({ max: 4096 }),
  },
  ({ db, ctx, args }) => {
    db.require(
      db.exists(members.byClubUser, [args.clubId, ctx.viewer]),
      "NOT_MEMBER",
    );

    const clubMembers = db.scan(members.byClub, [args.clubId], { take: 200 });
    db.require(!clubMembers.hasMore, "CLUB_MEMBER_LIMIT_EXCEEDED");

    const postId = ctx.newId();
    db.insert(posts, {
      id: postId,
      clubId: args.clubId,
      authorId: ctx.viewer,
      body: args.body,
      at: ctx.commitTime,
    });

    for (const member of clubMembers) {
      const counter = db.get(unseen.byClubUser, [
        args.clubId,
        member.userId,
      ]);

      if (counter) {
        db.update(unseen, counter.id, { n: counter.n + 1 });
      } else {
        db.insert(unseen, {
          id: ctx.newId(),
          clubId: args.clubId,
          userId: member.userId,
          n: 1,
        });
      }
    }

    return postId;
  },
);
