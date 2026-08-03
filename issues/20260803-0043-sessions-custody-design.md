# LLP 0043 sessions-custody JS-arm queue — design pass commission

**Status:** Open
**Opened:** 2026-08-03 — commissioned by author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`)
**Systems:** Client integration, Sync, Auth
**Related:** LLP 0043 (§Auth posture — the deliverable's home), LLP 0053
(sealed `ctx.auth`, the lease), LLP 0129 (Phase 0 remainder),
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` (leg 2 —
this ticket owns its design)

## Commission

Charlie commissioned a **design pass** for the JS-arm sessions-custody
offline queue (leg 2 of the 2026-07-31 ticket above): today
`#offlineQueueStore()` deliberately returns null under browser/agent
session custody (`authorityFence` present), so the JS-arm queue covers
dev/external-bearer custody only.

**Working hypothesis** (the Contract arm's shipped discipline, LLP 0043
§Auth posture): **capture-at-enqueue authority descriptors +
strand-on-authority-change**. This is the starting point, not the
ruling — the author ratifies the **recorded design, not the
hypothesis**. The design pass must record its outcome even if it lands
on the alternative (a recorded permanent boundary with the Contract arm
as the sessions offline carrier).

## Deliverable

A recorded design in **LLP 0043 §Auth posture** (dated amendment)
covering the JS-arm sessions-custody queue: descriptor capture,
stranding semantics on authority change, settlement presentation, and
the honest refusal surface for whatever stays out of scope. Then
**author ratification** of that recorded design. Implementation is not
part of this commission and must not start ahead of the ratification.

## Design recorded (2026-08-03)

The design pass executed and landed on the working hypothesis:
**capture-at-enqueue authority descriptors + strand-on-authority-change**,
recorded as the dated subsection "JS-arm sessions-custody queue —
Recorded design (2026-08-03, commissioned at author sitting #2)" inside
LLP 0043 §Auth posture, with a matching Revised-header entry. The
recording covers: the exact captured descriptor set
(descriptor/principalScope/custody pair, with the never-captured list),
persistence and at-rest privacy treatment, the six-row stranding matrix
(instance change strands rerecordable; principal change is a privacy
deletion boundary; epoch advance and lease expiry deliberately do not
strand), the client pre-flight descriptor gate plus server-authoritative
replay admission (`SNAPBACK_AUTH_STALE_RESULT` precedence), settlement
cohort presentation, and the boundaries with leg 1 (M1 leases),
LLP 0090 D3, the Contract arm (three named asymmetries), and Accepted
LLP 0166.

**Four open points await the author at ratification** (recorded in the
subsection): (1) server-refusal-only vs porting LLP 0053 queue-obligation
suspension; (2) stranded-vs-failed taxonomy for
`SNAPBACK_AUTH_STALE_RESULT` on replay; (3) cross-principal
delete-with-diagnostic vs redacted tombstones; (4) the rerecord
affordance shape.

**Status stays Open pending author ratification.** Charlie ratifies the
recorded design (including the four open points), not the hypothesis; no
implementation is authorized by the recording, and the JS arm's
`SNAPBACK_OFFLINE_QUEUE_CUSTODY_UNSUPPORTED` fence stands until then.
