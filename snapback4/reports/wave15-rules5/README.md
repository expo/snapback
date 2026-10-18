# RULES5 verification evidence

Scope: wave-15 authorization on LIVE, target 0.4.32. This is workstream
qualification, not a publication receipt. The root WORKSTREAM-REPORT.md records
final results and limitations; this directory retains the raw outcomes, including
failed setup attempts and bounded invocations. All `.log` paths below refer to
verbatim entries in `raw-logs.tar.gz`; compression was byte-verified before
removing the loose copies. Later successful checks do not
relabel those attempts.

## Semantic and packed execution

- `context.md`: governing LLP context and lane boundaries.
- `reviewed-inputs.json`: hashes of the round-2 review inputs. Verbatim independent
  reviews, prompts and provenance are committed under `llp/reviews/`.
- `guide-full.log`, `packed-recipes-final-source.log`, `mac-final.log`: the guide compiler,
  installed client/native tarball execution, and Mac affected qualification.
- `device-readauth-final.log`, `mac-readauth.log`: refreshed exact authoring census.
- `live-shapes.json`: full 077/085 originals and accepted/refused LIVE variants.
  An admitted authority subset is explicitly distinguished from the full app.

Packed execution uses the existing qualification file
`packages/snapback4/test/wave14-rule-recipes.test.mjs`. Every added Quarry block
is extracted from the installed CLI's guide, checked, then executed. The
portable client package is built before packing; the host package contains the
built native executable. The test removes its temporary extraction directory.
The Mac uses the same portable client tarball with its Mac-native executable.
`mac-final-source-comparison.json` confirms all nine final source files match.
The earlier Mac packed snapshot has the same Quarry blocks; only subsequent
prose and a heading differ. `final-artifacts.json` binds the final Linux repeat.
`client-pack.json` retains the portable package inventory/integrity.

## Differential and source controls

`difftest-summary.json` compares all worker counts and signature multiplicities
for native 20,000 cases, device seeds 0–999 and Lean 20,000 cases against fresh
`ccb9f752d1` binaries. It also binds the executable digests. The worker reports
and inherited reduced cases are retained in `diff-*` and `baseline-*`.
The Lean model is unchanged from that baseline. Its known disagreements and
unsupported cases are not counted as passes.

`survey.py` copies each of the 100 read-only wave-15 schema.q files into an
owned temporary project and runs native check. `schema-survey.json` and
`schema-baseline.json` include source hashes and full diagnostics;
`survey-summary.json` compares them. This source-only survey is not the farm's
full-project note census. The baseline extraction and its 767 MB build directory were deleted after use; a
second partial extraction interrupted by disk exhaustion was also deleted.

## Broad and platform checks

Every cargo invocation sets CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0 and
CARGO_PROFILE_TEST_DEBUG=0. All shell invocations are timeout-bounded. The full
five-crate command and bounded continuation attempts are kept as `full-*.log`;
no aggregate timeout is called a passing one-shot run. Completed per-target
results are available in `test-counts.json` and the final report.

The first Linux language invocation failed two SQLite cases with `DiskFull`
while another shared-disk extraction also failed. `full-language-recovered.log`
is the rerun after the coordinator freed space: both SQLite failures pass.
That command had already compiled the old compatibility test before the
correction was written, so it stops at the known fixture-membership mismatch.
`language-remainder.log` rebuilds the correction and executes every remaining
language integration target. That continuation finds two guide inventory guards:
LIVE's enlarged roster section and the stale 36-block recipe count. The
manual alternative now has its own bounded section; all 45 recipe blocks and
the LIVE roster's one documented note are pinned. No Quarry source changes.
`guide-inventory-recovered.log` and `mac-guide-inventory-recovered.log` pass
all 143 affected tests. `language-docs-recovered.log` completes doctests.
`lang-allocation-replay.log`
records an earlier mistaken --lib filter (zero tests), not allocation evidence.
The Mac language run found a frozen-corpus membership mismatch for LIVE's new
fixture; the test now excludes that later fixture, like PAGE4, while preserving
every frozen expectation and LIVE's dedicated tests. The correction's Mac
result is `mac-compat-recovered.log`.

All remote work used only `ccheever@macstudio-charlie-apt101-a` and
`~/sb4-ws-rules5`. No black M5 use. SSH calls have outer Linux timeouts;
remote Cargo runs use Python subprocess timeouts because macOS has no `timeout`
command. No credentials or other worktrees were copied or changed.

## Root and documentation checks

`root-install-final.log` records frozen root Bun install and workspace hoist.
`generated-artifacts.log`, `inventories-pass.log` and `root-guide-pass.log`
record repaired fresh-tree prerequisites and successful root checks.
`docs-budget-pass.log` records snapback4/scripts/docs-budget.mjs (the root has
no such script). `ref-check-final-source.log` is the latest reference audit.
The initial missing legacy outputs/hoists and the initial concurrent presence
client timeouts remain visible; final isolated Linux and Mac affected client
checks pass without changing the assertions or workload.

`evidence-manifest.json` hashes the final retained evidence files, excluding
itself. Source changes, commits, exact counts and deferrals are in the root
WORKSTREAM-REPORT.md. No package version was changed and nothing was pushed.
