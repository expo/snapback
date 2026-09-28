# Lane OK — round 1 review corrections

Date: 2026-09-28. Branch: `sb4-intent/ok-owner-key-coverage`.
Starting commit: `8566a00785bd8685dea2843e35bbec05fcdf58db`.
First command: `git fetch origin && git merge origin/main`; already up to date,
with no conflicts. Read the round 0 prompt, report, journal entry and both
reviews. No push or publication. No tools installed; other worktrees and the
read-only calibration input were not changed. `scripts/test.sh` was not run,
per the round 1 commission; the supervisor owns the landing suite.

## Review disposition

1. **Grok medium: sign-out documentation.** Kept the existing sign-out design.
   `guide feeds` and LLP 3000.028 §§3.4, 3.4.1 and 7.3 now say the replica,
   outbox and owner's proof survive local sign-out. The same principal can
   reopen offline with complete absence; another caller must establish its own
   whole partition. An explicit replica reset still removes keys and markers
   atomically. The round 0 report links this correction; its journal entry is
   preserved as historical evidence.

   New public-client tests use real sessions and actual native/wasm devices.
   They acquire Alice, sign out offline, verify durable credential removal,
   reopen Alice with complete false for a missing key and true for an old key,
   then force Bob onto the same physical store. Bob's missing and old keys are
   both raw unknown and public `E_OFFLINE`, never false. Alice can reopen again
   with her proof intact. The normal SDK requested two distinct principal-bound
   names; the custom test opener deliberately aliases them. The native/memory
   Rust lifecycle tests additionally close and reopen the persisted device.

2. **Grok low: web residency.** `WebResidency` includes the target tables of
   declared owner-key maintains even though their names begin with `$`.
   Private maintained-column tables and other hidden names keep their existing
   exclusions. This preserves the guide's per-table measurement and matches
   native counters; `totalBytes` already included the projection and is unchanged.
   The real wasm test now reports one `$ownKeys:likes` row / 186 logical bytes,
   matching native, across same-principal and forced different-principal reopen.

3. **Grok low: disjunct admission.** Added
   `insert <- .owner = viewer or allow` to
   `unsafe_policies_refuse_at_the_sync_line`. Production `caller_owned` still
   requires **all** disjuncts to prove caller ownership.

4. **Astra low: payload disclosure regression.** The new device test inspects
   Alice's and Bob's one-row snapshot pages and catch-up payloads directly.
   Every projection put names its recipient; each old-key deletion ID matches
   that recipient's snapshot key. Both principals delete and insert between
   snapshot and catch-up, so both directions and tombstones are exercised.

## Native residency answer and the ordinary-table control

**Yes.** Bob can list Alice's owner-key row count if a custom opener gives Bob
Alice's physical store. The same native snapshot lists Alice's ordinary private
`notes` row: one owner-key row / 186 bytes, one private note / 116 bytes, and
two public likes / 226 bytes. Web now reports the same logical table figures.
`sqlite_residency.rs::read` has no viewer input and queries all visible table
counters; the web cache is likewise store-wide. Owner-key tables are not worse.

The test also found the ordinary private note itself readable on this
deliberately aliased store. Ordinary device reads rely on the per-principal
replica boundary; normal `createLocalClient` store names contain URL and
principal. The owner-key complete marker is stricter: Bob remains unknown.
No normal account-switch disclosure is claimed.

Filed [the requested ticket](../../../issues/20260928-snapback4-residency-counts-cross-principal-store-reuse.md)
for the existing shared-store boundary. The ticket includes both counters and
the ordinary-row observation, reproduction, and a bounded follow-up that
preserves the sign-out design. Runtime evidence is in
[owner-lifecycle.log](round1/owner-lifecycle.log).

## Tests that fail without the correction

| Control | Observed failure |
| --- | --- |
| Round 0 guide text + new guide test | Fails on the missing sign-out-preservation statement ([log](round1/red-guide.log)). |
| Round 0 web filter + corrected lifecycle test | Native passes; web fails because `$ownKeys:likes` is undefined ([log](round1/red-web-corrected.log)). |
| Insert `clear_rows` into sign-out | Both native and web same-principal reopen assertions fail with loading instead of complete false ([log](round1/mutant-signout.log)). |
| Remove the exact-owner group requirement | Native and memory device tests fail at Bob's unknown assertion ([log](round1/mutants-rust.log)). |
| Also route owner-key deletion events to the public partition | The payload test fails with a foreign principal's tombstone in Alice's stream ([log](round1/mutants-rust.log)). |
| Change `RuleExpr::Or` from `all` to `any` | The compiler test fails on the newly added `or allow` source ([log](round1/mutants-rust.log)). |

The three independent Rust mutations were injected in one build; the log
contains each corresponding assertion failure. All mutations were restored
in `finally` blocks before qualification. Sign-out was mutated only in the
untracked built JS; production session code is unchanged.

## Qualification

| Check | Result |
| --- | --- |
| New owner-key lifecycle test on native and web | 2 passed; [log](round1/owner-lifecycle.log). |
| Owner-key Rust device regressions | 6 passed; [log](round1/device-own-keys.log). |
| Owner-key compiler regressions | 3 passed; [log](round1/compiler-guide.log). |
| Whole guide | 93 passed; [log](round1/compiler-guide.log). |
| Full Rust device suite | Exit 0: 1,373 passed, 0 failed, 5 ignored across 72 target summaries; [log](round1/device-suite.log), [aggregate](round1/device-summary.json). |
| Web/device JS, residency and session-security suites | 189 counted tests: 187 passed, 2 failed (one browser subtest timeout plus its parent), no skips; [log](round1/web-device-suite.log). |
| Isolated ordinary/exit-transport control on round 0 | 3 passed; [log](round1/exit-transport-baseline.log). |
| Same isolated control on final implementation | 3 passed; [log](round1/exit-transport-candidate.log). |
| Package build and typecheck | Passed; [build](round1/package-build.log), [typecheck](round1/typecheck.log). |
| Native build and wasm build/budget | Passed; [native](round1/native-build.log), [wasm](round1/wasm-build.log). |
| Docs budget | 300/300 README lines, self-containment test passed; [log](round1/docs-budget.log). |
| Reference audit | Passed, 0 errors / 0 unchecked; [log](round1/ref-check.log). |

Commands ran from `snapback4/` with Node 24.13.1 and the existing worktree
dependencies. Rust commands used `CARGO_INCREMENTAL=0` and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, except the docs-budget
script's own single guide check. The full requested Rust device suite uses
`cargo test -p snapback4-device --no-fail-fast`; compiler/guide uses
`cargo test -p snapback4-lang --test own_keys --test guide --no-fail-fast`.
The JS invocation was:

```sh
node --test --test-concurrency=1 packages/snapback4/test/device*.test.mjs \
  packages/snapback4/test/web*.test.mjs packages/snapback4/test/own-keys.test.mjs \
  packages/snapback4/test/residency.test.mjs packages/snapback4/test/session-security.test.mjs
```

The browser suites used the installed Chromium; no browser or tool was
installed. The isolated control sets
`SNAPBACK4_WEB_ADMISSION_FOCUS='replacement after validation'` and runs
`web-admission-review.test.mjs`, once with the round 0 `web-residency.ts`
and once with the final source. This is the only changed product-runtime file;
the rest of the admission runtime is unchanged. Source was restored before
the final audit. `scripts/test.sh` was not run.

The five existing ignored device tests are the tracked presence-conjunction
reservation case, `diet_hot_paths`, the wall-clock sweep-lag measurement, and
the two explicit owner-key cost measurements (`costs`, `fixture_costs`). This
round added no skip. Compiler warnings are inherited unused imports/dead code
and unused authorizer results; none failed a check. `git diff --check` and
the affected source-file size check pass. Stored logs normalize trailing
whitespace without changing assertions, outcomes or summary lines.

## Wasm

Rebuilt with Rust 1.97.0, wasm-bindgen 0.2.127, `CARGO_INCREMENTAL=0`, and
no wasm-opt. The artifact is byte-for-byte identical to round 0:
**2,017,908 B raw / 585,100 B GNU gzip-9** (the build-script convention).
Round 1 delta: **0 B**. The unchanged 586,193 B budget has **1,093 B** headroom.
Filename-free GNU gzip-9 is 585,075 B. The SHA-256 before and after is
`1050652571e0f696a94b737f281273ebf73583769a34142e584e52d1f6edfd2a`.
See [wasm.json](round1/wasm.json) and [the build log](round1/wasm-build.log).
Only TypeScript residency reporting changes in this round; the engine's
production Rust is unchanged. No budget was raised.

## Failure ledger

- **Environmental/timing, isolated controls green:** the full JS run's
  `replacement after validation refuses the original orphan binding at the
  server (exit transport)` timed out at `page.waitForResponse` after 5,000 ms
  (`web-admission-review.test.mjs:1114`). Its parent also counts as failed.
  The unmodified test's isolated baseline and candidate runs both passed all
  three counted tests (ordinary, exit, parent). The original failure remains
  in the full log; no all-green full-web claim is made. The shared 96-CPU host
  reached load 107.62 during overlapping builds/tests; this is timing evidence,
  not a proved Chromium or product root cause. The failing fixture has no
  owner-key policy and makes no residency call. There is no demonstrated
  owner-key regression and no runtime change to the admission path.
- **Ours, corrected test assumption:** the first new native/web test assumed
  a private ordinary row would be filtered after deliberately aliasing the
  store. Both failed that assertion ([red-web.log](round1/red-web.log)). The
  existing device relies on per-principal store isolation. The test now
  records that control as evidence for the ticket, while requiring owner-key
  proof refusal. No ordinary-row product behavior was changed.
- **Ours, tooling:** the first sign-out mutation command refused an ambiguous
  source replacement before editing anything. Restricting the replacement to
  the sign-out block produced the expected two assertion failures above.
- **Ours, intentional regression controls:** the guide/filter red runs and
  six deliberate mutant assertion failures are expected, not unresolved
  qualification failures. Both production fixes and all restored-code checks
  are reported separately above.
- **Baseline (not rerun):** the round 0 million-row IndexedDB stall is unchanged. It
  was not rerun here and remains tracked by its existing ticket; no completed
  million-key browser acquisition is claimed.

## Scoped LLP orientation and audit

Used the repository's `llp-orient` skill (read from the initialized
`/home/ccheever/coldclone-test/vendor/llp/skills/llp-orient/SKILL.md` because
this worktree's aggregate link is unpopulated). Scope was sign-out, owner-key
proofs, partition payloads and residency, not app authoring. Governing sections:
LLP 3000 §4 (Snapback 4 fence), LLP 2000.000 §7 (principal replicas),
LLP 3000.028 §§3.4/7.3 (proof and acceptance), LLP 3000.019 §3.4 (residency),
and LLP 3000.011.003.000 §2 (local sign-out). The author ruling resolves the
conflicting sign-out claim without changing product behavior. The only open
design question is the ticketed custom-opener store boundary. Updated the
existing LLP and guide; no new LLP, gate, budget or dependency. Hand-off: none.
