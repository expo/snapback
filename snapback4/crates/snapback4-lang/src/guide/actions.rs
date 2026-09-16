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
every declared action needs a handler. If no actions are declared, omit the
`actions` registry; declared HTTP routes use a separate `routes` registry
(guide routes). An optional `<-` rule uses `allow`, `deny` or
comparisons of `viewer` with principal literals (`and`, `or`, `not`);
it cannot read tables or arguments. Actions always run on the server and
never predict. `client.act(api.invite, { email })` returns `Act`:
`done` with `id` and `result`, `failed` with `id` and `why`, or `pending`
with `id`. A refusal before admission is `{ denied, id }` (`E_OFFLINE`
when offline).

```ts
// snapback/server.ts; mail is the application's provider adapter.
import { server } from "./generated/server.ts";
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
`backoff` starts at 1s–5m (default 2s for actions, 4s for effects), doubles per attempt up to 5m.
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
the operation name, argument digest and admission time beside the receipt.
Install TypeScript and @types/node in the app: `check` and `dev` check the
server entry's import graph strictly without running it. Node 24 requires
extensions on relative TypeScript imports. Work and step records have no
automatic retention expiry; their ids are never silently reusable. Parked
work needs operator reconciliation; there is no resume command in this slice.

## Action results and lifecycle refusals

E_ACTION_RESULT means the handler returned a value outside its declared
result type or output bound. For `returns { invitation: id }`, returning
`{ invitation: 42 }` is a mistake: return the provider's string ID instead.
Return a small JSON object matching every declared field. This invocation
fails terminally because external work may have happened; inspect its steps
with `snapback4 why <id>` before creating another invitation.

E_ACTION_GENERATION means the queued declaration changed or the worker's
manifest differs from the admitted contract. For example, changing an
invitation's result fields while its old handler still runs cannot upgrade
that invocation. Run `snapback4 check`, restart the matching handler, and
inspect the parked work's steps before issuing replacement intent. A new
handler does not rewrite the old invocation's contract.

E_ACTION_DEADLINE means the invocation reached its admitted deadline and
cannot run again. For example, an invitation declared `deadline 1m` cannot
be collected as new work after a long provider outage. Inspect its recorded
steps and the provider's outcome before starting another invocation. If the
workflow needs longer, declare a suitable deadline for future admissions;
changing it does not extend work already admitted.

E_ACTION_ATTEMPTS means every admitted attempt was used, including the
first. For example, `retry 1` permits one attempt, not one retry after it;
a lost lease can consume that attempt. Inspect the steps and provider key
with `snapback4 why <id>`, repair the failure, and reconcile any external
work before submitting new intent. Change the declaration's retry policy
only for future work whose provider can safely deduplicate it.

E_ACTION_FAILED means the handler gave up or finished its last permitted
attempt with an error; `why.message` carries the recorded reason. For
example, repeatedly submitting an invalid recipient will not repair a mail
provider's refusal. Correct the recipient or handler, inspect any steps
already performed, then submit a new invocation for the corrected intent.
Collecting the failed ID returns its recorded outcome, not another attempt.

E_ACTION_CANCELLATION means the admitted operation forbids cancellation.
For example, cancelling work declared `cancellation deny` is refused even
while queued. Inspect it with `snapback4 why <id>` and let that invocation
settle; if future work should be cancellable, declare `cancellation allow`
before admitting it. Editing the policy does not change an existing record.

E_ACTION_CANCELLED means this invocation has been cancelled and cannot
continue. For example, retrying a cancelled invitation with its old ID
does not send it anew. Inspect its external steps before deciding whether
to create new intent with a new ID. Cancellation is cooperative for an
in-flight handler and does not retract mail already sent by a provider.

E_ACTION_CLOSED means code tried to use the invocation context after its
handler finished. For example, starting `ctx.step(...)` without awaiting
it and then returning lets work escape the handler's lifetime. Write
`const sent = await ctx.step(...)` and return only after that work completes;
await every `ctx.query` and `ctx.mutate` that the handler needs too. Do not
save `ctx` for a later timer or another invocation.

## External step refusals

E_STEP_INPUT means the step name or JSON input is invalid, too large, or
changed for a name already used in this invocation. For example, calling
`ctx.step('mail', { email: 'alice@example.com' }, send)` and later reusing
`'mail'` with Bob's address changes the step's intent. Keep the original
input for a retry; use a distinct stable name for a distinct step. Names
use 1–128 printable ASCII characters; pass bounded JSON, not undefined,
functions or cyclic objects.

E_STEP_BUSY means this attempt has already begun the named external step.
For example, posting two raw `/begin` requests for `'mail'` must not send two
messages. Use `ctx.step('mail', input, send)` and await its promise; the
SDK joins concurrent calls with the same name and input in one attempt.
On a later claim, reconcile uncertain work through its stable provider key
instead of bypassing the existing step record.

E_STEP_UNKNOWN means settlement or parking named a step that was never
begun in this invocation. For example, posting `/steps/mail/done` directly
cannot create a step record. Use `await ctx.step('mail', input, send)`;
it begins the step, passes its stable key to the callback, and records the
returned JSON outcome. Keep settlement under the same invocation and name.

E_STEP_RESULT means the external step returned invalid or oversized JSON,
or settlement conflicts with its recorded outcome. For example, returning
an entire provider response containing methods is a mistake: return a small
object such as `{ providerId: sent.id }`. Keep repeat settlements identical.
External work may already have succeeded, so reconcile with the provider's
stable key before replacement; this refusal does not authorize an automatic
repeat of the external request.

E_STEP_PARKED means an external outcome is uncertain and the invocation
needs reconciliation. For example, the provider may have sent mail before
the worker lost its reply. Supply a `reconcile` callback to `ctx.step` that
looks up the same provider key on recovery, or throw `ParkStep` when the
outcome cannot be established. Inspect already parked work and its provider
record before replacing it; there is no resume command for parked work in
this slice. A fresh ID alone cannot make repeating that side effect safe.

## Server setup refusals

E_SERVER_CONFIG means the runtime lacks its URL or service token, or has an
invalid status interval. For example, launching the server entry directly
without `SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN` cannot connect it to a
backend. Put the entry at `snapback/server.ts` and start `snapback4 dev`,
which supplies both. A separately supervised entry must receive valid URL
and token options or environment variables and a positive `statusIntervalMs`.

E_SERVER_HANDLERS means the registry does not match the declared operations.
For example, `mail.q` declaring `invite` needs the own handler key
`'mail.invite'`, not `'invite'`. Run `snapback4 check` to regenerate
`server.ts`, then provide exactly one handler for each action and route.
Session routes take a function; service routes take `{ verify, handle }`.
Remove extra keys and inherited handlers; optional effect handlers must
name declared effects, and an empty registry may be omitted.

E_SERVER_TOOLCHAIN means `check` cannot find the app's local TypeScript
compiler. For example, a new app with a `snapback/server.ts` entry but no
TypeScript dependency cannot check that entry. Install `typescript` and
`@types/node` as development dependencies in the application, then rerun
`snapback4 check`. A globally installed compiler alone is insufficient;
`check` does not download a compiler while checking the app.

E_SERVER_TYPECHECK means the server entry or an imported module fails
TypeScript checking. For example, an action declared `returns { count: int }`
cannot have a handler returning `{ count: 'one' }`; return `{ count: 1 }`.
Follow the compiler's file and line through the import graph, use the
regenerated handler types, and rerun `snapback4 check`. Node 24 relative
TypeScript imports need their `.ts` or `.mts` extensions.

E_WRITE_LABEL means `ctx.writeIdFor(label)` received an invalid label.
For example, `ctx.writeIdFor('')` cannot name a write; use a stable printable
label such as `ctx.writeIdFor('save-invitation')`. Labels are 1–128 ASCII
characters without controls. Reuse that label for retries of the same
mutation within this invocation, and use another stable label for a
different mutation; do not put a timestamp or random value in the label.
"##;
