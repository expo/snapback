const users = table("users");      // { id, name }
const recipes = table("recipes");  // { id, ownerId, title, createdAt }
                                   // index recipes.byOwnerCreated: (ownerId, createdAt)

export const myRecipes = query({}, ({ db, ctx }) => {
  return db.scan(recipes.byOwnerCreated, [ctx.viewer], { order: "desc", take: 50 });
});
