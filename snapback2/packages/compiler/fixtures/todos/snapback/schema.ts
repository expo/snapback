import { rule, schema, table, t } from "snapback2";

export const todos = table({
  columns: {
    title: t.text(200),
    done: t.bool(),
    ownerId: t.id(),
    price: t.decimal(2),
    status: t.enum(["open", "done"]),
    budget: t.optional(t.money("USD")),
    labels: t.optional(t.list(t.text(40), { max: 8 })),
    metadata: t.optional(t.json(2000)),
  },
  indexes: { byOwner: { columns: ["ownerId"] } },
  rules: {
    read: rule.viewerIs("ownerId"),
    insert: rule.viewerIs("ownerId"),
    update: rule.viewerIs("ownerId"),
    delete: rule.viewerIs("ownerId"),
  },
});

export default schema({
  auth: { password: true, guests: true },
  tables: { todos },
});
