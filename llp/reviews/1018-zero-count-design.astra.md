# LLP 1018 zero-count design review — Astra

**Reviewer:** gpt-6-astra, xhigh, fresh Codex CLI session
**Date:** 2026-09-07
**Session:** 01a07dcc-ee94-7270-b18f-4d86f13ffdfb
**Scope:** Preliminary lookup substitution against main and architecture candidate c9803c828; read-only design inspection, no tests.
**Redacted:** No

## Author disposition

Accepted the material objection and discarded the substitution. The replacement
preserves the group lookup and separately probes canonical primary ID only on
an eligible public Count group miss. Certificate work, closure bytes and index
dependencies cover that probe. Existing byId-only public absence filtering is
unchanged. Cold reopen supports cap prediction; scalar zero completeness stays
conservative without full-group coverage. This is not a final patch approval. The later actual public-client experiment
still refused prediction: maintained insertion additionally checks unique group
absence. The two-address proof is therefore required for prediction itself,
not only scalar-zero completeness. The incomplete runtime patch was removed;
no primary-probe optimization from this experiment is delivered.

## Actual review

**Material objections: the proposed pre-lookup substitution is not sound under current invariants.**

1. **Maintained targets are not guaranteed to contain only canonical-ID rows.** Successors explicitly preserve rows outside the predecessor/successor projection IDs. This is documented in [LLP 1001](/Users/ccheever/projects/snapback-worktrees/clique-successor-widening-uniqueness/llp/1001-query-engine.spec.md:525) and implemented in [rebuild_target](/Users/ccheever/projects/snapback-worktrees/clique-successor-widening-uniqueness/snapback2/crates/snapback2-core/src/successor.rs:641).

   Concrete counterexample: a public target contains `{id: "legacy", group: Id("g"), value: 7}`, with no source rows for `g`. That row can survive adding the maintain, including with a unique grouping index. The existing grouping-key `Get` returns 7; canonical `byId('[{"Id":"g"}]')` misses and returns zero. Public readability and grouping uniqueness do not establish address equivalence. The same obstruction exists in `c9803c828`.

2. **Changing only the runners violates certification.** [Checker::read](/Users/ccheever/projects/snapback-worktrees/clique-successor-widening-uniqueness/snapback2/crates/snapback2-core/src/certificate.rs:1035) certifies the authored index; [assert_bounds](/Users/ccheever/projects/snapback-worktrees/clique-successor-widening-uniqueness/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:1140) requires the traced index to match exactly. A rewritten `byId` point fails containment. Any additional or substituted physical read needs matching certification and resource accounting.

The narrow safe direction is to **preserve the grouping lookup and obtain canonical absence through a real, separately certified `byId` probe**. Restrict that acquisition to the actual target read rule being structurally `Public`/`Allow`; `maintain.readable`, viewer-specific permission, and scan hoisting are insufficient substitutes. Preserve original key validation and verify the destination really is the intrinsic `byId` index.

For cold scalar-zero completeness, carry genuine full-group coverage separately—potentially through existing certified uniform-range receipts and the corresponding twin coverage check. **A canonical `byId` absence alone cannot prove grouping-key absence** while noncanonical survivors remain legal. Even rewriting only misses would incorrectly let an unrelated direct `byId` receipt establish group coverage.

The proposed identity encoding itself is appropriate: native `canonical_json(&full_typed_key)` and TS `canonicalValues(fullTypedKey)`. Preserve nominal tags and explicit optional `Null`; `canonicalValue({Array: key})` adds a different wrapper. No wire-hash change or alternate-key absence-filter widening is needed.

Required controls:

- A surviving ordinary-ID target row, plus a canonical-looking ID whose stored grouping fields differ; preserve grouping results and live dependencies.
- Real public acquisition → cold reopen → complete zero → prediction → reconnect, alongside nonzero, unheld-count, repeated-allocation, and atomic cap-overflow cases.
- Bare `byId` absence with an unheld noncanonical group row must not establish group completeness.
- Protected/deny hidden-hit versus missing responses remain indistinguishable; `readable <- allow` must not override a denied target read rule.
- Optional omission/null, nominal tags, composite ordered keys, permutations, shorter/extended indexes, ordinary tables, malformed keys, and missing/misdeclared `byId`.
- Certificate containment, live `0 → 1 → 0` and group moves, stale replay, and generation/authority fences.

This is a design-level objection, not a final-patch review. Read-only inspection only; no edits, builds, or tests.