# BT round 1 — guard the actual release boundaries

**Follow-up:** [Round 2](../round2/REPORT.md) adds a timers phase and another
immediate for Grok's queued-macrotask controls. No fixed-yield checkpoint can
drain arbitrary chains of future scheduled work. The results below describe
the round-1 revision.

Base `cacea20f5d4135863abeb91feb959f8f309faf73`; same branch and worktree on
eb1000 (`expose-builder-pixel`). Test-only changes. No product source, built
product bytes, dependency lock, timer, retry limit or timeout declaration in
the four converted files changes. Nothing pushed or published.

## P2 and the repair

Astra's round-0 review found an actual coverage loss: a query could enter the
real custody wait, ignore it, and publish a cached answer after two microtasks.
The wait-entry assertions passed. In ownedEvent the answer is unchanged by
the write; its final value cannot detect early publication. In homePage even
an immediate caller-side pending check could run before the settlement reaction.

I reproduced both misses against round 0 on this worktree: two ownedEvent
cases and two homePage cases passed despite publication while held. The
reviewer's original-test rejection is independently reported in
`~/sb4-intent/reviews/bt-r0.astra.evidence/REVIEW.md`; this round does not claim
to have rerun that original baseline. The local reproduction logs are
`reproduce-ownedEvent.tap.gz` and `reproduce-homePage.tap.gz` (Node's default
spec reporter, despite their historical `.tap` names).

`releaseCustody(reads, release)` now yields an event-loop checkpoint with the
hold still in place. This drains queued publication and settlement reactions;
it is not a timed sleep or a readiness inference. In one synchronous
continuation it then checks every read's sticky settlement flag and invokes
the gate-opening callback. There is no await between the checks and release.
Both fulfillment and rejection count as settlement. The real wait is still
called with its receiver and arguments, and its promise/predicate/wakeup/timer
are unchanged.

All converted holds use this boundary check:

- Bounded-following checks every grouped sibling before POST release. Its
  static/helper, wide prediction, repost, inbox and native-guest scenarios
  check both original and fresh reads immediately before releasing apply.
  The separate nonpredictable inbox write has its own release check.
- Retained-history checks both tracked event reads together before POST release.
- Following-routing checks its pending composed read before changing the fake
  outbox to observed and letting ordinary sync deliver that state.
- Lifecycle checks the rebased read before both begin-send release and the
  actual held POST execution. Its original write IDs and final two-row answer
  remain asserted.

The stale query-response gate in bounded-following still opens before waiting
for custody; that is what lets the stale candidate encounter the prediction
fence. The later POST gate now has the new check. Failure cleanup releases are
unchanged. The scalar-cut cases on wasm and native still await genuine
30-second exhaustion and keep the exact `E_QUERY_RETRY` and monotonic-duration
assertions. No final-answer, raw provenance, cursor, offline, request-count,
prediction or transport assertion was removed or loosened in this round.
The [AST audit](assertion-audit.json) confirms all 682 explicit `assert.*`
call sites are textually identical and in the same order across these four
files (220/257/10/195), as are their hangBudget timeout declarations.
The moved pending checks now run for the whole group at actual release.

Governing context remains LLP 3000 (state barriers and Snapback 4 fence),
LLP 2000.000, LLP 3000.023 §11 (one-shot custody and observation), and LLP
3000.016 §2.2/§5 (Following). This is a test oracle repair, not a design change.
The [round-0 file census](../AUDIT.md#other-files-checked) still applies; this
round changes those same four integration files, their helper, and adds a
focused helper regression file. Publication's `test.sh` discovers it through
the existing `packages/snapback4/test/*.test.mjs` glob.

## Controls

[Permanent delayed-publication loader](late-publication.mjs), adapted from
Astra's reproducer, uses the fixture's previously successful answer. It enters
the real wait, ignores the wait result and returns that cached answer after
two microtasks. Exact source matches fail closed; mutations are import-time
only. Disabled mode leaves all modules unchanged.

The POST controls select ownedEvent and homePage. An additional apply control
selects conditionalHelper after the POST gate has opened and while apply is
still held. Each release is traced: POST mutants must fail with zero releases;
apply mutants must pass POST release and fail before apply release. All must
fail with `ERR_ASSERTION` / “settled while custody was held,” rather than a
timeout, loader error or final-data mismatch.

An exploratory apply control selected wide, which had no earlier successful
answer to cache, so it did not mutate and the tests passed. The retained
`late-apply-wide.tap.gz` and driver attempt document that inactive control.
The permanent runner selects conditionalHelper, whose fixture has the
required cached answer, and also requires one mutation trace per failed case.

The new `custody-read.test.mjs` has 16 adversarial cases: POST/apply ×
fulfillment/rejection × 0/2/8/64 microtasks, always behind a healthy sibling.
Each first proves wait entry, then publishes while held and requires the
actual release to be refused. A seventeenth positive case keeps an original
and a fresh invocation of the same query held through both phases, then
checks both observed answers after apply. It uses the real QueryCustody wait.

## Qualification and timings

| File | Tests | Original (s) | Round 0 median (s) | Round 1 runs 1 / 2 / 3 (s) | Round 1 median (s) |
| --- | ---: | ---: | ---: | --- | ---: |
| bounded-following | 39 | 1219.176 | 314.052 | 314.037 / 314.334 / 314.208 | 314.208 |
| retained-history | 78 | 192.570 | 68.989 | 68.763 / 68.763 / 68.808 | 68.763 |
| following-routing | 4 | 33.195 | 4.133 | 4.136 / 4.137 / 4.138 | 4.137 |
| client-lifecycle | 57 | 45.256 | 43.079 | 42.896 / 43.042 / 42.930 | 42.930 |

Bounded-following's median is **314.208 seconds** versus round 0's
314.052 seconds and the original 1,219.176 seconds: **904.968 seconds
saved (74.2%)**. Original and round-0 times are retained measurements,
not new baseline runs. [All 178 per-test comparisons](TIMINGS.md),
[machine-readable timings](timings.json), [file summary](timing-summary.json).

| Check | Result |
| --- | --- |
| Four complete files, three runs each | **534/534 pass**, zero skips/cancellations |
| Real scalar-cut deadline controls | Both tiers pass in all three runs; six real exhaustions with unchanged `E_QUERY_RETRY` and ≥30,000 ms assertions |
| One-shot + query-dependencies + query-publication-session | **378/378 pass** (354 top-level + 24 nested), 146.940 s |
| New helper regressions, three runs | **51/51 pass** (17 per run) |
| Admission bypass | **26/26 expected assertion failures** |
| Receipt-only bypass | **9/9 expected assertion failures** |
| Four selective sibling bypasses | **8/8 expected assertion failures** |
| Delayed cached-answer publication before POST | **4/4 expected assertion failures**, ownedEvent/homePage on both tiers |
| Delayed cached-answer publication before apply | **2/2 expected assertion failures**, conditionalHelper on both tiers, after POST release succeeds |
| `./ref-check` | Pass: 532 LLP docs, 10,593 refs, zero errors/unchecked |
| `git diff --check` | Pass |

[Every negative case](mutation-results.json) fails at the unsettled assertion;
all six delayed failures have `releaseCustody` in their stack. None is counted
from a timeout or a final-answer mismatch. Both loaders disabled pass all
four complete files in run 1. Product artifact hashes match round 0: the native
binary, wasm and all 128 SDK JavaScript files ([hashes](artifact-hashes.json)).

[Commands and intermediate attempts](COMMANDS.md),
[consolidated validated results](run-results.json),
[original driver attempts](run-attempts.json),
[corrected apply-control run](supplemental-results.json).
The first driver correctly exited 1 for its already-loaded inactive wide
selection. That attempt remains recorded; the separately rerun and verified
conditionalHelper control supersedes it in the consolidated results. The
permanent runner now selects that active control and verifies mutation and
release trace counts. No other attempt failed its expected-result check.

The old report's 354 regression count referred only to top-level cases. The
correct total, in round 0 as well as here, is 378 including 24 nested cases.
The old journal entry remains historical; the new entry records the correction.


`bun install --frozen-lockfile` and `bash ~/sb4-intent/check-sdk-deps.sh` ran
first in `snapback4/`: **deps-ok**, no dependency changes. Existing round-0
product builds are reused. The [runner](verify.py) records exact argv,
environment overrides, exit codes and TAP counts in `run-results.json`.
Its first serial four-file pass overlaps the independent mutation and
one-shot jobs; its second and third passes run one file at a time after this
lane's other jobs finish. Other lanes may use this shared host.

The user reports a round-0 Apartment mini run with all four files passing and
bounded-following at 312 seconds. That is external evidence, not a local
Darwin rerun or qualification of this round-1 revision. No full publication
suite, browser qualification or cross-host run is claimed here.
