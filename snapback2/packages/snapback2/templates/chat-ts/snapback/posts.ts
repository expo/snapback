import { mutation, t } from "snapback2";
import { posts, profiles } from "./schema";

export const createPost = mutation({ body: t.text(500) }, ({ db, ctx, args }) => {
  db.require(db.exists(profiles.byPrincipal, [ctx.viewer]), "PROFILE_REQUIRED");
  const id = ctx.newId();
  const at = ctx.now();
  db.insert(posts, { id, author: ctx.viewer, body: args.body, at });
  return { id, author: ctx.viewer, body: args.body, at };
});
