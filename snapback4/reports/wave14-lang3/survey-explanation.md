# Hundred-schema survey — LANG3

Both isolated runs pass **100/100** source files; notes fall **371 → 357**.
The inputs are exactly each wave14 `apps/*/snapback/schema.q`, copied to private
temporary applications. The evidence apps were never changed. The analysis's
99/100 app result also included other app sources/toolchain context; this is
the requested schema-file survey. Baseline compiler: 4ef9f77fb3; after compiler:
dfaff7904b semantic content (final binary hash in artifact-hashes.json).

`survey-before.json` and `survey-after.json` contain the complete JSON answers.
`survey-changes.json` is a multiset difference of complete note objects, so two
notes at one site are not accidentally collapsed. No refusal appears or
changes. Every note delta is accounted for below.

| Lane / line | Changed diagnostic | Reason |
| --- | --- | --- |
| 004 / 125 | N_NEVER_COMPLETE rewrite | Checked optional `cap 100 by listing`; preserves owner, landlord and finalist applicant branches and query. Explicit product choice and existing-data requirement. |
| 007 / 135 | N_NEVER_COMPLETE rewrite | Checked optional `cap 50 by deadline`; original matter/staff audience remains. |
| 012 / 93, 106 | Remove N_CONDITIONAL_COMPLETE and N_NEVER_COMPLETE | Held readable staff/observation points plus surviving observer/teacher branches prove the exact scan audience. No copied-field invariant is assumed. |
| 019 / 76 | Remove N_CONDITIONAL_COMPLETE | Captured readable leader row and surviving club test prove the exact club-pinned audience. |
| 042 / 143 | One N_CONDITIONAL_COMPLETE rewrite | Optional checked `cap 50 by trip` keeps every group/subset/member/organizer branch. Two notes remain at the query site; this changes only one recipe. |
| 049 / 117 | Remove N_UNREADABLE_PROBE | The prior clerk guard proves readability of releaseQueue, including its mixed positional/named spelling. |
| 049 / 125 | Remove N_LOOKUP_HIDDEN | This is a blind mutable vehicle update, not a program read. Execution proves such an update can succeed on a hidden row under its write rule; warning that it returns NOT_FOUND was false. |
| 049 / 127 | Remove N_REFERENCE_UNCHECKED | An exact update of vehicles[vehicle] attempts the target lookup before storing its id. This is consistent with the note's existing nullable-read contract, not an existence proof. |
| 052 / 124 | Remove N_IMMUTABLE_PATCH | allocations.meeting comes from the pinned immutable parent's stable meeting field; runtime equality remains enforced. |
| 059 / 138 | Remove N_IMMUTABLE_PATCH | scores.conference is the same intentional immutable-parent equality guard. |
| 059 / 101 | N_NEVER_COMPLETE rewrite | Optional checked `cap 50 by poster`; retains judge, organizer and released presenter branches. |
| 062 / 151 | Remove N_IMMUTABLE_PATCH | reserves.auction derives from the pinned immutable parent. |
| 070 / 90 | N_NEVER_COMPLETE rewrite | Optional checked `cap 50 by photo`; retains author, owner and accepted-public branches. |
| 077 / 71 | N_NEVER_COMPLETE rewrite | Optional checked `cap 50 by candidate`; keeps staff and candidate branches, including paired evaluation existence tests. |
| 090 / 155, 230 | Remove N_LOOKUP_HIDDEN at writes | assignTech is blind; setVisitDuration's owner-role guard proves the actual read gate readable. |
| 090 / 165 → 159 | Move/reword N_LOOKUP_HIDDEN | recordVisit's required visits lookup runs before its owner/technician guard. The note now names that real read gate and its NOT_FOUND code, rather than claiming its later update is a read. |
| 090 / 175 → 170 | Move/reword N_LOOKUP_HIDDEN | requestReschedule's required visits lookup runs before the client guard. Keep the intentional reader-only gate, or authorize the intended readers; no automatic audience broadening. |
| 090 / 184 → 179; 190 → 188 | Move/reword two N_LOOKUP_HIDDEN | confirmReschedule/cancelVisit assert the visits point before requiring the owner role. Warnings now attach to those actual gates, where read visibility is not proved beforehand. |
| 091 / 100 | Remove N_UNREADABLE_PROBE | The proven ranger roster survives unrelated post/photo operations; no ranger dependency is written. |
| 095 / 145 | Remove N_IMMUTABLE_PATCH | weights.litter derives from the pinned immutable parent. |
| 097 / 130 | Remove N_IMMUTABLE_PATCH | feedback.owner derives from the pinned immutable parent. |

Default CLI query/pin names, cursor grouping, immutable-note review category,
cascade detail placement and reserved-word text are presentation changes;
JSON notes keep their individual subjects. Targeted CLI/source tests cover
these independently. The already-repaired farm sources do not reproduce the
old enum, mixed-key, sync or fresh-clock errors; dedicated reproductions do,
including the actual pre-wave P18 fixture.
