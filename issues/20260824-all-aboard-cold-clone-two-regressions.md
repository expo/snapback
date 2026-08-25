# Cold-clone witness: two reproducible all-aboard acceptance regressions (32/34)

**Status:** Open
**Systems:** Demos, Contract surface, Verification
**Date:** 2026-08-24
**Related:** LLP 0283 (F-3), `scripts/cold-clone-check.sh`, ENG-23727,
battery tickets `20260824-battery-all-aboard-egress-*.md`

## Finding

`scripts/cold-clone-check.sh` (the F-3 cold-clone witness) now runs end to end
from clean registry installs — step 1 (root + surface `bun install
--frozen-lockfile`, production build through `@exact/devtools/contract-web`)
passes — and the 34-check browser acceptance fails 32/34 with the same two
checks on two runs (one under heavy machine load, one quiet):

1. **startup: board paints before the backend attaches; no boot ceremony
   (ENG-23727)** — first useful paint ~2.8s after HTML response against the
   2200ms budget (entry-body diagnostic 540ms; scriptStart ~3.1s). Not a load
   artifact; reproduced on an idle machine.
2. **backend unreachable: the open still shows a schedule board, honestly
   labeled** — **repaired locally** by `1ddb98597` plus the transport-provenance
   adapter follow-up in this commit. The focused browser witness is now 34/34:
   an unreachable backend retains the scheduled board and honest Offline label
   without boot chrome.

The first-paint budget regression remains open. The witness machinery itself
is healthy, but the full cold-clone sequence has not been rerun after the local
offline repair.

## Handling

Fix the remaining first-paint regression, then rerun
`scripts/cold-clone-check.sh` for the complete 34/34 record LLP 0283 F-3 wants.
The cheap report-probe branch now has an inventoried automated test covering
both marker/JSON forwarding and the missing-marker diagnostic.
