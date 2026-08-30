import { rule, schema, table, t } from "snapback2";

export const entries = table({
  columns: {
    status: t.enum(["open", "closed"]),
    amount: t.decimal(2),
    tags: t.list(t.text(20), { max: 2 }),
    note: t.optional(t.text(20)),
    data: t.json(100),
  },
  rules: { read: rule.public("seed fixture") },
});

export default schema({ tables: { entries } });
