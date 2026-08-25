# All Aboard shows blocking boot chrome instead of an honestly-labeled board when the backend is unreachable

**Status:** Closed
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

## Resolution (2026-08-25)

The browser client turns a bare blocked-fetch failure into the structured
`SNAPBACK_CLIENT_REFUSED` diagnostic. All Aboard passed that diagnostic through
its render-first `connect` hook, whose contract treats diagnostic-bearing
errors as terminal build defects. The bundled schedule board still rendered,
but the terminal `ready` rejection also called `showBootError`, producing the
blocking chrome over the honest offline surface.

The Contract surface now unwraps only `SNAPBACK_CLIENT_REFUSED` failures from
the health/ensure preflight into an ordinary retryable error. The render-first
loop therefore retains the default board, projects backend status as offline,
and keeps retrying; specific Contract diagnostics still reject loudly. The
browser check now includes the boot-chrome text in its failure, so a recurrence
is immediately attributable. `scripts/cold-clone-check.sh` now prints the
machine-readable report section before failing, and carries a fail-only report
probe so that behavior can be checked without the full cold-clone sequence.

Fail-first evidence: with Exact required and the lane's shared prebuilt runtime
selected explicitly, `node demos/all-aboard/tests/acceptance/browser.mjs`
failed exactly `33/34`; the sole error was `blocking boot chrome shown instead
of the board: Boot failed: SNAPBACK_CLIENT_REFUSED: Failed to fetch`. After the
fix, the same command passed `34/34`, including `stationName: Mountain View`, a
numeric scheduled departure, `badge: SCHEDULE`, and
`note: Offline — showing scheduled departures` for the unreachable-backend
open. A targeted injected failure exited 1 and printed both the
`--- machine-readable report ---` marker and its JSON report.

F-3 cold-clone witness record: the 2026-08-20 witness's registry-package
production build **PASSED** and its browser acceptance scored **33/34**, with
this behavior as the only failure. Per the lane brief, the expensive full
cold-clone sequence was not rerun here; the repaired local browser witness is
**34/34** and the failure-reporting branch has separate injected evidence.
