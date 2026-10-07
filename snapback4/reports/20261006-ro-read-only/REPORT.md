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

The complete Rust run found one introduced compatibility regression in
`token_live::public_listeners_refuse_remote_peers_and_missing_wrong_duplicate_or_browser_proofs`:
the early guard returned 401 instead of the private-proof door's uniform 403.
The guard now delegates its rejection to the existing `/dev/token` denial
response, preserving the indistinguishable refusal without entering minting.
The **entire 20-test token_live target passed** after rebuilding the CLI.
This small server-only correction happened during the full run; the original
failure remains in the full-suite evidence. The JavaScript implementation and
full-count configuration are unchanged, and subsequent client tests use the
corrected CLI. All other completed Rust executions passed, including the
326-test CLI unit target (four existing ignores).

The full client pool also found one obsolete Round 3 assertion in
`read-only-custody.test.mjs`: after 32 rotations it still expected a newer epoch
of Bob's credential to survive explicit logout. Updated it to require the
tombstone and retirement of both the current rotation and the peer credential.
The entire file passes **4/4**, with no production change. The original failure
remains in the full-run log. The new 17-test Round 4 file, the 20-test peer file,
and full-session app file all pass in the complete run.

### Final Round 4 verification

The complete `bash scripts/test.sh` finished at full default counts in
**1,956 seconds (32m36s)**. It exited 1 with **two failed phases / two failed
subtests**, both corrected with passing complete target/file reruns. This is
**not a single-green-run qualification receipt**; the original failures remain
in the committed evidence.

- Rust: **300 test binaries / 1,013 executions plus workspace doctests**,
  970 seconds. The sole failure was `/dev/token`'s uniform-refusal regression.
  Its corrected complete target passed **20/20**. Every other Rust target and
  the doctests passed, including the 326-test CLI unit target with its four
  existing ignores. No recurrence of Round 3's native process-inspection failures.
- Client pool: **330/330 files**, **6,544 passed / 1 failed / 47 labelled skips**,
  619 seconds. The sole failure was the superseded 32-rotation same-user epoch
  assertion. Its corrected entire file passed **4/4**. All new **17 Round 4
  reproductions/variations/controls**, the peer rotation file, app file and
  delivery fault matrix passed in this complete run. Round 3's export-background
  timeout did not recur; that unchanged file passed.
- Full-count models: **79/79**, no skips, 302 seconds. The log confirms
  **5,000 online and 5,000 local session histories**, seeds 1–5,000, plus
  **3,000 online-client sequences**, seeds 1–3,000. No count overrides/reductions.
- Fixture wrappers: **9/9**. Cargo build, wasm build/budget, docs budget, release
  guard, package typecheck/build, chat compilation and chat/Expo typechecks passed.
- Final source audit: all **12 changed source/test files** are below 1,500 lines;
  JOURNAL is a pure append and diff whitespace checks pass. The reference audit
  passes with **529 LLP documents / 10,458 references**, zero errors or unchecked
  references. I11 now explicitly names `logoutEverywhere()` so its existing global
  epoch rule cannot be confused with ordinary logout's principal-wide rule.

Wasm is **2,117,335 raw / 639,888 gzip bytes**, under the unchanged
**639,941-byte** budget, with **53 bytes** of headroom. SHA-256 remains
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.
The server-only uniform-refusal correction changes no device code.

Evidence: `evidence/round4-full-suite.log.gz` retains the complete run;
`round4-token-live.log.gz` and `round4-custody-rerun.log.gz` retain both complete
corrected target/file reruns. Other affected, HTTP, build and reference records
use the same `round4-` prefix. The full run used Node 24.13.1, Bun 1.3.14,
Rust 1.97.0, `CARGO_INCREMENTAL=0`, shared `CARGO_TARGET_DIR=~/sb5-lanes/target`,
dev/test debug info disabled and eight Cargo jobs. It supplied this checkout's
witness helper and the verified prior published 0.4.13 binary. Existing
PostgreSQL/platform runtime qualification limits are unchanged.

Checkpoints: `33c1f9ce28` (implementation and permanent regressions),
`884568857f` (review dispositions and affected evidence), `48ad735824`
(private-proof refusal compatibility), `5deead52b1` (remaining Round 3 test
expectation). All commits carry the requested Astra co-author trailer.
Both reviews have been folded; no open Round 4 finding remains. No push or
publication.


## Round 5 — remaining peer-refresh and watermark findings (2026-10-07)

Checkpoint `16fa765c09` fixes both Astra findings and adds the requested
surviving-mutation test. It carries the requested Astra co-author trailer.
No push or publication.

- Before a read-only peer treats a rejected predecessor as terminal, it waits
  for the rotation owner outside the session lock/persistence queue, rechecks
  epoch and principal, and recovers the successor through exact-credential
  verification and persistence. Both the original held-response reproduction
  and a read-dispatched-before-refresh variation pass, with a third app and
  restart checks. Logout from the waiting peer or a third app completes while
  refresh remains held; the late successor is retired. The older late-rejection
  case now requires read-peer recovery, keeping the full-session control intact.
- Epoch advances discard obsolete `snapback4SignOuts`; same-epoch rotations
  retain them. The permanent test performs 24 account switches in each mode,
  asserting zero inherited entries after replacement, exactly one after stale
  logout, retention across rotation, and zero after logout/login.
- A load-time constructor/factory counter detects even unused `WriteHistory`,
  `MutationIds`, `OnlineIntentPresentation`, `DeliveryQueue`, `ephemeralLane`
  and `onlineCustody` allocations. It exercises anonymous startup, signup,
  query, rotation, restoration, logout and close, then proves every instrumented
  entry point is reached by the full-session positive control.
- Negative controls run against private copies of the built package: all six
  Round 5 race/boundedness cases fail against original head `3716f8cfa9`, and
  deliberately constructing an unused `WriteHistory` fails the allocation test.
  The active build was untouched. The first negative-control wrapper expected
  TAP from Node's default reporter; rerunning with explicit TAP confirmed the
  six intended assertion failures and the allocation failure.
- The four new await boundaries are auth/read recovery only; the existing
  delivery fault sites and recipes are unchanged. LLP 3000.033 §1.4 and the
  append-only JOURNAL record the behavior and tests.

Grok's `reviews/ro-c4.grok.exit` is present (`EXIT=0`). Its 543-byte markdown
contains only progress notes, no findings or verdict. It was read; there are no
findings to fold and no completed Grok round-5 review is claimed.

Affected verification passed **525/525 tests across 12 files**, no skips:
all read-only suites (including the real published 0.4.13 downgrade case), app,
online-session and the complete delivery fault matrix. Package build/typecheck
and reference checks pass (**529 LLP documents / 10,461 references**, zero
errors or unchecked references). The initial new-test run exposed missing
legacy epoch defaults in the fixture assertions; the assertions now use the
existing implicit epoch `0`, and all permanent cases pass.

The complete `bash scripts/test.sh` is running at full default counts from the
checkpoint. Its wasm rebuild is **2,117,335 raw / 639,888 gzip bytes**, under the
unchanged **639,941-byte** budget (53 bytes headroom). Final complete-suite
results will be appended below. Evidence uses the `round5-` prefix.


### Final Round 5 verification

The complete `bash scripts/test.sh` finished at full default counts in
**2,037 seconds (33m57s)**. It exited 1 with **one failed phase / one failed
subtest**, in unchanged native witness process inspection. This is **not a
single-green-run qualification receipt**. The full failure is retained; the
complete unchanged CLI target rerun passed.

- Rust: **300 test binaries / 1,013 executions plus workspace doctests**,
  1,015 seconds. The only failure was
  `verbs::witness::preparation::cleanup_tests::direct_enumeration_resizes_and_keeps_births_in_the_selected_group`,
  at `preparation.rs:224:26`, reporting
  `E_WITNESS_PROCESS: invalid /proc process group`. That target had 325 passes,
  one failure and four existing ignores. Its complete unchanged rerun passed
  **326 tests, four existing ignores**, using the runner's one test thread.
  All other Rust executions and workspace doctests passed. The existing
  [native process-inspection ticket](../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md)
  records this recurrence; no rejected stat snapshot or separate baseline run
  establishes the cause, and no ownership check was changed.
- Client pool: **332/332 files**, **6,552 passed / zero failed / 47 labelled
  skips**, 623 seconds. All read-only files, the new allocation and Round 5
  files, the updated late-rejection control, app tests, and the complete delivery
  fault matrix passed. The published downgrade case executed with the verified
  prior binary. The worker/background-export and browser files passed too.
- Full-count models: **79/79**, no skips, 318 seconds. The log confirms
  **5,000 online and 5,000 local session histories**, seeds 1–5,000, and
  **3,000 online-client sequences**, seeds 1–3,000. No count overrides/reductions.
- Fixture wrappers: **9/9**. Build, docs budget, release guard, package
  typecheck/build, chat compilation and chat/Expo typechecks passed.
- Final audits: all **five changed source/test files** are below 1,500 lines;
  JOURNAL is a pure append; diff whitespace passes. Reference checks pass with
  **529 LLP documents / 10,461 references**, zero errors or unchecked references.

Wasm rebuilt at **2,117,335 raw / 639,888 gzip bytes**, under the unchanged
**639,941-byte** limit, with **53 bytes** headroom. Its unchanged SHA-256 is
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.

Evidence: `evidence/round5-full-suite.log.gz` retains the complete run;
`round5-cli-rerun.log.gz` retains the whole passing CLI rerun. The affected,
regression, mutation-control, build/typecheck, reference and source audits use
the same `round5-` prefix. The run used Node 24.13.1, Bun 1.3.14, Rust 1.97.0,
`CARGO_INCREMENTAL=0`, shared `CARGO_TARGET_DIR=~/sb5-lanes/target`, dev/test
debug info disabled and eight Cargo jobs. It supplied this checkout's witness
helper and the verified published 0.4.13 binary. The ordinary full runner used
24 Rust processes and 24 client slots on 96 available CPUs; models ran in their
separate serial slot. Existing PostgreSQL/platform qualification limits remain.

Checkpoints: `16fa765c09` (fixes and permanent regressions), `b2f11c37e9`
(review dispositions and affected evidence), `ddf36e0df7` (existing witness
recurrence and passing complete-target rerun). All carry the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer. Grok's exit marker
and output were checked again before finishing: still only progress notes,
with no findings or verdict. Both Astra findings and its allocation-test note
are addressed. No push or publication.


## Round 6 — SDK read sessions never rotate

Implemented the lead's revision 4 simplification on top of `ce5793386d` and
committed the implementation as `3c8b06f2e8`. The SDK never refreshes read
sessions, automatically or explicitly. `refreshSession()` refuses locally with
`E_READ_ONLY_REFRESH` and directs the caller to sign in or narrow again. Read
clients retain their bearer until `expiresAt`, then surface `E_AUTH`; cap hints
never schedule renewal. The standalone auth helper also refuses `ro.` tokens.
The read app facade refuses without waiting for a held storage transaction.

Deleted the private successor receipt, rotation lock, waiting-peer recovery,
successor verification and retirement custody, and cap-aware scheduling. Full
sessions retain the branch's rotation/retirement behavior and principal-wide
logout ruling, with different-principal protection. Raw HTTP read refresh and
its server tests remain intact. Added positive `Read` assertions through all
four live resolvers, including `resolve_read_only`. Updated RFC §1.3/§1.4 with
the revision 4 rationale, the read-only guide, both client cards, and appended
the JOURNAL.

**Net removal versus `ce5793386d`: 133 SDK source lines (35 added, 168 removed).**
The implementation, tests and living docs together remove **234 net lines**
(383 added, 617 removed), excluding append-only JOURNAL/report/evidence additions.
Pinned Vite/oxc measurement confirms smaller bundles: online **43,681 → 43,408
gzip bytes** (273 removed), app **98,308 → 97,513** (795 removed). Raw bundled
bytes fall by 1,093 and 3,803 respectively. The size artifact includes baseline
and current revisions; its retained script substitutes the six baseline source
files at Vite load time, keeping the toolchain and all other inputs identical.

Converted read-refresh races to stable-token/no-refresh assertions across
simultaneous peers, held read dispatch/responses, held restoration probes and
storage, retryable probe failures, close, logout and restart. The two Round 6
liveness interleavings cannot consume a predecessor. A waiting reader can close
and restart while other peers attempt refresh. Kept every full-session race
control and the logout, custody-isolation, probe/asset/device and allocation
checks. The initial focused run found stale refresh expectations; it also
exposed the app facade's storage wait before local refusal. Those were corrected;
the original log is retained, including the interrupted waiting test.

Affected verification so far: **94/94** read tests with the published 0.4.13
downgrade control enabled; **5/5** core session tests; **26/26** raw SDK/probe/
expiry tests; **44/44** final peer/round-4/round-5 controls, including the two
additional waiting-reader restart cases. Typecheck/build and references pass.
The complete `bash scripts/test.sh` is running at full default counts; its
preflight already passed and wasm remains **2,117,335 raw / 639,888 gzip bytes**
against the unchanged **639,941** budget. Full-run results follow below.

Evidence is retained under `snapback4/reports/20261006-ro-read-only/evidence/`
with the `round6-` prefix. Commits carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. No push or publication.


### Final Round 6 verification

The complete `bash scripts/test.sh` finished at full default counts in
**2,093 seconds (34 minutes 53 seconds)**. It executed every phase; no histories,
cases or file counts were reduced. The original run exited 1 with two failing
phases, preserved in `evidence/round6-full-suite.log.gz`:

- Rust: **300 test binaries / 1,013 executions, plus workspace doctests**.
  Five diagnostic assertions failed across the guide, CLI check and CLI unit
  targets: the new code needed its default-card mapping and definition/action
  pins, and the client card exceeded its word budget. Those were fixed. The
  complete affected reruns passed **113 guide + 89 CLI check + 326 CLI unit**
  tests, with four existing CLI ignores. Every other Rust target passed.
- Clients: **332/332 files**, **6,553 passed / 1 failed / 47 labelled skips**.
  All **96 read-only tests** passed. The sole failure was the stale await-boundary
  census: read rotation removal deleted **25 awaits** and changed four entries.
  The classification audit found every delivery site and fault recipe unchanged.
  After updating those four entries, the complete matrix passed **339/339**.
- Models: **79/79 passed**, no skips: **5,000 online session histories, 5,000
  local session histories and 3,000 online-client sequences**, at full counts.
- Preflight build, wasm budget, docs budget, release guard, package typecheck/
  build, chat compilation, chat/Expo typechecks and all nine fixture wrappers
  passed. The SDK was rebuilt after the final padded-token refusal change and
  before the full client phase; its 26-test raw/probe/expiry file also passed.

This is **not a single-green-run qualification receipt**. All failures observed
in the complete run are corrected and their complete affected targets pass;
original and rerun evidence is retained. No inherited failure remained to ticket.

Final size versus `ce5793386d`: **133 net SDK source lines removed** (35 added,
168 removed). Across implementation, tests and living docs, **223 net lines
removed** (405 added, 628 removed), excluding append-only JOURNAL/report/evidence
additions. The final whitespace-aware auth-helper guard adds seven raw bundled
bytes relative to the first checkpoint. Final pinned-toolchain bundles are:

| Bundle | Before gzip | Final gzip | Removed | Raw bytes removed |
|---|---:|---:|---:|---:|
| Online | 43,681 | 43,411 | 270 | 1,086 |
| App | 98,308 | 97,520 | 788 | 3,796 |

Wasm stays **2,117,335 raw / 639,888 gzip bytes**, under the unchanged
**639,941-byte budget**. Final references pass (529 LLP docs, 10,458 references,
zero errors or unchecked references). Source limits, deleted-symbol audit,
unchanged server identity/auth paths, `git diff --check`, and JOURNAL pure-append
verification pass. Server read-refresh, cap, generation and no-sweep tests remain.
PostgreSQL/platform qualification limits from earlier rounds are unchanged.

The run used Node 24.13.1, the existing Bun/Rust toolchains,
`CARGO_INCREMENTAL=0`, the shared `CARGO_TARGET_DIR`, dev/test debug info disabled
and eight Cargo jobs. It supplied this checkout's witness helper and the
published 0.4.13 binary. The runner used its ordinary 24 Rust processes and
24 client-file slots on 96 available CPUs, then its serial model slot.

Checkpoints: `3c8b06f2e8` (implementation), `2f59bb7ea5` (waiting-reader restart
coverage and initial evidence), `9ab2d5036d` (padded read-token refusal),
`3d25b607cb` (complete diagnostic registration and passing reruns),
`ecb7fdfaa5` (await classification and passing delivery matrix). All carry the
requested `Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer.
**No push or publication.**
