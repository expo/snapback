# LLP maintain propose-only audit — Research Room / Snapback remediation-2

- Intent: `pre-pr`.
- Scope:
  `demos/backend-bakeoff/arms/research-room/snapback/remediation-2-handoff`.
- Mode: propose-only.
- Shared LLP, guide, diary, report, ledger, scoring, sealed capsule, frozen
  receipt, and product source files changed: none.
- Governing design checked: LLP 0102 frozen protocol and evidence rules, LLP
  0058 complete-pair startup/auth protocol, LLP 0076 exact-instance streamed
  action settlement, and the sessions/streamed-actions guide pages.
- Result: the imported repair matches the governing complete-pair and
  exact-instance intent. The arm reaches real session admission and all
  runnable frozen scenarios pass. No LLP status change or retirement is
  proposed.

## Proposals for coordinator review

1. Document or generate-time enforce the v1 rule that one mutation invocation
   may perform one generated membership write. The copied sealed setup first
   reached this runtime diagnostic only after the pre-bind composition defect
   was repaired.
2. Repair or clarify `SnapbackClient.inspect()` under sessions mode so the
   official method supplies the required auth-client protocol offer.
3. Add a session-aware operator/cron acceptance example covering manual tick,
   scheduled action replay, and redacted inspect.
4. Make deterministic effect receiver destinations runtime-configurable for
   isolated parallel test targets.
5. Preserve the files and semantic-search capability GAPs in the Snapback
   improvement synthesis; the confirmation did not erase or work around them.

The coordinator should decide whether proposals 1-4 become filesystem issues
or updates to existing issues. This audit applies no proposal itself.

