# OP context

Scope: `local-query.ts`, `local.ts`, `local-reads.ts`, observation publication.
Baseline: `ed327e5dc715bca1c3df098b794219c1e07ff028` (fresh origin/main).

Governing LLPs and active constraints:

- LLP 3000: Snapback 4 fence; own workspaces, budgets and append-only journal.
- LLP 3000.016 §2.2: local-first routing, original-argument fallback, static
  possible dependencies for unknown branches; predictions withhold external
  answers. §Own edge publication preserves unresolved Following input.
- LLP 3000.023 §10 (current): pending change cuts, immediate membership
  withdrawal, cancellation and publication ordering. Whole server answers can
  cover a reported cut; old local components cannot borrow that proof.
- LLP 3000.023 §12: preservation certificates affect bounded retention, not
  authorization to publish an obsolete evaluation.
- LLP 3000.028 §3.2 (current): retained routing is bound to a device evaluation
  transaction, including second observations; an ahead-cut server answer
  cannot erase history. §3.3 keeps mixed search's separate metered proof.
- LLP 3000.018 §3.2: remembered answers order by cut and attempt, with expiry
  barriers. LLP 3000.019 §3.3 (current): independent expiry and delivery checks.
- `guide reads`, `guide sync`: mounted ordinary reads, coverage/freshness and
  retained history are the public surface. No new app polling or sync API.

None of these Snapback 4 LLPs is linked in foundation. The listed current
links are in-flight living documents. No broken reference found in this scope.

Question to measure: which revision/checkpoint rejects each decoded matching
reply, and which evidence-free interval or cut finally permits publication?
Risk: accepting a newer server cut must not authorize an earlier local field,
prediction, unpublished scope loss, store replacement or expired answer.

Likely documentation update: LLP 3000.023 §10 publication rule; cross-reference
LLP 3000.028 §3.2 if retained routing needs clarification. Hand-off: none.
