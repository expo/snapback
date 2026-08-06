# authExchange never resolves when an internal authSession refresh interleaves (AuthCoordinator custody)

**Date:** 2026-08-06 · **Found by:** LLP 0183 Stage 0.5 control, Lane 6b Chrome harness

**Status:** Reopened 2026-08-06 after the initial re-capture fix; the live
Chrome flow still deadlocked inside the coordinator barrier.

## Symptom

Under browser AuthCoordinator custody, `client.authExchange({challengeId, code})`
hangs forever (no resolution, no rejection) when a client-internal
`/auth/session` request interleaves the exchange. Captured live network order:

```
POST /__snapback/auth/exchange          (sent)
GET  /__snapback/auth/session  -> 200   (client-internal refresh, interleaved)
POST /__snapback/auth/exchange -> 200   (exchange succeeds on the wire)
(no further auth traffic; the authExchange promise never settles)
```

Reproduced repeatedly in the Lane 6b Chrome harness; the same flow succeeds
when the interleaving refresh happens not to fire (flaky pass). The app-side
controller cannot serialize around it because the racing request originates
inside the client (query machinery re-probing auth while pre-login queries
hydrate).

## Suspected locus

`packages/snapback-client/index.mjs` `authExchange`: it captures
`authCoordinator.capture()` BEFORE the POST and finishes with
`authCoordinator.transition(capture, {...}, 'login')`. If the interleaved
internal refresh advances coordinator custody meanwhile, the concluding
`transition` holds a stale capture; the coordinator appears to wait on stale
lineage indefinitely instead of refusing (staleAuthorityError) or retrying on
fresh capture. Needs confirmation in
`packages/snapback-contract/auth-coordinator.mjs` transition semantics.

## Initially confirmed mechanism

The exchange capture is stale by the time the POST succeeds. The interleaved
`#coordinatedAuthSession` has observed a different handshake authority and
entered `AuthCoordinator.transition(..., 'handshake_authority_change')`; its
durable write can already have advanced custody to `clearing`/the successor
while its local participant barrier is still settling.

The concluding login call does not reject from the coordinator's local state.
`AuthCoordinator.transition` unconditionally enters `#withOwnership` before it
reloads durable custody and checks `captureMatches(expected)`. In the browser
carrier that means the stale login is queued in `navigator.locks.request`
behind the internal refresh transition, which retains exclusive ownership from
the initial reload through participant quiesce, blank, memory clear, durable
commit, and the settled write (LLP 0059's transition phases 1--8). When that
barrier is waiting on client/store work in the pre-login hydration lineage, the
app is already awaiting `authExchange`, so the queued stale transition cannot
run and the ownership holder cannot finish: the exchange promise remains
pending. It never reaches the later `captureMatches` branch that would throw
`SNAPBACK_CLIENT_AUTHORITY_STALE`; there is no `waitForNewerRevision` call and
no rejection is swallowed.

The client therefore must not submit its pre-POST capture as a new transition
after the response. It must reload/re-capture custody, apply the exchanged
credential only from fresh anonymous custody, adopt an already-settled exact
exchanged session idempotently, or reject the advanced different authority with
the existing typed stale-authority error.

## Required behavior

authExchange must terminate: either complete the login transition (re-capture
and apply, if the interleaved refresh remained anonymous) or reject with a
typed stale-authority error. Silent non-termination is inadmissible.

## Initial resolution (necessary, not sufficient)

Resolved in `packages/snapback-client` without changing coordinator semantics.
After validating a successful exchange response, `authExchange` now captures
settled custody again and derives the exchanged session against that current
authorization-stream incarnation. It transitions only from fresh anonymous
custody, returns idempotently when custody already names the exact exchanged
session, rejects a different authenticated successor with
`SNAPBACK_CLIENT_AUTHORITY_STALE`, and maps an in-progress clearing barrier to
the same typed stale outcome instead of queueing the obsolete login capture.

`auth-exchange-concurrency.test.mjs` pins three socket-free interleavings: a
completed anonymous internal refresh followed by successful login; an internal
refresh held in its custody barrier, where the exchange must reject and release
the cycle; and a different authenticated successor, where the exchange must
reject typed stale. The focused regression and the existing bearer rotation,
sender transport, logout v3 bridge, and packaged-client tests pass.
`./ref-check --verbose` also passes.

## 2026-08-06 continuation — definitive Web-Lock trace

The supervising Chrome session instrumented the production IndexedDB
`withWebLock` boundary and captured the cycle directly:

```text
transition requests and acquires snapback-auth-custody
participant/listener settlement requests AuthCoordinator.synchronize
synchronize queues for the same exclusive Web Lock
transition never releases because it is awaiting that settlement
```

The transition's lock acquisition had no matching release. Every subsequent
custody request queued behind it, `authExchange` never settled, and the UI
remained `transitioning`.

### Definitive mechanism

`AuthCoordinator.transition` wrote the durable `clearing` record and then ran
`quiesce`, `blank`, `clearMemory`, and `commitDurable` while its
`storage.withOwnership` callback still held the exclusive Web Lock. Quiescence
can await already-running query/live listener settlement. That work re-enters
the mandatory custody gate at `AuthCoordinator.synchronize`, which must request
the same non-reentrant Web Lock. The owner therefore waited on its queued
contender while the contender waited on the owner.

The memory carrier did not have a different safe release rule: its queued-tail
owner also retains ownership until the callback returns and reproduces the
same cycle. Existing memory tests missed it because none made participant
settlement depend on a queued `synchronize()` request. The new
Web-Lock-faithful regression did and timed out against the old implementation.

### Contract decision

The previous wording of LLP 0059 §Transition barrier required ownership from
the predecessor reload through the settled write. That rule is incompatible
with the participant contract in a real client, where quiescence must be able
to drain operations that themselves cross a custody gate. LLP 0059 is amended
to a split-ownership protocol:

1. Under ownership, reload/validate the predecessor and CAS it to the durable
   `clearing` intent. This remains the authority-transition linearization point.
2. Release ownership and settle local `quiesce`, `blank`, `clearMemory`, and
   `commitDurable` phases while publication remains closed.
3. Reacquire ownership and settle only the exact clearing transition id,
   authority epoch, and revision. Accept only an exact already-settled peer
   completion of that same intent; reject any other durable state as stale.
4. Run resume outside ownership and preserve the existing final exact owned
   confirmation before staged publication and exposure.

This keeps LLP 0059's ordering guarantees: every mandatory local participant
still settles before `transition()` resolves; durable expected-epoch CAS and
the clearing intent fence stale participants; late participants still catch up;
and no successor effect is exposed before the post-resume exact confirmation.
A same-coordinator `synchronize()` that observes its own active clearing intent
now returns typed `SNAPBACK_CLIENT_AUTHORITY_CLEARING` after acquiring the
released lock instead of recursively replacing the barrier.

### Resolution

`auth-coordinator.mjs` now prepares the clearing barrier under the first owner,
runs participant phases after that owner releases, and performs the exact
clearing-to-settled CAS under a second short owner. The regression uses a
queued exclusive storage wrapper with request/acquire/release behavior matching
Web Locks; its quiesce acknowledgment awaits a `synchronize()` ownership
request and proves the transition terminates with all phases ordered.

The temporary `__zbugsLock` instrumentation in
`auth-custody-indexeddb.mjs` was removed, restoring its pre-trace logic. The
earlier `authExchange` re-capture fix remains because an exchange response must
still never be applied against an obsolete authorization-stream incarnation.

### Verification

- The queued-lock regression timed out before the coordinator change and
  passes afterward.
- Full `@expo/snapback-contract` `npm test` passes, including coordinator,
  missed-wakeup, IndexedDB custody, sender custody, Contract composition, and
  client-store authority suites.
- The auth-related client files pass directly: assets authorization, lifecycle
  disposal, bearer rotation, auth-exchange concurrency, sender proof/transport,
  hosted-browser custody, logout v3 bridge, and browser closure.
- `./ref-check --verbose` passes with 0 errors and 0 unchecked references.

The all-files `@expo/snapback-client` `npm test` command was also attempted. It
stopped before the auth files at `micro-operational.test.mjs` because this
sandbox refuses its localhost listener (`listen EPERM 127.0.0.1`); the named
auth files were therefore run directly as the relevant verification.

## 2026-08-06 continuation — clearing publication microtask spin

After the ownership split removed the Web-Lock cycle, live Chrome stopped on a
different failure shape: the page main thread became unavailable to CDP
`Runtime.evaluate`, consistent with a promise-microtask loop rather than a
blocked Web Lock.

### Confirmed mechanism

The clearing CAS installs the local barrier and publishes `clearing` before
participant settlement. Client/listener machinery awakened by that publication
can schedule an authority synchronization in a microtask. The ownership split
now lets that synchronization acquire the queued custody lock, where it sees
the same coordinator's active clearing intent. The first version of the split
returned `SNAPBACK_CLIENT_AUTHORITY_CLEARING` immediately.

That refusal was not a progress boundary. A client-style caller that treats
`CLEARING` as retryable can immediately enqueue another synchronization
microtask, producing:

```text
publish clearing
  -> listener synchronize
  -> exact local clearing refusal
  -> microtask retry synchronize
  -> exact local clearing refusal
  -> ...
```

The production audit found the relevant client retry shape in
`SnapbackClient.#coordinatedAuthSession`: when an in-flight capture ceases to be
current it recursively begins one fresh coordinated session, whose first gate
is `AuthCoordinator.synchronize()`. Consumer/list hydration can also invoke a
new single-flight after the rejected flight clears. The explicit logout loop
already waits 10 ms between stale/clearing attempts, the live-stream reconnect
manager uses timer-backed exponential delay, and the coordinator broadcast
receiver itself submits only one synchronization per wakeup; none of those
three was the unbounded coordinator-level progress guarantee.

The socket-free regression combines the coordinator, a Web-Lock-faithful
queued ownership stub, a participant that yields through already-queued
microtasks, and a publication listener that retries every typed `CLEARING` in
another microtask. Against the prompt-refusal implementation it performed 7
`synchronize()` calls during one short transition and failed the bound of 4.
This confirms the publish/refusal/retry cycle without relying on sockets,
browser scheduling, or a wall-clock timeout.

### Settlement-wait rule and resolution

An external `synchronize()` that observes the same coordinator's active local
clearing barrier now awaits the barrier's already-installed terminal completion
and then performs one fresh durable synchronization. The completion resolves
only after successful resume/final exposure or after the failure cut finishes,
so the waiter cannot outrun LLP 0059's settlement-before-resolve guarantee.

The rule deliberately excludes synchronization invoked while a participant
callback is executing. An awaited `quiesce` may depend on work that reaches
that custody gate; making it await the barrier completion would create a new
self-join (`barrier -> quiesce -> synchronize -> barrier`). Participant
reentry therefore still acquires the released queued lock and receives the
prompt exact-clearing refusal pinned by the earlier deadlock regression. No
participant phase or barrier wait holds cross-context ownership.

LLP 0059 now states both halves of this contract: external clearing observers
join terminal settlement, while participant-callback reentry refuses promptly.
No additional `packages/snapback-client` retry change was necessary because its
fresh coordinated retry now blocks at the progress-making synchronization
gate.

### Verification

- The new socket-free clearing-publication spin regression failed before the
  fix at 7 synchronization attempts and passes afterward within its bound of 4.
- The queued-lock participant-acknowledgment regression still passes, proving
  prompt participant reentry and no ownership across `quiesce`, `blank`,
  `clearMemory`, `commitDurable`, or `resume`.
- `auth-exchange-concurrency.test.mjs` passes all three interleavings: fresh
  anonymous recapture, held internal refresh barrier, and different
  authenticated successor.
- Full `@expo/snapback-contract` `npm test` passes.
- All nine auth-focused client files pass directly:
  `assets-watch-authorization`, `lifecycle-disposal`, `bearer-rotation`,
  `auth-exchange-concurrency`, `sender-proof`, `sender-transport`,
  `hosted-browser`, `logout-v3-bridge`, and `browser-closure`.
