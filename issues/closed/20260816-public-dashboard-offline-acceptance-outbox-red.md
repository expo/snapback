# public-dashboard offline acceptance: outbox phase red on main (4/9)

**Status:** Resolved
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Offline outbox, Acceptance testing, Client
**Date:** 2026-08-16
**Related:** issues/20260816-ownership-composition-fixture-wave.md (suspected
same wave), LLP 0043 M2, LLP 0270

## Signature

`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` fails 5 of
9 checks on main — every check in the offline-mutation/outbox-settlement
phase, deterministic:

1. `offline create/update queue durably with client-minted ids` —
   `SNAPBACK_CLIENT_REFUSED: fetch failed` (the mutate surfaces the network
   failure instead of queueing);
2. `a relaunch with pending intent renders retained pre-intent rows...` —
   pending-intent fact expected 2, got 0;
3. `server restart settles the queued intent exactly-once` — timeout waiting
   for current;
4. `duplicate delivery of a settled id` — undefined `clientMutationId`;
5. `fresh client instance after restart` — offline-settled create present
   after relaunch.

The retention-phase checks (default store, refusal boundary, retained
render) pass.

## Bisect evidence (2026-08-16 orchestration session)

Same binary (built at post-2fbe4676f src; the candidate landings are
JS-only), `SNAPBACK_RUNTIME_BINARY` pinned, codegen re-primed per sha:

- `e49e75efc` (docs-only landing; PRE default-drain wave 1, PRE optimistic
  wave 2): **4/9, identical signature** — the red predates both LLP 0270
  client landings.
- `d92e8165a` (post wave 1): 4/9 identical.
- Current retained-lane worktree (wave 3): 4/9 identical.

So the LLP 0270 waves did not introduce it. Prime suspect is the LLP 0264
Phase-1a enforcement landing (`4fe648fd0`) or an adjacent same-day landing —
the demo's mutations (`recordMetric` etc.) are generic writes on the
pre-0264 posture (`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` warnings
in codegen), and "fetch failed" surfacing instead of queue custody matches a
server-side refusal changing the client's failure classification. Not
verified further; whoever owns the enforcement-wave burn-down
(20260816-ownership-composition-fixture-wave.md) should fold this in or
bisect the exact commit.

## Resolution (2026-08-25)

The table-write posture was not the cause. An online `recordMetric` call on
the generated public-dashboard artifacts settled successfully, so LLP 0264's
Phase-1a preservation of pre-existing public-read writes was working.

The client also classified the original `TypeError: fetch failed` as a
connectivity failure correctly. The loss happened at the next safety gate:
after dispatch failed, the outbox path fetched `/inspect` to require positive
settlement-ledger evidence. That probe necessarily failed against the same
offline server, and the client discarded the positive capability manifest it
had already observed. It then surfaced the original
`SNAPBACK_CLIENT_REFUSED` instead of accepting durable custody.

The client now persists the latest dispatch-ordered answered
`offline_mutation_replay` fact through ordinary successful query/live-query
lifecycle, bound to canonical origin and the target's served artifact
generation. The store writer reserves a shared request sequence before each
inspection fetch and compare-and-commits its answer against the observed fact
revision; a no-response failure advances neither the durable fact nor the
client answered high-water. Enqueue and replay re-read the shared fact and
generation at their durable/transport boundaries, including before ambiguous
foreground failure may resolve `queued`. Generated mutation references must
match the exact artifact generation; string-named mutations match on canonical
origin. Cached support is enqueue-only, replay always needs a fresh positive,
and all effect-producing HTTP methods reject redirects as answered refusals.

The demo acceptance is again un-prewarmed: it closes the online client, stops
the backend, then creates the offline client. The fact acquired by normal
online use survives in the default durable store. After restart it relaunches
the direct/headless client from the new server kit options, preserving the
durable outbox while rotating the per-boot dev-identity capability required by
LLP 0262. This avoids presenting stale identity custody and exercises default
drain from the durable store.

Fail-first evidence: the focused client test failed without the client change
with `SNAPBACK_CLIENT_REFUSED: fetch failed` (`tests 1`, `pass 0`, `fail 1`).
The original acceptance reproduced at `FAIL ... — 4/9` before the fix.
The round-6 regressions were each run against a temporary mutation of their
safety cut before restoration:

- moving sequence reservation from dispatch to response arrival failed the
  delayed-fetch test with `dispatch-later negative remains durable` and
  `true !== false`;
- advancing the answered high-water on connectivity failed the in-flight first
  discovery test with `undefined !== true`;
- bypassing store compare-and-commit failed the IndexedDB two-client test at
  `delayed older positive cannot overwrite the newer negative`;
- bypassing the shared generation re-read failed foreground admission with
  `Missing expected rejection`, while bypassing only the replay re-read failed
  `replay re-reads the shared fact before POST` with `1 !== 0`;
- disabling write redirect rejection failed the foreground test because
  `redirect` was `undefined` instead of `'manual'`, and failed replay with
  actual code `ERR_ASSERTION` instead of `SNAPBACK_REDIRECT_REFUSED`.

Round-6 verification (2026-08-25):

- `node --test packages/snapback-client/outbox-store.test.mjs`: `tests 106`,
  `pass 106`, `fail 0`. New cases cover delayed fetch arrival, connectivity not
  answering, cross-client admission/ambiguous-response and replay re-reads,
  stale-answer compare-and-commit on IndexedDB writer/follower and file
  writer/follower, and foreground/replay 307/308 refusal.
- `SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" node
  demos/public-dashboard/tests/acceptance/offline-local-first.mjs`: `PASS
  public-dashboard / offline-local-first (JS arm) — 9/9`. The first check now
  awaits `whenOfflineMutationReplayCapabilitySettled()`; it no longer polls
  internal RQS metadata.
- `SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" node
  demos/public-dashboard/tests/acceptance/headless.mjs`: `PASS public-dashboard
  / headless — 6/6`. Both demo runs used the existing qualified binary stamped
  at `f446d966b`; the explicit override reported the expected stamp mismatch
  against JS-only HEAD and did not build a runtime.
- `node scripts/check-guide.mjs`: `21 passed, 1 failed, 0 skipped, 0
  preconditions; 157 pages, 1872 snippets, 174 routes + 51 host-ops joined, 94
  warnings`. Symbol registry, guide corpus, manifest/MCP, and flat projections
  pass. The only red is the deliberately unregenerated diagnostics registry;
  integration owns the final emitting-site rewrite after lane integration.
- `node scripts/generate-symbol-registry.mjs --check`: `[symbol-registry] ok —
  56 modules, 1455 symbols, runtime parity exact`.
- `node scripts/check-inventories.mjs`: the only red is `guide-manifest`; its
  source check reports the same diagnostics-registry staleness delegated to
  integration.
- Regenerated projections: `guide/reference/registry.json` and its 57 Markdown
  symbol projections; `guide/guide-manifest.generated.json`; the changed
  global/reference flat guides. The diagnostics registry currently committed
  on this branch is an intermediate earlier regeneration; this round did not
  update it, and integration rewrites its final emitting sites. No claim is
  made that those branch bytes equal the lane's original starting bytes.
- `./ref-check --verbose`: `311 LLP docs, 6637 refs in 12503 files, 0 errors,
  0 unchecked`.
- `git diff --check`: no output (pass).

### Round-7 review closure (2026-08-25)

Capability fact currency is now semantic rather than revision-equality: a
newer positive continues the observed positive only when canonical origin,
target profile, and complete artifact generation are identical. A negative or
target-identity/generation change supersedes it. Supersession before dispatch
retires the durable record and refuses without a POST; once a POST has started,
an ambiguous response keeps the record pending so the settlement identity is
not lost.

An IndexedDB follower that cannot reserve through the writer now captures the
shared fact revision before its inspection request, but no request sequence.
Takeover compare-and-commits against exactly that revision, drops the pending
answer if shared state advanced, and never mints a sequence for the unreserved
answer. A local negative override is also discarded when the same client is
repointed to another canonical origin.

The all-non-read redirect posture is intentional. Every non-GET/HEAD/OPTIONS
request, including an anonymous query POST, remains `redirect: 'manual'` and
maps redirects to `SNAPBACK_REDIRECT_REFUSED`; proxies must serve the canonical
POST path directly rather than rely on 301/302 or trailing-slash rewrites.

Round-7 fail-first evidence, captured before the fixes (or against the named
temporary mutation, then restored):

- the identical-positive race returned `SNAPBACK_CLIENT_REFUSED: ambiguous
  mutation response after identical positive` instead of `queued`, losing the
  record;
- the inverse negative-before-dispatch race reached the fetch double and
  returned `SNAPBACK_CLIENT_REFUSED: ambiguous mutation response` instead of
  the capability refusal, proving the retired record was still dispatched;
- the unreserved takeover test replaced expected positive revision 2 / request
  sequence 2 with stale negative revision 3 / freshly minted sequence 3;
- the repointed-origin test returned `SNAPBACK_CLIENT_REFUSED: second origin
  offline` instead of using the second origin's cached positive to enqueue;
- restoring post-dispatch retirement failed the IndexedDB cross-client test
  with actual pending ids `[]` instead of
  `['cm-indexeddb-cross-client-negative']`;
- temporarily exempting query POSTs from the method-conservative redirect rule
  failed with actual `redirect: undefined` instead of `'manual'`.

Round-7 focused verification updates the client suite total to `tests 110`,
`pass 110`, `fail 0`. The public-dashboard witnesses remain `PASS
public-dashboard / offline-local-first (JS arm) — 9/9` and `PASS
public-dashboard / headless — 6/6`; both used the explicitly configured binary
stamped at `f446d966b` and reported the expected checkout stamp mismatch.
`node scripts/generate-symbol-registry.mjs --check` reports `56 modules, 1455
symbols, runtime parity exact`. `node scripts/check-guide.mjs` reports `21
passed, 1 failed, 0 skipped, 0 preconditions; 157 pages, 1872 snippets, 174
routes + 51 host-ops joined, 94 warnings`; the sole failure is the deliberately
unregenerated diagnostics registry owned by integration, while the symbol,
manifest/MCP, and flat-projection checks pass. `./ref-check --verbose` reports
`311 LLP docs, 6639 refs in 12503 files, 0 errors, 0 unchecked`, and `git diff
--check` produces no output. The branch carries an intermediate diagnostics
registry/Markdown regeneration from earlier lane work, and integration still
owns the final rewrite after its emitting-site changes; those bytes are not
claimed to match this lane's starting commit.

### Round-8 review closure (2026-08-25)

The post-transport fallback no longer carries retirement authority. Once the
durable foreground record exists and `fetch` has been invoked, capability
supersession can refuse queued presentation but cannot discard or mark failed
the original `clientMutationId`; an ambiguous response leaves that record
pending for exactly-once recovery. Before transport starts, the capability
fact re-read now runs under the authorization-dispatch lock, after
`outboxPrepareSubmission()`, as the final serialized fence immediately before
the fetch cut.

An unreserved IndexedDB negative that wins after writer death now stamps the
allocator's existing request high-water without minting a sequence. A reserved
answer that observed an older store revision must carry a sequence strictly
newer than that stamped floor to commit. `close()` is terminal for capability
answers, so a closed client cannot broker a delayed response into the successor
writer.

Round-8 fail-first evidence captured against the pre-fix production helpers:

- the post-loss supersession regression failed with `the original
  clientMutationId remains pending after transport starts`, actual `[]` versus
  expected `['cm-post-loss-capability-supersession']`;
- the post-prepare transport-fence regression failed with `Missing expected
  rejection.` after the mutation POST settled;
- the takeover-order regression failed with `the stale reserved positive
  cannot overwrite the takeover negative` and `true !== false`;
- the closed-client regression failed with `SNAPBACK_RQS_STORE_CLOSED: RQS
  resume store is closed` after the late answer had already reached the live
  writer path.

Round-8 focused verification updates the client suite to `tests 114`, `pass
114`, `fail 0`. The public-dashboard witnesses remain `PASS public-dashboard /
offline-local-first (JS arm) — 9/9` and `PASS public-dashboard / headless —
6/6`; both used the explicitly configured binary stamped at `f446d966b` and
reported the expected checkout stamp mismatch. The symbol registry was
regenerated with its 57 Markdown projections, followed by the guide manifest
and flat projections without running the diagnostics generator;
`node scripts/generate-symbol-registry.mjs --check` reports `56 modules, 1455
symbols, runtime parity exact`. `node scripts/check-guide.mjs` reports `21
passed, 1 failed, 0 skipped, 0 preconditions; 157 pages, 1872 snippets, 174
routes + 51 host-ops joined, 94 warnings`; the sole failure remains the
deliberately unregenerated diagnostics registry/Markdown projection. The
branch carries their earlier intermediate regeneration, and integration owns
the final emitting-site rewrite. `./ref-check --verbose` and `git diff --check`
are rerun at the final commit boundary.

### Round-9 review closure (2026-08-25)

Every path that presents `status: 'queued'` from foreground mutation admission
now performs a final shared capability-fact re-read. An operation-identity
range request is still pre-mutation transport: if a newer negative lands while
the range request is in flight and that request then loses transport, the
admitted durable record is retired and the capability refusal surfaces with no
mutation POST. The auth-transition housekeeping special path now performs the
same fresh/cached capability admission and re-reads the shared fact immediately
before and after its durable enqueue; `queue: 'auto'` becomes online-only under
an already-durable negative, so the barrier refuses it without a pending
record.

Client close is now the terminal capability-publication fence even for an
injected caller-owned store. A capability answer reaching record/commit after
`__clientClosed` cannot mutate the shared store, while `close()` awaits any
commit that already crossed the store boundary before resolving. A successor
client over the same injected store therefore observes the last fact committed
before the predecessor client closed.

The minor takes option (a): a settled positive lifecycle probe is retained
across ordinary successful `query()` calls. Answered negative facts keep LLP
0043's replacement rule and clear the retained lifecycle probe, so the next
successful read may recover; reconnect and canonical-target change also force
a new probe. This preserves answered-error ordering while removing the product
path where an unrelated per-query `/inspect` 5xx could overwrite a positive
ledger fact immediately before offline enqueue.

Round-9 fail-first evidence from the four production regressions:

- the in-flight range supersession returned `queued`; the refusal assertion
  failed with actual `undefined` versus expected
  `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`;
- the auth-transition housekeeping path returned `queued`; the online-only
  refusal assertion failed with actual `undefined` versus expected
  `SNAPBACK_CLIENT_AUTHORITY_CLEARING`;
- the closed-client injected-store test observed the late negative in shared
  storage and failed `the shared store retains its pre-close fact` with
  `false !== true`;
- the repeated-query lifecycle test issued two inspections and failed
  `a settled positive lifecycle observation is reused across successful
  queries` with `2 !== 1`.

Round-9 verification updates the client suite to `tests 118`, `pass 118`,
`fail 0`; the affected authority-transition conformance suite is `tests 9`,
`pass 9`, `fail 0`. The public-dashboard witnesses remain `PASS
public-dashboard / offline-local-first (JS arm) — 9/9` and `PASS
public-dashboard / headless — 6/6`; both used the explicitly configured binary
stamped at `f446d966b` and reported the expected checkout stamp mismatch.
`node scripts/generate-symbol-registry.mjs --check` reports
`[symbol-registry] ok — 56 modules, 1455 symbols, runtime parity exact`.
`node scripts/check-guide.mjs` reports `21 passed, 1 failed, 0 skipped, 0
preconditions; 157 pages, 1872 snippets, 174 routes + 51 host-ops joined, 94
warnings`; the sole accepted failure remains the diagnostics registry and
Markdown projection delegated to integration. Symbol registry, guide corpus,
manifest/MCP, and flat projections pass. The final diagnostics files remain
the exact branch-HEAD bytes (including integration's stray union member): the
guide generator's coupled diagnostics invocation was reverted, then the
symbol/manifest/flat projections were generated against the restored
diagnostics bytes. `./ref-check --verbose` reports `311 LLP docs, 6641 refs in
12503 files, 0 errors, 0 unchecked`; `git diff --check` produces no output.

### Round-10 review closure (2026-08-25)

Replay now takes the capability fact read at the same serialized
transport-start cut as foreground delivery: after acquiring the shared
authorization-dispatch lock and after `outboxPrepareSubmission()` marks and
returns the exact record, immediately before `fetch`. A negative committed
from inside replay preparation therefore starts zero mutation POSTs and leaves
the original record pending.

Cached enqueue-only evidence no longer starts operation-identity range
transport. The automatic path durably enqueues an explicitly uncovered record
with zero non-inspection transport; replay first obtains a fresh positive
capability answer, then acquires and durably assigns the range before sending
the mutation once. The configured test-only capability seam retains its
existing direct range behavior; production cached evidence is the only
deferred class.

All four RQS store carriers now return `false` when the versioned capability
fact compare reports `committed: false`; they do not rewrite the current fact
or let callers mistake its returned bytes for a successful replacement. The
public-dashboard acceptance's `closeClient()` now awaits `client.close()` and
lets teardown failures fail the acceptance, so its close-and-relaunch claim is
exercised through the client lifecycle rather than by closing only the exposed
store.

Round-10 fail-first evidence from the three new regressions:

- replay preparation failed `replay preparation cannot precede the final fact
  read` with `1 !== 0`, proving one mutation POST started after the injected
  negative;
- cached identity enqueue failed `cached evidence licenses no identity-range
  POST` with `1 !== 0`;
- the rejected compare failed `a stale compare is reported as not committed`:
  actual was the current positive fact (request sequence 2, store revision 1),
  expected `false`.

Round-10 verification runs the requested client/conformance command at `tests
130`, `pass 130`, `fail 0`. The public-dashboard witnesses are `PASS
public-dashboard / offline-local-first (JS arm) — 9/9` and `PASS
public-dashboard / headless — 6/6`; both used the explicitly configured binary
stamped at `f446d966b` and reported the expected checkout stamp mismatch. The
offline report records `cleanupErrors: []`, including the now-awaited client
teardown.

The symbol registry and its 57 Markdown projections were regenerated, followed
by the guide manifest and flat projections without running the diagnostics
generator. `node scripts/generate-symbol-registry.mjs --check` reports `56
modules, 1455 symbols, runtime parity exact`. `node scripts/check-guide.mjs`
reports `21 passed, 1 failed, 0 skipped, 0 preconditions; 157 pages, 1872
snippets, 174 routes + 51 host-ops joined, 94 warnings`; the sole accepted red
is the deliberately unregenerated diagnostics registry and Markdown
projection. The affected-scope LLP audit found the implementation aligned with
LLP 0043's enqueue-only cached evidence and final replay fact-read rules, LLP
0218's pre-transport drain fence, LLP 0166's writer-owned compare-and-commit,
and LLP 0090's close/relaunch acceptance claim; no LLP edit or new decision is
needed. `./ref-check --verbose` reports `311 LLP docs, 6641 refs in 12503
files, 0 errors, 0 unchecked`; `git diff --check` produces no output.

### Round-11 review closure (2026-08-25)

The client now enforces the **pinned-target rule** for every foreground
mutation and replay cycle. It captures one immutable normalized transport base
URL and canonical origin before capability inspection, then completes that
operation target with the positive fact's target profile and artifact
generation. Inspection, fact recording, enqueue admission, operation-identity
range issuance, request signing, and mutation transport use that same target.
The transport-start fence compares the client's current target with the pin
and surfaces `SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED` before `fetch` if the
client was repointed. Foreground pre-dispatch custody for the old target is
retired; replay custody remains pending; neither path sends a POST to the
successor origin.

Replay now acquires the authorization-dispatch lock and re-reads the shared
capability fact immediately before refreshing an uncovered record's operation
identity range. A peer negative therefore starts zero range POSTs. The final
replay fact read also precedes the dispatched form of
`outboxPrepareSubmission`, so a capability-refused replay is not stamped as
dispatched. The stale capability compare assertion now lives in
`exerciseOutboxContract`, covering memory, IndexedDB, SQLite, and file stores
instead of only the memory carrier.

Round-11 fail-first evidence from the four production regressions:

- foreground target repoint: `AssertionError [ERR_ASSERTION]: Missing expected
  rejection.`;
- replay supersession stamp: `AssertionError [ERR_ASSERTION]: a
  capability-refused replay is never stamped as dispatched` (actual timestamp,
  expected `null`);
- replay target repoint: `AssertionError [ERR_ASSERTION]: the refused replay
  issues no POST to target B`, `1 !== 0`;
- replay range currency: `AssertionError [ERR_ASSERTION]: a peer negative
  prevents identity-range transport`, `1 !== 0`.

Round-11 recorded a combined client/conformance result of `tests 132`, `pass
132`, `fail 0`, but its file writer-election fixture was nondeterministic.
Round 12 supersedes that single-run evidence with a deterministic fixture and
the required ten complete outbox runs below. The public-dashboard witnesses are `PASS
public-dashboard / offline-local-first (JS arm) — 9/9` and `PASS
public-dashboard / headless — 6/6`; both used the explicitly configured binary
stamped at `f446d966b` and reported the expected checkout stamp mismatch.
`node scripts/generate-symbol-registry.mjs --check` reports
`[symbol-registry] ok — 56 modules, 1455 symbols, runtime parity exact`.

The diagnostics registry JSON, diagnostics Markdown, and generated diagnostic
code union were restored to exact merge-base bytes; the diagnostics generator
was not retained as part of the final projection pass. The lane's real public
`whenOfflineMutationReplayCapabilitySettled()` export still requires the
symbol registry and its 57 Markdown projections, followed by the guide
manifest and flat projections, so those were regenerated from the restored
diagnostic bytes. Integration remains responsible for the final diagnostics
emitting-site regeneration.
`./ref-check --verbose` reports `311 LLP docs, 6642 refs in 12503 files, 0
errors, 0 unchecked`; `git diff --check` produces no output.

### Round-12 review closure (2026-08-25)

Every newly enqueued durable record now uses additive outbox record schema v2
and persists the enqueue target's canonical origin, target profile, and
artifact identity. Generated references persist the complete call-time
generation; string-named references persist the application identity from the
served descriptor/binding. Replay compares all persisted axes with its fresh
pinned target before queue reconciliation, range issuance, dispatch stamping,
or mutation transport. A mismatch emits
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH`; a pre-v2 targetless record emits the
distinct `SNAPBACK_OUTBOX_REPLAY_TARGET_MISSING`. Both remain pending and send
zero mutation POSTs.

The existing sidecar-adoption surface does not authorize replacing or waiving
that persisted target. Its cross-target case now stops pending with zero POSTs;
`issues/20260825-outbox-target-adoption-protocol.md` tracks the separate design
needed for an explicit adoption authority. No adoption protocol is introduced
in this round.

The file writer/follower ordering fixture now awaits the intended writer's
lock before opening the follower, matching the established file-store pattern.
Fail-first evidence for the persisted-target regressions was:

- cross-target relaunch: `AssertionError [ERR_ASSERTION]: target A intent is
  not replayed by target B`, `1 !== 0`;
- same-origin app replacement: `AssertionError [ERR_ASSERTION]: app A intent
  is not replayed by app B`, `1 !== 0`;
- matching relaunch/schema persistence: `AssertionError [ERR_ASSERTION]:
  Expected values to be strictly equal:`, `undefined !== 2`;
- legacy targetless record: `AssertionError [ERR_ASSERTION]: targetless legacy
  intent is never replayed`, `1 !== 0`.

The exact required ten-run command produced:

```text
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
ℹ pass 127
ℹ fail 0
```

`authority-transition-conformance.test.mjs` reports `tests 9`, `pass 9`,
`fail 0`. The public-dashboard witnesses report `PASS public-dashboard /
offline-local-first (JS arm) — 9/9` and `PASS public-dashboard / headless —
6/6`; both used the explicitly configured binary stamped at `a97e75286` and
reported the expected checkout stamp mismatch. The symbol check reports
`[symbol-registry] ok — 56 modules, 1455 symbols, runtime parity exact`.
`./ref-check --verbose` reports `311 LLP docs, 6645 refs in 12504 files, 0
errors, 0 unchecked`; `git diff --check` produces no output. The diagnostics
registry, its Markdown projection, and the generated diagnostic-code union
were not regenerated. Integration regeneration will add
`SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED`,
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH`, and
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISSING` to the union from their ordinary
literal `diagnosticError(...)` emitting sites.

### Round-13 review closure (2026-08-25)

Replay no longer treats the first `outboxPending()` snapshot as complete. Each
prepared record is validated against the pinned replay target while the
authorization-dispatch fence is held, before custody reconciliation,
operation-identity range issuance, dispatch stamping, or mutation transport.
A target-A record inserted before the second pending snapshot of a target-B
drain therefore pauses as pending with no POST, after the two target-B records
replay normally. Custody reconciliation can reuse an already-owned dispatch
interval so this ordering does not recursively acquire the store lock.

The round-9 all-non-read redirect posture is superseded. Manual redirect
refusal now covers explicit effect-producing routes, capability inspection,
and requests carrying bearer/admin/session/lease or other secret-classified
credentials. Credential-free ordinary query POSTs again retain the platform's
redirect behavior, including existing proxy and trailing-slash rewrites.
Inspection, foreground mutation, replay, and the real-server bearer/admin
coverage remain redirect-terminal. The public-dashboard pending-intent
bystander now closes its client rather than only its exposed store.

The watched pre-fix regressions failed together with:

```text
✖ credential-free query POSTs retain ordinary redirect behavior
Error [SnapbackDiagnosticError]: SNAPBACK_REDIRECT_REFUSED: redirects on credential-carrying or effect-producing requests are terminal
✖ a cross-target record injected into the second pending snapshot stays pending
AssertionError [ERR_ASSERTION]: the target-B records replay normally
3 !== 2
ℹ pass 0
ℹ fail 2
```

The exact required five-run command produced:

```text
ℹ pass 128
ℹ fail 0
ℹ pass 128
ℹ fail 0
ℹ pass 128
ℹ fail 0
ℹ pass 128
ℹ fail 0
ℹ pass 128
ℹ fail 0
```

`authority-transition-conformance.test.mjs` reports `tests 9`, `pass 9`,
`fail 0`. The focused redirect/per-record run reports `tests 5`, `pass 5`,
`fail 0`; `app-data.test.mjs` also reports its façade redirect-terminal and
credential-free redirect coverage passing. The public-dashboard witnesses
report `PASS public-dashboard / offline-local-first (JS arm) — 9/9` and
`PASS public-dashboard / headless — 6/6`, with `cleanupErrors: []` in both
machine-readable reports. Both used the explicitly configured binary stamped
at `a97e75286` and reported the expected checkout stamp mismatch.

The first symbol-registry check found the projections stale after the client
line changes. `node scripts/generate-symbol-registry.mjs` refreshed its 57
Markdown projections, and the required check then reports `[symbol-registry]
ok — 56 modules, 1455 symbols, runtime parity exact`. The guide manifest and
flat projections were refreshed through the guide library without invoking
the diagnostics generator; `check-guide` therefore returns to the accepted
single diagnostics-registry red (`21 passed, 1 failed`).
`./ref-check --verbose` reports `311 LLP docs, 6645 refs in 12504 files, 0
errors, 0 unchecked`; `git diff --check` produces no output. The diagnostics
registry, its Markdown projection, and the generated diagnostic-code union
remain byte-identical to round-12 HEAD and were not regenerated.

### Round-14 review closure (2026-08-25)

Cached capability reuse for a string-named mutation now requires the client to
have an established application id and the cached served artifact generation
to carry that same app id. A same-origin app-B client therefore rejects app-A
cached evidence, makes the ordinary online-only mutation attempt, and persists
no outbox record. An unbound client and a capability manifest with no artifact
identity also remain online-only. Generated references continue to compare
their complete call-time generation.

The initial replay snapshot is no longer rejected as a whole. Target binding
is checked in sequence at each record's submission boundary, so a valid
target-B prefix settles before the first target-A record pauses replay; that
record and every ordered successor remain pending with
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH`. The configured capability shortcut
now carries an adjacent comment recording that it is an undeclared test seam,
not production replay authority.

The public-dashboard offline witness now derives generation-bound Online-class
mutation references from its generated app descriptor. This establishes the
application identity needed by the fresh offline client without invoking a
private seam or opting the JS-arm witness into the separately owned local
optimistic-projection claim.

The watched pre-fix regressions failed together with:

```text
✖ an initial mixed-target snapshot replays its valid prefix before pausing
AssertionError [ERR_ASSERTION]: the valid target-B prefix replays
0 !== 2
✖ automatic string-named enqueue refuses cached support from a replaced same-origin app
AssertionError [ERR_ASSERTION]: Missing expected rejection.
ℹ pass 0
ℹ fail 2
```

The exact required five-run command produced:

```text
ℹ pass 130
ℹ fail 0
ℹ pass 130
ℹ fail 0
ℹ pass 130
ℹ fail 0
ℹ pass 130
ℹ fail 0
ℹ pass 130
ℹ fail 0
```

`authority-transition-conformance.test.mjs` reports `tests 9`, `pass 9`,
`fail 0`. The public-dashboard witnesses report `PASS public-dashboard /
offline-local-first (JS arm) — 9/9` and `PASS public-dashboard / headless —
6/6`, with `cleanupErrors: []` in both machine-readable reports. Both used the
explicitly configured binary stamped at `a97e75286` and reported the expected
checkout stamp mismatch.

`node scripts/generate-symbol-registry.mjs --check` reports
`[symbol-registry] ok — 56 modules, 1455 symbols, runtime parity exact`.
`./ref-check --verbose` reports `311 LLP docs, 6645 refs in 12504 files, 0
errors, 0 unchecked`; `git diff --check` produces no output. The symbol
registry, 57 reference pages, Guide manifest, and flat projections were
refreshed without invoking the diagnostics generator. The diagnostics registry
JSON, diagnostics Markdown, and generated diagnostic-code union remain
byte-identical to round-13 HEAD and were not regenerated. The additional
`node scripts/check-guide.mjs` run reports `21 passed, 1 failed, 0 skipped, 0
preconditions; 157 pages, 1872 snippets, 174 routes + 51 host-ops joined, 94
warnings`; its sole red is those deliberately stale diagnostics projections.

### Round-15 review closure (2026-08-25)

Replay now revalidates the shared capability fact and the exact record's
persisted enqueue target while holding the authorization-dispatch fence,
before any custody write. Custody reconciliation is record-scoped across the
memory, IndexedDB, SQLite, and file store arms; a valid target-B prefix may
therefore settle without deleting or stranding a later session-fenced target-A
record. The first mismatch stays byte-identical and pending, emits
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH`, and sends no mutation POST.
`adoptQueuedMutations()` no longer performs an earlier whole-queue custody
write; its first custody mutation is delegated to the same ordered replay
fence. Store-contract coverage proves an unselected record remains
byte-identical under scoped reconciliation, and public regressions cover both
ordinary replay and sidecar adoption after an authority-instance rotation.

The pre-fix regression produced:

```text
✖ session-fenced target mismatch precedes authority-instance custody reconciliation
AssertionError [ERR_ASSERTION]: the target-A record pauses the target-B drain
false !== true
```

The exact required five-run command produced:

```text
ℹ pass 132
ℹ fail 0
ℹ pass 132
ℹ fail 0
ℹ pass 132
ℹ fail 0
ℹ pass 132
ℹ fail 0
ℹ pass 132
ℹ fail 0
```

`authority-transition-conformance.test.mjs` reports `tests 9`, `pass 9`,
`fail 0`. The public-dashboard witnesses report `PASS public-dashboard /
offline-local-first (JS arm) — 9/9` and `PASS public-dashboard / headless —
6/6`, with `cleanupErrors: []` in both machine-readable reports. Both used the
explicitly configured binary stamped at `a97e75286` while the checkout was
`449725250`, and reported the expected checkout stamp mismatch.

`./ref-check --verbose` reports `311 LLP docs, 6646 refs in 12504 files, 0
errors, 0 unchecked`; `git diff --check` produces no output.
`node scripts/generate-symbol-registry.mjs --check` reports
`[symbol-registry] ok — 56 modules, 1455 symbols, runtime parity exact`. The
symbol registry, 57 reference pages, Guide manifest, and flat projections were
refreshed without invoking the diagnostics generator. `node
scripts/check-guide.mjs` reports `21 passed, 1 failed, 0 skipped, 0
preconditions; 157 pages, 1872 snippets, 174 routes + 51 host-ops joined, 94
warnings`; its sole red is the deliberately stale diagnostics projection. The
diagnostics registry JSON, diagnostics Markdown, and generated diagnostic-code
union were not regenerated and remain byte-identical to round-14 HEAD.

### Round-18 review closure (2026-08-25)

The post-round-15 client work adds four bounded pieces without broadening the
acceptance claim. First, `ledgerIncarnation` is additive client plumbing: when
an inspection supplies a non-empty value, the capability fact and v2 enqueue
target persist it and replay/projection compare it. Either-side absence remains
fail-open, so the open public-inspect ticket still owns real reset coverage; the
public server used below does not prove reset-incarnation fencing.

Second, capability replacement and mutation dispatch use the store's shared
authorization-dispatch serialization cut. Third, optimistic and settlement
projection now requires a persisted enqueue target plus the client's complete
current profile/artifact generation; targetless legacy records, cross-origin
records, replaced apps, and the same app at a different generation remain in
store custody but do not project as current. `subscribeMutation()` compares the
complete observable disposition, so a capability replacement that changes
`targetMatchesCurrent` is published even while durable status remains
`pending`.

Finally, an answered negative inspection is authoritative to its observing
client even when shared-store replacement returns `false`. The local negative
override is retained, `queue: 'auto'` rejects with
`SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`, and the bound-client
regressions prove zero mutation POSTs and zero new outbox records. A prior
positive is reusable only after a genuine no-response connectivity failure and
only for enqueue-only custody, never for an online mutation POST or replay.

The required answered-negative regression failed before the implementation:

```text
✖ a rejected answered-negative capability commit fails bound mutation admission closed (18.305083ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

At implementation commit
`7df109ff588a0671431dd4594f5f14917eb7a71e`, the focused outbox suite reports:

```text
ℹ tests 141
ℹ suites 0
ℹ pass 141
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1604.034208
```

The generated-mutation, generated-optimistic, custody, and drain compatibility
run reports `tests 64`, `pass 64`, `fail 0`; its strict TypeScript fixture
command also exits zero. The package-wide script does not receive a green
claim: it stops on the repeatable, out-of-scope
`pre-subscribe durable-buffer overflow fails closed to one fresh snapshot
[web/indexeddb]` RQS assertion (`tests 30`, `pass 29`, `fail 1` in that file).
That path is outside this outbox delta.

Both required public-dashboard witnesses were rerun at the same implementation
commit and report these verbatim summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. They used the explicitly requested binary stamped at
`a97e75286f098066931701df515fe7a812961798`, so both also reported the expected
checkout/binary stamp mismatch; these runs prove the named JS-arm behavior,
not a same-commit server-binary qualification.

### Round-19 review closure (2026-08-25)

Round 19 corrects round 18's over-broad fail-closed admission. For default
`queue: 'auto'`, an answered capability gap or a non-cached inspection failure
now makes one ordinary online-only mutation POST and creates no outbox record.
An answered negative remains the observing client's local override even when
its shared-store commit returns `false`; a later no-response inspection still
cannot resurrect the rejected shared positive. Explicit `queue: true` keeps
the typed settlement-ledger refusal, cached positive evidence remains
enqueue-only with no speculative POST from a non-writer, and replay still
requires a fresh positive inspection.

Settlement ACK obligations now persist the v2 record's enqueue target.
Standalone acknowledgement selects its exact target cohort while holding the
shared authorization-dispatch fence, and both standalone confirmation and
mutation piggyback selection/confirmation filter by that persisted target.
After an A-to-B repoint, target B receives no target-A ACK and target A's local
settlement recovery record plus ACK obligation survive. The sync guide's
offline example is again a verbatim transclusion of the positive-inspect then
failed-mutation transport fixture.

The five watched regressions failed before the production fix with these
verbatim lines:

```text
✖ settlement ACK obligations persist the record enqueue target (2.0765ms)
✖ queue:'auto' uses online-only dispatch for a ledger-less target and cached-evidence non-writers fail without POST (13.829542ms)
✖ a rejected answered-negative capability commit keeps bound mutation admission online-only (3.059208ms)
✖ standalone ACK never crosses the persisted enqueue target after client repoint (2.177917ms)
✖ piggyback ACK never crosses the persisted enqueue target after client repoint (3.304667ms)
ℹ tests 5
ℹ pass 0
ℹ fail 5
```

The persistence assertion saw `undefined` instead of the enqueue target. The
two auto-admission cases threw
`SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`. The standalone case sent
the target-A id to
`https://standalone-ack-target-b.example/client-mutations/acknowledge`, and the
piggyback body carried `['cm-piggyback-ack-target-a']` instead of omitting the
field.

At the final JS implementation commit
`0c6abbb75dc677928fabc7ef56daddf17c98da60`, the focused suite reports:

```text
ℹ tests 144
ℹ suites 0
ℹ pass 144
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1596.6155
```

The package-wide `npm test --prefix packages/snapback-client` script again
stops only on the already-recorded, out-of-scope RQS assertion:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (9.781625ms)
ℹ tests 30
ℹ pass 29
ℹ fail 1
```

The strict TypeScript fixture command was run separately after that stop and
exits zero. The same RQS assertion also reproduces on the native/file and
memory arms, so commands sequenced after those failures are not claimed as
part of the package script.

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and prove the JS lane rather than a
same-commit server binary.

`node scripts/check-guide.mjs` reports the following verbatim final summary:

```text
[guide-check] FAILED — 18 passed, 4 failed, 0 skipped, 0 preconditions; 157 pages, 1871 snippets, 174 routes + 51 host-ops joined, 96 warnings
```

Every remaining failure is an integration-owned generated projection:
diagnostics registry, symbol registry, Guide manifest/MCP projection, and flat
guides. The source snippet transclusion and capability/surface joins pass. The
expired `backend.structured-stored-fields` review was evidence-audited without
changing its claim and moved to 2026-09-30 in its owning open ticket.

`./ref-check --verbose` reports `311 LLP docs, 6647 refs in 12505 files, 0
errors, 0 unchecked`. `git diff --check` produces no output.

No claim is made that `node scripts/generate-symbol-registry.mjs --check` is
green at this HEAD. `packages/snapback-client/index.d.mts` gained
`whenOfflineMutationReplayCapabilitySettled()` earlier in this lane, and the
symbol registry, reference pages, Guide manifest, and flat projections remain
at merge-base bytes for the landing script to regenerate at integration.

### Round-20 dual-review closure (2026-08-25)

String-named mutations now persist the complete served artifact generation
alongside their application compatibility key. Replay and optimistic/settled
projection compare that generation, so redeploying the same app id with new
schema, bundle, or inputs bytes pauses the predecessor record with
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH`, leaves it pending, and sends no
mutation POST under the successor generation.

Legacy targetless records are no longer ACK-eligible. Standalone and
piggyback selection fail closed until the explicit adoption protocol in
`issues/20260825-outbox-target-adoption-protocol.md` exists, matching replay's
existing `SNAPBACK_OUTBOX_REPLAY_TARGET_MISSING` posture. Standalone ACK also
drops caller-supplied ids absent from local recovery state instead of sending
them to whichever origin is current. The foreground settlement fallback fence
is now mutate-scoped, so a null preparation fence cannot become a block-scope
`ReferenceError` after a committed server effect. The unrelated
`backend.structured-stored-fields` GAP review-date change and ticket appendix
were removed from this lane; both files match their merge-base bytes.

The three watched regressions failed before the production fix with these
verbatim lines:

```text
✖ same-origin same-app generation replacement refuses string-named persisted intent before POST (20.784ms)
✖ legacy targetless standalone ACK never crosses origin after client repoint (3.247208ms)
✖ standalone ACK drops caller ids with no local recovery record (0.880291ms)
ℹ tests 3
ℹ pass 0
ℹ fail 3
```

The first case observed `replayed: 1` instead of zero. Each ACK case observed
`{ acknowledged: 1 }` instead of `{ acknowledged: 0 }`.

At the final JS implementation commit
`6be424e15fb00fd20114411f082d1a4980f084c6`, the focused outbox suite reports:

```text
ℹ tests 147
ℹ suites 0
ℹ pass 147
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2012.328875
```

The full `npm test --prefix packages/snapback-client` script again stops on
the already-recorded, out-of-scope RQS assertion:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (10.1905ms)
ℹ tests 30
ℹ pass 29
ℹ fail 1
```

The strict TypeScript fixture command was run separately after that stop and
exits zero. Commands sequenced after the RQS failure in the package script are
not claimed from that invocation.

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and prove the JS lane rather than a
same-commit server binary.

`./ref-check --verbose` reports `311 LLP docs, 6647 refs in 12505 files, 0
errors, 0 unchecked`. `git diff --check` produces no output, and
`git diff $(git merge-base HEAD origin/main) -- guide/capabilities.md
issues/20260727-backend-bakeoff-improvement-program.md` is empty.

No generated projection check is claimed green at this HEAD. Integration owns
the requested projection regeneration.

### Round-21 dual-review closure (2026-08-25)

Fresh positive replay capability now mints and durably enqueues one
`clientMutationId` before any mutation POST, even when the caller supplied no
id and generated presentation is disabled. A response lost after an applied
POST therefore leaves the same identity for replay. Positive capability facts
whose IndexedDB compare-and-swap did not commit are classified as
`uncommitted` and take the same enqueue-only, zero-POST path as cached facts.

Standalone acknowledgement establishes target eligibility before custody
reconciliation and limits that reconciliation to eligible record ids. The
same target-first rule now covers stranded read/discard/re-record, quarantine
re-entry, and both mutation authority-unsettled recovery handlers;
`strandedMutations()` performs no reconciliation. Through those named client
APIs, a target-B client cannot strand, privacy-delete, re-enter, re-record,
discard, or acknowledge a target-A record under B's authority. This makes no
broader claim about arbitrary direct store operations.

Cross-target and legacy targetless adoption remain unimplemented. The checked
sidecar API returns a typed retained pause naming
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH` or
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISSING`, while the Guide points to
`issues/20260825-outbox-target-adoption-protocol.md`. That ticket now owns the
upgrade-while-offline legacy migration and the independent adoption-authority
proof. The deprecated `stopped` field remains for public API compatibility;
callers use the new discriminated `outcome` for the pause reason and retained
count.

The watched regressions failed before the production fix with these verbatim
lines:

```text
✖ an uncommitted positive capability fact is enqueue-only for an IndexedDB follower (21.381167ms)
✖ fresh automatic queue reuses one pre-POST identity after an applied response is lost (4.637417ms)
✖ checked sidecar adoption cannot bypass persisted target without target adoption (3.118042ms)
✖ sidecar adoption target mismatch precedes authority-instance custody reconciliation (12.106166ms)
✖ sidecar adoption keeps identity-divergent intent pending for rollback (1.524625ms)
✖ foreign-target standalone ACK never reconciles that record under a different authority (3.963125ms)
ℹ tests 6
ℹ suites 0
ℹ pass 0
ℹ fail 6
```

The uncommitted-positive case incorrectly reached transport; the fresh
response-loss case recorded no foreground id and replayed a different id; the
foreign-target ACK changed the target-A record from pending to stranded. The
three adoption receipt cases still exposed only the old bare stop.

At the final JS implementation commit
`919bf869a7e614b3485bdc73ef917fefdc3a187a`, the focused outbox suite reports:

```text
ℹ tests 151
ℹ suites 0
ℹ pass 151
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1988.929417
```

The full `npm test --prefix packages/snapback-client` script reaches the
already-recorded, out-of-scope RQS assertion after the outbox and custody
suites pass 151/151 and 18/18:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (9.642125ms)
ℹ tests 30
ℹ suites 0
ℹ pass 29
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2565.705542
```

The strict TypeScript fixture command was run separately after that stop and
exits zero. Commands sequenced after the RQS failure in the package script are
not claimed from that invocation.

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and prove the JS lane rather than a
same-commit server binary.

`node scripts/check-guide.mjs` reports the following verbatim final summary:

```text
[guide-check] FAILED — 18 passed, 4 failed, 0 skipped, 0 preconditions; 157 pages, 1871 snippets, 174 routes + 51 host-ops joined, 96 warnings
```

Every remaining failure is an integration-owned generated projection:
diagnostics registry, symbol registry, Guide manifest/MCP projection, and flat
guides. Snippet transclusions and capability/surface joins pass. The expired
`backend.structured-stored-fields` review was evidence-audited without changing
its claim and now names the owning ticket's 2026-09-30 review.

`./ref-check --verbose` reports `311 LLP docs, 6647 refs in 12505 files, 0
errors, 0 unchecked`. `git diff --check` produces no output. All generated
projection paths remain byte-identical to merge base
`baacaa20983f029f3e9cd23f60385ba00085e947`; integration owns regeneration.

### Round-22 dual-review closure (2026-08-25)

Every client custody reconciliation is now record-scoped after the persisted
target fence. Stranded observation is a read over already-stranded
current-target rows; discard, re-record, quarantine re-entry, replay, ACK, and
the two mutation authority-unsettled handlers admit exact record ids before
custody can change. Quarantined payloads remain private: the four store arms
provide a narrow id/schema/enqueue-target view solely for client target
filtering while the public projection remains the existing redacted tombstone.

Standalone ACK now obtains fresh `/inspect` evidence bound to its pinned
transport target before custody or POST, then rechecks that shared fact under
the authorization-dispatch lock. A same-origin successor generation cannot
send or collect its predecessor's ACK. Durable injected stores must implement
the shared capability reservation/read/commit contract; otherwise the client
refuses with `SNAPBACK_OFFLINE_QUEUE_CAPABILITY_STORE_INCAPABLE` before
transport. The `RqsResumeStore` declaration makes those methods mandatory.

The watched regressions failed before the production fix with these verbatim
lines across the fail-first invocations:

```text
▶ shared-store recovery APIs never reconcile foreign-target custody
  ✖ stranded-read (22.855667ms)
  ✖ stranded-discard (4.87075ms)
  ✖ stranded-rerecord (4.191ms)
  ✖ quarantine-reentry (4.629208ms)
✖ shared-store recovery APIs never reconcile foreign-target custody (37.444667ms)
✖ operation-range authority-unsettled recovery is scoped to the current target record (29.036208ms)
✖ mutation transport authority-unsettled recovery is scoped to the current target record (6.655625ms)
✖ standalone ACK refreshes same-origin generation evidence before custody or POST (3.854834ms)
✖ durable injected stores without shared capability evidence methods refuse before peer-stale ACK (2.844041ms)
```

At the final JS implementation commit
`2872bf678617030451e047091200f5bfb2971a96`, the focused outbox suite reports:

```text
ℹ tests 160
ℹ suites 0
ℹ pass 160
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1671.334667
```

The full `npm test --prefix packages/snapback-client` script reaches only the
already-recorded, out-of-scope RQS assertion after the affected outbox,
custody, and quarantine suites pass 160/160, 18/18, and 4/4:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (10.789167ms)
ℹ tests 30
ℹ suites 0
ℹ pass 29
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2565.6325
```

The strict client TypeScript fixture command exits zero. The export-types gate
compiles all 121 fixtures and retains only its inherited codegen red:

```text
[check-package-export-types] fixture compile ok: 121 subpaths across 14 packages
[check-package-export-types] FAILED (1):
  - @expo/snapback-codegen ./app-descriptor: runtime exports missing from the declaration: APPLICATION_AUTH_BOOTSTRAP_CREDENTIAL_MODES, APPLICATION_AUTH_BOOTSTRAP_PROVIDERS, APPLICATION_AUTH_BOOTSTRAP_PROVIDER_KINDS
```

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and prove the JS lane rather than a
same-commit server binary.

The lane-carried `backend.structured-stored-fields` review-date and ticket
disposition changes were reverted to merge-base bytes; the final scoped diff
for `guide/capabilities.md` and
`issues/20260727-backend-bakeoff-improvement-program.md` is empty.
`./ref-check --verbose` reports `311 LLP docs, 6647 refs in 12505 files, 0
errors, 0 unchecked`. `git diff --check` produces no output. All generated
projection paths remain byte-identical to merge base
`baacaa20983f029f3e9cd23f60385ba00085e947`.

### Round-23 dual-review closure (2026-08-25)

Round 23 replaced the remaining per-method target checks with one shared
client selection boundary. `#withTargetFencedOutboxRecords` acquires (or
requires existing ownership of) the shared authorization-dispatch lock,
re-reads local records, requires schema-v2 `enqueueTarget`, requires the
complete current projection/operation target, and delegates equality to
`outboxRecordMatchesAcknowledgementTarget`. Missing, foreign, targetless, and
legacy ids are no-ops recorded as `SNAPBACK_OUTBOX_TARGET_FENCE_REFUSED` with
`record-not-local`, `enqueue-target-missing`, `current-target-incomplete`, or
`enqueue-target-mismatch`.

The systemic client API inventory is:

| Client API / entry point | ID/filter admitted to work | Target fence | Lock ownership |
| --- | --- | --- | --- |
| `outboxStatus()` | all locally retained current-target records | shared projection fence | shared authorization-dispatch lock |
| `#outboxHeadFact()` | all current-target diagnostic head candidates | read-only projection fence | callback may inherit foreground ownership; this path performs no record transition |
| `mutationStatus(id)` / `subscribeMutation(id)` | exact locally present caller id | shared projection fence; foreign/legacy is `unknown` | shared authorization-dispatch lock per observation |
| `createOptimisticMutationView()` / `__createOptimisticRebaseEngine()` | all current-target optimistic layers | read-only projection fence | callback may inherit foreground ownership; this path performs no record transition |
| `__optimisticMutationDisposition(id)` | one exact retained current-target layer id | shared projection fence | acquires the shared lock, or borrows a tracked read lease until the owning foreground cut releases |
| `acknowledgeMutations({ clientMutationIds })` | exact local ids surviving cohort and post-custody re-read | fresh complete ACK target plus exact persisted enqueue target | held through scoped custody, ACK POST, and exact-target confirmation |
| `acknowledgeResultGoneMutations(ids)` | exact local `result-gone` ids | shared projection fence | held through each discard |
| `quarantinedMutations()` | redacted quarantine rows whose private target metadata matches | shared projection fence | held through observation |
| `reenterQuarantinedMutations()` | current-target quarantine ids only | shared projection fence before scoped custody | held through custody and re-entry transition |
| `strandedMutations()` | current-target, rerecordable, current-principal rows | shared projection fence plus principal scope | held through observation |
| `discardStrandedMutations(ids)` | exact current-target, rerecordable, current-principal ids | shared projection fence plus principal scope | held through discard |
| `reRecordStrandedMutation(id)` | exact current-target, rerecordable predecessor; replacement is a new current-target id | shared projection fence at source read and predecessor cleanup | held independently through both predecessor cuts; replacement uses foreground custody |
| `settledMutations()` | current-target settlement cohort only | shared projection fence plus user/authority cohort | held through observation |
| `markMutationSettlementsConsumed(ids)` / store `markAcksReady` | exact current-target settled cohort, grouped by persisted enqueue target | shared projection fence; store transition requires the complete target | held through ACK-ready transition |
| `mutate(... acknowledgedClientMutationIds)` and automatic piggyback | locally present, ACK-ready ids excluding the mutation's own id | shared operation-target fence; re-evaluated immediately before mutation transport | held through final selection, mutation POST, and exact-target confirmation |
| `#reconcileQueueCustody()` / `#applyQueueCustodyReconciliation()` | target-fenced explicit record ids; an empty admitted set is a no-op | shared projection fence before any custody write | shared lock, or documented ownership inherited from replay/recovery/foreground |
| `replayQueuedMutations()` / terminal result-gone, stranded, quarantine, failure consumers | the ordered pending head after capability and exact persisted-target checks | shared operation-target fence plus replay binding error | held through scoped custody, range, POST, and durable terminal/settled transition |
| `adoptQueuedMutations()` | current-target rows in before/after counts; replay owns each admitted row | shared projection fence plus expected store/generation/fresh-snapshot checks | shared lock for counts; replay lock for mutation |
| foreground durable mutation, identity-range issuance, settlement and terminal consumers | the newly enqueued current-target record | shared operation-target fence after enqueue and again immediately before range transport | held from final capability/record validation through range assignment, then through mutation dispatch and durable disposition |

The table-driven shared-store regression exercises the complete inventory:
status and diagnostic-head reconstruction, per-id status and subscription,
optimistic projection/disposition, stranded read/discard/re-record, quarantine
read/re-entry, result-gone acknowledgement, settlement read/consumption,
standalone and explicit piggyback ACK selection, replay/terminal consumption,
sidecar adoption, and foreground range/disposition. Each row uses a foreign
target record and asserts byte-identical foreign custody plus zero transport;
the two current-intent rows invalidate their pinned target after enqueue so the
final authorization cut refuses before range or mutation transport. The peer-
negative foreground-range regression separately proves zero range requests.
The two authority-unsettled terminal handlers additionally retain focused
regressions.

The four named regressions failed before the production fix with these
verbatim lines:

```text
✖ foreground checks peer capability currency under the dispatch lock before range refresh
AssertionError: a peer negative prevents foreground identity-range transport
1 !== 0
✖ fresh direct manifest cannot durably admit a string-named mutation across same-app redeploy
AssertionError: Missing expected rejection.
✖ foreign-target result-gone acknowledgement is a coded no-op
actual { acknowledged: 1, clientMutationIds: ['cm-result-gone-ack-target-a'] }
expected { acknowledged: 0, clientMutationIds: [] }
✖ foreign-target settlement cannot cross the consumed acknowledgement cut
1 !== 0
```

The direct-manifest admission path now requires the schema and function
manifests to form one complete trusted artifact generation before a
string-named mutation can acquire durable custody. App id alone no longer
survives a same-app redeploy as queue authority. Foreground identity-range
issuance acquires the shared authorization-dispatch lock, revalidates shared
capability currency and the record target at the exact pre-request cut, and
keeps ownership through durable range assignment. The older range/root tests
now assert this serialized order rather than waiting cyclically on the lock.

At the final JS implementation commit
`3374d357c02631a449859560f3bf003f6a30e276`, the focused outbox suite reports:

```text
ℹ tests 178
ℹ suites 0
ℹ pass 178
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1746.618167
```

The full `npm test --prefix packages/snapback-client` script reaches only its
inherited, out-of-scope RQS assertion after the affected suites pass:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (10.339417ms)
ℹ tests 30
ℹ suites 0
ℹ pass 29
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2511.747292
```

The strict client TypeScript fixture command, run separately because the full
script stops at that inherited RQS red, exits zero. The export-types gate
compiles all 121 fixtures and retains only its inherited codegen declaration
red:

```text
[check-package-export-types] fixture compile ok: 121 subpaths across 14 packages
[check-package-export-types] FAILED (1):
  - @expo/snapback-codegen ./app-descriptor: runtime exports missing from the declaration: APPLICATION_AUTH_BOOTSTRAP_CREDENTIAL_MODES, APPLICATION_AUTH_BOOTSTRAP_PROVIDERS, APPLICATION_AUTH_BOOTSTRAP_PROVIDER_KINDS
```

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and exercise the JS lane.

`./ref-check --verbose` reports `311 LLP docs, 6648 refs in 12505 files, 0
errors, 0 unchecked`. `git diff --check` produces no output. The final scoped
diff for `guide/capabilities.md` and
`issues/20260727-backend-bakeoff-improvement-program.md` is empty relative to
merge base `baacaa20983f029f3e9cd23f60385ba00085e947`; integration retains ownership
of generated projection regeneration.

### Round-24 dual-review closure (2026-08-25)

The authority-transition privacy cut no longer depends on recovery-target
completeness. While the shared authorization-dispatch lock is held, it selects
schema-v2 records by their persisted canonical origin in the participating
store and applies predecessor/successor custody reconciliation even when the
current capability fact is missing, negative, or generation-less. Recovery
APIs retain their complete-current-target fence.

Optimistic refresh borrowing now carries an internally minted owner lease that
binds the client, authority instance, and exact async owner. A different client
sharing the store cannot borrow that scope and joins its authority transition
before reading. Settlement evidence already admitted by the exact owner is
cached for later canonical-delivery retirement, so a sibling foreground owner
does not require a second private-record read.

Positive replay evidence and schema-v2 enqueue now require a non-empty target
profile; a malformed advertising manifest refuses with the coded
`target-profile-required` reason. Replay treats a record removed before its
fenced re-read as a local no-op. Adoption receipts keep target-scoped
`before`/`after` counts but derive `remaining` and `outcome.retained` from the
payload-free total unresolved count, including a cross-target record that
paused the candidate.

The regressions failed before the production fix with these verbatim test and
assertion lines:

```text
✖ principal switch privacy deletion survives an incomplete current target fact
AssertionError [ERR_ASSERTION]: the successor authority observes no predecessor payload after an answered refusal
✖ an unrelated shared-store client cannot borrow predecessor dispatch custody
✖ offline replay advertisement without a target profile is a coded queue refusal
AssertionError [ERR_ASSERTION]: Missing expected rejection.
✖ replay treats a record removed before target selection as a stopped local no-op
actual { replayed: 0, remaining: 1, stopped: true }
expected { replayed: 0, remaining: 1, stopped: false }
✖ checked sidecar adoption cannot bypass persisted target without target adoption
0 !== 1
✖ checked sidecar adoption names a retained legacy targetless pause
✖ sidecar adoption target mismatch precedes authority-instance custody reconciliation
0 !== 1
```

At the final JS implementation commit
`f8762f8467c49580fc8dd62be8294948cf262ff3`, the required combined suite
reports:

```text
ℹ tests 209
ℹ suites 0
ℹ pass 209
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1853.682792
```

The full `npm test --prefix packages/snapback-client` script reaches only its
inherited, out-of-scope RQS assertion after the affected suites pass 180/180,
20/20, 22/22, and 4/4:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (13.989208ms)
ℹ tests 30
ℹ suites 0
ℹ pass 29
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2564.564792
```

The strict client TypeScript fixture command, run separately because the full
script stops at that inherited RQS red, exits zero.

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and exercise the JS lane.

`node scripts/check-guide.mjs` passes snippet transclusions, including the
updated adoption receipt snippet, and reports this verbatim final summary:

```text
[guide-check] FAILED — 17 passed, 5 failed, 0 skipped, 0 preconditions; 157 pages, 1871 snippets, 174 routes + 51 host-ops joined, 97 warnings
```

The remaining diagnostics-registry, symbol-registry, capability/surface join,
manifest/MCP, and flat-guide projection/corpus reds are integration-owned; the
generated projection files remain byte-identical to merge base
`baacaa20983f029f3e9cd23f60385ba00085e947`.

`./ref-check --verbose` reports `311 LLP docs, 6648 refs in 12505 files, 0
errors, 0 unchecked`. `git diff --check` produces no output.

### Round-25 dual-review closure (2026-08-25)

String-named schema-v2 replay derives a replay-only
`wireExpectedGeneration` from the complete served generation persisted in its
enqueue target and sends it as the mutation carrier's `expectedGeneration`.
The client also re-inspects and compares the served generation immediately
before POST. Sessions servers enforce the carried assertion at mutation time;
v0-dev does not. The public-dashboard offline-local-first 9/9 acceptance does
not cover this inspection-to-POST deployment race. The remaining server work
is tracked in `issues/20260825-v0-dev-mutation-generation-enforcement.md`.

The principal-privacy origin cut may delete targetless/pre-v2 ids only when a
default, non-injected store has recorded matching single-origin provenance.
Shared, injected, and unproven stores instead preserve the bytes in durable
predecessor-principal quarantine, invisible and inoperable to successor
principals until the explicit adoption protocol defines a disposition.
Authorization-dispatch borrowing now verifies that the supplied owner lease
was minted into the private `WeakSet`.

The reset bound remains unchanged: client-side `ledgerIncarnation` plumbing or
equality does not close `app.reset`. Reset quarantine is not fixed until the
served inspection fact contains `ledgerIncarnation` and the real reset/zero-
POST regression passes.

The regressions failed before the production fixes with these verbatim test and
assertion lines:

```text
✖ string-named replay carries its persisted generation across an inspect-to-POST deployment race
AssertionError [ERR_ASSERTION]: generation-one intent has no effect on generation two
1 !== 0
✖ principal switch privacy cut deletes targetless pre-v2 queued args
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+       secret: 'USER_A_PRE_V2_PRIVATE_ARGS'
- []
```

At the final JS implementation commit
`a6514fc9d42dc79e67fa0adeacb9849bea0ca9d8`, the required combined suite
reports:

```text
ℹ tests 210
ℹ suites 0
ℹ pass 210
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1757.391917
```

The full `npm test --prefix packages/snapback-client` script reaches only its
inherited, out-of-scope RQS assertion after the affected suites pass 181/181,
20/20, 22/22, and 4/4:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (9.661542ms)
ℹ tests 30
ℹ suites 0
ℹ pass 29
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2525.046042
```

The strict client TypeScript fixture command, run separately because the full
script stops at that inherited RQS red, exits zero.

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and exercise the JS lane.

`node scripts/check-guide.mjs` passes snippet transclusions and reports this
verbatim final summary:

```text
[guide-check] FAILED — 17 passed, 5 failed, 0 skipped, 0 preconditions; 157 pages, 1871 snippets, 174 routes + 51 host-ops joined, 97 warnings
```

The remaining diagnostics-registry, symbol-registry, capability/surface join,
manifest/MCP, and flat-guide projection/corpus reds are integration-owned; the
generated projection files remain byte-identical to merge base
`baacaa20983f029f3e9cd23f60385ba00085e947`.

`./ref-check --verbose` reports `311 LLP docs, 6648 refs in 12505 files, 0
errors, 0 unchecked`. `git diff --check` produces no output.

### Round-26 dual-review closure (2026-08-26)

Legacy targetless/pre-v2 intent now crosses a principal switch according to
durable store-origin provenance. A matching single-origin default store keeps
the privacy deletion rule and its coded count. Shared, injected, unproven, or
multi-origin stores instead retain the original private bytes in a durable
predecessor-principal quarantine; successor clients cannot project, replay,
ACK, recover, or adopt that marker. The adoption ticket now explicitly owns
its future authorized disposition.

Replay retains the complete persisted generation as wire
`expectedGeneration` and re-inspects the served generation immediately before
the POST. A difference pauses `SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH` before
the dispatch stamp and transport. Sessions servers also enforce the carried
generation against the invocation's manifest pair; v0-dev does not. The open
server-owned ticket
`issues/20260825-v0-dev-mutation-generation-enforcement.md` names
`crates/snapback-engine/src/local/engine.rs` function
`validate_expected_generation_against_manifests` and the required parity. The
public-dashboard 9/9 witness below does not cover this race.

Target-aware optimistic projection continues to fence every durable record.
The generated current-operation ledger is explicitly process-local and paints
without a replay-capability fact, including `offlineQueue: false`, fresh
clients, and profiles such as Cloudflare that cannot admit durable replay.

The reset bound remains open: client-side `ledgerIncarnation` equality does not
close `app.reset`. Reset quarantine is not fixed until public inspection serves
that field and the real reset/zero-POST regression passes.

The three fail-first regressions produced these verbatim lines before the
production fixes:

```text
✖ shared injected store quarantines foreign-origin targetless bytes on principal switch
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ []
- [
-   {
-     id: 'legacy-dev-pending',
-     refusalCode: 'SNAPBACK_OUTBOX_LEGACY_PRINCIPAL_QUARANTINED',
-     status: 'quarantined'
-   }
- ]
✖ string-named replay carries its persisted generation across an inspect-to-POST deployment race
AssertionError [ERR_ASSERTION]: generation-one intent has no effect on generation two
1 !== 0
✖ headless process-local generated mutations paint without durable replay facts
AssertionError [ERR_ASSERTION]: generated create paint did not become true
```

At the final JS implementation commit
`3cd15e6f3cb9b47bcee5d982c87d6f788673ae96`, the required combined suite
reports:

```text
ℹ tests 233
ℹ suites 0
ℹ pass 233
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7717.463709
```

The full `npm test --prefix packages/snapback-client` script reaches only its
inherited, out-of-scope RQS assertion after the affected suites pass 181/181,
21/21, 22/22, and 4/4:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (30.588209ms)
ℹ tests 30
ℹ suites 0
ℹ pass 29
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3055.071583
```

The strict client TypeScript fixture command, run separately because the full
script stops at that inherited RQS red, exits zero.

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and exercise the JS lane.

`node scripts/check-guide.mjs` passes snippet transclusions and reports this
verbatim final summary:

```text
[guide-check] FAILED — 17 passed, 5 failed, 0 skipped, 0 preconditions; 157 pages, 1871 snippets, 174 routes + 51 host-ops joined, 97 warnings
```

The remaining diagnostics-registry, symbol-registry, capability/surface join,
manifest/MCP, and flat-guide projection/corpus reds are integration-owned; the
generated projection files remain byte-identical to merge base
`baacaa20983f029f3e9cd23f60385ba00085e947`.

`./ref-check --verbose` reports `311 LLP docs, 6651 refs in 12506 files, 0
errors, 0 unchecked`. `git diff --check` produces no output.

### Round-27 dual-review closure (2026-08-26)

An answered failure from the immediate pre-POST replay inspection now pauses
the queue with retriable code
`SNAPBACK_OUTBOX_REPLAY_INSPECTION_UNAVAILABLE`. The current record remains
pending, replay breaks before the POST, and later records are not walked into
terminal failure. Standalone ACK now consumes the shared replay-capability fact
again while holding the authorization-dispatch lock and requires that fact to
remain the same current positive immediately before transport.

The injected-store declaration now carries the sixth `legacyPolicy` argument,
the `quarantined`/`quarantinedIds` reconciliation result, and the versioned
`supportsLegacyQuarantine: true` capability. Principal transition fails closed
with `SNAPBACK_OUTBOX_LEGACY_QUARANTINE_UNSUPPORTED` before reconciliation when
an injected store cannot prove that contract, preserving predecessor intent.

The three fail-first runtime regressions produced these verbatim lines before
the production fixes:

```text
✖ answered pre-POST inspection failure pauses the pending queue without failing records
AssertionError [ERR_ASSERTION]: the answered pre-POST failure is retriable, not terminal
2 !== 0
✖ standalone ACK rechecks a same-target positive after acquiring authorization dispatch
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected
  {
+   acknowledged: 1
-   acknowledged: 0
  }
✖ legacy-quarantine-incapable injected store refuses principal switch without deleting intent
AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

The type fixture also failed first with these verbatim diagnostics:

```text
packages/snapback-client/rqs-store-types.fixture.ts(8,12): error TS2339: Property 'outboxCapabilities' does not exist on type 'RqsResumeStore'.
packages/snapback-client/rqs-store-types.fixture.ts(18,5): error TS2554: Expected 5 arguments, but got 6.
packages/snapback-client/rqs-store-types.fixture.ts(24,40): error TS2339: Property 'quarantined' does not exist on type 'Readonly<{ deleted: number; deletedIds: readonly string[]; stranded: number; strandedIds: readonly string[]; }>'.
packages/snapback-client/rqs-store-types.fixture.ts(25,54): error TS2339: Property 'quarantinedIds' does not exist on type 'Readonly<{ deleted: number; deletedIds: readonly string[]; stranded: number; strandedIds: readonly string[]; }>'.
```

At the final JS implementation commit
`ce9feacf0494b7555482385e0addc70af5ff967d`, the required combined suite
reports:

```text
ℹ tests 236
ℹ suites 0
ℹ pass 236
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7780.996459
```

The full `npm test --prefix packages/snapback-client` script reaches only its
inherited, out-of-scope RQS assertion after the affected suites pass 183/183,
22/22, 22/22, and 4/4:

```text
✖ pre-subscribe durable-buffer overflow fails closed to one fresh snapshot [web/indexeddb] (10.14925ms)
ℹ tests 30
ℹ suites 0
ℹ pass 29
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2532.948083
```

The strict client TypeScript fixture command, including the new injected-store
contract fixture, exits zero when run separately because the full script stops
at that inherited RQS red.

The export-types gate reports its inherited codegen declaration red only:

```text
[check-package-export-types] fixture compile ok: 121 subpaths across 14 packages
[check-package-export-types] FAILED (1):
  - @expo/snapback-codegen ./app-descriptor: runtime exports missing from the declaration: APPLICATION_AUTH_BOOTSTRAP_CREDENTIAL_MODES, APPLICATION_AUTH_BOOTSTRAP_PROVIDERS, APPLICATION_AUTH_BOOTSTRAP_PROVIDER_KINDS
```

Both required public-dashboard witnesses were run at that exact JS commit with
`SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback"` and report these verbatim
summaries:

```text
PASS public-dashboard / offline-local-first (JS arm) — 9/9
PASS public-dashboard / headless — 6/6
```

Both machine-readable reports contain `cleanupErrors: []` and
`cleanupErrorCount: 0`. The configured binary is stamped at
`a97e75286f098066931701df515fe7a812961798`, so both runs report the expected
checkout/binary identity mismatch and exercise the JS lane.

`node scripts/check-guide.mjs` passes snippet transclusions and reports this
verbatim final summary:

```text
[guide-check] FAILED — 17 passed, 5 failed, 0 skipped, 0 preconditions; 157 pages, 1871 snippets, 174 routes + 51 host-ops joined, 137 warnings
```

The remaining diagnostics-registry, symbol-registry, capability/surface join,
manifest/MCP, and flat-guide projection/corpus reds are integration-owned; the
generated projection files remain byte-identical to merge base
`baacaa20983f029f3e9cd23f60385ba00085e947`.

`./ref-check --verbose` reports `311 LLP docs, 6651 refs in 12507 files, 0
errors, 0 unchecked`. `git diff --check` produces no output.
