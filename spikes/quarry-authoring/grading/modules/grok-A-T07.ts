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
  { clubId: id(clubs), body: text({ max: 4096 }) },
  ({ db, ctx, args }) => {
    db.require(db.exists(members.byClubUser, [args.clubId, ctx.viewer]), "NOT_MEMBER");

    const postId = ctx.newId();
    db.insert(posts, {
      id: postId,
      clubId: args.clubId,
      authorId: ctx.viewer,
      body: args.body,
      at: ctx.now(),
    });

    const memberPage = db.scan(members.byClub, [args.clubId], { take: 200 });
    db.require(!memberPage.hasMore, "CLUB_TOO_LARGE");

    for (const member of memberPage) {
      const row = db.get(unseen.byClubUser, [args.clubId, member.userId]);
      if (row) {
        db.update(unseen, row.id, { n: row.n + 1 });
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
