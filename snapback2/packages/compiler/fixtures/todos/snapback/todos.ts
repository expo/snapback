import { decimal, min, mutation, query, t } from "snapback2";
import { todos } from "./schema";

export const list = query({}, ({ db, ctx }) =>
  db.scan(todos.byOwner, [ctx.viewer], { take: 50 }),
);

export const add = mutation({
  title: t.text(200),
  price: t.decimal(2),
  budget: t.money("USD"),
  status: t.enum(["open", "done"]),
}, ({ db, ctx, args }) => {
  const id = ctx.newId();
  db.insert(todos, { id, title: args.title, done: false, ownerId: ctx.viewer, price: args.price, budget: args.budget, status: args.status });
  return { id };
});

export const addLiteral = mutation({ title: t.text(200) }, ({ db, ctx, args }) => {
  const id = ctx.newId();
  db.insert(todos, { id, title: args.title, done: false, ownerId: ctx.viewer, price: 9.99, status: "open" });
  return { id, price: decimal(9.99, 2), status: "open" };
});

export const echo = query({
  note: t.optional(t.text(80)),
  labels: t.list(t.text(40), { max: 8 }),
}, ({ args }) => ({ note: args.note, labels: args.labels }));

export const decimalMath = query({ price: t.decimal(2) }, ({ args }) => ({
  below: args.price < 9.99,
  unchanged: args.price + 0,
  doubled: args.price * 2,
  minimum: min(args.price, 9.99),
}));

export const argDefaults = query({
  price: t.optional(t.decimal(2)),
  status: t.optional(t.enum(["open", "done"])),
}, ({ args }) => ({ price: args.price ?? 9.99, status: args.status ?? "open" }));

export const reprice = mutation({ id: t.id() }, ({ db, args }) =>
  db.update(todos, args.id, { price: 1.25, status: "done" }));

export const upsertLiteral = mutation({ id: t.id(), title: t.text(200), ownerId: t.id() }, ({ db, args }) =>
  db.upsert(todos, args.id, {
    id: args.id,
    title: args.title,
    done: false,
    ownerId: args.ownerId,
    price: 2.5,
    status: "open",
  }));

export const encoded = query({}, () => decimal(9.99, 2));
