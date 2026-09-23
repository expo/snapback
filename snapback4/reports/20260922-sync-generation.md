# Generation discovery before sync page materialization

Implemented on `sb4-03/sync-generation`, based on `559b63f72150f58666502599f21a5b7e49b9a30d`.
Changes are uncommitted. No LLP, core/device implementation, page wire format,
or byte ceiling changed. The governing requirement is
[LLP 3000.007.003 §5](../../llp/3000.007.003-the-engine-writes-derived-data.rfc.md#5).
MC0 remains the recovery mechanism for oversized current-generation pages.

`POST /sync` accepts optional `generation: u64`. A mismatch returns HTTP 200:

```json
{
  "denied": {
    "code": "E_SYNC_GENERATION",
    "family": "generation",
    "guide": "sync",
    "message": "sync generation changed; adopt /schema before retrying this position"
  },
  "generation": 2,
  "store_id": "<current store identity>",
  "watermark": 208
}
```

This is a typed refusal, with no events, acknowledgement map, snapshot flag
or continuation. One guard wraps both snapshot and stream materializers on
the reader and engine paths. Its generation comes from the owner that would
materialize the page; its watermark is the current server head.

The client sends the generation captured with its device sync state, observes
identity, adopts through the existing path, and recaptures its position and
pending IDs. The early reply never advances delivered progress or enters
`apply`. Tests retain an unsent write, a known receipt, and a lost receipt
through adoption on both wasm and process devices, including an acquisition
change that discards old images. All three intents commit exactly once.

Requests without generation retain normal snapshot/stream delivery, including
MC0 overflow behavior. For the other compatibility direction, the client
retries once without generation only on HTTP 400 with 0.2.32's exact
`E_INPUT`/`input` sync-request message. It omits the field for the rest of
that client instance. The test runs against the actual published
`snapback4-darwin-arm64@0.2.32` binary, covering initial acquisition, later
writes and generation adoption. Its hashes are in
[legacy-binary.json](20260922-sync-generation/legacy-binary.json).

Changed implementation and tests (paths relative to `snapback4/`):

- `crates/snapback4/src/serve.rs`, `serve_sync.rs`: extracted dispatch and request contract, early guard.
- `crates/snapback4/src/serve_tests.rs`, `crates/snapback4/tests/serve_sync/mod.rs`: four HTTP cases with a per-store materialization counter, current/absent generation and retired snapshot cursor checks.
- `crates/snapback4-lang/src/diag.rs`, `guide/codes.rs`, `guide/sync.rs`: refusal registration, lookup and wire documentation.
- `packages/snapback4/src/local.ts`, `local-sync.ts`: generation capture, adoption and exact legacy fallback.
- `packages/snapback4/test/sync-generation.test.mjs`, `sync-overflow.test.mjs`, `repair-b.test.mjs`: adoption/outbox/compatibility tests, the updated stale-generation expectation, and bidirectional generation translation in an existing virtual-server fixture.
- This report and `reports/20260922-sync-generation/`: retained proof and a reproducible MC1 harness adaptation. Every changed source file is below 1,500 lines.

The **full MC1 fixture and procedure** ran, using the original before/after
Quarry and stopped-store backfill: 100,000 parents, 1,000,000 source rows,
4,000-event page, unchanged 108,000 log events and 208 commits. The original
page sizes were reproduced exactly: **16,744,164 B** before activation,
**16,804,164 B** afterward, against **16,777,216 B**. The second size is
reconstructed from two real successful current-generation halves. A separate
no-generation request still returned the expected `E_BOUND` control.

The lagging device's recorded sequence, ordinals 299–302:

1. `/sync {generation:1, from:200, limit:4000, after:null, stream:false, pending:[], store_id:…}` → **234 B**, `E_SYNC_GENERATION`, generation 2, head 208.
2. `/schema` → generation 2.
3. Device `adopt` succeeds; durable generation 2, watermark **0**.
4. `/sync {generation:2, from:0, limit:4000, after:null, stream:false, pending:[], store_id:…}` → snapshot, without reducing the limit.

Both devices finish at generation 2 / watermark 208 in 27 sync requests each,
with **zero oversized replies** during adoption. The widest delivered page
is 16,764,471 B. Inspection verifies all 100,000 persisted parents have
`likeCount: 10`, and neither device acquired source rows. No browser or
maintained-column evaluator performance claim is made. The run completed in
28.0 s using the CLI built by `cargo test` (the workspace's optimized test
profile); this qualifies protocol behavior, not a timing comparison with the
original unoptimized MC1 measurement.
[Requests](20260922-sync-generation/requests.jsonl),
[result](20260922-sync-generation/result.json),
[page comparison](20260922-sync-generation/page-comparison.json) and gzip
bodies are retained. [instrument.patch](20260922-sync-generation/instrument.patch)
shows every adaptation from the original MC1 measurement: request generations,
the new expected outcome, an explicit legacy control, and artifact paths.

Commands from `snapback4/`, using Node 24.18.0 on the requested PATH:

| Command | Result |
|---|---|
| `CARGO_BUILD_JOBS=2 cargo test -p snapback4` | 292 passed, 0 failed across 12 test targets |
| `CARGO_BUILD_JOBS=2 cargo test -p snapback4-lang --test guide` | 49 passed, 0 failed |
| `node --test --test-concurrency=1 packages/snapback4/test/sync-generation.test.mjs packages/snapback4/test/sync-overflow.test.mjs packages/snapback4/test/http-bounds.test.mjs packages/snapback4/test/repair-b-overflow.test.mjs` | 40 passed, 0 failed, 0 skipped; 25.632 s |
| `node --test --test-concurrency=1 packages/snapback4/test/sync-generation.test.mjs` after strengthening assertions | 4 passed, 0 failed, 0 skipped; 0.755 s |
| `node --test packages/snapback4/test/repair-b.test.mjs` after the full-suite fixture correction | 5 passed, 0 failed, 0 cancelled; 2.172 s |
| `bun run --cwd packages/snapback4 typecheck` | Passed |
| `bash scripts/build-wasm.sh`; `bun run --cwd packages/snapback4 build` | Passed; unchanged device 443,551 B gzip, within 452,000 B budget |
| `MC1_OUTPUT=/tmp/sb4-sync-generation/mc1 node /tmp/sb4-sync-generation/measure-mc1.mjs` | `gate 5: PASS; devices adopted 2/2; no-oversize clause PASS` |

Client commands set `SNAPBACK4_LEGACY_BIN=/tmp/sb4-sync-generation/legacy/package/snapback4`.
To reproduce MC1, run `MC1_OUTPUT=/tmp/sb4-generation-rerun node reports/20260922-sync-generation/measure.mjs`
after building the binary and package. Full command logs remain under
`/tmp/sb4-sync-generation/`.

Mutation proof: a temporary workspace copy disabled only the early return
(`if false && requested.is_some_and(…)`).
`cargo test -p snapback4 --bin snapback4 stale_generation` failed **4/4** at
the materialization counter (`1 != 0`). The temporary source was restored
byte for byte; the same command then passed **4/4**. The working source was
never mutated. The restored SHA-256 is
`f80645a7d696e780c43e4524cae4f1ed244cea7a5771a9d175f12db76ade4eb3`.
Both logs and the byte-restoration receipt are retained beside this report.

The first mutation attempt exposed a timestamp collision in the existing
`ReaderTestDirectory::new()` helper. These new tests now allocate their own
per-process numbered paths; the unrelated helper remains unchanged. Existing
compiler warnings were left alone. A client that negotiated legacy mode will
try the generation field again when a new client instance is opened.

`bash scripts/test.sh` ran **once**, with `CARGO_BUILD_JOBS=2`,
`SNAPBACK4_RUST_TEST_PROCESSES=1`, `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`
and the legacy binary variable above. One-minute load average was
**12.9385 at start / 9.8208 at finish**. Its category results, verbatim:

```text
-- ok: cargo build (40 s)
-- ok: wasm build (2 s)
-- ok: docs budget (0 s)
-- ok: release guard (11 s)
-- ok: package typecheck (2 s)
-- ok: package build (2 s)
-- ok: chat app check (1 s)
-- ok: cargo test (1278 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (2 s)
-- ok: fixture wrapper tests (13 s)
-- FAIL: client tests (1128 s)
== 1 failure(s) in 1336 s
   client tests
```

Rust totals were **2,228 passed, zero failed, 11 ignored**. The client summary:

```text
ℹ tests 959
ℹ suites 0
ℹ pass 956
ℹ fail 0
ℹ cancelled 1
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 1128300.974166
```

The cancellation was `row reset between A2 acquisition and B fetches B's
backend and retires A's receipt`. Its fixture rewrote physical generation 1
responses to virtual generation 2, while leaving requests unmodified. With
the new early check, each virtual-generation-2 request was refused by the
physical-generation-1 server; the fixture rewrote that refusal to generation
2 again. This was a fixture inconsistency, not a load-attributed failure.

After the full run completed, the fixture was corrected to translate request
generations into the physical server's numbering as well. Its complete file
then passed **5/5**, including the formerly timed-out case in **1.067 s**.
No production code changed after the full suite started. The full suite was
not repeated, as instructed; its red result is retained rather than replaced
by the focused green result. All four new generation/client compatibility
tests also passed inside that full run.

The complete suite log remains at `/tmp/sb4-sync-generation/full-suite.log`.
Its retained [summary](20260922-sync-generation/full-suite-summary.txt),
[load/exit receipt](20260922-sync-generation/full-suite-result.json) and
[fixture rerun](20260922-sync-generation/repair-b-final.log) accompany this report.
Final `git diff --check` passes; every changed text file is below 1,500 lines,
and there are no changes outside `snapback4/`. No commit, push or stash was made.
