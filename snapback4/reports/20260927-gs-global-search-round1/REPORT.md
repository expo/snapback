# Lane GS round 1 — bounded membership search

2026-09-27. Implementation commit `b2d8b2957`. Implements the supervisor's narrowed one-read contract in
[LLP 3000.024](../../../llp/3000.024-global-search-beyond-one-read.rfc.md).
Multi-request search state and stateless multi-pass selection remain future
RFC work, with §4's counterexamples preserved. No push or publication.

## Implementation, by file

Paths below are relative to `snapback4/` unless stated otherwise.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/membership_search.rs` | Eligibility for the existing uniform, single-scope membership form (inherited-parent reads keep their existing evaluator); incremental key discovery; compact authorized heads; bounded best-head word expansion with metered rescans; explicit opening refusal and live drain continuation. Additional scalar pins such as tombstone=false survive. |
| `engine/read.rs` (same core source directory) | Shared admission separated from word enumeration; routes eligible membership merges; prepays candidate access for the new key/head consumers; releases dropped token and binding scratch. Other transient aggregates retain their existing exhaustion semantics. |
| `engine/extrema.rs` | Authorized streaming consumers for compact membership keys and ordering tuples. |
| `engine/word_merge.rs` | Shares the established page/cursor/shape-rewind finishing code with the new merge; specialized view merges keep their existing route. |
| `engine/authorized_point.rs`, `engine/authorized_scan.rs` | Selected-field candidate fetch stays inside declared-size decoder reservations, physical authorization accounting and the ordinary row/field rule boundary. |
| `engine/row_views.rs` | Adapts the existing full-row scan call to the optional selection argument. |
| `crates/snapback4-core/src/rows.rs` | One-row selected-field adapter contract and shared-image fallback for device stores. |
| `crates/snapback4-core/src/store.rs`, `store/selected.rs` | SQLite borrows stored JSON, skips unused values while decoding, and materializes only requested head inputs; no full-row JSON DOM. |
| `crates/snapback4-core/src/error.rs` | E_SEARCH_OPEN, authorized count/lower bound, exhausted resource and ceiling, site and grouped rewrite. |
| `crates/snapback4/src/serve.rs` | Query refusal responses explicitly carry `complete: false`. |
| `crates/snapback4/src/scale.rs`, `scale/search.rs` | Four independent structural search classes, including group reads inside inlined returned-shape helpers; unit fixture pins the original/bare/decorated distinction. |
| `crates/snapback4/src/verbs.rs` | Shows search diagnostics at ordinary check and includes them in JSON and the cost certificate; query refusals in CLI JSON explicitly carry complete=false. |
| `crates/snapback4-lang/src/bind/mod.rs` | The merge walker visits derived-array loop domains so returned shapes do not hide their source membership merge. |
| `crates/snapback4-lang/src/diag.rs` | Routes all five new `why` entries to the search card. |
| `crates/snapback4-lang/src/guide/codes.rs`, `guide/why.rs`, `guide/why/SEARCH.md` | Registers and explains E_SEARCH_OPEN, N_SEARCH_UNSCOPED, N_SEARCH_OPEN, N_SEARCH_WORDS and N_SEARCH_SHAPE. |
| `crates/snapback4-lang/src/guide/search_all.md` | Shorter implemented contract, examples, measured envelope, grouped fallback and device coverage caveats. |
| `crates/snapback4-lang/tests/guide/definitions.rs`, `guide/refusal_actions.rs` | New-code census facts and concrete recovery instructions. |
| `crates/snapback4-sim/tests/membership_search.rs` | Six regressions described below. |
| `crates/snapback4-sim/tests/search_global/forms.rs` | Existing shared server/device fixture now expects the lean plan's complete 3,000-member pages and new examined accounting, replacing the deliberately superseded ~2,700 heap cutoff. |
| `crates/snapback4/examples/gs_search_probe.rs` | Comparable first/continuation meters, refusal evidence, configurable boundary sampling and a disposable calibration-copy extension with empty chats. |
| `../llp/3000-snapback4.explainer.md` | Updates the root scope record from the round-0 handoff to the supervisor's narrowed decision. |
| `../llp/3000.024-global-search-beyond-one-read.rfc.md` | Supervisor Decision and implemented scope; future contracts remain open. |
| `JOURNAL.md`, this report and JSON evidence | Dated record, measurements, reproduction and qualification. |

Rules precede aggregation, head ordering and result shaping. The head field set
includes read-rule dependencies, index fields, expiry, remaining search terms,
filter inputs and field-authority owners; complex filters/derived surfaces
conservatively request all fields. Full result images are fetched only for
emitted hits, then shaped through the existing machinery. There is no saved
frontier or new cursor encoding. A refill rescans the words and charges again.
Reported heap is the allocation allowance ledger after scratch releases, not
process RSS. A transient reservation can hit its ceiling even when the later
reported retained allowance is lower.
No logical meter, cursor limit, authorization allowance or Wasm ceiling rises.
The card is 89 lines versus 147 before this lane.

## Forms and diagnostics

The existing newest-first form compiles unchanged:

```quarry
query searchNewest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.conversation, viewer] last 20 by .at after c
```

The existing grouped fallback compiles and pages chats with bounded previews:

```quarry
query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 20 by .conversation where exists (messages[conversation = .conversation] matching q by .at) { conversation, hits: messages[conversation = .conversation] matching q last 3 by .at }
```

The original unscoped form remains accepted with its existing disclosure
semantics: `messages matching q where not .tombstone last 20 by .at after c`.
`check` now gives N_SEARCH_UNSCOPED and the membership rewrite. It does not
silently reinterpret that query or claim that its hidden-row dead end is fixed.
N_SEARCH_OPEN identifies one-read opening; N_SEARCH_WORDS names inner word
work; N_SEARCH_SHAPE catches `{ *, peers: searchPeers(.conversation) }` and
rewrites it to the bare page above plus separate reads per distinct chat.
Every entry has a site, concrete rewrite, registered code and `why` entry.
Use `snapback4 guide search` to open the card containing the `search_all`
section. These are CLI diagnostics; valid compiler/guide examples gain no notes.

## Measured envelope

Same Linux host, Rust 1.97.0, default ceilings: examined 8,192; index entries
16,384; rule probes 8,192; steps 1,000,000; heap 16,777,216 B; output 1,048,576 B.
SQLite in-process debug query, three warmups and twenty first-page samples;
p50/p95 are ordered samples 10/19. First and second pages have strict global
(at,id) order and no duplicate IDs; an unreadable newest sentinel never appears.
Host sharing and qualification work make latency noisy. No throughput claim.

The dense one-word, 30-hit-per-chat, 20-hit-page fixture's largest count at
which both first page and continuation complete is **4,076 memberships**.
At 4,077 both pages return 19 hits, incomplete, with a working next. At 4,096
opening cannot produce its first full hit and gives E_SEARCH_OPEN. At 10,000
discovery refuses after 8,192 authorized keys, explicitly a lower bound.
The total cannot be counted after the read's budget is exhausted.
[synthetic-boundary.jsonl](synthetic-boundary.jsonl) records the adjacent
4,076/4,077 measurements and the first-hit refusal at 4,096.

| Memberships | First / next-page rows | Complete / next | Examined | Heap B first / next | Steps | Output B | p50 / p95 ms |
|---|---:|---|---:|---:|---:|---:|---:|
| groups=1000 | 20 / 20 | True / True | 2040 | 2788449 / 3620886 | 19196 | 2131 | 197.178 / 230.839 |
| groups=3000 | 20 / 20 | True / True | 6040 | 8355425 / 10661862 | 63196 | 2131 | 455.974 / 523.523 |
| groups=10000 | refusal / — | False / False | — | — / — | — | — | 211.106 / 230.275 |

All counters and raw samples: [synthetic.jsonl](synthetic.jsonl).

Every refused read has a reason and grouped rewrite.
[opening-refusal.json](opening-refusal.json) captures a real CLI
`complete: false` / E_SEARCH_OPEN response from the 8,000-member copy. The API does not attach a
meter snapshot to a refusal; those fields are unavailable, rather than invented
or measured by relaxing the meters. The refusal itself names the exhausted
resource and its unchanged ceiling. First and continuation heap differ because
cursor validation and decoding also cost work on every membership.

| Memberships × words × hits | Examined | Heap B | Output B | Complete / next |
|---|---:|---:|---:|---|
| groups=100,words=1,hits=1 | 220 | 363961 | 2111 | True / True |
| groups=100,words=1,hits=30 | 240 | 384481 | 2131 | True / True |
| groups=100,words=4,hits=30 | 600 | 814561 | 2731 | True / True |
| groups=100,words=32,hits=30 | 3960 | 4828641 | 8331 | True / True |
| groups=500,words=1,hits=30 | 1040 | 1449953 | 2131 | True / True |

The 32-word fixture now completes with bounded head memory. Its additional
candidate/index/step work is charged again on refills; no fixed word cap or
unmetered rescan was added. More words, misses or larger rows can still refuse.

## Calibration copy

The supplied viewer has **100** memberships in a 1,002-chat corpus; one readable
chat contains coffee hits. Every baseline-completing shape still returns the
same data and the **same cursor token**, verified by CLI JSON comparison in
[equivalence.json](equivalence.json). Successful second pages are complete,
strictly ordered and disjoint. The original non-uniform query's []/false/no-next
result and meters are unchanged; it receives its new check-time diagnosis.
The original source database is never opened by SQLite or the engine; its
database, WAL and SHM retain their
round-0 hashes. All seeding/adoption uses copies.

| Query shape | Examined | Heap B first / next | Output B | p50 / p95 ms |
|---|---:|---:|---:|---:|
| messaging.gsOriginal | 1 | 36 / — | 12 | 333.427 / 348.276 |
| messaging.gsbare | 141 | 432575 / 610236 | 8251 | 14.807 / 15.417 |
| messaging.gssender | 161 | 612643 / 790304 | 18271 | 16.533 / 18.981 |
| messaging.gschat | 161 | 571095 / 748756 | 15271 | 15.595 / 15.997 |
| messaging.gspeers | 2121 | 10612359 / 10790020 | 503551 | 100.136 / 101.509 |
| messaging.gsoriginalFixed | 2161 | 10863931 / 11041592 | 520591 | 102.868 / 104.178 |
| messaging.searchMessages | 201 | 785647 / 963308 | 25711 | 18.069 / 18.135 |
| messaging.gssenderChat | 181 | 693579 / 871240 | 25291 | 17.243 / 17.307 |

[calibration.jsonl](calibration.jsonl) retains all counters and timing samples.

Bare heap falls by 122,403 B (22.1%). Repeated peer decoration still dominates:
the old full shape is 10,863,931 B heap and 520,591 B output. The final builder's
DM-only helper is 785,647 B heap and 25,711 B output. Its output is requested
shape work, not eagerly retained head payload. Rescanning and emitted-row
reauthorization add 19 examined units on this sparse corpus.

To measure a calibration-shaped envelope beyond this viewer's actual 100
memberships, the probe creates fresh disposable copies and seeds empty chats
with 29-character group IDs, one membership each, retaining the real messages
and decorations. This is explicitly an artificial extension, not a claim
that the calibration user belongs to thousands of real chats.

Binary search with three warmups plus one measured sample per count finds:
**5,493** memberships for both bare pages; **5,317** for both final-builder
pages. Adjacent counts 5,494/5,318 keep the first page complete but hit heap on
the second. The 8,000-member extension refuses opening with E_SEARCH_OPEN and
the 16,777,216-byte heap ceiling. This contrasts with the dense fixture's
examined-bound envelope: cumulative reservations for repeated scope and cursor
work still matter even with compact retained heads. The supervisor's expected
discovery limit holds for the dense fixture; it does not hold universally.
No charges or ceilings were loosened to hide this result.

[calibration-boundaries.jsonl](calibration-boundaries.jsonl) records every
binary-search result, including successful and failing adjacent counts.
Twenty-sample measurements at each successful boundary confirm those results:

| Shape and memberships | Examined | Heap B first / next | Steps | Output B | p50 / p95 ms |
|---|---:|---:|---:|---:|---:|
| messaging.gsbare / 5493 | 5534 | 12931972 / 16674406 | 110079 | 8251 | 520.692 / 522.479 |
| messaging.searchMessages / 5317 | 5418 | 12935708 / 16561806 | 107923 | 25711 | 515.718 / 517.998 |

[calibration-edge.jsonl](calibration-edge.jsonl) retains the raw samples.

## Tests and qualification

The six new regressions prove:

1. Full walks equal the existing explicit merge for tied times, multiple
   overlapping words, additional search terms, expiry, tombstones, hidden
   sentinel rows and an unused 20 KB payload.
2. Forty overlapping words deduplicate IDs and charge repeated expansion.
3. Examined/heap/step/index-entry/rule-probe opening failures have E_SEARCH_OPEN, count, site, envelope
   and grouped rewrite.
4. A drain cut follows the last emitted hit and produces a usable continuation.
5. Membership revocation between pages removes authority on resume.
6. Every examined ceiling below a full page either explains failed opening or
   emits a nonempty page with next; no unexplained empty terminal outcome.

Affected checks: membership regressions 6/6; certificate unit 1/1; server
search_global 17/17; device search_global 50/50 (memory and SQLite); search_merge
11/11. The whole guide passes **86/86**, including compiled card examples,
new-code census and recovery instructions. Frozen Bun install passes.
The final core library check passes 142 tests with one ignored.
Final source/reference audits and full-suite qualification are below.

Exact full-suite result: **`== 1 failure(s) in 1468 s`**, exit **1**.
Every phase ran. The **only failure is lane-owned: `wasm build`**. Its artifact
was 2,011,380 raw / 580,955 gzip B, 8,114 B over budget. All Rust tests, fixture
wrappers, package/app checks, client tests and client models passed. There were
**no baseline or environmental failures** in this round. The round-0 clock/watch
intermittents did not recur. The inherited 60-second suite target was exceeded;
no timeout or test budget was raised.

The suite began during the final audit. The compact-consumer preflight was
subsequently restricted to its two new consumers; diagnostic wording/routing,
CLI refusal metadata and added meter assertions received final focused checks.
A final eligibility guard also keeps inherited-parent reads and specialized
view merges on their existing evaluators. Dense 4,076 and all eight calibration
variants were re-probed: every meter and first/second-page outcome matches
the recorded measurements. Search regressions/merges rerun
6/6 and 11/11; read-through and review fixtures pass 9/9 and 3/3.
The final core/search/certificate/whole-guide results and separately rebuilt
Wasm artifact are recorded in [qualification.json](qualification.json).
The full suite ran **once**, not again after those scoped checks. Final Wasm
is 580,877 gzip B (8,036 over), as detailed below. This branch is **not qualified
for integration/publication while that size gate remains red**.

[qualification.json](qualification.json) binds the full suite log by SHA-256;
[suite-failures.txt](suite-failures.txt) contains the complete failing gate
messages. Final reference audit: 518 LLP docs, 9,615 refs, zero errors and zero
unchecked. `git diff --check` passes; every changed source file is under 1,500
lines (largest `engine/read.rs`: 1,439).

Earlier development failures were **lane-owned and corrected**:

- `w13e_dense_100`, `w13e_dense_500`, `w13e_dense_1000` initially failed the
  old 3M+40 examined assertion (three server failures and both memory/SQLite
  versions on device, six failures). The intended lean plan uses 2M+40;
  the new answers and adjacent envelope are independently measured.
- Whole-guide `definitions::w11_every_registered_code_quotes_its_definition`,
  `w14a_compact_reads_and_wide_note_qualify_word_expansion_and_continuation`,
  and `w9a_held_search_leads_with_coverage_then_cost_then_refusal` initially
  failed. The code census and retained coverage/continuation prose were fixed;
  the final complete guide run passes all 86 tests.
- `independent_search_cost_axes_include_inlined_peer_helpers` initially missed
  the returned collector around an inlined helper. The classifier now visits
  that shape and passes the real calibration certificate and its unit fixture.
- Probe/build corrections included Rust/API invocation mistakes, the CLI
  package's nonexistent `--lib` target (use `--bin snapback4`), and provisional
  probes that unwrapped expected refusals/unavailable pages. The final probe
  records those outcomes explicitly. A direct `why` check caught the default
  language-card routing; all five codes now route to search. None remains open.

No test ceiling, timeout or assertion was weakened to conceal an unexpected
failure. Only deliberately changed meter/envelope pins were updated.

## Deviations, open problems and reproduction

Neither multi-request protocol is implemented, as explicitly directed. At
10,000 memberships the result is a coded incomplete refusal, not a complete
page or invented continuation. An incomplete discovery can supply only a
lower-bound membership count. Existing non-uniform runtime behavior and
ordinary grouped retry semantics remain in force; their check-time rewrites
explain the supported alternatives. No snapshot or retained work is promised.

The remaining lane-owned integration blocker is **Wasm size**. Same toolchain,
`build-wasm.sh`, no wasm-opt selected: baseline **1,981,512 raw / 572,053 gzip B**;
final **2,011,417 raw / 580,877 gzip B**. Delta **+29,905 raw / +8,824 gzip B**.
The unchanged ceiling is 572,841 B, exceeded by **8,036 B**. This is the complete
lane artifact delta, not inferred per-function attribution. The final isolated
build fails with that exact measurement; the full suite's earlier artifact is
recorded separately above. A no-inline experiment and Binaryen size passes did
not recover the excess and were not adopted. No budget file or build gate was
changed. Integration needs a measured size reduction before this can qualify.
Reproduce with `cd snapback4 && scripts/build-wasm.sh`.

The search is still intentionally bounded to one read. Reproduce discovery
refusal with `target/debug/examples/gs_search_probe --synthetic 10000`;
see §4 of the RFC before proposing work-token/session progress beyond it.
The original non-uniform query still demonstrates its old runtime dead end;
its new diagnostic supplies the exact membership rewrite. Grouped search
pages chats/previews and retains its existing inclusive retry/terminal-stall
rules; it is not a guarantee of all messages across an arbitrarily costly chat.

Implementation annotations cite the governing LLP 3000.024 and continuation
spec 3000.007.000, rather than mechanically tagging search decisions as
LLP 3000.019. The latter does not govern this new access plan.

From the repository root, with the pinned toolchain on PATH:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
cd snapback4
bun install --frozen-lockfile
cargo build -p snapback4 --example gs_search_probe --bin snapback4
python3 reports/20260927-gs-global-search/prepare.py \
  --evidence /home/ccheever/sb4-intent/gs-store \
  --out target/gs-round1-reproduction --binary target/debug/snapback4
target/debug/examples/gs_search_probe target/gs-round1-reproduction/.snapback4/store.sqlite
target/debug/examples/gs_search_probe
target/debug/examples/gs_search_probe --synthetic 4076
target/debug/examples/gs_search_probe --synthetic 4077
cargo test -p snapback4-sim --test membership_search
cargo test -p snapback4 --bin snapback4 scale::search
cargo test -p snapback4-sim --test clique search_global
cargo test -p snapback4-device --test device search_global
cargo test -p snapback4-sim --test search_merge
cargo test -p snapback4-lang --test guide
scripts/build-wasm.sh
scripts/test.sh
```

`prepare.py` refuses an existing destination and validates source hashes. The
probe's `--calibration-extend COPY.sqlite COUNT` **writes to its supplied copy**;
make a fresh SQLite backup of the adopted reproduction database for each lower
count (reusing a higher-count store would leave extra memberships). It adds
COUNT−100 empty chats and measures the bare and final-builder forms. Set
`GS_PROBE_SAMPLES=1` for deterministic boundary searches; leave it unset for
three warmups and twenty timing samples. The 8,000 experiment and exact
boundaries are not thresholds to hard-code into the runtime.

All full logs remain under `target/lane-gs-round1/`; the report's qualification
JSON binds the suite log by digest. Report artifacts contain counts and timings,
not database payloads, credentials or session tokens.
