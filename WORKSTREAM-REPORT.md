# Integration 14 — pre-LANG2 checkpoint (in progress)

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
Started clean at `59fb4ead1b`; fetched origin and fast-forwarded (already current).
No push, publication, publication target access or publication-worktree edits.
LANG2 has NOT been merged. The coordinator must authorize that merge.

## Integration and constraints

Applied llp-orient to Snapback 4. Governing context: LLP 3000 §7; release
activation 3000.000.000 §13 and release-spanning clients 3000.000.000.000;
proof kit 3000.011.003.000.000; starters 3000.011.003.000; reference actions
3000.039 §13; rules 3000.036.002; mint contexts 3000.000.001; application
lifetime 3000.013. No new proposal or authority change was authored. Existing
lane review artifacts remain intact. Merge fixes compose their reviewed intent.

Read each lane's report in its own worktree first and merged DAY3, PREV,
RULES3, SURF3, KIT2 in exactly that order using --no-ff. Report conflicts retain
the integration side. Combined saved-version and bridge paths, expiry recovery
and rule pointers, shared CLI metadata plus doctor repair, and extracted saved
fixture selection plus per-query sweep personas. Renumbered colliding appended
LLP sections (KIT2 proof §10 and application §6.11); raw reviews are unchanged.

The first broad runs found integration mismatches: zero-sync Expo needed to
strip native imports while retaining SecureStore; printed Expo port wording had
to satisfy both lanes; port validation must precede frontend builds; publication
unit fixtures needed the DAY3 module; browser peer mocks needed KIT2 init-script
support; saved-directory assertions and the descriptor-warning assertion needed
current contracts. Source fixes are committed; passing final broad reruns are
still pending. The first client run omitted a global SNAPBACK4_BIN override,
so some proof helpers selected an installed baseline; the final run will bind
the merged debug binary explicitly.

## Commits so far

a86e81188a Integration 14: scope descriptor restart assertion to host diagnostics
b34c9a6ef8 Integration 14: consolidate release notes and record wave 13 before LANG2
304c7bf6b1 Integration 14: validate proof ports before builds and compose qualification fixtures
9cec89f636 Integration 14: record clean pre-LANG2 wasm measurement
a3e5fddd82 Integration 14: preserve zero-sync Expo and printed port contracts
6393a786b8 Integration 14: compose proof census and packed H9 checks; allow 718015 B wasm
8a8a1c0102 Integration 14: merge KIT2 proof contracts and client readiness
e2451c9b08 Integration 14: merge SURF3 fixtures, mint order and CLI surfaces
629bedd6e2 Integration 14: merge RULES3 authorization recipes and refusal diagnostics
60f06e411f Integration 14: merge PREV release previews and backfill narration
cd57caff41 Integration 14: merge DAY3 saved-source, starter and expiry fixes

## Verification so far

- Product frozen install/native/wasm/client setup ran. Initial wasm budget
  refusal was 301 B over the inherited ceiling; new measured budget is 718015 B.
- Clean strict wasm audit/measurement at 6393a786b8: 2355193 B raw,
  717515 B gzip, 542232 B Brotli; budget = gzip + exactly 500 B. Node24
  Brotli quality11 wrapper was used because no brotli executable is installed.
  No runtime ceiling changed. Measurement is committed.
- Native difftest run: seeds 0–19999, 20000 compile, 1220035 executions,
  no unexpected binder refusals, generator errors or disagreements.
- Device difftest: seeds 0–999, 1000 compile, 27922 executions, no disagreements.
- Lean: lake build passes; 20000 cases, 16827 supported/3173 unsupported;
  130 disagreements in the four already retained signatures (E_RULE/NOT_FOUND,
  prelude E_RULE/NOT_FOUND, next/no-next and continuation-next/no-next), no new
  signatures. Its nonzero exit is retained, not relabeled as a full pass.
- Authoring census regenerated from CENSUS_ITEM output: 798 entries, identical
  to the merged file, test passes. Delivery-await census regenerated from AST.
- Complete current guide target: 125/125 pass. Docs budget passes, README317/320.
- Root frozen install + workspace hoist + scripts/check-generated-artifacts:
  PASS. Diagnostics registry, guide manifest and all projections regenerated,
  no tracked root drift. Root inventories PASS: 365 package tests, 35 scripts,
  31 demos, 487 publication leaves, 162 pages/1937 snippets. Root guide ongoing.
- Ref-check PASS: 550 LLPs, 11958 refs, zero errors/unchecked (before §17 append).
- Pre-LANG2 survey: 99/100 pass, exact RULES3 code counts except all21
  N_FIXTURE_ARGUMENT_DRIFT removed. Same lane087 toolchain precondition.
  Supplying snapback4/node_modules in that private copy passes lane087 too,
  with its two previously unreported notes (never-complete, production-writer).
  Original farm apps are read-only. Detailed counts: /tmp/integ14/survey-prelang.log.
- Mac reachable, scratch clone ~/projects/snapback-integ14 only, via Git bundle.
  Node24.13.1 downloaded and checksum-verified. Full five-crate initial run
  ongoing; final affected/platform client pool and repaired Cargo rerun pending.
- Exact: private copy under ~/sb4-loop/prewave14/exact2 with three path
  dependencies redirected from the pinned0.4.29 snapshot to this merged source.
  Original Exact checkout unchanged. Frozen registry setup failed on unavailable
  public0.4.29 / local Darwin optional metadata; private-copy unfrozen Bun1.4.2
  install against local registry passes. Fresh hello --snapback --port26040
  generation/device build ongoing. Final merged pack wiring and web test pending.
- Upgrade preparation: npm install --save-exact snapback4@0.4.29 from the
  local registry passed. That actual binary wrote two note rows at one fixed
  millisecond and a parent with two children. Private offline parent/index
  removal reproduces the pre0.4.29 F2 orphan state (0.4.29 itself no longer
  creates it). Pristine backup and exact outputs saved under /tmp/integ14/.

## Remaining before ready-for-LANG2

Finish and fix current broad runs, complete final full Cargo rerun after the
last fix, bind and rerun full client pool, packed consumer qualification with
all H9 cases, root guide, Mac affected/platform pool and final Cargo targets,
fresh Exact wiring/web tests and preliminary upgrade checks. Packed preparation
uses the new --prepare-directory option to avoid target/publication entirely.
Qualification uses --consumer-only: normal qualification invokes forbidden
scripts/test.sh, so it supplies no publication receipt. All requested source
checks run directly and are reported separately.

## Deferred until coordinator resumes for LANG2

Merge LANG2 last, integrate P17/P18 diagnostics/docs and capability markers,
complete the coherent0.4.30 changes entry and LLP3000.037 §17, bump exactly as
c113020b4a in its own `snapback4 0.4.30: ...` commit, repeat full Cargo,
difftests,100-schema surveys and wasm measurement; finish final version-bound
upgrade/pack checks as affected. Do not push.

All logs and transient inputs are under /tmp/integ14; final evidence will be
retained in snapback4/reports/20261016-integration14/ before the handoff.
