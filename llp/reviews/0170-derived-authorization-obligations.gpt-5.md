# LLP 0170 review — gpt-5 family

**Target:** `llp/0170-derived-authorization-obligations.rfc.md`
**Reviewed revision:** `2eed016afda9b34ede4f3ecc5631e6ba1a0420f1`
**Capsule sha256:** `b77ed4910c7973d9…`
**Runner:** codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only
**Independence:** BLIND — did not author this document.
**Topology:** independent loop (not lockstep)

---

## Round 1 — 2026-08-04

1. **[MATERIAL] §2 “Discharged” — the proposed discharge witnesses are not authorization proofs.** `authScopeField` explicitly does not inject or prove an ownership filter; it is a live-query disjointness assertion. A leaking JS query could therefore declare `authScopeField` and pass. Likewise, an argument-addressed membership predicate proves membership in the argument resource but does not prove returned rows are bound to that resource. Proposed fix: discharge direct ownership only from a structural `owner == authUserId()` predicate or a host-injected equivalent. Discharge membership only from a per-row semi-join, or from a membership argument plus a proved equality binding the queried resource to that argument. Opaque JS must use a generated enforcement wrapper or an explicit waiver. Add adversarial acceptance cases for both false witnesses.

2. **[MATERIAL] Motivation, §2, and Open Questions 1–3 — codegen lacks the result provenance required by the universal rule.** `reads` is a dependency set, not a statement that rows from every listed table are returned. JS result contracts do not identify their source table, and auxiliary authorization reads, projections, aggregates, history, and branches make that distinction load-bearing. The chess evidence supports one keyed game read, not the claim that the existing manifest contains “precisely” enough information for every operation. Proposed fix: scope v1 explicitly to analyzable single-table HostPlan Query/LiveQuery shapes, failing or waiving other shapes, or first add a result-provenance contract and decide the open projection/history rules.

3. **[MATERIAL] §3 and Open Question 4 — `writtenBy` cannot be enforced as designed.** Current JS mutation `writes` and `EffectCeilingV1` identify tables, not columns; opaque-handler ceilings are author-declared rather than statically proved. Codegen therefore cannot know whether a JS handler patches `rating`. It also cannot prove `writtenBy: 'system'`: today cron/job targets commonly remain public client-invocable operations because no internal-only operation class exists. Treating such a target as “system” would create a fail-open path. Proposed fix: split this feature out until there is field-granular static/runtime effect enforcement and a non-client-invocable operation class, or limit it honestly to closed HostPlan mutations and named-operation provenance without claiming system-only enforcement.

4. **[MATERIAL] §5 versus Acceptance 5 — the final default-deny contract contradicts itself.** The Design says omission defaults to `authenticated`; the migration and Acceptance say omission eventually fails generation. Those are different APIs. The document also does not say whether an explicitly declared `optional-user` remains valid. Proposed fix: choose one contract. The cleaner fit for “declare it or be refused” is: every sessions-mode operation must explicitly declare `public`, `optional-user`, or `authenticated`; warn for one release, then reject omission. If authenticated defaulting is intended instead, Acceptance 5 must verify emitted authenticated authority rather than failure.

5. **[MATERIAL] §4 and Acceptance 6 — “unexplained widening” has no defined machine semantics.** The RFC does not define the baseline, widening partial order, or acknowledgement mechanism. Changes such as authenticated→public, narrower→broader roles, owner→public, or adding a read table are different widenings, and the proposed operation waiver does not authorize all of them. Deterministic output alone cannot decide whether a reviewed change is unexplained. Proposed fix: either limit this RFC to emitting the deterministic artifact through the existing codegen review-manifest system, or specify a versioned baseline/comparator and scoped acknowledgement format before claiming CI rejection.

6. **[MATERIAL] Whole RFC — this is several independently releasable security mechanisms under one acceptance gate.** Derived read obligations, column write provenance, sessions auth defaults, and authorization-diff policy use different facts and have different compatibility and runtime prerequisites. In particular, write provenance depends on the unresolved internal-only question but is presented as supporting the read rule. Proposed fix: keep this RFC narrowly about analyzable read obligations and their reporting artifact; move column provenance, the sessions default migration, and widening-policy CI into separate documents. This also keeps the conclusion proportional to the single comparative build.

7. **[DETAIL] Acceptance 2 — “byte-identically” is not a stable assertion as written.** Adding ownership metadata and the new authorization artifact necessarily changes generated bytes. Proposed fix: name the exact runtime-plan or implementation-hash projection expected to remain identical, or require semantic equivalence instead.

What is good: the evidence boundary is unusually candid; the `optional-user` observation is confirmed by current code; and distinguishing build-time obligation derivation from runtime enforcement is valuable. Loud waivers, deterministic review output, actionable diagnostics, and preserving LLP 0056/0100 as the actual membership authority are all strong constraints worth retaining.

Process note: the `llp-review` workflow normally records this under `llp/reviews/`, but the workspace was read-only, so no artifact was written.

NOT READY
