# LAT1 production latency evidence

The 2026-10-27 matched 54-schema experiment meets all requested latency targets.
Both binaries use the same stratified Integration 28 sample, four paired workers,
fresh source/JSONL fixture copies, alternating binary order and same-project warm
repeats. The host is shared. No phase telemetry was enabled for these timings.
There were no tool or input mismatches. These completed artifacts predate the
18:56Z host OOM and their digests were rechecked afterward.

| Command | 0.4.44 median / p90 s | LAT1 median / p90 s |
| --- | ---: | ---: |
| check cold | 8.451 / 21.221 | 2.489 / 5.655 |
| check warm | 6.027 / 16.272 | 2.398 / 4.939 |
| staging cold | 9.241 / 24.385 | 2.583 / 5.584 |
| staging warm | 1.451 / 2.652 | 0.077 / 0.138 |
| check --review | 8.354 / 23.822 | 2.546 / 5.604 |
| production deploy | 12.164 / 25.335 | 3.232 / 7.779 |

Every review and production pair is faster, not just their aggregate quantiles.
`latency-summary.json` retains exact values; `latency-provenance.json` binds both
binaries, keys, tool digest and worker count. `production-binary.json` identifies
the final static ELF; later commits contain only review/verification/evidence
changes. No version was bumped or package published.

The supplemental matched 54-schema window also qualifies warm review/production
non-regression (`warm-nonregression.json`). All 54 individual pairs are faster
for each cold and warm mode, with zero tool/input failures.

| Warm command | 0.4.44 median / p90 s | LAT1 median / p90 s |
| --- | ---: | ---: |
| check --review | 5.847 / 16.315 | 2.377 / 4.786 |
| production deploy | 1.403 / 4.187 | 0.075 / 0.171 |

`consumer-proofs.json` records the actual packed security and staging proofs;
the complete packed-security test file also passed all three tests with its
existing guards against that frozen production binary. `profiles.json` records
a bounded, instrumented before/after diagnostic on wave20/017; nested phases
overlap and those timings do not qualify the targets.

Full-corpus identity is independently qualified in `identity-summary.json`:
940 schemas, 5,640 pairs / 11,280 invocations, zero input or tool failures.
5,610 pairs match literally. The other 30 differ only by source-reviewed host
upload IDs: valid ULIDs with identical logical timestamps and bijective aliases
through complete counterexample/witness graphs. All verdicts, gates, question and
witness IDs, other values, callers, histories and array order match. Two fresh
runs of the unchanged sequential control reproduce the permitted drift in each
of the 18 differing schemas. The original literal comparator still exits 1;
it has no payload scrubbing or weakened assertion. `identity-provenance.json`
records the exact source scopes, capture/review/tool hashes and two existing
warm-staging administrative response shapes. The fresh final review is retained
under `llp/reviews/3000.036.004.000.000-lat1-identity-final.*`.

The final affected receipt is recorded in the worktree-root
`WORKSTREAM-REPORT.md`; no identity claim derives from timing evidence.
Raw captures and frozen historical guard/replay/audit tools live in
`~/sb4-loop/reports/lat1/`. The OOM-interrupted `identity940-lazy` run is discarded
as qualification and is never resumed; its replacement is `identity940-capped4`.

The explicit brief forbids the selector's conservative shared-input complete
closure. `affected-scoped.mjs` retains that original plan, runs the complete core
crate, all CLI unit tests, language library/guide/security targets, Postgres test
compilation and packed consumer, plus applicable supporting checks. It declares
`canonicalComplete:false`. Run long work inside a user scope with
`MemoryMax=40G` and `OOMPolicy=continue`, cargo jobs 16, at most four survey
workers and no more than two heavy jobs concurrently. Set
`LAT1_PUBLICATION_BINARY` to the digest-pinned production CLI for the packed step.
