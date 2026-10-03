# Snapback 4: Read presentation from the existing existence contract

Status: Closed — implemented and piloted in Lane A, 2026-10-03
Date: 2026-10-03
Scope: Implementation authorized by Charlie's 2026-10-02 commission for LLP 3000.032 §4
Proposal: [A, LLP 3000.032 §4.1](../../llp/3000.032-client-contract-builder-costs.research.md#41-a--presentation-from-the-existing-read-contract)
Evidence: [ledger](../../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (A1/A2); 13/14 primary Astra builds cite this cost.

First trial the complete screen recipe. If packaging a helper, verify nonempty incomplete, empty continuation, pending insertion, stale empty and denied reads.

Expected builder-code reduction: 0–1 compressed line for the search predicates; potentially 3 profile-latch lines; no app-wide extrapolation.

Correctness obligations: Reuse existence and metadata; never turn loading/partial into absence or infer mutation authority. Preserve hard withdrawal and independent stale/revalidating meanings. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 2–4 days (recipe only 0.5–1), including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.

Resolution: `readPresentation` and the complete keyed React/Expo screen are
implemented under LLP 3000.031 §7. A1/A2 pilots include recipe-only comparisons:
the helper saves 124/81 B at equivalent behavior, while the complete integrations
grow 667/688 B with added notices. The shell alone removes A2's latch. No
withdrawal change, alternate existence proof or permission flag. Evidence and
qualification: [Lane A report](../../snapback4/reports/20261003-a-read-presentation/REPORT.md).
