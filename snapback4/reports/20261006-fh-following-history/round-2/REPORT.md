# FH round 2 — server protocol and generated Following hook

2026-10-07 · base `8adc7879dd` · branch `sb4-intent/fh-following-history` ·
eb1000 (`expose-builder-pixel`) only. No push or publication. No other worktree
or host was used. Worktree disk is 20 GiB, below the 50 GB limit.

The authenticated server reader and generated `useFollowing` protocol are
implemented. Online history starts with the exact author merge; the inbox is
used for live prepend and the unchanged offline view. Sparse history no longer
ends at the copy window or loses continuation after scanning unrelated authors.
The public claim is a correct prefix of the frozen domain, bounded requests and
termination after obstructing post-bound backdated births/follow additions stop,
subject to session lifetime, admission and byte quotas. Oversized cards have
ordered named omissions. This is not a promise that every authored query shape
is eligible or every arbitrarily large frontier fits the quota.

## Implementation and ruling

- The author-delegated discovery ruling is in LLP 3000.026 §§9.4, 9.9 and the
  round-1 dispositions: post-bound follow churn checkpoints and returns
  `stalled`, then finishes against the frozen oracle when additions stop.
- `/following/<operation>` authenticates before its 64 KiB body allowance and
  rechecks the bearer under the engine lock. Registration, immutable units,
  `next`, replay, explicit restarts and stable refusal codes are SDK-owned.
  A separate `open` registration RPC admits custody; the first history unit
  returns a page immediately when discovery/shaping/checkpoint work fits.
  Lost unit replies replay their pinned bytes. A lost registration reply keeps
  its slot charged until expiry/reclaim; it does not silently reopen a unit.
- Card shaping uses ordinary authorized point reads. The reader remembers only
  disclosed card row/field identities for subsequent authority checks. Replay
  loads current policy inputs, not edited body fields, and never replaces a
  pinned image. Private-field revocation restarts replay and withdraws mounted
  cards. Births, unpublished heads, epochs and work counts stay off the wire.
- All seven request ceilings remain unchanged. Card evaluation gets a slice of
  those ceilings: 64 examinations, 128 index entries/probes, 32,768 steps,
  8 MiB temporary heap and 128 KiB card output. Object/map nodes, strings,
  capacities, witnesses and encoded copies are priced. Retained cards above
  1 MiB yield `E_FOLLOWING_ROW_TOO_LARGE`; fitting cards shorten a page at its
  consumed boundary. Page output is at most 256 KiB plus the bounded envelope.
- Four sessions per viewer/declaration, five-minute idle expiry, 32 MiB/session
  and 128 MiB/controller remain. No consumer evicts or advances another. The
  maintenance thread reclaims a bounded slice each second, under 1 MiB temporary
  heap; abandoned state stays charged until reclaimed.
- Codegen adds a `FollowingQuery` descriptor for a descending Following page
  of 1–100 events with one-for-one scalar/object projection and ordinary,
  non-expiring unique point reads. Maintained aggregates, independent scans,
  effectful/control-flow collectors and authored filters remain ordinary queries,
  with no exact-history binding or certificate. This is a Following protocol,
  not a general resumable query facility.
- `useFollowing` owns preparation polling, unit retries, restarts, event-ID
  deduplication, live prepend, mounted withdrawal and per-consumer cancellation.
  It reauthorizes mounted identities in bounded batches before publishing the
  composed list. Own-post and own-edge admission fences precede server results.
  Offline it uses the original inbox pager, preserves its read state and reports
  “older posts are not on this device”. No device traverses history heads.

The guide and separate history certificate were updated after the actual
route, shaped-card and SDK journeys passed. Existing inbox query IR and its
`scale` certificate object are unchanged. `check --json` gains a separate
`followingHistory` entry and text cost reports gain a separate history line.
LLP 3000.016 links the implemented online/offline split; LLP 3000.026 §9.10
records the concrete protocol and its scope.

## Verification

**The full script completed in 2,684 s, exit 1.** All 1,014 native executions,
324 client files and both full-count models ran. The log records three failing
native targets and two failing client files; all introduced failures were
corrected and pass their final affected reruns. A pre-existing native witness
inspection failure also passes its isolated and whole-target reruns. This is
not a zero-failure full-script receipt.
[full-suite-qualified.log](full-suite-qualified.log); commands in [WORK.md](WORK.md).

| Captured failure | Final disposition |
|---|---|
| Guide size/outline checks | Preserve the existing budgets and heading inventory; all 112 guide tests pass. |
| Frozen TypeScript comparison | Validate and strip only the new SDK binding; underlying schema check is unchanged and passes. |
| Delivery await boundary | Classify the new read-only awaits; all 339 fault cases pass without changing delivery recipes. |
| Public API examples | Add the `useFollowing` example and its typed fixture; all eight tests pass. |
| Native witness SIGINT cleanup | Unchanged `/proc` inspection refusal, already tracked; exact rerun passes in 1.00 s and all 318 CLI tests pass in 37.23 s, four ignored. |

The original client pool reports 6,448 passes, two failures and 48 explicit
skips; both failed files pass the reruns above. The two full-count model files
pass all 79 tests. Doctests, builds, wasm, release guard, package/app typechecks
and fixture-wrapper tests pass. The final README budget/self-containment rerun
also passes. The witness recurrence and its unclassified cause remain in the
[existing issue](../../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md);
[witness-sigint-rerun.log](witness-sigint-rerun.log) and
[cli-target-rerun.log](cli-target-rerun.log) preserve both reruns. No process
inspection or ownership check was weakened.

Earlier interrupted development runs were superseded during retained-object
pricing and after native test-artifact builds exposed a relative module path
and two test-only `Shared` initializers. Those compile errors were fixed;
the complete workspace test-artifact build then passed. Superseded runs are
not qualification receipts. Final changes after the full native/client inputs
were captured are documentation, typed example/golden fixtures and the await
inventory; their affected checks were rerun.

Focused qualification includes:

- The independent owned-event oracle, every-page prefix checks, original/repost
  liveness, graph changes, discovery/backdating stalls, replay bindings, quotas,
  all meter cuts and bounded reclaim from round 1, plus shaped-prefix traversal.
- Eight language/engine tests: real card projection, immutable replay after a
  190k-byte body edit, private-field revocation, hidden private fields, opening
  operation/viewer/argument bindings, live prepend, oversized omission/continuation, seven-dimensional
  meter checks, and small-field maps that shorten pages by retained heap cost.
  [guide-compat-final.log](guide-compat-final.log). The same run passes all 112
  guide checks and the frozen-schema compatibility test. The generated TypeScript
  golden comparison strips only the validated additive Following descriptor;
  the existing frozen-schema comparison is unchanged, with no Following-specific
  normalization applied to schema bytes.
- Real server + online/wasm/native SDK journeys: 1,101 sparse events across the
  1,000-copy window; 8,200 follows preparing before publication; offline inbox;
  live prepend; own-post and own-edge fences; unfollow; byte-identical replay;
  expiry restart; two consumers; lost response; new-follow live delivery without
  joining historical pages; bearer revocation; and a delayed unit crossing an
  unfollow. Additional wasm/native cases acquire only three source posts, read
  all 25 history cards online, preserve the offline inbox's unavailable state,
  and fence pending own posts through reconnect. The generated API descriptor
  is checked against served `api.ts`.
- Chromium mounts the public hook under Strict Mode, distinguishes preparation
  from empty, pages two independent consumers and unmounts one without consuming
  the other's continuation. [hook-react.log](hook-react.log)
- All 339 delivery fault cases pass after classifying the 13 new query/authority
  awaits; no mutation-delivery site or recipe changes.
  [delivery-fault-rerun.log](delivery-fault-rerun.log)
- The published-client examples now exercise `useFollowing`; all eight example
  tests pass, covering 40 TypeScript blocks and all 54 public functions.
  [readme-examples-rerun.log](readme-examples-rerun.log)
- `ref-check --verbose`: 528 documents, 10,428 references, zero errors/unchecked.
  [ref-check-final.log](ref-check-final.log)
- Root `check-inventories` still fails on the pre-existing Snapback 1 guide/demo
  generated-artifact inventory. Its complete output is byte-identical to the
  committed round-1 result. No files outside the Snapback 4 fence were repaired.
  [inventories.log](inventories.log)

Round-1 dual review is owned by the commissioning user; findings are scheduled
for round 3. No independent round-2 review verdict is claimed here.

## Measurements

Seven native samples, optimized test profile (`opt-level=1`, assertions enabled,
no debug info/incremental output), taskset CPUs 76–77. Oracle scans are outside
all timed intervals; the first-page timer includes registration. Setup, every
page, all seven meters, final exhaustion and bounded reclamation are asserted.
These are shared-host observations, not production latency guarantees.

| Corpus | First page median | Preparing units | Later page median¹ | Accounted custody high-water | Exhausted events |
|---|---:|---:|---:|---:|---:|
| 1,100 quiet originals + repost, no unrelated rows | 1.529 ms | 0 | 1.482 ms | 298,676 B | 1,101 |
| 50k originals / about 1,000 users, quiet followed | 1.667 ms | 0 | 1.594 ms | 298,676 B | 1,101 |
| 8,200 follows, one event each | 201.385 ms | 5 | 1.339 ms | 17,287,792 B | 8,200 |

¹ Median of the seven within-run later-page medians. [shaped-metrics.json](shaped-metrics.json),
[measure-shaped-final.log](measure-shaped-final.log).

Adding 48,900 unrelated posts changes **none** of the first/last/whole-traversal
meters, preparation counts or accounted state. The sparse first unit charges
292 examinations, 24 index entries, 124 probes, 8,628 steps, 3,324,054 heap bytes,
5,812 output bytes and five lifecycle/reply writes; it retains no frontier.
Initial 8,200-follow preparation charges 8,112 examinations and 31 writes.
The native case exhausts 8,200 events in 410 pages plus five preparation units.
Accounted custody includes head records, staged objects, replay images and
lifecycle records; it is not process RSS, SQLite caches or client-retained lists.

For comparison, the committed pre-reader reproduction returned zero rows,
`complete: false`, no continuation, at 5,789 examinations and an exhausted
16 MiB heap, with a 23.242 ms median on the 50k sparse corpus. The former internal
metadata reader's 1.127 ms sparse first-page measurement excluded cards and the
HTTP/SDK protocol. Those are earlier shared-host samples, not a fresh controlled
latency ratio. See the [round-1 report](../round-1/REPORT.md#measurements).

Separate real HTTP/SDK observations use the unoptimized development server on
sampled-idle CPUs 94–95. The timer ends only when the hook publishes the page,
including registration, preparation polling and mounted reauthorization. Five
subsequent pages were timed. No in-band work counters were added for metrology.

| Corpus | First displayed page | Preparing units | Opening RPCs | Later displayed page median |
|---|---:|---:|---:|---:|
| 50k sparse originals | 39.818 ms | 0 | 1 | 42.150 ms |
| 8,200 follows and originals | 2,178.417 ms | 6 | 1 | 42.480 ms |

The HTTP fixture uses `dev:` principal identities and generated card envelopes;
its preparation count is measured separately from the native fixture. Each
preparation response is 95 B; page units here are about 5.8–5.9 kB. The complete
native traversal supplies the storage and work measurements above.
[http-metrics.json](http-metrics.json), [measure-http.log](measure-http.log).

## Compatibility and wasm

**No persisted bytes change:** no table, catalog schema, capability, source row,
index definition, IR/program serialization, stored cursor, application commit,
sync representation or sidecar format changes. The new frontier/response state
is volatile and process-owned. New tokens, shaped DTOs and generated TypeScript
bindings are transport/SDK additions. Consequently no new-table old-engine
refusal test is required. The commissioning user owns the separate Darwin fence;
no Mac run is claimed.

Linux wasm is **2,117,507 B raw / 639,879 B gzip**, compared with round 1's
2,117,335 / 639,888: +172 raw, **−9 gzip**. These are whole-artifact deltas;
authority witness recording is SQLite-only and no device history traversal is
added. The cap is **640,009 B = Linux + 130 B**, nine bytes below the prior cap.
No runtime ceiling changed. The cap reason is recorded in
`metrics/wasm-budget.json`; [wasm.json](wasm.json) records the digest and sizes.

## Remaining scope

Round 3 handles the commissioned independent reviews. Device traversal,
all-history copying, inbox coverage certificates, a general resumable query
facility and history-only block filtering remain explicitly deferred. Ordinary
query compositions outside the generated binding's admitted projection subset
retain their existing semantics and do not acquire a completeness claim.
