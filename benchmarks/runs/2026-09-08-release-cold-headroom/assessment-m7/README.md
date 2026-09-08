# Independent M7 assessment

The fresh Grok assessment completed and records all nine M7 assertions passing.
Its [original report](results/grader-report.json) and
[original evidence trace](results/sanitized-evidence.md) are preserved unchanged.
The evidence supports a positive, bounded M7 diagnostic, with the qualifications
below. No new application failure was demonstrated by the root claim audit.
The report passes the frozen schema, independently rechecked by root.

This is M7-only: required earlier milestone suites were regression checks.
The report's `runScope: full` does not qualify the earlier continuous protocol,
native behavior, a complete capability matrix or a comparative score. All
O-dimension scores remain null, with no calibration or preregistered probes.

## Custody and clock

[Custody](custody.json) binds the copied report and supporting observations.
The requested/self-reported model was `grok-4.6` at xhigh; terminal usage names
`grok-4.6-build`. Both identities are retained. The supervisor clock ran from
17:35:53.421588 to 17:56:18.295128 UTC: 1,224.873540 seconds, against a 5,400-second
cap. Exit was 0. The report's 17:37–17:53:10 interval is a narrower self-recorded
window, not the complete session clock.

The assessor received an isolated source/data copy without author narratives,
earlier assessment findings or root conclusions. All 512 source entries still
match afterward; the original snapshot helper is unchanged. Both owned ports,
53132 and 53133, are closed. The original author source/database remain
separately preserved and stopped.

There is a physical-byte custody discrepancy. Preparation verified the stopped
source and copied database were identical at hash `9aa9…` at 17:34:52.185 UTC.
The assessor observed hash `e3df…` at 17:38:13.976–17:38:15.656, after dependency
installation and CLI version/help inspection, but before the recorded backend
launch at 17:39:06.936. Both observations report 9,572,352 bytes and no WAL.
The responsible operation is unknown; the original trace's “copy/open-time
SQLite bytes” explanation is unsupported. Exact physical-byte equality was
not preserved across handoff. No reset, seed or migration-apply command was
observed. The matching post-start API snapshot supports logical continuity
only within the helper's scope described below.

Selected credential-scanned observations are published under their original
`results/private/` paths. That historical directory name does not make these
selected files private. Complete scripts, screenshots, raw CLI logs and runtime
state remain in private custody.

## What the observations establish

- The [API checks](results/private/independent-m7-api.json) exercise poll bounds,
  changeable/idempotent voting, count increments and tombstone decrements.
  Exact visible counts match settings for the observed DM 42/group 10, including
  a group poll. Those two populations contain no tombstones or expired rows;
  they do not independently exercise a populated backfill-exclusion matrix.
- The [browser record](results/private/independent-m7-browser.json) contains
  three actual passing cross-client tally trials at 117/121/120 ms. Its offline
  vote check observes pending state and remote tally convergence after reconnect.
  It does not independently wait for the actor's pending marker to clear or
  selected state to settle. The separately retained
  [author choreography](../m7-retry/evidence/m7-choreography-attempt-6.jsonl)
  supplies the stronger settlement check. Neither proves process-kill recovery.
- API count maintenance and settings UI display are separate observations.
  The combined browser script later timed out reaching Weekend Plans settings;
  the [fresh-page retry](results/private/weekend-settings-retry.json) succeeded.
  Keep both attempts. They do not establish a live before/after settings-counter
  transition or prove a newly composed poll from an existing-poll visibility count.
- The [M7 suite](results/private/acceptance-receipts/suite-m7-1788889521.json)
  and required M1/M2/M4/M5/M6/M8 regressions pass. M3 remains excluded as the
  supplied prior failure. The grader labels the coverage mapping “honest,” but
  the mapped pre-existing count test uses a floor, and the mapped a07 test has
  no settings UI check. Supplemental observations do not change those mapping limits.

## Preservation scope

Root's independent comparison confirms whole semantic capture equality across
all recorded persona views for baseline versus immediate post-migration, and
supervisor-final versus assessor preflight, excluding capture metadata. The
first pair includes 48 message copies and 81 receipt rows. The latter pair
shares the late thread-window limit described in the
[author closeout](../m7-retry/README.md).

The assessor recovered all 15 starter IDs through Alice's paged
`messages.offlineHistory`, comparing 13 scalar/reference message fields with no
differences. This independently resolves the missing-message question through
the public API. It does not compare late receipts, reactions, ownReceipt or
every persona view. The grader's comparison script deduplicates to a first
persona copy and compares receipt recipient/status rather than receipt IDs;
its zero-diff output alone is not an all-persona/81-receipt-row check.

Empty baseline media/reaction/edited/tombstone/view-once classes, media-byte
integrity and uninterrupted intermediate availability remain outside the claim.

## Inherited history query mismatch

The report's d-01 observation is real: the DM has 42 rows through the root-page
`offlineHistory` query, while `thread` returns 20 with no continuation. Source
comparison shows the relevant query definitions and app `API.md` are unchanged
from the original continuous app. `thread` returns an object containing the
page. Installed 0.0.19 explicitly documents that object results have no root
continuation; the app's API instructions incorrectly promise full pagination.

This is inherited app composition/documentation, not an established M7
regression, migration deletion or engine cursor-contract violation. The
[existing follow-up](../../../../issues/20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md)
records the work to expose a supported history-page path and correct its instructions. Any repair
must preserve the membership-policy distinction: `thread` allows members;
`offlineHistory` requires active members.
