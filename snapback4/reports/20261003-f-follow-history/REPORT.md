# Lane F — older Following history experiment

2026-10-03, eb1000, branch `sb5/f-follow-history`. Base:
`22f2207f3fadb355f2964ba0e463e002e16c3f07`. No push or publication.

The prototype implements **all retained pre-follow history**, selected only by
`maintain feed: timeline experimental history all`. Ordinary declarations,
inferred Following views, device floors and runtime meter ceilings keep their
existing contract. [RFC 3000.016.000](../../../llp/3000.016.000-older-following-history.rfc.md)
is **Review**, for Charlie; its §1 states the semantics/resource question and
§6 states the cost of default shipping. This is not a default-policy decision
or a newly paved guide form.

## API and decision

The explicit declaration is version 3. Reads retain the existing
`feed[viewer] after c last 20` spelling. An immutable birth index on existing
Work records defines the finite pre-follow range below the edge epoch. The
ordinary fifty immediate copies remain; actors already exhausted by those
fifty need no work task. Larger histories are copied in metered chunks, with
ordinary event/reader/epoch copy identities, tombstone checks, atomic cursors,
and persistent fair turns across declarations and within the version-3 work
queue. There is no multi-actor frontier heap to allocate or discover before
the first copy. Whole-reader feed reads withhold data and continuation while
backfill/cleanup remains pending or parked. Write-context probes and system
reads of this experimental Feed are refused; maintained aggregates over it
are unsupported. The read restriction is part of the explicit experiment.

Same-name version-2/version-3 changes refuse. A fresh declaration can start
now over existing retained sources/current follows, with fresh declaration
slots/epochs and the unchanged aggregate 5,000,000-copy activation ceiling.
This does not reconstruct historical deliveries. A 1,200-event / 4,200-follow
activation correctly refuses its 5,041,200-copy estimate before writes.

Recommendation: choose frozen full history **if older events must be present
in Following**, accepting the storage and complete-page delay. Keep the
1,000-window/profile escape as the default until Charlie selects those goals.
A new full on-demand merge/cursor service was not cheap enough to prototype
honestly here; its component and contract requirements are evaluated in the
RFC, and no cost or correctness measurement is attributed to unbuilt code.
The current-membership plan was measured as implemented: it is fast for the
dense reader, but fails closed without continuation for the sparse reader.

## Resource pilot

F1/F2 are Cal29's existing six physical lines / 402 bytes, with **zero**
history-cap workaround lines. Per the lane override, no builder rewrite or
LOC reduction is claimed. [CX evidence](../20261003-cx-client-contract/EVIDENCE.md)
contains those specimens. The measured gain is access to older Following.

One actor has 100,000 events; 16,385 actors have one event each; one reader
follows all 16,386. The real engine adopts source rows, stamps slots, creates
birth records/own copies, accepts each follow, and executes the copy work.
No raw SQL writes shortcut the measured copying. Timings are single samples
on a shared host, optimized Rust test profile, without HTTP/network delay.

| Measurement | 1,000 window | Opt-in all |
|---|---:|---:|
| Seed/initial owned-state construction, ms | 38,136 | 40,905 |
| Admit 16,386 follows, ms | 13,997 | 14,235 |
| Background completion, ms | 259 | 50,922 |
| Background chunks | 4 | 391 |
| Background examinations | 3,872 | 407,814 |
| Background row writes, including queue/rotation | 954 | 100,732 |
| Maximum examinations per chunk | 1,043 | 1,044 |
| Maximum charged heap bytes per chunk | 1,652,765 | 3,030,366 |
| Foreign copies | 17,385 | 116,385 |
| Foreign-copy row-image bytes | 5,436,505 | 35,917,395 |
| All row-image bytes | 121,743,498 | 152,224,388 |
| SQLite bytes before follows | 479,399,936 | 515,354,624 |
| Settled SQLite bytes after follows | 552,615,936 | 838,471,680 |

This comparison uses **one-second cooperative slices**, so the unchanged
256-member chunk bound wins. It measures work/storage, not normal serving
scheduler latency. A separate two-millisecond stress below uses the serving
slice size; neither loop includes maintenance admission/pacing. The extra
99,000 copies cost 30,480,890 row-image bytes and 285,855,744 settled database
bytes here. The latter includes the birth index, indexes, commits and SQLite
allocation. Do not treat it as a universal bytes-per-copy multiplier.

The initial all-history pilot queued empty backfills for the quiet actors:
16,776 chunks, 571,665 examinations, 133,502 writes, 59,501 ms and 868,564,992
settled bytes. Omitting already-complete tasks removes that work; the raw
initial and final samples are both retained in `evidence/scale*/`.

| Read experiment on quiet store | Rows / pages | Examinations | Time |
|---|---:|---:|---:|
| Window Following, whole traversal | 17,385 / 870 | 53,025 | 511 ms |
| All Following, whole traversal | 116,385 / 5,820 | 360,795 | 2,867 ms |
| Current membership, dense whole traversal | 116,385 / 5,820 | 244,408 | 2,345 ms |
| Current membership, sparse first page | 0 / 1 unavailable | 5,935 | 25.026 ms |
| Profile escape, quiet actor first page | 1 / 1 complete | 1 | 59 µs |
| All Following, first page | 20 / 1 complete | 62 | 621 µs |

The sparse reader follows one quiet actor behind the hot actor's 100k events.
The current plan reaches 16,779,092 charged heap bytes, returns unavailable,
and has **no continuation**. A timestamp/profile cursor is not a frozen,
merged Following traversal. Current membership also changes admission
semantics and has no pinned traversal watermark. Its dense traversal time
cannot justify replacing the copy index for sparse memberships.

## Device costs and publication

After the server-storage comparison, sources are switched to fixed global
1,000-row horizons and application follows to online-only. The normal
1,000-copy inbox horizon remains. Snapshot acquisition retains all 16,386
owned reader edges. This phase is distinct from the unbounded-source seed.

| Cold settled-store acquisition | Window | All |
|---|---:|---:|
| Actual server snapshot pages | 37 | 37 |
| Snapshot wire bytes (excluding backend descriptor) | 4,967,806 | 4,967,806 |
| Server snapshot construction, ms | 177 | 180 |
| Actual wasm apply time, ms | 699.282 | 592.832 |
| Wasm logical stored bytes | 5,059,093 | 5,059,203 |
| Wasm linear memory bytes | 32,899,072 | 32,899,072 |
| Actual process apply time, ms | 1,749.996 | 1,736.789 |
| Process SQLite file bytes | 24,588,288 | 24,588,288 |

The 110 logical bytes are schema/index metadata. Edge row images dominate at
3,146,108 bytes; Feed is 308,000 and Posts 153,000 bytes. These are actual
wasm/process devices applying actual server pages, not an estimate based on
row counts. Apply timings exclude network; process startup is separately
recorded as wall time in the JSON receipts.

The routine 2,500-event interrupted-copy witness deliberately scrambles birth
and timestamp order, including ties. It opens a cold device after six copy
chunks, refollows during old cleanup, deletes an event, interleaves eight
backdated births, reopens the server, normalizes catch-up through one-commit
pages, and reopens the device during catch-up. Memory/SQLite and actual
wasm/process hosts all require honest completion and identical final top-20
rows. Older pages still withhold below the acquisition floor.

| Halfway 2,500-event witness | Actual wasm | Actual process |
|---|---:|---:|
| Cold acquisition, ms | 80.620 | 156.189 |
| Acquisition plus catch-up/checks, ms | 1,512.256 | 5,463.139 |
| Snapshot wire bytes | 370,059 | 370,059 |
| Logical bytes, initial → complete | 419,074 → 644,133 | not reported by this host |
| Physical/linear bytes, initial → complete | 3,932,160 → 12,189,696 | 2,920,448 → 4,972,544 |
| Feed rows, initial → complete | 1,000 → 1,591 | 1,000 → 1,591 |

The final count is specific to the recorded acquired floor, not a cap or a
universal expected count. The growth above 1,000 is intentional evidence: a fixed acquisition floor is
not a live sliding cap. Later above-floor rows are retained. No horizon or
publication fence was expanded for the prototype.

## Scale stress and verification

The serving-slice stress completed 32,815 turns with 512 continuous backdated
births (one per 64 turns while backfill exists), two deletions, cancellation,
old cleanup and a second refollow, then a reopened server. It started with
100k hot events and all 16,386 reader edges. The first halfway snapshot was
captured at 50k new-epoch hot copies; acquisition is followed by the second
refollow/removal/restart. No row limit or time allowance is raised.

- 1,694,873 examinations; 366,412 writes; 544,095 ms to drain;
  367,170 ms to halfway. The timing includes fixture observations (including
  periodic Work/edge scans and snapshot construction), host contention and
  two-millisecond cooperative chunks, but no HTTP pacing. It is not directly
  comparable to the 391-chunk quiet copy microbenchmark.
- Final reader copies: 116,895 = 116,385 − 2 + 512. Catch-up: 167 actual
  stream pages, 42,647,361 bytes; initial snapshot plus catch-up is 204 pages,
  47,615,973 bytes, excluding the backend descriptor/oracle.
- The first top-20-only replay passed while a deeper per-page oracle found
  **stream page 41, result page 2** (the third result page) falsely complete.
  This was **ours**, an experimental publication defect. Work's deletion can
  be normalized to a future state before the log suffix supplies all copies.
  Version-3 devices now select the existing deferred-publication barrier
  whenever `images_at > watermark`, even without a local prediction. Version-2
  selection is unchanged. The routine two-host regression now asserts this
  fence, and the scale replay checks every complete page against 200 server
  oracle pages and requires withholding at the fixed floor.

The corrected scale replay passes on **actual wasm and process devices**.
Each checks every published page against the server oracle after each stream
apply, then verifies the fixed floor withholds. Exactly 100 complete result
pages (2,000 rows) are visible at the terminal fence; the next result page is
withheld. First completion is apply page 204, watermark = images_at = 50,113.
Before the fix it was page 38 at watermark 35,938 < images_at 50,113, with
wrong later result pages. This is correctness evidence, not a speedup.

| Corrected 100k halfway replay | Wasm | Process |
|---|---:|---:|
| Snapshot apply, ms | 692.307 | 1,741.492 |
| Snapshot + catch-up + page/size checks, ms | 11,254.362 | 46,077.563 |
| Initial logical / file bytes | 5,060,078 | 24,600,576 |
| Peak logical / file bytes, sampled each apply | 6,686,113 | 24,600,576 |
| Final logical / file bytes | 5,454,575 | 24,600,576 |
| Peak wasm linear-memory bytes | 32,833,536 | n/a |
| Feed rows, initial → final | 1,000 → 2,019 | 1,000 → 2,019 |

The fixed floor bounds acquisition/retention, not all catch-up traffic: this
trace transports 42.65 MB of stream data for a final 2,019 inbox rows. That
network/decoding cost belongs in a default-shipping resource budget.

These apply timings include extra page/residency assertions, and the process
binary uses the debug dev profile. SQLite `totalBytes` counts database pages,
not transient WAL/journal bytes or RSS. The records distinguish this from
wasm's logical storage and linear-memory measures.

Final full suite, verbatim:

```text
== 0 failure(s) in 1916 s
```

Client tests: 5,786 passed, 10 named skips; client models: 79 passed.
The wasm build is **2,031,763 B raw / 610,487 B gzip**, below the unchanged
610,782 B budget. Exact commands, every check summary, all skip reasons and
failure classification are in [CHECKS.md](./CHECKS.md); the complete stdout
is retained compressed. The elapsed time exceeds the documented 60-second
suite budget; this is a functional result, not a timing or publication claim.

The first exploratory full-suite run was interrupted when that correctness
fix made its binary snapshot obsolete. It reached four failing Rust targets
(`row_view_accounting`, `row_view_disclosure`, `row_view_witness`, core unit
row-view tests), all with `Store("private store: private data directory must
be a real directory")`. Classification: **environmental, caused by our test
setup**. The workspace's ignored `target` symlink conflicted with the private
store's real-directory requirement. It is now a real directory with a local
CLI copy and links only to compiler artifact directories. No product check
was weakened. A separate shared-cache collision returned a parser lacking
`experimental`; lane-specific Rust compiler metadata now separates the lane's
artifacts while retaining the mandated shared `CARGO_TARGET_DIR`.

The final run uses `RUSTFLAGS='-C metadata=sb5_f_follow_history'`. The local
`target/debug/snapback4` is copied from this lane's freshly built CLI so other
lanes cannot replace it between client-test processes. These are ignored
execution-environment changes, not repository configuration changes.

## Reproduce

Run in this lane on the pinned PATH and shared target. The scale directory
must be fresh for the first command; the next two consume its stores. The
stress command mutates `all.sqlite`, so keep the preceding JSON measurements.

```bash
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_TARGET_DIR=$HOME/sb5-lanes/target
export RUSTFLAGS="-C metadata=sb5_f_follow_history"
export CARGO_BUILD_JOBS=16
cd snapback4
# Fresh local target must be a real directory, not a link to the shared target.
bun install --frozen-lockfile
mkdir -p target/debug
cargo build -p snapback4
cp "$CARGO_TARGET_DIR/debug/snapback4" target/debug/snapback4
# On a fresh target; preserve this link if it already exists.
ln -s "$CARGO_TARGET_DIR/wasm32-unknown-unknown" target/wasm32-unknown-unknown
export SNAPBACK4_BIN="$PWD/target/debug/snapback4"
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
cargo test -p snapback4-lang --test following_history --test following_history_compat --test guide
cargo test -p snapback4-device --test following_history
FOLLOW_HISTORY_OUT=/absolute/fresh/directory cargo test -p snapback4-lang --test following_history measure_skew_and_more_than_16384_heads -- --ignored --nocapture
FOLLOW_HISTORY_OUT=/absolute/fresh/directory cargo test -p snapback4-lang --test following_history measure_read_alternatives_and_device_pages -- --ignored --nocapture
node reports/20261003-f-follow-history/tools/devices.mjs /absolute/fresh/directory
FOLLOW_HISTORY_OUT=/absolute/fresh/directory cargo test -p snapback4-lang --test following_history stress_scale_with_short_slices -- --ignored --nocapture
FOLLOW_HISTORY_ORACLE_ONLY=1 FOLLOW_HISTORY_OUT=/absolute/fresh/directory cargo test -p snapback4-lang --test following_history measure_read_alternatives_and_device_pages -- --ignored --nocapture
FOLLOW_HISTORY_STRESS=1 node reports/20261003-f-follow-history/tools/devices.mjs /absolute/fresh/directory
node --test packages/snapback4/test/following-history.test.mjs
bash scripts/test.sh
```

The device Rust witness generates `target/following-history-device.json` for
the JavaScript regression; the full suite orders Rust before clients. The
baseline byte control was generated by running the same compatibility test
against an archive of committed base, then compared against this lane. It
covers four compile variants (ordinary timeline/inferred Following × full/
bounded sources), generated TypeScript, programs/schema serialization, and
1,100-event follow/unfollow/refollow traces with fixed entropy/IDs and
one-row cooperative turns, including outcomes, meters and all row images.
The committed control makes it a continuing regression, not just a one-off
comparison. Binary artifacts and multi-megabyte wire captures remain outside
git at `/home/ccheever/sb5-lanes/f-artifacts`; compact measurement JSON and
compressed verification logs are committed here.

## Limits and handoff

- Charlie must choose membership semantics, storage budget and a complete-page
  wait objective before any default adoption. The opt-in syntax does not
  resolve that product decision.
- No production HTTP load/SLO, hundred-reader storage run, physical disk
  reclamation, macOS device, or on-demand merged cursor is qualified here.
- All-history cost grows with retained history per admitted edge. Atomic
  existing-store launch still refuses above 5M copies. Larger rollout needs
  a separate migration design, not a raised meter.
- The opted-in backend stages the whole normalized stream while its image
  head is ahead, including unrelated table changes. Sustained input faster
  than device catch-up can extend the publication wait; no overload SLO is
  claimed.
- Newest-prefix publication during copying would need additional discovery/
  ordered-merge machinery. This prototype explicitly chooses whole-feed
  withholding and supports viewer queries only over the experimental inbox.
- No SDK, generated TypeScript API, guide recipe, or package README is paved
  for this experiment, as the lane override requires. `why` and adoption
  diagnostics point to the RFC or state the selected experimental semantics.
