READY

# Independent review: 78924a1e versus 9bee8119 (CLI journey selection r2)

Reviewer is not the author. Scope is the eight `product.patch` paths, surrounding candidate/baseline source, LLP 1002 §6–§7, and the frozen evidence pack. No peer or author reports were read. No network, SSH, agents, installs, builds, servers, publisher, benchmark, or product tests were run here.

Local read-only calculations (reported): SHA-256 of the eight changed files and `product.patch`; line counts; `testing.md` byte size.

## Verdict

No material contract failure was identified in the candidate source against LLP 1002 §7 as amended in this patch. 9bee actual CLI outcomes show the holes this change is meant to close. Snapshot 03 executed the eight selection controls against this source. Runtime qualification, Darwin publication, Muse ultra, a third review, and any global/outage claim are out of scope and are not established.

## Bindings

| Item | Value |
|---|---|
| Candidate | `78924a1e7286907d2378221902ec22747e7d188f` (`evidence/source-receipt.json`) |
| Baseline | `9bee8119d7c009ec4182797dfb54699917ab8231` |
| Patch SHA-256 | `d6286f5b796be780b3d09e8ed1ed988262e9e8484df2bc6b86d3488544c61ddd` (matches `source-facts.json`) |
| Leaves | 943; final correspondence `mismatches: []` |
| Packet file SHA-256 | Identical to `tested-source-03.json` / `source-delta-03.json` for all eight paths |

Eight paths: `llp/1002-dev-loop.spec.md`, `snapback2/crates/snapback2/src/{main,test,verbs}.rs`, `tests/guide.rs`, `tests/test_verb/selection.rs`, `packages/snapback2/guide/testing.md`, `packages/snapback2/src/test.ts`.

## Actual checks and limits (per-snapshot)

This is not `scripts/test.sh`, not a 44-case repeat, not native/compiler/offline integration, not publication.

**Snapshot 01** (`tested-source-01.json`, Hetzner x86_64, `NEXTEST_TEST_THREADS=2`, `CARGO_BUILD_JOBS=2`):

- `package-01` `node packages/snapback2/build.mjs` exit 0, 2.67s
- `build-01` `cargo build --offline --locked -p snapback2` exit 0, 40.7s
- `parser-01` `verbs::tests::` **2 passed** (literal values + help-detection)
- `affected-01` `--test guide --test test_verb --no-fail-fast`: **13 guide + 29 test_verb passed**, 111s test time / 124s wall
- Selection tests present and green in that 29: drift, swap, unsuccessful discovery, unsuccessful body exit, literal names. Also `named_journey_selection_*` (2), leaked-handle/timeout, and `help_is_successful_...` (includes new `--blocked`/`--project` help rows).
- `focused_identity_does_not_exhaust_argv_on_unselected_registrations` did **not** exist in this source (`selection.rs` `07ee0a97…`).

**Snapshot 02** (Rust-only `test.rs` `65bbb222…` → `a4975e27…`; `test.ts` still `0580a827…`):

- `exit-final`: `selection::a_passing_body_receipt_cannot_hide_an_unsuccessful_runner_exit` **ok**, 12.72s
- `grace-final`: `synchronous_loop_times_out_and_a_leaked_handle_cannot_hold_the_runner` **ok**, 9.20s
- `identity-size-before` (same snapshot 02 binary `rust64:18caa62d0b78db42`): focused `--journey=target` with 1+2000 registrations **failed** `Argument list too long (os error 7)`, exit 1, receipt check `target` fail. This is the retained original 2001-registration argv failure of the pre-digest protocol.

**Snapshot 03** (this packet / candidate; `test.ts` `9392c960…`, `test.rs` `90186464…`, `selection.rs` `12723970…`, LLP 1002 `5c027d2a…`):

- `package-aggregate` + `build-aggregate` exit 0
- `selection-aggregate` filter `selection`: **8 passed**, 34.86s:
  - `named_journey_selection_rejects_invalid_modes_and_preserves_compile_failures`
  - `named_journey_selection_is_exact_scoped_and_does_not_hide_full_suite_failures`
  - `selection::a_passing_body_receipt_cannot_hide_an_unsuccessful_runner_exit`
  - `selection::focused_identity_does_not_exhaust_argv_on_unselected_registrations`
  - `selection::focused_registration_drift_fails_before_any_body_runs`
  - `selection::same_name_distinct_body_swap_refuses_instead_of_running_one_body_twice`
  - `selection::literal_option_names_and_duplicate_bodies_keep_their_exact_receipts`
  - `selection::unsuccessful_discovery_cannot_admit_a_selected_body`

**Prior corrected fixture** (r1, source still 9bee, `selection.rs` `3bab2101…`): `focused_registration_drift_fails_before_any_body_runs` **ok**. Used only as raw fixture evidence that name/order drift already refused on the name-vector protocol.

**9bee original-before** (actual CLI, binary digest `rust64:c58a14dcfad513b6`):

- Same-name distinct-body swap: CLI **exit 0**, two `target` **pass** checks (fail body never ran). Raw runner for index 1 with `--expected-journeys '["target","target"]'` also **pass**.
- `process.exitCode = 1` after a passing body: CLI **exit 0**, receipt **pass**. Raw runner of the same built file **exit 1** with a pass line — host ignored the process status.
- `test --blocked -h`: **exit 1**, blocked receipt reason `"-h"`.
- `test --blocked --help`: **exit 2**, usage on stderr.
- `test --project -h`: **exit 2**, `E_OWNER_PROJECT_ROOT` for path `-h`.
- `test --project --help`: **exit 2**, `--project requires a value, not --help`.

**ff894 help dry-run** (historical published binary; not this candidate; not Darwin qualification of 78924a1e): `test --blocked|-h` and `test --project|-h` (and `--help`) **exit 0**, `usage: snapback2 test…`. That is the help behavior §7 now names “baseline.”

**Stated bounds** (`test-receipt.json` `originalBounds`): package 120s, cargo/parser 900s, affected 600s, cargo jobs 2, test threads 2, journey host 5s, completed-receipt grace 250ms, runner output 262144 bytes, existing assertion walls 12s and 60s.

**Artifact limitation:** snapshot 01 raw JS bundles are not in the pack. `build.mjs` is cwd-source-backed; JS byte-equivalence across rebuilds is not proven. Snapshot 03 `emittedBeforeRuntime` `test-runner.mjs` `7514137b…` differs from post-test `cleanup.json` / `identity-size-custody.json` `70fb2260…`. The eight controls bind to the before-runtime hashes plus 943 matching source leaves. Compiler worker hash `9c93d2adc…` was stable across snapshots.

## Assessment by contract area

### Focused registration / body identity (duplicate names, distinct bodies)

**Introduced** in `test.ts` `registrationIdentity` (lines 42–47) and the focused `--identify` / `--expected-journeys` digest path in `test.rs` 753–836. Baseline compared a JSON **name vector** only (`baseline/.../test.ts` 117–123; `baseline/.../test.rs` 802).

Identity is one SHA-256 over `JSON.stringify` of the ordered `[name, Function.prototype.toString.call(body)]` pairs. A discovery index or name list is not execution identity. Captured values are not inspected (in-contract; stated in §7 and the runner comment).

`same_name_distinct_body_swap_refuses_instead_of_running_one_body_twice` (selection.rs 149–216): adversarial file registers `[pass,fail]` on discovery/`--journey-index 0` and `[fail,pass]` on index 1. Snapshot 03 **fail** receipt, first check `target` pass, second journey fail detail contains `journey registrations changed`, marker `pass\n` only — second body did not run. 9bee ran both slots as pass.

Name/order/count drift still fails before bodies (`focused_registration_drift_fails_before_any_body_runs`); green on snapshot 01 and 03, and on the prior 9bee corrected fixture.

### Stable ALL-duplicate execution

When registration is stable, every duplicate still runs. Same test’s second half rewrites to `[pass, fail]` for every process: two `target` journey checks, pass then fail with `duplicate failure`, marker `pass\nfail\n`. `literal_option_names_and_duplicate_bodies_keep_their_exact_receipts` runs two `--help` registrations (pass then fail). Snapshot 03 actual execution: both tests ok.

### Ordered single-digest behavior and argv / output limits

Host passes one hex digest, not per-registration argv (`test.rs` 817–836). List JSON still carries names; sources are hashed in-process only. `JOURNEY_OUTPUT_LIMIT` remains 256 KiB (inherited).

Snapshot 02 hash-array protocol: 2000 unselected + one target → **E2BIG** (`identity-size-before/focused.stdout`, receipt `1788778577585.json`). Snapshot 03 digest: `focused_identity_does_not_exhaust_argv_on_unselected_registrations` (2000 `other` bodies that would throw) **success**, one `target` pass, checks length 1. That is actual execution of the digest repair, not a restatement of the failed 02 run.

### Failed discovery / body status and 250ms grace / numeric exit

**Introduced** `JourneyRunnerOutput::failed_exit` (`test.rs` 913–917): `Some(code) != 0` is always unsuccessful; `None` is unsuccessful unless `grace_terminated` (completed receipt then 250ms kill). Discovery: nonempty list + `failed_exit` refuses bodies (`test.rs` 808–815). Body: keep parsed checks; add host failure only when none of those checks is already `fail`/`blocked` (868–881).

`unsuccessful_discovery_cannot_admit_a_selected_body`: `--list` sets `exitCode = 3`; snapshot 03 receipt has `journey runner` fail `status` 3, no `target` body check.

`a_passing_body_receipt_cannot_hide_an_unsuccessful_runner_exit`: `exitCode = 1` (focused and full suite) and `beforeExit` → 2 (focused). Snapshot 01, 02, and 03 all **ok**; asserts retained pass check plus host fail with that numeric `status`. 9bee CLI masked the same `exitCode = 1` fixture.

Grace: after a completed receipt, deadline becomes 250ms; kill is cleanup, not a new failure (`test.rs` 994–996, 1014–1016; §7 lines 593–596). `synchronous_loop_times_out_and_a_leaked_handle_cannot_hold_the_runner` (infinite loop → 5s host deadline fail; `setInterval` leak after pass stays pass) last **executed** on snapshot 02. Snapshot 03 `test.rs` still implements `grace_terminated = completed`. The leaked-handle test source in `test_verb.rs` is unchanged (`6e95630aa…` on 9bee and on snapshot 03). Snapshot 03 did not re-run that case.

Residual, in-contract: if the process is still alive with a nonzero `exitCode` when grace SIGKILL runs, Unix `wait` is `None` and `failed_exit` is false. Spec calls that kill cleanup. The numeric-exit tests passed because Node actually exited 1/2 within 250ms on Hetzner.

### Literal `--journey` names versus `--blocked` / `--project` help

**Introduced:** `main.rs` 51–52 help scan uses only `&["--journey"]`, not `test::VALUE_FLAGS`. `parse_options` still uses `--blocked/--project/--journey`.

`help_requested` skips the next argv only for a bare `--journey` token, so `--journey -h` is a literal name; `--journey=--help` is not the help token. `test --blocked -h` / `--help` and `test --project -h` / `--help` now see help.

Parser unit test renamed and cases moved: `--project/-h` and `--blocked/--help` must request help (verbs.rs 470–493). `guide.rs` 34–45 asserts those four CLIs succeed with empty stderr and `usage: snapback2 test` without a compiler. Snapshot 01 executed both (parser 2/2, guide 13/13). `main.rs` / `verbs.rs` / `guide.rs` hashes are unchanged 01→03.

This restores ff894 help and rejects 9bee’s VALUE_FLAGS regression (`--blocked -h` wrote a blocked receipt; `--project -h` treated `-h` as a path).

### Default full-suite semantics, receipts, refusals, lifecycle, docs

Focused still sets `journeys_only` (`test.rs` 86) and skips top-level derived families; `scope.journey` is applied on every finish path (78–80). Plain `test` still runs derived + every journey. Snapshot 03 re-ran `named_journey_selection_is_exact_scoped_and_does_not_hide_full_suite_failures`: focused two `focused` passes across files; missing name fails with `available`; full suite has no `scope.journey`, `certify` pass, `focused extra` fail.

Cannot combine with `--derived-only` or `--blocked` (usage 2). Compile failure under `--journey` still records `scope.journey` and `certify` fail. `--json` stdout equals the written receipt in the tests that assert `latest_receipt`. Owner/store lifecycle is inherited (`IsolatedOwner` start/stop). Zero checks still cannot pass (inherited).

Docs: §7 now states digest identity, help split, exit-status rule, and grace-as-cleanup. `guide/testing.md` (exactly 4096 bytes, at the testing-page budget, not over it) states body source, captured-state limit, unsuccessful runner exits, and full-suite default. CLI help tells `--journey=--help` and “every matching registration.” That matches the implemented contract. The verb table in §6 still omits `--journey` (inherited; §7 is the binding focused text).

## Material findings

None.

## Non-material residuals (not CHANGES_REQUIRED)

- Identity-mismatch runner receipts use the **file path** as `checks[].name` (`test.ts` 132–134). Inherited from the baseline throw path. Failure is visible; `scope.journey` is still set. Swap test does not require the second name to be `target`.
- If focused discovery lists the selected name but omits `registrationId`, the file is failed and `matched` is not set, so a later “no journey has this exact name” check can also appear even though `available` contains the name (`test.rs` 816–825, 885–896). Coordinated runner always sends `registrationId` when `--identify` is present. Not hit by the eight controls.
- Snapshot 03 did not re-execute guide help or leaked-handle tests. Help sources were unchanged since snapshot 01 (where they passed). Leaked-handle last ran on snapshot 02; snapshot 03 source still has the grace exception.
- Generated `dist/test-runner.mjs` hashes moved after the eight controls. Source leaves did not. Not a product-contract miss; it is the stated artifact limitation.
- `testing.md` is 4096 bytes on a 4096-byte guide budget (`Buffer.byteLength > limit` is false). Tight, valid.
- `test.rs` is 1413 lines (under the 1500-line cap).

## What this review does not claim

No whole-product, full Clique, size, performance, or publication clearance. No Snapback 1 gate story. No Muse ultra execution. No third review. No global outage claim. Source review is separate from repaired-source Darwin qualification (none in this pack; ff894 is historical and separate).
