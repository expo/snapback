const users = table("users");      // { id, name }
const recipes = table("recipes");  // { id, ownerId, title, createdAt }
                                   // index recipes.byOwnerCreated: (ownerId, createdAt)

export const myRecipes = query({ after: optional(time()) }, ({ db, ctx, args }) => {
  return db.scan(recipes.byOwnerCreated, [ctx.viewer], {
    order: "desc",
    take: 50,
    after: args.after,
  });
});
