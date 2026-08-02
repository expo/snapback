# Commission tracker: the LLP 0155 Move-1 composition-algebra Spec

**Status:** Open — DRAFTED 2026-08-02: the commissioned Spec exists as
**LLP 0157** (`llp/0157-composition-algebra-and-completeness.spec.md`,
v0.1 Draft) with the dated LLP 0080 boundary note landed in the same
change. Key structural choice: LLP 0135 Part 2 already specifies the
option-3a execution substrate (cursor grammar `sbsb1`, one-snapshot,
seal-entirely, dedup), so 0157 adopts it verbatim and owns the layers
above — node algebra, plan identity, completeness witness,
classification, sugar rule, inspection model, Move-2 store interface.
This also un-waits the wave1-0135 snapshot-batch half (cursor grammar
was 0135's all along). Remaining for this ticket: the LLP 0005
dual-family review loop, then Charlie's acceptance (SD-4 applies if the
loop converges in-scope).
**Systems:** Relational queries, API, Codegen
**Related:** LLP 0155 (Accepted v0.4 — its acceptance commissioned this
Spec; Move 1 recast as LLP 0120 option-3a bounded-node composition), LLP
0080 (the boundary note 0155 OQ1 recommends), LLP 0120, LLP 0135
(snapshot-batch — same option-3a family, shared cursor grammar), LLP 0110

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

Consumers waiting on it: 0155 Stage 1 (the flagship), the snapshot-batch
half of the wave1-0135 ticket (shared cursor grammar — whoever lands first
pins it), G-02's generated result types, and possibly the register-cliff
ticket's path (b).

Process: next available LLP number at authoring time; llp-create + the
LLP 0005 review loop scaled to its cross-subsystem stakes; acceptance is
Charlie's.

**Exit:** the Spec exists on main with a review loop concluded and its
number recorded here; this ticket closes pointing at it.
