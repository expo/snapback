# Lane Z review round 1 — event-slot compatibility, bounds and prediction

2026-09-25 · LLP 3000.016 revision 12, increment 5 · `sb4-intent/z-event-slots`.

Addresses the Astra and Grok round-0 NOT READY reviews. The accepted event-slot
representation and transactional activation are unchanged. This round fixes the
capability fence, query publication under prediction, aggregate classification
and snapshot work bounds, and proves the independent unrepost guard.

## Review findings

| Finding | Resolution | Evidence |
|---|---|---|
| Astra High: pre-slot engines accept new slot schemas | Derive `timeline-event-slots` from engine slot columns, independently of `timeline-v2`. Public projections preserve the requirement; genuinely slotless legacy backends keep only `timeline-v2`. | Five core capability tests plus two actual pre-slot wasm tests. Old installation, adoption and persisted reopen refuse; failed adoption leaves state and persistence unchanged. The genuine old backend still installs/adopts. |
| Grok High: an unknown conditional publishes `[]` behind a pending own-post fence | Merge U round 6. Every unknown owned-event point/probe/scan records speculative provenance through the shared helper. Preserve U's held-row provenance when a full-kind point hit returns an application row with slots removed. The public-client assertion now requires `{ loading: true }`. | Public-client regression passes on wasm and native; fault traces assert `speculative` for partial-event reads and `held` without `speculative` for full-kind hits. |
| Grok Medium: aggregate fence blocks replies/body edits and tests never reach runtime | Inspect write payloads. Known live inserts and liveness-changing updates receive Server sites. Replies and body-only edits do not. Argument-dependent insert filters, conditional branches, upserts and unreposts carry a named runtime condition instead of making the entire operation `predicts: never`. | With a synced count, the same post operation predicts a reply and queues a live original; a body edit predicts. An explicit branch choosing original versus reply also reaches the guard. Removing the guard's body fails the trace at a wrongly predicted original. |
| Astra Medium: discarded event kinds cause an unbounded snapshot page | Skip the owned table entirely when neither kind is fully synced. For mixed residency, count examined rows against remaining page room and resume from the last examined key, including pages with no returned events. | Three instrumented storage tests seed 4,096 events with a long excluded prefix. A seven-unit page requests/decodes at most seven owned events; fully partial tables incur zero scans. All selected events arrive once, and no skipped event is fetched twice. |
| Astra Low: unrepost's runtime guard lacks a regression | Seed a held floored repost with its filled slot and synced event count. Invoke prediction directly; it refuses without predicted rows and rolls the source delete back. Online-only count permits the deletion and tombstone. | New schedules execute on wasm/native. Removing only the call in `timeline_remove_id` fails the independent unrepost assertion. |

## Integration and commits

- `024a98102` merges U through `1049dd31e`, including provenance implementation `e4a3ae5c9` and the required U round-5 ancestors. The only conflicts were append-only journal entries (both preserved) and the point-read path (kept Z's internal slot access/public projection and U's held provenance).
- `4f4e73247`: event-slot capability and actual pre-slot artifact regressions.
- `d3790901c`: bounded event snapshot scanning and storage-read witnesses.
- `238f74f16`: precise aggregate classification, speculative event provenance, adversarial regressions, guide and measured wasm budget.
- `b44e768ad` merges U's round-six qualification follow-up `6a7e3b04f`, including preservation of authoritative refusals at expiry.
- `72f6d4fdf` merges the final U watch-expiry follow-up `648abea48`, committed while the full suite was running. It clears expired watch data before asynchronous recovery. Only `local.ts` and its `residency.test.mjs` regression change in this follow-up.

Z makes no direct edits to U's `local.ts` or `local-query.ts`; changes in those
files come from the requested merges. No pushes or package publications.

## File-by-file Z changes

Paths below are relative to `snapback4/`; imported U files are listed separately.

| File | Change |
|---|---|
| [crates/snapback4-core/src/schema/capabilities.rs](../../crates/snapback4-core/src/schema/capabilities.rs) | Derive and recognize the independent engine-column capability. |
| [crates/snapback4-core/tests/schema_capabilities.rs](../../crates/snapback4-core/tests/schema_capabilities.rs) | Verify combined and independent derivation, public projection, missing-capability refusal, and genuine legacy compatibility. |
| [packages/snapback4/test/event-slot-capability.test.mjs](../../packages/snapback4/test/event-slot-capability.test.mjs) | Actual old wasm installation/adoption/reopen refusal and successful old-backend control, without optional skips or network downloads. |
| [packages/snapback4/test/fixtures/event-slots-pre-slot/device.wasm.gz](../../packages/snapback4/test/fixtures/event-slots-pre-slot/device.wasm.gz) | Digest-pinned, genuine U round-1 pre-slot device, compressed for the repository. |
| [packages/snapback4/test/fixtures/event-slots-pre-slot/backend.json](../../packages/snapback4/test/fixtures/event-slots-pre-slot/backend.json) | Genuine pre-slot schema response from the published 0.4.1 Linux compiler. |
| [packages/snapback4/test/fixtures/event-slots-pre-slot/schema.q](../../packages/snapback4/test/fixtures/event-slots-pre-slot/schema.q) | Reproducible source for that legacy backend. |
| [packages/snapback4/test/fixtures/event-slots-pre-slot/README.md](../../packages/snapback4/test/fixtures/event-slots-pre-slot/README.md) | Artifact provenance, digests and ABI explanation. |
| [packages/snapback4/test/schema-capabilities.test.mjs](../../packages/snapback4/test/schema-capabilities.test.mjs) | Existing opt-in 0.2.33 tests now expect both Following capabilities. |
| [crates/snapback4-core/src/partition.rs](../../crates/snapback4-core/src/partition.rs) | Skip wholly absent event tables; mixed pages charge examined rows and persist scan progress in the existing continuation. |
| [crates/snapback4-core/tests/event_slot_snapshot.rs](../../crates/snapback4-core/tests/event_slot_snapshot.rs) | Count storage calls, requested limits and decoded rows independently of emitted events in both mixed directions and the no-full-kind case. |
| [crates/snapback4-core/src/engine/timeline/slots.rs](../../crates/snapback4-core/src/engine/timeline/slots.rs) | Mark unknown ordinary event reads speculative in the shared path. Runtime aggregate guards remain intact. |
| [crates/snapback4-device/tests/event_slots_trace.rs](../../crates/snapback4-device/tests/event_slots_trace.rs) | Expand to 21 adversarial schedules, exercising real aggregate runtime paths, independent unrepost refusal/rollback, conditional branches and event-read provenance. |
| [crates/snapback4-lang/src/bind/timeline/prediction.rs](../../crates/snapback4-lang/src/bind/timeline/prediction.rs) | Inspect insert filters and update fields; retain runtime conditions for writes whose actual event change cannot be decided statically. |
| [crates/snapback4-lang/src/bind/timeline.rs](../../crates/snapback4-lang/src/bind/timeline.rs) | Remove the blanket source-table aggregate fence; keep per-transition input classification. |
| [crates/snapback4-lang/src/bind/residency.rs](../../crates/snapback4-lang/src/bind/residency.rs) | Invoke event-change classification using the actual program. |
| [crates/snapback4-lang/tests/bounded_following.rs](../../crates/snapback4-lang/tests/bounded_following.rs) | Assert Server versus eligible/runtime classifications, named aggregate sites, and reply/body-edit eligibility. |
| [crates/snapback4-lang/src/guide/feeds.md](../../crates/snapback4-lang/src/guide/feeds.md) | Explain event-changing fences, reply/body-edit prediction, runtime decisions and old-device capability refusal. |
| [packages/snapback4/test/bounded-following.test.mjs](../../packages/snapback4/test/bounded-following.test.mjs) | The pending own-post plus unknown conditional event read must publish loading on both real hosts. |
| [metrics/wasm-budget.json](../../metrics/wasm-budget.json) | Record measured combined artifact and raise the exceeded gzip ratchet to 500,000 bytes. |
| [JOURNAL.md](../../JOURNAL.md) | Append this round's changes, measurements, verification and remaining scope. |
| [reports/20260925-event-slots-r1/REPORT.md](../../reports/20260925-event-slots-r1/REPORT.md) | This report. |
| [reports/20260925-event-slots-r1/mutate-guards.py](../../reports/20260925-event-slots-r1/mutate-guards.py) | Reproduce both rejected guard mutations, restoring source even on failure. |
| `reports/20260925-event-slots-r1/*.log.gz` | Focused capability, snapshot, compiler, client, replay, guard-mutation and final-suite evidence. |

U's provenance merge changes `engine/components.rs`, `engine/local.rs`,
`engine/read.rs`, `engine/read_auth.rs`, `engine/runner.rs`, device `call.rs`
and `device.rs`, client `local-query.ts`, `local-reads.ts`, `local.ts`, and
`CLIENT-AND-OPERATIONS.md`. It carries U's existing coverage, routing, authority,
lifecycle, expiry and fixture tests and its round-5 journal/report. The merge's
only Z-specific engine resolution is in `engine/read.rs`: set held provenance
before returning the raw internal transition image or stripped public image.

## Forms and examples

No author syntax changes. With floored sources and a synced
`view totals: count feedPosts by .actorId`:

- `insert posts { id: postId, authorId: viewer, parentId: null, at: now }` queues when it creates a live event. A statically known live insert has a named Server site.
- `insert posts { id: postId, authorId: viewer, parentId: 'p', at: now }` predicts the reply, which has no original event.
- `update posts[postId] { body: 'edited' }` predicts; `update posts[postId] { removed: true }` has a named Server site.
- An operation whose `parentId` is an argument stays eligible for runtime evaluation: null queues the original, and a held parent predicts the reply. Conditional original/reply branches obey the same rule.
- `delete reposts[viewer, postId]` with a held floored repost queues when the event aggregate syncs. Declaring that aggregate `online only` permits prediction.
- A conditional owned-event query decided by an unknown online-only existence read publishes `{ loading: true }` while an own source prediction fences fallback, even if the placeholder result is `[]`.

`Horizon` for the conditional aggregate site means the static classification is
insufficient to authorize prediction; its reason names the aggregate and actual
runtime condition. The existing runtime transition guard remains authoritative.
No row authorization, disclosure rule or runtime meter ceiling was relaxed.

## Validation and mutation sensitivity

Focused passes before the full run:

- Core capability tests: **5/5**.
- Instrumented event snapshot tests: **3/3**, including over 500 empty progressing pages per mixed direction.
- Bounded Following compiler tests: **6/6**.
- Actual pre-slot wasm tests: **2/2**, including no persistent writes after failed adoption.
- Public-client pending-event regression: **2/2**, wasm and native.
- Server-produced schedules: **21**, replayed on actual wasm/native: **42/42**.
- Aggregate-body removal: **exit 101**, fails on `branch-post` receiving predicted post/inbox rows.
- Unrepost-call removal: **exit 101**, fails on `reposts/r` and its tombstone receiving predicted rows.
- Restored guards: **exit 0**; traces regenerated successfully.

Reproduce from `snapback4/` with the stated toolchain on PATH:

```sh
cargo test -p snapback4-core --test schema_capabilities --test event_slot_snapshot
cargo test -p snapback4-lang --test bounded_following
cargo test -p snapback4-device --test event_slots_trace
node --test packages/snapback4/test/event-slot-capability.test.mjs packages/snapback4/test/event-slots.test.mjs
node --test --test-name-pattern='owned-event fallback waits' packages/snapback4/test/bounded-following.test.mjs
python3 reports/20260925-event-slots-r1/mutate-guards.py
SNAPBACK4_RUST_TEST_PROCESSES=8 CARGO_BUILD_JOBS=8 taskset -c 0-15 bash scripts/test.sh
```

The JS tests need the current binary, wasm and package build; `scripts/test.sh`
creates these and runs the Rust trace producer before JS replay. Do not run the
mutation script alongside a build or suite in the same worktree.

The full invocation on **`b44e768ad`**, containing all Z corrections and U's
provenance/qualification changes, returned exactly **`== 0 failure(s) in 993 s`**,
exit **0**. All stages passed: Rust **512 s**, client tests **180 s**, client
models **242 s**. The main client run reports **1,651 passes / 10 existing
skips**; all **78 model tests** pass. There were **no full-suite failures** to
classify as ours, baseline or environmental.

U committed `648abea48` during that run. After it completed, merge `72f6d4fdf`
imported only the watch-expiry callback and its stronger regression. Package
typechecking/build passed afterward. The affected watch, residency, authority,
lifecycle, prediction-routing and bounded-Following client files were then run
against that merged implementation:

**199 tests passed, 0 failed, 0 skipped**, exit **0**, in **162.535 s**.
This includes the blocked-recovery permit-expiry regression and both actual
wasm/native owned-event fallback tests.

This is scoped post-merge qualification; the full-suite elapsed time above is
not presented as a second complete run after the late client-only merge.
The engine, schema, wasm and compiler inputs are unchanged by that merge.

## Failure accounting, measurements and limits

The first focused compilation caught two mistakes in the new compiler helper:
re-export visibility and conversion to `ObjectFields`; both were corrected.
The first pre-slot control test incorrectly treated a successful `ok: null`
adoption reply as failure; its success predicate now checks key presence.
These were ours, not baseline/environmental failures. One initial Cargo
invocation also used the repository-root workspace and was retried with the
Snapback 4 manifest; it did not run tests. The two deliberately
mutated guard failures are expected sensitivity evidence, not unresolved reds.
The supplied baseline remains `== 1 failure(s) in 276 s` in `cargo test`; no
baseline failures have been attributed to this change.

The first wasm build exceeded 499,000 bytes by 383 (ours, resolved by the
documented artifact ratchet; the final full-suite wasm gate passes). The measured combined U/Z
artifact is **1,784,180 B raw / 499,383 B gzip**, compared with Z round 0's
1,787,614 / 498,768 (**-3,434 raw / +615 gzip**). The documented ratchet is now
**500,000 B**, the smallest rounded thousand, leaving **617 B**. This is a
whole-artifact comparison; no independent per-fix attribution is claimed.

The old artifact is 1,776,336 bytes, SHA-256
`157158ee62a2442cfbc9fedb9848f0b6939cd3da58b493d2d55bc7374401e02c`, matching
U's recorded round-1 acquisition inventory. Its actual refusal behavior, not
only the marker list, is asserted. Only this old wasm artifact is exercised;
the old native executable is not included in the compatibility witness.

No new acquisition inventory was requested or run in this correction round.
Round 0's inventory remains evidence for its recorded artifact, not a new timing
claim for this tree. The storage representation is unchanged. The fix bounds
work without adding an event index, changing cursor encoding, or migrating
existing rows. Activation, slot stamping, transitions and image retention retain
the reviewed design.

No design part is stopped. No known open correctness problem remains after the
listed tests; independent re-review and integration remain with the supervisor.
