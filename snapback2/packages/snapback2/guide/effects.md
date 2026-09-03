# Effects

Effects are outside the data transaction. A mutation durably emits an outbox
row; the optional Ibex 2 runner performs I/O and may invoke a named Quarry
`then` mutation. The TypeScript module exports effects only:

```ts
import { effect } from "snapback2";
import { recordNotified } from "./notifications";
import { notifications } from "./schema";

const baseHeaders = { accept: "application/json" };
const requestDefaults = {
  method: "POST",
  headers: { ...baseHeaders, "content-type": "application/json" },
};

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
```

Quarry declares the effect's module and emits the payload:

```q
effect notify from delivery
```

```q
  emit notify { to: recipient.principal, body }
```

The default development binary has no engine. `snapback2 test` records the
derived effects check as `blocked: no engine in this build`; it never claims
the queued row was sent. Use `snapback2 trace <seq>` to see the outbox row.
