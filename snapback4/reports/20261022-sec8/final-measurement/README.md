# SEC8 final wave24 measurement

Code: `7d86b4af03` (r11). All39 finding variants and450 untouched corpus
projects completed using private immutable copies of the production binary.
The binary digest matches the final packed-security test's installed native pack:
`fd62f32d5894624e80e508e564a859863caa50c623cad78586b6c48b1cab9a2b`.
Original evidence sources were read-only. Temporary schema/binary copies clean up
automatically. Source-file hashes and raw bounded campaign output are retained.

Relevant default questions appear for12/13 findings both without invariants and
with the app's original invariants. One independent specification line yields
9 exact-site fixture-replay catches and2 upload review gates (007F2,036F1).
The two-lifecycle-column finding016 has no new specific advisory class; its
independent intent is caught by replay. No claim of universal application safety
or empty-start reachability follows from these generated-fixture histories.

| Finding | Relevant default question (none/own) | Own test exit | Spec check/test exits | Spec gates | Exact added-invariant witnesses |
| --- | --- | ---: | --- | ---: | ---: |
| 007-specF2 | N_OPTIONAL_EVIDENCE | 0 | 1/1 | 1 | 128 |
| 008-specF1 | N_CHILD_EVIDENCE_PRESENCE | 0 | 0/1 | 0 | 112 |
| 011-specF1 | N_APPROVAL_NOT_ENFORCED | 0 | 0/1 | 0 | 12 |
| 013-specF1 | N_STALE_CREATION_CHECK | 0 | 0/0 | 0 | 0 |
| 015-specF1 | N_TIME_TRANSITION | 0 | 0/0 | 0 | 0 |
| 015-specF2 | N_GUARD_NOT_CONSUMED | 0 | 0/1 | 0 | 8 |
| 016-specF1 | none; independent intent required | 0 | 0/1 | 0 | 18 |
| 029-specF1 | N_EDIT_AFTER_APPROVAL | 0 | 0/1 | 0 | 6 |
| 031-specF1 | N_DEPENDENT_WINDOW | 0 | 0/0 | 0 | 0 |
| 033-specF1 | N_CHILD_EVIDENCE_PRESENCE | 1 | 0/1 | 0 | 0 |
| 036-specF1 | N_OPTIONAL_EVIDENCE | 0 | 1/1 | 1 | 32 |
| 036-specF2 | N_EDIT_AFTER_APPROVAL | 0 | 0/1 | 0 | 1 |
| 048-specF1 | N_CALENDAR_DURATION | 0 | 0/1 | 0 | 25 |

Four added predicates remain explicitly incompletely evaluated:013F1(clock),
015F1(clock),031F1(cross-row ordered comparison),033F1(read-through children).
033's own/spec test exit1 reports another invariant; it is not counted as an
added evidence-presence catch. Each unsupported target/site and its reasons are
visible in default test output. `incomplete` preserves exit0 absent an actual
failure/refutation; unavailable evaluation is never turned into policy false.
This is a deliberate reporting decision, not a claim those assertions passed.

The450-project corpus has36 inherited `N_RETAINED_ROLE_GRANT` review gates on15
projects, zero upload gates, zero added/removed gates and unchanged retained-grant
messages versus SEC7's own-invariant baseline. With zero introduced gates, zero
new false gates were introduced. This run does not independently re-certify all
450 product specifications or call every inherited review gate a confirmed hole.

`spec-lines.tsv` preserves the exact intent inputs.029 uses the verified column
update intent from bakeoff§2.2 rather than the weaker aggregate alternative in
the original TSV. `summary.json` separates questions, gates, process exits and
exact invariant-site witnesses; exit1 on another predicate cannot count as a catch.
The immutable binary metadata and complete compressed structured results are in
`corpus/` and `matrix/`; individual campaign traces are compressed alongside them.
