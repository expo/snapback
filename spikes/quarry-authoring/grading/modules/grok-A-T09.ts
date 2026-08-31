const users = table("users");       // { id, name }
const shows = table("shows");       // { id, title }
const subs = table("subs");         // { id, userId, showId, lastListenedAt }
                                    // index subs.byUser: (userId)
const episodes = table("episodes"); // { id, showId, publishedAt, title }
                                    // index episodes.byShowPublished: (showId, publishedAt)

export const inboxBadges = query({}, ({ db, ctx }) => {
  let result: any[] = [];
  for (const sub of db.scan(subs.byUser, [ctx.viewer], { take: 50 })) {
    const show = db.get(shows, sub.showId);
    const unread = db.scan(episodes.byShowPublished, [sub.showId], {
      order: "asc",
      after: sub.lastListenedAt,
      take: 100,
    });
    const { count, atCap } = unread.countCapped();
    result.push({
      title: show.title,
      badge: atCap || count > 99 ? "99+" : count,
    });
  }
  return result;
});
