# Scope and governing context

Scope: local read authority, remembered/recovered server answers, detached handles,
app approvals, publication, and social starter flow costs. Read both full round-4
reviews and rounds 0–4 prompts/reports before implementation. Main is merged first.

Governing LLPs (all in current/, none in the Snapback 4 foundation overlay):
- LLP 3000 §4: independent Snapback 4 workspaces and checks.
- LLP 2000.000 §7.2–7.4: partition authorization, horizons, honest offline limits.
- LLP 3000.023 §10: retention/withdrawal, detached reuse, bounded queue work;
  §11: main's bounded settled one-shot queries, preserved by the merge.
- LLP 3000.019 §3.3: final app approval and expiry cannot restore retired answers.
- LLP 3000.018 §3.2: server cut/ticket order in the single remembered-answer store.
- LLP 3000.001 repair-B: committed invalidation precedes fallible post-commit work.

Active constraints: smallest conservative rule, no new recovery cache or watermark
registry; eight starts/eight active and bounded overtaking; immediate hard
withdrawals, exact audience matching where certified; one-shot ready/denied
settlement; 1,500 source lines and client guide budgets; preserve both merge sides.
Authorization cannot be inferred from an empty device partition footprint.

Rationale: LLP 3000.023 §10/§11 and the two actual Astra counterexamples require
one irreversible authority boundary for both detached reuse and pending results.
The empty-footprint fallback tradeoff follows LLP 2000.000 §7.4.

Risks: conservative pending retries and loss of opportunistic offline server
memory; merged wasm exceeds main's cap and needs an explicit measured ratchet.
Update existing LLP 3000.023 and client reference. No new design document needed.
Hand-off: none. Qualification and the final audit are scoped to this lane.
