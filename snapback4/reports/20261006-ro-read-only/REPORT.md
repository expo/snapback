# RO — LLP 3000.033 implementation

Date: 2026-10-06. Branch: `sb5/ro-read-only`. Base: `9bcf6cfb63`.
Implemented Accepted revision 3, including all three review dispositions.
No RFC deviation. No requested implementation or acceptance work is deferred.
No push or publication. Final commit: `86370692480ff439d5e5bfab081c05bae8bab532`. Requested co-author trailer is present; working tree is clean.

## What changed

- Independent `_read_sessions` families with `ro.` tokens, an immutable expiry
  cap and captured principal generation. Capability triples flow through every
  resolver and both authority adapters. PostgreSQL initializes the additive
  table when attaching an existing store as well as creating one.
- Atomic narrowing takes the writer lock before sampling time or authenticating
  the parent. Read refresh rotates only its own family, never sweeps foreign
  sessions and never raises its cap. Full logoutAll invalidates read families;
  independent family logout works in both directions.
- The first authenticated read-token branch applies the closed allow-list
  before declared routes, mutation replay and development doors. The prefix
  selects that branch; stored scope remains authoritative. Refusals carry
  neither head nor store identity. Existing full-session input-validation
  ordering and wire responses are preserved.
- Read `/changes` neither enters nor leaves presence or writes effect presence.
  `/schema` remains available. The complete asset disclosure/Range/once ordering
  is preserved, with `E_ASSET_READ_ONLY` before opening unviewed once-media.
  Every engine branch, including PostgreSQL and native queries, honors
  request-scoped `DeliveryManifest::Skip` before construction.
- Online `createClient` and `createApp` support `readOnly`, verify each exact
  credential before traffic or asset-source export, and omit delivery queues,
  ephemeral write lanes, write history, mutation IDs and pending-write owners.
  Read custody uses SecureStore-safe `.read` keys; legacy sessions remain valid.
  Writes fail locally, active `useSeen` throws, scoped sign-in and
  `narrowSession` are public, and automatic refresh stops at the cap.
  Every device admission path checks the token prefix, including offline
  restoration, guest results and refresh successors, before adoption/persistence.
- Added `guide read-only` and its four aliases, client/receipts entries, five
  diagnostic registrations, executable auth example and required guide fact
  pins. Updated the await-boundary inventory after classifying the new paths;
  existing delivery fault sites and recipes are unchanged. No schema capability,
  parser/IR or device wire format changed. Source files remain below 1,500 lines.

## Acceptance evidence

| Requirement | Executed evidence |
|---|---|
| Paired deterministic runs | `crates/snapback4/tests/serve_read_only/mod.rs`: fixed account/password fixtures, real receipt families, history gap, live convergence after Alice's write, due presence effect, assets, refreshes and cap expiry. All SQL tables except read-family state and store/schema metadata are digested, including `_ops`, every full session, principals and credentials. |
| HTTP barriers, replay and parity | Same Rust module plus `read-only-server.test.mjs`: immediate durable snapshots, full-client ephemeral reads, real worker/provider call witness, forbidden route matrix, identical full-sibling ID executes fresh, read replay is refused, full replay executes once. Full/read answers alternate on reused readers; work counters match. `connected[viewer]` follows actual full-poll presence. |
| Poll overlap and effects | Both start orders and both close orders, checking count/grace after each close. Paired runs hold a read poll across the ordinary effect deadline; claims fail before it and succeed exactly when due. |
| Narrowing and revocation | `crates/snapback4-core/tests/read_sessions.rs`: independent families, global revocation, ordinary member eligibility, service/action/supervisor refusal, captured generations, and writer-lock races with a real busy-handler barrier and clock sampling after the lock. |
| Published downgrade | Real npm `snapback4-linux-x64@0.4.13` on the migrated store refuses a read token; full logoutAll on that binary leaves the read token revoked after re-upgrade. The test ran with the published-binary environment set; it was not skipped. |
| Startup, device and custody | `read-only.test.mjs` and the real-server suite: held probe on a near-expiry full bearer, all read/asset/refresh entrypoints withheld, unusable assetSource, unsupported/full/forged scope refusals, SecureStore-alphabet store double, separate interactive credential and pending journal preserved, offline prefix checks, legacy restore, at-cap/no-hint expiry, one extendable automatic rotation, and cancelled successor verification before cleanup. |
| Ephemeral backend | Real read-only SDK fetches `/schema`, observes and converges after a full client's tracked write on a backend declaring an ephemeral table. |
| Manifest suppression | Direct construction counter on repeated interpreted HTTP requests and a native-engine query; zero for Skip, one for Build. Full HTTP responses retain manifests and full SDK pagination advances delivery. PostgreSQL branch compiles with the same option. |
| Asset matrix | Missing, hidden, expired, released, already viewed, ordinary full/ranged, once ranged and unviewed cases; removing once-media bytes still yields the pre-open read refusal. A full session subsequently consumes the asset exactly once. |
| Phase-2 oracle | `test/helpers/native-oracle-read-only.mjs`: fresh Bob password login with read scope, `readOnly: true`, generated `api.apiHistory`, complete pagination and the original chronological/receipt output protocol. Seven real tracked messages are returned with Bob's delivered watermark and `_ops` unchanged. |

Paired final SHA-256:
`e15809273ad09307d18d1d0e443d46dd93a8a424aa9ceca31ab2b6bcb0930136`.
Earlier exploratory digests omitted account tables; this final fixture includes
byte-identical account rows and credentials and supersedes those exploratory values.

The original oracle was read over SSH, without writes, from
`ccheever@100.64.36.16:~/clique-native-pilot-20261005/lanes/snapback4/scripts/native-oracle.mjs`.
The equivalent fixture keeps its protocol, fresh login, pagination, row mapping,
receipt state, chronological reversal and close; its query comes from generated API.

Published artifact used:
`https://registry.npmjs.org/snapback4-linux-x64/-/snapback4-linux-x64-0.4.13.tgz`.
Verified npm SRI:
`sha512-CmSkNA2mU7PbWjoAR2hYlH+lPJyTc9nvhGqEvSJa5gxHmKQvNMnYApsBbLAgpYueFiL189Kv/IE6EiR+3LFD0Q==`.
The executable remains outside the repository in
`~/sb5-lanes/ro-evidence/published/package/snapback4`.

## Verification and initial failures

Commands ran in `snapback4/` on eb1000 with Node 24.13.1/Bun 1.3.14 and
`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=~/sb5-lanes/target`, debug info disabled
for dev/test and eight Cargo build jobs. Compressed logs are in `evidence/`.

The complete `bash scripts/test.sh` ran to completion in 2,155 seconds. Build,
wasm, documentation budget, release guard, package typecheck/build, chat/Expo
typechecks and fixture wrappers passed. It executed the full Rust inventory and
325 client files, then both default-count models: 52 + 27 tests passed, including
5,000 histories for each session tier. Its initial Rust/client phases reported
failures; this is **not** a single-green-run publication receipt. Every failed
target/file has a passing rerun after fixes:

- `core-final.log`: core library 242 passed/one existing ignored; bound-session
  8, read-session 4, row-view accounting 6, disclosure 18 and witness 6 passed.
  A root target symlink had violated private store path checks; the local target
  is now a real directory with only compiler artifact subdirectories linked to
  the shared target. The bound-session column census now includes stored scope.
- `cli-final.log`: 324 passed/four existing ignored, check 89 and token-live 20
  passed. The early guard now preserves full-token handler validation order and
  existing refusal shapes. `http-focused-final.log`: final six RO tests passed,
  including the final account-inclusive digest and connected-query assertion.
- `guide-final.log`: 113 passed after adding the new code actions, definition
  homes and keyword census, while retaining guide word budgets.
  `native-counter.log`: native construction counter passed.
- `js-regressions-final.log`: event-slot tests, HTTP bounds, full async fault
  matrix, server-e2e, witness acquisition, social browser, RO SDK/server and
  export-background reruns passed. Event traces were copied into the now-real
  local target; witness acquisition used `SNAPBACK4_ACQUIRE_HELPER` pointing at
  this checkout's helper because the executable is in the external shared target.
  Initial browser/RO runs overlapped source/build edits; final files passed.
  The first README rerun found incorrect example imports; `readme-final.log`
  records the corrected 40-block/54-function check and all eight tests passing.
- `device-refresh-final.log`: all 53 tests across RO, refresh behavior, local
  app sessions, schema sessions and session security passed after strengthening
  returned-credential admission. `await-census-final.log` and
  `typecheck-final.log` pass on the final source; package build also passes.
  `local-model-final.log` repeats all 5,000 local session histories after that
  last admission change: one aggregate test passed, no skips, in 158 seconds.
- `postgres-final.log`: `cargo check -p snapback4-core --features postgres`
  passed. PostgreSQL runtime integration was not run; this task's adapter
  requirement was preserving the build and scope propagation.

For the published-server test, set
`SNAPBACK4_PREVIOUS_PUBLISHED_BIN=~/sb5-lanes/ro-evidence/published/package/snapback4`
when running `read-only-server.test.mjs`. Without it the reusable repository
test explicitly skips that one case; both recorded executed runs provided it.
Platform-only/existing suite skips remain labelled, never counted as passes.
No macOS fleet machine was used.

The principal affected Rust commands were `cargo test -p snapback4-core --lib
--test bound_session --test read_sessions --test row_view_accounting --test
row_view_disclosure --test row_view_witness`, `cargo test -p snapback4 --bin
snapback4 --test check --test token_live`, `cargo test -p snapback4-lang --test
guide`, and the native manifest counter in `cargo test -p snapback4-sim --test
native`. The final HTTP run used `cargo test -p snapback4 --bin snapback4
read_only_tests -- --nocapture`. JavaScript reruns used the repository's
`node scripts/run-client-tests.mjs` file runner; the final local model used
`node --test --test-name-pattern='^local session state machine'
packages/snapback4/test/app-session-model.test.mjs` without reducing its count.

`./ref-check --verbose`: 529 LLP documents, 10,446 references, zero errors or
unchecked references. `git diff --check`, the pure-append JOURNAL assertion and
the affected-source line-limit check pass.

## Budgets and handoff

`bash scripts/build-wasm.sh`: **2,117,335 bytes raw; 639,888 gzip** against the
unchanged 639,941-byte limit in `metrics/wasm-budget.json`.
Wasm SHA-256:
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.
It matches the pre-change HR report's artifact exactly: zero device growth.
Schema-capability tests ran in the full suite; no capability declarations or
device compatibility fences changed. No generated API files are committed.

LLP 3000.033 records implementation and leaves its review dispositions intact;
its completed current link is archived. JOURNAL is a pure append. Final reference
and diff audits are retained with the evidence. Completed lane-local orphaned
SQLite test sidecars (1,777,750,968 bytes) were removed; shared build products
belonging to other lanes were left intact. Incremental compilation stayed off.

Durable report and compressed evidence: [REPORT.md](/home/ccheever/sb5-lanes/lane-ro/snapback4/reports/20261006-ro-read-only/REPORT.md).


## Round 1 — code-review fixes (2026-10-06)

Folded Astra's four reproduced failures and the Grok changes. Checkpoints
`b75f3e6bb4` and `b5c4bd0a37` carry the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer. No push.

- Logout fences pending openers, checks their revision after persistence and
  before adoption, and conditionally deletes their credentials under the same
  storage lock. A permanent held-write regression restarts signed out.
- Account custody mismatch permanently fences the old facade, withdraws watches
  and asset sources, closes its raw client, and publishes signed-out state. The
  peer-account regression also checks that restoring the old token cannot revive
  the facade and that logout leaves the peer's stored credential intact.
- Refresh successors remain private across transient probe failures. Successful
  re-verification awaits the private app custody hook before exposing the session,
  notifying public listeners and scheduling. The regression recovers, persists
  once, and authenticates after restart. Public notification callbacks are not
  awaited; a callback may itself query without deadlocking rotation.
- Consumed predecessors leave custody after successor persistence. A 32-rotation
  regression checks that an old token no longer authorizes storage deletion.
- `insert_session` deletes expired `_read_sessions` using
  `expires_at <= now OR cap_expires_at <= now`. Both full and read sign-in collect;
  full refresh uses that mint path too. Read refresh remains family-local. Tests
  cover foreign expiry/cap boundaries and three repeated eight-day HTTP sign-ins.
- Session JSON adds `scope` and read-session `capExpiresAt`. `GET /probe?scope=1`
  adds `kind`/`scope`; unflagged GET now retains the legacy
  `{ok, store_id, seq, viewer}` body. New `POST /probe` uses the same flag. Auth
  bodies strictly accept only absent scope, `"full"`, or `"read"`, including
  refresh/logout. Stored read authority wins over a `"scope":"full"` body.
  These details correct the earlier broad unchanged-wire claim and RFC §7.
- Added forbidden GET/method cases, hidden+ranged and viewed+ranged asset
  precedence, construction counters in both memory and detached disk HTTP query
  branches, revocation while `/changes` is held in both branches, and no-sibling
  assertions on narrowing errors and writer races. All four `/tmp/ro-review-*`
  reproductions now have permanent assertion-based tests.

PostgreSQL limit: `docker ps` reports command not found; `pg_ctl`, `initdb`,
`postgres`, `psql` and Podman are absent, the standard install locations contain
no server tools, and `SNAPBACK4_EVAL_POSTGRES` is unset. Runtime integration could
not run. The adapter has **no production session mint/sign-in/refresh path in
this checkout**: only SQLite `identity::insert_session` mints; PostgreSQL test
fixtures insert authority rows directly. There was therefore no PostgreSQL mint
path to patch. Added ignored runtime regressions for stored scope/cap/generation
and manifest construction; `cargo check -p snapback4-core --features postgres
--tests` passes, compiling these tests. No PostgreSQL runtime or mint parity is
claimed.

Executed so far: core read-session tests **5 passed**, Rust HTTP RO tests **7
passed**, SDK read/custody tests **24 passed**, package typecheck/build passed.
The paired application digest remains
`e15809273ad09307d18d1d0e443d46dd93a8a424aa9ceca31ab2b6bcb0930136`.
Wasm is unchanged: **2,117,335 raw / 639,888 gzip bytes**, cap **639,941**.
At the focused-evidence checkpoint the complete suite was running; its passing
final result is recorded below.
All builds use `CARGO_INCREMENTAL=0`, `CARGO_TARGET_DIR=~/sb5-lanes/target`,
`CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=8`.


### Final Round 1 verification

The complete `bash scripts/test.sh` passed with **0 failures in 1,993 seconds**
(33 minutes 13 seconds), with incremental compilation disabled and the shared
target throughout:

- Full Rust inventory: **300 binaries, 1,013 executions, plus workspace
  doctests**, all passed (992 seconds). Existing ignored cases remain labelled.
  This includes the core library (242 passed / 1 ignored), CLI unit tests
  (325 passed / 4 ignored), guide (113 passed), native construction tests and
  the strengthened read-session/HTTP cases.
- Client pool: **326/326 files passed**, **6,486 tests passed, 47 labelled
  skips, zero failures** (619 seconds). The real published 0.4.13 downgrade
  test ran with `SNAPBACK4_PREVIOUS_PUBLISHED_BIN` set. The witness helper was
  supplied from this checkout because the binary lives in the shared target.
- Full-count models: **52 app/session + 27 online tests passed**, no skips
  (305 seconds); history counts were not reduced. Fixture wrappers: 9 passed.
- Build, wasm budget, docs budget, release guard, package typecheck/build,
  chat/Expo typechecks and chat compilation all passed in the same run.
- Focused reruns: 12 Rust tests and 55 JS tests passed. The successor recovery
  test additionally holds the persistence write and asserts no session, query,
  public notification or asset bearer escapes before it completes.
- `cargo check -p snapback4-core --features postgres --tests` passes, including
  the new ignored adapter runtime regressions. Availability evidence is retained
  in `evidence/round1-postgres-availability.log.gz`; the PostgreSQL limits above
  still apply.
- Final `./ref-check --verbose`: **529 LLP documents, 10,451 references,
  zero errors/unchecked references**. `git diff --check`, affected-source line
  limits and the pure-append JOURNAL check pass.

The final wasm remains **2,117,335 bytes raw / 639,888 gzip**, under the unchanged
**639,941-byte** budget. SHA-256:
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.
The full log is `evidence/round1-full-suite.log.gz`; focused and availability
logs use the same `round1-` prefix. The preflight wasm log is an independent
budget result, not the full-suite receipt. A first focused command named a
nonexistent `refresh.test.mjs`; the corrected `refresh-behavior.test.mjs` run
passed all 31 server/HTTP/refresh tests. No product-test failure needed repair
in the final full run.

Source checkpoints: `b75f3e6bb4`, `b5c4bd0a37`, and `1e9aec5c47`; focused evidence
checkpoint: `a8185931fe`. Every Round 1 commit has the requested Astra trailer.
After completion, removed only this lane's 1,636 closed SQLite fixture sidecars
(1,777,750,968 bytes), whose recorded test PIDs had exited. Shared compiler
artifacts were left intact. No push or publication.

Final Round 1 head: `c8c419a0d5f189b6a788cdcef111848bc144b073`. Working tree clean; no push.


## Round 2 — shared full-session custody (2026-10-06)

Checkpoint `adde06ee5c` removes `app-read-only.ts`; `createApp` now uses one
custody state machine for both modes. The policy selects `.read` session,
epoch and retirement keys, scope verification, read-scoped sign-in and the
cap-aware client, while omitting device/write owners and refusing global logout.
The shared path owns logout epochs, provisional opening, rollback, facade
ownership and auth publication before withdrawal notifications. Full-session
sign-in bodies and default storage keys remain unchanged.

Refreshes with a verification gate retain a private `snapback4Successor`
receipt in the session record under the shared custody lock. Peers and restart
recover that issued credential instead of refreshing a consumed predecessor.
The active token and all public session/read/asset access remain gated until
verification and commit; success removes the receipt atomically. Logout and
replacement retain both tokens for scope-checked retirement. Ordinary close
preserves pending custody. These details are recorded in RFC §1.4.

Permanent tests cover all four Round 2 findings, both real-server reproductions,
and the original Round 0 regressions. Variations include login/guest held during
verification, subscriber withdrawal on same-app replacement, old facade calls
during replacement verification, refresh peers arriving during response or
persistence, repeated failed probes and recovery after close/restart. The shared
full-session commit-result contract is preserved: a login whose durable commit
finished may return success even when a concurrent logout prevents public
adoption. The held-write regression asserts signed-out state, no credential and
signed-out restart. Logout now leaves the shared noncredential epoch tombstone.

The low finding now compares numeric `meter.heapBytes` (also requiring numeric
examined/steps values). The unknown-query refusal has no meter and remains in
whole-answer parity coverage. A positive read `/sync` test checks status 200,
full-response equality and an unchanged application snapshot.

Focused verification: 25 custody tests pass (18 races/variations, 4 original SDK
regressions, 3 real-server cases); all 8 Rust read-only HTTP tests pass. Package
typecheck/build pass. The full app/session selection and complete suite are
running with default model counts. Wasm has already passed inside that suite;
final counts and evidence will be appended when it finishes. No push.

Round 2 additional checkpoints: `d806acc039` repairs a reproduced retirement
race: after its scope probe, retirement rechecks custody under the lock at
logout dispatch. `c006a6dc23` asserts no interactive-slot reads and makes
fixture caps exactly equal to expiry. The final focused selection passes all
46 tests. The full app/session selection passed 832 tests across 26 files,
including 5,000 online and 5,000 local histories (52 model-file tests); its one
labelled skip was the prior published binary, omitted from that focused command.
The complete suite supplies that binary. The initial full run was deliberately
stopped in Rust qualification for the retirement repair; the restarted run
builds the final SDK source. Initial failure, focused successes and the stopped
run's preflight log are retained under `evidence/round2-*`.

The restarted complete run has passed its Rust phase: 300 test binaries,
1,013 executions and workspace doctests in 995 seconds, including 326 CLI
unit tests (4 existing ignored), 242 core unit tests (1 existing ignored),
and all 8 read-only HTTP cases. The source assertion text now describes the
private receipt and verified adoption writes accurately. The final reference
audit passes: 529 LLP documents, 10,453 references, no errors/unchecked refs.
These completed-phase logs are durably committed; the client pool and final
models continue in the complete run.


### Final Round 2 verification

The complete `bash scripts/test.sh` passed with **0 failures in 1,975 seconds**
(32 minutes 55 seconds), on the final SDK source. Counts were not reduced.

- Rust: **300 binaries / 1,013 executions plus workspace doctests**, all passed
  (995 seconds); existing ignored cases remain labelled.
- Client pool: **328/328 files**, **6,508 passed / 47 labelled skips / 0 failed**
  (619 seconds). All five read-only SDK/server files passed, including the real
  server custody regressions and the prior published-binary test with its path
  supplied.
- Models: **79 passed**, no skips (52 app/session tests plus 27 online-client
  tests), in 297 seconds. The log explicitly records **5,000 online and 5,000
  local session histories**, seeds 1–5,000.
- Fixture wrappers: 9 passed. Cargo build, wasm build/budget, documentation
  budget, release guard, package typecheck/build, chat compilation and chat/Expo
  typechecks all passed in this same completed run.
- Focused SDK/custody selection: 46 passed. Rust read-only HTTP selection:
  8 passed. The retirement-after-probe regression has retained before-fix
  failure evidence and passing final evidence.
- Reference audit: 529 LLP documents, 10,453 references, zero errors/unchecked
  references. Diff whitespace, source line limits and pure-append JOURNAL checks
  pass. No server production code changed in Round 2.

Wasm: **2,117,335 bytes raw / 639,888 gzip**, below the unchanged **639,941**
budget. SHA-256 remains
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`:
byte-for-byte equality with Round 1. No capability or budget changes.

The full qualification log is `evidence/round2-full-suite.log.gz`. It supersedes
the deliberately interrupted initial run, whose preflight log is retained
separately. Builds used Node 24.13.1/Bun 1.3.14, `CARGO_INCREMENTAL=0`, shared
`CARGO_TARGET_DIR=~/sb5-lanes/target`, dev/test debug info disabled and 8 Cargo
jobs. The full run supplied both the local acquisition helper and published
0.4.13 binary paths. Existing PostgreSQL/platform runtime limits from earlier
rounds remain unchanged; no new adapter runtime claim is made.

Implementation checkpoints: `adde06ee5c` (shared app custody and regressions),
`d806acc039` (retirement dispatch comparison), `c006a6dc23` (interactive-read
refusal assertion and deterministic caps). Evidence checkpoints: `28fe3afd32`,
`d01e4f75d5`, `109cdfe055`. Every Round 2 commit carries the requested Astra
co-author trailer. No push or publication.

Final Round 2 head: `929086afde25cfd2c9495229b357423b6c23386e`. Working tree clean; no push.

## Round 3 — cross-app rotation interleavings (2026-10-06)

Explicit logout now owns its last committed principal and epoch under the shared
storage lock. Peer rotation stays in that epoch, so logout tombstones and retires
its successor and fences peer logins already pending. Different principals and
later same-principal logins survive a stale logout. The real-server controls found
that full sessions had the latter latent replacement-deletion bug; the shared fix
covers both modes. Legacy epoch markers remain supported. No token lineage list
is needed; the old injected-predecessor test now exercises a genuinely newer epoch.

Rejection cleanup preserves a pending successor not included in the rejected
credentials, without advancing its epoch. Ordinary read transport recovers an
observed pending or completed peer rotation through the existing refresh probe
and awaited persistence, then retries at the new credential revision. A rejection
from an already-dispatched predecessor can still sign its runtime out but cannot
discard the successful peer's pending receipt. Committed login success is asserted
alongside signed-out state and restart in both modes.

Read Grok's completed review after `ro-c2.grok.exit` appeared (`EXIT=0`). Folded
its two additional low findings: malformed `.read` JSON now reaches restore's
existing garbage collection, with full-session controls; the guide and RFC now
name the isolated `.read.revocations` queue. Used the user's principal/epoch rule
instead of Grok's proposed unbounded token lineage.

Permanent real-server regressions come from `/tmp/ro-c2-peer-rotation.test.mjs`:
20 cases including both modes, pending peer login, two peer rotations, replacement
accounts/epochs, late predecessor rejection, legacy epochs and malformed storage.
Before-fix evidence records the two findings plus full-session replacement failures
and completed-peer recovery failure. Two initial full-session assertions compared
missing legacy epoch to explicit `0`; normalized them to the existing epoch format.
The first invocation used the wrong working-directory-relative path and ran no
tests; the retained before log is the corrected invocation.

Focused selection: 100 tests passed across 11 files, no skips; expanded final
peer file: 20 passed. Package typecheck/build passed. The complete suite and
an affected app/session model run are underway with full default history counts.
Final counts, wasm result and evidence will be appended after completion.
No push or publication.

Implementation checkpoint: `63d6cf1400` (Astra trailer). The affected app/session
model file passed all 52 tests, including 5,000 online and 5,000 local histories,
in 280 seconds; no counts were reduced and nothing was skipped. The full-suite
wasm check passed at 2,117,335 raw / 639,888 gzip bytes under the unchanged
639,941-byte cap. SHA-256 is unchanged from Round 2:
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.
Reference audit: 529 LLP documents, 10,455 references, zero errors or unchecked
references. Diff, source line limits and pure-append JOURNAL checks pass.
The first full-suite launch was stopped during preflight to correct its witness
helper path; its log is retained separately. The restarted full run supplies
`packages/snapback4/bin/witness-acquire.js` and the published 0.4.13 binary.
No completed full-suite result is claimed yet.

The full run's CLI unit target hit two native witness inspection failures:
`recovery_shell_shim_drains_final_empty_snapshot_joiner` and
`recovery_volta_style_shim_drains_late_group_member`, both
`E_WITNESS_PROCESS: invalid /proc process group` at `preparation.rs:418:106`.
This matches the existing open ticket
`issues/20261004-snapback4-native-witness-proc-group-inspection.md`, updated with
this recurrence. The witness path is unchanged by Round 3. Seven focused recovery
tests passed on an unchanged rerun; the entire CLI unit target then passed
326 tests with four existing ignores. The rejected stat snapshot was not retained,
so the exact cause remains unknown. These reruns do not erase the original
failures. The complete run continues through all remaining phases.

The full client pool found two checks to reconcile with the fix. The await
boundary seal needed the five new custody waits classified: one logout epoch
read and four read-only receipt-recovery waits, none acquiring delivery/outbox
custody. Updated only `app.ts` in the existing seal and documented the review;
all delivery fault sites and recipes remain unchanged. An older full-session
logout-retry test still expected a peer's replacement guest to be revoked. It
now requires the original deferred token to be revoked while the replacement
stays live, stored and restorable, matching the new permanent full-session
controls and the requested principal/epoch rule. No production code changed.
Both entire files passed their rerun: **417 tests, zero failures or skips**.
The original failures remain in the complete-suite log.


### Final Round 3 verification

The complete `bash scripts/test.sh` finished in **2,122 seconds (35m22s)** at
full default model counts. It reported **two failed phases / five failed
subtests**; this is **not a single-green-run qualification receipt**. Every
failed target/file has a passing final rerun, with original failures retained.

- Rust: **300 test binaries / 1,013 executions plus workspace doctests**.
  The CLI unit target had the two native witness `/proc` inspection failures
  recorded above; its unchanged full rerun passed **326 tests / 4 existing
  ignores**, and seven focused recovery tests also passed. All other Rust
  targets and doctests passed. Rust phase: 1,093 seconds.
- Client pool: **329/329 files executed**, **6,525 passed / 3 failed / 47
  labelled skips** (628 seconds). All read-only SDK/server files, including
  the 20 new real-server interleavings and published-binary test, passed.
  The app logout-retry assertion and await census were corrected as described
  above; their entire files passed **417 tests**, no skips. The third failure
  was the unchanged export-background crash case `publication-handoff (off,
  next Expo fails)`: its maintenance queue did not drain within 90 seconds.
  The unchanged entire-file rerun passed **58 tests / 36 platform skips**
  in 320 seconds. The new filesystem ticket
  `issues/20261006-snapback4-export-maintenance-handoff-drain.md` retains the
  signature and missing-evidence limit. A passing rerun does not establish
  its cause or erase the original failure.
- Full-suite models: **79 passed**, no skips (52 app/session + 27 online
  client tests), in 316 seconds. The log records **5,000 online and 5,000
  local session histories**, seeds 1–5,000. The independent affected model
  run also passed all 52 tests at these counts.
- Fixture wrappers: **9 passed**. Cargo build, wasm build/budget, documentation
  budget, release guard, package typecheck/build, chat compilation and chat/Expo
  typechecks passed. Focused SDK selection: 100 passed; expanded peer file:
  20 passed. Source line limits, diff whitespace and pure-append JOURNAL checks
  pass. Final reference audit: **529 LLP documents / 10,455 references**, zero
  errors or unchecked references.

Wasm remains **2,117,335 raw / 639,888 gzip bytes**, under the unchanged
**639,941-byte** budget. SHA-256 remains
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.
No device growth, schema capability changes or server production changes.

The complete log is `evidence/round3-full-suite.log.gz`; focused, model,
wasm, reference and rerun evidence use the same `round3-` prefix. The initial
preflight run stopped to correct the witness helper is retained separately.
The complete run used Node 24.13.1/Bun 1.3.14, `CARGO_INCREMENTAL=0`, shared
`CARGO_TARGET_DIR=~/sb5-lanes/target`, dev/test debug info disabled and eight
Cargo jobs. It supplied both this checkout's witness helper and the prior
published 0.4.13 binary. Existing PostgreSQL/platform runtime limits remain;
no new adapter runtime claim is made.

Checkpoints: `63d6cf1400` (implementation and permanent regressions),
`8c7b6da3ff` (affected full-count models), `5cd481643e` (native witness
recurrence/reruns), `61e5655f07` (existing test expectation and await census).
Every Round 3 commit carries the requested Astra co-author trailer. The code
remained unchanged throughout complete-suite execution and the final reruns.
No push or publication.

Final Round 3 head: `f0e047dd766f1ced9cccafd7a055208c5522091a`. Working tree clean; no push.

## Round 4

The lead's principal-wide logout ruling supersedes Round 3's epoch exception.
Implemented the three reproduced medium findings and the ruling in the shared
custody machine. Pending full-count suite and wasm verification are not yet
claimed as complete.

Orientation (`llp-orient`): scope is the HTTP identity guard and online/app
session custody. Governing constraints are LLP 3000.033 §§1.2, 1.4 and 3,
LLP 3000.013 §6 (shared app custody), and LLP 3000 §7 (full-session compatibility
and wasm budget). The lead's explicit ruling overrides Round 3's epoch-owned
logout text; public documentation is updated in the implementation commit.
No new design document or hand-off is needed.

- One bearer parser handles scheme capitalization and HTTP whitespace in
  principal resolution, auth operations and detached poll rechecks. Read tokens
  and malformed credentials enter the closed guard; public/dev write doors
  authenticate every supplied credential. Full authenticated handlers retain
  existing pre-auth validation and ephemeral failure envelopes.
- Raw sign-out retains the unverified refresh successor and gives it to the
  independent scope/principal/store-verifying retirement helper. Held and
  retryable failed verification both have permanent server tests.
- Read rotations reserve ownership with a separate cross-tab rotation lock.
  Selection and commit take the custody lock; network work holds neither that
  lock nor the persistence queue. Epoch/principal/predecessor are checked again
  before saving. Own and peer logout complete while the response is held; late
  successors are retired and restart stays signed out.
- Explicit logout owns all same-principal credentials, regardless of epoch.
  Newer same-user logins are retired; another principal is protected. A stale
  Bob facade also records a sign-out watermark while Alice is stored, so a Bob
  login already in flight cannot replace Alice. Alice's rotation carries the
  watermark forward; a new deliberate Bob login after logout remains allowed.
- Restored the full-session logout-retry test's both-credentials-retired
  expectation using two password logins of the same user. Its former two guest
  logins were different principals and would contradict the new protection.

Initial verification: 57 custody tests passed; the additional two tests for
Bob's in-flight return while Alice is stored passed. App and delivery matrix:
417 passed before the watermark addition (the final full run will recheck it).
HTTP unit selection: 150 passed, three existing ignores. The initial broader
HTTP guard changed two full-session refusals; the final guard preserves those
handlers' ordering, and both entire targets passed on the final HTTP rerun.
Build and typecheck pass. Reference audit passes (529 docs, 10,457 references).
Grok's round-4 `.exit` is not present yet; its completed review remains pending.

### Round 4 Grok disposition and preflight

Grok's `ro-c3.grok.exit` now records `EXIT=0`; read its complete review. It is
READY WITH CHANGES with one low documentation finding at the public logout
promise. Addressed in the public promise, guide and RFC §1.4. Its proposed
principal-and-epoch wording is superseded by the lead's explicit principal-wide
ruling, so newer same-user logins now retire instead of being preserved. Its
held-refresh race released the response before awaiting logout; the permanent
Astra reproduction additionally requires logout/tombstone completion while the
response is still held. Both own and peer variants pass. No additional product
finding was reported by Grok. Its mutation notes rely on violating the checked
`ro.` mint invariant or overlap the existing atomic-narrowing barriers; no new
adapter-runtime qualification is claimed.

The complete suite is running from checkpoint `33c1f9ce28`. Its preflight passed
cargo build, wasm build/budget, docs budget, release guard, package typecheck and
build, chat compilation, both app typechecks and fixture wrappers. Wasm is
**2,117,335 raw / 639,888 gzip bytes**, below **639,941 bytes**, with unchanged
SHA-256 `2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.
The complete Rust inventory is still compiling; no complete-suite result yet.
All ten changed source/test files are below 1,500 lines, JOURNAL is a pure append,
and diff whitespace checks pass.
