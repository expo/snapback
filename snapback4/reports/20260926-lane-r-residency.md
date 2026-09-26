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

## Round 1 — 2026-09-26

Read both blind reviews in full: Astra `r2-r0.astra.md` (READY WITH
CHANGES) and Grok `r2-r0.grok.md` (READY). Both Astra findings are accepted
and fixed; no finding is disputed. This round retains §3.4's refusal choice,
byte units, physical-image meaning, session fences and bounded counters.

### Integration

Fetched origin, then merged the specifically requested `992cec75c` in
`b90a195f4`; the fetched tracking branch had advanced further, and that later
work is not included. The only textual conflict was `JOURNAL.md`. Both sides
are preserved verbatim: the merge adds 483 lines relative to the lane parent
and 48 relative to the main parent, with zero deletions. The client overlap
merged automatically, preserving both residency and LLP 3000.008.002.000's
custody changes. No rebase, push or publication was performed.

The merged tree passed package typecheck/build, device residency 2/2, guide
86/86, CLI check 71/71, clock 19/19, lifecycle 20/20, replay 15/15, admission
12/12, and 114/114 focused client tests (residency, client seams, periphery,
app online and online intent store). These checks used the merged
implementation before the round-1 fixes.

Orientation used the repository's `llp-orient` skill after initializing its
small `vendor/llp` submodule. Governing scope: LLP 3000.019 §3.4 (current,
residency and refusal), LLP 3000.008.002.000 (current, merged client custody),
LLP 3000 §4 (the Snapback 4 fence), the residency card and the existing
release/store/session code. No new LLP or design change was needed; report,
journal and the existing card are the documentation updates.

### Findings and changed files

Paths below are relative to `snapback4/`.

- **Astra Medium, release ownership:** `crates/snapback4/src/verbs/releases.rs`
  now acquires through `store_owner::command(release/store.sqlite)`, the same
  resolver already used by `token --release`. Serving, deploy and rollback
  therefore lock the real database directory even when that path is a
  symlink. `src/serve.rs` carries the acquired file in release mode and
  announces through that file; it no longer independently opens another
  `serve.lock`. Dev also uses the shared database-path helper directly.
  `src/verbs.rs` drops the obsolete helper re-export.
- **Astra Low, rejected reads:** `packages/snapback4/src/residency.ts` catches
  rejected device calls, rechecks closed/session state, then uses existing
  `E_STORE` / family `store` with site `client.residency`, the host error and
  a restart/reopen rewrite. Returned refusals retain their code and details.
  `src/app-client.ts` also rechecks app custody on rejection, so retirement
  wins over a device exception. `crates/snapback4-lang/src/guide.rs` documents
  that device-read failure and its recovery beside the existing measurement.
- **Grok interrupted installation:**
  `crates/snapback4-device/src/sqlite_residency.rs` considers installation
  complete only when the table and all three triggers exist. An incomplete
  set is dropped, backfilled and recreated inside the same immediate
  transaction. Ordinary complete reopens do not recount the partition.
- **Regression instrumentation:** `crates/snapback4-device/Cargo.toml` enables
  rusqlite trace/hooks only for tests; `tests/residency.rs` records executed
  SQL, full-scan steps and SQLite authorizer reads around the actual public
  dispatcher call. It rejects every read of `r`, including indexed range
  scans whose SQLite `FullscanStep` happens to stay zero. The 20,000-row case
  exercises this before and after reopen. The same file adds incomplete
  installation cases for all triggers absent and each single trigger absent,
  stale counters, reopen, insert, Unicode update, delete and a second reopen.
- **Release regressions:** `crates/snapback4/tests/run_admission.rs` adds two
  tests. Two independent release directories share a moved database via
  symlinks; startup works without a preexisting lock at its actual location,
  one server owns it, the second refuses with that address, and token/deploy/
  rollback through either alias refuse without a new release or pointer
  change. The test reverses server ownership after exit. A real token command
  paused behind a SQLite writer owns the resolved path before opening;
  competing token, serve, deploy and rollback refuse. Contenders have bounded
  waits and owned-process cleanup, including when a regression lets a second
  server start.
- **Client regressions:**
  `packages/snapback4/test/device-residency.test.mjs` compares heap reports to
  the actual exported `WebAssembly.Memory.buffer.byteLength`, explicitly
  grows it by two pages and compares again. It kills its own native process
  with SIGKILL and requires the coded read error. Returned refusal and
  rejected-call cases verify closed/session precedence; an app-facade case
  retires custody while a rejected read is pending.

The public forms are unchanged: `await client.residency()` returns the same
measurement, and `snapback4 token --release release-a --service worker`
works offline and refuses with `E_STORE_BUSY` while either alias is served.
`snapback4 serve release-a --port 0` now starts successfully with
`release-a/store.sqlite` symlinked to `external/store.sqlite`.

### Regression and mutation evidence

Local logs live under `target/lane-r1-evidence/` (ignored build output).

| Probe | Deliberate old behavior | Exact focused outcome |
| --- | --- | --- |
| Release symlink regression | Restore merged round-0 serve/releases/verbs implementation | 0 passed, 1 failed; startup reproduces `No such file or directory (os error 2)`; exit 101 |
| Native/helper rejection | Restore round-0 residency helper | 0 passed, 2 failed; uncoded `native device exited (SIGKILL)` and `device host died`; exit 1 |
| Astra heap mutant | Replace actual wasm memory read with `65536` | 0 passed, 1 failed; `65536 !== 1376256`; exit 1 |
| Grok partition-scan mutant | Replace counter lookup with `COUNT(*)` / `SUM(length(CAST(data AS BLOB)))` over `r` by catalog number | 0 passed, 1 failed; trace/authorizer reports partition reads; exit 101 |
| Grok partial-install mutant | Restore the table-exists-only installation shortcut | 0 passed, 1 failed; stale counter fixture disagrees with actual rows; exit 101 |

Every mutant was restored. Final focused checks passed native residency 3/3,
CLI admission 14/14, client residency 5/5 and guide 86/86, with no skips.
The partial-install test constructs the durable table-without-triggers state
a split-transaction crash would leave; it proves next-open repair. It does
not claim a timed OS-crash injection into SQLite's own atomic commit.

### Qualification and limits

Implementation commits: `d484b143b` (coded errors and actual wasm memory),
`9140277e3` (counter repair and scan evidence), `3adc19d52` (release
ownership). All, and merge `b90a195f4`, carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

No deviation from the round-1 requested behavior. The error spelling reuses
`E_STORE` instead of introducing another code. Recovery covers incomplete
trigger sets rather than relying only on the existing transaction to make
them impossible. No authority/disclosure check, meter ceiling, wasm budget,
Quarry form or publication pin was changed. No known open round-1 defect or
unimplemented finding remains. Native iOS/Android app qualification and
physical IndexedDB disk allocation remain outside the evidence, as in round 0.

The full-suite run is bound to implementation commit `3adc19d52`, using
Node 24.18.0, Rust 1.97.0, Bun 1.3.14 and wasm-bindgen 0.2.127, eight build
jobs/eight Rust test processes, four Rust test threads, debug symbols and
incremental builds disabled, and serialized client files on this shared host.
Its wasm build reports **2,021,689 B raw / 581,094 B gzip**, unchanged from
round 0 and **1,000 B below the unchanged 582,094 B budget**.

Ran **`bash scripts/test.sh` exactly once in round 1**, on the committed
implementation above. It exited **0**, with the literal final summary:

```text
== 0 failure(s) in 3096 s
```

Every check passed. Rust: **3,580 passed, 0 failed, 19 ignored**. Fixture
wrapper tests: **9 passed**. Client tests: **2,220 passed, 0 failed, 10
skipped** (2,230 tests). Seeded client models: **78 passed, 0 failed**.
There were no cancelled tests and no `-- FAIL:` check. Implementation source
stayed unchanged throughout. No post-suite fix or affected-test rerun was
needed. The longer duration includes explicitly serialized client files
(1,875 seconds); the Rust phase took 937 seconds and models 254 seconds.

There are **no failures to classify** as lane-owned, baseline or
environmental. The ten skips are exactly the pre-existing platform/artifact
cases listed in round 0's “Environment-gated skips” section: macOS native
media, managed-identity/profile witnesses, the published 0.2.27 reference,
the 0.2.33 F2 fence, three 0.2.33 capability fences plus their control, and
the 0.2.32 sync compatibility witness. No lane regression was skipped.
The deliberate negative regression/mutation runs above are separate from
this green complete invocation, and none of those mutations remains.

Evidence: `full-suite.log`, `full-suite.exit`, `full-suite-commit.txt`, the
`merged-*`, `*-restored`, `mutation-*`, `regression-*` and `guide-final`
logs under `target/lane-r1-evidence/`. This report and the one dated round-1
journal entry are the only changes after qualification. No push or package
publication occurred. No known open round-1 problem remains.

## Round 2 — 2026-09-26

Read the round-1 report, the original lane prompt, and both blind reviews in
full: Astra `r2-r1.astra.md` (NOT READY) and Grok `r2-r1.grok.md` (READY WITH
CHANGES). Every finding is accepted. No counterexample is claimed against a
review. Orientation follows LLP 3000 §4, the current LLP 3000.019 §3.4, the
residency/refusals cards, and LLP 3000.011.004.000 §2's pre-admission retry
boundary. The newer ownership brief supersedes that older document's live
external-CLI compatibility; direct SQLite contention remains covered.

### Ownership design

Ownership is a Unix `flock` on the **database file**, held by one raw descriptor
opened before SQLite. Backend commands and hosts take exclusive ownership;
`device` processes take compatible shared ownership. Thus two native process
devices may use SQLite's existing transaction and generation protocol, while
neither can coexist with a backend owner. A backend command likewise refuses
while any device owner remains. This is the requested compatible-device choice.

Acquisition resolves the canonical database path, opens without following a
new final-component symlink, locks, then compares descriptor and path metadata
(device/inode). If the name disappeared or changed identity, acquisition drops
that descriptor and retries, bounded to 16 attempts, before SQLite is opened.
The guard retains the resolved path and descriptor. Every guarded SQLite open
and retry uses that retained path and checks its identity again; `run` cannot
acquire A and then follow a retargeted invocation alias into B. Moving and
relinking the live database cannot defeat its inode lock. Replacing/removing
`serve.lock` has no bearing on admission.

No guard validation opens and closes a second database descriptor. Server
state retains an `Arc` to the guard through background/request workers and
drops its engine/readers before its last ownership reference. Command/device
locals similarly drop SQLite before the guard. The cross-process test proves
SQLite still excludes a competing writer in both WAL and DELETE journal
modes. An injected extra raw open/close makes that test fail in DELETE mode,
exposing precisely the POSIX-lock pitfall in the brief.

`serve.lock` is only an address hint. Creation uses `0600`, `O_NOFOLLOW`, and
`O_NONBLOCK`; descriptor metadata must show a regular file before truncation.
Directories, FIFOs and symlinks refuse with existing `E_STORE`, a path and a
repair/retry instruction. Hard links are also refused, including a hard link
to the database. Address reads (including doctor) use no-follow, bounded
reads. Missing or replaced address records cannot grant ownership; an empty
record reports `owned by another CLI command or a server starting up (address
pending);`, distinct from the static recovery sentence.

### Findings and changed files

Paths are relative to `snapback4/`.

| Finding | Files and resulting behavior |
| --- | --- |
| 1: unguarded device writer | `crates/snapback4/src/verbs.rs` acquires shared database ownership before device initialization. A running dev host causes `E_STORE_BUSY` before side tables or `clear_rows` can write. `src/store_owner.rs` implements compatible shared device/exclusive backend locks. |
| 2: destructive address symlink/nonregular file | `src/store_owner.rs` verifies the opened record before truncation, creates/tightens to `0600`, refuses symlinks/FIFOs/directories/hard links, and bounds address reads. `src/verbs/adoption.rs` uses the same safe address reader. |
| 3: directory-entry ownership and retargeted retries | `src/store_owner.rs` retains the database descriptor and canonical path. `src/verbs/run_admission.rs`, `src/verbs.rs`, `src/verbs/releases.rs`, and `src/verbs/witness/smoke.rs` open through that guard. `src/serve.rs` retains ownership through server workers, and `src/serve_adoption.rs` uses it on initial and generation-recovery opens. `src/project.rs` attaches a release using the already guarded store and removes its obsolete unguarded opener. `src/serve_tests.rs` sets no owner for in-memory test hosts. |
| 4: stale native residency | `crates/snapback4-device/src/sqlite_residency.rs` reads through `Store::read_transaction`, which checks the handle's adopted generation in the same snapshot. `src/sqlite.rs`, `src/store.rs`, `src/device.rs` and `src/call.rs` carry the mutable store borrow to that transaction. Stale public clients now receive `E_GENERATION`. |
| 5: missing regression evidence | `crates/snapback4-device/src/sqlite_residency_tests.rs` interrupts the real installer with a competing connection. `tests/residency.rs` pins exact page bytes and stale-owner behavior across adoption. `packages/snapback4/test/device-residency.test.mjs` checks both through the public native client. `crates/snapback4/src/store_owner_tests.rs` proves SQLite lock coexistence and refuses a changed/gone canonical path. `tests/run_admission/identity.rs` holds the six new filesystem/process scenarios; `tests/run_admission.rs` registers them and pins the empty-record owner phrase. |
| Documentation | `crates/snapback4-lang/src/guide.rs`, `src/guide/codes.rs`, `src/guide/refusals.rs` and `tests/guide/definitions.rs` describe database ownership and generation refusal. `packages/snapback4/CLIENT-AND-OPERATIONS.md` explains compatible devices and the address-only record. This report and one appended journal entry record qualification. |

No new Quarry spelling is introduced. Existing forms still apply:

```sh
snapback4 dev --port 4400
# Same database, another terminal:
snapback4 run backfill
# E_STORE_BUSY at .../store.sqlite; no work admitted.
snapback4 device .snapback4/store.sqlite backend.json
# E_STORE_BUSY before device initialization.
```

```ts
const held = await client.residency(); // native totals are exact allocated SQLite page bytes
// If another handle adopts a new schema, this stale client's next call rejects E_GENERATION.
```

### Tests and negative probes

Focused checks on the restored implementation: admission **20/20**, native
residency **3/3**, installation boundary **1/1**, ownership tests **3/3**
(including the subprocess fixture), complete guide **86/86**, and public client
residency **5/5**, with no skips. Package build and frozen dependency install
also passed. Logs are `target/lane-r2-*.log`; full qualification is under
`target/lane-r2-evidence/`.

The six new admission scenarios prove:

- deleting and replacing a running host's address record still refuses a
  second dev, mutation and token command;
- moving the live database with its WAL and SHM, then relinking its old name,
  still refuses dev/run/token and creates no destination address record;
- retargeting A's alias to live B after a real writer made `run put` wait
  writes only A after release (A has two rows, B retains one);
- symlinks to the database and an unrelated file, a directory, FIFO and
  database hard link all refuse without changing either file's bytes;
- `device` cannot clear a running server's row or create any device side table;
- two native device processes open compatibly, exclude backend writers, and
  retain exclusion until the last device exits.

The installation test pauses the actual installer after backfill at its first
trigger via SQLite's authorizer, refuses that statement, and verifies complete
rollback. At the barrier a competing installer gets SQLite BUSY and cannot see
a committed counter table; after rollback it installs and verifies all three
triggers and exact Unicode counters. This is injected SQL failure at the real
transaction boundary, not OS power-loss/crash injection.

| Deliberate mutation | Observed rejection |
| --- | --- |
| `totalBytes = pages * page_size + 1` | Exact total assertion: 237,569 versus 237,568; 0 passed / 1 failed, exit 101. |
| `totalBytes = 1 << 30`, kind still `sqlite-pages` | Exact total assertion: 1,073,741,824 versus 237,568; 0 passed / 1 failed, exit 101. |
| Commit the counter table before installing triggers | Competing connection sees a table (1 versus 0), and interruption leaves a committed remnant; 0 passed / 1 failed, exit 101. |
| Open and close another raw database descriptor during guard validation | A DELETE-mode competing SQLite writer succeeds despite the held write transaction; lock-coexistence test fails, exit 101. |

All mutations were restored before the final full invocation.

### Qualification, deviations and open problems

Implementation commits before the full run: `1e01ec296` (native generation
fence and atomic/exact accounting evidence), `6c8aec280` (database ownership,
compatible devices, address-record safety and process regressions). Both carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

Ran **`bash scripts/test.sh` exactly once in round 2**, at `6c8aec280`.
It exited **1**, with the literal summary:

```text
== 1 failure(s) in 3082 s
   wasm build
```

The sole failure is **lane-owned**, not baseline or environmental: the new
`Device::residency` wrapper lacked `#[cfg(feature = "native")]`, while its
store method already had that gate. The web build therefore failed with
Rust E0599 (`no method named residency` for `S`). The script continued through
every other check; source stayed fixed during the complete invocation.

All remaining checks passed: **3,590 Rust tests passed, 19 ignored**; fixture
wrapper **9 passed**; client suite **2,220 passed, 10 skipped** (2,230 tests);
seeded client models **78 passed**. There were no failed or cancelled test
cases. The ten client skips are the same platform/external-artifact cases
listed in round 0 above, and none is a lane regression. Rust took 973 seconds,
serialized client files 1,818 seconds, and client models 258 seconds.

Commit **`d3a000f94`** repairs the feature gate and corrects the witness unit
fixture's descriptor order: it closes SQLite before acquiring/releasing a
raw ownership descriptor. It carries the same requested co-author trailer.
Per the brief, the full script was **not** repeated. These affected checks
then all passed, with no skips:

- `bash scripts/build-wasm.sh` — exit 0.
- `bash scripts/check-release-guard.sh` — exit 0.
- `cargo test -p snapback4-device --test residency` — 3 passed, exit 0.
- `cargo test -p snapback4 --bin snapback4 smoke_barrier_advances_only_the_commit_clock`
  — 1 passed, exit 0.
- `bun run --cwd packages/snapback4 build` — exit 0.
- `node --test packages/snapback4/test/device-residency.test.mjs`
  — 5 passed, exit 0, against the rebuilt wasm package.

The repaired wasm measures **2,021,689 B raw / 581,094 B gzip**, **+0 / +0 B**
against the prior rounds' measurements and **1,000 B below the unchanged
582,094 B budget**. This is a size comparison, not a digest-identity claim:
the retained artifact used by the full client run and the rebuilt artifact
have different SHA-256 hashes, both saved in the evidence directory. The full
client run used that retained artifact after the failed wasm build; the
post-repair residency tests used the freshly rebuilt artifact. The repair
removes a native-only wrapper from web compilation and changes no web behavior.

Toolchain actually used on this host: Node **24.13.1**, Rust **1.97.0**, Bun
**1.3.14**, wasm-bindgen **0.2.127**; no wasm-opt. The original prompt's PATH
setup was used. Build jobs and Rust test processes were capped at eight;
`RUST_TEST_THREADS=4`, debug symbols/incremental builds disabled, and
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`. Full log, exit, source commit and the
six repair-check logs are in `target/lane-r2-evidence/`.

No requested finding remains open, and no finding was rejected. There is no
behavior deviation from the round-2 rule. Engineering choices are shared
device ownership, bounded acquisition retries, reuse of `E_STORE` for unsafe
address records, and rejecting hard links as well as the required symlinks and
nonregular files. No authorization/disclosure rule, runtime meter, wasm budget,
Quarry spelling, version or publication pin changed. Address deletion or
replacement can lose the owner-address hint, but never the lock. Relocation
tests establish exclusion, not a live-file migration or backup protocol.

Evidence remains scoped to this Linux host, process clients and wasm. No
native iOS/Android app build or OS power-loss injection is claimed. External
SQLite writers that do not participate in `flock` still use SQLite's own
locking and the existing bounded CLI retry. No push or publication occurred.


## Round 3 — 2026-09-26

Read the original lane prompt, this report through round 2, and Grok's
`r2-r2.grok.md` in full. Accepted all three new defects and the open-time
recount test gap. The prior round-1 findings remain fixed. Astra did not
complete a review this round; no additional independent review is claimed.

Orientation scope is native store identity/ownership, address records and
residency installation. Governing context: LLP 3000 §4 (the independent
Snapback 4 fence), LLP 3000.019 §3.4 (current working set, residency and
writer refusal), LLP 2000.000 §6 (unchanged runtime meters), and the
residency guide card. No new design document or hand-off is needed. These
fixes implement the existing ownership choice; documentation changes are
in the guide, operations reference, this report and one appended journal entry.

### Findings and changed files

Paths are relative to `snapback4/`.

1. **Readers use the owned database.** `crates/snapback4-core/src/store.rs`
   retains the device/inode identity of the opening connection. After opening
   a detached read connection, `reader()` stats its path and rejects a
   different identity with the existing moved/replaced store error. The new
   connection drops on that error. The existing `/sync` and `/changes`
   fallback keeps using the original engine. Identity checking uses metadata
   only, avoiding an extra raw database descriptor that could disturb SQLite's
   POSIX locks. `crates/snapback4/tests/run_admission/identity.rs` moves the
   live one-row store and both sidecars, copies a different two-row database
   into its old path, and requires snapshot sync, stream sync and changes to
   retain the original identity and watermark 1. Both sync modes return one
   event, never the replacement's two rows under the original identity.
2. **Embedded devices share ownership.**
   `crates/snapback4-device/src/sqlite.rs` now calls `Store::open_shared`
   before all SQLite/device initialization. The new
   `crates/snapback4-core/src/store/ownership.rs` resolves the database,
   acquires shared ownership, validates its identity, and opens SQLite while
   retaining that descriptor. `store.rs` keeps the guard after the connection
   in field drop order; detached readers share its lifetime. Multiple shared
   descriptors, including the CLI's existing outer guard, coexist.
   `crates/snapback4-core/src/error.rs` supplies native-only `E_STORE_BUSY`
   with the path site, store family and a concrete separate-store/stop-writer
   rewrite. Two direct C-ABI tests in `run_admission/identity.rs` prove that
   `sb4_open` beside a live dev server returns null before any device table or
   row change, and that two successful C-ABI handles exclude dev/run until the
   last handle closes. The surviving handle can still read residency after
   its peer closes. `crates/snapback4-lang/src/guide.rs` and
   `packages/snapback4/CLIENT-AND-OPERATIONS.md` explicitly cover embedded hosts.
3. **Address refusal precedes mutation.**
   `crates/snapback4/src/store_owner.rs` validates the address descriptor's
   regular-file type, single link and distinct database inode inside
   `regular()`, before permissions or length change. The existing unsafe
   address-file test in `run_admission/identity.rs` now includes an unrelated
   hard-linked file explicitly set to 0644, and verifies both its original
   mode and its bytes after refusal.
4. **Reopening cannot silently recount.**
   `crates/snapback4-device/tests/residency.rs` registers the new
   `tests/residency_open/mod.rs`. It uses SQLite's auto-extension hook to
   attach a read authorizer at connection creation, then runs the real second
   `Device::open`. The observer records metadata reads (proving it ran) and
   refuses any read of `r` in the assertion. Instrumentation is confined to
   the test thread and unregistered on scope exit; production code has no
   test hook. Counters and exact page totals must remain unchanged.

### Tests and deliberate mutation

All final affected checks passed, with no skips: native residency **4/4**,
interrupted installation **1/1**, CLI/process/C-ABI admission **23/23**,
ownership **3/3**, complete guide **86/86**, public client residency **5/5**,
and package build. `bun install --frozen-lockfile` passed without changes.
The initial HTTP test fixture omitted a sync declaration and correctly got
zero events; adding `sync public last 100 by byId` made the fixture exercise
row delivery. That was corrected before its commit and full qualification.

Deleting exactly `if installed { return Ok(tx.commit()?); }` from
`sqlite_residency.rs` makes
`a_second_device_open_does_not_read_the_installed_partition` fail with
**0 passed / 1 failed, exit 101**: the real open's authorizer records reads
of `r`. The original source was restored automatically in a `finally` block;
the complete four-test native residency target then passed. No mutation remains.

Existing forms continue to compile and run, without new Quarry syntax:

- `POST /sync` with `{"from":0,"limit":100}` answers the owned store even
  after replacement of its pathname; `stream: true` follows the same rule.
- `sb4_open(device_path, backend_json)` supports two compatible embedded
  handles; the same call on a live server's path returns null and
  `sb4_open_reason` reports `E_STORE_BUSY`.
- `await client.residency()` retains the same measurement contract and
  returns counters without rereading the partition on a complete reopen.
- `snapback4 run put` refuses an unsafe hard-linked address record with
  `E_STORE`; the unrelated file's mode and content remain unchanged.

Implementation commits, each with the requested co-author trailer:
`2726e185a` (reader identity), `e70f80914` (address-record refusal),
`274da8439` (embedded native ownership), `6010d0460` (open-time observation).
Evidence is under `target/lane-r3-evidence/`.

### Qualification, deviations and open problems

Ran **`bash scripts/test.sh` exactly once in round 3**, on implementation
commit `6010d0460`. It exited **0**, with the literal final summary:

```text
== 0 failure(s) in 3120 s
```

Every check passed. The log records **3,595 Rust tests passed, 19 ignored**
(including doctests), fixture wrapper **9 passed**, client suite **2,220
passed / 10 skipped** (2,230 tests), and seeded client models **78 passed**.
There were no failed or cancelled cases and no failure to classify as
lane-owned, baseline or environmental. The ten client skip names and
prerequisites match round 2 exactly; they remain the environment-gated cases
listed earlier in this report, not new passing evidence. No post-suite repair
or test rerun was needed. Rust took **940 s**, serialized clients **1,862 s**,
and the seeded models **258 s**. Source stayed unchanged throughout the run.

The suite rebuilt wasm successfully at **2,021,689 B raw / 581,094 B gzip**:
**+0 / +0 B** against round 2 and **1,000 B below the unchanged 582,094 B
budget**. This is an artifact-size comparison, not independent per-change
attribution. Its SHA-256 is saved in `target/lane-r3-evidence/wasm.sha256`.
The full client run used this newly rebuilt artifact.

Toolchain: Node **24.13.1**, Rust **1.97.0**, Bun **1.3.14**, wasm-bindgen
**0.2.127**, no wasm-opt. Cargo build jobs and Rust test processes were capped
at eight; `RUST_TEST_THREADS=4`, debug symbols/incremental builds disabled,
and `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`. The full log, exact exit code,
source commit, environment and start time are retained under
`target/lane-r3-evidence/` beside the focused checks and mutation log.

No requested finding is rejected, no design change or new Quarry form was
needed, and no known round-3 problem remains in the affected checks. The
native refusal's structured path and recovery are implementation details
where the brief was silent. The wasm budget, authorization, disclosure,
meters, versions and publication pins are unchanged. Evidence is from this
Linux host, direct C-ABI/process clients and wasm; it does not claim an
Expo iOS/Android app build, power-loss injection, or live-file migration.
No push or publication was performed.
