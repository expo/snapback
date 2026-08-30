import { max, mutation, query, t } from "snapback2";
import { ledger } from "./schema";

export const precision = mutation({}, ({ db, ctx }) =>
  db.insert(ledger, { id: ctx.newId(), price: 9.999, tax: 1000, status: "open", quantity: 1 }));

export const untypedFraction = query({}, () => 1.5);

export const scaleAdd = query({ left: t.decimal(2), right: t.decimal(3) }, ({ args }) => args.left + args.right);
export const divide = query({ price: t.decimal(2) }, ({ args }) => args.price / 2);
export const modulo = query({ price: t.decimal(2) }, ({ args }) => args.price % 2);
export const multiplyDecimals = query({ left: t.decimal(2), right: t.decimal(2) }, ({ args }) => args.left * args.right);
export const addInt = query({ price: t.decimal(2), quantity: t.int() }, ({ args }) => args.price + args.quantity);
export const maxScale = query({ left: t.decimal(2), right: t.decimal(3) }, ({ args }) => max(args.left, args.right));
export const enumVariant = query({ status: t.enum(["open", "closed"]) }, ({ args }) => args.status === "archived");
export const enumDefault = query({ status: t.optional(t.enum(["open", "closed"])) }, ({ args }) => args.status ?? "archived");
export const enumAssignment = mutation({}, ({ db, ctx }) =>
  db.insert(ledger, { id: ctx.newId(), price: 100, tax: 1000, status: "archived", quantity: 1 }));
