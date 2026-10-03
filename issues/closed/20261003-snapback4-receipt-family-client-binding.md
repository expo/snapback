# Snapback 4: Generate a receipt family client binding and visible-seen hook

Status: Resolved — Lane R implementation, 2026-10-03
Date: 2026-10-03
Scope: Client binding and seen lifetime; full implementation authorized by Charlie's 2026-10-02 ruling in the Lane R commission
Proposal: [R, LLP 3000.032 §4.3](../../llp/3000.032-client-contract-builder-costs.research.md#43-r--bind-receipt-families-once-package-visible-seen-reporting)
Evidence: [ledger](../../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (R1–R4); 13/14 primary Astra builds cite this cost.

No background history paging. Test provisional messages, multi-screen visibility, replay, failed admission, member removal/rejoin and retained content with denied decorations.

Expected builder-code reduction: Replace the 37-line adapted G47 hook with 4–6 call/binding lines (31–33 saved); retain the real schema mapping and independent content/decorations queries.

Correctness obligations: Actual published confirmed positions justify delivery; seen requires app-supplied visibility. Preserve join floors, removed-member semantics, metered gaps and independent retained/current authority. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 4–7 days (recipe/diagram 1–2), including scoped tests, docs and review repair; not measured implementation time.

Do nothing / document better remains an explicit option in the linked proposal. Acceptance starts with an author ruling and a concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.

## Resolution

Implemented generated `api.receiptFamilies` descriptors and `useSeen` under
[LLP 3000.022 §14.6](../../llp/3000.022-delivery-the-sdk-reports.rfc.md#14.6).
The hook shares monotonic visible progress, admission handling and membership
lifetimes; history and live decorations remain independent reads. The full
implementation ruling supersedes the original recipe-only option above.

The real G47 R3 specimen falls from 37 lines / 1,742 bytes to 6 / 366. Including
actual viewport integration, its two changed client files lose 22 lines / 602
bytes. Cal29 R4 stays at two lines (371 → 297 bytes); its full client grows four
lines / 381 bytes when missing visibility checks are supplied. No overall Cal29
size saving or score uplift is claimed.

[Lane report](../../snapback4/reports/20261003-r-receipt-binding/REPORT.md) records
the decided API, preserved before/after pilots, process/wasm regression checks,
full-suite outcomes and remaining limits. Nothing pushed or published.
