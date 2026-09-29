# Round 8 failure ledger

- **Expected pre-fix controls:** `retry-before.log.gz` has 12 failures against
  the original runtime. The six local cases could recover incidentally after
  the four-second change-feed watchdog (they failed the missing-paced-retry
  assertion); the warm online keep:true fixture did not actually trigger a
  new read when it resubscribed its lingering owner. That initial run alone
  does not establish all twelve intended behavioral failures.
- **Ours, fixture correction:** `retry-fixed.log.gz` passes 11/12. Its warm online
  keep:true case timed out because resubscription reused the current linger.
  The corrected fixture explicitly begins plain revalidation through the
  captured production queued attempt. `retry-final.log.gz` passes 12/12.
- **Expected isolated original-runtime control:** `retry-control-final.log.gz`
  fails all twelve with the corrected online trigger. The local failures
  still occur at the retry assertion because the watchdog itself schedules
  offline reevaluation. The final fixture streams whitespace heartbeats after
  its omitted-table notification and parks probe recovery. It cannot repair
  the stranded profile through an unrelated link transition.
- **Final detecting control:** `retry-control-qualified.log.gz` restores only
  client.ts and local.ts from round-7 HEAD in a disposable SDK copy under
  this worktree's target directory, transpiles them with the installed
  TypeScript compiler, and selects that copy with RL_TEST_SDK. It leaves the
  qualifying SDK/artifacts unchanged. All twelve cases fail at their intended
  recovery assertion: six disjoint-profile cases and six online due-body
  cases. These are expected red controls, not qualification failures.
- **Ours, stale test record:** `affected.log.gz` passes 881/882; only
  `every delivery await is explicitly classified` fails. The online acceptance
  callback changes the hash of its existing await expression. Reviewed and
  updated client.ts's hash in delivery-await-boundary.json; its 58 awaits and
  all 158 classified delivery sites remain unchanged. `delivery-final.log.gz`
  passes all 317 checks. The correction preceded the full suite's client phase.
- **Ours, setup:** the first journal-preservation command accidentally ran
  repository-relative paths from snapback4/. It failed with FileNotFoundError
  and changed no files. The corrected command verifies every complete entry
  from both parents; see journal-preservation.json.

The final fixture validates each retry's requested exponential delay without
assuming how many service turns the host completes in 120 ms. Runtime source
was complete before the full suite started. No timeout, seed count, assertion
about visibility after membership removal, or size cap was relaxed.

## Required full run

The client phase reports 4,958 tests: 4,947 passed, one failed, ten existing
conditional skips, zero cancelled. The sole failure is **ours**:
`observed stale reads back off and stop after four requests`,
`online-store-order.test.mjs:97` (13 requests instead of 4). Its fixture combined
a stale sequence with an expired body; the explicitly requested expiry path
keeps retrying and therefore contradicts that old expectation. Updated the
observed fixture to isolate the stale-sequence fence, retaining every four-call,
backoff, loading and subsequent-notification assertion. Direct expired reads
retain their existing test. The new 12-case file separately requires paced
observed expiry recovery, including cold and unchanged warm answer identity.

`full-failure-followup.log.gz` passes **25/25**: the entire 13-case store-order file
and all twelve new cases. No runtime source changed after the full invocation
started. This test-only correction followed its client phase; the full run is
not relabelled green or repeated. Full-run baseline failures: **0**.
Full-run environmental failures: **0**. Final models pass **79/79**. Every other full stage passes. Exactly one
`scripts/test.sh` invocation exits 1 with `== 1 failure(s) in 1308 s`, failed
stage `client tests`. The inherited 60-second target remains exceeded.

## Final diff audit

**Ours, test filename collision:** the new 12-case file was initially written
over the existing `per-row-retry.test.mjs` (15 tests), so those original tests
were absent from the broad and full invocations. Final diff review detected it.
Restored the original file byte-for-byte from round-7 HEAD and moved the new
cases to previously absent `per-row-progress.test.mjs`. Historical logs retain
the old test filename. The full run is not claimed to have executed those
restored cases. `restored-retry-followup.log.gz` passes **40/40**, qualifying both retry files and
the complete corrected store-order file after restoration. No production change.

The first launch of that follow-up used the repository root for its report
redirection and failed before starting Node; rerunning from snapback4/ corrects
this setup error. No test output was discarded.
