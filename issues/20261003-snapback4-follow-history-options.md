# Snapback 4: Decide older follow history semantics without selecting an option

Status: Open — Draft proposal, awaiting Charlie's ruling
Date: 2026-10-03
Scope: Research/design; no product implementation authorized by this ticket
Proposal: [F, LLP 3000.032 §4.4](../llp/3000.032-client-contract-builder-costs.research.md#44-f--older-follow-history-options-no-selection)
Evidence: [ledger](../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (F1/F2); 2/14 primary Astra builds cite this cost.

Charlie selects among fixed 1,000, frozen all-history enumeration, on-demand older paging and a planned current-membership read. Compare skew, continuous backdated births, refollow, removal and crash recovery; do not change the cap in this ticket without a ruled design.

Expected builder-code reduction: Zero demonstrated workaround LOC. Six declaration/query lines already accept the window; benefit is a capability, not code deletion.

Correctness obligations: Fixed enumeration domain, fair task turns, truthful page completeness, explicit existing-follow upgrade, bounded meters and stated storage cost. Preserve event identity, edge epochs, tombstones, floors and publication fences. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 0.5–25 days documentation/design depending on option; implementation separately estimated in LLP, including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.
