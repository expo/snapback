# guide-gap: defineTable(...).history() has zero guide coverage and no capability row

**Opened:** 2026-08-08 · **Severity:** P3 (documentation)

`defineTable(...).history({ retainMs, maxVersionsPerRecord })` — bounded
record history (LLP 0162 §6, landed in 919a0a470 "Implement bounded history
and promotion proof tail") — appears nowhere in the guide and has no
capability-index row.

Evidence: packages/snapback-codegen/define.mjs:1079-1097; typed fixture
packages/snapback-codegen/history-authoring-types.fixture.ts. Grep for
`history(`/`maxVersionsPerRecord` across guide/ returns nothing;
capabilities.md has no history row.

Ask: a guide section (backend) plus a capability row — or an explicit GAP
row if the surface is publication-gated. Check the published-closure fence
(guide/conventions.md) for a `since:`/unreleased banner when landing.

Found by the 2026-08-08 comprehensive docs review (backend slice).
