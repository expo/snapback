# Snapback 4: Generate a receipt family client binding and visible-seen hook

Status: Open — Draft proposal, awaiting Charlie's ruling
Date: 2026-10-03
Scope: Research/design; no product implementation authorized by this ticket
Proposal: [R, LLP 3000.032 §4.3](../llp/3000.032-client-contract-builder-costs.research.md#43-r--bind-receipt-families-once-package-visible-seen-reporting)
Evidence: [ledger](../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (R1–R4); 13/14 primary Astra builds cite this cost.

No background history paging. Test provisional messages, multi-screen visibility, replay, failed admission, member removal/rejoin and retained content with denied decorations.

Expected builder-code reduction: Replace the 37-line adapted G47 hook with 4–6 call/binding lines (31–33 saved); retain the real schema mapping and independent content/decorations queries.

Correctness obligations: Actual published confirmed positions justify delivery; seen requires app-supplied visibility. Preserve join floors, removed-member semantics, metered gaps and independent retained/current authority. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 4–7 days (recipe/diagram 1–2), including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.
