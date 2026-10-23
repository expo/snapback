# Integration 23 — final view-once main merge

Merge fb5c6335d9 integrates da7b5e3a1d after the complete qualification recorded
in ../qualification-late-main/ and ../qualification-0.4.39/. Its production
changes check the actual response-chain abort state before asset admission and
immediately before durable once consumption, and map duplicate/retryable view
refusals to HTTP410/503. Consumption still commits before any response bytes;
later transport loss conservatively consumes the grant. Known pre-admission
aborts and Range probes do not. TCP half-close is not treated as cancellation.

The sole conflict, http-bounds.test.mjs, retains the incoming three fresh-asset
cases and exact body comparisons. The inspected whole-file diff contains only
those overlapping fixture changes; previous asset-free child-probe and pipeline
checks remain. Journal histories both survive. No production conflict occurred.

Current source 3cd7b7636f records another clean wasm measurement. Linux tests
pass: assets21, view_once4 including a new private-Postgres ledger, standalone
vendored tiny_http13, language guide127, rollback views19, and all ten affected
client files190 tests against both debug and production binaries. Source status
is empty after each client pass; all312 SDK leaves and the client tarball are
identical to the prior full431-file pool. Core changes since that full Core
qualification are verified comment-only; rollback/compiler inputs remain
byte-identical to the fully tested/reviewed rollback correction. The complete
five-crate run after the last authored fix remains documented as its actual
source/scope, not relabeled at a later incoming merge.

Fresh publish.mjs --prepare-client and qualify-linux.mjs --consumer-only execute
all packed proofs, Ubuntu/Alpine and lane-specific security/ROLL cases against
the new production native. publicationQualified=false is intentional: the full
scripts/test.sh is forbidden; separately requested source suites are recorded.
No npm publication is claimed. The new binary also repeats the21 wave25 copies,
all50 published0.4.37 history cycles, the450-project survey and15 gated-project
acknowledgments, all50 original acceptance scripts, and fresh Exact synced and
online apps. artifact-bindings.json joins every native/client hash to these
proofs. Actual commands and cleanup are in exact-commands-r12.md.gz, with ports
27418/27419. Originals remain read-only; replay stores are deleted.

Wave25 remains15 before/10 false ->2 genuine deploy refusals(004/024)/0 false;
all six ROLL controls hide zero rows. Lane030 deploys but default rollback
truthfully refuses two rows lacking a retained preimage/down, with named
recovery. The50 upgrade cycles comprise48 unchanged copies plus two disclosed
authored copy-only compatibility steps(010/032). All50 original acceptance
script bytes remain unchanged; the three baseline-proven expiry support helpers
(007/026/029) and headless tsconfig adjustment are still explicitly disclosed.
Survey450/900 records/1800 calls finds zero false refusals,15 gated projects and
36 individually acknowledged original retained-role findings, zero unresolved.

Black M5 uses only /Users/ccheever/projects/snapback-integ23: assets20 and once3
pass, with the private-PG test explicitly ignored on Mac, tiny_http13 and
guide127 pass, current native builds and the same ten client files190 tests
pass. All3314 source inputs and312 SDK leaves bind exactly, except one precisely
verified appended clean measurement of the unchanged wasm, with no semantic
exception. Earlier qualification already includes all105 Mac platform/model
files2357 passes/14 declared skips and affected Core/CLI/Lean targets.

The first Mac command incorrectly selected the ignored private-PG test without
supplying a cluster; its20 HTTP/asset cases passed. Corrected scopes retain the
declared ignore; the real ledger passes on private Linux Postgres. Direct
workspace testing of the vendored tiny_http crate was rejected by Cargo; its
unchanged tests run successfully from copies, with an empty [workspace] table
in the Mac COPY only. Raw attempts and corrections are preserved, not counted
as passing tests or product flakes. No test assertion or production file was
changed for either harness correction. The owned Linux ledger cluster is
independently stopped. Postgres HTTP asset schemas/blob locations remain fenced
(P1b): ledger evidence is not a PG HTTP asset capability claim.

Docs budget, ref-check, root inventories and guide pass after the client runs.
Generators regenerate the diagnostics registry, symbol registry and guide
manifest with no diff. Authoring census875 and delivery census215 regenerate;
store-port production allowance remains zero. Clean wasm remains2407070 raw,
735469 gzip and553849 Brotli; budget735969 is measurement+500 with the previously
recorded whole-artifact reason. Strict family/absence audits pass.

Known baseline Lean mismatches and the three inherited stock-PG exclusions are
fully documented in the prior qualification. They are not newly waived. Every
shell command has a timeout; Cargo disables incremental/dev/test debug. No
publication worktree or target/publication is used.
