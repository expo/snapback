# PUB051 — STOPPED before upload

Recorded 2026-10-31T07:43:13Z. No npm publish command ran. All four packages remain latest **0.4.49**, and npm returns E404 for every requested **0.4.51** version. Exact npm view output: `final-registry-status.json`.

## Product red: progressive browser avatars remain denied after engine recovery

Affected behavior: a normal web app using default progressive `createApp`, awaiting `app.ready`, then rendering `useQuery`/`useAsset` gets profile rows but permanently missing avatars. This is a user-visible failure, so the publication is stopped under the product-red rule. Selecting awaited startup merely establishes the control; it is not a proposed fixture repair or publication workaround. The coordinator decides the next action; this report does not designate 0.4.51 skipped.

Current-main diagnostic source: `48ec7dd370cb473a7c08417d00042143e515858d` (the main-based test-fix commit, still package version 0.4.50). This includes the subsequently landed settlement-decision and trusted-proxy work. The version-only release draft `6c95ba698ebbf3e1a3798b4e0d85f0adeca2ade6` remains local and unpushed; it has not been rebased onto the updated main and is not a qualified publication source. The product red is in the current-main release runtime, independently of the version string.

Evidence:

- The original selected client sweep failed `asset-avatars.test.mjs` at its initial WASM ready-avatar wait. Online/process tiers passed. Matching CLI/package/WASM version repair did not fix it: standalone full file failed again, 18 pass/2 failed test nodes, WASM timeout after 122 seconds. `isolated/discovery-asset-avatars/run-1.log`.
- Diagnostic rerun on updated main reproduced the failure: all **62 profile observations contain data**, all **62 avatar hooks remain denied E_STORE**, and all four view scopes have zero ready avatars. At that point `localStatus` is **ready, executable=true, acquired=true**; no page errors. `diagnosis/asset-avatars/current-main-state-summary.json` and `current-main-state-full.json`.
- Default probe: online and process passed, WASM failed after 122 seconds; total 146.3 seconds. `diagnosis/asset-avatars/current-main-probe.log` (exit 1).
- Same-source/same-engine WASM control with only `startup: "awaited"` passed the complete avatar subtest in 10.9 seconds, including replacement, retry/recovery, independent handles, released-id refusal, one-view consumption, membership revocation and sign-out. `diagnosis/asset-avatars/awaited-control.log` (exit 0).
- Probe source, exact diffs, SHA256 hashes and provenance are retained under `diagnosis/asset-avatars/`. The default probe adds diagnostics and import relocation only; the control also selects the WASM tier and awaited mode. No runtime source was edited.

Root cause: `local.ts:1597–1599` refuses asset reads with retryable `localUnavailable()` E_STORE before the core/media are ready. `local-status.ts:7–8` defines that opening refusal. `react.tsx:690–704` publishes it as denied and only recovers refusals accepted by `assetError`; `asset-download.ts:8` excludes E_STORE. The hook also has no local-status subscription. Consequently a successful later engine/replica opening leaves the initial asset result stranded, while progressive online query results have already supplied valid asset ids. Exact source snapshots are retained beside the probe.

This is distinct from the earlier per-row fixture mismatch: that provisional product classification was withdrawn after reading the explicit in-flight revocation ruling; all earlier evidence and the correction remain append-only in STATUS. This final stop is the reproduced, user-visible avatar recovery failure.

## Completed work and checks

- Local release draft mirrors the prior package/crate version bump, updates two version fixtures, finalizes the 0.4.51 changelog and marks 0.4.50 unpublished. Draft commit: `6c95ba698ebbf3e1a3798b4e0d85f0adeca2ade6`. Not pushed.
- Both-host fresh stock web/Expo preliminary packed-starter audits passed with zero findings and no waiver; locks contain @expo/cli 57.0.32, glob 14.0.2, minimatch 11.0.1. Retained `audit-linux-preflight/` and `audit-mac-preflight/`. These preliminary tarballs are not final Mac-native publication bytes.
- Initial release affected run passed all seven Rust crates and fixture wrappers (488 target launches), then the old per-row client fixture failed. Original run/receipt retained; no complete green release affected receipt exists.
- Test-only per-row fix pushed to main: `a69c65cf161f7eae1bd6e33aba50789ebf16019b`. Alone 3/3, 24 tests each; exact affected check/ref-check passed; old-behavior negative control fails four intended cases. Separate real eight-slot queue coverage preserves the distinct queue semantics.
- Test-only upload-hooks fix pushed to main: `48ec7dd370cb473a7c08417d00042143e515858d`. The original test had gone offline before an executable/identified device and ignored its failed capture. It now waits public readiness and requires queued capture before reload, retaining progressive startup. Alone 3/3 before rebase and 3/3 after; exact affected/ref-check passed on updated main.
- Discovery-only continuation collected the remaining regular client files and both models: 226/230 regular files passed; both models passed (89/89 tests). Version mismatch was own build-cache contamination after a diagnostic checkout downgrade; clearing only own WASM profiles and rebuilding resolved sync-generation, alone 6/6. Upload fixture was repaired as above. Avatar failure confirmed as product red. Social-browser failures remain unclassified; no further work after this product stop.

## Safe final state and deferred work

No PUB051 Linux systemd units remain. Scoped Mac `kill-dryrun.sh` found zero owned jobs on final cleanup; native build/witness never started. No other sessions were touched. The Linux worktree is on the main-based upload fixture commit; final WORKSTREAM-REPORT.md is intentionally uncommitted. Mac remains on the original local version draft. No final publication source was pushed, no final native/packed qualification or Darwin dry run completed, no finish script ran, and no publication records commit was created.

Deferred to the coordinator: product fix and qualification; rebase/cherry-pick lineage for a renewed release candidate; full mandatory affected/inventory/ref checks; final source push; canonical Mac native/prepare and cross-host hashes/audits; Linux qualify, Mac pre-darwin/dry run; staged smoke and repeat audits; finish/registry CLI/Expo; registry-byte smoke/verification; successful-publication records commit. This lane does not waive any of them.
