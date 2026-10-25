# FIX41 publication repair — 0.4.41

Base: 5c4716af14, branch sb4-loop, authorized direct push to main after fetch/merge.
Version stays 0.4.41. Publisher evidence was read only; no sb4-pub-* tree or kit modified.

LLP context: Snapback 4 fence, LLP 3000 §7 (bounded admission, publication),
LLP 3000.009.001.000.002 §6 (managed-relation interception),
LLP 3000.011.003.000 §10 (installed starter toolchains),
and LLP 3000.000.000 §20–21 (rollback views). Scope-specific @refs checked.
User ruling authorizes a dated exception for unavoidable unpatched advisories.

Execution: llp-orient and llp-ship; user-specified shared sb4-loop checkout
and optimistic main merge procedure override generic run-branch instructions.
Three disjoint implementation lanes share the existing target: binder,
rollback, browser; primary owns feature-aware test/audit/integration. Cap four
agents including primary, initially 131 GB disk free / 235 GiB RAM available /
load 3.3; avoid duplicate target trees. Every launched shell command bounded
by timeout and cargo invocations carry required profile flags.

1. Store feature test: core test-support constant reports compiled evaluation
feature. Both exact-tracker outcomes asserted; altered tracker always refused.
Package-only test PASS 1/1. Workspace binary PASS 612/612 (57 ignored).
Additional raw-fixture census PASS8/8 after reusing the existing fixture boundary.
Publisher inventory459binaries/1177executions ran; only two development-fixture
failures appeared (eligibility fixture and fixture-site census), both corrected
and focused reruns passed. Runner completed with those two failures; no other failures. Final affected
checks rerun current code, and targeted fixes are separately green.
2. Binder: 0be6995c45, early stable-value qualification and borrowed AST.
Eight levels721.5ms ->6.3–6.7ms; twelve76.7ms. Positional target11/11passes.
Short differential2k:120,026 executions,0 disagreements. Lean2k exit1 only
known CLASSIFIED C2/W4 signatures (18; no new signature). Full lang package run hit its1200s guard after1857passes; no test failure
before interruption. Publisher-style runner completed the broader inventory.
3. Rollback:39cdc9cea7; fitting original selection under compiler/transaction
checks, independent-child receipt coverage retains view fallback. roll_views
28/28pass, eligibilityunit1/1pass. Replay evidence c13733cce0: before=after,
100stores/500moves,482successes,18expectedtrue refusals,0false refusals,
0hiddenv1rows,482correctlive lines,194ordinary forwards,300originalfilesunchanged.
Safe JSON in snapback4/reports/20261025-fix41/replay-{before,after}.json.
4. Audit: checked-in GHSA-86w9-cpqp-85rv exception through 2026-11-07,
recheck 2026-11-08. Unrecorded/fixable findings and new upstream releases fail.
62 qualifier tests pass (includes exception/maturity/patch/unknown regressions).
Ticket records code-signing tooling reachability. Commit2a9b9871dc,
review corrections97e59e6d2f (container COPY and every-template audit result).
Qualifier62/62 and day5proofs5/5pass. Packed proof pending.
5. Browser:438e676638, bounded replenishing bank observes raw refusal and
host diagnostic; removes HTTP probe. Deterministic refusal/expiry regression.
20/20alone (2.999–3.217s),20/20under8-fileclientpool (3.019–3.131s).
Pool8/8files187/187tests pass; related overload/platform114/114pass.

ref-check PASS569docs/12617refs. Fresh prepare-client completed at c13733cce0.
Initial Muse and fresh Codex reviews received verbatim under llp/reviews/;
Codex found container policy COPY + template warning receipt omissions, fixed.
Muse found no code/design defect, requested frozen source and finished checks.
Frozen-source second-round Muse and fresh Codex reviews both READY for content. Final affected, consumer proofs and
push pending. Shared npm cache had an ENOENT read; isolated owned cache works,
registry confirms node-forge latest1.4.0. No change to version0.4.41.
