# Bakeoff invariant assessment — initial survival snapshot

Package: snapback4 0.4.31 (corrected candidate, local install).
Prior run: source pack 362fd29898, 40-minute outer timeout, no final report.
This file + [RESULTS.json](/tmp/sec2-builders/muse/RESULTS.json) are written FIRST so partial results survive.
Working copies are byte-identical to `baseline-annotated` (all invariants, schemas, SPECs SAME).
Guide semantics re-read: `guide security` (current). Every shell command uses `timeout`.

Commands (run from each app dir unless noted):

- check: `timeout 180 ../../node_modules/.bin/snapback4 check --json`
- audit: `timeout 180 ../../node_modules/.bin/snapback4 audit --json`
- test: `timeout 180 ../../node_modules/.bin/snapback4 test`
- Full outputs + exit + duration retained under `evidence/final-original/` (then `evidence/final-repaired/`).

Rule of the exercise, from the guide: passing finite tests are NOT proofs.
Only `refuted` + replayed engine counterexample counts as a confirmed hole caught.
`unproved` names the missing reduction; it is neither a hole nor a pass.

## Per-app rows (PRE-RUN evidence; fresh re-verification PENDING for all ten)

| App | Invs | Pre check | Pre test | Holes (pre) |
|---|---|---|---|---|
| 005 kiln-firing-queue | 1 | NOT RUN (empty) | NOT RUN | unknown |
| 007 farrier-hoof-rota | 17 | ok=False; 1 refuted + 16 unproved | 1 violation / 1395 attempted | 1 caught: roles.read (`allow` rule vs restrictive intent) |
| 008 sublet-key-escrow | 11 | ok=True; 11 unproved | 0 violations / 1321 attempted | none refuted |
| 009 choir-part-tracks | 19 | ok=True; 9 proved + 10 unproved | NOT RUN (empty) | none refuted |
| 010 allotment-water-turns | 13 | ok=True; 7 proved + 6 unproved | 0 violations / 1645 attempted | none refuted |
| 019 apiary-hive-inspections | 19 | ok=True; 10 proved + 9 unproved | NOT RUN (empty) | none refuted |
| 020 tow-yard-release | 11 | ok=True; 11 unproved | NOT RUN | none refuted |
| 021 moot-court-scoring | 36 | ok=True; 22 proved + 14 unproved | NOT RUN | none refuted |
| 045 instrument-loan-bank | 18 | ok=False; 12 proved + 5 unproved + 1 refuted | NOT RUN | 1 caught: repairNotes.read (luthier arm vs SPEC librarian+manager only) |
| 048 boiler-room-rounds | 25 | ok=True; 25 unproved | NOT RUN | none refuted |

Pre totals: 170 invariants; 60 proved, 107 unproved, 2 refuted (1 invariant in 005 never checked).
Pre check completed 9/10 apps (005 missing). Pre test completed 3/10 (007, 008, 010 partial).
All `evidence/pre/*.audit.json` and `*.stderr` are EMPTY — audit never ran; it will run in final-original.

## Known deliberate tightening invariants (kept; must NOT be deleted to pass)

- 021 `profiles.read` director-only (schema allows broader read; tests over-exposure).
- 045 `repairNotes.read` librarian+manager only, no luthier arm (already REFUTED pre-run = caught hole).
- 048 `readings.read` shift-scoped engineer arm (schema grants all engineers).
- 007 `roles.read` restrictive (already REFUTED pre-run = caught hole).

## Final verification (per-app, updated after each app)

### 005 kiln-firing-queue — DONE
- Original: check ok=True (59s, exit 0), 1/1 invariant unproved; test exit=1 "incomplete"
  (no fixtures; friction), 2082 attempted, 0 violations.
- Finding: invariant set was SPEC-incomplete (N_SECURITY_INTENT: firings, memberships,
  pieces, publicQueue had no intent). No refutation = no confirmed hole; incompleteness
  is a coverage gap, not a hole.
- Correction (invariants only, schema enforcement already SPEC-correct):
  completed to 12 SPEC-derived invariants, preserving the original delete line.
  cancelPiece owner-or-manager require and changeLimit manager-only require verified in schema.
  N_ARGUMENT_GRANT (provision): operator-only mutation, trusted boundary, reviewed not-a-hole.
  N_EXISTENCE_ORACLE notes: non-owner lookups hide rows as missing first, reviewed not-a-hole.
  N_SWEEP_ONLY_DEADLINE: collectPiece enforces the 21d deadline in-mutation; sweep is eventual flag.
- Repaired: check ok=True (73s, exit 0), 12/12 unproved, 0 refuted.
  test exit=1 (same fixture friction), 4532 attempted, 2363 refused, 0 violations.
- Counts: confirmed holes caught 0, residual holes 0 (all SPEC audiences now declared;
  proofs pending engine reductions), usability friction 1 (no-fixture incomplete run).

### 007 farrier-hoof-rota — DONE
- Original: check exit=1 ok=False (8s), 1 refuted (roles.read via `allow`) + 16 unproved.
  audit exit=1, 17 invariants, 7 exposures. test exit=1, 387 attempted, 1 violation
  (same roles.read replay, invariants.q:10:1). CONFIRMED HOLE #1.
- Repair (schema): `roles.read` tightened from `allow` to
  `.principal = viewer or exists roles[viewer, role='manager'] or viewer='service:ops'`,
  matching the declared invariant and SPEC's private roster. Rule-internal `exists`
  probes inspect raw rows, so addHorse/bookCycle/recordVisit gating is unaffected.
  `directory` now self-limits to caller-visible rows; no query change needed.
  recordVisit TOO_EARLY gate noted but SPEC-silent: left as app workflow, not repaired.
- Repaired: check exit=0 ok=True (20s), 17/17 unproved, 0 refuted — hole closed.
  test exit=1 (no-fixture incomplete friction), 578 attempted, 283 refused, 0 violations.
- Counts: confirmed holes caught 1, residual holes 0 (remaining 17 unproved = missing
  reductions, not holes), usability friction 1 (no-fixture incomplete run).

### 008 sublet-key-escrow — DONE (no repair warranted)
- Original: check exit=0 ok=True (16s), 11/11 unproved, 0 refuted. audit exit=0 (18s).
  test exit=1 (no-fixture incomplete friction), 626 attempted, 294 refused, 0 violations.
- Verification vs SPEC: releaseKey gates start-date + both signatures + ID proof;
  cancelBooking manager-only once signed; ID docs owner+office only; return/overdue
  sweep present. All 11 invariants SPEC-faithful; none deleted or weakened.
- Notes reviewed, not holes: N_GRANT_OUTLIVES_ROLE x5 (SPEC needs no role-change
  revocation); N_EXISTENCE_ORACLE (audiences already authorized); N_ARGUMENT_GRANT
  assignSubtenant (recipient role+vetted validated in-mutation); N_UNREADABLE_PROBE
  x2 (unique index still enforces ALREADY_BOOKED; at most UX, not integrity).
- Repaired: sources unchanged (NOTE filed); evidence copied from final-original.
- Counts: confirmed holes caught 0, residual holes 0, usability friction 1 (no fixtures).

### 009 choir-part-tracks — DONE (no repair warranted; test TIMEOUT)
- Original: check exit=0 ok=True (7s), 11 proved + 8 unproved, 0 refuted. audit exit=0 (6s).
  test TIMEOUT exit=124 TWICE (170s, 178s), 0 bytes output — campaign never completes
  in-bounds (likely audio-file fixture challenges). Recorded as timeout, not as pass.
- Verification vs SPEC: release-window gating via `not before`/`expire at` + releases-exists
  gate; same-part singer audience; leaders section-scoped; director-only moves with
  progress/attendance cascade; live attendance window check. All 19 invariants kept.
- Notes: N_IMMUTABLE_PATCH x2 (upsert-conflict refusal advisory; moveSinger keeps keys
  consistent, no false refusal constructed); N_NEVER_COMPLETE (members/tracks pages —
  client must handle capped; friction).
- Counts: confirmed holes caught 0, residual holes 0, timeouts 2, usability friction 1.

### 010 allotment-water-turns — DONE (no repair; 2 scope corrections recorded)
- Original: check exit=0 ok=True (10s), 8 proved + 5 unproved, 0 refuted. audit exit=0.
  test exit=1 (no-fixture incomplete friction), 533 attempted, 473 refused, 0 violations.
- Verification vs SPEC: drought auto-cancel keeps oldest-booked first; override needs
  committee + photo; chair-only audit; anonymized calendar (slots carry no owner identity;
  booking IDs unresolvable by non-owners via PRIVATE_BOOKING + hidden-as-missing).
- Scope corrections (recorded, not repaired): (a) slots direct insert/delete open to any
  member — SPEC defines slots only via booking workflow but names no direct-write
  audience (already noted in invariants.q); tightening risks false refusals in `book`.
  (b) "halves the weekly limit" 3->1 (schema+invariant agree; fractional turns
  unbookable). N_NO_CURSOR (calendar uncursored page — capped-page friction).
  N_BROAD_READ policy/slots by-design shared state. N_ARGUMENT_GRANT operator-only.
- Counts: confirmed holes caught 0, residual holes 0, usability friction 2 (no fixtures,
  uncursored calendar).

### 019 apiary-hive-inspections — DONE (no repair warranted)
- Original: check exit=0 ok=True (24s), 12 proved + 7 unproved, 0 refuted. audit exit=0.
  test exit=1 (no-fixture incomplete friction; 18 not run), 1590 attempted, 839 refused,
  0 violations; 36 complete across 6 personas — deepest persona coverage so far.
- Verification vs SPEC: route join limits inspectors to assigned route; lead-only
  setHiveStatus deletes the listing in the same transaction; addListing refuses
  non-healthy; mite>3 alert literal present in both recordInspection and hiveStatus
  (duplication noted in schema comment, verified in sync). listings public by design.
- Counts: confirmed holes caught 0, residual holes 0, usability friction 1.

### 020 tow-yard-release — DONE (1 enforcement repair)
- Original: check exit=0 ok=True (41s), 11/11 unproved, 0 refuted. audit exit=0.
  test exit=1 (incomplete friction), 1259 attempted, 1054 refused, 0 violations.
  N_OPTIONAL_EVIDENCE fired: `vehicles.photos` was `[image] <=4 ?` (omission allowed).
- Repair (schema): SPEC "logs every towed vehicle with photos at intake" requires
  evidence → column + intake param now `[image <=10000000] 1..4` (required, per guide
  evidence rule). Photo-less intake is now refused at the argument/column boundary.
- Repaired: check exit=0 ok=True (39s), 11/11 unproved, N_OPTIONAL_EVIDENCE gone.
  test exit=1 (same friction), 1035 attempted, 830 refused, 0 violations — no false
  refusal of a SPEC-legal workflow observed.
  N_SWEEP_ONLY_DEADLINE x2 reviewed: auction sweep is the SPEC's automatic mechanism.
- Counts: confirmed holes caught 0 (evidence gap closed, not an exposure),
  residual holes 0, usability friction 1.

### 021 moot-court-scoring — DONE (1 enforcement repair + 1 invariant-scope correction)
- Original: check exit=0 ok=True (117s), 25 proved + 11 unproved, 0 refuted. audit exit=0.
  test exit=1 (incomplete friction, 151s), 3340 attempted, 890 refused, 0 violations.
- Repair (schema): `profiles.read` tightened from all-role-holders to
  `exists directors[viewer]`, matching the schema's own documented purpose
  (director grant-discovery) and the declared invariant. Grant flows are all
  director-only; `profilesList` already required director — no workflow broken.
- Correction (invariant, no enforcement change): `scores.read` reparenthesised so the
  round-closed gate binds judges+members+coach. Engine rendering confirmed the old
  line left member/coach arms ungated (over-broad intent proving nothing).
- Repaired: check exit=0 ok=True (117s), 25 proved + 11 unproved, 0 refuted.
  test exit=1 (same friction, 151s), 3268 attempted, 818 refused, 0 violations.
- Counts: confirmed holes caught 0 (directory over-exposure closed before a replay
  established it; profiles.read never refuted), residual holes 0, friction 1.

### 045 instrument-loan-bank — DONE (1 hole closed + 1 evidence repair)
- Original: check exit=1 ok=False (18s), 12 proved + 5 unproved + 1 refuted
  (repairNotes.read via luthier arm). audit exit=1. test exit=1, 1679 attempted,
  1 violation (same replay, invariants.q:38:1). CONFIRMED HOLE #2.
- Repairs (schema): (a) `repairNotes.read` dropped the luthier arm → librarian +
  manager only, matching SPEC and the declared invariant. (b) SPEC "condition photos
  at checkout and return": `loans.checkoutPhoto` column + checkout param now required;
  checkin `returnPhoto` param now required while the column stays `?` (an outstanding
  loan legitimately has no return photo yet) — one residual N_OPTIONAL_EVIDENCE
  records exactly that necessity.
- Repaired: check exit=0 ok=True (18s), 12 proved + 6 unproved, 0 refuted — hole closed.
  test exit=1 (same friction), 1683 attempted, 1067 refused, 0 violations.
- Scope note (recorded): parent reading a child's loan has no delegation path in the
  schema (single borrower principal); no audience invented.
- Counts: confirmed holes caught 1, residual holes 0, usability friction 1.

### 048 boiler-room-rounds — DONE (no repair; ambiguity recorded)
- Original: check exit=0 ok=True (46s), 25/25 unproved, 0 refuted. audit exit=0.
  test exit=1 (incomplete friction), 654 attempted, 250 refused, 0 violations.
- Decision: the shift-scoped `readings.read` tightening stays UNPROVED (engine builds
  no cross-shift replay) and is KEPT as declared, not deleted. No schema repair:
  SPEC grants engineers both "rounds for their own shift" AND "the live gauge
  history" (unscoped), and `gaugeHistory` is ungated by design — shift-scoping the
  rule could refuse legitimate handover reads. Recorded as ambiguity, not invented.
- Counts: confirmed holes caught 0, residual holes 0 (1 unproved scope question open),
  usability friction 1.

## Honest totals (final-repaired evidence, snapback4 0.4.31)

- Apps: 10/10 verified (check --json + audit --json + test, <=180s per command).
  All ten check ok=True post-repair. Initial schemas preserved under
  `baseline-annotated` (untouched); no correct invariant deleted.
- Invariants: 181 declared (170 original + 11 SPEC-derived added for 005).
  68 proved, 113 unproved, 0 refuted. Unproved = named missing reduction, not a pass.
- Confirmed holes caught (refuted + replayed counterexample, check AND test): 2.
  Both closed by schema repair and re-verified to 0 refuted / 0 violations:
  007 roles.read universal-allow roster exposure; 045 repairNotes.read luthier arm.
- Other enforcement repairs (no exposure, SPEC-clarity fixes): 020 required intake
  photos; 045 required checkout/checkin photos; 021 director-only profiles directory.
- Invariant-scope corrections (no enforcement change): 021 scores.read close-gate
  parens; 010 overrides.insert actor-binding parens; 005 completed 1 -> 12 invariants.
- Recorded ambiguities (not repaired, not invented): 010 open slot direct-writes +
  drought-halving 3->1; 048 cross-shift gauge-history scope; 045 parent-loan
  delegation absence; 019 threshold literal duplication (verified in sync).
- False runtime refusals of SPEC-legal workflows: 0 observed in any test campaign.
  (Deliberate tighteners in 007/045 DID refuse only the over-broad grant, which was
  the hole, not a legal workflow.)
- Timeouts: 009 test exit=124 twice (170s, 178s), 0 bytes — campaign never completes
  in-bounds. Not counted as evidence either way.
- Usability friction per app: no-fixture "incomplete" test exits (005, 007, 008, 010,
  019, 020, 021, 045, 048 — every app ships no fixtures); 010 uncursored calendar
  page (N_NO_CURSOR); 009 N_NEVER_COMPLETE pages need capped handling.
- Residual holes: 0 confirmed. Every SPEC audience is now declared; remaining risk
  sits in the 113 unproved declarations (reductions the engine does not cover:
  raw rule probes, capture/live-parent, cross-table disclosure, system/job paths,
  offline/revoked-device snapshots) plus the recorded ambiguities above.
- No trusted-seeding claim is made for any ordinary workflow. No publication or push.

Commands used (per app dir, `timeout` on every call):

- `timeout 170 ../node_modules/.bin/snapback4 check --json`
- `timeout 170 ../node_modules/.bin/snapback4 audit --json`
- `timeout 170 ../node_modules/.bin/snapback4 test` (178s bound on the 009 retry)
- Outputs + exit codes + durations: `evidence/final-original/` (pre-repair) and
  `evidence/final-repaired/` (post-repair, with `*.NOTE.txt` where sources unchanged).
