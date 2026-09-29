# Snapback 4 heavy acquisition still exceeds the round-0 targets

Status: Open
Date: 2026-09-29
Scope: Snapback 4; local follow-up from lane HV round 0

The measured u0001 account has 1,000 memberships, 90,500 messages and 105,034
rows. Five alternating browser pairs on eb1000 improve Worker acquisition from
25.60 to 19.52 s and wasm high-water from 769.06 to 307.69 MB, but still miss
the requested 8 s acquisition / 3 s apply / 2.5 s strict persistence / 1.5 s
server / 256 MB heap targets. u0500 improves to 2.08 s Worker.

Evidence and private-fixture reproduction:
[snapback4 HV report](../snapback4/reports/20260929-hv-heavy-acquisition/REPORT.md)
and [AQ fixture notes](../snapback4/reports/20260929-aq-fast-acquisition/FIXTURE.md). Do not mutate PF’s retained fixture.

Remaining work must preserve all rows, physical indexes, coverage and horizon
semantics, atomic publication, strict durability and local format-3 upgrade.
The round-0 implementation still builds 1,874,664 index entries, allocates about
3.36 GB cumulatively through apply, and exports a complete 214,009-change final
vector to JS. Worker medians are 8.47 s apply / 3.57 s persistence / 2.56 s
server production. Investigate remaining typed parse/key construction and the
word-posting representation, then payload transfer/structured cloning and live
unread certification. None is permission to certify stale counts, omit indexes,
relax durability or reduce the horizon. Measure both device modes and u0500 in
five alternating fresh contexts, including host load, before claiming a gain.

The shared native SQLite path was measured, not optimized by the web layout:
38.88 s apply and 96,000 KiB peak process RSS in the allocator-instrumented Rust
test profile. Qualify production native timing separately before promising it.

## HV round 1 (2026-09-29)

The author declined the round-0 wasm ratchet: **593,719 B gzip is fixed**.
Four source reductions plus a measured narrow Binaryen pass reach **602,389 B**,
still **8,670 B over**, with no dropped contract. The remaining cap deficit is
lane-owned and blocks publication qualification. The per-change ladder and
complete production byte inventory are in the
[round-1 report](../snapback4/reports/20260929-hv-heavy-acquisition/round1/REPORT.md).

Five fresh pairs retain heavy acquisition at 18.40 s default / 19.17 s Worker,
about 308 MB wasm high-water. u0500 is 1.895 / 2.099 s. Exclusive timers put
words at 18–19% of heavy apply, ordinary indexes at 21%, and remaining row
staging/decoding/publication at 60%; words cost only 3–4% on u0500.
LLP 3000.007 §20.4.1 proposes bounded background word construction for review,
with honest incomplete search, foreground key admission, atomic ordinary-index
publication and explicit restore/crash rules. It is not implemented. Even its
optimistic projection does not reach the 8 s heavy total; row/publication work
still needs finer attribution and a measured design. Any implementation must also fit the fixed cap, including its
scheduler/readiness machinery.
