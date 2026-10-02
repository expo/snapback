# Snapback 4: Make screen-owned subscription lifetimes explicit

Status: Open — Draft proposal, awaiting Charlie's ruling
Date: 2026-10-03
Scope: Research/design; no product implementation authorized by this ticket
Proposal: [L, LLP 3000.032 §4.5](../llp/3000.032-client-contract-builder-costs.research.md#45-l--explicit-active-subscriptions-and-stable-screen-ownership)
Evidence: [ledger](../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (L1–L3); 11/14 primary Astra builds cite this cost.

Pilot child-component unmounting first, then decide if active/inactive hook typing adds value. Test Strict Mode, late responses, inactive account changes, expiry, denial and page-boundary edits.

Expected builder-code reduction: Two compressed key/observer lines / 484 B plus one foreground cleanup line / 370 B; savings overlap R/A and are not additive.

Correctness obligations: No protected result cache; inactive observations expose no old data. Bound identity-only lists, preserve current authorization, expiry, generation/account reset, cursor ownership and active sibling watches. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 3–5 days hook (recipe only 1–2), including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.
