# Snapback 4: recovered journal prediction does not invalidate its live watch

Status: Open
Scope: Snapback 4 web admission-journal recovery and local watch invalidation
Reported: 2026-09-18, reviewer adjudication of Repair B round 15 item B15-D
Classification: Confirmed pre-existing; reproduces at saved base `27a8a4d66`

## Reviewer reproduction

1. Open a local client over the real wasm device and web persistence. Acquire
   the partition and subscribe to a query over the table a predictable mutation
   will change. Keep the synchronous admission journal (`localStorage`) enabled.
2. Submit the predictable mutation. Fail the ordinary admission save once,
   after the synchronous journal captured the intent. Leave that journal record
   intact. Admission reports an unknown outcome and its uncommitted device
   memory is discarded.
3. Run the next sync with healthy persistence and an otherwise empty server
   publication. The host restores the saved device and recovers the surviving
   journal entry. Recovery admits and durably saves its prediction.
4. Read the device directly: the predicted row is present. Inspect the existing
   watch: it still has the pre-prediction value. The enclosing empty publication
   reports no touched tables, so the client never reruns that watch for the
   recovered prediction.

The reviewer reproduced this on both saved base client/device `27a8a4d66` and
lane HEAD `66da3c0ad`. Healthy ordinary admissions and later relevant
invalidations are controls, not proof that recovery notified the original
watch. This ticket preserves the reproduction relayed by the author; it does
not claim a newly executed reviewer packet or independent reproduction here.

## Boundary and acceptance

`AdmissionJournal.recover` in `snapback4/packages/snapback4/src/web-journal.ts`
can commit a prediction during restore or another call, but does not carry its
predicted-table invalidations to the live client. `web.ts` returns the enclosing
operation's original result, whose touched set cannot represent that extra
commit. The round-16 durable-reply hook preserves the enclosing result only;
it deliberately does not fix this independent recovery publication boundary.

A future repair must invalidate/notify the affected live watch from the recovered
prediction's own committed effects, including when the enclosing publication
is empty or later host recovery fails. Verify native rows/outbox, watch data
and notifications, healthy controls and offline reopen; mutate away the recovery
invalidation and require the invariant to fail. Do not turn a failed save into
an acknowledged prediction or change the journal's replay-custody rules.

Repair B round 16 explicitly excludes implementation of this pre-existing
issue. Its originating triage record is
[closed with dispositions](closed/20260918-snapback4-remaining-commit-invalidation-gaps.md).
