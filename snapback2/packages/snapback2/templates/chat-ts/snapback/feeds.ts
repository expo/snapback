import { query } from "snapback2";
import { follows, posts, profiles } from "./schema";

export const globalFeed = query({}, ({ db }) => {
  const result: any[] = [];
  for (const post of db.scan(posts.byTime, [], { order: "desc", take: 50 })) {
    const author = db.get(profiles.byPrincipal, [post.author]);
    if (author !== null) result.push({ post, author });
  }
  return result;
});

export const followingFeed = query({}, ({ db, ctx }) => {
  const result: any[] = [];
  for (const post of db.scan(posts.byTime, [], { order: "desc", take: 50 })) {
    if (post.author === ctx.viewer
      || db.exists(follows.byFollowerFollowed, [ctx.viewer, post.author])) {
      const author = db.get(profiles.byPrincipal, [post.author]);
      if (author !== null) result.push({ post, author });
    }
  }
  return result;
});
