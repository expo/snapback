# Snapback 4 remaining commit-to-client invalidation gaps

Status: Closed — adjudicated in Repair B round 16
Scope: Snapback 4 local client, web host, prediction/watch delivery
Reported: 2026-09-18, Repair B round 15 commit-boundary audit

HH1 is fixed for a successful DeviceCore apply result followed by media failure.
The re-derived inventory in `snapback4/REPAIR-B-HANDOFF.md` names these remaining
gaps. They are code-inspected paths, not new runtime reproductions or a claim
that the complete failure class is closed. No broader repair is included in
the HH1 commit.

- **B15-A — admission:** `local.ts` awaits reconciliation in `call(admit)`
  before `mutate` reaches `rerunTables(predictedTables(entry.predicted))`.
  Device admission has already committed the outbox and prediction. A media
  failure instead takes the unknown-admission failure arm without invalidation.
- **B15-B — settlement:** `Device::settle` restores bases, records a receipt
  or removes a rejected entry, and replays survivors in one commit. The same
  wrapper awaits media before returning; rejection reruns occur only later in
  `flushOnce`. A removed rejected entry need not be visited by retry. The sent
  arm also awaits sync before resolving a terminal event. Qualify watch and
  completion delivery separately.
- **B15-C — acknowledged persistence, hidden result:** `web.ts`'s `settle`
  awaits `persist.save` before `remember`, journal cleanup and committed
  listeners. Its call path then awaits `journal.recover` for apply/observe/adopt
  and `recoverOrphans` for apply/observe before returning the original reply.
  In particular, `adoptOrphans` awaits `persist.others` before its per-orphan
  error handler. A failure there hides an already committed publication from
  the new local invalidation set. Distinguish failed persistence from successful
  persistence followed by recovery failure; do not discard proof of the latter.
- **B15-D — recovered prediction:** `AdmissionJournal.recover` can successfully
  admit a prediction and persist it while handling another call. It returns
  no predicted-table invalidations. The enclosing apply/admit reply does not
  include those additional tables. Qualify recovery into a live watch, alongside
  orphan imports that deliberately disable prediction.

Also retain explicit coverage limits for low-level apply's reset-then-E_GENERATION
arm (normal local sync preflights it; no bypass reproduced), direct raw-device
mutations with no watch protocol, thrown watch evaluations, and application
listener exceptions. A preserved invalidation set is not itself a guarantee of
successful query evaluation or delivery to every subscriber.

For each repair, inject one failure after the real commit, verify native state,
watch notification and healthy retry, and reopen offline. Keep an identical
no-failure control and a mutation that restores the lost-invalidation ordering.
Do not turn unrelated media cleanup into a requirement for remembering row
invalidation. The upload-facts lifetime issue remains separately tracked.

## Round 16 reviewer disposition

The author relayed the review adjudication on 2026-09-18:

| Item | Disposition |
| --- | --- |
| B15-A, admission/media | Dismissed by review. The previous code-inspection hypothesis is withdrawn; no accepted regression or fix is claimed. |
| B15-B, settlement/media | Dismissed by review. The previous code-inspection hypothesis is withdrawn; no accepted regression or fix is claimed. |
| B15-C, hidden committed host result | Confirmed lane regression II1. Fixed by exposing the persisted result synchronously to the client fence before host bookkeeping/recovery. Base, incoming HEAD, fixed HEAD and ordering mutations are recorded in the round-16 handoff. |
| B15-D, recovered prediction | Confirmed pre-existing at base, out of this lane's scope. Continued in [the focused recovery ticket](../20260918-snapback4-recovered-prediction-watch-invalidation.md). |

This closes the four-item triage record, not the recovered-prediction defect.
The original hypotheses above remain as the audit history, superseded by these
review dispositions. The user supplied the dismissals, not detailed dismissal
rationales; none are invented here.
