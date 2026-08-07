# main red: react-external client bundle grew 13 brotli bytes past the ratchet

**Status:** Closed — resolved 2026-08-07 by blessed rollover
**Systems:** Client integration, Testing, Packaging
**Date:** 2026-08-07
**Related:** LLP 0145, LLP 0189, `scripts/client-bundle-metrology.mjs`

`node scripts/client-bundle-metrology.mjs --check` (under the pinned Node
24.18.0) fails on current `main`:

    SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED: react-external brotliBytes
    regressed from 25034 to 25047 bytes

One of the day's client landings (suspect: `25e9674b0` "fix(client):
declarative mutations degrade to server dispatch without the outbox" — it
changes client dispatch code) grew the react-external profile by 13 brotli
bytes without metrology accompaniment. The blessed-rollover flow cannot
absorb it mechanically: `--write-rollover-baseline` requires exactly one
declared-but-unminted rollover ledger spec, and all declared rollovers
already exist. Absorbing the growth therefore needs the metrology owner to
either declare a new workload-version rollover spec for the causal change or
shrink the bytes back.

Until then, every push whose drift-gate selection fans out broad (any
shared-authority path: `AGENTS.md`, `llp/0175`, workflow files, …) refuses on
this gate. The LLP 0189 docs landing that found this red used the loud
`SNAPBACK_DRIFT_GATES_BYPASS=1` bypass, recorded here per D-1: the red is
owned fix-forward work, and the backstop will keep re-filing until resolved.

Close when `--check` is green under the pinned runtime on `main`, via a
declared+blessed rollover naming the causal landing or a byte reduction.

## Resolution — 2026-08-07

Absorbed by the declared 
rollover (workload ), covering
both react profiles for the three Charlie-directed diary-0066 defect fixes
(25e9674b0 dispatch degrade, 37af8f9aa bounded stream-reset retry,
16a0e140c omission semantics).  green under pinned node 24.18.0.
