# Snapback 4 Stage R: cold-key admission can sustain a deadline/void spiral

Status: Open
Date: 2026-10-29
Scope: opt-in restored R0 with parallel preparation (Spike R SPR8 `6c0fe17c6e` and later, incl. SPR9 `9ada6771e6`); Postgres; production slices R1–R5 of LLP 3000.009.001.000.000.003

Starting a fresh service over the full S1 image and sending W4/A 3,805/s to
32 distinct, mostly cold counters collapses R: about 18 ms serialized
cold-fact loads under the owner push admission past the 100 ms invocation
deadline; parallel preparation has already allocated the sequence and
footprint holds, so each late rejection needs a durable void, and void/head/
retention work under the same owner keeps admission late. One run: 195 ACKs,
5,214 voids, 75,971 measured errors, p99 1.29 s, ≈18 KB WAL and 37 syncs per
ACK; G6 off fails the same way. Priming every key through the mutation API
first removes the collapse. Older R0 `ad1bfc1839` checked the deadline before
allocating and did not show it.

Acceptance: cold admission and recovery from overload must not create a
self-sustaining late-reservation loop. Reject before irreversible reservation
where the protocol permits, or bound and drain the cost, preserving dense
reservations, durable void arbitration, prefix-ordered ACKs and deadlines.
Add a product cold-key/overload-recovery witness (G5 and G6, parallel
preparation) that reaches healthy throughput without an external primer. A
benchmark primer is not the repair.

Evidence: `snapback4/experiments/scale-controls/results-20261028-s1-r9-competitive/README.md`
Part 1 (diagnostics, statistics and the ticket draft); the collapsed run is
`results-20261027-s1-r8-authoritative`.
