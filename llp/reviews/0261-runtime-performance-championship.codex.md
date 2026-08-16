# Review artifact: LLP 0261 — codex family

Target: `llp/0261-runtime-performance-championship.spec.md`

## Round 1 — 2026-08-15

- **Reviewer:** Codex gpt-5.6-sol, model_reasoning_effort=xhigh, read-only sandbox, fresh non-interactive session, blind to the other
  family's review.
- **Revision under review (v0.1):** the initial commissioned draft, reviewed
  in the authoring worktree before any commit; its exact bytes were not
  preserved (process defect recorded in the run journal). All findings were
  fixed in v0.2, so the verdict below binds to the enumerated findings, not
  to a recoverable hash.
- **Verdict:** NOT READY.

1. **SEVERITY: MATERIAL — `llp/0261-runtime-performance-championship.spec.md:146,185-190` (§2.1–2.2).** `Tconv(o)` does not bind its semantic oracle to a specific version. Under Snapback’s latest-value/coalescing contract, an observer may validly converge for mutation version V through a frame or `current_as_of` watermark at W>V, without ever presenting the exact state at V. “Matches the authorized post-state” therefore has two incompatible interpretations. Evidence: LLP 0200 lines 95–113 expressly permit convergence through later watermarks, while `diag-hot-stream.mts:1781-1800` currently checks only `observedVersion >= committedVersion`. The proposed semantic check needs a version-defined oracle or the convergence metric is not reproducible.

2. **SEVERITY: MATERIAL — `llp/0261-runtime-performance-championship.spec.md:222-228,297-301,317-319,341-348` (§2.3, §3.2–3.3, §4.1).** Offline replay is required to produce six open-loop offered-load points, but its offered-load variable is undefined. The workload fixes backlog depth and sequential replay after a resync barrier; the general arrival schedule could therefore measure offline intent creation rather than load reaching the backend. Neither replay-client concurrency nor replay-release rate is specified. MVS-O1 consequently has no reproducible x-axis and cannot yield a comparable latency-versus-throughput curve.

3. **SEVERITY: MATERIAL — `llp/0261-runtime-performance-championship.spec.md:350-356,426-432,621,632-635` (§4.1, §5.3, §8.3).** The contract treats N≥8 as sufficient for “faster” ordering but defines no preregistered ordering statistic, uncertainty rule, minimum effect, or rule for selecting load points. A publisher could choose a favorable median after seeing overlapping or reversing repetitions. `benchmarks/protocol.md:77-91` establishes N≥8 only as a floor; LLP 0197 lines 46–55 and 167–173 require the aggregation rule to be committed before results. Merely storing an aggregation rule in the eventual claim record does not satisfy that requirement.

4. **SEVERITY: MATERIAL — `llp/0261-runtime-performance-championship.spec.md:529-545,632-635` (§7.1, §8.3).** The cost contract permits an unfair “cheaper” claim. Each system is measured at its own `lambda*`, so normalized costs can come from materially different utilization/load points, and required generator/client computation is explicitly excluded from target cost despite Snapback’s local-first work placement. Although generator cost is shown alongside, §8 does not require “cheaper” to mean target-only cost at respective maxima or require a common-load/total-cost comparison.

5. **SEVERITY: MATERIAL — `llp/0261-runtime-performance-championship.spec.md:611-630` (§8.3).** The asserted LLP 0189 compatibility omits mandatory claim-chain elements. The listed digest scope does not require the claimed runtime/implementation itself, named-author acceptance, or review heads, and publication is not gated on LLP 0189 D-6’s green scoped evidence plus the newest eligible complete-battery result. “Battery reds … follow fix-forward rules” is not that publication precondition. Evidence: LLP 0189 D-4 lines 176–193 requires the runtime/implementation and semantic checkers in scope; D-6 lines 217–229 requires the eligible battery reference; lines 317–319 preserve receipts, review heads, and named-author acceptance.

VERDICT: NOT READY

## Round 2 (verification) — 2026-08-15

- **Reviewer:** Codex gpt-5.6-sol, model_reasoning_effort=xhigh, read-only sandbox, fresh non-interactive session.
- **Revision under review (v0.2):** sha256 `518ab37eff0352ce6198933b04f8138fff33aafab0a0f7c29e71eadc038fee1c` (lane commit
  `4bf0ca08a`). Reviewer had both round-1 reports and the reviser's
  disposition table; task was fix-verification plus new-defect check on
  revised sections.
- **Verdict:** READY (all 11 findings RESOLVED, no new findings).

- Codex #1 — RESOLVED: `Tconv(o,V)` now requires watermark `W ≥ V` plus an oracle match against the version-specific `AuthorizedProjection(o, PostState(W))`, correctly handling LLP 0200’s latest-value semantics.

- Codex #2 — RESOLVED: Offline replay is now a falsifiable fixed-backlog experiment with frozen inputs and elapsed time from `Treplay-eligible` as its explicit x-axis.

- Codex #3 — RESOLVED: §4.3 preregisters the load-point selection, paired median-ratio statistic, deterministic bootstrap interval, N≥8 floor, and 5% minimum effect required by LLP 0197 and the benchmark protocol.

- Codex #4 — RESOLVED: §7.1 requires common-load and respective-maxima tables, target-only and all-in costs, and restricts unqualified “cheaper” to statistically supported all-in cost at the common healthy load.

- Codex #5 — RESOLVED: §8.3 now includes the claimed implementation, semantic machinery, receipts, review heads, and named-author acceptance, and correctly imposes both LLP 0189 D-6 publication preconditions.

- Grok #1 — RESOLVED: MVS-O1 is explicitly exempt from the rate grid and fixes one client, 100 intents, simultaneous eligibility, replay algorithm/version, and elapsed-time completion curves.

- Grok #2 — RESOLVED: §4.2 defines each arm’s terminal conjunction and makes any required missing convergence render the repetition unhealthy without exclusion or censoring.

- Grok #3 — RESOLVED: §8.3 follows LLP 0189 D-4’s semantic-role rule, retaining semantics-affecting helpers in the digest and permitting only genuinely recomputing frozen-record drift gates outside it.

- Grok #4 — RESOLVED: Counterbalancing is now attributed to LLP 0197 rule 2, while `benchmarks/protocol.md` is cited only for norms it actually defines.

- Grok #5 — RESOLVED: §2.2 now accurately attributes LLP 0200’s server-side settlement boundary to writing the mutate result or refusal to the caller.

- Grok #6 — RESOLVED: `Tconv` now has one unambiguous stop requiring both watermark advancement and the matching versioned semantic oracle.

NEW findings: None.

VERDICT: READY
