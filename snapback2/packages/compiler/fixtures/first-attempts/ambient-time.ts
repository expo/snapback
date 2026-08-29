const messages = table("messages");

export const stampMessage = mutation({ id: scalar() }, ({ db, ctx, args }) => {
  db.update(messages, args.id, { at: Date.now() });
  return ctx.viewer;
});
