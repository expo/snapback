# Make M7 benchmark handoffs relocatable

**Status:** Open
**Opened:** 2026-08-22
**Systems:** Benchmark handoff export, Social-messenger replay
**Related:** LLP 0201; LLP 0277;
`benchmarks/runs/2026-08-22-clique-full-familiar-vs-explicit/record.md`

## Problem

The explicit M7 fresh session's first reseed failed because the exported
handoff replay scripts resolved fixtures relative to the original builder lane
root (`ENOENT .../handoff/instrument/fixtures/...`). The session recovered only
after rewriting both bases to the supplied `instrument/` symlink.

## Impact

A day-2 handoff is not independently runnable after relocation, so its fresh
session spends a correction loop reconstructing environment knowledge that the
handoff should carry.

## Required change

Have exported replay scripts resolve fixtures through an explicit instrument
root in the handoff, with no dependency on the original lane directory.

## Acceptance

- Copy a handoff to a new directory with the declared instrument link.
- Run both replay/reseed entrypoints without path edits.
- No path in the exported handoff points back to the builder lane root.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — reusable handoff qualification. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The original failure concerns exported replay scripts resolving fixtures through the builder directory. Successful individual fresh-session M7 attempts do not prove the generic exported handoff relocates without edits.

The 0.0.21 run README records successful M7/day-two sessions, but not the exact two-entrypoint relocation control requested here. Next: copy a completed handoff to an owned new directory, resolve the explicitly supplied frozen instrument, and run both replay/reseed entrypoints without source edits. Preserve the original app/store and instrument.
