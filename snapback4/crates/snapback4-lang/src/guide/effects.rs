//! The effects card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Effects: the outside world, performed by a worker

Effects record work for a worker to perform outside the database, such as sending a notification.
The payload commits with the mutation or job that emits it.

```quarry
effect notify secrets [PUSH_API_KEY] retry 8 backoff 2s deadline 1d cancellation allow

table members:
  roomId: id
  principal: principal
  unique roomId, principal
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  insert <- exists members[.roomId, viewer]
  sync

table messages:
  roomId: id
  authorId: principal
  body: text <=4000
  at: time
  read <- exists members[.roomId, viewer]
  insert <- .authorId = viewer and exists members[.roomId, viewer]
  sync last 500 by .at

mutation send(roomId: id, body: text <=4000):
  require exists members[roomId, viewer] else NOT_MEMBER
  msg = insert messages { roomId, authorId: viewer, body, at: now }
  for m in members where .roomId = roomId by .principal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, roomId, preview: slice(body, 0, 80) }
  return { id: msg.id }
```

## Start here: declared workers and delivery deduplication

Put each worker at `snapback/workers/<service>.mjs` (also `.mts` or `.ts`).
For example, `snapback/workers/push.mjs` declares the `service:push` worker.
`snapback4 dev` and `snapback4 serve` start it, inject its token,
prefix logs with `[worker:push]`, restart crashes with 250 ms–5 s backoff, and
stop its group on server exit, including abrupt death. Host restart waits for
group cleanup (five seconds, then E_STORE_BUSY). Failed token retirement keeps
the worker stopped until retirement succeeds, even after declaration removal.
A failed deletion fences the old revision immediately on dev and serve; peers
renew under that revision. Ordinary queries refuse retired revisions during deletion. If a watchdog dies, the host
kills its worker group before replacement. Signals sent to a live watchdog
initiate its group cleanup. A new declaration that cannot start retries after
repair without requiring another source edit. Tokens are never printed.

E_WORKER_REFRESH means this token belongs to a supervised worker family.
The supervisor owns token rotation: `/auth/refresh` returns HTTP 403 with this
code for named and conventional workers. Keep using the injected token;
the refusal leaves it live. Manually minted service seats can still refresh.

`snapback4 doctor` shows
all workers and their last reported states, starts, restarts and crashes,
including `ledger-unavailable` while retrying a stopped child. Startup clears
prior reports when retiring the previous host's credentials.
`deploy` copies the workers source subtree; put helpers in subdirectories and
install package dependencies on the deployment host. Symlinks at any level and
non-regular source files are refused on every launch and restart, even after
a source change was rejected. Named workers execute private copies of validated
entry/helper bytes under private `.snapback4` directories; replacing original paths
cannot change an in-flight launch. Package manifests also refuse symlinks.
Package dependencies stay installed on the host, preserving schema-local
`snapback/node_modules` lookup before project-root packages. For numbered releases,
serve uses the nearest ancestor containing `snapback/node_modules`; install there.
This is ordinary Node 24.
Automatic dev `snapback/server.*` and `snapback/worker.*` entries also execute
validated private copies of the schema tree, including generated modules.
Server imports tracked by the TypeScript checker elsewhere inside the project
also use validated copies. Other relative helpers stay inside `snapback/`; source
symlinks are refused at startup and restart. The working directory remains the
original project. Use it or an explicit durable path for runtime files; module
URLs refer to the private source copy.

```js
// snapback/workers/push.mjs
// snapback4 secrets: PUSH_API_KEY
import { runWorker } from "snapback4/worker";
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
await runWorker({
  url: process.env.SNAPBACK_URL,
  token: process.env.SNAPBACK_SERVICE_TOKEN,
  ledger: true,
  signal: stop.signal,
  effects: { notify: async (payload, meta) => {
    const response = await fetch("https://push.example.com/send", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", "idempotency-key": meta.idempotencyKey },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`push provider: ${response.status}`);
    return { providerId: meta.idempotencyKey };
  } },
}).done;
```

`meta.idempotencyKey` equals the effect's `meta.id` and is **stable across
redelivery**, attempts and restarts. Pass it to providers accepting idempotency
keys. It identifies one admitted effect: use `emit ... once [...]` below to
prevent repeated admission of the same digest period.

`ledger: true` uses the supervisor's durable SQLite completion file beside the
opened backend store, namespaced by its identity. `dev --fresh` uses a private
temporary ledger; replacing the store cannot reuse old completions. Successful
JSON results commit before acknowledgement; redelivery
replays the result without repeating the handler. Keep the ledger with the store
across releases and backups. There is no automatic pruning. It serializes
opted-in handlers sharing that local file, including across processes; hosts
with separate disks do not share deduplication. Failures record no completion.
One hung provider call therefore stalls all handlers sharing that file; set a
provider timeout, as above. Keeping the lock prevents simultaneous duplicate
calls for one key. A busy commit retains its transaction and retries only the
commit, even if cancellation arrives after the handler succeeded. A blocked
reader can delay completion too. This is a shared-file serialization tradeoff.
Delivery remains **at least once**: a crash after the external call but before
the ledger write/commit, or an unrecoverable storage/result-encoding failure
in that interval, can repeat the action. Provider idempotency covers that
remaining window. Losing/deleting the ledger also loses its completions.
The worker validates ledger storage before claiming work. Initialization errors
stop polling without consuming attempts. A supervised child exits, reports
`ledger-unavailable` in doctor and retries with bounded backoff; repair storage
to resume. Standalone `done` resolves so its owner can repair and restart.
Later storage/commit failures close the ledger and stop polling without settling
claimed work as a handler failure; its ordinary lease can expire for redelivery.

Worker environments contain only runtime paths/locale, supervisor settings and
selected declared secrets; parent `NODE_OPTIONS` is not copied.
Named entries receive no declared secrets by default. List just the names the
entry needs with `// snapback4 secrets: PUSH_API_KEY, OTHER_KEY`; each must also
be declared by an effect, action or route. The conventional generated server
still receives its full registry's secrets. This narrows environment injection;
service seats remain trusted deployment credentials, not per-effect ACLs.

Standalone `runWorker` still accepts explicit `url` and `token` (mint with
`token --service push`). Use `ledger: "/durable/path/effects.sqlite"` there,
or omit it to retain the ordinary loop. The ledger applies to low-level effects;
generated `ctx.step` handlers keep their durable step/reconciliation contract.
Do not register an effect in multiple entries unless that is intentional.


Effects are global declarations shared by every file; jobs are module-qualified
operations. The worker dispatches by the declared effect name, while schedules
and `run` address an operation. If `digest.q` declares `effect notify` and
`job daily()`, write `emit notify { ... }`, register `effects: { notify: ... }`
in the worker, and schedule `digest.daily` (`schedule dailyDigest every 1d: digest.daily`).

`emit notify { … } once [recipient, periodEnd]` admits at most one effect
for that effect name and canonical Value array for the store's lifetime.
Both hosts charge each evaluated key; only the server claims it. A payload may use the same bounded server-only read slice as an ordinary emit.
Once-key dependencies stay in the prediction body; an online-only key source
makes that mutation server-only. Keys already claimed on the server can
make device admission conservative; a meter cut queues without predicted rows.
A repeated key skips the emit and continues the transaction. `once` deduplicates
emission, not completion: an iteration that emits nothing records no key. Keys survive
outbox settlement, retries, restarts and replacement runs. The key and emit
roll back together if the transaction fails. `--replay` also records the key:
repeating that period after replay cannot deliver the suppressed effect.
Device prediction discards emits and never claims keys. A key does not
promise exactly-once provider delivery; the worker still uses provider
idempotency for an ambiguous external outcome.

This send stays eligible to predict because presence decides only effects. A push guarded by absence is recorded durably at commit even when the recipient looks connected, deferred a few seconds, and cancelled by a new poll only if it arrives within its window. This guarantees durable admission; delivery keeps the effect's ordinary policy deadlines, worker failures, lease retries and `--replay` suppression.
Prediction also charges the safe untaken presence arms and discards their effects. Effect ids never consume `new` or an insert's ids.
For a successful effects-only mutation, connection state never changes its rows or result. It can change which effect arms run and therefore the mutation's charges, as live versus absent presence already could. The paved `if not exists connected[p]: emit …` form charges the same whether the recipient is held, graced or absent. Shared boolean payloads and separate positive-presence emits can cost more for held than graced recipients; a held recipient may get both a deferred absence effect and an immediate positive-presence effect.
Cancellation requires a proven necessary absence guard: `if not exists connected[p]`, its aliases, conjunctions of absence tests or nested absence guards. Several necessary absences wait for the latest deadline; a reconnect within any one principal's own window satisfies that guard. Payload-only reads (`emit audit { online: exists connected[p] }`), `not exists connected[p] or force`, and boolean forms without this proof remain immediate and are never cancelled by reconnect.
Potential dependency allocation, propagation and emission copies reserve the same heap allowance with or without grace for evaluated work; actual allocations stay metered. Infallible reads used only by an effect payload and their exclusive bindings are evaluated on the server, with their declared work reserved on both hosts (`guide prediction`).
For any other presence-dependent decision, emit unconditionally and have the worker call a service mutation that reads `connected`.

An effect accepts the same `secrets`, `retry`, `backoff`, `deadline` and `cancellation` clauses as an action (guide actions). A bare `effect notify` retains the defaults: eight total attempts, 4s initial backoff, no deadline, cancellation allowed. Generated `server({ actions, effects })` accepts optional `(payload, ctx)` handlers, with unknown payload and secrets typed to that effect's declared names. Low-level `runWorker` retains its `(payload, meta)` handler.

Effects use the shared external-step transition policy through their own
`_effect_steps` records and the provider-key domain
`snapback4:effect-step:v1`; action rows and keys are unchanged. A generated
handler receives frozen `ctx.effect` metadata (`id`, `idempotencyKey`, `effect`, `attempt`, `seq`,
`at`, `worker`), live `ctx.invocation` (`id`, `attempt`, `deadline`,
`cancelled`, `signal`), its declared `ctx.secrets`, and `ctx.step`. It receives no principal, query,
mutation, write-id, raw lease, service token or administrative surface.
When a claim reply has no richer principal, `ctx.effect.worker` can carry the
generic legacy label `service`; this is descriptive metadata, not authority.

The data plane never calls out. `emit name { payload }` in a mutation or
a job writes the payload durably in the same commit as the rows (a
refused mutation emits nothing), and a worker with a service token
(`snapback4 token --service pusher`; guide services) performs it:

```ts
import { runWorker } from "snapback4/worker";
runWorker({ url, token, effects: { notify: async (payload, meta) => { await push(payload); return { providerId: meta.id }; } } });
```

## A conversation notification

```quarry
effect notify

table memberships:
  conversationId: id
  principal: principal
  unique conversationId, principal
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]
  sync

table messages:
  conversationId: id
  authorId: principal
  body: text <=4000
  at: time
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  sync last 500 by .at

mutation send(conversationId: id, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  msg = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships where .conversationId = conversationId by .principal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, chatId: conversationId, preview: slice(body, 0, 80) }
  return { id: msg.id }
```

For a digest, **seek the period, filter the ordinal**. The complete recipe on `guide jobs` shares `unreadIn` with the viewer's inbox for the same period and walks
each recipient's own memberships; the job may read expiring messages directly.
`snapback4 guide jobs` shows a streaming total inside an automatic recipient
sweep. Each recipient must still fit one transaction's meters. Emit with
`once [targetUserId, periodEnd]` to deduplicate admission across reruns, and
use the same business key for provider retries. A zero-unread recipient emits
nothing and records no key.

## Emit once

```quarry
effect onceNotify
mutation remind(recipient: principal, periodEnd: time):
  emit onceNotify { recipient, periodEnd } once [recipient, periodEnd]
  return true
```

## Operations

A held poll is unconfirmed: its push waits five seconds from the commit for a new poll to arrive. With no live poll but an unexpired presence grace, an absence-conditioned push is queued for the grace deadline: up to 35 seconds. `doctor` shows the deferred count and next deadline; `GET /effects` exposes each deadline as `nextAt`. In tests expire the held-poll deadline with `snapback4 clock advance 6s`; close the grace window with `snapback4 clock advance 36s` or `POST /dev/clock/advance` with `{ "duration": "36s" }`; a real-time poll budget must exceed 35 seconds. Only a poll arriving after the commit within its window cancels it, even if that poll ends before claim or the server restarts. The effect is recorded as `satisfied` with `result: { outcome: 'presence_reconnected' }` and zero attempts; it is never handed to a worker. Without a reconnect it becomes claimable once, using the existing lease protocol. No live poll and no grace means immediate admission. A poll already open at claim does not satisfy the effect.

In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

```sh
snapback4 clock advance 36s
curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
```

`clock advance` extends held effect leases by the advanced duration, preserving their remaining real-time lifetime; retry `nextAt` still follows the dev clock.
It completes maintenance and jobs synchronously before replying, at the request's
user-initiated QoS on macOS: this is work the developer is waiting for.
Ordinary effect leases are fixed at claim; there is no lease heartbeat.

The loop is `POST /effects/claim { effect?, limit?, lease?, wait?, fenced?,
declarationContract? }` (a lease in seconds; `wait` long-polls until something
is due), then `POST
/effects/<id>/done { result? }` or `POST /effects/<id>/failed { error,
retry }`; `GET /effects?state=` lists them (queued, running, sent,
satisfied, parked, failed) and `doctor` counts them, including pending grace deferrals. A thrown handler retries with backoff
(by default 4 s, 8 s, ... up to 5 min) until the declared final attempt, then rests as
`failed`; throw `GiveUp` to fail at once. A worker that dies loses its
lease and the effect is claimed again (E_EFFECT_LEASE for the one that
settles late). `runWorker` reports the server's exact opaque refusal code and
message as lost authority without inferring the row's state or claiming that
settlement requeued it. Operators inspect effects separately. A handler error
whose settlement cannot be recorded is reported separately with its original stack.
Current `runWorker` sets `fenced: true` and returns each claim's `leaseToken`
in `x-snapback-effect-lease`; old same-service attempts cannot settle successors.
Legacy unfenced claims retain their compatibility protocol. A service can
`POST /effects/<id>/cancel` when the declaration permits it; this cannot
undo provider I/O already in flight. Work ids have no automatic expiry or reuse.
Two workers never hold one effect. Legacy handlers without steps use `meta.id`
as the provider idempotency key; generated `ctx.step` handlers use the key
passed to each step callback. A scheduled job that `emit`s once
per period is the digest recipe.

The optional `declarationContract` is only legal with one nonempty `effect`
and `fenced: true`. It identifies that current named declaration without a
payload or release. The server authenticates and compares it before queue
expiry, selection or claim mutation; a missing current declaration or mismatch
returns E_EFFECT_GENERATION without changing rows, attempts or steps. Successful
claim JSON carries the server-derived `declarationContract`. Omitting the field
retains low-level `runWorker` behavior. Generated output embeds the Rust-computed
contract per exact effect name and full work declaration; TypeScript never
recomputes it. E_EFFECT_GENERATION or a successful claim with a missing or
mismatched contract stops that generated worker before handler or settlement.
Run `snapback4 check` and restart the worker built for the current declaration;
inspect durable steps and provider outcomes before creating replacement intent.

A fenced claim may call `POST /effects/<id>/steps/<name>/begin` with
`{ input, reconcile? }`, `/done` with `{ result }`, or `/park` with
`{ error? }`. Every step request requires exactly one nonempty
`x-snapback-effect-lease`. Completed steps replay their result; changed input
refuses; uncertain work reconciles under its existing provider key or parks
the parent effect. Oversized results park it with E_STEP_RESULT, while unknown
provider outcome parks it with E_STEP_PARKED. Parked effects are not reclaimed
or expired. Explicit policy-allowed cancellation may move one to failed with
E_EFFECT_CANCELLED; it never resumes the effect. Cancellation cannot undo a
provider call already in flight. Inspect the recorded steps and reconcile each
with its stored provider key before creating replacement intent. Each key belongs to that effect and step
name; it is not `meta.id`. Use `meta.id` only for legacy handlers without steps
that used it as their provider key.

`POST /effects/<percent-encoded-id>/status` requires exactly one nonempty
`x-snapback-effect-lease` and a current deployment-trusted service. A running
row additionally requires that service and exact current lease; an expired or
lost lease returns E_EFFECT_LEASE without requeueing or reclaiming anything.
Terminal safe metadata is readable by any current service. Status enforces the
admitted row contract, preserves terminal drift evidence, and may finalize only
the named row's deadline or recorded cancellation. It returns exactly `id`,
`attempt`, `state`, `deadline`, `cancelled` and `errorCode`.

While a generated handler runs, its context polls that exact status route under
the service bearer and private effect lease. Cancellation, deadline, terminal
state, lease/generation/auth loss or inability to confirm status aborts the
context and prevents top-level settlement. `ctx.step` uses the same private
lease at `/effects/<id>/steps/<name>/{begin,done,park}`. Tokens and declared
secrets are redacted from failures. Abort is cooperative and does not retract a
provider request that already committed; uncertain work must reconcile or park.

New emits retain the current release as admission provenance and bind the exact
generic `Value` payload and full admitted work policy to the effect name. Release
is excluded from declaration and row-compatibility digests: changing only the
current release does not park older work. There is no typed effect-payload
declaration today and no same-name typed-change safety claim. If that surface
becomes typed, the type's schema identity must replace the generic validator
tag. Pre-contract rows with a NULL contract explicitly retain legacy comparison
behavior. A legacy effect present only in `schema.effects` compares with the
same implicit default work policy used when it was admitted, including the 4s
initial backoff. Strict HTTP claim, step and settlement authenticate the current
service and supervisor revision inside their writer transaction, then compare
the current declaration. A mismatch returns E_EFFECT_GENERATION; queued or
running work is parked before a stale lease can mask the drift, while sent,
satisfied, failed, cancelled and already parked evidence is not rewritten.
Direct core claim/settle methods remain compatibility APIs without this strict
HTTP authority and generation boundary.

This is the generated server effect-context slice over the existing SQLite
claim/status/step substrate. It is not typed effect-payload, query/mutate/data/
admin authority, a PostgreSQL adapter, provider qualification, process-crash
proof, or a completed B milestone.

For a replay mode that must not emit notifications, run `snapback4 dev --replay`.
New emits are counted as `suppressed` by `doctor`, with no queued payload:
they are never delivered, including after restarting with or without `--replay`.
Mutations and explicitly run jobs keep their writes, results and meters.
Replay holds schedule admission; restart without it resumes at the next
boundary, skipping held periods. Already queued jobs still run, with their
new emits suppressed. Effects queued before replay keep their ordinary lifecycle.

`--hold-effects` only pauses worker claims: effects stay durable and become
claimable after restarting without the flag. `--hold-schedules` only holds
schedule admission, skipping held periods on restart. Use `--replay` when
new effects must never be delivered; use the effect hold to keep them queued.
The suppression policy stays on the dev store for local `run` invocations
until the next host start; a restart without `--replay` restores normal
emission for new writes and keeps the count. `serve` and release commands
refuse `--replay` with E_REPLAY_DEV_ONLY; production always emits normally.
With `--fresh`, the count dies with the in-memory store; `doctor` and local
`run` inspect the separate on-disk store.

## Refusals

E_EFFECT_CLOSED means a private generated effect context closed with its
handler lifetime or an authority loss. Do not retain or reuse that context;
start work only while its invocation signal remains live.

E_EFFECT_GENERATION means the effect's declaration disappeared or changed
after admission. Queued or running work is durably parked and its claim fields
are cleared, even when the presented lease is stale. A terminal or already
parked row returns the same refusal without rewriting its evidence. Inspect its
durable steps and provider outcomes before creating replacement intent; editing
the declaration does not resume it.

E_EFFECT_UNKNOWN means this server has no queued effect under that ID.
For example, looking up an emit performed under `dev --replay` finds no
payload: replay counted it as suppressed and it will never be delivered.
Check the server/store and use the ID returned by its effects listing.
For an intentional delivery test, restart without replay and perform a
new mutation; restarting does not recreate suppressed effects.

E_EFFECT_ATTEMPTS means an expired lease exhausted the effect's admitted
attempt limit. For example, a worker that repeatedly crashes after sending
mail can use all eight attempts without recording success. Inspect recorded steps and reconcile each with its stored provider key, then
repair the worker before emitting replacement work. Use `meta.id` only for
legacy handlers without steps that used it as their provider key. Whether the
provider accepted the request must be established before repeating it.

E_EFFECT_DEADLINE means this effect's admitted deadline passed; it is
terminal and no worker will claim it again. For example, `deadline 1m`
can elapse while the push provider is down. Inspect the provider outcome
before emitting a replacement, and choose a suitable deadline in the
declaration for future notifications. Restarting the worker or editing
the declaration does not extend the recorded deadline.

E_EFFECT_CANCELLATION means the admitted effect declares cancellation deny.
For example, `POST /effects/<id>/cancel` cannot cancel an effect admitted
from `effect audit cancellation deny`. Let that work settle and inspect
its state. Use `cancellation allow` on future declarations when cancellation
is appropriate; changing source does not change the admitted policy.

E_EFFECT_CANCELLED means the effect was cancelled; later claims or
settlements are refused. For example, a worker finishing a push after
`POST /effects/<id>/cancel` cannot mark that old effect sent. Inspect the
recorded steps and reconcile each with its stored provider key before creating
replacement intent. Use `meta.id` only for legacy handlers without steps
that used it as their provider key.
Cancellation stops further admitted work, but cannot undo a provider call
already in flight."##;
