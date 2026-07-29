# Chat / Firebase Stage 5 refresh

This additive handoff refreshes the sealed Chat/Firebase arm from coordinator
base `8cd9e46794038239279587702fb4728e4f2bc589`.

The original `../work/` tree and `../run-capsule.v1.json` are unchanged. The
copied arm under `work/` upgrades `firebase-admin` from 13.5.0 to 14.2.0 and
`firebase-functions` from 6.4.0 to 7.3.2 while retaining the modular Admin SDK
and v2 callable-function paths. It ran against the fresh local namespace
`llp0102-final-chat-firebase-w2` on the isolated 352xx port block.

Key evidence:

- `work/receipts/acceptance-results.json`: 15/15 complete and passing.
- `work/receipts/offline-browser.json`: cold-page native IndexedDB history.
- `work/receipts/performance.json`: frozen two-warmup/seven-sample window.
- `work/receipts/machine-context.json`: actual machine context; this corrects
  stale hardcoded host/OS labels in `performance.json`.
- `work/receipts/emulator-hub.json`: exact service and auxiliary bindings.
- `work/receipts/export-manifest.json`: hashes for the successful emulator
  export before scoped cleanup.
- `work/receipts/cleanup.json`: exact process and port closure proof.
- `work/receipts/npm-audit-*.json`: unfiltered audit results.
- `failed-attempts/`: retained environment and isolation attempts.
- `final-refresh-summary.v1.json`: compact result and confidence index.
- `diary-entry-draft.md`: coordinator-owned diary insertion draft.

`preflight.mjs`, `prepare-run.mjs`, and `create-prep-receipt.mjs` make the
refresh setup and source/config transformation reproducible. Runtime
dependencies and generated build output are intentionally ignored.
