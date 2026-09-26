# Lane R — device residency and offline CLI ownership

Date: 2026-09-26. Branch: `sb4-intent/r-residency`. Base: `99153132b`.
Implements the supplied LLP 3000.019 §3.4. No push or publication.

Implementation commits: `37a94ef03` (residency), `87ed68f49` (standalone
contract), `a31a30770` (store ownership and affected fixtures), `6a36365a1`
(read-only inspection and restart-marker ownership). Each carries
the requested co-author trailer. Supervisor integration, independent review
and version/publication changes remain with the release program.

## Behavior

```ts
const held = await client.residency();
if (held) {
  console.table(held.tables); // table -> { rows, bytes }
  console.log(held.totalBytes, held.totalBytesKind, held.wasmHeapBytes);
}
```

This runs offline on the web and native process device. It uses the same
dispatcher as the native C ABI. The online tier and mock return `null`.
Local clients reject with a coded error after close/sign-out, and app facades
recheck ownership before and after the measurement.

Table bytes count UTF-8 stored row payloads, not wire JSON or index/key
overhead. Rows are physical local images, including predictions and retained
or expired images still stored. These diagnostics confer no query coverage
or authority. Native `totalBytesKind: "sqlite-pages"` measures allocated
database pages, including free pages, indexes and metadata, excluding
separate WAL/SHM files. Web `"logical"` measures persisted record namespace,
key and value UTF-8 bytes before IndexedDB packing. Separate media caches,
wasm code caches and admission journals in localStorage are outside that
store. `wasmHeapBytes` measures allocated linear memory shared by devices
in one JS realm; it is neither live Rust allocation nor process RSS.

For the CLI, refusal is the selected alternative. A server endpoint for
system jobs would introduce an authority surface this lane does not need.
The existing OS lifetime lock now excludes offline writers throughout their
opening, adoption and execution. A failed acquisition returns `E_STORE_BUSY`
with the lock site, listening address and stop/run/restart instructions.

```sh
snapback4 dev --port 4400
# In another terminal, on the same project:
snapback4 run backfill
# E_STORE_BUSY ... http://127.0.0.1:4400 ... no work was admitted
# Stop dev, then:
snapback4 run backfill
# Runs normally; restart dev afterward.
```

`run` covers queries, mutations and jobs because its opening can adopt source.
The other offline backend writers are `test` without a fixture, `token`,
`deploy` and `rollback`. For example, mint `snapback4 token --service worker`
before starting the server. HTTP `/seed` already executes through the server.
There is no separate `seed` or `backfill` CLI verb in this checkout.
`check`, `data`, `sql`, `doctor` and fixture tests remain usable beside the
server. An old lock file without an OS owner does not block work; store
symlinks resolve to the same lock. Competing CLI writers refuse before
admission. External SQLite writers that ignore this protocol retain the
existing bounded `E_RUN_BUSY` retry and source-change fence.

## File-by-file implementation

Paths below are relative to `snapback4/`.

| File | Change |
| --- | --- |
| `crates/snapback4-device/src/sqlite_residency.rs` | Transactional row/byte counters, bounded upgrade chunks, SQLite-page totals and metered table-sized reports. |
| `crates/snapback4-device/src/sqlite.rs` | Install counters on native open and implement the store measurement. |
| `crates/snapback4-device/src/store.rs` | Native measurement capability; web measurement remains in its persistence host. |
| `crates/snapback4-device/src/call.rs` | Native `residency` dispatcher operation. |
| `crates/snapback4-device/src/lib.rs` | Native-only module registration, outside the wasm build. |
| `packages/snapback4/src/residency.ts` | Coded failures and local session checks. |
| `packages/snapback4/src/contract.ts` | Required `client.residency()` method and self-contained public measurement type. |
| `packages/snapback4/src/web-residency.ts` | Incremental committed-record accounting, empty-table reporting and fresh snapshots. |
| `packages/snapback4/src/web.ts` | Feed successful persistence changes/reopens into accounting and report wasm memory allocation. |
| `packages/snapback4/src/local.ts` | Expose the local client method. |
| `packages/snapback4/src/local-native.ts` | Extract the existing native-module installer unchanged in behavior, keeping `local.ts` below 1,500 lines. |
| `packages/snapback4/src/client.ts` | Online-tier `null` measurement. |
| `packages/snapback4/src/mock.ts` | Mock `null` measurement. |
| `packages/snapback4/src/app-client.ts` | Fence residency before and after app-session ownership checks. |
| `crates/snapback4/src/store_owner.rs` | Shared lifetime-lock acquisition, canonical store resolution, bounded owner metadata and coded refusal. |
| `crates/snapback4/src/main.rs` | Register the ownership module. |
| `crates/snapback4/src/serve.rs` | Publish the actual listener address while retaining lifetime ownership, including release hosts. |
| `crates/snapback4/src/verbs.rs` | Hold ownership through `run`, non-fixture `test` and `token`; open `data` read-only to avoid initialization writes. |
| `crates/snapback4/src/verbs/releases.rs` | Reuse ownership for deployment, rollback and release serving. |
| `crates/snapback4/src/verbs/adoption.rs` | Read the inspector port from the extended lock record and canonical store directory. |
| `crates/snapback4/src/verbs/witness/smoke.rs` | Acquire store ownership for the stopped-server restart barrier; verify a live owner prevents advancing its commit clock. |
| `crates/snapback4-lang/src/diag.rs` | Route `E_STORE_BUSY` to its refusal card. |
| `crates/snapback4-lang/src/guide.rs` | Explain measured residency beside a bounded sync window, with API examples and byte units. |
| `crates/snapback4-lang/src/guide/codes.rs` | Register and explain `E_STORE_BUSY`. |
| `crates/snapback4-lang/src/guide/refusals.rs` | Define the refusal and concrete recovery. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document offline CLI ownership and stop/run/restart. |
| `crates/snapback4-device/tests/residency.rs` | Native exact-count/byte, transactional and upgrade evidence. |
| `packages/snapback4/test/device-residency.test.mjs` | Web accounting, offline public clients, native process client and app-fence evidence. |
| `crates/snapback4/tests/run_admission.rs` | Refusal in both ownership directions, stale-file recovery, store aliases, competing CLIs and `data` while a SQLite writer holds its transaction. |
| `crates/snapback4/tests/check.rs` | Move adoption cases into a module to keep the file below 1,500 lines. |
| `crates/snapback4/tests/check_adoption/mod.rs` | Preserve actual external-writer generation/recovery checks, now asserting CLI refusal first. |
| `crates/snapback4/tests/lifecycle.rs` | Mint seats before startup; assert busy backfills, then stop/run/restart and retain lifecycle/data checks. |
| `crates/snapback4/tests/clock.rs` | Mint seats before startup; require live `run --now` refusal, then preserve offline clock and persisted-row checks. |
| `crates/snapback4/tests/replay.rs` | Prepare seats offline and stop/run/restart around explicit jobs, preserving effect suppression and restart assertions. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pin the new diagnostic's defining fact. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pin its recovery and no-admission guarantee. |
| `packages/snapback4/test/client-seams.test.mjs` | Prepare service seats offline and require CLI refusal beside a live host. |
| `packages/snapback4/test/worker.test.mjs` | Mint independent worker seats before startup, preserving revocation/authority assertions. |
| `packages/snapback4/test/server-e2e.test.mjs` | Prepare service/operator seats before host startup. |
| `packages/snapback4/test/fixtures/routes.mjs` | Prepare the route-driver seat before startup. |
| `packages/snapback4/test/fixtures/identity-recipe/qualify-b1c.mjs` | Prepare qualification worker/operator seats before startup. |
| `packages/snapback4/test/periphery.test.mjs` | Mint all token variants offline, preserve stdout/redemption assertions, and require addressed live refusal in dev and release modes. |
| `packages/snapback4/test/write-authority.test.mjs` | Control concurrent sync in the HTTP replay fixture, preserving its same-ID and result-disclosure assertions. |
| `JOURNAL.md` | Append the dated implementation and qualification record. |
| `reports/20260926-lane-r-residency.md` | This handoff record. |

## Tests and choices

The native residency cases compare counts and canonical UTF-8 byte sums to
actual rows, verify Unicode, rollback/savepoint behavior, clearing, a second
owner and reopen; the upgrade case starts from a 20,000-row pre-counter
store. Counter maintenance adds fixed metadata work per changed row; the
one-time upgrade meters 512-key chunks without owning row payloads.

The web test reconciles every logical record byte against persisted data,
checks predictions, settlement, failed snapshot persistence, clear and
reopen, and proves reporting does not reload the store. Public API tests
exercise offline wasm and native-process clients, online `null`, close and
retirement during a pending measurement.

The CLI tests cover watching and non-watching servers; query, mutation,
backfill, token and non-fixture test refusal; no generation/job admission;
doctor beside the host; data beside the host with a held SQLite writer;
stale lock files; a held CLI refusing server startup;
symlink aliases; and a competing CLI retry after the first exits. Existing
SQLite-lock deadlines and source-change tests retain their assertions.

Byte units, return shape, online/mock `null`, and coded rejection semantics
were engineering choices where the brief was silent. Web accounting uses
existing persistence deltas rather than another wasm export, preserving the
device budget. No interpreter, rule, meter ceiling, durable intent or
publication behavior was weakened. The newer brief deliberately supersedes
the earlier live external-CLI-adoption compatibility described in LLP
3000.011.004.000; direct external-writer recovery remains tested.

No new Quarry spelling was needed. Existing forms in the complete guide
remain diagnostic- and note-free. Native iOS/Android application builds and
a physical IndexedDB disk-size claim are outside this lane's evidence.

## Qualification

Toolchain: Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.18.0 and Bun 1.3.14;
no wasm-opt. Dependency install used `bun install --frozen-lockfile`.
Build/test concurrency was bounded with `CARGO_BUILD_JOBS=8`,
`SNAPBACK4_RUST_TEST_PROCESSES=8` and `RUST_TEST_THREADS=4`; debug symbols and
incremental builds were disabled to limit this lane's disk use.

Wasm baseline and changed build both measured **2,021,689 B raw / 581,094 B
gzip**: **+0 / +0 B**, 1,000 B below the unchanged 582,094 B budget.
This is a whole-artifact size comparison, not a digest-identity claim.

Final full invocation: **`bash scripts/test.sh` exited 0** with the exact
summary **`== 0 failure(s) in 1436 s`**. There are no failing checks in the
final run. All 78 seeded client-model cases passed. The affected Rust targets
passed: native residency 2, frontend regressions 40, guide 85, check 71,
clock 19, replay 15, lifecycle 20, CLI admission 12 and binary unit tests 112.
The full client phase passed, including all three new residency cases and
the repaired periphery/replay fixtures. The ten declared environmental
client skips are listed below.

Evidence is retained locally under `target/lane-r-evidence/`:
`full-suite-initial.log`, `full-suite-interrupted.log`,
`full-suite-final.log`, and the scoped-check/wasm logs. There are no known
open lane defects and no stopped design item. No failure is waived as
baseline or environmental. Independent review and integration are pending
with the supervisor.

Initial full invocation: `bash scripts/test.sh` exited 1 with the exact
summary **`== 2 failure(s) in 1435 s`**: `cargo test`, `client tests`.
Follow-up targeted verification passed 40 frontend regressions, 19 clock
cases, 15 replay cases and 29 client cases (periphery, write authority and
device residency). The final complete suite above then passed on committed source.
An intermediate rerun was deliberately interrupted (exit 143, no summary)
when a final inspection found that `data` used writable store initialization.
It now uses the existing read-only opener; its row format and snapshot checks
are unchanged. The lock-held test proves this inspection does not contend.
The same audit found the native witness's restart barrier, which intentionally
stops its server before writing a commit-clock marker. It now takes the lock
as well, fencing a competing owner between the stop check and the write.


### Initial full-run failures

All 16 failed assertions are treated as lane-owned and repaired; none is
claimed as an inherited or environmental exemption. Reproduce the initial
failures on the pre-followup tree with the full command above, or the target
commands listed below. The receipt case is timing-sensitive.

- `cargo test -p snapback4-lang --test frontend_regressions`: two failures
  because generated clients copy a standalone `contract.ts`. The new public
  type originally imported another file; it now lives in the contract.
- `cargo test -p snapback4 --test clock --test replay`: eleven failures from
  fixtures using the newly refused live token/run paths. Setup now happens
  offline, with explicit stop/run/restart where needed.
- `node --test packages/snapback4/test/periphery.test.mjs`: two token fixture
  failures, repaired by minting offline and asserting live refusal.
- `node --test packages/snapback4/test/write-authority.test.mjs`: one local
  replay case expected three mutation POSTs, but concurrent sync delivered
  the same receipt after two. The fixture now drops sync responses until
  the HTTP retry, preserving every same-ID/receipt assertion.

Exact failing test names in that run:

- `generated_typescript_preserves_strings_and_typechecks_with_the_real_contract`
- `generated_nullable_arrays_typecheck_with_the_real_contract`
- `action_retry_times_follow_dev_clock_and_real_expiry_still_fences_dev_and_serve`
- `clock_advance_preserves_a_live_action_claim_session_and_settlement`
- `clock_advance_preserves_a_live_effect_claim_and_settlement`
- `effect_retry_next_at_still_follows_the_dev_clock`
- `grace_push_is_deferred_until_clock_advance_then_delivered_once`
- `grace_push_reconnect_is_satisfied_even_after_restart_and_disconnect`
- `grace_push_serve_keeps_deadline_and_reconnect_record_for_claim_after_restart`
- `real_time_effect_lease_loss_requeues_in_dev_and_serve`
- `run_now_pins_query_mutation_and_job_without_changing_running_dev`
- `held_effects_remain_durable_and_claimable_after_restart`
- `replay_suppresses_committed_emits_and_preserves_writes_jobs_and_restarts`
- `dev: piped token stdout is one usable bearer, and server stdout carries its URL and optional dev token`
- `serve: piped token stdout is one usable bearer, and server stdout carries its URL and optional dev token`
- `replay card: local keeps a lost response's same-id receipt and fresh result`


### Environment-gated skips in the final invocation

These ten existing client cases were skipped by their declared platform or
external-artifact prerequisites; they are not passing evidence or failures.
No newly added lane test was skipped.

- Expo native media storage migrates MP4 filenames, decodes their URIs, and preserves cache lifecycle — requires macOS Foundation and AVFoundation
- managed organization and invitation policy runs in the shared interpreter — set SNAPBACK4_B1D_MANAGED_BIN, SNAPBACK4_B1D_MANAGED_BIN_SHA256, SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT to the pinned parent binary and a private scratch parent
- managed OIDC profile binding orders and expires trusted email evidence — set SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT to an existing private directory
- published 0.2.27 reference: four tasks with one and two search cursors — set BOUNDS_BINARY to the published 0.2.27 binary
- published 0.2.33 rejects F2 stores, serving, backend opening and device adoption — set SNAPBACK4_F2_LEGACY_BIN to the published 0.2.33 platform binary
- published 0.2.33 capability fence: timeline-v2 — set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
- published 0.2.33 capability fence: recorded-attribution — set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
- published 0.2.33 capability fence: maintained-column — set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
- published 0.2.33 control: capability-free bytes and stores stay compatible — set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
- new client syncs against the actual 0.2.32 server's deny_unknown_fields request contract — set SNAPBACK4_LEGACY_BIN to the published 0.2.32 binary
