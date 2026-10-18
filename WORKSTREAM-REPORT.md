# FRONT workstream — 2026-10-18

Branch sb4-b16-front. No push or version bump. The initial branch was clean,
with no commits in sb4-loop..HEAD. Implementation and evidence are in this
worktree only; original bakeoff lanes remain read-only.

## 1. Frontend attribution and common API

[All 50 paired rows](snapback4/reports/20261018-front/ATTRIBUTION.md),
[method/file digests](snapback4/reports/20261018-front/attribution.json),
[all-50 source-density cross-check](snapback4/reports/20261018-front/DENSITY.md),
[results and ownership ledger](snapback4/reports/20261018-front/RESULTS.md).
The unchanged harness reproduces medians 200 vs 75.5. Removing unused
production recipe files alone yields a counterfactual median 141; the report
does not claim every remaining line is client overhead or extra functionality.
Every counted line is attributed to recipe, native proof support, config,
client/auth/state/type glue, or app/format residual. Residual functionality
cannot be inferred from raw LOC alone. The all-50 source-density cross-check
also finds eight pairs where Snapback has more app/client lines but fewer
trimmed characters; the table keeps this formatting confound explicit.

Implemented useQueryData (data/undefined, typed throwing refusal),
useQueryResult (inline why plus precise read), and SignedIn. The precise hooks
and contract.ts remain unchanged. Ordinary init no longer emits recipes;
production examples ship in installed dist/recipes and the packed guide's
copy commands are qualification inputs. Native smoke remains DAY5 proof support.

Three complete frontend copies retain their forms, mutations, assets, role
branches and paginated lists. Same-harness frontend counts are 002: 489→354
(Convex 455), 026 Expo: 354→197 (Convex 354), 048: 609→470 (Convex 748).
Screen-only savings are 5, 15 and 9 lines; recipe removal is separate.
Reproduce the copies with [rewrite.py](snapback4/reports/20261018-front/rewrite.py);
rewritten screens are alongside it. Original lanes remain untouched.
All three copied apps passed check and frontend:proof twice against the prepared installed client (six browser proof passes). Original lane SHA-256 digests are unchanged. Screen LOC is sensitive to JSX layout: trimmed-character counts are 002 13,218→13,149; 026 7,621→8,166; 048 19,206→19,201. The Expo rewrite adds inline refusals and correct partial/empty rendering; these results establish harness LOC changes, not universal byte reductions.

## 2. Completeness notes

Default output leads with the checked author-query repair; otherwise it names
the exact missing pin or analyzer limit. Impact explicitly distinguishes
showing returned rows from proving absence/all matches. Different scans at
one site keep their own audience evidence. Identical repair bodies and
repeated context deduplicate separately. A CLI test recompiles the actual
printed repair and checks that it settles the relevant completeness note.
No persistent suppression state or broad note acknowledgement syntax added.
LANG4 owns other notes; RULES5 owns role/probe implication changes.

## 3. Rules/schema/diagnostics/dev-server

Read every one of the 58 entries (194 self-estimated minutes); retained the
entries with source line numbers and six clusters in friction.json and
RESULTS.md. FRONT fixes the completeness presentation, read/UI boilerplate, and lane036
money-argument documentation with an installed-package executable recipe.
The largest remaining authority/fanout, refusal trace and staging clusters
belong to RULES5/LANG4 and STAGE/KIT4 respectively; one-line pointers are in
the RFC and result table; published changelog describes only user-visible changes. Existing working rewrites
are preserved. No measured post-change builder-minute saving is invented.

## 4. Time

hourOfDay(t) returns UTC 0..23; hour(t) remains epoch hours. Existing IR only,
one input evaluation, negative/i53 boundaries tested. N_SWEEP_DEADLINE is a
scheduled status/deadline advisory (including confirmation coupled to an overdue sweep), with named row deadline and explicit
opening/closing/equality choice. It never invents a directed guard or claims
a safety proof. Helper/alias/int/upsert limitations are documented. KIT4 owns
clock caps and test-session time; SEC owns stronger invariant verification.
Actual copied-schema checks: 020 retains two advisories, 043 gains the missing
confirmItem advisory (a confirmed flag tested by the overdue job), and 046
remains quiet because it already compares the deadline. Before/after JSON is
in the results directory. Row/branch correlation is disclosed rather than
presented as a security proof.

## Design reviews

LLP 3000.013.002, with verbatim provenance-tracked reviews under llp/reviews/.
Muse round 1 and Codex rounds 1–2 identified guard direction and lost same-site
scan/audience evidence. Revised implementation fixes both. Fresh Codex round 3
and Muse round 2 returned READY. The source-repro coupling amendment received three additional independent
rounds. Codex and Muse both returned READY in round 3; earlier wording and
message-interpolation issues are corrected. All six amendment responses are
preserved verbatim with frozen proposal SHA-256 provenance.
Muse succeeded through the prescribed key
fallback; no key was read or printed by this workstream.

## Commits

- a19d992f43: census, friction clusters and initial RFC.
- 9e927d0ffb: short React hooks/auth gate, guide assets instead of emitted recipes, executable client/production tests.
- 877c910fac: completeness rewrites/dedup, hourOfDay, sweep advisory, reviewed design and source-copy proofs.
- 43a56bfee3: keep internal ownership pointers out of the published changelog.
- e485e8b902: reviewed confirmation/overdue sweep coupling, money recipe and packed proof, client expectation/JSX census fixes, candid LOC/character evidence.
- Final evidence commit: this report, RESULTS, all-50 density cross-check and verification.json (source/integrity/status/log digests).

## Verification ledger

- Setup: Snapback 4 frozen Bun install, binary, wasm and client build passed.
- Root frozen Bun install, ensure-workspace-hoist and check-generated-artifacts passed.
- Root check-inventories passed: 365 package tests, 35 script tests, 31 demos, 487 publication leaves, 162 guide pages / 1937 snippets; existing expired-gap warnings remain.
- Root check-guide passed twice, including the final repeat: 22 checks, zero failures/preconditions/skips. Root check-inventories also passed its final repeat with unchanged inventory totals.
- ref-check passed: 552 LLP docs, 0 errors/unchecked.
- Linux affected client tests: five passed, zero skips.
- Mac Studio ~/sb4-ws-front: same five affected React/Expo tests passed, zero skips; package asset build passed. No M5 MacBook used.
- Lean build passed (58 jobs), including quarry-oracle.
- Full Rust workspace inventory (including difftest): 411 binaries / 1,129 executions plus doctests ran. Initial run exited 1 on four targets: builder_guidance, guide, check and wave11_qdiag. All four repaired targets passed reruns: current API census, pinned guide budgets, changed note wording, and built Lean oracle respectively. This is full inventory execution plus successful targeted repair, not a single all-green full run.
- Affected reruns: lang builder_guidance 5 + front_semantics 3 + guide 125; CLI 473 passed / 5 ignored, check 105, check_notes 11, init 51; difftest wave11_qdiag 1.
- docs-budget passed (README 317/320 physical lines).
- Full client file pool executed all 412 files / 7,718 tests: initial 3 failed assertions in two files (stale emitted-recipe expectation and JSX/example index census); 56 platform/optional skips. Repaired files passed all 37 tests on Linux and Mac Studio with zero skips. Default-count models both passed: 5,000 seeded three-runtime histories per session tier and 3,000 online histories; 81 model tests, zero failures/skips. The original pool process exits 1 because it retains the two repaired initial file failures; it is not relabelled an all-green full run.
- Final sweep/guide rerun passed: builder_guidance 5, front_semantics 4, guide 125.
- ref-check rerun passed: 552 docs / 12,004 refs / zero errors or unchecked. docs-budget rerun passed.
- First fresh prepared pack and qualify-linux --consumer-only passed at 43a56bfee3, using proot isolated consumers. Final source e485e8b902 has a new prepare-client pack (317 files, 1,289,036 bytes); the exact installed short screen, hour/time query and money JS/QL recipe passed in the packed proof. Final qualify-linux --consumer-only passed on this exact fresh pack and source, with 12/12 browser proofs, all six starters (adaptation where applicable) and both Ubuntu 24.04/Alpine consumers. [verification.json](snapback4/reports/20261018-front/verification.json) records the client SRI, binary digest and log hashes.

Qualification choice: use qualify-linux --consumer-only because the ordinary
mode invokes the full scripts/test.sh, explicitly forbidden by this task.
Run the full Rust inventory and full client pool separately; consumer-only
proves the fresh packed frontend/toolchain and Linux runtime consumers but
creates no publication receipt. This is an explicit scope decision, not a
claim of full publication qualification.

No next-wave bakeoff was run, so population wins and builder-time reductions
remain unmeasured. No public deployment, npm publication or push was performed.


Cleanup: removed 1,636 test-created SQLite DBs/sidecars (1,638,494,968 bytes)
from this worktree's snapback4/target, compared with the before-test inventory;
zero new SQLite files remain. Compiled SQLite objects/libraries were preserved.
A helper-invoked Cargo test produced incremental artifacts despite the direct
Cargo commands' flags; those completed-test artifacts were removed (1.18 GB),
and subsequent helper commands inherit all three required Cargo flags. Eight
additional test-artifact paths (traces, logs and image fixtures) were moved
out of target to /tmp/front-test-artifacts. No process using this worktree's
debug test/backend binaries remained after the suite.
