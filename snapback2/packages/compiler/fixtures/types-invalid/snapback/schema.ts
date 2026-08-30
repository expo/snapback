import { rule, schema, table, t } from "snapback2";

export const ledger = table({
  columns: {
    price: t.decimal(2),
    tax: t.decimal(3),
    status: t.enum(["open", "closed"]),
    quantity: t.int(),
  },
  rules: {
    read: rule.public("decimal refusal fixture"),
    insert: rule.allow(),
    update: rule.allow(),
    delete: rule.allow(),
  },
});

export default schema({ tables: { ledger } });
