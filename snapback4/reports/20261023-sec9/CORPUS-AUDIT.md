# SEC9 corpus gate audit

The final fixed corpus is 450 projects: wave15 has100; waves16,18–23 have50 each.
All inputs were copied from read-only evidence lanes into temporary projects;
no app evidence, schema, store or policy disposition was changed in place.
`measurement.json` records the immutable executable digest and input hashes.

## Counts and interpretation

There are32 gated projects/58 sites:15 projects/36 retained-role grant sites
already governed by SEC8, plus17 projects/22 new creation/edit sites (21 public,
one private). Production refuses36 projects:the32 pending-gate projects and
four additional projects whose authored read invariants are contradicted by
actual replay (`repairs.read` and `signups.read`, waves18/19 lanes025/045).
Other production errors:zero. These are review requirements and actual authored
contract failures, not36 confirmed exploitable holes.

The17 new projects were audited against their current operations, generated
notes and available application specifications (wave15 retains comments rather
than the later lane-spec file). Each has a real creation/edit audience difference.
Intentional creation differences require the matching `update only` declaration;
they are not automatically accepted by this workstream. Applying the21 unique
lines below to isolated copies clears all22 sites. This is a gate-disposition
experiment, not author acceptance of those policy choices. No false new gates
remain in this audited corpus. SEC8's15 retained-role gate projects remain
pending on the same basis as its incoming report.

False shapes removed during development:attributed-creator substitution,
unrelated reflexive unchanged-field guards (without folding unknown live
references), default-only and immutable creation candidates. An approval/edit
campaign originally refused funeral-director apps that atomically invalidate
approval when editing. Derived policy now checks whether approval survives the
actual pair of images; those two false refusals disappeared. Explicit `immutable`
still freezes from the preimage and does not permit thaw-and-edit atomically.

## Explicit-disposition experiment

| Project | Proposed deliberate creation/edit declaration(s) | Remaining new gates |
|---|---|---|
| w15-016-day2-waste-accumulation-clock | `invariant containers.hazard update only exists people[viewer, role = 'ehs']` | 0 |
| w18-047-snapback-hyperbaric-chamber-log | `invariant staff.role update only exists staff[viewer, role = 'physician']` | 0 |
| w18-048-snapback-repair-cafe-intake | `invariant roster.role update only exists hostSeats[viewer]` | 0 |
| w19-002-snapback-venison-processing-tags | `invariant carcasses.intakeTagRef update only exists roles[viewer, role = 'clerk']`<br>`invariant carcasses.tagNumber update only exists roles[viewer, role = 'clerk']` | 0 |
| w19-029-snapback-coin-grading-submissions | `invariant coins.insuranceTier update only exists roles[viewer, role = 'officer']` | 0 |
| w19-047-snapback-hyperbaric-chamber-log | `invariant staff.role update only exists staff[viewer, role = 'physician']` | 0 |
| w19-048-snapback-repair-cafe-intake | `invariant roster.role update only exists hostSeats[viewer]` | 0 |
| w21-001-snapback-luthier-crack-repairs | `invariant estimates.appraisal update only exists roles[viewer, role = 'shopOwner']` | 0 |
| w21-026-snapback-bookbinding-restoration-jobs | `invariant books.conditionOnArrival update only exists roles[viewer, role = 'head_conservator']`<br>`invariant books.damage update only exists roles[viewer, role = 'head_conservator']` | 0 |
| w21-042-snapback-english-class-placement | `invariant tests.writing update only exists roles[viewer, role = 'coordinator']` | 0 |
| w23-001-snapback-stained-glass-restorations | `invariant panels.quoteBand update only exists roles[viewer, role = 'director']` | 0 |
| w23-005-snapback-tool-library-loans | `invariant loans.inspectionFocus update only exists roles[viewer, role = 'coordinator']` | 0 |
| w23-017-snapback-pawn-loan-tickets | `invariant tickets.loanSize update only exists roles[viewer, role = 'manager']` | 0 |
| w23-022-snapback-court-interpreter-bookings | `invariant bookings.minutes update only exists roles[viewer, role = 'coordinator']`<br>`invariant bookings.plannedInterpretingDuration update only exists roles[viewer, role = 'coordinator']` | 0 |
| w23-031-snapback-wedding-cake-orders | `invariant orders.inspiration update only exists roles[viewer, role = 'owner']` | 0 |
| w23-041-snapback-swim-school-assessments | `invariant billing.enrollmentType update only exists roles[viewer, role = 'frontDesk']`<br>`invariant billing.feeCents update only exists roles[viewer, role = 'frontDesk']` | 0 |
| w23-042-snapback-mobile-notary-signings | `invariant signings.agencyBillingNotes update only (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'owner']) and exists roles[viewer, role = 'owner'] and allow and allow` | 0 |

Wave25 separately has50 projects, three gates (015,017,045) and five production
refusals (those three plus authored `roles.read` contradictions in006/033).
The predicted four creation/edit lanes become three gates after removing the
false shape; deliberately different creation policies clear with one matching
line per guarded column.

## Cost and limits

Final corpus reported security-preflight latency:median2782ms,p9510135ms,max10201ms;
wave25:median5337.5ms,p9510140ms,max10160ms. These are the CLI’s `security deploy campaign` timings, including analysis,
replay, source revalidation and review dispositions. They measure the added
security preflight, rather than the entire deploy invocation or a paired
baseline-subtracted benchmark.
The production campaign has10s and8192-work bounds; larger apps often reach the
time bound and print remaining coverage. Zero false observed refusals under
current authored contracts does not establish exhaustive application security.
Final R9 bounded semantics are unchanged by R10's unbounded-test-only checkpoint
retention. Final finding replay uses R10; see `final-evidence/`.
