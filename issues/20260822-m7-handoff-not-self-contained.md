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
