# HV round 3 — migration interleaving and private witness reservation

Both round-2 defects are repaired, with regressions that fail on the unchanged
round-2 production paths after merging main. The pricing scanner still accepts
only canonical tagged spellings; canonical publication/restore protect its
metered callers. This round does not make it a general JSON pricing parser.

Merged origin/main `16fb4aa721` in `5b5e8db91c` before implementation, preserving
LL, SR and both journal sides. The await inventory was regenerated through
`awaitBoundary()`. Nothing pushed or published; no word-index deferral.

## Migration during a save

The preliminary format read remains a dispatch hint. Before issuing any bucket
writes, the strict read-write transaction reads its own marker and routes from
that value. If another adapter committed migration to format 4, the untouched
bucket transaction aborts and the complete save retries through RowPages. The
page-directory revision guard and final current() predicate still apply. A false
predicate aborts the complete delta. Metadata-only writes do not need a row-layout
read; they keep their existing strict transaction. The extra marker read for a
row save is explicit in the 10,000-row test: 64 bucket reads, one marker read,
64 bucket writes and one strict transaction without migration.

The Chromium regression starts at physical version 3, logical format 3, with
packed row, stage and base records plus metadata. It pauses the completed
readonly marker transaction's callback, independently migrates with another
built-in adapter, observes committed marker 4, then resumes. It covers save,
saveIfCurrent (true and false), and the actual WebWorkerHost.commitIf path
(true and false). No bucket is even written after migration; point reads and
full loads agree, with no stray direct or bucket rows. Updates, insertion,
staging deletion, base replacement and metadata share the final strict save.
A Worker finish acknowledgement occurs only after accepted durable completion.

The Worker transport in that host test is a prepared-delta RPC fixture. Today's
real Worker restricts conditional operations to metadata; row deltas exercise
the host's shared adapter, not a claim that the real Worker exposes a new
conditional row operation. The existing actual Worker/acquisition tests also run.

`idb-before.log.gz` has three detecting failures on round-2 web-idb.ts: each mode
writes three buckets after migration. `idb-after.log.gz` passes all three modes.
The later metadata-only correction and the full final browser recheck are
recorded separately. LLP 3000.007 §20.4 corrects the round-2 report's false
claim that reopening/version-error invalidation fenced this in-save window.

## Single-candidate admission

The fallback reserves `decode_reservation + rule_scratch` against the saved
caller ceiling before entering its prepaid scope. The 32-candidate decision and
reservation retain their existing decoder, witness and result-vector bounds.
A missing byte of the original single-candidate allowance refuses before any
storage scan or lookup. Nested caller ceiling and occupied heap are restored on
both success and error. The production change is SQLite-gated and absent from
web wasm. The real cold snapshot currently creates an unbounded Runner; this
valve protects finite callers and nested saved allowances, not a claim of a new
finite cap on heavy snapshot production.

The new test wraps a real SQLite transaction to count reads, and measures Rust
allocation around certification with the existing counting allocator. The source
rule is `exists members[.conversationId, viewer]`; members is not uniformly
readable. Witness values are 1 and 80,000 bytes; source payloads are 0 and
256 KiB. Both direct and nested scopes exercise a decoder-only ceiling, one byte
less than the complete reservation, a nearly spent allowance and exact admission.
The admitted control actually decodes the large witness and requests one source
candidate at a time. Refused cases issue zero scans/lookups and allocate only
249 bytes for refusal handling, independent of the hidden payload.

For an empty source payload the fixture's decoder is 23,136 B and scratch is
1,301,968 B, for a full reservation of 1,325,104 B. Before the fix, an 80,000-byte
witness allocated 87,085 B against a 23,136 B ceiling, made four storage accesses
and returned success; heap_peak remained 23,136. Afterward that case refuses
before all storage access. With the full reservation it succeeds, proving the
control reaches the private decode. The largest source/witness case allocates
about 349 KB under a 5,519,408 B declared reservation. This is cumulative Rust
allocation, not RSS or SQLite native allocation, and is deliberately independent
of the restored post-call heap_peak. `witness-before.log.gz` fails on round-2
admission; `witness-after.log.gz` passes, including the earlier page-limit observer.
LLP 3000.015 §3 now states the complete historical reservation.

## Canonical image invariant

The scanner still recognizes only canonical `{"Row":` / `{"Map":` spellings.
It was not made exact for whitespace, escaped tags or arbitrary valid JSON.
Publication compares the staged substring with the entire canonical encoding;
noncanonical stages and restored rows normalize before entering the row map.
Debug assertions at restore and ordinary/staged writes check the actual image
against that canonical serialization. The existing noncanonical staged-image
regression continues to check whitespace, escaped tags, nested maps/arrays and
canonical-equivalent metered admission. LLP 3000.007 §20.4 states this invariant
and the scanner's limitation explicitly.

## Validation and artifact

Final wasm has **zero byte growth** from the merged baseline. The complete
raw wasm binaries, including optimized output, compare byte-for-byte equal:

| Production build | Raw B | Gzip B | Gzip delta from merged baseline |
| --- | ---: | ---: | ---: |
| Without `wasm-opt` on PATH | 2,065,883 | 605,320 | 0 |
| With Binaryen 132 on PATH | 2,033,727 | 602,215 | 0 |

The optimized result is 1 B smaller than round 2's historical 602,216 B, due to
the integrated baseline. The fixed **593,719 B** cap remains exceeded by
**8,496 B** with Binaryen, **11,601 B** without it. WD's separately reported
583,325 B source reductions are not in the merged `origin/main` snapshot; this
lane did not import or claim them. No ceiling was raised. The baseline build
preceded the memory assertion change and already contained the SQLite-only
fallback correction, which is compiled out of web wasm. `artifacts.json` binds
both baseline/final files and the source/dist artifacts; gzip uses the unchanged
production filename and level 9. Trial assertion layouts perturbed release
instruction order; the final explicitly debug-only checks preserve the original
release expression and both baseline binaries.

The affected core target passes **169** tests with one declared ignore (its
self-spawned detecting child also passes). The affected device targets pass
**1,390** tests with five declared ignores. The final memory-image checks pass
**3/3**, generated heavy regression **1/1**, whole guide **99/99**, delivery await
classification **1/1**, and codec census **26/26**. The browser affected run had
two failing leaves, corrected in a **48/48** page/review/navigation recheck;
the remaining durability, Worker control and acquisition checks passed. Package
build/typecheck and reference validation pass.

Ran `scripts/test.sh` **exactly once**, exit **1**, with Binaryen 132 on PATH.
Its exact summary is:

```text
== 2 failure(s) in 1405 s
   wasm build
   client tests
```

Every failed stage/test and its disposition:

| Failure | Classification | Disposition |
| --- | --- | --- |
| `wasm build`: 602,237 B gzip in the single suite | Ours, retained HV size debt | Final source is 602,215 B; still 8,496 B above the unchanged cap |
| `IndexedDB model: reset termination before-commit preserves one complete transaction` | Ours, model maintenance exposed by the new callback | Corrected request scheduling; focused recheck passes |
| `IndexedDB model: reset termination after-commit preserves one complete transaction` | Ours, same model deficiency | Same correction; focused recheck passes |

Baseline failures: **0**. Environmental failures: **0**. All other full-suite
stages pass. Rust passes **4,350** tests (4,333 target tests plus 17 doctests),
with 33 declared ignores. Clients pass **5,248**, fail the two leaves above,
and have ten existing skips, zero cancellations. Fixture wrappers pass **9/9**;
serial client models pass **79/79**, retaining the full 10,000 session and
3,000 online sequences. The inherited 60-second suite budget remains exceeded.
The wasm stage ran before the final assertion-layout correction; the final
build still fails the same unchanged cap. The suite was not repeated.

The final generated 6,000-row acquisition regression measures **20,551,766 B
peak / 15,029,122 B retained**, against **37,727,851 B** for the old retained
representation: **54.5%**. The largest bridge string remains **302,739 B**.
Counts, complete acquisition and complete offline restore pass. No heavy-account
timing campaign was repeated. Earlier medians are historical; the raw elapsed
time in this allocator test overlaps other checks and supports no new latency
or phone-memory qualification claim.

`negative-control-inputs.json` verifies that each defect's production file in
round 2 (`795fc9b506`) is identical to the merged baseline (`5b5e8db91c`) used
for the failing regressions. `source-before-suite.json` and `source-final.json`
bind the source revisions. During the run, the metadata-only path and explicit
marker-read count were corrected before the client stage, and the canonical
assertions were arranged to preserve release code. Focused final checks cover
those changes. The full run subsequently exposed two reset-IDB model failures:
its fake requests returned a synchronous result but never dispatched `onsuccess`,
and its transaction completed before request callbacks. The model now waits for
those callbacks, preserving both fault positions and every original custody
assertion. The focused reset-model recheck passes **2/2**. This test-only repair
came after the full client stage; its two failures remain in the single full-run
record. No suite count, fault recipe, timeout or budget was relaxed.

## Reproduction

From `snapback4/`, Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, `CARGO_BUILD_JOBS=8`,
`RUST_TEST_THREADS=8`:

```sh
cargo test -p snapback4-core --lib cold_basis -- --nocapture
cargo test -p snapback4-core --lib
cargo test -p snapback4-device --lib --tests
cargo test -p snapback4-device --lib memory::tests -- --nocapture
cargo test -p snapback4-device --test heavy_acquisition -- --nocapture
cargo test -p snapback4-lang --test guide
node --test packages/snapback4/test/web-pages.test.mjs packages/snapback4/test/web-review.test.mjs packages/snapback4/test/web-durability.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/web-worker-control.test.mjs packages/snapback4/test/acquisition.test.mjs
node --test packages/snapback4/test/wasm-codec-census.test.mjs
node --test --test-name-pattern='every delivery await' packages/snapback4/test/delivery-fault-matrix.test.mjs
bash scripts/build-wasm.sh # run once with Binaryen 132 on PATH, once without it
bash scripts/test.sh      # exactly one full invocation in this round
```

The failed-before tests use the same regression bodies with the two production
files from round 2; `negative-control-inputs.json` proves those files did not
change during the main merge. The browser test uses real Chromium and IndexedDB;
its callback hold is in the test, not injected into production source. The Rust
control uses real in-memory SQLite rather than an Arc-sharing memory fixture.
All logs are retained verbatim (gzip archives after completion). Test/build
concurrency is allowed here; no overlapping execution is a timing comparison.
