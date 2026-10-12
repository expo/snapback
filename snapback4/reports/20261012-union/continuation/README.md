# UNION coordinator continuation — 2026-10-12

Round 8 (revision 8): both READY WITH CHANGES. Final round 9 retry (revision
10): GPT NOT READY / Muse READY. The provider-interrupted GPT attempt had no
verdict; initial Muse READY evidence and the incomplete provenance remain
under llp/reviews. Revision 11 fixes the remaining High with a regression
that fails on revision 10; the latest implementation and integration repair
remain unreviewed under the exhausted paired-round allowance. No promotion,
push or merge into sb4-loop was made.

Incoming base merge `5c6e7b39e1` includes current sb4-loop `9e345842af`: OPS,
LANG2, referential actions, owner-or-X pages and W8C. Integration repair
`7f76133984` preserves certified per-arm scans for UNION sources.

[Verbatim ordinary campaign report](run/report.json): seed 0, 100,000 cases,
eight workers, 5,028,923 executions, 533.551 s, all sources compiled, zero
disagreements / generator errors / unexpected refusals. The LANG2 refused
commutation oracle fix is covered by its fixed-seed regression. The campaign
snapshot is the integrated merge; the subsequent planner guard affects only
synced-union sources, which the ordinary generator does not emit (its sync
forms are explicit public/single-column; TwoParty widening forces Online).
Affected simulator, planner and device suites qualify that guard separately.

Final check results and compressed logs are recorded in quality-summary.json
and logs/. Historic reds remain in the parent report. Lean was not rerun in
this continuation; the prior 100,000-case C2/W4 findings remain open.
