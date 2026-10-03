# Snapback 4: Make screen-owned subscription lifetimes explicit

Status: Closed — implemented bounded recipe; active hook not justified by pilot
Date: 2026-10-03
Scope: Implemented under Charlie’s 2026-10-02 ruling and the Lane L recipe-first commission
Proposal: [L, LLP 3000.032 §4.5](../../llp/3000.032-client-contract-builder-costs.research.md#45-l--explicit-active-subscriptions-and-stable-screen-ownership)
Evidence: [ledger](../../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (L1–L3); 11/14 primary Astra builds cite this cost.

Pilot child-component unmounting first, then decide if active/inactive hook typing adds value. Test Strict Mode, late responses, inactive account changes, expiry, denial and page-boundary edits.

Expected builder-code reduction: Two compressed key/observer lines / 484 B plus one foreground cleanup line / 370 B; savings overlap R/A and are not additive.

Correctness obligations: No protected result cache; inactive observations expose no old data. Bound identity-only lists, preserve current authorization, expiry, generation/account reset, cursor ownership and active sibling watches. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 3–5 days hook (recipe only 1–2), including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.

Resolution (2026-10-03): the installed social starter now ships a complete
bounded route-owned alternative and a tested root lifetime marker. Cal29 L1–L3
are rewritten and measured; the recipe releases hidden observations and resets
owners under all scoped boundaries without an SDK active option. Code grows;
the measured improvement is capped point ownership (200 → 20 in the moving-page
specimen), not LOC. See the [report](../../snapback4/reports/20261003-l-screen-lifetimes/REPORT.md)
and [LLP 3000.023 §13](../../llp/3000.023-answers-stay-on-screen.rfc.md#13).
