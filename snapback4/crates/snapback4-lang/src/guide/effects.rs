//! The effects card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Effects: the outside world, performed by a worker

Effects are global declarations shared by every file; jobs are module-qualified
operations. The worker dispatches by the declared effect name, while schedules
and `run` address an operation. If `digest.q` declares `effect notify` and
`job daily()`, write `emit notify { ... }`, register `effects: { notify: ... }`
in the worker, and schedule `digest.daily` (`schedule dailyDigest every 1d: digest.daily`).

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

```quarry
effect notify secrets [PUSH_API_KEY] retry 8 backoff 2s deadline 1d cancellation allow

table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  insert <- exists members[.roomId, viewer]
  sync

table messages:
  roomId: id
  authorId: principal
  body: text <=4000
  at: time
  by byRoomTime: roomId, at, id
  read <- exists members[.roomId, viewer]
  insert <- .authorId = viewer and exists members[.roomId, viewer]
  sync last 500 by byRoomTime

mutation send(roomId: id, body: text <=4000):
  require exists members[roomId, viewer] else NOT_MEMBER
  msg = insert messages { roomId, authorId: viewer, body, at: now }
  for m in members[roomId] first 100 by byRoomPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, roomId, preview: slice(body, 0, 80) }
  return { id: msg.id }
```

This send stays eligible to predict because presence decides only effects; the server commits the effects and defers grace-only decisions until their deadline.
Prediction also evaluates the safe untaken presence arms and discards their effects, so it pays at least their server cost. Effect ids never consume `new` or an insert's ids.
With no live poll but an unexpired presence grace, an absence-conditioned push is queued for the grace deadline: up to 35 seconds. `doctor` shows the deferred count and next deadline; `GET /effects` exposes each deadline as `nextAt`. In tests close that window with `snapback4 clock advance 36s` or `POST /dev/clock/advance` with `{ "duration": "36s" }`; a real-time poll budget must exceed 35 seconds. A reconnect during that window cancels it, even if that poll ends before claim or the server restarts. A live poll at claim also cancels it. The effect is recorded as `satisfied` with `result: { outcome: 'presence_reconnected' }` and zero attempts; it is never handed to a worker. Without a reconnect it becomes claimable once, using the existing lease protocol. No grace means immediate admission; an already live poll still suppresses the push.
Cancellation requires a proven necessary absence guard: `if not exists connected[p]`, its aliases, conjunctions of absence tests or nested absence guards. Several necessary absences wait for the latest grace deadline; a reconnect within any one principal's own window satisfies that guard. Payload-only reads (`emit audit { online: exists connected[p] }`), `not exists connected[p] or force`, and boolean forms without this proof remain immediate and are never cancelled by reconnect.
Potential dependency allocation, propagation and emission copies reserve the same heap allowance with or without grace on the server and device; actual allocations stay metered.
For dispatch-time presence or any other presence-dependent decision, emit unconditionally and have the worker call a service mutation that reads `connected`.

An effect accepts the same `secrets`, `retry`, `backoff`, `deadline` and `cancellation` clauses as an action (guide actions). A bare `effect notify` retains the defaults: eight total attempts, 4s initial backoff, no deadline, cancellation allowed. Generated `server({ actions, effects })` accepts optional legacy effect handlers; these still receive `(payload, meta)`.

The core reserves an effect-specific identity domain in its shared external-step
transition policy, but no effect storage adapter or effect step surface exists
yet. Effects keep the handler, claim, retry and settlement behavior described
on this card; they do not use `_action_steps`, `ServerContext` or `ctx.step`.

The data plane never calls out. `emit name { payload }` in a mutation or
a job writes the payload durably in the same commit as the rows (a
refused mutation emits nothing), and a worker with a service token
(`snapback4 token --service pusher`; guide services) performs it:

```ts
import { runWorker } from "snapback4/worker";
runWorker({ url, token, effects: { notify: async (payload, meta) => { await push(payload); return { providerId: meta.id }; } } });
```

In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

```sh
snapback4 clock advance 36s
curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
```

`clock advance` extends held effect leases by the advanced duration, preserving their remaining real-time lifetime; retry `nextAt` still follows the dev clock.

The loop is `POST /effects/claim { effect?, limit?, lease?, wait?, fenced? }` (a
lease in seconds; `wait` long-polls until something is due), then `POST
/effects/<id>/done { result? }` or `POST /effects/<id>/failed { error,
retry }`; `GET /effects?state=` lists them (queued, running, sent,
satisfied, failed) and `doctor` counts them, including pending grace deferrals. A thrown handler retries with backoff
(by default 4 s, 8 s, ... up to 5 min) until the declared final attempt, then rests as
`failed`; throw `GiveUp` to fail at once. A worker that dies loses its
lease and the effect is claimed again (E_EFFECT_LEASE for the one that
settles late). `runWorker` includes the server's code and message; only a
recorded `queued` state is informational and says requeued. Other states
and unknown outcomes go to `onError` (or stderr). A handler error whose
settlement cannot be recorded is reported separately with its original stack.
Current `runWorker` sets `fenced: true` and returns each claim's `leaseToken`
in `x-snapback-effect-lease`; old same-service attempts cannot settle successors.
Legacy unfenced claims retain their compatibility protocol. A service can
`POST /effects/<id>/cancel` when the declaration permits it; this cannot
undo provider I/O already in flight. Work ids have no automatic expiry or reuse.
Two workers never hold one effect. `meta.id` is the
idempotency key a provider should see. A scheduled job that `emit`s once
per period is the digest recipe.

## Effect lifecycle refusals

E_EFFECT_UNKNOWN means this server has no queued effect under that ID.
For example, looking up an emit performed under `dev --replay` finds no
payload: replay counted it as suppressed and it will never be delivered.
Check the server/store and use the ID returned by its effects listing.
For an intentional delivery test, restart without replay and perform a
new mutation; restarting does not recreate suppressed effects.

E_EFFECT_ATTEMPTS means an expired lease exhausted the effect's admitted
attempt limit. For example, a worker that repeatedly crashes after sending
mail can use all eight attempts without recording success. Inspect the
provider with `meta.id` as its idempotency key and repair the worker before
emitting replacement work. Reusing that key at the provider prevents a
lost acknowledgement from becoming another delivery.

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
provider using the effect's idempotency key before creating another effect.
Cancellation stops further admitted work, but cannot undo a provider call
already in flight.
"##;
