const messages = table("messages");

export const seedMessages = mutation({}, ({ db, ctx }) => {
  let i = 0;
  while (i < 3) {
    db.insert(messages, { id: ctx.newId(), body: "seed" });
    i++;
  }
  return true;
});
