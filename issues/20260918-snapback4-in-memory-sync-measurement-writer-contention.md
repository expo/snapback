# Snapback 4: in-memory sync recovery measurement still blocks writers

Status: Open
Date: 2026-09-18
Scope: `snapback4/`, `dev --fresh` and in-memory HTTP test hosts

Second blind-review fix round on `sb4/mc-prereq-51b7a134`: file-backed
metadata measurement now uses an independent, identity-checked read transaction.
The in-memory engine cannot open that reader and still holds the global engine
mutex. Early event counting stops current-image fetching at the first prefix
exceeding the unchanged 16 MiB ceiling, but historical-log reads/sorts and join
enumeration occur before that stop. It is not an end-to-end work or latency bound.

Reproduce with the debug binary:

```sh
SB4_CONTENTION=1 node --test --test-name-pattern='writer contention' snapback4/packages/snapback4/test/oversized-sync.test.mjs
```

Apple M5, five measurements per size, three concurrent tiny writers launched
5 ms after each measurement: at 48 / 192 rows of 400,000 bytes each, final
in-memory writer medians were 770 / 1703 ms (maximum 803 / 2135 ms).
File-backed medians were 6 / 15 ms (maximum 9 / 24 ms). Logs are recorded in
`snapback4/JOURNAL.md` under the second-round contention comparison.

Resolve by making the in-memory measurement independent of the global writer
window or by bounding the entire traversal, then repeat the same concurrent
writer measurement. Preserve one coherent identity/generation/head/content
snapshot, exact positive overflow evidence, indivisible commits, W13g coverage,
retained history, and existing ceilings, rules and disclosure boundaries.
