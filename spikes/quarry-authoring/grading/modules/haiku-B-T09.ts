const users = table("users");
const shows = table("shows");
const subs = table("subs");
const episodes = table("episodes");

export const inboxBadges = query({}, ({ db, ctx }) => {
  let result: any[] = [];
  
  const subs_page = db.scan(subs.byUser, [ctx.viewer], { take: 50 });
  
  for (const sub of subs_page) {
    const show = db.get(shows, sub.showId);
    
    let episodes_page: any[];
    if (sub.lastListenedAt === null) {
      episodes_page = db.scan(episodes.byShowPublished, [sub.showId], { take: 100 });
    } else {
      episodes_page = db.scan(episodes.byShowPublished, [sub.showId], 
                              { after: sub.lastListenedAt, take: 100 });
    }
    
    const { count, atCap } = episodes_page.countCapped();
    const badgeCount = atCap ? "99+" : String(count);
    
    result.push({
      showTitle: show.title,
      badgeCount
    });
  }
  
  return result;
});
