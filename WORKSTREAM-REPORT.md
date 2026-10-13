# PAGE3 workstream report

Implementation is committed locally on sb4-w10-page3, based on PAGE2
2f67142463. Both independent reviews are READY and final qualification is complete. Runtime
semantic checkpoint b05c034aea; model gate checkpoint 65d505289f.
No push, publication, writes to other worktrees or writes to the evidence farm.

## Farm result

All 50 odd wave-10 final schemas compile on copies. N_NEVER_COMPLETE drops
from **18 notes in 11 schemas to 2 in one schema**. Applying the exact checked
source repair on further copies gives **zero notes in all 50 schemas**.

| Shape | Before | After original source | After exact repair |
|---|---:|---:|---:|
| Party plus static role grant | 12 | 0 | 0 |
| Compound / non-equality / multi-branch | 3 | 0 | 0 |
| Hidden parent source | 2 | 2 | 0 |
| Pure membership | 1 | 0 | 0 |

Remaining original notes: 033 poolProposals and poolMembers. An owner may be
unable to read the parent source that physically grants child access, so an
inversion of readable parent rows would certify an incomplete child subset.
The note names an immutable, checked poolOwner copy, immutable reference,
non-expiring parent, restrict deletion, exact insert/payload edits and required
backfill/seeds. The concrete repaired schema compiles. See
[planner qualification](snapback4/reports/20261013-page3/planner.md),
[farm aggregate and hashes](snapback4/reports/20261013-page3/farm-survey.json) and
[exact rewrite](snapback4/reports/20261013-page3/hidden-parent-rewrite.q).

## Changes and commits

- **Static roles and bounded whole-group pages:** owner/party plus readable
  role grants now merge on synced unions and schema-bounded implicit reads.
  Role holders page the whole original range; everyone else their decided
  ranges. Fully pinned total uniques keep the implicit id position. An owner
  cap never bounds a staff's whole table. c97a35e2f3, 26d03a6fb4, aa4fe1a359.
- **Pure memberships and hidden sources:** pure membership reuses PAGE2's
  complete-discovery/head fence and shared cursor. Hidden sources get the
  exact checked copy repair; no cap/index-only repair is claimed. c97a35e2f3,
  26d03a6fb4.
- **Compound and non-equality rules:** bounded positive distribution retains
  every status condition and every membership/where alternative, including
  parent-teacher/status and four-variant nullable-enum non-null archives.
  Guarded subsets do not cover other lanes. c97a35e2f3, 26d03a6fb4, c2ed96746b.
- **Predicate cuts and compatibility:** readable fixed point predicates may
  be physically cut; continuation excludes an unfinished filter candidate.
  Fallible point keys keep the original short circuit. Bound filter setup
  blocks carry branch-pages-v2. Existing point-id membership capabilities
  remain unchanged. c97a35e2f3, 26d03a6fb4, aa4fe1a359.
- **Model, generation, simulator, devices and guide:** independent surface
  admission, positiveRanges_eval theorem, pure/compound examples, six actual
  native/Lean generated families, Memory/SQLite acquisition/cursors/reopen,
  status and role revocation simulation; guide indexes Private lists recipes
  updated. c97a35e2f3, c2ed96746b, aa4fe1a359, b05c034aea, 65d505289f.
- **Paired final review and governance:** a6ab25010a records both READY
  reviews at 65d505289f, disposition history and the LLP/JOURNAL qualification.
- **Measured wasm:** f11a5e72cd. Linux locked device is 2,310,393 B raw,
  704,662 B gzip, 532,356 B brotli. Budget **705,162 B = measurement + 500 B**.
  Relative to PAGE2, +5,258 B raw / +1,407 B gzip. No per-feature byte
  attribution or runtime ceiling increase. Clean metrology at f11a5e72cd
  passes family/absence audits. Later changes are lang/model/tests only.

## Verification

Every Cargo invocation carries CARGO_INCREMENTAL=0,
CARGO_PROFILE_DEV_DEBUG=0 and CARGO_PROFILE_TEST_DEBUG=0. The full
scripts/test.sh was never run. Setup frozen Bun install, CLI/web/client builds
pass. Final web/client build and clean metrology pass.

| Check | Result |
|---|---|
| Language PAGE3 focused cases | 14/14 |
| Existing branch merge / PAGE2 membership | 57/57; 5/5 |
| Lean emitter | 15/15 |
| Compiled guide | 120/120 |
| Core meter / discovery steps / capability suites | 9/9; 1/1; 12/12 |
| Device branches on Memory and SQLite | 15/15 |
| Simulator membership/status/revocation | 9/9 |
| Lean model | 59 standard-axiom audits; 74/74 examples; 7/7 fixtures |
| Native/Lean difftest tests / smoke | 35/35; 18/18 |
| Reference check | 0 errors; ref-check.txt retained |

Campaigns use seed 0, 400 cases, 4 workers and separate output directories.
The final release executable is rebuilt after semantic/model edits.

```sh
target/release/snapback4-difftest run --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page3-final-r5-native
target/release/snapback4-difftest run-lean --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page3-final-r5-lean
target/release/snapback4-difftest run-devices --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page3-final-r5-devices
```

Final qualification at 65d505289f: all 400 sources compile in each campaign,
with no generator errors. Native **22,277** and device **12,686** executions
have zero disagreements/signatures. Lean **1,108** executions retain only three
known C2 occurrences: `lean--continuation-next--next~no-next` twice and
`lean--next--next~no-next` once. **No new signatures** against PAGE2's baseline.
Lean's CLI exits 1 for these classified disagreements; this is not a green
Lean pagination campaign. 319 Lean oracle passes and 78 named Unsupported
cases are counted separately. Reports and executable/report hashes are under
snapback4/reports/20261013-page3/ (qualification.json).

## Reviews, decisions and limits

LLP 3000.036.001 §16 and union §5.3 amend the governing contract; the umbrella
3000.036 points at PAGE3. The context pack respects §§2–9,14–15's exact union,
totality, source readability, shared positions and safe cuts, plus union
holding/acquisition and PAGE2 lifetime filtering. No new LLP number or gate.

Every review round uses the required Muse contributor/high wrapper and a
fresh Codex gpt-6.1-sol/high session, mutually blind; stdout is preserved
verbatim with prompt/hash/checkpoint/command provenance in llp/reviews/.
Muse's plan-quota refusals recovered through the wrapper's authorized API
fallback. No credential file was read or printed.

Round 1 fixed cap exemption, copy reference/lifetime/existence preservation,
native/model outer conjunction and overly broad capability classification.
Round 2 fixed fallible static keys and block-hidden probe fencing; defensive
model cap gates were aligned, and actual enum execution/type-enum refusal
regressions were added. Round 3 Muse READY; Codex found supported-native
argument/signed keys outside the model's predicate classifier. They now have
the explicit page-static-key-expression boundary, with real native execution
and harness assertions that Unsupported has zero oracle executions. Positive
compound admission also declines negated probes. Round 4 Muse READY; Codex
found the model applied readable-static predicates to
membership/compound cases whose native gates stay read-free. Cases 3/4 now
retain Expr.total; direct pure/compound data/completeness comparisons pass.
Round 5: **Muse and fresh Codex both READY at 65d505289f**. Final
reviews and the exact frozen brief are retained under llp/reviews/.

Decisions/deferrals: the updated compiler supports the farm's complete
positive shapes; arbitrary negative probes, fallible predicates and unproved
hidden sources retain their existing scan. Enum schemas, compound where-branch
physical compositions, nullable constant compound pins, and static predicate
argument/signed-expression keys remain named model exclusions. This is a
model coverage limit, not a product workaround or a disguised pass. Large
uncapped memberships still depend on the ordinary meter; caps are availability
constraints, not invented correctness proofs. Only the requested 50 odd lanes
were surveyed; no new whole-farm/even-lane or full-battery claim.

An initial brotli measurement lacked the CLI and recorded zero brotli bytes;
that incomplete attempt is retained as such. Final metrology uses a temporary
Node zlib quality-11 CLI adapter and records actual brotli bytes. Gzip/raw are
unchanged and determine the budget. Existing oversized source files were not
refactored; the growing Lean emitter was split to keep it below 1,500 lines.
