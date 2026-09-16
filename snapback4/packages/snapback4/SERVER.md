# TypeScript server handlers

## Declaring actions

```quarry
action invite(email: text <=200) returns { invitation: id } secrets [MAIL_API_KEY]
action refreshModel() <- viewer = 'service:ranker'
```

An action has typed arguments and no Quarry body: the application's
TypeScript handler performs it and returns a declared object. `<- allow` is
the default (any signed-in principal); `deny` pauses it, and a rule over
`viewer` can admit a named service. It cannot read tables or arguments.
`check` generates `Action<A, R>` and `snapback/generated/server.ts` handler
signatures; omitting `returns` preserves `unknown`. Invalid results fail
terminally. See the context below and `guide actions` for
durable steps, secrets, retry/deadline/cancellation policies and service schedules.

Admission binds the session family and principal generation. Refresh preserves
the family; revocation, logout-all or expiry before claim records terminal
`E_ACTION_AUTHORITY` and mints no session. Service callers follow the same rule.
The lease is capped by the family's live expiry. Collecting a result requires
that original authority to stand, or returns `E_ACTION_UNKNOWN` without it.
A fresh sign-in does not restore authority for old requests. An action id binds
its operation and canonical raw wire arguments before validation; changed input refuses
`E_ID_REUSED`. Mutation ids bind the sent operation and canonical raw wire
arguments too. Identical retries replay; legacy unbound records keep their
prior behavior. Object key order does not matter.

`serve <release-dir> --worker <path>` supervises Node 24 with restart backoff
and shutdown. The worker receives only `PATH`, `HOME`, `TMPDIR`, `LANG`,
`LC_ALL`, `TZ`, `NODE_OPTIONS`, `SNAPBACK_URL`, declared secrets and a fresh,
unprinted `SNAPBACK_SERVICE_TOKEN` for `service:worker`; `dev` constructs the
same explicit environment. `doctor --release <dir>` reports worker counts;
`why <id> [--release dir]` reports work and step metadata and payload
sizes/digests, with actual payloads only under `--values`.
Mutation arguments and results are not recorded. Supervised child sessions
last at most one day; the host replaces the child within that window and
revokes the previous child's family at startup, including after SIGKILL.
`dev` prefers `snapback/server.ts`, `.mts` or `.mjs`, then legacy `worker.*`;
`dev --worker` is refused. `serve --worker` needs an explicitly deployed entry.

## Handler context

`check` and `dev` generate `snapback/generated/server.ts` from declared
actions and routes. Import its `server` function in the application's server entry:

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
An unsuccessful status poll fails closed and permits a later attempt; if a
provider step was already begun, that attempt still requires reconciliation
or parks. A network interruption does not prove the provider did nothing.

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
external effects may already have happened. An image/video result must name
a recorded asset of the declared kind and byte bound; any supplied metadata
must equal its recorded facts, without extra fields. Validation does not add
metadata to the result or grant permission to read its bytes.
`runWorker` remains available for existing hand-written workers.
Even an action without a `returns` declaration must return plain JSON from
the generated handler: use explicit `null` for no value. Its TypeScript result
is `unknown`, so an implicit `undefined` can typecheck but fails at runtime.
Legacy `runWorker` retains its historical undefined-to-null normalization.

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

## Routes and webhooks

```quarry
route reportDownload: post "/report-download" wait 5s
route billingHook: post "/hooks/provider-billing" as service:billing secrets [BILLING_KEY] retry 8 backoff 2s wait 5s
```

The generated `Routes` map requires every declared handler, with the same flat
qualified names as actions. A route and action may share a name. Routes never
appear in the client API or public action registry. Empty action/route maps may
be omitted; a supplied empty map accepts no undeclared handler.

```ts
import { server } from "./generated/server.ts";
import { api } from "./generated/api.ts";
import { GiveUp, Retry } from "snapback4/worker";

export default server({ routes: {
  async reportDownload(req, ctx) {
    // Runs under the caller's live session and ordinary read rules.
    return new Response(await reports.export(await req.rawBody(), ctx));
  },
  billingHook: {
    async verify(req, { secrets, signal }) {
      return billing.verify(await req.rawBody(), req.headers,
        secrets.BILLING_KEY, { signal });
    },
    async handle(req, ctx) {
      const event = billing.decode(await req.rawBody());
      const saved = await ctx.mutate(api.applyBillingEvent, event,
        { id: ctx.writeIdFor("apply") });
      if (saved.state === "pending") throw new Retry("the write is uncertain");
      if (saved.state !== "sent") throw new GiveUp("the event was refused");
      return new Response(null, { status: 204 });
    },
  },
} });
```

Here `billing` and `reports` are application adapters, not built-in services.
The application mutation deduplicates provider event IDs and checks revisions
to handle out-of-order deliveries. Body deduplication does not order distinct
events. Use `ctx.step` for external side effects, including reconciliation after
an uncertain outcome; no database transaction spans the handler.

A default route requires a live bearer session. Only an explicit
`as service:<seat>` route uses a provider verifier. Its `verify` callback has
declared secrets and an abort signal, **no delegated database context**. Return
exactly `true` or `false`; false answers 403 (`E_ROUTE_VERIFY`) with no durable
admission. An exception, missing verifier or unavailable core answers 503.
Verify exact raw bytes before parsing. Each call to `rawBody()` returns a fresh
copy, and every delivery verifies anew, including retries of completed work.

After verification the core durably admits one private action under the
declared service seat, before `handle` runs. Retries with identical body bytes
join that invocation despite fresh signature headers. Session-route IDs are
also scoped to the principal and originating session family. Revocation or
changed declarations cannot rebind old work to fresh authority. The handler
does not treat changed headers alone as new intent. Include an explicit nonce
or revision in the body when requesting a new operation (for example a new
report export); repeat the same bytes when retrying. Route IDs and responses
have the work-record lifetime, not an automatic deduplication expiry. The handler
receives the first verified envelope with Authorization, Proxy-Authorization,
Cookie and x-snapback-persona removed; other headers and body bytes are stored
as work payloads. Only the body, not header spelling, is byte-exact.

The request waits up to declared `wait` (default 5s, maximum 25s), including
verification. A settled response is returned; otherwise 503 (`E_ROUTE_PENDING`)
asks for the same-body retry. A 503 alone does not prove admission. Disconnects
and worker crashes do not undo admitted work. Plain `GiveUp` records a redacted
application refusal and acknowledges it with bare 204; `ParkStep` and typed
runtime errors are not acknowledgements. Exceptions and explicit 5xx handler
responses follow the retry policy, never a cached successful 5xx completion.

This increment supports static POST paths only, without query strings,
captures, GET routes or streaming forwarding. Request/response bodies are at
most 64 KiB, headers 64 fields/16 KiB. A `Response` is fully buffered, with a
10s bound (or earlier invocation cancellation), before settlement. Invalid or
oversized responses fail terminally with `E_ROUTE_RESULT`, because effects may
already have occurred. `Set-Cookie` fields stay separate; transport framing
headers cannot be supplied. HTTP 204, 205 and 304 must have empty bodies.

`dev` still binds loopback by default. Explicit
`dev --bind 0.0.0.0 --i-understand-cleartext` permits provider ingress through a
trusted TLS proxy. Only an exact declared POST path bypasses the development
loopback gate. Development binding accepts only loopback or wildcard IPs
(`0.0.0.0`/`::`), preserving a loopback path for the supervised worker.
Personas, seed, schema, queries, worker doors, unknown paths,
query variants and mismatched methods remain gated. Route waits have 16 slots
separate from 4 verification polls, 4 generated-registry polls, 32 legacy
worker/long-poll slots and 32 short requests. Generated handlers share one
action poll loop, grouping names by session lifetime and rotating through
chunks of at most 128; verification uses its own rotating loop. Multiple
chunks use at most 1s waits, so idle handlers cannot monopolize claim capacity.
Legacy `runWorker` keeps its per-name polling unless `actionRegistry: true`.
Unverified
tickets are ephemeral, bounded and fenced: a verifier/core crash before
admission yields a retry, not an unauthorized durable invocation.
