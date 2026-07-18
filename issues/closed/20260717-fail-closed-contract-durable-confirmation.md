# Fail closed when Contract durable authority confirmation fails

**Status:** Closed
**Severity:** P1
**Systems:** Contract adapter, AuthCoordinator, Offline replay, Browser custody
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059 §Cross-context ownership; LLP 0059 §Exposure invariant
**Marker:** auth, client, fail-closed, replay, release-blocker

`createDurableAuthorityConfirmer` caught and resolved every rejection from
`AuthCoordinator.synchronize()`. Ordinary ownership or custody-read failures
also left the coordinator's last in-memory authority publishable, while a
missing durable record paused without blanking the visible predecessor. As a
result, an awaited mandatory gate such as Contract reconnect could continue
through an unconfirmed in-memory capture, issue its authoritative query, and
replay queued mutations even though durable custody could not prove that capture
was current.

This contradicts LLP 0059: a failed ownership read is a mandatory-gate failure,
not a best-effort wakeup miss. The local publication gate must close and the
foreground caller must receive the failure before any app-data dispatch.

**Done when:**

- `AuthCoordinator.synchronize()` pauses publication and runs the local
  quiesce/blank/clear phases when its ownership acquisition or first durable
  custody read fails after an authority was exposed. A missing durable record
  after exposure is corruption, not a fresh-custody result.
- A clearing wakeup that already paused publication still runs that complete
  local cut when its durable reload fails; the pause itself is not proof that
  predecessor materialization was blanked.
- The failure cut snapshots participants behind a completion handle, attempts
  every quiesce/blank/clear callback despite peer failures, preserves the
  custody error as primary, and prevents quiesce-time unregistration from
  escaping destructive phases.
- Offline restore never invokes participant or counter-terminal cuts while
  holding the non-reentrant custody owner; peer adoption uses exact durable
  confirmation both before its barrier and at final exposure.
- A participant self-unregistration request remains supported, but awaiting it
  from that participant's active callback rejects typed instead of deadlocking.
  Invalid thenables from registration-time or ordinary sync phases are observed
  before the typed phase error, and a failed initial blank blocks fresh restore.
- Fresh anonymous establishment applies the same registration-failure gate;
  no first-exposure path can publish over an invalid initial blank.
- Counter-terminal reads/writes return deferred metadata from ownership and run
  the exact snapshotted terminal cut only after the owner releases. Terminal
  and eager cuts retain completion through a final post-quiescence blank.
- Final online/offline publication closes the participant phase set inside its
  ownership fence. Late registrants catch up and force exact reconfirmation;
  an overlapping eager cut resets and replays erased phases before reopen.
- A durable requested successor is idempotent only when already exact locally;
  a missed-wakeup predecessor runs the full peer adoption barrier.
- Quiesce/early barrier failures retain completion and run an isolation-safe
  destructive cut outside ownership while preserving the transition error.
- Coordinator close is an exposure veto during pending resume/final confirm,
  staged callbacks recheck lifecycle authority one by one, and participant
  registration from a staged commit rejects as reentrant.
- Durable confirmation rejects its caller instead of converting failure to a
  fulfilled promise.
- Explicit fire-and-forget lifecycle hints observe and suppress their own
  rejection so the mandatory confirmer does not create unhandled promises.
- Contract reconnect performs no query or mutation dispatch after a custody
  read failure, blanks the visible boundary, and leaves durable queued work
  unsettled.
- Single-query and multi-live mutation entry points reload durable custody and
  compare their exact predecessor capture before optimistic publication or
  transport dispatch, including generic accepted clients whose transport does
  not own a second internal authority fence.
- Generic query/live-query, ephemeral subscribe/publish, standalone ACK,
  first-send mutation, and replay mutation calls put their final confirmation
  after the last awaited client-store operation and at actual dispatch.
- A null durable read during active participant resume is typed
  `SNAPBACK_AUTH_CUSTODY_CORRUPT`; no host `TypeError` escapes the state
  machine.
- The focused coordinator and offline-replay suites pass.

## Resolution

The coordinator now treats ownership acquisition and the initial owned custody
read as part of `synchronize()`'s fail-closed publication gate. A failure after
exposure pauses the coordinator, quiesces participants, blanks their visible
boundaries, clears process-local predecessor state, and rethrows the original
typed error. A null read is accepted only in an already-blank fresh context;
after exposure it produces `SNAPBACK_AUTH_CUSTODY_CORRUPT` and the same local
cut. Reentrant resume reads keep the already-active barrier closed and
likewise rethrow so its owner can finish the prescribed reblank choreography.

The exposure witness is the retained validated local custody record, not the
current value of the publication-pause bit. This matters when an ordinary
clearing wakeup closes the gate synchronously and its later owned read fails:
the context still runs the local destructive cut. That cut now snapshots all
participants under a completion-bearing barrier, observes every quiesce
result, and attempts every synchronous blank and memory clear. Participant
errors are retained as secondary phase evidence on the primary custody error;
they neither replace that error nor prevent later participants from deleting
predecessor state. An unregistration requested by a quiesce hook settles only
after those snapshotted destructive phases. If that hook awaits its own
unregistration, the coordinator rejects the cyclic join with
`SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT` and continues the cut.

Offline restore now separates custody inspection from local effects. Owned
callbacks only read and validate. Fail-closed blanking, terminal-counter cuts,
and peer participant phases execute after ownership is released; peer adoption
reacquires only for the final exact confirmation and synchronous local
exposure. Registration and every other declared synchronous participant phase
share one validator: an async return is observed, rejected with
`SNAPBACK_AUTH_PARTICIPANT_ASYNC_SYNC_PHASE`, and retained so fresh restore
or anonymous establishment cannot expose over a participant that never
completed its initial blank.

All counter-terminal local work is now deferred beyond storage ownership.
Terminal and eager cuts install a completion before invoking one exact
participant snapshot, perform an immediate blank, await isolated quiescence,
then blank and clear that same snapshot again. Unregistration repeatedly joins
active barrier/cut completions, so a quiesce-time removal cannot settle ahead
of the final cut.

Owner, online-peer, and offline-peer barriers now check phase closure inside
the final durable fence. A participant registered during the final read causes
catch-up outside ownership and exact reconfirmation. A destructive cut carries
a generation; overlap discards staged effects and resets participant phase
marks before resume. The same final fence refuses closed coordinators, while
the dynamic resume loop and staged callback queue recheck closure before each
new effect. Transition failures retain their primary diagnostic and complete a
snapshotted local cut after ownership releases.

The Contract durable confirmer now preserves that rejection. Awaited foreground
gates, including reconnect, stop immediately; places that intentionally use the
reload only as a non-blocking stale-authority hint attach an explicit rejection
handler.

App-data starts use the same distinction. Both single-query and multi-live
surfaces await the durable reload and exact predecessor comparison at their
query, live-query, ephemeral subscribe/publish, acknowledgement, and mutation
dispatch boundaries. The single-query mutation path also performs this gate
before optimistic publication, then repeats it after pending-ACK loading and
queue CAS. Replay repeats after the same last store awaits. A missed A-to-B
wakeup therefore blanks/adopts B and rejects A without invoking even a generic
client's transport. A failed post-response comparison triggers the same reload
instead of leaving the process-local `isCurrent(A)` hint and A boundary
indefinitely visible.

The regressions build real coordinators, Contract surfaces, and durable client
stores. They prove a failed custody read stops reconnect before query/replay,
and deterministically settle A -> B while first-send queue CAS, replay queue
CAS, and standalone-ACK loading are suspended. In every case the boundary
blanks and generic predecessor transport receives no call.

Focused proof on 2026-07-17:

- `node packages/snapback-contract/auth-coordinator.test.mjs` — passed.
- `node packages/snapback-contract/auth-coordinator-missed-wakeup.test.mjs` —
  passed, including single-query and multi-live mutation preflight.
- `node packages/snapback-contract/offline-replay.test.mjs` — passed.
- `npm test --workspace @snapback/contract` — all package suites passed.
- The coordinator suite additionally covers late final-confirm registration
  online/offline, eager-cut overlap, legacy MAX_SAFE self-unregistration,
  same-successor missed wakeup, throwing quiesce, close during resume/final
  confirm, and staged close/registration reentrancy.
