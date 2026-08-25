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
