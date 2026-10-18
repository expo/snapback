# Snapback invariant adoption assessment

10 apps; 102 independently authored invariants. Targeted operation tests reproduce 12 distinct specification violations in 5 apps. The other five have no reproduced application finding in this campaign; that is not a clean-app proof.

Only installed package README/docs and CLI guide/help were used to learn Snapback. Only the ten copied SPEC.md/schema.q pairs were inspected as application inputs. No original wave directories, repository source, reviews, journals, other worktrees, credentials, remote systems, cargo, publication or push were used. All shell commands had timeouts. No generated invariant draft was accepted or used as intent.

Evidence is verbatim stdout and stderr with exit code, elapsed time, source snapshots and exact command arrays. `original` is the untouched baseline; `invariants-original-long` is the primary bad-original-plus-intent measurement; `repaired` and the two `repaired-v2` directories are final schema measurements. Repairs were staged while original checks ran, then installed only after original measurements finished. Final source hashes in RESULTS.json bind the installed copies to the measured snapshots.

P/R/U below means whole-declaration proved/refuted/unproved, not just the direct row-rule implication. Unsupported expressions, unreduced paths, partial (`capped`) answers and timeouts are not security refusals. Refutations from a trusted seed or a synthetic table operation do not establish a reachable public workflow. The independent targeted cases provide that distinction.

| App | Declared | Original P/R/U | Final P/R/U | Original targeted passed/failed | Final targeted passed/failed | Distinct reproduced findings |
|---|---:|---|---|---|---|---:|
| 005-snapback-kiln-firing-queue | 9 | no JSON | no JSON | 13/0 | 13/0 | 0 |
| 007-snapback-farrier-hoof-rota | 12 | 0/0/12 | 0/0/12 | 9/0 | 9/0 | 0 |
| 008-snapback-sublet-key-escrow | 9 | 0/1/8 | 0/0/9 | 11/0 | 11/0 | 0 |
| 009-snapback-choir-part-tracks | 12 | 7/0/5 | 7/0/5 | 14/0 | 14/0 | 0 |
| 010-snapback-allotment-water-turns | 8 | 4/1/3 | 4/1/3 | 10/0 | 10/0 | 0 |
| 019-snapback-apiary-hive-inspections | 9 | 0/5/4 | 2/0/7 | 8/2 | 10/0 | 3 |
| 020-snapback-tow-yard-release | 10 | 0/3/7 | 0/1/9 | 8/1 | 9/0 | 1 |
| 021-snapback-moot-court-scoring | 12 | 6/2/4 | 8/0/4 | 6/2 | 8/0 | 1 |
| 045-snapback-instrument-loan-bank | 11 | 5/4/2 | 6/1/4 | 6/3 | 9/0 | 3 |
| 048-snapback-boiler-room-rounds | 10 | 0/3/7 | 0/0/10 | 5/3 | 8/0 | 4 |

Schema-derived security campaign counts are attempted/refused/violations. Refused attacks are expected denials, not false refusals. These counts are separate from authored fixture cases.

| App | Untouched baseline A/R/V | Original with invariants A/R/V | Final A/R/V | Final unsupported assertions | Confirmed false refutations |
|---|---|---|---|---:|---:|
| 005-snapback-kiln-firing-queue | 366/315/0 | not completed | not completed | ? | 0 |
| 007-snapback-farrier-hoof-rota | 146/91/0 | 986/451/0 | 986/451/0 | 1 | 0 |
| 008-snapback-sublet-key-escrow | 146/102/0 | 644/487/1 | 723/583/0 | 0 | 0 |
| 009-snapback-choir-part-tracks | 280/219/0 | 15190/14381/0 | 15190/14381/0 | 0 | 0 |
| 010-snapback-allotment-water-turns | 101/89/0 | 718/561/1 | 719/562/1 | 0 | 1 |
| 019-snapback-apiary-hive-inspections | 726/551/0 | 1699/1083/5 | 2543/1646/0 | 1 | 0 |
| 020-snapback-tow-yard-release | 251/214/0 | 1603/1345/3 | 1728/1261/1 | 0 | 0 |
| 021-snapback-moot-court-scoring | 196/101/0 | 2573/1312/2 | 2763/1488/0 | 0 | 0 |
| 045-snapback-instrument-loan-bank | 230/152/0 | 1932/1322/4 | 2642/1441/1 | 0 | 0 |
| 048-snapback-boiler-room-rounds | 246/178/0 | 1195/652/3 | 1391/871/0 | 0 | 0 |

The unchanged kiln schema has especially expensive full-set invariant checks; bounded runs and isolated declaration checks are retained under its evidence directory. A missing JSON result is reported as missing, never as zero findings or a pass.

The confirmed allotment replay mismatch has an additional [authored boundary test](evidence/010-snapback-allotment-water-turns/no-op-verification/test.stdout): the same forbidden override write is refused E_RULE. The remaining tow status counterexample starts and ends in the identical released/held state; it does not show a release transition. These refusal cases remain visible. The initial sublet and tow all-snapshot assertions, and the initial honey-listing physical-absence assertion, were narrowed to actual release/write/read intent with explanations below. No invariant was removed to obtain a pass.

Usability friction: whole-declaration proofs are frequently unproved despite proved direct row predicates, because jobs, raw probes, parent captures, refusal observations and wire paths need separate reductions. Multi-hop read assertions can be retained but unsupported. Required non-null scalar evidence has a type theorem, while conditional evidence and trusted seeds need careful interpretation. Checks can take minutes; both 120- and 600-second bounded attempts are preserved. One overlapping exploratory choir test returned E_STORE_BUSY; this is harness-induced contention, not a security refusal. Query sweeps can be incomplete with exit zero, and expected authorization refusals are advisory. Counts retain those limits rather than treating every refused attack or incomplete sweep as a false refusal.

The first choir expanded case incorrectly tested bob as a wrong-part singer after moving bob to Alto. It was corrected to a separate Tenor singer and rerun. The first boiler demotion case used myShifts metadata, whose audience is unspecified; it was corrected to the explicitly shift-authorized shiftRounds operation. Both initial outputs are preserved.

The main corrected fixture suite has 101 final passes. Additional original/final pairs catch a premature apiary overdue flag and completing a boiler round without reading every gauge, and preserve the luthier's ability to write private notes; 5 additional final cases pass. These workflow findings are counted separately from invariant refutations and their exact commands are under `evidence/additional-workflow-commands.json`.

No false runtime refusal was observed in the final authored cases. This is finite case coverage, not a claim about every legitimate workflow. The invariant checker still returns nonzero for three declarations: the confirmed allotment replay mismatch, the tow unchanged-image transition-scope issue, and a returned-loan-without-photo trusted-seed counterexample. The loan snapshot does not show that the repaired required-photo checkin operation can create that state. Unsupported and unreduced declarations remain unproved rather than being labeled refusals.

Final source reproduction and integrity: [original snapshots stayed unchanged](evidence/original-integrity.json); [all 20 final source files reproduce exactly](evidence/repair-reproducibility.json) from those snapshots with `scripts/repair.py`.

## 005-snapback-kiln-firing-queue

Members read their own pieces; techs/managers can operate the firing queue. Pieces require photos, firing work is staff-only, other-owner cancellation is manager-only, and limit changes are privileged.

Declared intent in `snapback/security.q`:

```quarry
invariant pieces.read only .owner = viewer or exists memberships[viewer, role = 'tech'] or exists memberships[viewer, role = 'manager']
invariant pieces.insert only .owner = viewer and exists memberships[viewer]
invariant pieces.update only .owner = viewer or exists memberships[viewer, role = 'tech'] or exists memberships[viewer, role = 'manager']
invariant pieces always .photo != null
invariant firingLoads.read only .owner = viewer or exists memberships[viewer, role = 'tech'] or exists memberships[viewer, role = 'manager']
invariant firings.insert only exists memberships[viewer, role = 'tech'] or exists memberships[viewer, role = 'manager']
invariant firings.update only exists memberships[viewer, role = 'tech'] or exists memberships[viewer, role = 'manager']
invariant memberships.update only exists memberships[viewer, role = 'manager'] or viewer = 'service:ops'
invariant pieces.status write only .status != 'cancelled' or .owner = viewer or exists memberships[viewer, role = 'manager']
```

No application finding reproduced by the targeted cases.

The application schema was retained; security intent was added independently.

Ambiguities and preserved conventions:

- The spec permits a public queue total; it does not declassify piece payloads. The proof engine cannot discharge this permitted aggregate under the source read invariant.
- The spec does not explicitly bound staff access to historical rather than active queue rows.

Targeted cases cover firing creation, member/other-owner visibility, locked-piece editing, tech cancellation refusal, manager cancellation and limit changes. Donation flagging and live UI delivery are inspected but not temporally exercised.

[Source diff](evidence/005-snapback-kiln-firing-queue/repair.diff), [original invariant evidence](evidence/005-snapback-kiln-firing-queue/invariants-original-long/commands.json), [final evidence](evidence/005-snapback-kiln-firing-queue/repaired/commands.json), [original targeted cases](evidence/005-snapback-kiln-firing-queue/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/005-snapback-kiln-firing-queue/repaired/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/005-snapback-kiln-firing-queue`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.158s)
- `original`, cwd `/tmp/sec2-builders/codex/005-snapback-kiln-firing-queue`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (9.863s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/005-snapback-kiln-firing-queue`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 124 (600.01s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/005-snapback-kiln-firing-queue`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 124 (600.009s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/005-snapback-kiln-firing-queue`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 124 (600.008s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/005-snapback-kiln-firing-queue`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 124 (600.008s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/005-snapback-kiln-firing-queue`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/005-snapback-kiln-firing-queue/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/005-snapback-kiln-firing-queue/original-expanded/targeted/fixtures` → exit 0
- `repaired` targeted, cwd `/tmp/sec2-builders/codex/005-snapback-kiln-firing-queue`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/005-snapback-kiln-firing-queue/repaired/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/005-snapback-kiln-firing-queue/repaired/targeted/fixtures` → exit 0

## 007-snapback-farrier-hoof-rota

Horse owners read only their own records; the assigned farrier and manager read that horse. Billing is manager-only; quotes can be answered by the horse owner; visit photos inherit the horse audience.

Declared intent in `snapback/security.q`:

```quarry
invariant horses.read only .owner = viewer or .manager = viewer or .farrier = viewer
invariant visits.read only exists horses[.horse, owner = viewer] or exists horses[.horse, manager = viewer] or exists horses[.horse, farrier = viewer]
invariant photos.read only exists horses[.visit.horse, owner = viewer] or exists horses[.visit.horse, manager = viewer] or exists horses[.visit.horse, farrier = viewer]
invariant billing.read only exists horses[.horse, manager = viewer]
invariant billing.insert only exists horses[.horse, manager = viewer]
invariant billing.update only exists horses[.horse, manager = viewer]
invariant visits.insert only .farrier = viewer and .horse.farrier = viewer
invariant photos.insert only .visit.farrier = viewer
invariant photos always .photo != null
invariant quotes.read only exists horses[.horse, owner = viewer] or exists horses[.horse, manager = viewer] or exists horses[.horse, farrier = viewer]
invariant quotes.update only .horse.owner = viewer
invariant reminders.read only .to = viewer
```

No application finding reproduced by the targeted cases.

The application schema was retained; security intent was added independently.

Ambiguities and preserved conventions:

- Notes and photos may be recorded in separate recordVisit/addPhoto steps. The spec does not state that every visit must atomically contain a photo before its first commit; no atomic-photo requirement was invented.
- The spec does not define role revocation for immutable owner/farrier appointments, or prohibit the public role/name directory.

Own/other horse reads, farrier access, private billing, manager due list, owner quote approval and non-owner refusal are exercised. Reminder scheduling and photo bytes are not exercised.

[Source diff](evidence/007-snapback-farrier-hoof-rota/repair.diff), [original invariant evidence](evidence/007-snapback-farrier-hoof-rota/invariants-original-long/commands.json), [final evidence](evidence/007-snapback-farrier-hoof-rota/repaired/commands.json), [original targeted cases](evidence/007-snapback-farrier-hoof-rota/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/007-snapback-farrier-hoof-rota/repaired/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/007-snapback-farrier-hoof-rota`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.098s)
- `original`, cwd `/tmp/sec2-builders/codex/007-snapback-farrier-hoof-rota`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (3.311s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/007-snapback-farrier-hoof-rota`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (33.908s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/007-snapback-farrier-hoof-rota`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (36.776s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/007-snapback-farrier-hoof-rota`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (34.461s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/007-snapback-farrier-hoof-rota`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (37.964s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/007-snapback-farrier-hoof-rota`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/007-snapback-farrier-hoof-rota/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/007-snapback-farrier-hoof-rota/original-expanded/targeted/fixtures` → exit 0
- `repaired` targeted, cwd `/tmp/sec2-builders/codex/007-snapback-farrier-hoof-rota`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/007-snapback-farrier-hoof-rota/repaired/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/007-snapback-farrier-hoof-rota/repaired/targeted/fixtures` → exit 0

## 008-snapback-sublet-key-escrow

Listings/bookings are restricted to their two parties and office; ID documents exclude the other party; booking requires a vetted subtenant; releasing the key requires both signatures and ID proof; cancelling a signed booking requires the manager.

Declared intent in `snapback/security.q`:

```quarry
invariant listings.read only .leaseholder = viewer or .subtenant = viewer or exists people[viewer, role = 'staff'] or exists people[viewer, role = 'manager']
invariant listings.insert only .leaseholder = viewer and exists people[viewer, role = 'leaseholder']
invariant bookings.read only .leaseholder = viewer or .subtenant = viewer or exists people[viewer, role = 'staff'] or exists people[viewer, role = 'manager']
invariant bookings.insert only .subtenant = viewer and exists people[viewer, role = 'subtenant', vetted = true]
invariant idDocuments.read only .owner = viewer or exists people[viewer, role = 'staff'] or exists people[viewer, role = 'manager']
invariant idDocuments.insert only .owner = viewer and .booking.subtenant = viewer
invariant idDocuments always .document != null
invariant bookings.releasedAt write only .releasedAt = null or (.leaseSignedAt != null and .subSignedAt != null and .proofUploaded = true)
invariant bookings.cancelled write only .cancelled = false or (.leaseSignedAt = null and .subSignedAt = null) or exists people[viewer, role = 'manager']
```

No application finding reproduced by the targeted cases.

Source repairs:

- At the table boundary, new bookings cannot start released and updates with a release timestamp require both signatures and proof. Public releaseKey already enforced these prerequisites. This closes the broader synthetic-write counterexample without deleting the invariant.

Assertion scope corrections:

- bookings always (released implies signatures and proof) became bookings.releasedAt write only the same condition. The spec constrains releasing the key, not arbitrary trusted historical imports. The original counterexample was only a trusted seed, not an application release.

Ambiguities and preserved conventions:

- The schema implements UTC calendar dates; the product does not name a local timezone. No alternative timezone was invented.

Party/outsider booking reads, signed cancellation refusals and manager success, signature update, start-date release refusal, and ID metadata isolation are exercised. Actual ID upload/download and overdue schedule timing are not exercised.

[Source diff](evidence/008-snapback-sublet-key-escrow/repair.diff), [original invariant evidence](evidence/008-snapback-sublet-key-escrow/invariants-original-long/commands.json), [final evidence](evidence/008-snapback-sublet-key-escrow/repaired-v2/commands.json), [original targeted cases](evidence/008-snapback-sublet-key-escrow/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/008-snapback-sublet-key-escrow/repaired-v2/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/008-snapback-sublet-key-escrow`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.131s)
- `original`, cwd `/tmp/sec2-builders/codex/008-snapback-sublet-key-escrow`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (3.739s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/008-snapback-sublet-key-escrow`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (14.194s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/008-snapback-sublet-key-escrow`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (17.639s)
- `repaired-v2`, cwd `/tmp/sec2-builders/codex/staged-v2/008-snapback-sublet-key-escrow`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (21.349s)
- `repaired-v2`, cwd `/tmp/sec2-builders/codex/staged-v2/008-snapback-sublet-key-escrow`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (24.624s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/008-snapback-sublet-key-escrow`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/008-snapback-sublet-key-escrow/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/008-snapback-sublet-key-escrow/original-expanded/targeted/fixtures` → exit 0
- `repaired-v2` targeted, cwd `/tmp/sec2-builders/codex/008-snapback-sublet-key-escrow`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/008-snapback-sublet-key-escrow/repaired-v2/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/008-snapback-sublet-key-escrow/repaired-v2/targeted/fixtures` → exit 0

## 009-snapback-choir-part-tracks

The director publishes tracks and moves singers; singers read their own part through a current release and their own progress; section leaders read/mark their section; the director reads all progress/attendance.

Declared intent in `snapback/security.q`:

```quarry
invariant tracks.read only exists roster[principal = viewer, role = 'director'] or (exists roster[principal = viewer, part = .part] and exists releases[track = .id])
invariant tracks.insert only exists roster[principal = viewer, role = 'director']
invariant tracks always .audio != null
invariant progress.read only .singer = viewer or exists roster[principal = viewer, role = 'director'] or exists roster[principal = viewer, role = 'leader', part = .part]
invariant progress.insert only .singer = viewer and .singer = .member.principal and .part = .member.part
invariant progress.update only .singer = viewer or exists roster[principal = viewer, role = 'director']
invariant roster.update only exists roster[principal = viewer, role = 'director']
invariant attendance.read only exists roster[principal = viewer, role = 'director'] or exists roster[principal = viewer, role = 'leader', part = .part]
invariant attendance.insert only exists roster[principal = viewer, role = 'leader', part = .part]
invariant attendance.update only exists roster[principal = viewer, role = 'director'] or exists roster[principal = viewer, role = 'leader', part = .part]
invariant concerts.insert only exists roster[principal = viewer, role = 'director']
invariant releases.insert only exists roster[principal = viewer, role = 'director']
```

No application finding reproduced by the targeted cases.

The application schema was retained; security intent was added independently.

Ambiguities and preserved conventions:

- The spec does not specify attendance history after a singer changes section. The existing moveSinger realigns progress/attendance with the new section; that behavior is tested without inventing a historical audience.
- The read invariant names a live release record. Matching that record's dates to the concert and proving the full temporal workflow requires more than the rule proof fragment.

Own/section/director progress, live attendance, forbidden cross-section marking, director move, active/future/expired releases and wrong-part track reads are exercised. Fixture audio has metadata but no bytes; real upload/download and wall-clock boundary crossing are not exercised.

[Source diff](evidence/009-snapback-choir-part-tracks/repair.diff), [original invariant evidence](evidence/009-snapback-choir-part-tracks/invariants-original-long/commands.json), [final evidence](evidence/009-snapback-choir-part-tracks/repaired/commands.json), [original targeted cases](evidence/009-snapback-choir-part-tracks/original-corrected/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/009-snapback-choir-part-tracks/repaired/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/009-snapback-choir-part-tracks`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.139s)
- `original`, cwd `/tmp/sec2-builders/codex/009-snapback-choir-part-tracks`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (7.034s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/009-snapback-choir-part-tracks`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (205.273s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/009-snapback-choir-part-tracks`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (496.747s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/009-snapback-choir-part-tracks`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (212.836s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/009-snapback-choir-part-tracks`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (492.655s)
- `original-corrected` targeted, cwd `/tmp/sec2-builders/codex/009-snapback-choir-part-tracks`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/009-snapback-choir-part-tracks/original-corrected/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/009-snapback-choir-part-tracks/original-corrected/targeted/fixtures` → exit 0
- `repaired` targeted, cwd `/tmp/sec2-builders/codex/009-snapback-choir-part-tracks`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/009-snapback-choir-part-tracks/repaired/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/009-snapback-choir-part-tracks/repaired/targeted/fixtures` → exit 0

## 010-snapback-allotment-water-turns

Bookings disclose identity only to their owner/committee; the member calendar reveals slots without owner/plot; only committee/chair changes drought policy or overrides; override audit/photos are chair-only and photo evidence is required.

Declared intent in `snapback/security.q`:

```quarry
invariant bookings.read only .owner = viewer or exists members[viewer, role = 'committee'] or exists members[viewer, role = 'chair']
invariant bookings.insert only .owner = viewer and exists members[viewer]
invariant slots.read only exists members[viewer]
invariant policy.update only exists members[viewer, role = 'committee'] or exists members[viewer, role = 'chair']
invariant overrides.read only exists members[viewer, role = 'chair']
invariant overrides.insert only .actor = viewer and (exists members[viewer, role = 'committee'] or exists members[viewer, role = 'chair'])
invariant overrides always .photo != null
invariant bookings.status write only .status != 'override' or exists members[viewer, role = 'committee'] or exists members[viewer, role = 'chair']
```

No application finding reproduced by the targeted cases.

Source repairs:

- Defence at the table boundary: insert only booked rows; owner updates cannot manufacture override status. A synthetic insert refuted the original row authority, while the public book mutation already fixed status to booked.

False-refusal assessment:

- confirmed replay mismatch: The checker refutes the named update rule with an unchanged override image. A test-only authored update of that same override value is refused E_RULE. The invariant remains present.

Ambiguities and preserved conventions:

- Half of a three-turn integer limit could mean one or two turns. The existing implementation floors to one. This convention is recorded and preserved; the test explicitly measures it.
- Opaque booking references in calendar rows are not treated as names or identities; private booking lookup remains hidden to other holders.

Three-turn limit, fourth-booking refusal, another holder's private lookup, unauthorized drought refusal, committee drought and oldest-booked retention are exercised. Override upload bytes and schedule/week boundary races are not exercised.

[Source diff](evidence/010-snapback-allotment-water-turns/repair.diff), [original invariant evidence](evidence/010-snapback-allotment-water-turns/invariants-original-long/commands.json), [final evidence](evidence/010-snapback-allotment-water-turns/repaired/commands.json), [original targeted cases](evidence/010-snapback-allotment-water-turns/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/010-snapback-allotment-water-turns/repaired/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/010-snapback-allotment-water-turns`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.116s)
- `original`, cwd `/tmp/sec2-builders/codex/010-snapback-allotment-water-turns`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (2.298s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/010-snapback-allotment-water-turns`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (11.432s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/010-snapback-allotment-water-turns`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (21.793s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/010-snapback-allotment-water-turns`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (12.049s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/010-snapback-allotment-water-turns`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (22.621s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/010-snapback-allotment-water-turns`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/010-snapback-allotment-water-turns/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/010-snapback-allotment-water-turns/original-expanded/targeted/fixtures` → exit 0
- `repaired` targeted, cwd `/tmp/sec2-builders/codex/010-snapback-allotment-water-turns`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/010-snapback-allotment-water-turns/repaired/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/010-snapback-allotment-water-turns/repaired/targeted/fixtures` → exit 0

## 019-snapback-apiary-hive-inspections

Landowners read their hives, current inspectors read assigned routes, and the lead has cooperative authority. Inspections require a photo; alert audience is owner/lead; hive status is privileged; public listings may expose only healthy hives owned by their writer.

Declared intent in `snapback/security.q`:

```quarry
invariant hives.read only .landOwner = viewer or (exists roles[viewer, role = 'inspector'] and exists routes[inspector = viewer, route = .route]) or exists roles[viewer, role = 'lead']
invariant inspections.read only exists hives[.hive, landOwner = viewer] or (exists roles[viewer, role = 'inspector'] and exists routes[inspector = viewer, route = .hive.route]) or exists roles[viewer, role = 'lead']
invariant inspections.insert only .inspector = viewer and exists roles[viewer, role = 'inspector'] and exists routes[inspector = viewer, route = .hive.route]
invariant inspections always .photo != null
invariant alerts.read only .owner = viewer or exists roles[viewer, role = 'lead']
invariant alerts.insert only .inspector = viewer and exists roles[viewer, role = 'inspector']
invariant hives.status write only exists roles[viewer, role = 'lead'] or viewer = 'service:ops'
invariant listings.read only exists hives[.hive, status = 'healthy']
invariant listings.insert only .owner = viewer and exists hives[.hive, landOwner = viewer, status = 'healthy']
```

Reproduced original findings:

- missing-inspection-photo: recordInspection commits without a frame photo. The photo requirement remains unproved in the original invariant report; the targeted mutation is the direct reproduction.
- demoted-inspector-route-access: grantRole demotes an inspector, but a surviving route still permits reading the hive. hives.read is refuted by synthetic table replay; the targeted demotion sequence establishes authored-operation reachability.
- premature-new-season-overdue: A hive never inspected is flagged overdue only two days into its season, because null lastInspectedAt used Unix epoch zero. Additional documented-fixture hiveStatus case fails the original and passes the repaired seasonStart baseline; this workflow calculation is not reduced by the declared security invariants.

Source repairs:

- Require inspection photo in both column and argument.
- Conjoin current inspector role with route read/write authority and recordInspection; restrict inspector status changes at the row boundary.
- Restrict alert inserts to current inspectors, and listing writes to the actual owner of a healthy hive.
- Read public listings only while their hive is healthy; still delete listings transactionally on requeen/quarantine.
- Use seasonStart as the overdue baseline for a never-inspected hive, so it is not overdue on the first day of a season.

Assertion scope corrections:

- listings always healthy became listings.read only healthy. The specification requires hiding quarantined/requeen hives, not absence of physical listing rows in arbitrary trusted snapshots. The new read guard enforces that exact policy even for an inconsistent imported snapshot.

Additional workflow evidence:

- `original`: 0 passed / 1 failed; `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/additional-workflow/original/test.q --fixture /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/additional-workflow/original/fixtures` → exit 1
- `repaired`: 1 passed / 0 failed; `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/additional-workflow/repaired/test.q --fixture /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/additional-workflow/repaired/fixtures` → exit 0

Ambiguities and preserved conventions:

- The spec does not set the treatment threshold; the copied schema's strictly-greater-than-3 convention is preserved.
- Trusted operator provisioning is a modeled trust boundary, not a public lead enrollment grant.

Inspector/owner/outsider reads, missing photo, actual demotion followed by hive lookup, non-lead status refusal, lead quarantine and listing refusal are exercised. Alert bytes, real media, and seasonal clock crossing are not exercised. An additional original/final pair exercises a never-inspected hive two days into the season and verifies the overdue flag is false.

[Source diff](evidence/019-snapback-apiary-hive-inspections/repair.diff), [original invariant evidence](evidence/019-snapback-apiary-hive-inspections/invariants-original-long/commands.json), [final evidence](evidence/019-snapback-apiary-hive-inspections/repaired/commands.json), [original targeted cases](evidence/019-snapback-apiary-hive-inspections/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/019-snapback-apiary-hive-inspections/repaired/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/019-snapback-apiary-hive-inspections`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.105s)
- `original`, cwd `/tmp/sec2-builders/codex/019-snapback-apiary-hive-inspections`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (16.192s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/019-snapback-apiary-hive-inspections`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (30.338s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/019-snapback-apiary-hive-inspections`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (46.078s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/019-snapback-apiary-hive-inspections`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (54.401s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/019-snapback-apiary-hive-inspections`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (78.364s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/019-snapback-apiary-hive-inspections`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/original-expanded/targeted/fixtures` → exit 1
- `repaired` targeted, cwd `/tmp/sec2-builders/codex/019-snapback-apiary-hive-inspections`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/repaired/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/019-snapback-apiary-hive-inspections/repaired/targeted/fixtures` → exit 0

## 020-snapback-tow-yard-release

Owners read only their vehicle/claim; clerks/managers see the yard; liaison access requires an active hold; release is blocked by a hold; proof is required for claims, intake photos are required, and only the manager waives fees.

Declared intent in `snapback/security.q`:

```quarry
invariant vehicles.read only .owner = viewer or exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] or (.onHold = true and exists roster[principal = viewer, role = 'liaison'])
invariant vehicles.insert only exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager']
invariant vehicles always .photos != null
invariant vehicles.status write only .status != 'released' or .onHold = false
invariant claims.read only .claimant = viewer or exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager']
invariant claims.insert only .claimant = viewer
invariant claims.update only exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager']
invariant claims always .proof != null
invariant waivers.insert only exists roster[principal = viewer, role = 'manager']
invariant vehicles.waived write only .waived = 0 or exists roster[principal = viewer, role = 'manager']
```

Reproduced original findings:

- missing-intake-photos: intake commits with photos omitted; the optional list also accepts zero photos. vehicles always photos non-null is refuted by a trusted seeded snapshot; the targeted mutation establishes the omission through the public intake workflow.

Source repairs:

- Change intake column and argument to a required image list of length 1..4.
- Require staff inserts to start impounded with zero waived fees; non-manager updates cannot change waived fees. These close synthetic row-boundary authority gaps.
- Constrain non-manager transitions to released to an unheld row, retaining the mutation's hold check.

Assertion scope corrections:

- vehicles always (released implies unheld) became vehicles.status write only the same predicate. The spec blocks release while held; it does not forbid a later investigative hold on an already released record.

False-refusal assessment:

- intent expressiveness / no transition: The remaining status-write counterexample starts and ends released/onHold with identical images. This does not demonstrate release while held. The spec permits a later hold, while the field-write invariant cannot express only a transition. Retained rather than deleted.

Ambiguities and preserved conventions:

- The spec does not explicitly say whether a yard manager may also lift a hold; the existing manager exception is preserved.
- Daily fee accrual uses complete elapsed 24-hour periods; the spec does not specify calendar-day billing or a timezone.

Own vehicle isolation, liaison held/unheld isolation and post-lift withdrawal, clerk waiver refusal, held release refusal, and omitted intake evidence are exercised. Actual photo bytes, 30-day sweep timing and fee-rounding boundaries are not exercised.

[Source diff](evidence/020-snapback-tow-yard-release/repair.diff), [original invariant evidence](evidence/020-snapback-tow-yard-release/invariants-original-long/commands.json), [final evidence](evidence/020-snapback-tow-yard-release/repaired-v2/commands.json), [original targeted cases](evidence/020-snapback-tow-yard-release/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/020-snapback-tow-yard-release/repaired-v2/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/020-snapback-tow-yard-release`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.141s)
- `original`, cwd `/tmp/sec2-builders/codex/020-snapback-tow-yard-release`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (6.808s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/020-snapback-tow-yard-release`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (37.73s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/020-snapback-tow-yard-release`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (45.423s)
- `repaired-v2`, cwd `/tmp/sec2-builders/codex/staged-v2/020-snapback-tow-yard-release`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (45.901s)
- `repaired-v2`, cwd `/tmp/sec2-builders/codex/staged-v2/020-snapback-tow-yard-release`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (50.91s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/020-snapback-tow-yard-release`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/020-snapback-tow-yard-release/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/020-snapback-tow-yard-release/original-expanded/targeted/fixtures` → exit 1
- `repaired-v2` targeted, cwd `/tmp/sec2-builders/codex/020-snapback-tow-yard-release`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/020-snapback-tow-yard-release/repaired-v2/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/020-snapback-tow-yard-release/repaired-v2/targeted/fixtures` → exit 0

## 021-snapback-moot-court-scoring

Judges write their own scores; other judges and own-team students see them after close; coaches see their teams; only directors change teams/brackets/rounds; briefs belong to own-team students; director enrollment must not arise from an arbitrary caller creating a tournament.

Declared intent in `snapback/security.q`:

```quarry
invariant scores.read only .judge = viewer or exists directors[viewer] or (exists rounds[.round, status = 'closed'] and (exists judges[viewer] or exists members[.team, viewer] or exists teams[.team, coach = viewer]))
invariant scores.insert only .judge = viewer and exists judges[viewer]
invariant scores.update only .judge = viewer and exists judges[viewer]
invariant teams.insert only exists directors[viewer]
invariant teams.update only exists directors[viewer]
invariant teams.delete only exists directors[viewer]
invariant rounds.update only exists directors[viewer]
invariant briefs.read only exists directors[viewer] or exists judges[viewer] or exists members[.team, viewer] or exists teams[.team, coach = viewer]
invariant briefs.insert only exists members[.team, viewer]
invariant briefs.update only exists members[.team, viewer]
invariant directors.insert only exists directors[viewer] or viewer = 'service:ops'
invariant tournaments.insert only exists directors[viewer] or viewer = 'service:ops'
```

Reproduced original findings:

- global-director-self-enrollment: An outsider creates a tournament, becomes a global director, then rewrites an existing tournament team's bracket. directors.insert is refuted by replay of the authored createTournament mutation, not just a synthetic table write.

Source repairs:

- Require an existing director or trusted service:ops at createTournament and the tournaments insert rule.
- Restrict the created-tournament bootstrap branch of directors insertion to service:ops and its own principal, retaining subsequent director-controlled enrollment.

Ambiguities and preserved conventions:

- Teams/rounds have no tournament reference and uploadBrief takes a caller-chosen tournament. The spec gives no multi-tournament association policy; this remains a deadline-modeling ambiguity, rather than inventing new relationships.
- The spec does not explicitly set when coaches first see scores/comments; the existing after-close policy is preserved.
- Judge panel assignments are not modeled. The spec does not define panel enrollment/assignment authority, so no new assignment graph was invented.

Own judge versus other judge/student before close, student after close, closed-round score lock, outsider self-enrollment and subsequent foreign-team bracket modification are exercised. Brief deadline crossover and panel-scoped scoring are not qualified.

[Source diff](evidence/021-snapback-moot-court-scoring/repair.diff), [original invariant evidence](evidence/021-snapback-moot-court-scoring/invariants-original-long/commands.json), [final evidence](evidence/021-snapback-moot-court-scoring/repaired/commands.json), [original targeted cases](evidence/021-snapback-moot-court-scoring/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/021-snapback-moot-court-scoring/repaired/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/021-snapback-moot-court-scoring`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.155s)
- `original`, cwd `/tmp/sec2-builders/codex/021-snapback-moot-court-scoring`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (5.425s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/021-snapback-moot-court-scoring`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (74.968s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/021-snapback-moot-court-scoring`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (108.9s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/021-snapback-moot-court-scoring`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (66.63s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/021-snapback-moot-court-scoring`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (118.036s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/021-snapback-moot-court-scoring`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/021-snapback-moot-court-scoring/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/021-snapback-moot-court-scoring/original-expanded/targeted/fixtures` → exit 1
- `repaired` targeted, cwd `/tmp/sec2-builders/codex/021-snapback-moot-court-scoring`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/021-snapback-moot-court-scoring/repaired/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/021-snapback-moot-court-scoring/repaired/targeted/fixtures` → exit 0

## 045-snapback-instrument-loan-bank

Borrowers read their own loans; librarian/manager handles loans; manager alone reads deposits or writes off instruments; repair notes are readable only by librarian/manager; checkout and return require condition photos.

Declared intent in `snapback/security.q`:

```quarry
invariant loans.read only .borrower = viewer or exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
invariant loans.insert only exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
invariant loans.update only exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
invariant loans always .checkoutPhoto != null
invariant loans always .status != 'returned' or .returnPhoto != null
invariant deposits.read only exists roles[viewer, role = 'manager']
invariant deposits.insert only exists roles[viewer, role = 'manager']
invariant deposits.update only exists roles[viewer, role = 'manager']
invariant repairNotes.read only exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
invariant repairNotes.insert only .author = viewer and exists roles[viewer, role = 'luthier']
invariant instruments.status write only .status != 'written_off' or exists roles[viewer, role = 'manager']
```

Reproduced original findings:

- luthier-reads-repair-notes: notesFor returns repair notes to the luthier, although the spec restricts visibility to librarian/manager. repairNotes.read is the independent restricted audience; inspect its refutation in the raw invariant report.
- missing-checkout-photo: checkout commits without condition evidence. loans checkoutPhoto non-null declaration supplies the independent evidence requirement; targeted mutation proves workflow omission.
- missing-return-photo: checkin commits without return condition evidence. returned-loan returnPhoto integrity is independent of the original optional column; targeted mutation proves workflow omission.

Source repairs:

- Remove luthier from repair-note readers; luthier still writes notes, and the authorized final reread may return null.
- Require checkoutPhoto column/argument and returnPhoto checkin argument. Keep the returnPhoto column nullable until return.
- Restrict librarian row transitions from/to written_off; writeOff remains manager-only.
- Require librarian inserts to start available; only the manager can initially insert written_off status. This closes the synthetic insert counterexample independently of addInstrument.

Additional workflow evidence:

- `original`: 2 passed / 0 failed; `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/additional-workflow/original/test.q --fixture /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/additional-workflow/original/fixtures` → exit 0
- `repaired`: 2 passed / 0 failed; `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/additional-workflow/repaired/test.q --fixture /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/additional-workflow/repaired/fixtures` → exit 0

Ambiguities and preserved conventions:

- The spec does not supply parent/student/family relationships. Borrower principal is the existing own-loan representation; no parent may discover arbitrary student loans by an invented relationship.
- myCurrent ends entitlement at seasonEndsAt and myOverdue/overdueLoans flag outstanding physical returns after 14 days. The spec does not mandate a stored ended status or an external follow-up notification; the existing query-based interpretation is preserved.
- The spec does not explicitly prohibit a public instrument catalog or public season dates; no catalog privacy requirement was invented.

Own-loan isolation, librarian notes, luthier note denial, deposit privacy/manager access, mandatory checkout/return evidence and librarian write-off refusal are exercised. Parent linkage, season crossing, follow-up delivery and real photo upload are not qualified. An additional positive workflow verifies the luthier can still create a private note and the librarian can read that newly persisted note.

[Source diff](evidence/045-snapback-instrument-loan-bank/repair.diff), [original invariant evidence](evidence/045-snapback-instrument-loan-bank/invariants-original-long/commands.json), [final evidence](evidence/045-snapback-instrument-loan-bank/repaired-v3/commands.json), [original targeted cases](evidence/045-snapback-instrument-loan-bank/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/045-snapback-instrument-loan-bank/repaired-v3/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.111s)
- `original`, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (5.252s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (20.901s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (52.934s)
- `repaired-v3`, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (37.892s)
- `repaired-v3`, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (69.027s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/original-expanded/targeted/fixtures` → exit 1
- `repaired-v3` targeted, cwd `/tmp/sec2-builders/codex/045-snapback-instrument-loan-bank`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/repaired-v3/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/045-snapback-instrument-loan-bank/repaired-v3/targeted/fixtures` → exit 0

## 048-snapback-boiler-room-rounds

Current engineers access their assigned shift rounds and gauge history; current contractors access assigned equipment; chief alone changes limits/acknowledges alerts; property managers see completed-round compliance and no individual gauge readings; each reading has a photo.

Declared intent in `snapback/security.q`:

```quarry
invariant rounds.read only exists roles[viewer, role = 'chief'] or (.status = 'completed' and exists roles[viewer, role = 'manager']) or (exists roles[viewer, role = 'engineer'] and exists shiftMembers[shift = .shift, engineer = viewer])
invariant gauges.read only exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or (exists roles[viewer, role = 'contractor'] and exists assignments[.id, viewer])
invariant readings.read only exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or (exists roles[viewer, role = 'contractor'] and exists assignments[.gauge, viewer])
invariant readings.insert only .engineer = viewer and exists roles[viewer, role = 'engineer'] and exists shiftMembers[shift = .shift, engineer = viewer]
invariant readings always .photo != null
invariant gauges.insert only exists roles[viewer, role = 'chief']
invariant gauges.update only exists roles[viewer, role = 'chief']
invariant gauges.delete only exists roles[viewer, role = 'chief']
invariant alerts.read only exists roles[viewer, role = 'chief']
invariant alerts.update only exists roles[viewer, role = 'chief']
```

Reproduced original findings:

- manager-sees-uncompleted-rounds: compliance includes a scheduled round instead of only completed rounds. rounds.read independently restricts the manager branch to status completed.
- demoted-contractor-equipment-access: A contractor demoted to manager retains an assignment and can still read gaugeHistory. gauges.read/readings.read include the current contractor role as well as assignment.
- demoted-engineer-shift-access: An engineer demoted to manager retains shift membership and can still call shiftRounds. rounds.read includes the current engineer role in the shift-membership branch.
- round-completed-with-unread-gauges: completeRound succeeds with one reading even when two gauges need readings/photos. Additional documented-fixture completion case reproduces the original success and repaired MISSING_READINGS refusal; the all-gauges workflow is outside the row proof fragment.

Source repairs:

- Require current roles alongside stored shift/equipment grants, including reads, writes and operation guards.
- Limit manager round reads and compliance output to completed rounds.
- Require completeRound to have a reading for every gauge, rather than merely one reading; the existing unique round/gauge key prevents duplicates.

Additional workflow evidence:

- `original`: 1 passed / 1 failed; `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/additional-workflow/original/test.q --fixture /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/additional-workflow/original/fixtures` → exit 1
- `repaired`: 2 passed / 0 failed; `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/additional-workflow/repaired/test.q --fixture /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/additional-workflow/repaired/fixtures` → exit 0

Ambiguities and preserved conventions:

- The spec says alerts immediately but supplies no exact missed-round deadline or delivery channel. The existing hourly sweep and two-hour acceptance window are recorded; no arbitrary tighter deadline/provider was invented.
- Engineers are permitted live gauge history; that may include other shifts. A blanket own-shift-only readings invariant would be too broad and was not imposed.
- Role self-enrollment, metadata visibility for shifts, and manager access to historical shift metadata are not explicitly specified. The corrected demotion test exercises shiftRounds, not the ambiguous myShifts metadata endpoint.

Completed-only compliance, manager reading denial, assigned contractor history, non-chief limit refusal, actual contractor/engineer demotions and subsequent access are exercised. An additional original/final pair verifies the every-gauge completion guard. Out-of-range alert generation, real media and missed-round clock timing remain unqualified.

[Source diff](evidence/048-snapback-boiler-room-rounds/repair.diff), [original invariant evidence](evidence/048-snapback-boiler-room-rounds/invariants-original-long/commands.json), [final evidence](evidence/048-snapback-boiler-room-rounds/repaired/commands.json), [original targeted cases](evidence/048-snapback-boiler-room-rounds/original-expanded/targeted/fixtures/test.cases.jsonl), [final targeted output](evidence/048-snapback-boiler-room-rounds/repaired/targeted/test.stdout).

Exact primary measurement commands (run each from the stated cwd):

- `original`, cwd `/tmp/sec2-builders/codex/048-snapback-boiler-room-rounds`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (0.172s)
- `original`, cwd `/tmp/sec2-builders/codex/048-snapback-boiler-room-rounds`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (7.43s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/048-snapback-boiler-room-rounds`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 1 (47.482s)
- `invariants-original-long`, cwd `/tmp/sec2-builders/codex/048-snapback-boiler-room-rounds`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 1 (56.711s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/048-snapback-boiler-room-rounds`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 check --json` → exit 0 (47.873s)
- `repaired`, cwd `/tmp/sec2-builders/codex/staged-repairs/048-snapback-boiler-room-rounds`: `timeout 600s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test` → exit 0 (55.378s)
- `original-expanded` targeted, cwd `/tmp/sec2-builders/codex/048-snapback-boiler-room-rounds`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/original-expanded/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/original-expanded/targeted/fixtures` → exit 1
- `repaired` targeted, cwd `/tmp/sec2-builders/codex/048-snapback-boiler-room-rounds`: `timeout 120s /tmp/sec2-builders/codex/node_modules/.bin/snapback4 test --source /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/repaired/targeted/test.q --fixture /tmp/sec2-builders/codex/evidence/048-snapback-boiler-room-rounds/repaired/targeted/fixtures` → exit 0

## Evidence and practical limits

RESULTS.json contains per-invariant predicates, whole and direct-rule verdicts, unsupported reasons, counterexample scopes, attempted/refused/violation campaign counts, case counts, raw-path links, exact commands, exit codes and source hashes. Each app retains its original and repaired evidence even when a checker refutes a declaration or times out. `snapback/*.q` in the ten top-level app copies is the final source for the later independent live probe.

Media fixture cells follow the installed asset guide and contain metadata only. They establish row visibility and required argument behavior, not byte delivery. No live-server, device, notification provider, upload/download or exhaustive temporal claim is made. Several deadlines/jobs were reviewed in source but not driven through a clock boundary. Ambiguous product details are listed per app.
