# Review artifact: LLP 0261 — grok family

Target: `llp/0261-runtime-performance-championship.spec.md`

## Round 1 — 2026-08-15

- **Reviewer:** Grok 4.6 (grok CLI, --reasoning-effort xhigh, web search disabled), fresh non-interactive session, blind to the other
  family's review.
- **Revision under review (v0.1):** the initial commissioned draft, reviewed
  in the authoring worktree before any commit; its exact bytes were not
  preserved (process defect recorded in the run journal). All findings were
  fixed in v0.2, so the verdict below binds to the enumerated findings, not
  to a recoverable hash.
- **Verdict:** NOT READY.

I'll review the Draft Spec for material defects only: first I'll load the LLP review skill and the document, then spot-check its load-bearing citations against the actual sources.The spec is loaded. Next I’ll spot-check the cited harness scripts, related LLPs, and `benchmarks/protocol.md` against the claims that would actually change an implementer’s work.I’ll now read the harness scripts and the cited LLPs in parallel so I can check each load-bearing claim against the source, not just the spec’s paraphrase.The 0209 numbers check out. Next I’ll verify settlement/clock language in 0200 and the 0189/0186/0201/0197 rules the spec leans on.I have the load-bearing citations checked. I’ll record the review artifact, then give the findings in the format you asked for.1. **SEVERITY: MATERIAL.** §3.3 / §4.1 (lines 305–319, 331–348 vs §3.2 lines 295–300). MVS-O1 is a claim-bearing performance cell and therefore inherits “at least six frozen common offered-load points,” but §4.1 defines offered load as an open-loop arrival-rate grid, while §3.2 defines offline replay by frozen backlog depth (1/10/100), dwell, and in-sequence replay. Those are different independent variables; six rates are never specified for replay, and a settle-gated client sequence is diagnostic under §4.1. A published MVS-O1 curve would not have a determined X-axis. Evidence: the spec text above; `diag-hot-stream.mts` has no offline-replay rate grid (only `FIXED_ARRIVAL_INTERVAL_MS` / `DEFAULT_SUSTAIN_INTERVAL_MS` for online arms).

2. **SEVERITY: MATERIAL.** §4.2 (lines 365–378) with §2.3 (lines 230–234) and §4.1’s committed/settled/converged counters (line 348). A healthy point requires 99.9% of scheduled operations to reach “the expected terminal class,” but that class is undefined for arms that have four separate milestones. Lconv p95 is computed only on successful samples; missing observer convergence is a first-class outcome, not clearly an oracle violation. An implementer can treat terminal class as settlement, declare `lambda*` (and §7 cost) at a load where most observers never converge, and still publish a healthy Lconv p95 on the fast subset — the quantity MVS-W1/W2 exist to measure. Evidence: spec text; LLP 0200 §2.1’s three named milestones (`llp/0200-live-evaluation-scheduling-and-settlement.spec.md` lines 72–81).

3. **SEVERITY: MATERIAL.** §8.3 (lines 623–626) vs LLP 0189 D-4. 0189 D-4 scopes by semantic role: a checker that defines or affects claim semantics stays in the digest even when wave-shared; a replacement drift gate must recompute a value against a committed frozen record; “a content-hash pin regenerated alongside any edit is presence, not coverage.” §8.3 lets “shared runners or metrology that do not define” semantics leave the digest with any registered drift gate, and “Semantic inputs never leave both forms of custody” is satisfied by that pin. A percentile-affecting helper can then change under a regenerated pin without requalification, so a standing championship snapshot can keep advertising after its aggregation semantics moved. Evidence: `llp/0189-verification-cadence-and-claim-gating.decision.md` lines 176–193.

4. **SEVERITY: MINOR.** §0 / §5.1 (lines 37–40, 391–392). The spec says it reuses `benchmarks/protocol.md` norms including counterbalancing. `benchmarks/protocol.md` has repetitions, variance, environment pinning, and one record per lane run; it has no counterbalancing rule. The rotation rule is LLP 0197 rule 2 (`llp/0197-benchmark-publication-standard.rfc.md` lines 56–65). An implementer sent only to the protocol file will not find the cited rule.

5. **SEVERITY: MINOR.** §2.2 (lines 182–184). “LLP 0200 calls the first response data frame the served settlement boundary” is not 0200’s language. 0200 §2.1 says settlement is “the mutate response (result or refusal) is written to the caller.” “First response data frame” is the `HttpBody` comment on Hyper’s first data frame in `src/server.rs` lines 26837–26841 (`http_response_written`). Tsettle’s own client-receipt definition is clear; the 0200 attribution is not.

6. **SEVERITY: MINOR.** §2.1 `Tconv` (lines 146) vs §2.2 (lines 185–190). The event table allows “applied content and/or a convergence watermark,” while the family text requires the semantic oracle and 0200’s release-after-apply order (`current_as_of(V)` for matcher skips). Two implementers can stamp Tconv at different stops (content apply vs watermark vs both). 0200 §2.1 lines 95–112 makes watermark ≥ V the well-defined stop when the envelope-ordering invariant holds.

Checked and not raised: §1.1’s harness paraphrase (`run-oq4-arm.sh`, `run-p1-ab.sh`, `diag-hot-stream.mts`, `analyze-oq4.mts`) matches the scripts; LLP 0209 §1 numbers (5,549,113 rows; p50 863 ms / max 3.6 s; 61–68 MB replace frames; ~6× same-principal headroom) and LLP 0200 §6a (burst improved, H-1 not met) are correctly treated as dated N=1 shape facts; LLP 0201 D2 does call O5 a viability gate, not a comparative speed statistic; `Tack` is a real local boundary (`src/local.rs` stamps immediately after `COMMIT`; `commit_durable_ms == commit_ack_ms` in `src/spike_trace.rs`); N≥3 vs N≥8 and the 180-cell count are internally consistent; §6 durability / cache-posture / same-generator-image rules would block the usual unfair comparisons if followed.

VERDICT: NOT READY

## Round 2 (verification) — 2026-08-15

- **Reviewer:** Grok 4.6 (grok CLI, --reasoning-effort xhigh, web search disabled), fresh non-interactive session.
- **Revision under review (v0.2):** sha256 `518ab37eff0352ce6198933b04f8138fff33aafab0a0f7c29e71eadc038fee1c` (lane commit
  `4bf0ca08a`). Reviewer had both round-1 reports and the reviser's
  disposition table; task was fix-verification plus new-defect check on
  revised sections.
- **Verdict:** READY (all 11 findings RESOLVED, no new findings).

I'll verify v0.2 against both reviews and `LANE_REPORT.md`, then check the revised sections against the cited sources.I have the reviews and v0.2 text. Next I’ll check the cited LLPs and protocol so each disposition is judged against the sources, not just the rewrite.I’ll diff v0.1 against v0.2 and pull the exact cited source passages so I can judge whether each disposition actually closes the finding.I have the source checks. One more pass on the new §4.2 health rules and the §4.3/§7.1 load-point terms so I don’t miss a contradiction the revision itself introduced.v0.2 closes both reviews. Each original finding was checked against the revised text and the cited sources (LLP 0200 §2.1/§2.3, LLP 0189 D-4/D-6, LLP 0197, `benchmarks/protocol.md`, `diag-hot-stream.mts`). None is papered over: the dual oracle, the replay x-axis, the ordering statistic, the cheaper rule, terminal class, and the 0189 chain are now frozen and falsifiable.

**Codex #1 — RESOLVED:** `Tconv(o,V)` now has one stop — watermark `W >= V`, release-after-apply, and `AuthorizedProjection(o, PostState(W))` — which matches LLP 0200’s latest-value/`current_as_of` rule and rejects a `PostState(V)` or end-state substitute.

**Codex #2 — RESOLVED:** Replay is a fixed-backlog scenario, not a six-point rate grid; the x-axis is elapsed time from `Treplay-eligible`, with client count, impulse eligibility, algorithm/version, and dispatch timestamps frozen (MVS-O1 is one client / 100 intents).

**Codex #3 — RESOLVED:** §4.3 freezes p95, paired median ratio, 10,000-resample 95% interval, N≥8, 5% minimum effect, and `lambda-order` before results, so N≥8 is no longer an ordering verdict by itself (LLP 0197’s precommit requirement; `protocol.md` remains only the N≥8 floor).

**Codex #4 — RESOLVED:** Unqualified “cheaper” is all-in normalized cost at `lambda-cost` under the §4.3 rule; respective-maxima and target-only must be named, and unaccounted work-placement blocks the claim.

**Codex #5 — RESOLVED:** §8.3 now keeps `C`, digest, receipts, review heads, named-author acceptance, the claimed runtime, and semantic checkers in scope, and publication requires LLP 0189 D-6 (a)+(b) rather than fix-forward.

**Grok #1 — RESOLVED:** MVS-O1 is explicitly exempt from the six-point offered-rate grid and publishes settlement/convergence completion versus elapsed time for one frozen scenario.

**Grok #2 — RESOLVED:** §4.2 defines the expected terminal class as the milestone conjunction (including `Tconv` for every required observer); a missing convergence is a first-class outcome that makes the repetition unhealthy and cannot be censored out of `lambda*`.

**Grok #3 — RESOLVED:** Percentile/aggregation/uncertainty helpers stay in the digest; only non-semantic machinery may leave, and only under a recomputing frozen-record drift gate — a regenerated content pin is expressly not coverage (LLP 0189 D-4).

**Grok #4 — RESOLVED:** Counterbalancing is attributed only to LLP 0197 rule 2; `benchmarks/protocol.md` is cited only for repetitions, variance, pinning, and one record per run.

**Grok #5 — RESOLVED:** The “first response data frame” attribution is gone; §2.2 now quotes LLP 0200 §2.1’s server-side settlement boundary (mutate result or refusal written to the caller).

**Grok #6 — RESOLVED:** The event table no longer allows content-or-watermark; watermark without the version-matched oracle, or an oracle match without the watermark, is not convergence.

NEW findings: none.

VERDICT: READY
