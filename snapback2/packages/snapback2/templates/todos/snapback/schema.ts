import { rule, schema, table, t } from "snapback2";

export const todos = table({
  columns: { title: t.text(200), done: t.bool(), ownerId: t.id() },
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
