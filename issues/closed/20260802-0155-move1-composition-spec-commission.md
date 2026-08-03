# Commission tracker: the LLP 0155 Move-1 composition-algebra Spec

**Status:** Closed — ACCEPTED 2026-08-03 and landed on main in merge
`5db186e06122744f130b63dd7727d6e6589f196a`. Charlie explicitly directed
"accept and promote" after the review loop converged. The
commissioned Spec is **LLP 0157**
(`llp/0157-composition-algebra-and-completeness.spec.md`, v0.7 Accepted).
It owns the node algebra, plan and materialization identity, completeness
witness, capability classification, sugar rule, inspection model, Move-2
store seam, and—now accepted—the shared `sbbc1`/`sbsb1` cursor-family
registry and `sbsb1` grammar. LLP 0110 retains bounded-child body semantics
and LLP 0135 retains snapshot-batch execution semantics; LLP 0157 now owns the
shared cursor registry and exact `sbsb1` grammar. Its landing releases the
held wave1-0135 snapshot-batch implementation without registering or
advertising the capability ahead of its executable gates.

The LLP 0005 super-refine record is complete:

- Codex Rounds 1–4: NOT READY; every BLOCKING and MATERIAL finding applied.
- Claude Rounds 1–2: NOT READY; every BLOCKING and MATERIAL finding applied.
- Codex Round 5 focused confirmation: READY, confidence 0.97, no findings.
- Claude Round 3 focused confirmation: READY, high confidence, two NITs;
  both applied in v0.6.

The actual responses and provenance are preserved in
`llp/reviews/0157-composition-algebra-and-completeness.{codex,claude}.md`.
No review accepted the Spec; Charlie did. The six acceptance-gated boundary
notes are now present. The landing commit is recorded above and this ticket's
exit is met.
**Systems:** Relational queries, API, Codegen
**Related:** LLP 0155 (Accepted v0.4 — its acceptance commissioned this
Spec; Move 1 recast as LLP 0120 option-3a bounded-node composition), LLP
0080 (the boundary note 0155 OQ1 recommends), LLP 0090 (versioned mixed-route
successor, sequenced after acceptance), LLP 0120, LLP 0135 (snapshot-batch —
same option-3a family, shared cursor grammar), LLP 0110

The 0155 acceptance (fc19d8ed) commissioned the owning Spec for Move 1's
composable query graph but nothing tracks it. This ticket is that tracker.

What the Spec must own (from 0155 §Move 1 as revised at acceptance):
bounded-node composition per LLP 0120 option 3a; the completeness model
(unknown/complete/prefix/refused — prefix reserved, never inferred from an
implementation cap); the plan-hash identity shared by codegen, admission,
live matching, result contracts, client materialization, and inspection;
capability classification (delta/replace/retained/online-only); the closed
refusal reason; the dated LLP 0080 boundary note (0155 OQ1's recommended
shape: successor Spec, not an 0080 amendment). Aggregates stay out —
deferred to LLP 0130 SD-2's evidence branch.

Consumers unblocked by acceptance: 0155 Stage 1 (the flagship), the
snapshot-batch half of the wave1-0135 ticket, and LLP 0090's versioned
mixed-route successor. G-02 is
closed and records the generated-result-type owner boundary; it is not a
parallel waiting implementation. The register-cliff ticket may consume path
(b) later.

Process: next available LLP number at authoring time; llp-create + the
LLP 0005 review loop scaled to its cross-subsystem stakes; acceptance is
Charlie's.

**Exit:** the Spec exists on main with a review loop concluded and its
number recorded here; this ticket closes pointing at it.
