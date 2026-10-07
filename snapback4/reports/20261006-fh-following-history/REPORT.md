# FH: Following history — reproduction and design handoff

2026-10-06 · base `547c6113bdab6a68c3b8628d79fa6c0b6eb0ce53` · package 0.4.13
· branch `sb4-intent/fh-following-history` · eb1000 (local hostname
`expose-builder-pixel`). No remote host, other worktree, push or publication.

**Stopped at the commissioned design gate. No production reader is implemented.**
The sparse-history failure reproduces. The existing per-author event index
solves unrelated-post sparsity for a small follow set, but cannot discover an
uncapped follow set through a meter cut. There is also a chronological gap at
the proposed inbox-to-history handoff. A complete implementation needs an
explicit resumable-read capability and a decision about that handoff.

The proposal is [LLP 3000.026 §9](../../../llp/3000.026-following-over-a-populated-store.rfc.md#9-exact-on-demand-history-design-handoff).
The guide now describes the current limitation precisely; it does not advertise
an unbuilt complete reader. The 1,000-event copying policy remains intact.

## Decision requested

Approve an **opt-in online history traversal with resumable setup**, no
follow-count cap, unchanged per-request resource ceilings, and a private,
expiring traversal frontier. At the live inbox's end, enter exact-history mode
from the top and reconcile stable event keys while preserving the user's
anchor. This avoids dropping older events that belong above the inbox tail.

If the requirement is strictly append-only chronological continuation, choose
instead to establish full-history coverage before publishing the initial live
prefix. The existing inbox alone cannot prove that prefix. This costs setup
work on the initial read and needs a separate fast-path coverage design.

The decision also needs to admit the traversal's new capability/format fence,
progress publication semantics, state admission/expiry policy and initial
server-only execution. These are not routine index tuning. The existing
wider-than-one-read merge design was shelved; ordinary `next` does not encode
discovery, and `usePage` does not discharge accumulated incompleteness. The
proposal keeps existing certificates and persisted application schemas valid.

This stopping point follows the task's explicit instruction: “If the design
needs an author decision, for example a breaking change to certificates or a
new capability, stop after the design and report.” It is not a skill-imposed
approval requirement or the earlier decision against copying all history.

## What the historical reader actually does

The current guide's planned `home`, renamed `history` in the reproduction, is:

```text
query history(c: cursor ?):
  return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c
```

`activity` is the union of qualifying original posts and reposts. The compiler
pushes `.parentId = null and not .removed` into the original-post index prefix
in this fixture. It then scans original events across **all authors**, ordered
by time/id, and applies the follow-membership predicate to each candidate.
Reposts use their global time/id index and the same residual membership test.
Each branch seeks up to 21 survivors: 20 plus lookahead. The projected union
sorts branch results and carries branch identity in its cursor. This is
`engine/view_merge.rs`, not an author-head merge.

One unrelated candidate can cost both a source examination and a membership
lookup, plus probes, expression work and allocation. The source reads are
public in the admitted Following schema; this is selection sparsity, not a
private-source authorization optimization. A branch cut loses the proof of
the merged prefix and therefore withholds continuation. Heap exhaustion also
withholds the whole answer.

The limits come from separate mechanisms:

| Limit | Definition and meaning |
|---|---|
| 8,192 examinations | `snapback4-core/src/meter.rs`, `Ceilings::default`; shared across source rows, lookups and other query work |
| 16 MiB heap | Another default meter; this reproduction reaches it first |
| 1,000 pre-follow events | `schema/timeline.rs::HISTORY_WINDOW`; `timeline/online.rs` copies 50 immediately and `timeline/work.rs` copies at most 950 more pre-admission events |
| 1,000 at first-use adoption | `store/timeline_launch.rs`; newest retained events per current follow, no refill on removal |
| 1,000 device inbox rows | `bind/timeline.rs`; one merged per-reader acquisition floor, independent of the per-author copy window |

Own events and later deliveries can grow past 1,000. There is no ordinary
Following follow-count cap; legacy `author_cap`/`edge_cap` serialization defaults
are not a current graph admission limit. Source floors are global and fixed
at acquisition. Partial sources cannot establish historical event absence on
a device. Existing own-edge, prediction and missing-card fences must remain.

The shipped timeline already keeps originals and reposts together in
`feedPosts.byActorTime = (actorId, at, id)`. Originals use post ids; reposts use
declaration-specific event ids, retained in source slots. Removing an original
removes its event but retains its card and independent repost events. Deleting
a repost removes that event. Planned activity uses repost source/branch
identity instead, so the two cursors and list identities are not interchangeable.

## Executed evidence

The executable is
[following_history_research.rs](../../crates/snapback4-lang/tests/following_history_research.rs).
It adds no interpreter or compiler behavior. The two scale cases are explicitly
ignored in ordinary test enumeration and were run separately, with all three
cases passing. The small handoff counterexample runs in the ordinary suite.

The fixture uses public source rows, real engine seeding, real atomic Following
activation, and the actual query interpreter. It contains 50,000 originals,
one repost and 1,000 principals: the reader, quiet, and 998 unrelated authors.
Quiet has 1,100 old originals and one repost, preceding 48,900 unrelated newer
posts. The reader follows quiet. Activation creates the ordinary 1,000 foreign
copies; it does not copy all quiet history.

The existing-IR control is a direct merge of `feedPosts.byActorTime` for the
viewer and discovered `feedEdges`. Its literal 100,000 discovery bound is
deliberately above the request meter, not a proposed product cap. It has no
new cursor, persistence or authorization mechanism, and is **not** a supported
replacement. The control returns raw event metadata; the history query returns
the activity projection. Neither measured query shapes post bodies or cards.

Final samples were confined to CPU 2, sampled idle beforehand in
[cpu-before.json](cpu-before.json); builds/full-suite work used CPUs 72–79.
The host is shared and affinity is not an exclusive reservation. CPU sampling
is evidence of selection, not a claim that the host stayed idle throughout.
Each cell is one warm-up followed by eleven first-page queries, Rust test
profile (`opt-level=1`), debug assertions on, in-memory SQLite. This is engine
latency, without HTTP, browser, disk durability, network or production-profile
qualification. See [research-cpu2.log](research-cpu2.log); the two earlier runs
are retained as [research.log](research.log) and
[research-final.log](research-final.log).

| Corpus / reader | Median µs | Charged examinations | Probes | Heap charge B | Result |
|---|---:|---:|---:|---:|---|
| 1,100 originals + repost, no unrelated rows / planned | 338 | 44 | 22 | 189,043 | 20 rows, complete, next |
| Same / indexed control | 99 | 23 | 0 | 11,535 | 20 rows, complete, next |
| 50,000 originals + repost / planned | 22,859 | 5,789 | 2,894 | 16,777,476 | unavailable, data null, incomplete, no next |
| Same / indexed control | 105 | 23 | 0 | 11,535 | 20 rows, complete, next |

The indexed control walks all **1,101** unique relevant events in exact order
against an independent full scan of the owned event table, while ordinary
Following contains **1,000**. Adding 48,900 unrelated posts leaves **all seven
meter dimensions identical**, asserted by the test. That establishes the
benefit of actor-index access, not qualification of the proposed new reader.
There is no “after implementation” measurement: no implementation was approved
past this design gate.

The 8,200-follow control fails during opening, with `complete:false` and no
continuation. Its charged examination ledger reports 16,385: the meter retains
failed admission charges, and the existing merge continues attempting heads
after discovery has cut. This number is not a claim that 16,385 row images
were physically read under an 8,192 ceiling. A proposed reader must reserve
atomic progress work and stop before such repeated failed attempts.

The handoff test has quiet at time 0 and hot at times 1–1,101. The inbox
contains time 0 and hot times 102–1,101. It ends at time 0, while the full
history has 101 uncopied hot events **above that endpoint**. Passing the
inbox's time to a new reader cannot recover them. Returning them below the
already rendered inbox would violate chronological order.

## Certificate reproduced

[certificate.txt](certificate.txt) and [certificate.json](certificate.json)
come from `check --cost` on the guide-equivalent
[schema](certificate-project/snapback/schema.q). The calibration's original
saved certificate was not present in this checkout; this reproduces the
compiler explanation independently rather than claiming to copy that artifact.

```text
query history:
  scale: grows with posts skipped by `.authorId = viewer or (exists follows[viewer, .authorId])` before 21 match; reposts skipped by `.actorId = viewer or (exists follows[viewer, .actorId])` before 21 match
  ... filter over ≤ examined ceiling (8192)
  ... probe × examined
```

The JSON class is `grows` and its meter ceilings include examinations 8,192,
heap 16,777,216 and output 1,048,576. The candidate control says `constant`
because it has a literal lane bound, but estimates up to 4,300,043 examinations
and 100,001 lanes and emits `N_WIDE_MERGE`. “Constant” plainly does not mean
“fits the meter” or “guaranteed complete.” No certificate was relabeled to
conceal these facts.

## Design and remaining qualification

LLP 3000.026 §9 specifies a finite engine-birth domain, viewer/store/generation
and graph-revision custody, resumable discovery and refill, exact publication
only after all heads are known, metered private frontier storage and replay
identity. Membership/visibility changes restart the traversal; event removal
shrinks its domain. New backdated births do not extend it. Explicit block
dependencies are necessary: current Following has no automatic block mapping,
and a public event index cannot override a card's authorization.

Without rejections, setup costs O(F) author seeks and O((F+N) log F) heap work;
later pages retain the frontier and cost O(N log F). Storage B-tree seek costs
are additional. Rejections contribute X more candidates, so the honest model
uses N+X. Refill itself must be resumable. A finite eligible birth domain does
not bound scanning of continuous post-bound backdated arrivals; finite
completion under that workload would additionally require a retained index
snapshot or equivalent enumeration mechanism. The proposal states that limit
instead of treating a birth point probe as a physical range fence.
Per-request meters remain unchanged;
one logical page may take multiple preparation requests. O(F+N) transient
durable state replaces followers-times-history copying, with explicit admission
and bounded reclamation. There is no unmetered all-author heap on a device.

The generated random corpus oracle with follow/unfollow/repost/removal/block
changes, meter-boundary/state-recovery tests and parity of the new reader are
**not implemented or claimed** at this stopping point. §9.5 gives their required
matrix. The full-scan control oracle here covers the fixed sparse corpus only.
Existing timeline/device tests validate existing behavior, not the proposal.

## Verification and compatibility

The three research cases pass, including the fixed-corpus full-scan oracle,
unrelated-density meter equality, discovery failure and handoff counterexample.
`./ref-check --verbose` passes: 528 LLP documents, 10,422 references, no errors
or unchecked references. `git diff --check` passes.

`bash snapback4/scripts/test.sh` **passes, exit 0, zero failures in 5,002 s**;
see [full-suite.log](full-suite.log). This includes all 300 Rust test binaries
(1,013 scheduled executions) and workspace doctests, the timeline/Following
tests on the existing server and device implementations, builds, guide/docs
budget, release guard, package/app typechecks and fixture wrappers. The client
pool passes all 322 files: 6,440 tests pass, 47 are explicitly skipped. Those
skips include the four published Darwin capability witnesses on this Linux
host. Both serial model files also pass: 79 tests, including 5,000 app-session
sequences per tier and 3,000 online-client interleavings. Their ordinary counts
and watchdogs were unchanged. These model tests are existing suite coverage,
not the unimplemented history mutation/block oracle.

Retained text logs trim trailing whitespace and trailing blank lines only;
[evidence.json](evidence.json) binds their retained hashes and build settings.

The worktree remained about 14 GiB after builds and the full suite, below the
50 GB limit. Measurements and tests stayed on this host; no other worktree or
unrelated process was modified. Nothing was pushed or published.

An additional repository-root `check-inventories` invocation reports existing
Snapback 1 inventory/guide drift and missing generated demo prerequisites;
see [inventories.log](inventories.log). This check is outside Snapback 4's fence,
was unnecessary for this lane, and changes no result above. No root product or
inventory files were edited to satisfy it.

Wasm: both the full-suite build and a standard locked build measure
**2,117,335 B raw / 639,888 B gzip**. The original 639,941 B cap passes Linux
but leaves only 53 B, less than the required 130 B macOS allowance. The
481 tracked core/device/build inputs checked all match base `547c6113bd`
byte-for-byte. This is inherited measurement drift, not added reader code.
`metrics/wasm-budget.json` is reconciled by **77 B to 640,018 B**, exactly
639,888 + 130. No runtime meter changes. This metadata adjustment is separately
identified in the budget reason and journal; no Mac measurement is claimed.
[wasm.json](wasm.json) binds the artifact SHA-256 and source comparison;
[wasm-standard.log](wasm-standard.log) records the standard build. The serde
family and server-only/Unicode absence checks pass in
[wasm-families.log](wasm-families.log). The attribution build is a static byte
audit, not a latency measurement.

**Persisted bytes:** no production schema, catalog, event slot, cursor,
certificate format, device contract or interpreter source changed. The real
fixture stores are temporary test data. Current Timeline v2 remains unchanged.
The proposed new capability has not been encoded or advertised. The published
Darwin schema fence is left for the separately commissioned Mac run; this lane
used no Mac and claims no Darwin result.

## Reproduction

From `snapback4/`, install the locked dependencies with
`bun install --frozen-lockfile`. These disk-saving build settings preserve the
test profile's optimization and assertions:

```sh
taskset -c 72-79 env CARGO_BUILD_JOBS=8 CARGO_PROFILE_TEST_DEBUG=0 \
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 \
  LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
  cargo test -p snapback4-lang --test following_history_research \
  -- --include-ignored --nocapture --test-threads=1
```

The final measured repetition ran the resulting test binary directly with
`taskset -c 2`, keeping the compiler and the full suite off that CPU. Pick
currently idle CPUs on a shared host instead of assuming these remain free.

From `certificate-project/`:

```sh
../../../target/debug/snapback4 check --cost
../../../target/debug/snapback4 check --cost --json
```

From repository root, the full suite uses the same build environment and
`taskset -c 72-79 bash snapback4/scripts/test.sh`. Standard wasm measurement uses
`taskset -c 18-23 bash scripts/build-wasm.sh` from `snapback4/`, without the
host dev/test profile overrides; family and server-only absence checks use
`node scripts/attribute-wasm.mjs --check-families --check-absent`.

## Scoped LLP orientation

Applied [llp-orient](../../../skills/llp-orient/SKILL.md) read-only before
editing. The fresh worktree's missing `vendor/llp` was initialized locally at
its pinned submodule commit; no skill or submodule pointer was updated.

Scope: timeline engine, owned schema, binder, ordinary/projected merge,
meter, feeds card, compatibility and device acquisition.

- LLP 3000 §§1,4 and LLP 2000.000 §§6–9 govern one interpreter, runtime
  meters and partition custody; this task explicitly authorizes investigating
  the core. The root is in `llp/current`, not foundation.
- LLP 3000.013 §4 (current) removes authored graph caps and owns delivery
  epochs. LLP 3000.016 §§2–3 owns source slots, floors, withheld pages and
  prediction fences; it is not in the current/foundation overlays.
- LLP 3000.026 §§2–4 (current) owns event identities and start-now adoption.
  Its §9 now holds this Draft design, without changing accepted launch behavior.
- LLP 3000.002 (current) forbids treating logical counts as a whole-system
  memory bound. LLP 3000.007.000 §§1–3 (current) distinguishes opening from
  draining a merge; its summary records the shelved wider-read capability.
- LLP 3000.016.000 §0 preserves the shelved all-history-copying ruling and
  explicitly identifies on-demand reading as a separate possible design.

Active risks: uncapped author discovery, unstable roster/visibility, source
versus event identity, missing device coverage, admission/state custody and
the non-contiguous live-inbox window. Updates are limited to this report,
research tests, the feeds card, LLPs 3000.016/3000.026, the measured wasm budget
reconciliation and the append-only journal. Handoff: author decision on §9
before implementation, then `llp-review` of the proposed capability. No
delegation or independent review was run in this lane.


## Round 1 — approved design and internal reader milestone

The 2026-10-06 delegated decisions supersede the D0 design choice above:
exact merge from the first online history page, server-only first, no inbox
splice or history-only block filter. LLP 3000.026 §9 records the approved design.

[The round-1 report](round-1/REPORT.md) records the implementation, oracle,
review dispositions, measurements and remaining work. This is an internal
metadata-reader milestone under the commission's partial-delivery allowance;
there is no public history route, SDK hook or new completeness certificate.
The review exposed an additional liveness question about continuous post-B
follow additions during roster discovery; its disposition remains explicit.

No persisted schema/catalog/IR bytes changed. Linux wasm is byte-identical to
D0 (639,888 B gzip; cap 640,018 B including 130 B macOS allowance). Nothing was
pushed and no other host or worktree was used for round-1 work.
