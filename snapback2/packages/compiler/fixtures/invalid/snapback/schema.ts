import { rule, schema, table, t } from "snapback2";

export const _bad = table({
  columns: { ownerId: t.id() },
  indexes: { byMissing: { columns: ["missing"] } },
  rules: { read: rule.public("fixture"), insert: rule.allow(), update: rule.allow(), delete: rule.allow() },
});

export default schema({ tables: { _bad } });
