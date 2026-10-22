# SEC7 wave-22 security advice and finite-history evidence

Source checkpoint: `a8fb2ddf9c`; package versions remain 0.4.37. The future
0.4.38 entry is in CHANGELOG.md, which feeds guide changes when that version is
integrated. No publication or promotion receipt is claimed here.

The before binary reproduces the published bakeoff's counts exactly. Each input
is read from the wave directories, copied into an automatically removed temporary
project, and measured with native check JSON plus default human check. The source
evidence is never edited. `measure.py` records the evidence source digest, even in
the deterministic variant that strips authored invariant lines. `matrix.py`
records each actual variant's source digest. The scripts read schema files, not lane credential stores; curated evidence contains notes, counters and hashes.

| Note | Before: projects / default-visible / notes | After: projects / default-visible / notes |
|---|---:|---:|
| Role-wide read | 30 / 4 / 40 | 30 / 30 / 40 |
| Broad read | 7 / 0 / 9 | 7 / 7 / 9 |
| Grant outlives role | 18 / 0 / 30 | 10 / 10 / 15 |
| Optional evidence | 10 / 0 / 10 | 10 / 10 / 10 |
| Insert write intent | 44 / 44 / 111 | 8 / 6 / 10 |
| Column result exposure | 47 / 47 / 539 | 48 / 47 / 70 |
| Narrow retained role grant | 0 / 0 / 0 | 1 / 1 / 1 |
| Optional creating upload | 0 / 0 / 0 | 4 / 4 / 5 |

After uses the final class-based shortlist; source-table grouping and copy lineage
explain the changed result inventory. Grant calibration excludes parent ownership
probes (001/009/041), not genuine recipient assignment keys. All located likely-hole
questions survive the shortlist; neither SEC6 inventory code expands its budget.

Wave22 gates five projects: retained-role 021; optional creating uploads 003, 018,
027 and 040. Lane027 is known intentional optionality, so this is review cost,
not a confirmed exploit. Lane040 has two individually reviewed notes.

| Lane | Finding advice reaches default check with no/own intent | Spec-worded intent plus test: reachable observations |
|---|---|---:|
| 004 | transition bypass | 9 |
| 011 | role-wide write/read | 2 |
| 021 | retained role grant (gated) | 2 |
| 026 | role-wide read/write | 2 |
| 030 | stale creation eligibility | 1 |
| 037 | no finding-specific note; requires independent intent | 54 |
| 040 | optional creating upload (gated), reason | 0 |
| 044 | constant approval and inconsistent duration | 0 |

There are 24 full test experiments (none / own / one spec-worded invariant for all
eight lanes). None and own catch zero lanes; spec catches six. Observation counts
are witnesses, not counts of independent holes. 040's always-exists child assertion
and 044's temporal write assertion remain uncovered by test; their advice/gates
are not mislabeled catches. No amount exists to assert 044's missing fee directly.
Directed sequences reproduce 026 pickup after the closing state and 030 approval
after suspension. The optimized final CLI also refutes 037 during check with its spec intent; none/own still do not. New integration fixtures and a three-step boolean/role lifecycle
pin actual replay, bounded attempts and retained frontier size.

The corpus is 400 projects: 100 in wave15 and 50 each in waves16,18,19,20,21,22.
Both own and no-invariant variants are checked (800 checks). 67 projects require
review: 11,9,8,8,11,15,5 by wave, respectively. Optional-upload gates affect 57;
retained-role gates 14; four projects have both. All 67 own-source mechanical disposition probes clear their pending gates with zero remaining refusals; this is not a vulnerability-precision claim. There are zero non-review compiler
or reachable-invariant refusals. `review-cost.py` separately probes individual
acknowledgment and source-bound invalidation using explicit mechanical-experiment
reasons. It does not pretend those acknowledgments establish spec compliance or
classify every gate as a real vulnerability. Final counts/hashes are in SUMMARY.json.

Design round 3 and implementation rounds 5/6/8 have independent Muse and fresh Codex
READY verdicts, retained verbatim with provenance under llp/reviews. Test and
qualification results, remaining limits, commands and commit pointers are in the
root WORKSTREAM-REPORT.md. Failed attempts are not converted into success receipts.

Reproduce the measurements from the repository root with a timeout around each
command, using the workstream's build flags for every Cargo invocation. From
snapback4, measure.py accepts --binary, --out and --waves 15,16,18,19,20,21,22
(with a space after --waves). Pass --binary explicitly to matrix.py and review-cost.py as well.
Binaries are reproducible build outputs, not committed artifacts.

Final Linux consumer qualification passed at a8fb2ddf9c. The later guide-definition
correction at124dc80f2e has a fresh musl build, fresh package hashes and packed
security/rule checks. See qualification-final.json, packed-final-manifest.json
and packed-security-final.json. Full Cargo completed with six failures, followed
by 277/277 passing affected-target repairs; rust-workspace.json retains the failed
full-run outcome. Final Mac Studio verification remains unavailable (SSH timeout).
Lean has four classified signatures and no new signatures; it is not all-green.

Curated .gz files contain JSON or a sanitized full Cargo log. validation.json
records command families, outcomes and original log hashes. The experiment scripts
accept an explicit --binary and fresh --out; review-cost.py also needs the
--corpus output directory from measure.py. summarize.py reproduces SUMMARY.json
from the curated files after scratch cleanup; recorded binary hashes are preserved.
