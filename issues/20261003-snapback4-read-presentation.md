# Snapback 4: Read presentation from the existing existence contract

Status: Open — Draft proposal, awaiting Charlie's ruling
Date: 2026-10-03
Scope: Research/design; no product implementation authorized by this ticket
Proposal: [A, LLP 3000.032 §4.1](../llp/3000.032-client-contract-builder-costs.research.md#41-a--presentation-from-the-existing-read-contract)
Evidence: [ledger](../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (A1/A2); 13/14 primary Astra builds cite this cost.

First trial the complete screen recipe. If packaging a helper, verify nonempty incomplete, empty continuation, pending insertion, stale empty and denied reads.

Expected builder-code reduction: 0–1 compressed line for the search predicates; potentially 3 profile-latch lines; no app-wide extrapolation.

Correctness obligations: Reuse existence and metadata; never turn loading/partial into absence or infer mutation authority. Preserve hard withdrawal and independent stale/revalidating meanings. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 2–4 days (recipe only 0.5–1), including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.
