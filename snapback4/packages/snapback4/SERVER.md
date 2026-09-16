# TypeScript server handlers

`check` and `dev` generate `snapback/generated/server.ts` from declared
actions. Import its `server` function in the application's server entry:

```ts
import { server } from "./generated/server.ts";
import { api } from "./generated/api.ts";
import { GiveUp } from "snapback4/worker";

export default server({
  actions: {
    async summarize({ doc, revision }, ctx) {
      const source = await ctx.query(api.documentAt, { doc, revision });
      if (!("data" in source)) throw new GiveUp("the document is unavailable");
      const text = await ctx.step("model", { doc, revision }, key =>
        model.summarize(source.data.text, { idempotencyKey: key }), {
          reconcile: key => model.lookupResult(key),
        });
      const saved = await ctx.mutate(api.saveSummary, { doc, revision, text },
        { id: ctx.writeIdFor("save") });
      if (saved.state !== "sent") throw new GiveUp("the summary was not saved");
      return { saved: true };
    },
  },
});
```

Here `model` is the application's provider SDK. The generated action arguments,
return type and secret names come from Quarry. Runtime registration requires
exactly the declared action handlers, with flat qualified names such as
`"mail.send"`. A mismatched generated contract fails the invocation before its
handler runs. Optional `effects` retain `snapback4/worker`'s `EffectHandler`
signature; they must name declared effects.

Install `typescript` and `@types/node` in the application. `check` and `dev`
typecheck the conventional server entry and its imports without executing it;
UI files outside that graph are not checked. Handler checks remain strict even
with a permissive application tsconfig. Node 24 runs erasable TypeScript;
relative imports need their `.ts` extension. `dev` rechecks changed server
sources before adopting the schema and restarting the supervised child.
Successful adoption fences that child's service session before new work can
be claimed, including its already-waiting polls; stopping the process is not
the authorization boundary. Manually provisioned service seats are unaffected.

Both `dev` and `serve --worker <entry>` construct an explicit environment from
runtime variables and declared secrets, and redact their values in child
stdout/stderr, including across chunks. A missing secret refuses startup.
`deploy` does not yet package the server's TypeScript import graph: provision
that entry and its dependencies explicitly for `serve --worker`. This is not
a bundled-release or publication claim.

`server()` returns a `Worker` with `done` and `principal()`. It reads
`SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN`; `ServerOptions` can supply explicit
`url`, `token`, `env`, `fetch` and `signal` for a host or test.

`ctx.query` and `ctx.mutate` use the claim's delegated session. They return the
ordinary `Read` and `Write` states, including capped/denied reads, pending
writes and `replayed: true` receipts without historical results. Each call is
its own transaction. Return protected content by managed row id when later
reads should obey current rules.

`ctx.principal` is the invocation's principal. `ctx.invocation` exposes `id`,
`attempt`, an absolute epoch-millisecond `deadline` or `null`, `cancelled`,
and an `AbortSignal`. Cancellation, deadline, lost authority and handler
completion abort that signal and close database access. Cancellation is
cooperative: pass the signal to provider SDKs that accept one. Status polling
runs only while the handler runs; the core remains authoritative on each
request.

Cancel an action with `POST /actions/<id>/cancel` under its originating
principal's standing authority. Cancellation never rolls back committed
writes or provider effects. A `pending` write stays uncertain after cancellation;
reconcile it with the same write id instead of treating it as a failed write.

`ctx.secrets` is a frozen own-property map containing only the action's
declared names. Missing or empty values fail with `E_SECRET_MISSING` before
the handler. Worker error callbacks and failure records redact the runtime's
declared secret values. This runs trusted application TypeScript in Node;
the context does not sandbox access to the process or network.

`ctx.writeIdFor(label)` derives a 128-bit Crockford ID from the invocation id
and label. It is independent of time and attempt. Labels are 1–128 printable
ASCII characters. Reuse a label only for the same mutation and arguments;
the core refuses conflicting intent.

`ctx.step(name, input, fn, { reconcile? })` durably begins a named external
step before calling `fn(key)`. Inputs and outcomes must be plain JSON, at
most 1 MiB: undefined values, non-finite numbers, cycles, sparse arrays,
accessors, class instances and coercing `toJSON` objects are refused.
Names have the same 1–128 printable-ASCII bound as write labels. Equal inputs
join one in-flight call; changed input for an existing name refuses. A
completed step returns its recorded outcome on subsequent attempts.

An unfinished step is uncertain. A later attempt calls `reconcile(key)`
using the same provider key, or parks if no reconciliation was supplied.
Reconciliation must look up or safely deduplicate the provider request.
Throw `ParkStep` from `snapback4/server` when its outcome cannot be established;
`GiveUp` during reconciliation also parks. A transient reconciliation error
can retry. The runtime never automatically repeats the original provider
callback for an uncertain step. A lost begin or completion acknowledgement
is also uncertain, and begin is never retried inside the same claim.

Action results are validated as JSON before settlement; the core validates
the declared shape and bounds. Invalid results fail terminally because
external effects may already have happened. `runWorker` remains available
for existing hand-written workers.

Work ids and step outcomes are retained for the lifetime of the store; there
is no automatic retention expiry or id reuse. `why <id>` prints step state,
input/outcome digests and the provider key, not values unless `--values` is set.
Parked work is not retried automatically; this increment has no operator
resume command. Reconcile externally before deliberately issuing new intent.

Effects retain their legacy handler signature and at-least-once semantics,
not the action context or `ctx.step`. Their declared retry/deadline/cancellation
policy is frozen at emission. Current `runWorker` requests fenced effect
claims; hand-written wire workers must request `fenced: true` and return the
`leaseToken` as `x-snapback-effect-lease`. Legacy unfenced claims remain
compatible and do not gain the same-worker successor fence. Only a service
may call `POST /effects/<id>/cancel`; cancellation cannot stop provider I/O
already in flight.
