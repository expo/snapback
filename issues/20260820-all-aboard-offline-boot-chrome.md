# All Aboard shows blocking boot chrome instead of an honestly-labeled board when the backend is unreachable

**Status:** Open
**Filed:** 2026-08-20
**Systems:** All Aboard surface, Client boot, Offline behavior
**Related:** LLP 0283 F-3, `scripts/cold-clone-check.sh`

## Finding

The LLP 0283 F-3 cold-clone witness now runs end to end. Step 1 — the production build from
published registry packages — **passes**. The 34-check browser acceptance scores **33/34**,
failing exactly one check:

```text
✗ backend unreachable: the open still shows a schedule board, honestly labeled
    blocking boot chrome shown instead of the board
```

So with the backend unreachable, the surface renders blocking boot chrome rather than the
schedule board with an honest offline label. The check exists because showing a usable,
clearly-labeled board beats a boot spinner when the backend is down.

## Why this took so long to see

Earlier runs reported only `browser acceptance exited 1`. The acceptance log is written to a
temp path and the control-plane run discarded it, so the failure looked opaque and possibly
environmental. Running the lane directly on a fleet host with Chrome — outside the agent
sandbox, which was filesystem read-only and could not even initialize submodules — and
preserving the referenced log produced the exact failing check.

This is worth fixing in the harness independently: **`cold-clone-check.sh` should surface the
acceptance report on failure**, not just the path to a temp file that may not survive.

## Acceptance

- With the backend unreachable, the open renders the schedule board with an honest
  unreachable/offline label, and the check passes 34/34.
- `scripts/cold-clone-check.sh` prints or copies the machine-readable acceptance report on
  failure so the diagnosis does not depend on a surviving temp file.
- Recorded against LLP 0283 F-3 as the cold-clone witness result: build from registry
  packages PASSES; browser acceptance is one behavior short.
