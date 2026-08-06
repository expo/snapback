# Local proof demo inventory omits Fleet Observatory Move 1

**Status:** Resolved 2026-08-06
**Date:** 2026-08-06
**Impact:** 5
**Urgency:** 5
**Ease:** 5
**Confidence:** 5
**Systems:** Local proof, Demo materialization, Release qualification
**Related:** `tests/demo_setup_v0.mjs`,
`demos/fleet-observatory-move1/demo.snapback.json`,
`issues/closed/20260803-first-npm-latest-promotion.md`

## Summary

The complete local proof is red at `demo-materialization` because
`discoverDemoSetups()` correctly discovers the metadata-declared
`demos/fleet-observatory-move1` demo, while the gate's exact expected inventory
in `tests/demo_setup_v0.mjs` omits that id.

This blocked the second 0.1.11 ten-package release attempt at clean candidate
`ea347f4122fe975902669849c6db6be5834bf967`. No package was staged or
published by the attempt.

## Reproduction

Under the repository-pinned Node 24.18.0:

```sh
volta run --node 24.18.0 -- scripts/verify-local-proof --complete
```

The proof selects all 134 canonical gates, passes 43, then fails:

```text
[snapback-verify] GATE demo-materialization
[snapback-verify] $ node tests/demo_setup_v0.mjs
AssertionError: Expected values to be strictly deep-equal
+   'fleet-observatory-move1',
[snapback-verify] FAIL demo-materialization
```

The directory carries `demo.snapback.json`, `snapback/schema.mjs`,
`snapback/functions.mjs`, a fixture, and a demo acceptance test. It is therefore
an ordinary metadata-declared demo under the discovery contract, not an
incidental directory that should silently disappear from the discovered set.

## Release consequence

This is a central local-proof gate and must not be fast-pathed. The release
attempt proved the repaired capability-maturity, agent-safe-publication,
client-bundle-metrology (56 profiles, no regressions), and hermetic Fleet
receipt gates before reaching this failure, but a prefix of a complete proof
is not a green candidate proof.

Publication remains blocked until the exact demo inventory is reconciled in a
landed commit and the complete proof passes on a fresh `origin/main` candidate.

## Expected repair

Add `fleet-observatory-move1` to the exact sorted expected inventory in
`tests/demo_setup_v0.mjs`, preserving the gate's protection against silent
demo additions/removals. Then run the focused test and the complete local
proof under Node 24.18.0.

## Acceptance

- `node tests/demo_setup_v0.mjs` admits the complete exact discovered set and
  provisions every metadata-declared demo through one reset.
- Removing or adding an unreviewed metadata-declared demo still fails the exact
  inventory assertion.
- `volta run --node 24.18.0 -- scripts/verify-local-proof --complete` is green
  on the successor release candidate before staging or npm mutation.


## Resolution

2026-08-06: `fleet-observatory-move1` registered in `tests/demo_setup_v0.mjs`'s
exact expected inventory (the landing that added the demo missed the
registration — same class as the recurring package-test-inventory misses).
Gate green: 24 metadata-declared demos provision through one reset.
