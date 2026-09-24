# Cal18 scale follow-up: measured stop and remaining work

Astra max implemented the scoped experiments and recipe checks under the
[accepted scale plan](../../../llp/3000.011.001.001-scale-after-clique-030.plan.md).
Code checkpoint: `4fb105d29`, following modeling `877bcaaa2` and its test alignment
`8c4ae4b59`. No count executor, resource ceiling, live accumulator, scheduler or
package was changed. The full delivered-app envelope remains unfinished.

## Acceptance ledger

| Plan item | Result |
| --- | --- |
| Retained 5,000-candidate/4,900-hit recipient-heavy control | Reproduced on the unchanged engine; heap refusal. |
| Existing body/recipient/quiet-chat stress cases | All ten retained `digest_count` cases ran; exact output/refusal, heap, examined rows, writes, Rust allocations and elapsed time retained. These do not form the complete requested one-dimension-at-a-time cal18 matrix. |
| Unchanged delivered cal18 job, varied messages/chats/body/recipients/follows, complete oracle and marker measurements | **Unmet.** Three setup trials stopped before any digest invocation; preserved below. No delivered-app saturation or truncation result is claimed. |
| Store-boundary allocation investigation | 41 alternating pairs, explicit percentile method, retained raw samples and host load; projected decoding avoids unused Rust Values. |
| Qualified engine capacity improvement | **Not shipped.** No full interpreter/authority/coverage/charge equivalence proof; existing conservative SQLite payload allowance alone remains over the limit. |
| Exact refusal and recovery | Existing atomic recipe retained and requalified; additional 99/100/101 message and 999/1000/1001 membership boundary assertions. No resumable design selected. |
| Rolling ranking recipe and independent all-page oracle | Implemented with modeling; window edges, ties, zero scores, changed scores, soft/hard deletion, continuation and non-snapshot policy covered. |
| Separate follow-graph growth/hub/boundaries | Existing timeline suite and explicit latency scenario ran independently; server-only descriptive results below. |
| Fresh Clique, browser rendering/acquisition, native lifecycle | Not commissioned/measured by this follow-up. |

## Retained engine control

Command on Black M5, run-owned checkout/private target:
`CARGO_BUILD_JOBS=4 cargo test -p snapback4-sim --test digest_count -- --nocapture`.
The [full control log](./digest-control.log.gz) includes all trials, not just the
failure. Queries use unchanged job ceilings (16,384 examined, 16 MiB heap).

| Named case | Result | Metered heap | Examined |
| --- | --- | ---: | ---: |
| 1,000 rows, 6-byte bodies, 2 recipients | 1,000 | 1,333,013 | 1,000 |
| 10,000 rows, 6-byte bodies, 2 recipients | 10,000 | 13,330,013 | 10,000 |
| 10,000 rows, 2,000-byte bodies, 2 recipients | null/incomplete | 33,270,013 | 10,000 |
| 5,000 candidates, 4,900 eligible, 31-byte bodies, 50 recipients | null/incomplete | 24,060,341 | 5,000 |
| 999 quiet chats plus 10,000 recipient-heavy rows | null/incomplete | 49,354,788 | 11,000 |

The matched recipient-heavy case decodes 22,940,000 logical heap bytes before
the consumer. Dropping a count's result vector does not eliminate those rows.
Large bodies are a separate stress dimension, not the explanation for this
historical failure. These are server reads; a small result says nothing about
client acquisition.

Review also strengthened the retained control: every successful case now
asserts both its exact count and `complete: true`, including the 10,000-small-row
claim above. The [final rerun](./digest-control-final.log.gz) passes all ten
cases and prints steps and completeness as well as the earlier counters.

## Projected decoding experiment

The ignored test `word_heap::cal18_projection` reuses the existing test binary's
Rust and SQLite native allocator probes and the exact retained Quarry fixture.
The full arm uses `Tx::scan`; the candidate borrows each SQLite JSON image and
uses a test-only Serde seed to retain `id`, `conversationId`, `senderId`, `at`,
`expiresAt` and `tombstone`. Bodies and recipients are skipped without creating
Values or an intermediate Rust String. Both arms retain the same ordered keys
and count the same 4,900 qualifying rows; every retained field is compared
before timing. This is an allocation experiment over public rows, not a second
interpreter or an exposed partial-row API. The candidate performs two catalog
lookups that the control's existing catalog map avoids; that extra work remains
included in its measurements.

Before collection, the test declared 41 samples per arm, alternating AB/BA
within each pair after one untimed validation per arm. Nearest-rank p95 is
sorted sample 39 of 41. All 82 observations are in
[projection-round1.log.gz](./projection-round1.log.gz); no unfavorable point was
discarded. Command:
`cargo test -p snapback4-core --test word_heap cal18_projection -- --ignored --nocapture --test-threads=1`.

| Per traversal | Full decode | Projected decode |
| --- | ---: | ---: |
| Eligible rows | 4,900 | 4,900 |
| Decoded logical heap bytes | 22,940,000 | 3,060,000 |
| Cumulative Rust requested allocation bytes | 44,617,941 | 5,027,885 |
| Cumulative SQLite native requested allocation bytes | 148,366,648 | 148,376,392 |
| Median time | 25.115 ms | 16.501 ms |
| Nearest-rank p95 | 29.376 ms | 19.892 ms |
| Maximum time | 35.557 ms | 27.437 ms |

Host: Black M5 Max, arm64, 18 logical CPUs, 128 GiB RAM, Rust 1.94.0, optimized
test profile with debug information. Target artifacts were privately cloned
from a warm checkout; no shared target or other agent's PID was modified.
[Before](./scale-load-start.txt) and [after](./scale-load-end.txt) load samples
are retained (projection start 8.95/9.52/10.28; end 14.92/10.77/10.71). This was
a shared host; timings describe this decoder trial, not a production release
speedup or an online tail-latency guarantee. The existing native allocation
probe disables SQLite lookaside and records requested allocation, not RSS.

**Stop:** Rust payload allocation improved, but that is insufficient to ship
a capacity claim. SQLite's cumulative native total includes store/cache and
execution allocation, so it is neither the product payload ledger nor a
16 MiB violation by itself. Applying the existing conservative metered SQLite
payload allowance to these same row/key images costs 24,320,000 bytes before
projected Values and filters. The experiment did not establish a cheaper safe
allowance or integrate projection with rule fields, expiry, dependencies,
unknown coverage, maintained/recorded images and every Rows adapter. No fields
or charges were dropped from the production interpreter. Projection remains
promising for Rust allocation, and a qualified engine improvement remains open.

## Full delivered-app fixture stop

The attempted matrix compiled the eight exact `.q` files from the retained
[cal18 source](../../../benchmarks/runs/2026-09-23-snapback4-clique-astra-0.3.0/astra/source/snapback/digest.q)
without modifying them. It planned a whole-store Rust oracle, actual job chunk,
effect/marker measurements, and separate messages, chats, body, recipients and
follow cases. It did not reach any digest execution:

1. [Trial 1](./cal18-envelope-round1.log.gz): fixture compilation failed because
   `Value` does not implement `Ord` for its proposed `BTreeSet`.
2. [Trial 2](./cal18-envelope-round2.log.gz): corrected the oracle's keys to
   strings, then `Engine::load` correctly refused timeline-mapped import with
   `E_TIMELINE_IMPORT`.
3. [Trial 3](./cal18-envelope-round3.log.gz): `Engine::seed_at` correctly refused
   the same import; fixture setup must use authored operations for these rows.

The three-round stop was enforced. The [unfinished draft](./unfinished-envelope/README.md)
is retained as evidence, outside every Cargo test target. A temporary read-only
Runner meter accessor was removed with it. No fourth setup trial was disguised
as another test and no failed test was described as a product defect.

Source inspection still identifies a completeness question worth testing:
the delivered job loops `members ... first 1000`, while members has only a
50-per-conversation cap, not a per-recipient cap. It counts `first 10001`
messages without an explicit overflow require. Follows does have 1,000-per-endpoint
caps. These are static findings, not an executed proof of an admitted truncated
digest. An operation-seeded full-app matrix is the named remaining Plan A work;
it needs an author decision to resume beyond this recorded stop.

## Exact refusal recipe and separate ranking/graph evidence

The already supported jobs-card recipe has a real 1,000-per-principal membership
cap and counts up to 101 qualifying messages to refuse above its 100-message
product bound. Its schema/execution differs from the delivered cal18 app.
The new boundary assertions extend this existing simulator fixture, not the
stopped full-app setup. The [12-test run](./digest-refusal-boundaries.log.gz)
passes, including actual inter-transaction expiry, tombstone, deletion,
read advance, leave/rejoin, crash/restart, repeated/empty periods, private
markers, and rollback around marker/effect admission. It confirms 999 and
1,000 one-message memberships, each with one 103-byte canonical marker and one
effect. The attempted 1,001st membership refuses the named cap before a digest
can skip that extra chat. The final strengthened assertion also creates a valid
target conversation and checks the exact cap reason; final clean verification
is retained by the integrator.

The existing exact examination boundary remains: 1,000 memberships plus 14,380
period messages uses 16,384 examinations and succeeds; one more message parks
without a new effect. Row width and other work can refuse sooner. Recovery is
to inspect the parked run, change supported scope/design, and rerun only when
one recipient fits. Completed markers remain and skip earlier recipients;
there is no multi-transaction live accumulator or exactly-once provider claim.

The compiled Trending oracle test in the modeling checkpoint compares every
page with an independent sort/filter of 85 input posts, spanning 25 lanes and
both exact time edges, zero scores, ties, score changes, removal and deletion.
The measured first page used 36 examined rows, 964 steps and 37,260 heap bytes,
with `complete: true` and no cut. Existing `why` exposes the lane bound and
selected index, now with key bindings; `run --json` gives actual consumption
and cut. The guide explicitly states that cursors are not snapshots.

The integrator separately ran [timeline verification](./verification/README.md):
54 timeline and 12 feed-bridge tests, followed by the existing 20-sample latency
scenario with 5/500-follow readers and a 901-follower hub. It exercises 1008/1009
registration and 5921-edge boundaries, bounded backfill, rollback and purge.
Its fixed recipe-then-timeline order and shared Air host make timings descriptive;
no timeline executor changed here. Server snapshot rows/bytes are not client
acquisition, rendering or native lifecycle evidence.
