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
