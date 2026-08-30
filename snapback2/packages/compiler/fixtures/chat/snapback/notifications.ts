import { effect, mutation, t } from "snapback2";
import { notifications } from "./schema";

const baseHeaders = { accept: "application/json" };
const requestDefaults = {
  method: "POST",
  headers: { ...baseHeaders, "content-type": "application/json" },
};

export const recordNotified = mutation({
  outboxId: t.id(),
  effect: t.text(100),
  result: t.json<{ providerId: string }>(1000),
}, ({ db, ctx, args }) => {
  db.insert(notifications, {
    id: ctx.newId(),
    outboxId: args.outboxId,
    effect: args.effect,
    providerId: args.result.providerId,
  });
  return true;
});

export const notify = effect({
  grants: ["https://api.example.com"],
  run: async (payload: { to: string; body: string }, { fetch, meta }) => {
    function identity(value: string) { return value; }
    const formatter = { format(value: string) { return identity(value); } };
    const body = [payload.body].map(function keep(value) { return formatter.format(value); })[0];
    try {
      const response = await fetch("https://api.example.com/send", {
        method: requestDefaults.method,
        headers: { ...requestDefaults.headers, "idempotency-key": meta.id },
        body: JSON.stringify({ ...payload, body }),
      });
      if (!response.ok) throw new Error(`provider ${response.status}`);
      return { providerId: (await response.json()).id as string };
    } catch (error) {
      throw error;
    }
  },
  then: recordNotified,
});
