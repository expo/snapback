import { mutation, query, t } from "snapback2";
import { todos } from "./schema";

export const list = query({}, ({ db, ctx }) =>
  db.scan(todos.byOwner, [ctx.viewer], { take: 50 }),
);

export const add = mutation({ title: t.text(200) }, ({ db, ctx, args }) => {
  const id = ctx.newId();
  db.insert(todos, { id, title: args.title, done: false, ownerId: ctx.viewer });
  return { id };
});
