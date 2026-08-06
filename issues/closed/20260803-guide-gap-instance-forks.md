# Guide gap: operating local instance forks

**Opened:** 2026-08-03
**Closed:** 2026-08-05
**Kind:** guide-gap
**Owner:** Charlie
**Source:** LLP 0158 F1; Diary 0054

## Gap

The F0b source surface began with `snapback fork create`, `list`, `diff`,
`drop`, and deterministic TTL `reap`, but the intent-indexed guide had no page
for the fork-per-worktree workflow. The first fleet consumer had to read LLP
0158 and CLI help to learn source selection, finite TTL, ready-file use, secret
opt-in, inert workers, deny-all egress, asset refusal, and the diff receipt's
omissions.

## Close when

- `guide/operating/` has a local-only, partial-maturity instance-fork page with
  an exact runnable example and explicit nonclaims;
- `guide/capabilities.md` has an honest GAP row while the capability remains
  unpublished, and gains a shipped witness only after the governing corpus
  permits advertisement;
- the acceptance harness has an opt-in fork-instead-of-seed path for suites
  that need realistic parent state; and
- `node scripts/check-guide.mjs` passes.

## Resolution — 2026-08-05

The local-only partial-maturity guide and the opt-in Todo acceptance harness
landed in the Phase-1/2a guide slice. LLP 0185 Phase 1 then extended the page
for automatic expiry enforcement, bounded inspection and scalar projections,
publication recovery, and actionable diagnostics. The capability row remains
target `none` and maturity `partial`, with the remaining publication and
governance gaps explicit. The guide manifest and checks pass, so all closure
conditions are met without advertising a shipped capability.

