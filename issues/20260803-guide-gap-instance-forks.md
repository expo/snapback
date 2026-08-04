# Guide gap: operating local instance forks

**Opened:** 2026-08-03
**Kind:** guide-gap
**Owner:** Charlie
**Source:** LLP 0158 F1; Diary 0054

## Gap

The F0b source surface has `snapback fork create`, `list`, `diff`, `drop`, and
deterministic TTL `reap`, but the intent-indexed guide has no page for the
fork-per-worktree workflow. The first fleet consumer had to read LLP 0158 and
CLI help to learn source selection, finite TTL, ready-file use, secret opt-in,
inert workers, deny-all egress, asset refusal, and the diff receipt's omissions.

## Close when

- `guide/operating/` has a local-only, partial-maturity instance-fork page with
  an exact runnable example and explicit nonclaims;
- `guide/capabilities.md` has an honest GAP row while the capability remains
  unpublished, and gains a shipped witness only after the governing corpus
  permits advertisement;
- the acceptance harness has an opt-in fork-instead-of-seed path for suites
  that need realistic parent state; and
- `node scripts/check-guide.mjs` passes.

## Progress — 2026-08-03

`guide/capabilities.md` now carries a target-`none`, non-advertising GAP row
that points at the source substrate and dated fleet evidence without treating
either as a publication witness. The operating page and fork-aware acceptance
harness remain open, so this ticket stays open.

This is LLP 0158 F1. It is intentionally not folded into F0b's implementation
landing and does not authorize an early capability claim.
