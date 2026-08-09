# Publish 0.1.16 under the rapid-publication posture

**Status:** Open — claimed 2026-08-09 as lane 2 of
[`20260809-g4-rerun-lane-plan.md`](./20260809-g4-rerun-lane-plan.md)
**Impact:** 4 · **Urgency:** 4 · **Ease:** 3
**Systems:** Packaging, Publishing, Templates
**Date:** 2026-08-08
**Related:** LLP 0041 (rapid-publication amendment, 2026-08-08), LLP
0198 P1, diary 0072, `benchmarks/records/2026-08-08-messaging-0115-n3.md`

First application of the author's 2026-08-08 rapid-publication ruling
(LLP 0041 amendment): main carries meaningful published-surface fixes
that 0.1.15 consumers cannot reach — the expo-chat template web-deps
fix (hit all six web lanes in the run-6 N≥3 series; both web lanes'
longest loop three runs running), the six P1 guide anchors, and the
docs-site generator. Run the qualified fast-path publication
(0.1.14-ceremony recipe; carrier-refresh order and fence-sweep traps in
the memory/ticket record) and publish the closure as 0.1.16. Then
re-run one skill-web lane against 0.1.16 to confirm the web-deps loop
is gone (cheap N=1 sanity check, not a ratchet claim).

## Claim pointer (2026-08-09)

This publication is now lane 2 of the LLP 0176 G4 restart claimed in
[`20260809-g4-rerun-lane-plan.md`](./20260809-g4-rerun-lane-plan.md). The
0.1.16 cut is no longer only a rapid-publication errand: it is the vector the
G4 external rerun consumes, so the promotion lane additionally owns updating
`guide/published-closure.json`, regenerating the guide manifest, sweeping the
eleven `<!-- since: 0.1.16 unreleased -->` fences, and retaining a
`fastpath-ledger-0.1.16-<revision>.json` under `~/snapback-release-ledgers/`
(no such ledger was retained for 0.1.14 — do not repeat that gap).

Any session that wants to run this publication should record its branch in the
lane-plan ticket **before** starting; that ticket also carries the lapse rule
if this claim goes stale.
