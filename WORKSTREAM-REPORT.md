# Integration 7 — complete, 0.4.25

Base: `63b83fed66`; branch: `sb4-loop`; version: **0.4.25**.
No origin push and no npm publication. Only the expressly requested Mac
verification ref `sb4-integ7` has been transferred. Protected Mac publication
and MACFIX worktrees were untouched. No simulator was booted.

## Changes and commits

Ordered `--no-ff` merges:

| Workstream | Merge commit |
| --- | --- |
| DX | `094c00a205` |
| PAGE | `b46e23757a` |
| MACFIX | `016591ac22` |

- Combined HAND's shared flag validator with DX/PAGE verbs and browser flags;
  unknown flags still fail early with exit 2. Kept REL deploy and DX
  password/admin/upgrade recipes, both journals and LLP additions, PAGE
  membership paging and MACFIX release/store fences. Combined guide cards fit
  their original budgets. Integration repairs: `e759005d33`, `71be4ed2b3`,
  `b4e800c582`.
- PAGE's exact-capacity serialization and allocation-free cursor hashing now
  use the codec's shared erased writer; strict wasm families remain narrow.
  Overflow, underfill, canonical bytes and error propagation stay guarded.
  Regenerated authoring and delivery-boundary censuses.
- Reconciled recipe inserts, unchecked-reference notes, persona/browser
  adapters, current discovery envelopes and first-account `init --adapt`.
- Real Chromium proved that a closed tab can still hold its Web Lock after
  `page.close()` resolves. The fixture waits for the exact closed owner's lock
  to disappear before recovery, retaining live-owner exclusion/exactly-once
  adoption: `aa61228a4b`; closed browser-lock ticket records the observation.
- Bump: **`5a4779e48a`**, `snapback4 0.4.25: password starters and browser proofs,
  capped membership paging, macOS store and release-path fences`. Same eight
  version files as the 0.4.24 bump; actual-engine version tests derive the live
  package version. Mock/legacy/protocol-floor versions remain intentional.
- Final wasm budget: `74895a66f0`; docs reconcile ordinary intent reverse-join
  discovery against LLP 3000.013 §2.1 / 3000.027 §2, distinct from capped PAGE
  read rules. Existing source-present fixtures prove withholding and prediction
  fencing, not rejected-target traversal; assertions/work counts unchanged:
  `0969a934ec`, `b14a026fe7`.
- Required full Mac client pool found a separate bootstrap inspector timeout
  before two test files could run, at shared-host load above 900 and about
  5100 processes. `1bc9993aec` retries only ETIMEDOUT once within the unchanged
  sixty-second cleanup deadline. Discards partial bytes; requires two fresh
  complete empty snapshots; no signal-custody weakening. `b7f161eef8`
  preserves both independent READY reviews. The complete post-reboot Mac client stage passes in one run, including full-count serial models.

## Verification

Linux final bumped source:

- Exact requested five-crate `cargo test ... --no-fail-fast`: **exit 0**.
  Captured summaries total 5852 passed / 0 failed / 41 ignored, including nested
  fixture output; use the archived raw log as the authoritative evidence.
- Complete ordinary client pool **373/373**, 7326 passed / 56 skipped / 0 failed;
  then full default serial model stage **81/81**. DX real-browser proofs included.
- Sixteen post-bump version-reading files: **345 passed / 9 skipped / 0 failed**.
  Inspector cleanup/control tests after the repair: **78/78** across three files.
- Lean: **68 examples / 58 audited standard-axiom theorems / 7 oracle fixtures**.
- Native difftest 20k: **1,163,097 executions**, zero disagreements or unexpected
  errors. Devices seeds 0–999: **31,930 executions**, zero disagreements/errors.
- Lean difftest 20k: **52,010 executions**, 15,412 pass / 4358 unsupported /
  **230 retained disagreements**, same four signatures/counts as PAGE (3, 68,
  132, 27), **no new signatures**. Exit 1 is retained, not claimed as zero.
- Authoring census unchanged: **718 entries / 409 mutation occurrences /
  89 private write sites**. Delivery boundary includes DX witness delegation
  to existing mutation custody/onWrite, no new delivery implementation.
- Fixture wrapper 9/9; full executable Guide 120/120; docs-budget passes
  (README 320/320, client 114 lines/1199 words, deploy 150 lines).
- Root frozen hoisted install plus generated-artifact bootstrap makes both
  inventory and Guide checks runnable on both hosts. Inventories pass:
  365 package tests / 35 script tests / 31 demos / 487 publication leaves /
  162 Guide pages / 1937 snippets. Full root Guide **22/22**, 121 inherited
  warnings. Ref-check **543 LLPs / 11727 refs / 0 errors**.

Mac required publication stages:

- Source `74895a66f0`: full workspace Rust inventory and doctests, exactly the
  publication runner: **exit 0**. Setup, docs, release guard, typechecks,
  package builds, fixture wrapper and **xcframework build pass**.
- Root install/codegen/inventories/Guide: **all exit 0**; no missing prerequisites.
- First full client run was stopped after two bootstrap inspector timeouts;
  logs retain both real refusals and explicitly aborted/unscheduled remainder.
  It is not a qualified stage. The fresh post-reboot fixed-source pool passes **373/373**, **7363 passed /
  20 skipped /0 failed**, followed by full-count serial models **81/81**, no
  skips or failures: **the entire publication client stage exits 0 in one run**.
  Node 24.19.0, default TMPDIR, ulimit 65536, six slots, published-0.2.33 fence
  cache; source `b7f161eef8`. No assertions, seeds or deadlines were reduced.
- Extra Swift invocation initially refused `-arch` together with a destination
  (exit 70). Corrected invocation uses `ARCHS=arm64`; interrupted by host reboot
  before completion. Fresh post-reboot compile **exit 0 / BUILD SUCCEEDED**.
  Generic simulator destination compiles only; no simulator boot.
- MACFIX's original five reds: two missing event traces supplied by the full
  native producer stage; one-shot/read-existence adapters repaired in MACFIX;
  prior quote-jump layout failure remains honestly tracked in its open ticket.
  Integration 7's full pool passes all five original files, including the unchanged
  quote-jump browser and DX browser proofs. The original flake ticket remains open.

## Wasm and reviews

Final Linux 0.4.25: **2,291,429 raw / 698,386 gzip / 527,885 brotli bytes**.
Budget **698,886 = measured gzip + 500 B**, reason recorded in the budget.
Strict serializer-family/absence audits pass. Mac clean build:
**2,291,752 raw / 698,034 gzip**, within the same budget. Measurements price
whole host-built artifacts; they are not per-feature marginal estimates.

Muse and fresh Codex 6.1 high review records are verbatim with provenance under
`llp/reviews/`, invocation transcripts/prompts archived under the report folder.
Round 1 NOT READY findings repaired; round 2 both READY; final integrated source
round 3 both READY (`74895a66f0`); round 4's inaccurate PAGE attribution NOT READY
preserved and corrected, round 5 both READY (`0969a934ec`). Bounded inspector
repair round 6 **both READY** (`1bc9993aec`), no material findings. Reviews establish
source readiness; they do not replace execution qualification or author acceptance.

## Evidence and disposition

Evidence: `snapback4/reports/20261013-integration7/`. Superseded red runs and
selection mistakes remain separately recorded; targeted passes do not relabel
an earlier full-suite red. Root-only executable mode changes caused by Bun
were restored. No full `scripts/test.sh` invocation; cargo uses disabled
incremental/debug settings throughout.

All requested implementation and qualification is complete. Final cross-host
archives and scoped Git input digests live beside this report. The native Rust
inputs, manifests and JS/Expo runtime trees at Mac Rust source `74895a66f0`, Mac
client source `b7f161eef8`, and final branch are identical; only test cleanup and
documentation/evidence changed after the native qualification. The macOS
bootstrap-inspector and Linux browser-lock tickets are closed. The original
quote-jump layout flake remains documented in its existing open ticket; its file
passed in this complete Mac pool without weakening a pixel/timing assertion.
No required work is deferred. No publication or origin push; only the explicitly
requested final Mac verification-ref transfer. Protected worktrees remain intact.
