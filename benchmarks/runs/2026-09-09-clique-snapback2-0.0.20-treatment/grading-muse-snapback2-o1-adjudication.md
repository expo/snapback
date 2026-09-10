# Muse O1 adjudication addendum

## Verdict

**CORRECTION REQUIRED**

The report's own record states that only M1 and M4 met the frozen green bar (`grading/grader-report.json:981`: "M1 met it in both the lane's receipts and the grader's re-run; M4 met it in the lane's receipts…; M2, M3, M5 and M6 did not meet it"; corroborated at `grading/trace.md:296`, `grading/trace.md:300-306`, `grading/trace.md:663-665`). Its O1 justification nevertheless places the score above the 60 anchor on "75 of 79 M1–M5 assertions passing, i.e. M1–M5 solid" and "M6 scores 5/13" (`grading/grader-report.json:791`; `grading/trace.md:888-891`). The frozen rule at `../../instrument/schema/social-messenger/applicability.json:50` — "non-green milestones … score their checklists as not passed - the status distinction matters for attribution, not for completeness credit" — forbids exactly that credit. The same rule appears verbatim in the brief (`../../instrument/social-messenger.md:887-893`). O1=62 is therefore derived from credit the frozen rule disallows.

## Scores

| | O1 |
|---|---|
| Original | **62** (`grading/grader-report.json:789`; `grading/trace.md:878`) |
| Corrected | **28** |

## Frozen-rule accounting

Denominator: all eight full-run milestones (`applicability.json:37-46`), 119 assertions — m1-a01…a13 (13), m2 (27), m3 (15), m4 (12), m5 (12), m6 (13), m7 (9) as keyed in `grading/grader-report.json:27-654`, plus the 18 M8 assertions the report schema cannot key (`grader-report.schema.json:145` pattern `^m[1-7]-a[0-9]{2}$` under `additionalProperties:false`; `grading/trace.md:686-691`; `grading/grader-report.json:981`). M8 stays in scope and in the denominator per `applicability.json:45,50`.

**Milestones receiving completeness credit: M1 and M4 only.**

- **M1 — credited, 13/13** (`grading/trace.md:394`; green on suite plus choreography in both the lane's receipts and the grader's re-run, `grading/trace.md:302`, `grading/grader-report.json:981`).
- **M4 — credited, 12/12** (`grading/trace.md:517`; lane receipt green 5/0, `grading/trace.md:305`; grader re-verified best-of-3 the assertions its load-affected re-run missed, `grading/grader-report.json:981`).
- **M2, M3, M5 — no credit.** Not green: m2 segment `green:false` 1/8, m5 `green:false` 1/3, and M3 has no choreography receipt anywhere in the lane (`grading/trace.md:300-306`, `grading/trace.md:295-296`), affirmed at `grading/grader-report.json:981`.
- **M6 — no credit.** "M6 therefore does not meet the green bar on any reading" (`grading/trace.md:663-665`; suite cannot load, d-02, `grading/trace.md:125-145`). The original report's 5/13 credit for M6 is non-compliant on the same rule as M2/M3/M5, though the blind reviewer named only the latter three.
- **M7 — no credit** (not-run, `grading/trace.md:667-674`). Its structural absence is admissible as *attribution* only; `applicability.json:50` bars it from restoring completeness credit.
- **M8 — no credit** (unbuilt, all 18 not-run, `grading/trace.md:676-686`).
- **Scale replay** is not an O1 input (`applicability.json:123-129`); its non-attempt bears only on the tail narrative.

**Credited: 25 of 119 assertions (21.0%).** The 55 independently passing assertions in M2 (26), M3 (12), M5 (12) and M6 (5) that the original justification counted toward its "80 pass" remain true observations and remain serialized as `pass` in `assertionResults` — the frozen rule governs O1's completeness credit, not the assertion record.

Note on a conflicting input: `final-report.md:46-53` declares M2 and M3 green; that file is on the grader's must-not-read list (`../../prompts/muse-snapback2.grade.md:11`), so it cannot restore credit here, and the grader recorded no `run-record.json` existed (`grading/grader-report.json:981`). I could not verify the 18-assertion M8 count against the frozen `assertions.json`; it is not among the files I was directed to read, and I take it from `grading/trace.md:686`. I re-ran nothing and re-derived no raw observation.

## Anchor rationale

Frozen anchors, verified in the brief rather than only as quoted in the report (`../../instrument/social-messenger.md:883-896`; "Anchors describe what ~30 / ~60 / ~90 look like; interpolate", line 883):

- **90** — "every in-scope milestone green, including platform-proof artifacts." Unreachable: two of eight green, and no simulator/native artifact of any kind exists (`grading/trace.md:654-661`).
- **60** — "M1–M4 solid, later milestones patchy or failed on cap." Read through the frozen rule, this anchor requires M1–M4 green (67 of 119 credited). The lane delivers half that front — M1 and M4 — for 25 of 119. The 62 placement, i.e. *above* this anchor, is unsupportable once M2/M3/M5/M6 credit is removed.
- **30** — "core features partially work; several checklist items fail." First clause is squarely met: accounts/profiles and media messaging clear the full green bar cleanly. Second clause is materially exceeded: 94 of 119 score not passed, and three milestones (M6 non-green with no platform proof, M7 not-run, M8 unbuilt) plus the scale replay contribute nothing at all.

**28** is the placement just below the 30 anchor: below it because the not-passed count and the three zero-contribution milestones outrun "several checklist items fail," and only slightly below because O1 scores "fraction *and quality*" (`../../instrument/social-messenger.md:887-888`) — the credited 21% is not partial credit but two milestones passing 13/13 and 12/12 on coverage-validated suites plus passing choreography segments, which is exactly what "core features partially work" describes. A deeper cut would understate two fully green milestones; anything at or above 30 would re-import the forbidden credit that produced 62.

## Scope

This is an addendum only. I made no edits: `grading/grader-report.json`, `grading/trace.md`, and `final-report.md` are unchanged on disk, and no file was written.

Unchanged and not reassessed: O2 = 34 (`grading/grader-report.json:794`); O3/O4/O5 = null on their own predicates (`grading/grader-report.json:798-800`; `applicability.json:96,112,128`); all 10 defects and their severities (`grading/grader-report.json:676-785`); `assertionResults` in full, including its 80 pass / 5 fail / 16 keyed not-run serialization and the 18 unkeyable M8 not-run results held in `notes`; `coverageSpotVerification` (`honest`, no dishonest milestones — `applicability.json:50`'s dishonest-mapping clause does not fire); empty `probeResults`; `timingRecords`; `notes`; `evidenceTracePath`; M7 (not inspected). M8 remains in full-run scope and in O1's denominator. The corrected value touches only `oDimensionScores.O1.score` and the reasoning behind it; the run still publishes per-dimension scores with **no weighted total**, three dimensions being null (`applicability.json:418`; `grading/trace.md:923-926`).
