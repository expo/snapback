# KIT2 wave 13 report

Worktree `/home/ccheever/projects/sb4-w13-kit2`, branch `sb4-w13-kit2`, baseline
`59fb4ead1b` (0.4.29). Implements fix-list #3, #10 and #11 for integration into
0.4.30. Package versions remain unchanged. No origin push or npm publication;
only the explicitly requested Mac scratch clone received qualification refs.

## Changes

### #3 — proof helpers, witness and readiness

- R5: `renderedText` keeps exact strings by default, supports `exact:false` and
  RegExp, and accepts optional `within`. RN-web split-node/scoping guidance is
  explicit. `waitForFresh` accepts a timeout-only options object and reports its
  locator, last count/text, previous value, and absent/unchanged state.
- P12: no durable invocation settles failed/E_WITNESS_NO_WRITE after one second
  from a trusted click, on re-arm, or after a 30-second abandoned arm. Wrong
  provenance/operation/arguments remains E_WITNESS_UNCLAIMED. Claimed writes
  receive a separate full 30 seconds from claim; pending notifications never
  count as terminal. Re-arm/deadline removes observation without cancelling or
  resubmitting real writes. Testing describes all four terminal paths.
- Readiness: `useAppReady()` waits for initial opening and current signed-in
  auth without an admission refusal. It recovers from failed/rejected initial
  restoration after later successful sign-in. Starters gate writable content
  and show an opening refusal instead of an endless placeholder.
- R4: logs default to `<cwd>/logs`, since H6 removes harness TMPDIR and would
  delete the failure evidence. Explicit logsDir supports source-discovery roots
  such as Exact app/. Token CLI stdout is always memory-only; `secret:true`
  extends that capture to cli/command. Stdout files stay empty even while the
  secret command runs; stderr remains diagnostic evidence. Its private stdout reader closes at
  command completion/deadline so an exited tool with an inherited writer cannot
  pin the driver; the focused regression also passes on Mac.
- P16: custom arguments no longer remove --memory. The kit consumes --no-memory
  to use native dev's existing persistent project store; conflicting flags
  refuse. --store is passed to native validation (current dev refuses that
  flag; no new native store-selection feature was invented).
- `waitForServer` bounds server-truth polling and preserves the last answer in
  deadline diagnostics, including a hung poll. Examples use app.online, not
  local predictions. `withBrowser` injects witness=web before app scripts,
  including redirected documents. Testing covers npx wrapper custody, accessible
  names, wrapped select labels, RN-web assertions and frontPage.

### #10 — account forms and release-spanning UI

- Account-owned state keys on app identity and viewer, using React state rather
  than a discardable memo. Restoring→signed-out preserves the null-viewer form;
  app/backend/account changes reset drafts. Starter sign-in controls render
  only signed-out, with restoration/opening placeholders otherwise.
- `guide client` contains the compiled online StaffWorkspace and guest page.
  The browser proof executes the actual published StaffWorkspace block and
  checks draft/selection/input identity, release withdrawal/switches, revoked
  roles, readiness, account/app changes and readiness recovery under StrictMode.
  Sticky role information labels the shell only; protected reads and Save use
  current role/capability evidence. `row.priority ?? "normal"` documents the
  React/Exact boundary for since-release fields. Lists demonstrate matchReadList.
- The card remains within its existing 114-line/1200-word budget; duplicate
  password and generic-list examples moved to CLIENT-AND-OPERATIONS and remain
  typechecked. No budget was raised.

### #11 — client recipes and types

- isPresent narrows nullable and mixed Read data; null/undefined read references
  defensively return false. isReady's existing nullable-data contract remains.
- matchRead/otherwiseAll prose names all five handlers, complete-empty absent,
  and denied routing. Missing denied without otherwise gives the named repair
  while still failing typechecking. Existing inference/covariance tests remain.
- Public guest page explicitly supplies browser session custody/readOnly.
  Raw HTTP query/mutation/action envelopes and stable request ids appear just
  after the testing card's first example. The online role form is compiled and
  browser-tested. API and React entry indexes name the new functions.

## Commits by item

| Item | Commits |
|---|---|
| #3 helpers/witness/readiness | f09e4e77cf, e5a472eb47, efd1d1d5f6, 1db744c687, 9fbd4e7bd6, abdb8be96d, a6eb1ce730, 7931f43149 |
| #10 account/release screen | d2463ce67b, ba2de82540, 68e978f462, abdb8be96d, a6eb1ce730 |
| #11 types/recipes/envelopes | d2463ce67b, efd1d1d5f6, ba2de82540, 68e978f462, abdb8be96d |
| Reviews, journal and qualification | 7931f43149; e822734789 fixes fixture cleanup; f6c7e6d747 records final results |

## Orientation and scope audit

Used llp-orient before implementation. Governing context:

- LLP 3000 §7: periphery, bounded verification and no publication claim here.
- LLP 3000.011.003.000.000 §§1/8/9: retained child custody, evidence, deadlines;
  §9 explicitly replaces conflicting older helper defaults.
- LLP 3000.013 §§6/6.10: app-owned identity/admission and React account lifetime.
- LLP 3000.031 §§1.1/8/9: existence derives from disclosed answers only; explicit
  denied/partial handling and list fallback preserve authority boundaries.
- LLP 3000.000.000.000 §§2/3: served availability and optional since-release data
  are compatibility facts, not authorization.

Affected references still apply. No language/planner/wire/adoption/sync/id/expiry
semantics changed. RULES3 owns roster authorization and DAY3 compatibility
codegen; guide client leaves those one-line pointers. SURF3 owns general CLI
help and E_WITNESS_DISABLED.code; DAY3 owns saved-version scaffolds and the
generated proof build step. Existing delivery-await
census was updated only for proof.ts orchestration waits; SDK delivery recipes
and their classification did not change. No new gate or inventory was added.

## Qualification

Detailed logs and baseline controls: `snapback4/reports/20261016-wave13-kit2/`.
Full transient logs and packed consumers: `/tmp/kit2-work/`.

- Setup: root bun frozen install + ensure-workspace-hoist, Snapback 4 frozen
  install, native build, wasm build (716714 gzip bytes, within 717214 budget),
  client build. Explicit cargo commands used CARGO_INCREMENTAL=0 and zero
  dev/test debug information.
- H9: the same renderedText/no-write contract tests load baseline 0.4.29 source
  modules via KIT2_BASELINE_DIST. Both fail on baseline: substring count 0;
  no-write promise times out. Candidate passes both. The baseline source is
  extracted from 59fb4ead1b, transpiled without semantic changes.
- Affected proof/witness/browser files: 47/47 passed on Linux before final
  readiness supplement; final supplemental readiness and docs tests are recorded
  below. Nullable/mixed inference and all published TSX compile.
- Quarry guide suite: 125/125 passed after compacting the client card and adding
  code-definition/action/default-card pins. Docs budget remains README 320/320.
- Fresh packed init --web and init --expo: frontend:proof and day2:proof each
  twice passed (8/8), repeated after helper corrections. Final artifact run and
  digests are recorded below. Packs retain the branch's 0.4.29 manifests and use
  a local debug native binary: scoped consumer evidence, not publication proof.
- Mac: only ~/projects/snapback-ws-kit2 was created/used. Never touched publication
  clones or modified ~/projects/snapback itself. Wasm generated bytes were copied
  from this checkout. Affected proof/witness/browser files passed (47 plus one
  explicit Linux listener-audit skip). Later qualification also retained a
  concurrent browser-close timeout; final serial run uses unchanged deadlines.
- Full client pool: all 402 files (400 pooled/timer files plus two full-count
  model files) ran in one pass. The pool ran during implementation; affected
  final semantic deltas have scoped reruns. Final counts and disposition below.
- Initial full-pool failures corrected/retested: API index omission; two tests'
  missing Rust-generated event-slot trace precondition; persisted-dev regression
  now opts into --no-memory; readme mock types/index/call coverage; proof-only
  await census. All corresponding scoped reruns pass. A worker-crash case timed
  out under pool load and passed isolated with its original 140-second bound.
  An unchanged export-retention case failed to drain its queue in the full
  pass, then passed isolated in 16.6 seconds with its original bounds.
- Root inventories: ran, blocked by missing inherited Snapback 1 generated demo
  artifacts. Root guide: 19 pass, 0 content failures, 3 preconditions. Missing
  files are competitive-checkpoint generated startReply.args.schema.json and
  todo-v2 generated Contract setCompleted.mutation.ts/runtime-links.ts. No root
  corpus changes or missing-output fabrication were made for KIT2.
- Ref-check, final review verdicts and remaining result summaries below.

## Decisions and deferrals

The --no-memory proof escape intentionally uses native dev's existing project
store. Native --store selection remains outside this lane; its rejection is
explicitly documented, never silently accepted. Root generated-demo setup is an
inherited prerequisite outside the Snapback 4 fence. No KIT2 feature is deferred.
No full scripts/test.sh was run. No package version bump, publication receipt,
capability promotion or origin push is claimed.

## Final ledger

- Product code/content reviewed at a6eb1ce730: Muse round 8 READY and fresh
  Codex round 7 READY. Both verbatim reviews plus earlier rounds are committed
  under llp/reviews. The final secret-pipe lifetime addendum also has Muse round 9
  and fresh Codex round 8 READY verdicts. Final self-contained packet is in the evidence directory.
- Final packed artifacts: consumers-shipping at 7931f43149, all 8/8 proof runs pass. SHA256
  digests and publicationQualified:false are in packed-consumers.json.
- Final Mac serial run: 47 passed, 1 explicitly Linux-only listener audit skipped,
  0 failed. Browser-close deadlines were unchanged; the earlier concurrent
  failure is preserved separately.
- Final readiness recovery test passes after building the package; rejected
  opening, later sign-in, denied admission, StrictMode and app replacement are
  covered. A transient earlier attempt used stale dist while rebuild was still
  running; the dependent final test was rerun after completion.
- Final Rust guide suite: 125/125. Docs budget: 320/320 and self-containment test
  passes. Ref-check: 548 LLP docs, 11317 refs, 0 errors, 0 unchecked.
- Complete pass: 400/400 pooled/timer files, 7535 tests (7470 pass, 8 fail,
  1 cancelled, 56 skip); 2/2 full-count model files, 81/81 tests pass.
  Session models verify 5000 sequences per tier; online models retain 3000.
  All eight initially failing files have passing scoped fixes/reruns. The
  initial failures and their resolutions are preserved in full-client-summary.json
  and full-client-initial-failures.log. No work counts or time bounds were reduced.
- Final affected pool: 13 files, 189/189 assertions passed. One process guard
  caught the new pipe-holder regression deliberately outliving the file; the
  fixture now observes that child's finite exit (portable ps on Linux/Darwin,
  no descendant PID signals). Proof + platform-audit rerun: 2/2 files, 26/26
  tests, clean process groups. Mac proof-file rerun after that cleanup fix:
  21/21 passed. Thus all 13 final affected files pass after rerun.
- Final report/log updates are validation-only; no further product semantic
  delta follows the reviewed helper implementation. The last client-card prose
  clarification keeps app creation explicitly outside React render.

Final branch HEAD: `f6c7e6d747`. This workstream report is intentionally left
uncommitted for the coordinator; all product changes, reviews and evidence are committed.
