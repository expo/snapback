# Snapback 4: prediction miss wording after lane QX (review Lows)

**Status:** Open
**Opened:** 2026-09-30
**Area:** prediction diagnostics (`write_miss`), `why/E_NOT_PREDICTABLE.md`

Grok's round-1 review of lane QX (`~/sb4-intent/reviews/qx-r1g.grok.md` on
eb1000) was READY with two Lows:

1. `write_miss` rewrites the missing-fact text to "the write target is not
   held on this device" even when the row is local and only the destination
   constraint population is uncovered. Device `admit` drops that
   `Prediction` message and clears only `predictable` and `predicted`, so
   the queue does not show it, but any surface that prints it would mislead.
   Name the uncovered population instead.
2. `why/E_NOT_PREDICTABLE.md` says `check --verbose` prints
   `predicts: conditional updates`; that header is printed by
   `check --residency` and `why`. Plain `check` says that insert arms may
   queue. Correct the command named.
