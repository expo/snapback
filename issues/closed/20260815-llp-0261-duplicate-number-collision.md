# Duplicate LLP number 0261: two concurrent documents claimed the same number

**Filed:** 2026-08-15 · **Source:** `./ref-check --verbose` during an
unrelated landing · **Systems:** LLP governance

## Problem

Two concurrent sessions claimed LLP 0261 within the same window:

- `llp/0261-runtime-performance-championship.spec.md` (landed via the
  championship-contract review loop, see `6538bc447`)
- `llp/0261-snapback-init-existing-app-composition.rfc.md`

`./ref-check --verbose` fails on main with:

```text
ERROR llp/0261-snapback-init-existing-app-composition.rfc.md: duplicate LLP
number 0261 (also llp/0261-runtime-performance-championship.spec.md)
```

CI runs the same check on pushes and pull requests, so every unrelated
landing now inherits this red.

## Suggested fix

Whichever document has fewer inbound references (check `@ref` annotations,
`Related:` lines, review artifacts, and issue links before choosing) should
renumber to the next free LLP number, updating all references in the same
change. The diary corpus solved the same class of collision with
`scripts/check-diary-identity.mjs`; the LLP corpus has no equivalent
new-collision guard, so consider extending ref-check's duplicate detection to
run in the authoring path (`llp-create` already assigns next-available, but
only sees numbers that have landed — two in-flight sessions can still race;
a pre-push duplicate check would catch the race at the first push instead of
after both land).

Owners of the two 0261 documents are the natural resolvers; this ticket
exists so the ref-check red on main has a pointer.

## Resolution — 2026-08-17 (backlog sweep)

The main-breaking duplicate was two concurrent documents claiming LLP 0261.
The championship contract was renumbered to LLP 0265
(`llp/0265-runtime-performance-championship.spec.md`); LLP 0261 now uniquely
names the `snapback init` RFC. The `./ref-check` duplicate-number red that
motivated this ticket is gone. A stronger in-flight numbering guard is
optional follow-up, not this defect.
