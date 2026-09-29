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
and its FIXTURE.md. Do not mutate PF’s retained fixture.

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
