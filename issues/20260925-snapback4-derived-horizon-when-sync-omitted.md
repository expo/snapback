# Snapback 4: a derived horizon when `sync` is omitted (from the shelved LLP 4000)

**Opened:** 2026-09-25. **Source:** LLP 4000 §13 (shelved), §4.1. **Area:** Quarry residency, the binder, the device acquisition policy.

## What

Today a table with no `sync` line is online-only, and a synced table states its horizon (`sync last 500 by …`). LLP 4000's surviving idea was that the horizon can be derived from the program's declared queries instead of authored: the first page of every cursor-only query as a warm set, plus one step of depth (the first page of every query whose only non-cursor argument is a table reference held by a warm-page row), under a stated device budget, printed by `check` as the derived residency so it is never silent.

## Proposal for Snapback 4

Behind a program-level flag (`residency derived`, or an author-omitted `sync` on a table whose read rule is invertible and which some query reads), derive the horizon as above and print it in `check`. Keep the partition log, admission, `complete`, prediction and the leave policy exactly as they are; the only change is what a device first acquires and what `sync` a builder has to write. Measure on the calibration series: if the builder's notes stop naming `sync`/horizons and nothing else moves, the flag becomes the default.

## Why here and not in a sibling

Nine blind reviews of LLP 4000 established that this change does not need a different runtime (its delivery is the same stream); it is an acquisition policy and a compiler printout. That is Snapback 4 work.

## Acceptance

- `check` prints `offline: inbox last 50 by joinedAt → history last 50 each; warm: …` for the committed Clique target with its `sync` lines removed.
- The simulator's invariants hold with the derived horizon, including a differential check that every complete device page equals the server's evaluation at the device's watermark (LLP 4000 §8).
- A calibration on a release carrying the flag, with the builder's notes classified by LLP 4000 §9.1's rubric.
