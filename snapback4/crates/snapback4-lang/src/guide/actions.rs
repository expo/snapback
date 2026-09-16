pub const CARD: &str = r##"# Actions: declared results and typed server handlers

```quarry
action invite(email: text <=200) returns { invitation: id, providerId: text <=100 ? } secrets [MAIL_API_KEY] retry 3 backoff 2s deadline 1h cancellation allow
action refreshModel(periodStart: time, periodEnd: time) returns {} <- viewer = 'service:ranker'
action paused() <- deny
schedule refreshHourly every 1h as service:ranker: refreshModel
```

No Quarry body: the application's TypeScript server handler performs the action.
Arguments are typed like a mutation's. `returns { field: type, ... }` declares
an object of bounded scalar or list fields; table references are IDs, never
rows. Optional result fields become required nullable fields in generated
types; settlement fills omitted optional fields with null. `returns {}`
requires an empty object. Omitting `returns` preserves an `unknown` result.
Query cursors cannot be results. A result failing validation fails terminally,
because external work may already have happened. Return protected content by
managed row ID so current read rules govern it.

`check` and `dev` generate both the client's `Action<A, R>` in `api.ts` and
the handler's `Actions` signatures in `server.ts`, under `snapback/generated/`.
Handlers use flat qualified keys (`"mail.invite"` for an action in `mail.q`);
every declared action needs a handler. An optional `<-` rule uses `allow`, `deny` or
comparisons of `viewer` with principal literals (`and`, `or`, `not`);
it cannot read tables or arguments. Actions always run on the server and
never predict. `client.act(api.invite, { email })` returns `Act`:
`done` with `id` and `result`, `failed` with `id` and `why`, or `pending`
with `id`. A refusal before admission is `{ denied, id }` (`E_OFFLINE`
when offline).

```ts
// snapback/server.ts; mail is the application's provider adapter.
import { server } from "./generated/server";
export default server({ actions: {
  async invite({ email }, ctx) {
    const sent = await ctx.step("invite", { email }, key =>
      mail.invite(email, { apiKey: ctx.secrets.MAIL_API_KEY, idempotencyKey: key }));
    return { invitation: sent.id, providerId: sent.providerId ?? null };
  },
  async refreshModel({ periodStart, periodEnd }, ctx) { return {}; },
  async paused() { return {}; },
} });
```

`ctx.query` and `ctx.mutate` run under the invocation's authority and return
the ordinary `Read` and `Write` states; no transaction spans two calls.
`ctx.principal`, `ctx.invocation` (id, attempt, deadline and cancellation),
`ctx.secrets`, `ctx.step` and `ctx.writeIdFor(label)` describe that invocation.
`ctx.writeIdFor` derives a stable mutation ID for one label. `ctx.step`
persists an external step's result and reuses it on a rerun; changing the input
for the same name refuses. Send the step's stable key to the provider, and
reconcile an uncertain provider outcome through that key. There is no `ctx.sql`.

`secrets [ENV_NAME, ...]` exposes only the declared names on `ctx.secrets`.
Use uppercase environment names; runtime names (`SNAPBACK_*`, `SNAPBACK4_*`,
`NODE_*`, `LD_*`, `DYLD_*`, `LC_*`, `PATH`, `HOME` and environment controls)
are reserved. Duplicates refuse. Each clause appears at most once, before `<-`.
`retry N` counts total attempts including the first (1–100, default 8).
`backoff` starts at 1s–5m (default 2s), doubles per attempt up to 5m.
`deadline` is 1s–30d from admission (default none); durations are positive
whole numbers with `s`, `m`, `h` or `d`. `cancellation allow|deny` defaults to
allow; cancellation is cooperative for work already in flight. An effect
declaration accepts the same secrets and policy clauses (guide effects).

A scheduled action requires `as service:<seat>` before the schedule's colon.
The only supplied arguments are `periodStart: time` and `periodEnd: time`,
when declared. A job keeps its system authority and cannot use `as`.
The optional `at HH:MM` comes before `as`; the shortest period remains 1m.

Legacy `runWorker` action handlers receive `(args, meta)` instead of this
generated context. The following session and wire contracts still apply.
`meta.session` is for the REQUEST's principal, so reads and writes obey
the viewer's rules. It cannot refresh or use worker/auth-minting routes.
It expires with the lease (60 seconds by default) and is revoked on
settlement. Set `actionSessions: { invite: 120 }` and `lease: 120` for a
longer handler (maximum 900 seconds; the shorter duration wins, also capped
by the admitting family's live session expiry).
Development clock advances extend held action leases and their viewer
sessions by the advanced duration, capped by the admitting family's expiry;
ordinary sessions keep their expiry.
`meta.id` is the legacy invocation idempotency key. Delivery is at
least once: thrown errors follow the declared retry policy; `GiveUp` fails
immediately. An expired lease follows the same attempt and deadline bounds.
Only the handler names supplied to `runWorker` are claimed.

Admission records the session's family, principal generation and expiry.
Refresh keeps the family; a fresh sign-in starts another. Before a claim,
revoking that session, logout-all, principal revocation or expiry fails the
request terminally with `E_ACTION_AUTHORITY`: "the authority that admitted
this action was revoked or has expired". No delegated session is minted.
Service-session admissions have the same binding. Development personas and
legacy requests without a recorded binding retain their existing behavior.

`POST /a/<name> { id, args }` under a live viewer session records the
request durably, once per id, then waits up to 25 seconds. A settled reply
is `{ state: "done", id, result }` or `{ state: "failed", id, why }`.
Otherwise HTTP 202 carries `{ state: "pending", id, why }`, with retryable
`E_ACTION_PENDING`. Repeat with the SAME id to collect the outcome
(`replayed: true`); `client.act(op, args, { id: previous.id })` does this.
An id binds the operation and canonical JSON of raw wire arguments before
validation fills optional nulls (object keys are sorted). Changed arguments or another action refuse `E_ID_REUSED`;
use the original arguments or mint a new id. Another principal gets
`E_ACTION_UNKNOWN`. Mutation ids likewise bind the sent operation name and
canonical raw wire arguments; legacy mutation receipts without a binding replay.
Collecting a result also requires the original family to remain live and
its principal generation unchanged; otherwise `E_ACTION_UNKNOWN` returns
without the result, even after a fresh sign-in by the same principal.
Return protected content by managed row id so current read rules govern it.
`{ waitSeconds: 0 }` (`?wait=0` on the wire) only admits or collects;
the default is 25. A transport loss after submission also returns pending:
the server may already have accepted it. The SDK never queues an action.

Workers send a service bearer token to `POST /actions/claim { action?,
limit?, lease?, wait?, session? }`; durations are seconds. It long-polls
and returns `{ requests: [{ id, action, args, principal, session, attempt,
at }] }`. Settle via `POST /actions/<id>/done { result }` or
`/failed { error, retry }`, with the service bearer and the claim's
`session.token` in `x-snapback-action-lease`. That header fences an old
attempt even when its successor uses the same service token. Stale claims
get `E_ACTION_LEASE`; user tokens get HTTP 401 `E_AUTH`. Results are JSON
bounded by the unchanged 1 MiB output ceiling, and declared result fields are
validated using the same scalar rules as arguments.

`snapback4 dev` starts `snapback/server.ts` (or `.mts` or `.mjs`), falling back
to `snapback/worker.ts` (or `.mts` or `.mjs`), with Node 24, `SNAPBACK_URL`
and `SNAPBACK_SERVICE_TOKEN` for `service:worker`.
`dev --worker` is refused; use one of those conventional paths.
It restarts a crashed worker with backoff and stops it on dev exit.
The child environment is constructed explicitly, with runtime variables and
the declared secrets; a missing secret refuses startup with E_SECRET_MISSING.

`snapback4 serve <release-dir> --worker <path>` supervises that Node 24 entry
with the same restart backoff and shutdown. Its environment contains only
`PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TZ`, `NODE_OPTIONS`, the supplied
`SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN`, and declared secrets. The path may
name the application's `server.ts`; deployment does not automatically package
its TypeScript import graph. The service:worker token is minted
for each child and never printed by serve. Each child session lasts at most
one day; the supervisor replaces the child within that window. Clean exits
revoke its family. Startup revokes the previous supervised child's family,
even after SIGKILL, without revoking manually issued service seats. The path is resolved from the
command's working directory; the child runs in the active release directory.
`doctor [--release dir]` reports worker starts, restarts and crashes and counts
queued/running/done/failed requests. `why <id> [--release dir]` describes an
action, mutation or effect, including bindings, attempts, settlement and
payload sizes/digests; `--values` also prints stored arguments and results.
Mutation arguments and results are not recorded; their binding keeps only
the operation name, argument digest and admission time beside the receipt."##;
