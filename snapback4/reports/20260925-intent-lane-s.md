# Lane S: infallible effect-payload reads (LLP 3000.013 §12.3)

The Clique send shape predicts without hoisting its profile lookup. A compiler
slice proves which reads and local bindings feed only total effect payloads;
the device omits those statements while the server executes the original
authorized, metered program. `why` reports their source sites as
`server-only, feeds an effect; ... charged on the server only`.

Base: `e3451183e`, branch `sb4-intent/s-effect-reads`. Implementation commit:
`98166b335`; device witnesses: `af6428e6b`. This qualification record follows separately.
No push, publication or version bump. No design/authorization stop was needed.

**Files** (paths below are relative to `snapback4/`, except the LLP):

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/schema.rs` | Backward-compatible optional `Execution.prediction_skips` and explanatory `effect_payload_reads`. |
| `crates/snapback4-core/src/engine/runner.rs` | Install skips only for eligible device mutations and omit their evaluation and charges. |
| `crates/snapback4-core/src/engine/prediction.rs` | Shared totality walk respects the same skips when charging untaken presence arms. |
| `crates/snapback4-lang/src/bind/program.rs` | Supply schema to the effect/presence proof. |
| `crates/snapback4-lang/src/bind/residency.rs` | Exclude certified effect reads from coverage requirements; preserve source/index explanations in `why`. |
| `crates/snapback4-lang/src/bind/residency/presence.rs` | Analyze a statement-path-preserving prediction copy while retaining the original program's presence fact. |
| `crates/snapback4-lang/src/bind/residency/effect_reads.rs` | New dependency slice, total-expression proof, compiler-owned coalescing recognition and statement selection. |
| `crates/snapback4-lang/src/bind/residency/effect_reads/walk.rs` | Complete operand walk, including opaque expressions, domains and mutation targets. |
| `crates/snapback4-lang/src/guide/prediction.rs` | Compiled Clique example, server-only charges, shared/fallible boundaries. |
| `crates/snapback4-lang/src/guide/language.rs` | Existing `sendBrief` now carries an online-only profile field in its effect. |
| `crates/snapback4-lang/src/guide/presence.rs` | Reconcile effect-payload reads with presence eligibility. |
| `crates/snapback4-lang/src/guide/effects.rs` | State that payload reads and their charges run on the server. |
| `crates/snapback4-lang/tests/effect_reads.rs` | Seven focused compiler/engine regressions, detailed below. |
| `crates/snapback4-lang/tests/presence.rs` | Former payload-only refusals become eligible; shared condition reads stay refused. |
| `crates/snapback4-lang/tests/builder_guidance.rs` | Eligible payload explanation plus source-located shared-read refusal. |
| `crates/snapback4-lang/tests/residency_notes.rs` | Replace obsolete effect-only rejection with source-located server-only explanation; retain fallible refusal. |
| `crates/snapback4-device/tests/presence/mod.rs` | Register the new device witness module. |
| `crates/snapback4-device/tests/presence/effect_reads.rs` | Offline/reopen/settlement matrix on both stores, authorization and meter rollback. |
| `crates/snapback4-device/tests/readauth/census.txt` | Only the new guide send and shifted subsequent block number; no unrelated baseline changes. |
| `metrics/wasm-budget.json` | Measured byte-ratchet increase with rationale; runtime ceilings unchanged. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Living §12.3 implementation record and infallibility boundary. |
| `JOURNAL.md` | One dated append with qualification, measurements and exclusions. |
| `reports/20260925-intent-lane-s.md` | This handoff and complete failure ledger. |

**Forms.** No new grammar or refusal code. All examples below are fragments of
compiled test programs with declared profiles, members, messages and effects.

Presence-guarded Clique send, including a local binding, now predicts and runs
offline without the device acquiring any profiles:

```quarry
for p in members where .chat = chat:
  if p.principal != viewer:
    if not exists connected[p.principal]:
      senderDisplayName = profiles[principal = viewer].displayName ?? 'Someone'
      emit notify { targetUserId: p.principal, chatId: chat, senderDisplayName, preview: slice(body, 0, 80) }
```

Unguarded direct read: `emit notify { name: profiles[principal = viewer].displayName }`.
Alias chain: `name = profiles[principal = viewer].displayName`, then
`alias = name`, then `emit notify { alias }`.
Existence: `emit notify { exists: exists profiles[principal = viewer] }`.
Text: after nullable coalescing into `alias`, `emit notify { text: 'From ' + lower(alias) }`.
Proved arithmetic: `n = profiles[principal = viewer].n ?? 0`, then
`emit notify { ratio: n / 2, label: 3 * 7 }`.
Nested fallback: `name = profiles[principal = viewer].displayName ?? profiles[principal = p].displayName ?? 'Someone'`, then `emit notify { name }`.
Existing effect key: `emit notify { name: profiles[principal = viewer].displayName } once [p]`.

The actual calibration #19 four-file backend also compiled after inlining its
previously hoisted sender profile read inside the guarded emit. `why chat.send`
reports eligible with its pre-existing quote horizon qualification, and names
the profile read at `chat.q:188:83` as server-only. Evidence:
`~/sb4-intent/lane-s-clique-why.log`. The common #18 target contains no chat/send
mutation; the lane-specific #19 send and guide fixture are the exercised forms.

**Tests added and what they prove.**

| Test | Evidence |
| --- | --- |
| `infallible_effect_payload_reads_are_server_only_with_source_sites` | Direct/guarded reads, aliases, nullable/text/arithmetic/exists expressions, loops and once keys are eligible and explained at authored sites. |
| `shared_reads_and_fallible_payload_work_still_cost_prediction` | Conditions, writes, requires, returns, loop domains and unused binding consumers keep reads live; unwrap, unproved division, overflow and loop/early-exit sharing remain conservative. |
| `query_and_non_effect_point_reads_keep_their_residency` | Ordinary reads and online-only query behavior do not change. |
| `effect_presence_survives_the_slice_without_binder_source_metadata` | Raw IR inference retains `connected_effects_only`, skips and explanations even when a payload contains the only presence expression. |
| `nested_coalescing_keeps_all_fallback_work_in_the_effect_slice` | Both fallback reads can be omitted; a returned shared value keeps both live. |
| `clique_send_in_prediction_card_is_eligible_without_hoisting` | The complete documented send compiles without diagnostics or notes. |
| `expiring_sum_point_reads_are_fallible_even_in_a_payload` | A point read over an expiring maintained sum can refuse; the compiler does not hide that refusal. |
| `effect_payload_send_predicts_offline_and_agrees_at_every_presence_state` | 24 worlds: memory/SQLite × held/graced/absent × present/missing profile × simple/nested fallback. Device has no profiles, predicts and durably queues the message, survives reopen, matches server rows/result, settles and clears pending. Server emits two correct names/fallbacks with deadlines 16,000/36,000/none. |
| `effect_payload_reads_keep_server_authorization_and_meter_rollback` | Hidden and absent profiles both produce `Someone`; exactly two extra server examinations versus literal payloads; examined, steps and heap exhaustion atomically roll back the message and effects. |

Focused final language run: 4 builder-guidance, 7 effect-read, 80 guide, 9
presence and 40 residency tests pass. Device witnesses: 2 pass. Existing device
presence scope: 19 pass, 1 pre-existing ignored test. Census: 1 pass.
Reference audit: 507 LLP documents, 9,271 references, 0 errors, 0 unchecked.

**Measurements.** One message and two recipients, ordinary nullable fallback:

| Profile | Examined | Index entries | Rule probes | Steps | Heap bytes | Output bytes | Rows written |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Present | 7 | 3 | 3 | 90 | 9,377 | 110 | 1 |
| Missing | 7 | 3 | 3 | 94 | 8,913 | 110 | 1 |

All three presence states produce those same charges in this fixture. Nested
fallback with a missing profile examines 9 rows, takes 116 steps and charges
11,734 heap bytes; with the profile present it examines 7 rows, takes 90 steps
and charges 10,938 heap bytes. Server read authorization is unchanged.

Wasm: **1,767,624 raw / 492,341 gzip bytes**, Rust 1.97.0,
wasm-bindgen 0.2.127, no wasm-opt. Against the preceding *recorded* integration
artifact (1,765,796 / 491,640), the whole-artifact delta is +1,828 / +701.
This is not a fresh control or independent component attribution. Metadata and
the skip-aware totality walk exceed 492,000 by 341 bytes; the ratchet is 493,000,
with 659 bytes headroom. `AGENTS.md` explicitly permits the measured increase.
No examined, steps, heap, output, rule-probe or write ceiling changed.

**Engineering choices, deviations and proof limits.**

The slice joins all definitions of an alpha-renamed local, including loop back
edges and early exits. This is deliberately conservative rather than a general
SSA optimization. It handles the required direct read/alias/coalescing cases;
reusing an effect local later for an unrelated observable value can still cost
prediction. Reproduction with online-only profiles:

```quarry
mutation probe():
  name = profiles[principal = viewer].displayName
  emit notify { name }
  name = 'constant'
  return name
```

Observed: `why probe` says `predicts: never`, although a value-sensitive proof
could erase the first definition. This precision limitation remains open; use a
separate local for the later value. Evidence:
`~/sb4-intent/lane-s-proof-boundary.log`. No unsafe eligibility is granted.

Arithmetic proof accepts constant safe integer calculations and division by a
provably nonzero constant expression; it does not infer general interval or
branch proofs. Example: `require divisor != 0 else ZERO` followed by an effect
payload `value / divisor` retains ordinary prediction requirements. `!`,
`require`, new IDs and potentially overflowing arithmetic are never erased.

Point reads of live sums over expiring sources are explicitly fallible: seed
contributions `MAX` (expires 100), `-MAX` (expires 1), `MAX` (expires 100), then
read the total at time 2. The physical sum is MAX but the live sum is 2×MAX;
the server returns `E_OVERFLOW`. The regression retains `predicts: never`.
This follows the brief's infallibility requirement rather than weakening it.

There is no parser spelling change, new diagnostic code, provider integration,
complete calibration rerun, package publication, or iOS simulator work. The
wasm budget increase and conservative proof boundaries are the departures from
a literal unrestricted reading of “never costs prediction.”

**Complete suite and failure ledger.**

Final command from `snapback4/`:
`CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=4 TMPDIR=/dev/shm/sb4-intent-lane-s-tests scripts/test.sh`.
The existing worker controls reduce shared-host contention without skipping
tests or raising timeouts. Private test temporary files use tmpfs; production
SQLite durability settings are unchanged. Incremental compilation is disabled
after this lane's own 18 GB incremental cache was removed to recover disk space.
Other lanes' files were not removed.

Final result: **`== 0 failure(s) in 702 s`**, exit 0. Every Rust target and doctest passed.
Main client process: 1,478 tests, 1,468 passes, 10 existing skips, zero failures;
all separate shards passed. The receipt test passed in 5.6 seconds and the
native 256-ID transport test in 12.4 seconds. No final failures or baseline waivers.
Log: `~/sb4-intent/lane-s-test-qualification.log`.

The supplied older baseline log ends `== 1 failure(s) in 276 s` (cargo test):
`genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`,
`uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`,
`census::authoring_census`, and
`w9b_why_operation_keeps_residency_and_cost_output`.
These are baseline observations, not waived failures for this lane. The census
delta made here is specifically the new guide block, not the older baseline
defect. No unrelated baseline repair is included.

First full attempt: **`== 3 failure(s) in 353 s`**
(`~/sb4-intent/lane-s-test.log`). Every failed stage/test:

- Ours, wasm build: initial 492,464 gzip bytes exceeded 492,000. Shared totality
  code reduced this to 492,341 and the documented ratchet admits it.
- Ours, cargo test, `census::authoring_census`: new guide block changed the
  census; only that expected delta was updated.
- Ours, cargo test,
  `calibration_presence_refusal_names_source_read_without_internal_paths`:
  obsolete expectation that an effect-only read refused. Replaced with the
  new explanation assertion and a still-fallible negative case.
- Environmental, client tests,
  `native: maximum pending ids (256), cursor batches and every terminal acknowledgement`:
  30-second replay wait timed out under parallel host load. The isolated six
  boundary tests passed unchanged (`lane-s-transport.log`, 31,832 ms total).

Second full attempt: **`== 2 failure(s) in 261 s`**
(`~/sb4-intent/lane-s-test-final.log`). Both stages were environmental:

- Cargo test: shared filesystem full (`ENOSPC`) while compiling
  `snapback4-device` targets `prediction_write_set` and `spread_metadata`.
- Client tests: disk-full failures in temporary files and SQLite, cascading
  fixture/seed/recovery assertions, plus the native 256-ID timeout above.
  The 74 distinct failed names (including failed parent subtest groups) are
  listed individually below. The timeout is a timing failure; the other
  failures followed explicit disk-full errors in their shared fixture path.

Third attempt used the existing serial-client switch. **Interrupted, exit 143;
no final summary was emitted.** Every Rust target and doctest passed
(`-- ok: cargo test (289 s)`), but the client test
`W5R1x process: durable receipts evict beyond 256 without growing metadata`
hit its 60-second timeout while the host's one-minute load was about 93/96 CPUs.
This was the only failure observed before interruption; the same test passed in
the first two runs. Classified environmental contention. Logs were preserved
as `lane-s-test-serial-partial.log` and `lane-s-serial-*.log` before stopping
the remaining serial client work and restarting with capped Rust workers and a
private tmpfs temporary directory. This attempt is not counted as a full pass.

An intermediate focused device run also had one **ours** failure in
`effect_payload_reads_keep_server_authorization_and_meter_rollback`: the new
literal-control fixture left an unsupported constant assignment under presence.
The control now inlines the literal emit. The final focused run passes both
tests, including the exact two-examination comparison.

Second-attempt client failures:

- Environmental: `W13b native meter incomplete read stays local online`.
- Environmental: `W13b native horizon and presence use server knowledge only online`.
- Environmental: `W13b web cursorless incomplete read stays local online`.
- Environmental: `W13b web meter incomplete read stays local online`.
- Environmental: `W13b web horizon and presence use server knowledge only online`.
- Environmental: `W13b dev logs a measured cut`.
- Environmental: `W13b serve hides a measured cut`.
- Environmental: `wasm review renewal cold horizon=false split=false`.
- Environmental: `wasm review renewal cold horizon=false split=true`.
- Environmental: `wasm review renewal cold horizon=true split=false`.
- Environmental: `wasm review renewal cold horizon=true split=true`.
- Environmental: `wasm review renewal gap horizon=false split=false`.
- Environmental: `wasm review renewal gap horizon=false split=true`.
- Environmental: `wasm review renewal gap horizon=true split=false`.
- Environmental: `wasm review renewal gap horizon=true split=true`.
- Environmental: `wasm review renewal revoke horizon=false split=false`.
- Environmental: `wasm review renewal revoke horizon=false split=true`.
- Environmental: `wasm review renewal revoke horizon=true split=false`.
- Environmental: `wasm review renewal revoke horizon=true split=true`.
- Environmental: `wasm review renewal unlimited horizon=true split=true`.
- Environmental: `wasm review same-commit renew horizon=false split=false retained=false`.
- Environmental: `wasm review same-commit renew horizon=false split=false retained=true`.
- Environmental: `wasm review same-commit renew horizon=false split=true retained=false`.
- Environmental: `wasm review same-commit renew horizon=false split=true retained=true`.
- Environmental: `wasm review same-commit renew horizon=true split=false retained=false`.
- Environmental: `wasm review same-commit renew horizon=true split=false retained=true`.
- Environmental: `wasm review same-commit renew horizon=true split=true retained=false`.
- Environmental: `wasm review same-commit renew horizon=true split=true retained=true`.
- Environmental: `wasm review same-commit rejoin horizon=false split=false retained=false`.
- Environmental: `wasm review same-commit rejoin horizon=false split=false retained=true`.
- Environmental: `wasm review same-commit rejoin horizon=false split=true retained=false`.
- Environmental: `wasm review same-commit rejoin horizon=false split=true retained=true`.
- Environmental: `wasm review same-commit rejoin horizon=true split=false retained=false`.
- Environmental: `wasm review same-commit rejoin horizon=true split=false retained=true`.
- Environmental: `wasm review same-commit rejoin horizon=true split=true retained=false`.
- Environmental: `wasm review same-commit rejoin horizon=true split=true retained=true`.
- Environmental: `wasm review same-commit twice horizon=false split=false retained=false`.
- Environmental: `wasm review same-commit twice horizon=false split=false retained=true`.
- Environmental: `wasm review same-commit twice horizon=false split=true retained=false`.
- Environmental: `wasm review same-commit twice horizon=false split=true retained=true`.
- Environmental: `wasm review same-commit twice horizon=true split=false retained=false`.
- Environmental: `wasm review same-commit twice horizon=true split=false retained=true`.
- Environmental: `wasm review same-commit twice horizon=true split=true retained=false`.
- Environmental: `wasm review same-commit twice horizon=true split=true retained=true`.
- Environmental: `wasm review same-commit later horizon=false split=false retained=false`.
- Environmental: `wasm review same-commit later horizon=false split=false retained=true`.
- Environmental: `wasm review same-commit later horizon=false split=true retained=false`.
- Environmental: `wasm review same-commit later horizon=false split=true retained=true`.
- Environmental: `wasm review same-commit later horizon=true split=false retained=false`.
- Environmental: `wasm review same-commit later horizon=true split=false retained=true`.
- Environmental: `wasm review same-commit later horizon=true split=true retained=false`.
- Environmental: `wasm review same-commit later horizon=true split=true retained=true`.
- Environmental: `wasm review mixed-readable generated pages snapshot=false`.
- Environmental: `wasm review mixed-readable generated pages snapshot=true`.
- Environmental: `wasm review duplicate below the floor retained=false staged=false`.
- Environmental: `wasm review duplicate below the floor retained=false staged=true`.
- Environmental: `wasm review duplicate below the floor retained=true staged=false`.
- Environmental: `wasm review duplicate below the floor retained=true staged=true`.
- Environmental: `process a wedged device discovers generation before shrinking the oversized page`.
- Environmental: `oversized sync identity, indivisible-commit snapshot recovery, and wedged generation adoption`.
- Environmental: `process replaces the old store before shrinking`.
- Environmental: `an oversized reply from a replacement store is observed before shrinking even at the same generation`.
- Environmental: `wasm a new replica recovers its oversized first commit`.
- Environmental: `process a new replica recovers its oversized first commit`.
- Environmental: `wasm an oversized first commit arriving during zero-head snapshot catch-up restarts inline`.
- Environmental: `process an oversized first commit arriving during zero-head snapshot catch-up restarts inline`.
- Environmental: `wasm interrupted inline recovery retries after reopen, preserves delivered history and enforces the horizon`.
- Environmental: `process interrupted inline recovery retries after reopen, preserves delivered history and enforces the horizon`.
- Environmental: `wasm: many ordinary commits recover by halving without snapshot`.
- Environmental: `process: many ordinary commits recover by halving without snapshot`.
- Environmental: `process a snapshot continuation overflow keeps its cursor and terminates at limit one`.
- Environmental: `process bare refusals retain held rows beyond the horizon and allow a later sync retry`.
- Environmental: `oversized historical timeline commit recovers by snapshot with pending writes on both hosts`.
- Environmental: `native: maximum pending ids (256), cursor batches and every terminal acknowledgement`.
