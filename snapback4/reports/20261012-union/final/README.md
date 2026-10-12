# UNION revision 12 final qualification — 2026-10-12

Commit d5e7da77d4 narrows UNION to full, non-expiring audiences. Fresh round 11
GPT is READY; Muse is READY WITH CHANGES with only two Low diagnostics.
Commit 493a9a8807 adopts both minor repairs and their regressions. The reviewed
admission and delivery semantics are unchanged. Verbatim review provenance is
under llp/reviews; revision-11 round-10 Muse READY and the provider-interrupted
GPT reproduction are separate historical evidence, not the latest pair.

[Ordinary final campaign report](narrow-run/report.json): seed 0, 100,000
compiled cases, eight workers, 5,028,923 executions, 472.698 s, zero
disagreements / generator errors / unexpected refusals. LANG2's refused-
commutation oracle omits meter comparison explicitly in 8,743 applicable
cases, retaining success-cost comparisons. This campaign ran on narrowed
runtime source; subsequent changes are diagnostic text, regressions and
review dispositions only.

[Quality summary](quality-summary.json) records the affected green targets,
27 simulator tests (two deeper opt-in ignored), client 209 pass / eight
platform/legacy skips, regenerated census, strict wasm and docs/ref checks.
The wasm is 679,240 B gzip within the unchanged 680,529 B cap (789 B less
than the previous integrated artifact). Every qualification Cargo invocation
used the required no-incremental/no-debug environment. Round-10 reviewer
attempts created isolated build targets with their own defaults; those
completed temporary artifacts were removed, and round 11 used static review.

All original logs are compressed verbatim in logs/. Earlier guide/runner and
initial narrowed-fixture reds are retained with the successful repaired
runs, not counted green. run/report.json is the clean pre-narrowing rerun;
narrow-run/report.json is the final clean narrowed campaign. Historical
Lean C2/W4 reds remain in earlier evidence and were not rerun or resolved.
No full scripts/test.sh, publication, push or outbound merge was performed.
