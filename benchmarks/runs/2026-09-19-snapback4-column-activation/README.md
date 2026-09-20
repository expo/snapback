# MC1 milestone zero: column activation over HTTP

**Gate 5 fails its no-oversize clause. Stop before implementing maintained columns.**
This record measures the protocol proxy requested by the MC1 brief, at base
`5df0d211a12ef3255a142685d064ae56d794aba3` (including MC0 and W15c).
The governing contract is [LLP 3000.007.001 §7](../../../llp/3000.007.001-maintained-columns.rfc.md#7),
with the event-free generation barrier and non-literal field in
[§3.11](../../../llp/3000.007.001-maintained-columns.rfc.md#3.11).
No product code, rule, ceiling, commit atomicity, or W15c surface changed.

## Method and limits

The unchanged debug CLI and production TypeScript client run on this Mac.
Both clients use the real Rust device over SQLite via `processDevice`, and
every `/schema` and `/sync` response is unchanged loopback HTTP. As in MC0's
test, only the background `/changes` transport is parked with heartbeat
frames, making explicit `client.sync()` the trigger for adoption. This is a
native device measurement, not a browser/IndexedDB or wasm claim.

The fixture has 100,000 parents, all acquired by each device, and 1,000,000
non-expiring source rows referencing them, ten per parent. Sources are online
only. Parents initially have 500-byte bodies. The source count is checked
from the actual persisted source images rather than assumed from the generator.

Both devices first acquire generation 1, watermark 200. While they are held
back, 4,000 parents get 4,000-byte bodies in four 1,000-row commits, then
4,077-byte bodies in four more commits. The body width is calibrated from a
real response to leave roughly 30 KB below the unchanged 16 MiB ceiling;
it is an adversarial near-ceiling page, not a typical page-size estimate.
The current device catches up to 208; the lagging device remains at 200.
The first large page covers four complete commits and 4,000 events. It
already fits on this exact base before the added field.

With the server stopped, `store.py backfill` derives the totals from the
million source rows and writes `likeCount: 10` into every parent image,
without modifying an index, commit, log event, generation or schema. The
new schema adds `likeCount: int` with **no default**. Ordinary checked
activation accepts the now-fitting images and publishes generation 2.
Required-without-literal-default makes the devices discard their old images
and acquire by snapshot. Source and parent row counts are checked before
and after, and the partition log remains at 108,000 events.

This stopped-store preparation is solely a fixture/protocol proxy. It is
**not** a private maintain, engine mirror, aggregate reservation, or atomic
implementation of maintained-column activation. Its backfill timing is
reported separately from actual CLI activation. In particular, it supplies
no cost claim for the not-yet-built maintain evaluator or mirror pass.

`supervise.py` captures OS `wait4` peak RSS, CPU and elapsed time for each
owned child. Activation has its own process, stopped immediately after the
listening banner and before any HTTP acquisition; its peak does not include
serving snapshots. Startup elapsed includes compilation of the Quarry and
opening/validating/reindexing this 1.1-million-row store. Device peaks cover
each device's whole successful lifetime, including initial acquisition,
not only adoption. Measurements are one run on a shared loaded host, using
the unoptimized debug profile; see `metadata.json` for load and binary hash.

## The ceiling result

| Observation | Bytes |
| --- | ---: |
| Pre-activation HTTP page, delivered successfully | 16,744,164 |
| Ceiling | 16,777,216 |
| Space left before adding the field | 33,052 |
| Same page after adding the field | 16,804,164 |
| Added by 4,000 copies of `,"likeCount":10` | 60,000 |
| Excess over the ceiling | 26,948 |

The after size is reconstructed from **two successful real 2,000-event
HTTP responses**, with the original full-page envelope and generation 2.
Removing only `likeCount` and restoring generation 1 makes the decoded
page exactly equal to the original. The whole 4,000-event request actually
returns the unchanged bounded encoder's `E_BOUND`, with generation 2.
The retained gzip files contain the complete HTTP bodies, not samples.
`rederive.py` independently checks the comparison and prints the byte counts.

No actual transmitted HTTP body exceeds 16 MiB: the server substitutes a
small refusal. The gate's no-oversize claim concerns producing an
undeliverable page. It fails **because of the new field**, even though the
refusal is recoverable. Treating the bounded refusal itself as a small
successful response would conflate MC0's repair with gate 5's second clause.

## Adoption and resource measurements

| Phase / process | Elapsed | Peak RSS, bytes |
| --- | ---: | ---: |
| Offline fixture count/backfill, separate from activation | 2.798 s | 128,139,264 |
| Real schema activation, start to listening | 51.255 s | 24,100,864 |
| Current device adoption and reacquisition | 30.437 s | 110,198,784 |
| Lagging device adoption and reacquisition | 32.954 s | 80,166,912 |
| HTTP server serving the two adoptions, whole process lifetime | 69.596 s | 160,563,200 |

The backfill plus activation elapsed is 54.053 s; these are separate stopped
processes, not one atomic implementation. Device peak RSS covers the whole
successful device process, including initial acquisition; it is not an
incremental allocation measurement. The HTTP serving process is separate
from the measured activation process. Fixture loading took 90.800 s.

**A device behind a large pre-activation page does adopt, carried by MC0.**
The observed sequence is in `evidence/requests.jsonl`, zero-based ordinals
298–301:

1. `/sync {from: 200, limit: 4000}` returns a **236-byte `E_BOUND`** with
   `generation: 2`, `watermark: 204` and the same store identity.
2. `/schema` returns generation 2.
3. The real device's `adopt` returns success; `state` is generation 2,
   watermark **0**, so the refusal watermark was not applied.
4. `/sync {from: 0, limit: 4000, after: null, stream: false}` begins the
   snapshot, **before any page-limit reduction**.

The lagging device finishes at generation 2, watermark 208, with all 100,000
persisted parents carrying 10. It makes 27 sync requests, with exactly one
oversized-page refusal. The current device follows the same adoption path
after an empty successful stream reply (ordinals 269–272), also makes 27
sync requests, and has no oversized response. Every snapshot page fits;
the widest is 16,764,471 bytes. For both devices, three sampled queries are
fresh and return 10 directly from the device, with no `/q/` server fallback;
the stopped-device SQL inspection verifies **every** stored parent, not
only those samples. Both devices acquire zero source rows.

Thus the adoption half passes **2/2** and the no-oversize half fails **1/2**
device scenarios. MC0 makes the failure recoverable; it does not prevent the
field from making a previously deliverable page undeliverable.

The RFC's event-free barrier avoids one enormous activation commit, but it
does not imply gate 5's second clause for an old stream page materialized
before the client knows the generation changed. MC0 explicitly deferred a
request-side generation check before materialization. Whether to commission
that change or revise the gate is a ruling for the lead; neither is built
here. The separate future prediction ticket is not pulled into this lane.
Maintained columns, the equal-scores-newest-first acceptance criterion,
and retirement of W15c remain unbuilt under the brief's stop rule.

The exact refusal is unchanged:

```text
E_BOUND
the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values
```

## Qualification

All product source remains at `5df0d211a12ef3255a142685d064ae56d794aba3`.
The targeted command, from `snapback4/` with Node 24 on PATH, was:

```sh
node --test --test-concurrency=2 packages/snapback4/test/sync-overflow.test.mjs
```

```text
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 125586.077959
```

Root `./ref-check --verbose` reports ten broken references already in that
base: nine to
`3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes`
and one to `3000.001#repair-b-replacement-disposal`. `ref-check.log` lists
every site. `base-ref-verification.txt` verifies the target LLP and all
referring files byte-for-byte against that base; the tracked working tree
was entirely unchanged when this validation ran. The benchmark's new
reference is valid. No unrelated reference repair is made in this stopped lane.

```text
ref-check: FAIL — 485 LLP docs, 9135 refs in 24552 files, 10 errors, 0 unchecked
```

The final check after the single journal append reports the same ten errors;
its complete output is in `ref-check-final.log`:

```text
ref-check: FAIL — 485 LLP docs, 9135 refs in 24559 files, 10 errors, 0 unchecked
```

`git diff --check` passes. The journal's original 2,431,065 bytes exactly
match the base; only one dated block was appended. All other tracked files
remain unchanged, and every raw artifact in this directory is visible to git.

No new product regression test or red-to-green fix exists: the lane stopped
at the failed measurement before implementation. Existing checks qualify the
base, and the measurement itself preserves both the successful adoption and
the counterexample to the gate. `wasm-build.log` and `package-build.log`
record successful prerequisites. An initial package build before the wasm
artifact existed refused `TS2307` for `./wasm/snapback4_device.js`; building
wasm and then rebuilding the package resolved that setup error.

The requested client command, from `snapback4/`, completed on the same base:

```sh
node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'
```

```text
ℹ tests 888
ℹ suites 0
ℹ pass 878
ℹ fail 7
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 970930.344917
```

The seven include the HTTP-bounds parent counted failed with its one failed
idle-poll child; the journal record-count case; React; and maximum-pending-ID
cases wasm/256, native/233 and native/256. This command overlapped the
long-running blocking suite; the gate measurement finished before either.
Product source and test files are unchanged, so these are observations of
the exact named base, not an inference about an earlier release.

Separate single-file/case reruns:

| Command, from `snapback4/` | Verbatim summary lines |
| --- | --- |
| `node --test packages/snapback4/test/http-bounds.test.mjs` | `ℹ tests 10` · `ℹ pass 10` · `ℹ fail 0` · `ℹ skipped 0` |
| `node --test --test-name-pattern='pre-admission journal: record count bounds capture and ordinary admission still works' packages/snapback4/test/navigation-model.test.mjs` | `ℹ tests 1` · `ℹ pass 0` · `ℹ fail 1` · `ℹ skipped 0` |
| `node --test packages/snapback4/test/react.test.mjs` | `ℹ tests 1` · `ℹ pass 0` · `ℹ fail 1` · `ℹ skipped 0` |
| `node --test --test-name-pattern='maximum pending ids' packages/snapback4/test/transport-http.test.mjs` | `ℹ tests 6` · `ℹ pass 5` · `ℹ fail 1` · `ℹ skipped 0` |
| `node --test --test-name-pattern='^native: maximum pending ids \(232\)' packages/snapback4/test/transport-http.test.mjs` | `ℹ tests 1` · `ℹ pass 1` · `ℹ fail 0` · `ℹ skipped 0` |
| `node --test --test-name-pattern='^W6d native: input key order is immaterial and an evicted receipt never readmits on the same client$' packages/snapback4/test/client-seams.test.mjs` | `ℹ tests 1` · `ℹ pass 1` · `ℹ fail 0` · `ℹ skipped 0` |

The journal case still fails `writes.every(w => w.state === "sent")` at
`navigation-model.test.mjs:265`; it is not called a proven host-only failure.
React's isolated run records Chromium `signal=SIGABRT`, the named sandbox
artifact. The HTTP timing failure clears. Logs are `rerun-*.log`.
The six pending-ID cases pass 5/6 on the rerun: all three failures from the
concurrency-2 run clear, but native/232 times out. That case then passes by
itself. No pending-ID test remains without a passing isolated observation.

The full blocking command ran once, from the repository root, with the same
Node 24 PATH:

```sh
bash snapback4/scripts/test.sh
```

Its category summaries, verbatim:

```text
-- ok: cargo build (3 s)
-- ok: wasm build (2 s)
-- ok: release guard (2 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (9 s)
-- ok: cargo test (1691 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
-- ok: fixture wrapper tests (7 s)
-- FAIL: client tests (1730 s)
== 1 failure(s) in 1750 s
```

Summing the Rust summaries gives **2,092 passed, 0 failed, 8 ignored**;
fixtures are **9 passed, 0 failed**. Rust's test-artifact build took 7m59s;
the final maintain observation test took 1,008.12s. All 20 lifecycle tests
passed. The suite selected serial client files at host load 36.44 across
18 CPUs. Its client summary, verbatim:

```text
ℹ tests 888
ℹ pass 877
ℹ fail 7
ℹ cancelled 1
ℹ skipped 3
ℹ duration_ms 1730357.937166
```

The cancelled test is the native input-key-order/evicted-receipt case in
`client-seams.test.mjs`; its 60-second test timeout expired. The seven
failures are the HTTP parent/idle-poll child, journal count, React and
pending IDs wasm/232, native/233 and native/256. The concurrency-2 run above
has **one more pass**, at the identical base, and no cancellation. None of
these results is described as a green blocking suite.
The cancelled client-seams case passes alone in 13.253s; its full rerun
summary is in `rerun-client-seams.log`.

## Reproduce and re-derive

From `snapback4/`, with the installed toolchain and frozen dependencies:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
cargo build -p snapback4 --locked
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
MC1_OUTPUT=/private/tmp/mc1-activation-rerun node ../benchmarks/runs/2026-09-19-snapback4-column-activation/measure.mjs
```

The measurement command exits successfully when it finishes its measurement
and all witness assertions hold; the separate `gate5` verdict in `result.json`
and its summary can be `FAIL`. It never implements a repair. Use a fresh
output directory for a rerun. Fixture stores are left in the temporary
directory recorded in that run's metadata for further inspection.

From the repository root, without a server or fixture database:

```sh
python3 benchmarks/runs/2026-09-19-snapback4-column-activation/rederive.py
```

`evidence/requests.jsonl` has every foreground request in order, with its
request body, HTTP status, response byte count and hash, event count,
generation, watermark, continuation and refusal. `counters.jsonl` retains
timings and persisted-device checks. `result.json` combines the outcome;
resource records and server logs are separate. The before/after `.q` files,
fixture generator and stopped-store preparation are all here.

`attempt-1-harness-error/` and `attempt-1.log` preserve the incomplete first
measurement, which stopped while normalizing a captured event using `row`
instead of its actual wire field `data`. It measured the same page crossing,
but did not reach device adoption and is not the completed gate measurement.
The repaired harness reran the entire fixture from scratch. The second
attempt, retained under `attempt-2-harness-error/` and `attempt-2.log`,
completed the current device's adoption, then stopped in read-only database
inspection: SQLite URI handling decoded the device filename's literal `%`
escapes. The helper now URL-encodes that path and reads the device's
`device:generation` key as well as the server's `generation`. Its inspection
was checked against both second-attempt stores before completing a third
fresh run. These are harness corrections, not product fixes or gate failures.
