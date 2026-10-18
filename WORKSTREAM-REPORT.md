# Integration 16 — wave 15 / 0.4.32

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`; starting
base `ccb9f752d1`. No push or publication. B16 SEC/STAGE/FRONT were not merged.
This report replaces every lane-local root report; integration's copy was kept
on each report conflict. Publication paths and publication worktrees were not used.

Evidence filenames below refer to `snapback4/reports/integration16/` unless a
full repo or scratch path is given.

## Changes and commits

| Lane | Merge commit | Integrated result |
|---|---|---|
| KIT4 | `c562a9540e` | Coalesced clock-window admission and proof kit, wire and array aliases |
| PROD2 | `b8e0e8afb5` | Initial app readiness across release switches, offline account entry, production adaptation/scan |
| DAY5 | `25632ac15d` | Starter custody, adaptation advice, saved-source and release evidence |
| SURF5 | `acb0f52bf1` | Help/parser coverage, release consumers and CLI discovery |
| LANG4 | `ad2d6d9672` | Source-bound note acknowledgement, new notes and precise refusals |
| RULES5 + LIVE | `17fa5d7e5d` | Live-parent authority and executable authorization recipes |

All six no-ff merges were performed in the requested order after fetch and
ff-only origin/main reconciliation. RULES5 brings LIVE. Concurrent publication
records: repeated fetches through closeout still show origin/main at ccb9f752d1; no publication records arrived.

`f6d46a3b1d` reconciles one coherent guide-changes entry and adds LLP 3000.037
§19, including the first 50-pair Snapback/Convex bakeoff and its later fixes.
The separate ten-file bump **`08fa452c31`**, `snapback4 0.4.32: live-parent
authority, reliable proofs and reviewable notes`, matches `8d068a7577`'s scope.
Existing stores retain rows, ids and captured authority; upgrading alone does
not convert manual copy recipes. The entry explains explicit validated live
adoption, inconsistent-copy refusal, current-audience rollback, the clock cap,
initial readiness, note review and all new diagnostic/recipe surfaces.

`41a6c1100a` binds wasm measurement and census; `4da96d176c` removes an internal
lane ownership label from public recipe guidance. `839fcb690a`, `def836d2df`
and `fe0420d7c0` repair integrated qualification/fixture assumptions: explicit
fixture-only residency setup, all grouped preview facts, complete guide cards,
new proof-kit mocks/refusal guards, a compiled waitForClock example, starter
proof ownership and fake browser bindings. `85563b9700` expects the canonical
owning release path in Mac replay assertions; `442d065523` applies the same canonical path
expectation to release token JSON. `d1e260ca06` corrects the precise
census attribution in the research record. `52780416e5` adds the exported clock helper to the API index;
`ff5e22a144` and `0dd978ad3e` preserve the specific development-reset refusal,
complete session repair and current guide truncation assertions. `9c3cb5f485`
regenerates the reviewed delivery await boundary: all 213 delivery sites,
classifications and fault recipes are unchanged. Two new proof/browser waits
and E_DEV_RESET recognition in an existing custody save add no delivery await.
These later repairs do not change
core/device/client runtime inputs relative to the measured bump.

Both KIT4 and DAY5 are retained in publication-consumer wiring, stage evidence
and receipts. Append-only journal/design additions retain both lanes' intent;
duplicate amendment sections are renumbered and affected @refs repaired.
Generated projections were regenerated, never resolved by hand.

## Context and corpus audit

Applied llp-orient. Read the Snapback4 fence, NOT-DOING/JOURNAL, governing
LLPs/current guide surfaces, lane reports and wave 15/wave 16 analyses.
LLP 3000.014.000 governs live-parent admission, bounded atomic maintenance,
capability fencing, adoption and rollback. LLP 3000.036.002 §13 governs notes;
§14 governs compiled recipes. Starter/proof/release amendments remain in their
lane documents. No new semantic RFC amendment was authored in integration.
Existing reviews remain verbatim. SURF5's unavailable Muse review is the quota
deferral recorded in its report; no two-family verdict is invented.

## Wasm and regenerated records

Measured merged 0.4.32 device: **2,380,425 raw / 725,987 gzip / 547,660 Brotli
bytes**. Budget **726,487 bytes = measurement + 500**. The recorded reason
covers live-parent authorization and the merged wave 15 delta; no independent
feature attribution or runtime ceiling increase is claimed. Strict family and
absent-feature audits pass. Brotli uses Node zlib quality11 via a private CLI
shim because the host lacks a brotli executable. Relative to 0.4.31: +7,596 raw,
+2,712 gzip. SHA256:
`1e6c7b4936c20c51e0bc2092292f631a85bd9b4db9f8d7bd15abf09b85f3cf40`.
The prepared artifact has the same sizes/hash and 500 bytes of headroom.

Compiled authoring census: **529 mutation occurrences / 95 private write
sites** = base 497 + KIT4 one + LANG4 seven + LIVE two + RULES5 twenty-two.
Readauth passes 88/88. The diagnostic registry and chained guide manifest and
inventories were regenerated. Root frozen Bun install, workspace hoist and
check-generated-artifacts restored the named missing legacy ignored outputs.
The closing root checks found node_modules absent again. Restored the frozen
root install, workspace hoist and all generated prerequisites, then reran both
complete gates successfully; that prerequisite-invalid attempt is not a pass.

## Linux verification

The exact five-crate command passes in full after the final fix:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
CARGO_BUILD_JOBS=12 RUST_TEST_THREADS=8 \
cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast
```

The first complete run and final repeat both finish through doctests without
failures: 423 successful summaries / 6,614 reported passes / 45 intentional
ignores each. The final repeat exits 0 and starts after all code/test fixes.
No Linux Rust flake occurred. `rust-results.json` and both compressed complete
logs retain the command, environment and counts. The original first command's
tool session was lost in the provider interruption; its complete clean log is
retained rather than inventing a captured exit code.

The complete final client pass is green: **414/414 files in one pool**, 7,705
passing tests, zero failures, 56 declared platform/opt-in skips. The two models
then run serially with the full default 5,000/3,000 sequence counts: 81/81 tests
pass. Fixture discovery passes 9/9. All 416 client test files plus fixtures run,
using the canonical ordinary-pool / isolated-timer / serial-model split. The
published F2 opt-in is enabled separately on Mac and passes. First-discovery
failures and their repairs are preserved separately; no passing fragments are
combined to claim this clean full pass.

Native difftest 20,000 and devices seeds 0–999 pass without disagreement.
Lean 20,000 has 16,697 agreements, 3,173 unsupported and the same 130 known
mismatches as ccb9f752d1: code 3, continuation-next 35, next 67, prelude-code 25.
The by-oracle counts of all three campaigns exactly match the retained fresh
base controls under snapback4/reports/wave15-rules5/baseline-*. No new signature.
Lean's mismatch exit 1 is distinguished from the two passing campaigns.

Fresh `publish.mjs --prepare-client` packs at `9c3cb5f485` pass
`scripts/qualify-linux.mjs --consumer-only`, including KIT4's R1 clock case,
PROD2 offline entry and production scan, DAY5 advice, LIVE and RULES5 recipes,
all other consumer cases, 12 frontend loads, six starter variants, clean
Ubuntu 24.04/Node 24.13.1 and Alpine / Node 24.18.1. See packed/consumer.json for
artifact integrities and per-stage receipts. Client/Expo integrities exactly equal the earlier fe0420d7c0 packs; the new
CLI includes the clock helper API-index correction. The final pack is a clean source
snapshot; later changes are tests/research/evidence only. Consumer-only avoids
the prohibited full scripts/test.sh; the requested source suites run separately.
This is a passing consumer qualification, not a publication receipt:
publicationQualified=false and automatic source suite=not-run are retained.
Earlier failed/superseded qualifier attempts remain explicitly labeled.

Root inventories pass: 365 package test files,35 script tests,31 demos,487
publication leaves,162 guide pages,1,937 snippets. Root guide passes all 22
checks, zero failed/skipped/preconditions, 121 inherited warnings.
Final ref-check passes: 552 LLP docs, 12,032 refs, zero errors/unchecked.
`node scripts/docs-budget.mjs` passes: README 317/320 physical lines and the
actual named `w14b_first_account_screen_is_self_contained` test runs once and
passes. The earlier lock-wait timeout is not counted as a pass.

## Schema survey and upgrade

Read-only copies of all 100 wave 15 final schemas and all 50 wave 16 Snapback
bakeoff schemas compile on both 0.4.31 and merged 0.4.32. Every original module
hash remains unchanged. Counts by code and individual hashes/findings are in
SURVEY.md and schemas.json.gz. Wave 15 is 452→458, exactly LANG4: cursor−7,
immutable−1, unchecked-reference−1, query-filtered+14, require-refused+1.
RULES5's452 is the same-input pre-LANG4 control. LIVE's372 uses a different
wave14 corpus, so it is not a conflicting wave 15 total. Wave 16 is 102→131,
entirely 29 new query-filtered notes, with no new refusal.

Actual `npm install --save-exact snapback4@0.4.31 snapback4-expo@0.4.31
--registry=http://127.0.0.1:4873/` creates the old store and Expo app. Old
init/check/typecheck pass. Merged adoption preserves the manual recipe row/id;
explicit manual→live conversion and parent department transfer revoke the old
reader and admit the new. Live→manual rollback fills current authority cells.
The actual 0.4.32 upgrade helper, adapt/check/typecheck and Expo web export pass.
The initial source wrapper selected an old ignored platform binary; the resumed
run uses the current native CLI and current upgrade helper. Command ledgers,
results and both attempts are retained. No existing source store was modified.

## Mac Studio

Mac Studio `ccheever@macstudio-charlie-apt101-a`, only `~/sb4-ws-integ16`,
Xcode 27.0 and pinned Node 24.13.1: all selected CLI/language targets, core lib,
device live_parent/readauth and simulation union pass. The complete 52-file
platform/affected client scope passes: 1,096 tests, 1,082 passed, zero failures,
14 platform/opt-in skips. The actual pinned published 0.2.33 F2 witness is then
enabled and passes (no environment skip). Final build and guide target pass;
five follow-up index/reset/browser/session/social files pass all 70 tests.
All nine changed fenced files match the Linux 9c3cb5f485 snapshot by SHA256;
only the expected witness metrics differ additionally. The binding and full
results/logs are in the final Mac archive.

Xcode 27.0 builds both .32 iOS/simulator framework slices and the Release Expo
app. The installed app passes offline and restart native witness scenarios.
A private simulator and isolated Metro TMPDIR/no-build-cache are used; the
compiled bundle is checked for the requested backend URL. Missing generated
chat API, an already-running app and stale shared-Metro-cache attempts are
retained. The final pinned Node 24.13.1 build/witness is green. Installed-app
CLI preparation remains unknown; the explicit Release build commands provide
preparation evidence without claiming publication/own-build attestation.
No black-M5 or other worktree is used. Runtime source inputs are unchanged
between the measured bump and native source snapshot.

Two unchanged Mac timing assertions were intermittent. Under the initial Node
24.21 run, the watchdog measured 3005 ms against 3000 ms; it passes alone at
2167 ms, and the entire file passes in the final pinned Node 24.13.1 full scope.
The production-background drain missed its unchanged 90-second cleanup guard
in the second pinned scope, then passed alone in 4.3 seconds and in the final
complete 52-file scope. Both tickets remain open for underlying investigation;
no timeout or source was weakened. Failed attempts and passing repetitions
remain separately recorded.

## Exact

Fresh clean origin/main clone `~/sb4-loop/prewave16/exact2`, commit `f73ea66`,
includes Contract migrate. Frozen install and fresh synced/online apps use the
merged binary/client. Final version-confirmed 0.4.32 commands, each once:

```sh
# cwd ~/sb4-loop/prewave16/synced/app
bun exact.mjs snapback --rebuild --port 38399
bun exact.mjs test web --backend http://127.0.0.1:38399
# cwd ~/sb4-loop/prewave16/online/app
bun exact.mjs snapback --rebuild --port 35513
bun exact.mjs test web --backend http://127.0.0.1:35513
```

All four pass. Initial generation/install/contract-types commands are in
commands-final.json; final rerun commands and exits are in exact32-commands.json.
The original runner's generic “twice each” text is not a claim that final 0.4.32
ran twice: the ledger records once per mode. Scratch logs/scripts remain under
prewave16 and durable copied evidence accompanies this report.

## Scope, evidence and deferrals

Durable evidence is in `snapback4/reports/integration16/`: CHECKS.json binds
source, merge/bump commits, raw suite results, artifact integrities and platform
inputs. Complete logs are compressed; the Mac archive retains both timing
failures, isolated passes, final complete scopes and native receipts. Exact and
upgrade ledgers record actual commands/exits. The schema table includes every
code and unchanged original hash. Reproducible execution drivers are retained.

Shared disk pressure was handled by removing only exited-PID SQLite sidecars
in this integration target (3,276,989,936 bytes) and 37 reinstallable dependency
trees under three superseded integration consumer outputs. Cleanup ledgers are
retained. Latest qualification4 outputs, packs, source/build/proof results and
all publication paths were preserved.

Every shell invocation has a timeout. Every cargo invocation, including build
scripts, inherits CARGO_INCREMENTAL=0 and dev/test debug=0. Integration builds
use this integration worktree; Mac uses only its authorized scratch clone.
No push, npm publication, full scripts/test.sh, B16 merge or publication-path
mutation. Full publication is outside this brief; all requested source,
consumer, platform, upgrade and app qualifications are recorded above.
The bakeoff's B16 fixes remain in later workstreams. SURF5's historical Muse
quota limitation and the open Mac timing tickets are explicit residuals.
