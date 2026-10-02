# Snapback 4: Present durable pending intents without predicted rows

Status: Open — Draft proposal, awaiting Charlie's ruling
Date: 2026-10-03
Scope: Research/design; no product implementation authorized by this ticket
Proposal: [B, LLP 3000.032 §4.2](../llp/3000.032-client-contract-builder-costs.research.md#42-b--show-a-durable-intent-without-inventing-a-row)
Evidence: [ledger](../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (B1–B3); 7/14 primary Astra builds cite this cost.

Cover text and media, nonprediction, predicted duplicates, failure, account switch and offline restart. Decide the terminal-to-observed interval using existing custody facts before exposing the API.

Expected builder-code reduction: Two compressed text-fallback lines / 280 B plus toggle projection 281 B; may save zero physical lines, roughly 100–250 B selection logic across examples.

Correctness obligations: One existing outbox; explicit write-ID versus row-ID mapping; no fabricated row, ordinal, receipt or media authority; no new resend loop. Preserve scope fences and unknown outcomes. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 5–8 days (list-only 2–3), including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.
