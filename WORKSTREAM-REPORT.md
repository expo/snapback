# PUBFIX29b — 0.4.29 consumer repairs

Branch: sb4-w13-pubfix29b. Starting tree clean; `git log sb4-loop..HEAD`
was empty, base 92878680fc. Version remains 0.4.29. No push or publication.

## Changes

- E1: api.ts includes one deterministic canonical availability helper, identical
  to REL3's SDK predicate. All package imports are types. The audit found one
  additional generated runtime import: server.ts now takes the application's
  `startServer` as its first argument. Migrated generated-wrapper callers,
  positive/negative type witnesses, golden outputs, guides and published docs.
  `generated-modules.test.mjs` recursively compiles 60 fixture schemas, checks
  every emitted TS/JS module with the TypeScript AST, executes APIs with no
  node_modules, and compares every operation's availability to the SDK helper.
  Shapes explicitly required: query, mutation, action, ephemeral, Following,
  receipts; job-containing fixture schemas also participate. Checked loading,
  denied, absent/different operation, reordered/nested canonical signatures,
  wrong kinds, missing arguments and added arguments.
- D1: the shared generated frontend-proof script rejects a singleton runtime
  range before starting dev. Tested all six UI starter/template variants and
  both proof and interactive launcher with a poisoned binary path. Audit:
  launch.mjs already refuses UI singleton ranges and exempts backend/native
  smoke; day2-proof has one serve and accepts one port; proof-kit helpers each
  own one host and keep single-host ranges; witness web already requires A<B.
- D2: downgrade refusal now clearly relates registry and installed versions;
  existing fake-registry downgrade/no-write test covers default and requested
  targets and still allows explicit `--to`.
- H2: top-level help lists web-shell; the wrapper handles --help/-h with a
  description before touching files or resolving a native binary. Native help
  also describes the wrapper verb. Portable regression checks both paths.
- H3: retired generic recipes now print usage plus E_RECIPE_RETIRED and concrete
  --web/--expo, --template chat and guide recipes replacements before writes.
  Existing feed-specific diagnostics remain. Regression includes named output dir.
- H7: witness web imports the optional Playwright peer only during execution;
  missing peer yields E_WITNESS_BROWSER and install/browser commands. Help works
  without the peer. Isolated helper test uses an inert client export, no peer.
- H8: clock/reset share one dev-address helper using doctor's validated persisted
  store-owner discovery; explicit --port wins and the prior 4400 fallback stays.
  Portable test starts persisted dev on an OS-assigned non-default port and
  checks run, doctor, advance and reset, including clock effects and explicit port.

The generated-code audit covers both emitters, receipt bindings, declaration
outputs and golden fixtures. Starter UI/client files are application source and
own their explicit SDK runtime imports; generated bindings do not. Historical
pre-REL3 frozen captures remain historical; their metadata normalization removes
and validates the new inline form before comparing the original bytes.

## Governing context / decisions

Applied llp-orient. Scope: Codegen, CLI, Testing, starters. Governing documents:
LLP 3000 §§1,4,7 (current/fence, generated artifacts and publication tests),
LLP 2000.000 §§9,12 (one runtime, bounded process), implemented LLP
3000.000.000.000 §§2–3 (availability and generated compatibility),
LLP 3000.011.003.000 §8 (application proofs), LLP 3000.019 §3.7 (validated dev
owner discovery), and LLP 3000.007.003 §7 (retired feed installer).
Read current API/actions/routes/testing guides before editing. Amended the
existing REL3 document, without a new LLP or a contract.ts change. The first-arg
server runtime injection is the narrow choice needed to satisfy the user's
all-generated-modules requirement; its user-visible migration is in guide changes.
Open questions: none blocking. The server wrapper migration is documented and
all repository consumers are updated. Hand-off: none.
No device/core code changed; no wasm remeasurement required. Required setup did
build wasm (716714 B gzip, budget 717214), without changing tracked device assets.

## Verification

Qualification Cargo commands ran from snapback4 with CARGO_INCREMENTAL=0,
CARGO_PROFILE_DEV_DEBUG=0 and CARGO_PROFILE_TEST_DEBUG=0. Pinned Bun 1.4.2
was used after repeating the initial ambient Bun install with the frozen lock
unchanged. Never ran full scripts/test.sh. No reduced seeds, sequence counts,
shard selection or alternate SNAPBACK4_BIN was set for the full client pass.

- Setup: pinned `bun install --frozen-lockfile`; `cargo build -p snapback4`;
  `bash scripts/build-wasm.sh`; `bun run --cwd packages/snapback4 build`: PASS.
- Affected Rust: actions 11/11, routes 9/9, corrected guide 125/125. Updated
  list-bound snapshots through the existing explicit snapshot-update test.
- Completed `cargo test -p snapback4-lang -p snapback4 --no-fail-fast`: 3206
  passed, 2 failed, 29 ignored across all targets. Every language suite and CLI
  integration suite passed. The two failures were unchanged CLI unit tests:
  refusal-writer lock release and resolver-fixture readiness. Both passed in
  the two earlier broad attempts. A subsequent complete
  `cargo test -p snapback4 --bin snapback4` passed **439/439**, with the same
  5 existing ignores, without code changes. The intermittent failures remain
  tracked in issues/20261016-snapback4-unit-cleanup-and-resolver-readiness-flakes.md;
  passing repetitions do not close that follow-up.
- Full client pool in one pass: **398/398 files**, 24 slots, then isolated timer
  files as the ordinary runner specifies. 7522 assertions: 7451 passed, 15
  failed, 56 existing skips. Five files failed initially: event-slot-capability
  and event-slots lacked generated target/event-slots-traces.json; init-recipe
  expected the old bare usage line; qualify-linux rejected changelog flag-owner
  wording; wave11-upgrade-history compared live edited changelog text with an
  older embedded binary. All five were resolved and passed the rebuilt rerun.
- Existing trace producer: `cargo test -p snapback4-device --test event_slots_trace`:
  **2/2 PASS**. This generates test data; no device source changed.
- Both default full-count models: **2/2 files, 81/81 assertions PASS**, no skips;
  app-session 5000 sequences and online-client 3000 sequences.
- After fixes/rebuild: one affected pool of **15/15 files, 171/171 assertions
  PASS, no skips**: both event-slot files, init-recipe, qualify-linux,
  wave11-upgrade-history, wave10-upgrade, generated-modules, pubfix29b,
  test-platform-audit, readme-examples, generated-effect-opt-in, server-e2e,
  wave12-kit, web-shell and proof. This includes all failed full-pool files.
  Earlier focused failure/precondition reruns also passed 91/91 assertions.
- `./ref-check`: PASS with all six review artifacts, 0 errors/unchecked refs.
- `node scripts/docs-budget.mjs` in snapback4: PASS, README 320/320 and the named
  first-screen test ran once and passed.
- Root `node scripts/check-inventories.mjs`: FAIL guide-manifest on missing
  untracked Snapback 1 demo/Exact artifacts (competitive-checkpoint startReply
  schema; todo-v2 contract outputs). No root publication projections changed.
- Root `node scripts/check-guide.mjs`: exit 1, 14 passed, 1 failed, 4 skipped,
  3 preconditions. Root node_modules is absent: the packed-auth check fails
  ENOENT; dependency checks skip; guide projections require the same absent
  generated demo artifacts. Snapback4 dependencies are installed separately.

Validation corrections preserved existing guards: restored init's usage line and
retirement wording, migrated the isolated handler fixture's runtime path mapping,
kept the exact Chromium defining phrase, and removed literal retired-flag prose
from the template census. No unrelated unit-test code or deadline was changed.

Verification decision: run the complete client pool once, preserving default
oracle/model counts, then rerun every failed file and affected product surface
after rebuilding. Narration/test-precondition corrections do not change the
other completed model inputs; those full-pool results remain applicable.
Raw logs, review briefs and local runner scripts are retained under
snapback4/target/pubfix29b-evidence/ (ignored), including the complete failures
and subsequent passes. No unqualified publication receipt is claimed.

## Exact repro (actual web tests)

Read the supplied prewave13 repros without modifying them. Copied the device
hello and online app under snapback4/target/pubfix29b-exact/{device,online};
excluded target/.exact/node_modules, retained supplied application tests and
0.4.29 device asset. Ran `EXACT2=$HOME/sb4-loop/exact2 bun exact.mjs update` in
each copy to repair relocated Cargo patches/paths, and set absolute mount paths
(device snapback4/ts; online snapback4/online) in each copied app.json. Generated
backend API with this branch's binary, without stubs or manual import edits.

For each copied backend directory:

```
BIN=/home/ccheever/projects/sb4-w13-pubfix29b/snapback4/target/debug/snapback4
$BIN types
$BIN dev --port 26020 --no-watch --memory   # device; online uses 26021
```

Then in its hello/app subdirectory:

```
CHROME=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
EXACT2=$HOME/sb4-loop/exact2 EXACT_PORT=26120 \
CARGO_TARGET_DIR=/home/ccheever/projects/sb4-w13-pubfix29b/snapback4/target/pubfix29b-exact/cargo-target \
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
$HOME/.bun-1.4.2/bin/bun exact.mjs test web
```

Online uses EXACT_PORT=26121 and backend 26021. Device: 2 passed, 0 failed;
online: 2 passed, 0 failed. Both web builds accepted generated api.ts. Initial
copy run required relocation update; initial browser run needed CHROME; an
intermediate online run used the device mount accidentally, corrected to the
original online driver. All owned devs were terminated/reaped in finally.
Exact2 source and original repros were unchanged. Logs live under target/
pubfix29b-exact/{device,online}-testweb.log, local runner /tmp/pubfix29b-exact-repro.py.

## Reviews / commits / deferrals

Blind round 1: Muse READY (minor suggestions); fresh Codex NOT READY for missed
server-wrapper type fixtures, an assertion and effects-guide prose. All addressed,
including name/missing-argument oracle controls. Verbatim reviews with provenance
saved under llp/reviews/3000.000.000.000-pubfix29b-r1.*.md.
Blind round 2: fresh Codex READY and Muse READY, same requested model roster
and effort; saved under llp/reviews/3000.000.000.000-pubfix29b-r2.*.md.
Commit E1: c5692b6b72 — self-contained generated TypeScript modules.
Round 3: both fresh Codex and Muse READY on the final validation corrections;
verbatim artifacts under llp/reviews/3000.000.000.000-pubfix29b-r3.*.md.
Codex notes that the binary still embedded earlier recipe wording during its
review; final qualification rebuilt it before the affected consumer reruns.
Commit D1/D2/H2/H3/H7/H8: da2d5e0c98 — proof ports, CLI help and dev discovery.
Evidence/report commit contains this report, six verbatim reviews, journal/LLP
records and the unrelated fixture follow-up. No push or publication performed.
Deferrals: root Snapback 1 dependency/generated-artifact bootstrap and the two
unchanged intermittent unit fixtures (ticket above). No requested product repair
is deferred.
