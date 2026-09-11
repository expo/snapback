# Snapback 2 starters reconstruct recovery and dismissal decisions

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 outbox/readiness presentation, React/Expo chat starters
**Related:** LLP 1018.008.006, LLP 1018.008.000, LLP 1018.003.001, LLP 1018.004

## Evidence and impact

At `b47337b26`, the [React composer](../../snapback2/packages/snapback2/templates/chat/react/src/Composer.tsx)
and [Expo composer](../../snapback2/packages/snapback2/templates/chat/expo/src/Composer.tsx)
inspect `outbox.detail.status.reason`, find the submitted intent in entries,
call `client.online()`, then await `outbox.settled()` and assemble a message.
Root work lists also repeat dismissal eligibility while query items expose
`action.dismissible`. These are source-confirmed parallel decisions, not a
reproduced recovery or data-loss defect.

Bounded automatic recovery already landed. This ticket concerns consuming that
behavior and its explicit recovery path. The duplicate-dismissal note in
[successor residual item 3](./20260910-snapback2-succ-review-residuals.md) is
transferred here; its unrelated naming cleanup stays there.

## Requested outcome and acceptance

- Both starters consume one SDK-owned recovery result and dismissal decision
  without reconstructing outbox policy. Retain operation-specific readiness
  and product-owned copy/drafts; choose any needed API in later design work.
- Remove repeated queue/forwarding/eligibility decisions, counting shared
  application helpers and root observers in the comparison.
- Explicit recovery can be awaited, reports stopped work/failure, and belongs
  to the account lifecycle alongside the existing automatic recovery owner.
- Device-work lists and item actions agree on dismissal. In-flight and unknown
  outcomes stay protected; refused queued work keeps its durable eligibility
  and replay rules.
- Preserve writer/follower custody, account changes, explicit offline mode,
  conflicts, and drafts. No periodic sync loop, rejected-write reissue, or
  auxiliary plain client is introduced.
- Exercise both starters and headless consumption, retain the current runtime
  allocation, and record total application work removed in the diary/LLP.

The [problem statement](../../llp/1018.008.006-client-owned-sync-experience.research.md)
leaves the API open. Common item presentation already belongs to
LLP 1018.003.001 §5; share that owner when implementation overlaps.

## Resolution — 2026-09-11

Both composers use outbox.recover() and mutation.work; device lists consume the shared work label/dismissible projection. Headless/React readiness uses the same owner. Regression controls cover independent deadlines, joined resume work, identity/offline/close cuts, follower aliases and unchanged drafts; both rendered arms preserve their recovery controls. All-template comparison:27 files / 1,718 lines → 28 files / 1,751 lines. This removes parallel policy, not total application lines.

Implemented with the four-plan commission in LLP 1018.008 §13–14. Integrated verification and source-review evidence are recorded there.
