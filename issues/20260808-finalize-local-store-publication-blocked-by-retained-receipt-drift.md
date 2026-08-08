# `finalize-local-persistent-store-publication` is blocked by a stale retained triage-graph receipt

**Opened:** 2026-08-08
**Area:** `scripts/finalize-local-persistent-store-publication`,
`tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json`,
`packages/snapback-client/index.mjs`
**Severity:** P2 — every landing that touches a pinned store-publication source
has to fall back to the mechanical carrier refresh instead of the qualified
finalize chain

## Observed

`scripts/finalize-local-persistent-store-publication` starts with

```
node tests/acceptance/triage-graph-move1-v1.mjs --check --require-qualified
```

which refuses on current `origin/main` (3bea79ec0):

```
AssertionError [ERR_ASSERTION]: packages/snapback-client/index.mjs: retained receipt source drifted from the working tree
+ '75855fa79db91c1e6699bd9bf9b857146daf27b26050db15a7e688f0a632a78c'
- '4cb56595d4b2f9f054df52354ed5c503e5dc58bc3a32bb3821d1bb29b180ec26'
    at verifyRetainedArtifacts (tests/acceptance/triage-graph-move1-v1.mjs:833:12)
```

`packages/snapback-client/index.mjs` is byte-identical to `origin/main` — the
drift is main's, not any working tree's. The file was last changed by
`b9dd2f216` (fix(client): export createAssetClient from the package root and pin
declared-vs-runtime export parity), which did not re-mint the retained
`tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json` receipt
that pins its sha256. The same retained receipt is a supporting receipt of
`src/local-persistent-store-publication.v1.json`.

## Impact

The `local-store-publication` pre-push drift gate refuses any commit that edits
`src/local.rs` or `src/storage.rs` (both are `executorSourceSha256` pins), and
the sanctioned way to re-green it — the finalize chain — cannot run. Landings
have to use the narrower `node scripts/refresh-publication-carrier.mjs`
(mechanical digest copy; its own header documents that use), which re-greens the
conformance corpus but skips the `--require-qualified` retained-receipt
precondition the finalize chain adds. First hit while landing
`issues/closed/20260807-server-sigterm-strands-large-sqlite-wal.md`
(shutdown WAL checkpoint), which had to touch both pinned sources.

## Ask

Re-mint the triage-graph Move-1 exit receipt (and the fleet-observatory sibling
if it pins the same source) against current `packages/snapback-client/index.mjs`
by running `node tests/acceptance/triage-graph-move1-v1.mjs` without `--check`,
then refresh
`src/local-persistent-store-publication.v1.json`'s `supportingReceiptSha256` and
re-verify the finalize chain end to end. Decide at the same time whether
`packages/snapback-client/index.mjs` belongs in that receipt's pinned source set
at all — a package-root re-export change forcing a Move-1 requalification may be
over-pinning.
