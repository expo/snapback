# FH round 1 — internal server reader milestone

2026-10-06; resumed 2026-10-07 · eb1000 (`expose-builder-pixel`) · `sb4-intent/fh-following-history`

This is a **partial implementation**, using the coherent-milestone option in the
round-1 commission. It adds the approved design, an internal native server reader
over owned event metadata, bounded volatile custody, and an independent oracle.
It does **not** add a `serve` route, card shaping, a generated binding or the SDK
hook. Public Following history is still limited by the existing planned reader.
There is no new completeness claim in `guide feeds` or its compiler certificate.

## Decisions and implementation

[LLP 3000.026 §9](../../../../llp/3000.026-following-over-a-populated-store.rfc.md#9-exact-on-demand-history-design-handoff)
records the eleven delegated author decisions as accepted, with implementation
explicitly partial. [DISPOSITIONS.md](DISPOSITIONS.md) covers the Astra and Grok
findings, including the author's rejection of an inbox splice and history-only
blocks. Both supplied reviews are retained verbatim under `reviews/`.

The native `engine::following_history::Reader` opens the viewer lane and current
edges admitted at or before B, seeks `Posts.byActorTime`, and probes private
`Work.admitted` internally. It never scans unrelated actors' event rows. All
eligible lanes have a head or an end before selection; a popped lane refills
before another winner is selected. The unchanged inbox predicate, current live
event and admission bound are checked at selection, publication and replay.
Original removal does not remove an independent surviving repost.

The frontier consists of ordered blocks of at most 64 heads. Requests clone the
block map and copy only touched head blocks. A refused unit cannot mutate the
accepted unit. This adds metered O(F/64) map work per retained request to merge
selection costs; it is not a claim of an ideal O(N log F) implementation. Each
of the seven request ceilings remains unchanged. Checkpoint/lifecycle writes
count toward 1,024 writes; publication and reply retention are reserved before
more traversal. SQLite preflights owned row and index-key lengths before loading
payloads. Fixed decoding/probe reservations keep private queue status, error and
cursor sizes out of progress and meters.

Custody is process-owned and volatile: four independent registrations/sessions
per viewer/declaration, five-minute idle expiry, 32 MiB accounted per session
and 128 MiB per controller. Four accommodates two tabs, another device and a
replacement/recovery consumer. There is no eviction. Abandoned state remains
charged until bounded reclamation physically releases it. Opening registration
also consumes a slot and has its own meter. A separate 64 KiB scratch allowance
precedes owned-key allocation and ordered-map mutation for opening, cancellation
and every reclaim record. Default heap therefore bounds reclamation to at most
256 records per call, in addition to the write/step ceilings. The future host
must compose that meter with traversal if both run within one HTTP request, and schedule reclamation
fairly. This module is not an authentication boundary; its `Context` is trusted,
just as for `Engine::query`.

A token names one immutable response unit, with the current and preceding units
retained for retry. Replay returns pinned metadata bytes after authority checks;
revocation restarts. Advancement and reply retention are one controller ownership
swap. A metered opening registry prevents a reclaimed opening from becoming a
new unit. Unknown tokens, expired bindings, controller loss, changed bindings
and detected store rewind restart explicitly. Frozen B is distinct from the
latest observed commit head. A host replacing a store with an equal/higher
sequence and the same incarnation must invalidate the controller itself.

A metadata row that exceeds output capacity produces an ordered named omission,
then progresses past its key. This does not qualify application-card shaping or
its authority/heap costs. Source/schema/IR/catalog formats and inbox queries are
unchanged. There is no persisted frontier table or sidecar file.

## Independent review

The fresh same-family implementation review found three custody defects, all
fixed with regression tests: an empty successor after exhaustion; opening replay
after reclamation or under another viewer; and rewind detection tied only to B.
Its follow-up found a registered-opening page-size mismatch; that now restarts
too. The fresh post-reboot review found undersized lifecycle heap allowances and
pre-admission key clones; those now use the 64 KiB reservation and a refusal
regression over 96 registrations. The first two actual review results are retained in
[implementation-1.md](reviews/implementation-1.md) and
[implementation-2.md](reviews/implementation-2.md). These are source inspections,
not independently run tests. The resumed reviewer’s final scoped verdict is
**APPROVE**, recorded in [implementation-4.md](reviews/implementation-4.md),
with the follow-churn decision still open.

One architectural finding remains awaiting the requested author clarification:
continuous **post-B follow additions** in the unscanned `Edges.byPair` range can
obstruct roster discovery, just as post-B backdated events obstruct an actor
scan. Current discovery checkpoints strict actor-key progress and does not
publish a false end, but reports `preparing`; event backdating reports `stalled`.
The reproduction is
`discovery_checkpoints_post_bound_follow_churn_without_a_false_end`.
After follow additions stop, it terminates against the frozen oracle.

The accepted decision named only event backdating as the termination exception.
The remaining choice is to include post-B follow churn in `stalled`, or add a
stronger roster snapshot/enumeration design. This report does not silently
broaden the author's guarantee, and the review finding is not marked closed.

## Verification matrix

The oracle scans owned Posts, Work, RemovedEvents and Edges directly; it uses
neither the planned activity reader nor production merge/cursor/order helpers.
It freezes the roster and admission bound, then independently orders literal
`(at,eventId)` tuples. Every page is compared with the next current-authority
prefix. Generated tests use 16 deterministic seeds, 80 originals per seed,
random follow sets and 60 mutation attempts per seed (follows, unfollows,
reposts, unreposts and removals). Inapplicable operations are skipped according
to the existing engine's rules.

| Requested case | Evidence / scope |
|---|---|
| Sparse history and hot/quiet seam | Explicit 50k scale run drains all 1,101 followed events; first online page comes from merge, no inbox seam |
| More follows than one request | 8,200 populated lanes, five preparation units, then all 8,200 events; oracle on every first-sample page |
| Ties, self lane, originals/reposts | Core prefix tests and generated corpora; existing engine rejects self-follows |
| Original removal with surviving repost; tombstone/Work/purge | Dedicated tests; deleted events do not resurrect from retained births |
| New follows and post-B/backdated events | Frozen-domain test; no unrelated-commit restart, no post-B event enters history |
| Unfollowed heads; staged/final/all-staged revocation | Cuts across examined allowances 20–69; stale heads removed, revoked staged rows restart |
| Same-transaction refollow/source ID reuse | Dedicated operation and captured-epoch replay restart |
| Empty/all-removed lanes | Dedicated exhaustion tests |
| Replay, lost reply, forged bindings, old replay window | Pinned bytes; viewer/store/generation/declaration/arguments/page size; stale/empty tokens |
| Expiry, controller crash, reclaim, tabs | Four consumers; fifth refused; unknown/reclaimed openings restart; quota retained until reclaim |
| Rewind after observing later commits | Dedicated regression separate from frozen B |
| All seven meter dimensions | Preflight ledger test, per-outcome assertions, tiny allowances and quota rollback |
| Private-state progress | Paired worlds vary Work status/error/cursor and unrelated readers' edges; identical phases, rows and all meters, opaque tokens normalized |
| Oversized output | Named metadata omission and shorter normal pages; application-card heap/output shaping remains pending |
| Backdating obstruction | Repeated post-B backdating yields stalled, preserves continuation, terminates after writers stop |
| Post-B roster obstruction | Reproduction preserves progress and eventually finishes after additions stop; phase/termination contract decision pending |
| Blocks | No history-only filter, per author ruling; inbox predicate is unchanged |
| Authenticated route, cards, mounted withdrawal, live prepend, offline, pending intents, reordered HTTP and two-tab SDK journeys | **Not implemented or qualified** in this milestone |
| Host scheduling/fairness, crash during transport commit, restore replacement invalidation | Host integration remains pending |

**Affected native tests after the resumed lifecycle fix: 21 passed, 0 failed;
one scale test is ignored by default and run explicitly.**
[affected-lifecycle.log](affected-lifecycle.log) records the final focused run.
[affected-final.log](affected-final.log) retains the pre-reboot 20-test pass
with the independent tuple-order oracle. [certificate-comparison.json](certificate-comparison.json)
confirms compiler output matches D0 except the check command’s elapsed `ms`.

The generated corpora mutate before freezing; deterministic tests cover selected
inter-request mutations. This is not an exhaustive enumeration of every possible
interleaving at every internal instruction.

## Measurements

Native optimized test profile (opt-level 1, assertions enabled, debug info and
incremental output disabled), seven samples on sampled-idle CPU 6 using taskset.
Compilation/full-suite work used a disjoint 12-CPU affinity. The repeated old
reader control used sampled-idle CPU 82. These shared-host observations are not
an HTTP, device, card-shaping or displayed-page SLO. The first-page timer includes
the opening registration call; preparation counts are reader units, not network
round trips. The oracle is outside timed intervals.

| Corpus | First page median | Preparation units | Later page median¹ | Accounted state high-water | Events exhausted |
|---|---:|---:|---:|---:|---:|
| 1,100 quiet originals + repost, no noise | 1.001 ms | 0 | 0.986 ms | 97,924 B | 1,101 |
| 50k originals / ~1,000 users, quiet followed | 1.127 ms | 0 | 1.083 ms | 97,924 B | 1,101 |
| 8,200 follows, one event each | 208.030 ms | 5 | 0.866 ms | 17,087,232 B | 8,200 |

¹ Median of seven within-run later-page medians. Full samples and meters:
[measurements.json](measurements.json), [scale.log](scale.log).

Adding 48,900 unrelated posts changed **none** of the first/last/whole-traversal
meters, preparation count or accounted state in any of the seven samples. A
sparse first read charges 252 examinations, 24 index entries, 124 probes,
2,898,740 heap bytes and five lifecycle/reply writes. It writes no retained
frontier. The original timing run charged opening registration one examination, 16,384
heap bytes and three lifecycle writes; the resumed lifecycle correction raises
only that temporary heap reservation to 65,536 B. Retained storage is unchanged.
The final lifecycle measurement is recorded below. The 8,200-follow traversal
uses 415 read units
(410 pages plus five preparation units), each checked against all unchanged
ceilings; initial preparation charges 8,112 examinations and 31 writes.
Accounted controller state is not process RSS, SQLite cache or client-retained
response memory. Explicit bounded reclamation releases it at the end of each run.

The **final resumed scale run** passes after the lifecycle fix: seven samples on
logical CPU 42, sampled 1% busy before starting. Its SMT sibling (90) was in the
full-suite affinity; these are shared-host, not isolated-core observations.
First/later page medians are 1.644/1.601 ms without noise, **1.875/1.833 ms** for
the 50k sparse corpus and **335.158/1.401 ms** for 8,200 follows. Preparation
counts, read-unit counts, all read meters and storage match the earlier run;
opening scratch is now 65,536 B. The explicit test passes in 107.03 s, including
fixture construction and untimed oracle scans. See
[measurements-resumed.json](measurements-resumed.json) and
[scale-resumed-lifecycle.log](scale-resumed-lifecycle.log).

The repeated existing-reader reproduction remains incomplete at 50k: **23.242 ms**
median, zero rows, no continuation, 5,789 examinations, heap ceiling exceeded.
The existing actor-index control takes 0.179 ms for 20 rows but cannot continue
8,200-follow discovery. It has none of the new reader's birth, authority,
checkpoint or replay work. [before.log](before.log) retains all three D0 tests.

## Persisted bytes and wasm

**No persisted bytes change:** no new engine table/index, no catalog/schema or
program IR field, no durable cursor format, no store migration. Read-only tests
compare SQLite total changes and serialized schema before/after traversal.
The volatile controller is absent from ordinary query/SQL/sync surfaces. A new
engine-table old-engine refusal test is therefore not applicable to this
milestone; a later durable format would require one. Darwin was not run here;
the commissioning user retains that separate fence.

The full-suite Linux build produces **2,117,335 B raw / 639,888 B gzip**, SHA-256
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`—byte-identical
to D0. The existing **640,018 B** cap is exactly Linux plus **130 B**. No cap
increase or macOS result is claimed. [wasm.json](wasm.json) records the comparison.
The server module is gated to native SQLite and appended without shifting shared
source lines. Internal refusal-code explanations were registered to keep the
source/guide census complete; the feeds card and certificate bytes are unchanged.

## Resumed verification disposition

The reboot interrupted the previous suite before its client/model stages
completed. `full-suite.log` is that partial run, not a passing receipt. The
resumed `bash scripts/test.sh` started from the beginning on the documented CPU
set. Its native stage completed 1,013 scheduled executions in 1,553 s: 1,012
passed, one CLI target failed, and doctests passed. That CLI target has one
recorded failure in unchanged witness code:
`stalled_resolver_sigint_is_bounded_journalled_and_drained` refused an invalid
`/proc` process-group snapshot during evidence cleanup, after the resolver and
its descendants had drained. The rejected PID/stat snapshot was not captured;
its cause remains unclassified.

The client pool passes all 322 files in 1,804 s: 6,440 tests pass, zero fail,
and 47 are explicit skips (including four published Darwin witnesses). Both
full-count model files pass all 79 tests in 305 s. The complete script finishes
in **3,734 s, exit 1, one failure** (`cargo test`, the witness case above).
This is not reported as a zero-failure full suite.
[verification-resumed.json](verification-resumed.json) and
[full-suite-resumed.log](full-suite-resumed.log) retain the receipt.

The exact test then passed in 1.33 s, and the complete CLI target passed with
318 successes, zero failures and four explicit ignores in 79.50 s. These reruns
do not erase the original suite failure. The existing
[inspection issue](../../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md)
now records this recurrence. See [witness-sigint-rerun.log](witness-sigint-rerun.log)
and [cli-target-rerun.log](cli-target-rerun.log). No witness or process-ownership
check was changed.

The resumed full-suite artifact build preceded the final lifecycle reservation
fix. The separate 21-test focused run and explicit scale run qualify that final
change; all other code inputs to the full suite are unchanged. Verification is
composed from these scoped receipts, rather than claimed as one exact-build pass.
The final reference audit passes (528 LLPs, 10,424 references, zero errors).
The optional root inventory audit retains the same out-of-fence failures as D0;
[inventories-comparison.json](inventories-comparison.json) records identical output.
Source/document whitespace checks pass; raw tool logs retain their original
trailing spaces and blank final lines.

## Remaining delivery

Resolve the roster-churn termination contract; finish authenticated server host
custody/routing, card shaping and authority, meter composition and fair cleanup;
generate the Following-specific binding/hook; prove live prepend, mounted
withdrawal, pending own-post/edge fences, offline fact, retries/restarts and two
consumers end to end. Then rerun the complete acceptance matrix and update the
feeds guide/certificate. No application-owned pagination workaround is shipped.

The local commit includes the approved design, internal reader, oracle, review
dispositions, final verification receipts and JOURNAL entry. Nothing is pushed.
Worktree disk use is approximately 17 GiB, below 50 GB.
[EVIDENCE.json](EVIDENCE.json) records final source, review and proof hashes.
