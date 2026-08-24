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
   labeled** — blocking boot chrome is shown instead of the honestly-labeled
   schedule board when the backend is down.

Both are product regressions in the all-aboard surface, consistent with the
open all-aboard battery-red family. The witness machinery itself is healthy;
these two checks are the residue.

## Handling

Fix in the all-aboard surface (startup path and offline-open path), then
rerun `scripts/cold-clone-check.sh` for the 34/34 record LLP 0283 F-3 wants.
