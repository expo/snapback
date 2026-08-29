import { rule, schema, table, t } from "snapback2";

export const logs = table({
  columns: { value: t.text(100) },
  rules: { read: rule.public("fixture"), insert: rule.allow(), update: rule.allow(), delete: rule.allow() },
});

export default schema({ tables: { logs } });
