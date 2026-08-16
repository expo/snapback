# Review artifact: LLP 0267 — codex family

Target: `llp/0267-query-cost-guardrails.rfc.md`

## Round 1 — 2026-08-16

- **Reviewer:** Codex gpt-5.6-sol, model_reasoning_effort=xhigh, read-only
  sandbox, fresh non-interactive session, blind to the other family's review.
- **Revision under review (v0.1):** sha256
  `c402362b6fd1b2dfd22d719db24be806536b7322f68514e2d392b5d7c27d2363`
  (authoring-worktree bytes, pre-commit).
- **Verdict:** NOT READY.


1. SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:69 (§1.2 Scanned rows) — The “currently has only” inventory is false. `src/storage.rs:5743-5750` defines per-execution `RelationalExecutionObservation` counters for examined root entries and joined lookups, which `src/local.rs:31473-31485` enforces against per-node ceilings. `src/vector/query.rs:66-83` and `src/vector/sqlite.rs:245-253` also return per-query logical-work counters with vector output. These are not identical to the proposed physical `scannedRows`, but they are existing measurement/capture seams that the RFC must reconcile.

2. SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:51 (§1.1/§1.5 Evaluation time) — “Complete lock-held” cannot define timing for every finite execution. `src/local.rs:27222-27240` explicitly runs file-backed finite queries without the global mutex. Those queries already start and finish a per-invocation `FUNCTION_QUERY` span (`src/local.rs:27329-27378`), whose `duration_ms` is emitted by `src/telemetry.rs:803-875`; the served invocation ring also records `function_id` plus `duration_ms` (`src/server.rs:26210-26216`). The RFC omits these shipped per-query timing seams and does not decide how their boundaries relate to the new qualification-grade sample.

3. SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:227 (§3.2 Require an index) — The index rung requires knowing how many entries “that consultation” visited, but §1.2 defines only invocation-total `scannedRows`, while §1.3’s ledger records consultation shapes and counts without scanned-row attribution. An opaque handler can perform several indexed and full-scan reads, including repeats, so the policy cannot determine which full scan crossed 256. A per-consultation work counter or an explicit conservative aggregation rule is missing.

4. SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:241 (§3.3 Require pagination) — The pagination rung depends on returned row count, but `QueryCostObservationV1` defines only the five charter signals and contains no `resultRows`; the function maxima in §2.1 likewise contain no unpaged-result row bound or capture rule. Consequently the warnings at line 215 and refusal on `maxUnpagedRows` cannot be evaluated by the specified observation/policy system.

5. SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:338 (§5 LLP 0209 G0 bounds and guardrails are one system) — The mapping does not actually unify enforcement. LLP 0209 §2 (`llp/0209-live-graph-profile.spec.md:120-123`) requires distinct root, examined-entry, relationship, fanout, argument, byte, summed-window, and maintained-write bounds. The RFC only says these “contribute” to aggregate fields, without a normalization invariant or precedence rule when structural and aggregate maxima disagree. In particular, `summed-window` spans multiple page executions while the observation at line 42 is per execution; no cumulative cursor/ledger or static derivation is specified. One container named `queryCost` therefore still permits two contradictory bounding systems.

6. SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:275 (§3.4/§4 Refusal contract) — The proposed post-drift refusal is neither terminal nor detail-preserving on the existing live channel. `src/live_wire.rs:127-149` defines `ResyncRequired` with only a free-form `reason` string and says recovery is identical for every reason. The shipped client immediately performs fresh snapshot-with-subscribe (`packages/snapback-client/index.mjs:13225-13246`, `13708-13765`; the micro client does likewise at `packages/snapback-client/micro-live.mjs:177-180`). The RFC retires only the subscription, without invalidating qualification or quarantining its function/plan, so re-registration can repeat the expensive turn. The envelope also cannot carry the signal/limit/detail shape whose exact parity §4.3 requires.

7. SEVERITY: MINOR — llp/0267-query-cost-guardrails.rfc.md:324 (§4.3 One evaluator on local and server) — LLP 0209 §8 does not require a pure shared `QueryCostPolicyV1`. It specifies one IR evaluated by two evaluators and identical graph refusals (`llp/0209-live-graph-profile.spec.md:374-397`). A shared pure policy is a reasonable new LLP 0267 decision, but it is misattributed as an existing LLP 0209 requirement.

8. SEVERITY: MINOR — llp/0267-query-cost-guardrails.rfc.md:303 (§4.1 Stable diagnostic register) — The declared detail shape includes `functionId` and `planIdentity`, then immediately forbids “identities”; §1.1 similarly keys observations by plan/data identities while saying identities are omitted. The prohibition must be scoped explicitly to principal/session/row identities so implementations agree on the public diagnostic schema.
## Round 2 (delta) — 2026-08-16

- **Reviewer:** fresh Codex gpt-5.6-sol xhigh read-only session; delta review
  of v0.2 (sha256 `bf7607970ba94a1b2fbe0ddda2eb5a21a8607b2f4ba7d5bd6004e76e3b2f0943`)
  against both round-1 reviews.
- **Verdict:** NOT READY (2 residual, 2 new findings in the fix delta).


NOT-FIXED:

- SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:566 — Round‑1 A5/B5 remains unresolved for the G0 argument bound. `StructuralWorkV1` records only aggregate `argumentItems` and per-node expansion, while line 584 requires checking every collection argument against its own `maxItems`. `QueryCostPolicyV1`’s inputs at lines 532–535 exclude canonical arguments. Thus `a=6,b=4` and `a=4,b=6` can produce the same aggregate while only one violates `a.maxItems=5`; the specified policy cannot distinguish them. Add per-argument cardinality facts or an explicit equivalent policy input and check.

- SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:472 — Round‑1 A6 is fixed only on the non-overflow path. The proposed terminal is an ordinary durable envelope, but `src/ephemeral.rs:2905–2915` converts a capacity failure into the `resync_required` overflow sentinel defined at `src/ephemeral.rs:2507–2518`. The full client then fresh-subscribes (`packages/snapback-client/index.mjs:13225–13246`) and retries any resulting quarantine refusal (`:13766–13789`). Without terminal-priority/sticky custody or a rule making the quarantine refusal terminal to that recovery path, typed details can be lost and the resubscribe loop can recur.

NEW:

- SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:472 — `query_cost_terminal` is a new required-action envelope kind, but the RFC specifies no connection/subscribe capability offer or wire-version gate. Implemented LLP 0093 lines 343–350 requires every new envelope kind to be offer-gated. Existing clients are intentionally unknown-kind tolerant; the micro client explicitly ignores it at `packages/snapback-client/micro-live.mjs:177`. Sending it to “every subscription” can therefore retire the server subscription while an older client silently retains stale rows and never surfaces the error.

- SEVERITY: MATERIAL — llp/0267-query-cost-guardrails.rfc.md:474 — The quarantine identity contradicts the qualification identity. Section 1.1 lines 46–48 keys qualification by fixture/data identity, authority class, and execution kind in addition to generation/plan/target; §3.4 calls the smaller `(functionId, functionGeneration, planIdentity, targetProfile)` tuple the “exact” qualification and says one successful requalification of that key clears it. No rollup from qualification cells to that four-field key is defined, so implementations can disagree whether one passing authority/fixture cell clears quarantine caused by another slow cell.
## Round 3 (delta) — 2026-08-16

- **Reviewer:** fresh Codex gpt-5.6-sol xhigh read-only session; delta review
  of v0.3 (sha256 `9dd28cd5baf8a4c4b93e2bbcf0572f7159310630fd70a3becef5cf31ef71341e`)
  against the round-2 findings.
- **Verdict:** NOT READY (one residual: the mixed-bundle timing seam).


NOT-FIXED:

- SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:224-235` — Round‑2 B1 remains incomplete for mixed-bundle executions. `src/local.rs:15082-15117` executes every mixed child directly via `execute_query_invocation`, then live children pass the resulting invocation through `subscribe_live_prepared_from_pinned_bundle` (`:15143-15167`). Inside the named establishment function, that invocation takes the `pinned_bundle_invocation` branch at `:15903-15904`, bypassing the `FUNCTION_QUERY` span at `:15908-15948`; finite mixed children likewise have no per-child span. Because §1.1 requires every finite execution and live establishment to produce `evaluationTurnMs`, implementations must either reject mixed bundles as missing evidence or invent an unbound timing boundary. Bind these shipped paths to an exact per-child seam or explicitly exclude them.
## Round 4 (surgical-fix verification) — 2026-08-16

- **Reviewer:** fresh Codex gpt-5.6-sol xhigh read-only session; verification
  of v0.4 (sha256 `6c0f5cebcd4990bd98b8209c8b6a195fd391c3bfd3fd4ff1b2ebef9aa26cec67`)
  scoped to the round-3 residual.
- **Verdict:** READY.


No findings. Digest verified. §1.5 defines the exact per-child seam, propagation through pinned registration, and incomplete-evidence refusal until it lands; §§3.4 and 6 remain coherent with production admission and the independent offer gate. No new defect was introduced.